/**
 * Single-account Worker prototype (v4.1 §10–§11).
 *
 * The worker runs the current agent execution, that user's browser process,
 * and the §6 mounts. It does not contain a Gateway, does not read billing
 * ledgers, and does not carry seats or a policy library. It only consumes the
 * control-plane snapshot behind a lease.
 *
 * Lifecycle:
 *   STOPPED → STARTING → RUNNING → DRAINING → STOPPING → STOPPED
 *   STARTING | RUNNING → FAILED → STOPPED
 *
 * Idle reclaim stops processes. workspace, artifacts, memory, and state/browser
 * stay. The browser process is ephemeral; the profile directory is not.
 *
 * Warm attach and browser relaunch are the process operations used by the P3
 * lifecycle. This class still owns one account at a time.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/types.js";
import { ensureAccountProductionDirectories } from "../../gateway/account-execution-paths.js";
import type { AccountRuntimeSnapshot } from "../../gateway/governance/account-worker-runtime.js";
import { toWorkerRuntimeSnapshot } from "../../gateway/governance/account-worker-runtime.js";
import type { WorkerHeartbeatVerdict } from "../../gateway/governance/account-worker-runtime.js";
import { resolveExecutionWorkspace } from "../../gateway/workspace-resolver/execution-workspace.js";
import { readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { ACCOUNT_BROWSER_CONTAINER_DIR, ACCOUNT_EXEC_WORKSPACE } from "./account-mounts.js";
import {
  resolveDefaultAccountWorkerSandboxDriver,
  type AccountWorkerSandboxDriver,
} from "./account-worker-driver.js";
import { isAccountWorkerEnvFlagOn } from "./account-worker-flags.js";
import {
  parseRuntimeControllerRequest,
  RuntimeController,
  type RuntimeContainerSpec,
  type RuntimeControllerRequest,
  type RuntimeLeaseRegistration,
} from "./runtime-controller.js";

export const ACCOUNT_WORKER_PHASES = [
  "STOPPED",
  "STARTING",
  "RUNNING",
  "DRAINING",
  "STOPPING",
  "FAILED",
] as const;

export type AccountWorkerPhase = (typeof ACCOUNT_WORKER_PHASES)[number];

export const ACCOUNT_WORKER_FLAG = "OPENBOT_ACCOUNT_WORKER";

/** Shown when worker.json still says RUNNING after the browser container has exited. */
export const STALE_ACCOUNT_BROWSER_FAILURE =
  "云电脑浏览器已退出，不能继续当作运行中。请重新启动云电脑。";

const DEFAULT_IDLE_MS = 15 * 60 * 1000;

const EDGES: Record<AccountWorkerPhase, readonly AccountWorkerPhase[]> = {
  STOPPED: ["STARTING"],
  STARTING: ["RUNNING", "FAILED"],
  RUNNING: ["DRAINING", "FAILED"],
  DRAINING: ["STOPPING", "FAILED"],
  STOPPING: ["STOPPED", "FAILED"],
  FAILED: ["STOPPED"],
};

/** P6b: unset defaults ON; set `0`/`false`/`off`/`no` to roll back. */
export function isAccountWorkerFlagOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return isAccountWorkerEnvFlagOn(env[ACCOUNT_WORKER_FLAG]);
}

/** Control-plane answers the worker is allowed to ask for. No ledger access. */
export type AccountWorkerControlPlane = {
  findByLease(runtimeLeaseId: string): Promise<{
    snapshot: AccountRuntimeSnapshot;
    lease: {
      runtimeLeaseId: string;
      tenantId: string;
      userId: string;
      agentId: string;
      executionId: string;
      decisionId: string;
      snapshotVersion: number;
      expiresAt: string;
      revoked: boolean;
    };
  } | null>;
  heartbeat(params: {
    tenantId: string;
    userId: string;
    executionId: string;
    decisionId: string;
    snapshotVersion: number;
    runtimeLeaseId: string;
    nowMs: number;
  }): Promise<WorkerHeartbeatVerdict>;
};

export type AccountWorkerStatus = {
  phase: AccountWorkerPhase;
  tenantId: string;
  userId: string;
  agentId: string;
  executionId: string;
  runtimeLeaseId: string;
  snapshotVersion: number;
  execContainerName: string | null;
  browserPid: number | null;
  browserContainerName: string | null;
  workspaceDir: string | null;
  artifactsDir: string | null;
  memoryDir: string | null;
  browserProfileDir: string | null;
  lastFailure: string | null;
  /** The worker process never hosts a Gateway. */
  gatewayAttached: false;
};

export type AccountWorkerRecovery = {
  disposition: "resume" | "fail";
  reason: string;
  status: AccountWorkerStatus;
};

export type AccountWorkerSandboxHandle = {
  request: unknown;
  controlPlane: AccountWorkerControlPlane;
  statePath: string;
  driver?: AccountWorkerSandboxDriver;
  now?: () => number;
  idleAfterMs?: number;
  env?: NodeJS.ProcessEnv;
  worker?: AccountWorker;
  /**
   * P3 lifecycle. When set, sandbox start attaches a warm worker or cold-starts
   * through it, then starts the account browser on that lease.
   * Structural so this module does not import the lifecycle.
   */
  lifecycle?: {
    acquire(body: unknown): Promise<{ status: AccountWorkerStatus }>;
    browse?(params: {
      tenantId: string;
      userId: string;
    }): Promise<{ profileDir: string; pid: number; containerName: string }>;
  };
};

type PersistentDirs = {
  workspaceDir: string;
  artifactsDir: string;
  memoryDir: string;
  browserProfileDir: string;
};

export type AccountWorkerJournalView = {
  version: 1;
  phase: AccountWorkerPhase;
  tenantId: string;
  userId: string;
  runtimeLeaseId: string;
  browserPid: number | null;
  browserProfileDir: string;
  workspaceDir: string;
  artifactsDir: string;
  memoryDir: string;
  lastFailure: string | null;
};

type Journal = PersistentDirs & {
  version: 1;
  phase: AccountWorkerPhase;
  tenantId: string;
  userId: string;
  agentId: string;
  executionId: string;
  decisionId: string;
  runtimeLeaseId: string;
  snapshotVersion: number;
  execContainerName: string | null;
  /** Exec containers left running for other agents of this user. */
  retainedExecContainers?: string[];
  browserPid: number | null;
  browserContainerName: string | null;
  lastFailure: string | null;
  lastActiveAtMs: number;
};

export class AccountWorkerFailedError extends Error {
  readonly reason: string;
  readonly phase: AccountWorkerPhase;

  constructor(message: string, reason: string, phase: AccountWorkerPhase) {
    super(message);
    this.name = "AccountWorkerFailedError";
    this.reason = reason;
    this.phase = phase;
  }
}

export class AccountWorker {
  private phase: AccountWorkerPhase = "STOPPED";
  private tenantId = "";
  private userId = "";
  private agentId = "";
  private executionId = "";
  private collaborationGroupId: string | undefined;
  private decisionId = "";
  private runtimeLeaseId = "";
  private snapshotVersion = 0;
  private execContainerName: string | null = null;
  private retainedExecContainers: string[] = [];
  private browserPid: number | null = null;
  private browserContainerName: string | null = null;
  private persistent: PersistentDirs | null = null;
  private lastFailure: string | null = null;
  private lastActiveAtMs = 0;
  private spec: RuntimeContainerSpec | null = null;
  private readonly controller: RuntimeController;
  private readonly driver: AccountWorkerSandboxDriver;

  constructor(
    private readonly options: {
      cfg: OpenBotConfig | undefined;
      /** Operator exec image. Never taken from a Gateway request body. */
      operatorImage: string;
      /** Operator browser sandbox image. Never taken from a Gateway request body. */
      browserImage: string;
      statePath: string;
      controlPlane: AccountWorkerControlPlane;
      driver?: AccountWorkerSandboxDriver;
      now?: () => number;
      idleAfterMs?: number;
      env?: NodeJS.ProcessEnv;
      onPhase?: (phase: AccountWorkerPhase) => void;
    },
  ) {
    this.driver = options.driver ?? resolveDefaultAccountWorkerSandboxDriver(options.env);
    this.controller = new RuntimeController({
      image: options.operatorImage,
      browserImage: options.browserImage,
      cfg: options.cfg ?? {},
      env: options.env,
      now: () => this.now(),
    });
  }

  status(): AccountWorkerStatus {
    return {
      phase: this.phase,
      tenantId: this.tenantId,
      userId: this.userId,
      agentId: this.agentId,
      executionId: this.executionId,
      runtimeLeaseId: this.runtimeLeaseId,
      snapshotVersion: this.snapshotVersion,
      execContainerName: this.execContainerName,
      browserPid: this.browserPid,
      browserContainerName: this.browserContainerName,
      workspaceDir: this.persistent?.workspaceDir ?? null,
      artifactsDir: this.persistent?.artifactsDir ?? null,
      memoryDir: this.persistent?.memoryDir ?? null,
      browserProfileDir: this.persistent?.browserProfileDir ?? null,
      lastFailure: this.lastFailure,
      gatewayAttached: false,
    };
  }

  async start(body: unknown): Promise<AccountWorkerStatus> {
    const request = parseRuntimeControllerRequest(body);
    if (
      this.phase === "RUNNING" &&
      !request.runtimeLeaseId.includes(":group:") &&
      request.snapshotVersion === this.snapshotVersion
    ) {
      this.touch();
      return this.status();
    }
    if (this.phase !== "STOPPED") {
      throw new AccountWorkerFailedError(
        `cannot start account worker from ${this.phase}`,
        "illegal-phase",
        this.phase,
      );
    }
    await this.transition("STARTING");
    try {
      await this.stopRetainedExecs();
      const head = await this.options.controlPlane.findByLease(request.runtimeLeaseId);
      if (!head) {
        throw new Error("unknown runtime lease");
      }
      if (head.lease.revoked || head.snapshot.revoked) {
        throw new Error("runtime lease is revoked");
      }
      if (head.snapshot.snapshotVersion !== request.snapshotVersion) {
        throw new Error("stale snapshot");
      }
      const snapshot = toWorkerRuntimeSnapshot(head.snapshot);
      this.remember(snapshot, head.lease);
      this.persistent = await this.ensurePersistent(head.lease.agentId);
      this.controller.registerLease(toLeaseRegistration(head.lease));
      const started = this.controller.handle(request);
      if (
        !started.spec ||
        started.spec.image !== this.options.operatorImage ||
        started.spec.browserImage !== this.options.browserImage
      ) {
        throw new Error("controller spec is missing the operator images");
      }
      started.spec = {
        ...started.spec,
        execMounts: started.spec.execMounts.map((mount) =>
          mount.containerPath === ACCOUNT_EXEC_WORKSPACE
            ? { ...mount, hostPath: this.persistent!.workspaceDir }
            : mount,
        ),
      };
      this.spec = started.spec;
      const exec = await this.driver.startExec(started.spec);
      this.execContainerName = exec.containerName;
      this.lastFailure = null;
      this.touch();
      await this.transition("RUNNING");
      return this.status();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "start failed";
      await this.failToStopped(reason);
      throw new AccountWorkerFailedError(reason, reason, this.phase);
    }
  }

  async stop(): Promise<AccountWorkerStatus> {
    if (this.phase === "STOPPED") {
      return this.status();
    }
    if (this.phase === "FAILED") {
      await this.transition("STOPPED");
      return this.status();
    }
    if (this.phase !== "RUNNING") {
      throw new AccountWorkerFailedError(
        `cannot stop account worker from ${this.phase}`,
        "illegal-phase",
        this.phase,
      );
    }
    await this.transition("DRAINING");
    await this.stopProcesses();
    await this.transition("STOPPING");
    this.stopController();
    this.execContainerName = null;
    this.browserPid = null;
    this.browserContainerName = null;
    await this.transition("STOPPED");
    return this.status();
  }

  /**
   * Hang a caller onto this running lease. Does not start another process.
   * A failed heartbeat stops billing and lands in STOPPED with directories kept.
   */
  async attachWarm(): Promise<AccountWorkerStatus> {
    await this.assertRunning("attach");
    this.touch();
    await this.persist();
    return this.status();
  }

  /**
   * Same agent reuses this exec and the shared browser.
   * A different agent of the same user starts its own exec and keeps the browser
   * process, so tabs and cookies stay on the one profile.
   */
  async attachIncoming(body: unknown): Promise<AccountWorkerStatus> {
    await this.assertRunning("attach");
    const request = parseRuntimeControllerRequest(body);
    if (request.tenantId !== this.tenantId || request.userId !== this.userId) {
      throw new AccountWorkerFailedError(
        "account worker scope does not match the running computer",
        "scope-mismatch",
        this.phase,
      );
    }
    if (normalizeAgentId(request.agentId) === normalizeAgentId(this.agentId)) {
      const current = await this.ensurePersistent(this.agentId);
      if (
        current.workspaceDir === this.persistent?.workspaceDir &&
        !request.runtimeLeaseId.includes(":group:")
      ) {
        return this.attachWarm();
      }
      // Binding changed: use the existing agent-switch exec remount path below.
      // The account browser and its durable profile stay attached.
    }
    const head = await this.options.controlPlane.findByLease(request.runtimeLeaseId);
    if (!head) {
      throw new AccountWorkerFailedError("unknown runtime lease", "unknown-lease", this.phase);
    }
    if (
      head.lease.tenantId !== this.tenantId ||
      head.lease.userId !== this.userId ||
      normalizeAgentId(head.lease.agentId) !== normalizeAgentId(request.agentId)
    ) {
      throw new AccountWorkerFailedError(
        "incoming lease is not an agent of this account",
        "scope-mismatch",
        this.phase,
      );
    }
    if (head.lease.revoked || head.snapshot.revoked) {
      throw new AccountWorkerFailedError("runtime lease is revoked", "revoked", this.phase);
    }
    if (head.snapshot.snapshotVersion !== request.snapshotVersion) {
      throw new AccountWorkerFailedError("stale snapshot", "stale-snapshot", this.phase);
    }
    const browserPid = this.browserPid;
    const browserContainerName = this.browserContainerName;
    const previousExec = this.execContainerName;
    const previousProfile = this.persistent?.browserProfileDir ?? null;
    const persistent = await this.ensurePersistent(
      head.lease.agentId,
      head.snapshot.collaborationGroupId,
    );
    if (
      previousProfile &&
      path.resolve(persistent.browserProfileDir) !== path.resolve(previousProfile)
    ) {
      throw new AccountWorkerFailedError(
        "shared browser profile changed",
        "profile-mismatch",
        this.phase,
      );
    }
    this.controller.registerLease(toLeaseRegistration(head.lease));
    const started = this.controller.handle(request);
    if (
      !started.spec ||
      started.spec.image !== this.options.operatorImage ||
      started.spec.browserImage !== this.options.browserImage
    ) {
      throw new AccountWorkerFailedError(
        "controller spec is missing the operator images",
        "missing-spec",
        this.phase,
      );
    }
    started.spec = {
      ...started.spec,
      execMounts: started.spec.execMounts.map((mount) =>
        mount.containerPath === ACCOUNT_EXEC_WORKSPACE
          ? { ...mount, hostPath: persistent.workspaceDir }
          : mount,
      ),
    };
    if (
      previousExec &&
      normalizeAgentId(request.agentId) === normalizeAgentId(this.agentId) &&
      persistent.workspaceDir !== this.persistent?.workspaceDir
    ) {
      await this.driver.stopExec(previousExec);
    }
    const exec = await this.driver.startExec(started.spec);
    this.remember(toWorkerRuntimeSnapshot(head.snapshot), head.lease);
    this.persistent = persistent;
    this.spec = started.spec;
    this.browserPid = browserPid;
    this.browserContainerName = browserContainerName;
    if (previousExec && previousExec !== exec.containerName) {
      this.retainedExecContainers.push(previousExec);
    }
    this.execContainerName = exec.containerName;
    this.lastFailure = null;
    this.touch();
    await this.persist();
    return this.status();
  }

  /**
   * Reclaim idle processes only. Persistent account directories stay in place.
   */
  async reclaimIfIdle(
    nowMs?: number,
  ): Promise<{ reclaimed: boolean; status: AccountWorkerStatus }> {
    const now = nowMs ?? this.now();
    if (this.phase !== "RUNNING") {
      return { reclaimed: false, status: this.status() };
    }
    const idleAfter = this.options.idleAfterMs ?? DEFAULT_IDLE_MS;
    if (now - this.lastActiveAtMs < idleAfter) {
      return { reclaimed: false, status: this.status() };
    }
    const status = await this.stop();
    return { reclaimed: true, status };
  }

  async browse(): Promise<{ profileDir: string; pid: number; containerName: string }> {
    await this.assertRunning("browse");
    if (!this.spec || !this.persistent) {
      throw new AccountWorkerFailedError(
        "account worker has no sandbox spec",
        "missing-spec",
        this.phase,
      );
    }
    const profileMount = this.spec.browserMounts.find(
      (mount) => mount.containerPath === ACCOUNT_BROWSER_CONTAINER_DIR,
    );
    if (
      !profileMount ||
      path.resolve(profileMount.hostPath) !== path.resolve(this.persistent.browserProfileDir)
    ) {
      throw new AccountWorkerFailedError(
        "browser profile mount does not match the account profile",
        "profile-mismatch",
        this.phase,
      );
    }
    if (this.browserPid !== null && this.browserContainerName) {
      const alive = await this.driver.browserAlive(this.browserPid);
      if (alive) {
        this.touch();
        await this.persist();
        return {
          profileDir: this.persistent.browserProfileDir,
          pid: this.browserPid,
          containerName: this.browserContainerName,
        };
      }
      this.browserPid = null;
      this.browserContainerName = null;
      this.lastFailure = STALE_ACCOUNT_BROWSER_FAILURE;
      await this.persist();
    }
    let started: { pid: number; containerName: string };
    try {
      started = await this.driver.startBrowser(this.spec);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "browser start failed";
      this.lastFailure = reason;
      await this.persist();
      throw new AccountWorkerFailedError(reason, "browser-dead", this.phase);
    }
    this.lastFailure = null;
    this.browserPid = started.pid;
    this.browserContainerName = started.containerName;
    this.touch();
    await this.persist();
    return {
      profileDir: this.persistent.browserProfileDir,
      pid: started.pid,
      containerName: started.containerName,
    };
  }

  /**
   * The browser process died. Start another one on the same profile directory.
   * Cookies stay on disk; this method does not delete the profile.
   */
  async replaceCrashedBrowser(): Promise<{
    profileDir: string;
    previousPid: number;
    pid: number;
    containerName: string;
  }> {
    await this.assertRunning("relaunch-browser");
    if (!this.persistent || this.browserPid === null || !this.browserContainerName) {
      throw new AccountWorkerFailedError(
        "account worker has no browser process to recover",
        "browser-missing",
        this.phase,
      );
    }
    const previousPid = this.browserPid;
    try {
      await this.driver.stopBrowser(previousPid);
    } catch {
      // The process is already gone. The profile directory stays.
    }
    this.browserPid = null;
    this.browserContainerName = null;
    await this.persist();
    const started = await this.browse();
    if (started.pid === previousPid) {
      throw new AccountWorkerFailedError(
        "browser relaunch reused a dead process",
        "browser-relaunch-failed",
        this.phase,
      );
    }
    if (path.resolve(started.profileDir) !== path.resolve(this.persistent.browserProfileDir)) {
      throw new AccountWorkerFailedError(
        "browser relaunch left the account profile",
        "profile-mismatch",
        this.phase,
      );
    }
    return {
      profileDir: started.profileDir,
      previousPid,
      pid: started.pid,
      containerName: started.containerName,
    };
  }

  /**
   * Move a browser download out of the ephemeral temp dir into this agent's artifacts.
   */
  async acceptDownload(params: { sourcePath: string; fileName: string }): Promise<string> {
    await this.assertRunning("download");
    if (!this.persistent) {
      throw new AccountWorkerFailedError(
        "account worker has no artifacts directory",
        "missing-spec",
        this.phase,
      );
    }
    const base = path.basename(params.fileName);
    if (!base || base !== params.fileName || base === "." || base === "..") {
      throw new AccountWorkerFailedError(
        "download file name must stay inside the agent artifacts directory",
        "bad-download-name",
        this.phase,
      );
    }
    const destination = path.join(this.persistent.artifactsDir, base);
    if (path.resolve(path.dirname(destination)) !== path.resolve(this.persistent.artifactsDir)) {
      throw new AccountWorkerFailedError(
        "download destination escaped the agent artifacts directory",
        "bad-download-name",
        this.phase,
      );
    }
    await fs.copyFile(params.sourcePath, destination);
    await fs.unlink(params.sourcePath);
    this.touch();
    await this.persist();
    return destination;
  }

  /**
   * A new worker process reading the same journal. Resumes a live lease or
   * fails explicitly. A missing journal is a failure, never an allow.
   */
  async recover(): Promise<AccountWorkerRecovery> {
    if (this.phase === "RUNNING" && this.runtimeLeaseId) {
      return { disposition: "resume", reason: "already-running", status: this.status() };
    }
    const journal = await this.readJournal();
    if (!journal) {
      return { disposition: "fail", reason: "missing-worker", status: this.status() };
    }
    if (journal.version !== 1) {
      return { disposition: "fail", reason: "unreadable-worker", status: this.status() };
    }
    if (journal.phase === "STOPPED" || journal.phase === "FAILED") {
      this.restore(journal);
      this.phase = "STOPPED";
      this.execContainerName = null;
      this.browserPid = null;
      this.browserContainerName = null;
      await this.persist();
      return {
        disposition: journal.lastFailure ? "fail" : "resume",
        reason: journal.lastFailure ?? "already-stopped",
        status: this.status(),
      };
    }
    if (journal.phase === "DRAINING" || journal.phase === "STOPPING") {
      this.restore(journal);
      this.phase = "STOPPING";
      await this.stopProcesses();
      this.execContainerName = null;
      this.browserPid = null;
      this.browserContainerName = null;
      await this.transition("STOPPED");
      return { disposition: "fail", reason: "interrupted-stop", status: this.status() };
    }
    const verdict = await this.options.controlPlane.heartbeat({
      tenantId: journal.tenantId,
      userId: journal.userId,
      executionId: journal.executionId,
      decisionId: journal.decisionId,
      snapshotVersion: journal.snapshotVersion,
      runtimeLeaseId: journal.runtimeLeaseId,
      nowMs: this.now(),
    });
    if (!verdict.continueBilling) {
      this.restore(journal);
      this.phase = "RUNNING";
      await this.failToStopped(verdict.reason);
      return { disposition: "fail", reason: verdict.reason, status: this.status() };
    }
    this.restore({
      ...journal,
      phase: "STOPPED",
      execContainerName: null,
      browserPid: null,
      browserContainerName: null,
    });
    this.phase = "STOPPED";
    try {
      await this.start(requestFromJournal(journal));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "resume failed";
      return { disposition: "fail", reason, status: this.status() };
    }
    return { disposition: "resume", reason: "resumed", status: this.status() };
  }

  private async assertRunning(action: string): Promise<void> {
    if (this.phase !== "RUNNING") {
      throw new AccountWorkerFailedError(
        `cannot ${action} while the account worker is ${this.phase}`,
        "not-running",
        this.phase,
      );
    }
    const verdict = await this.options.controlPlane.heartbeat({
      tenantId: this.tenantId,
      userId: this.userId,
      executionId: this.executionId,
      decisionId: this.decisionId,
      snapshotVersion: this.snapshotVersion,
      runtimeLeaseId: this.runtimeLeaseId,
      nowMs: this.now(),
    });
    if (!verdict.continueBilling) {
      await this.failToStopped(verdict.reason);
      throw new AccountWorkerFailedError(
        `account worker stopped billing actions: ${verdict.reason}`,
        verdict.reason,
        this.phase,
      );
    }
  }

  private async ensurePersistent(
    agentId: string,
    groupId = this.collaborationGroupId,
  ): Promise<PersistentDirs> {
    const paths = await ensureAccountProductionDirectories({
      ctx: { tenantId: this.tenantId, userId: this.userId, domain: "employee" },
      cfg: this.options.cfg,
      agentId,
      env: this.options.env,
    });
    const bound = this.options.cfg
      ? await resolveExecutionWorkspace({
          cfg: this.options.cfg,
          agentId,
          scheduledOwner: { tenantId: this.tenantId, ownerId: this.userId },
          groupId,
          operation: "write",
        })
      : null;
    const memoryDir = path.join(paths.dataRoot, "memory");
    await fs.mkdir(memoryDir, { recursive: true });
    return {
      workspaceDir: bound?.rootPath ?? paths.workspaceDir,
      artifactsDir: paths.artifactsDir,
      memoryDir,
      browserProfileDir: paths.browserProfileDir,
    };
  }

  private remember(
    snapshot: AccountRuntimeSnapshot,
    lease: {
      runtimeLeaseId: string;
      tenantId: string;
      userId: string;
      agentId: string;
      executionId: string;
      decisionId: string;
      snapshotVersion: number;
    },
  ): void {
    this.tenantId = lease.tenantId;
    this.userId = lease.userId;
    this.agentId = lease.agentId;
    this.executionId = lease.executionId;
    this.decisionId = lease.decisionId;
    this.runtimeLeaseId = lease.runtimeLeaseId;
    this.snapshotVersion = snapshot.snapshotVersion;
    this.collaborationGroupId = snapshot.collaborationGroupId;
  }

  private async failToStopped(reason: string): Promise<void> {
    this.lastFailure = reason;
    if (this.phase === "STARTING" || this.phase === "RUNNING") {
      await this.transition("FAILED");
    }
    await this.stopProcesses();
    this.execContainerName = null;
    this.browserPid = null;
    this.browserContainerName = null;
    if (this.phase === "FAILED") {
      await this.transition("STOPPED");
    } else if (this.phase !== "STOPPED") {
      this.phase = "STOPPED";
      await this.persist();
    } else {
      await this.persist();
    }
  }

  private async stopProcesses(): Promise<void> {
    if (this.browserPid !== null) {
      try {
        await this.driver.stopBrowser(this.browserPid);
      } catch {
        // Process exit still has to reach STOPPED. The profile directory stays.
      }
    }
    if (this.execContainerName) {
      try {
        await this.driver.stopExec(this.execContainerName);
      } catch {
        // Same as the browser: a driver error must not skip the phase change.
      }
    }
    await this.stopRetainedExecs();
  }

  private async stopRetainedExecs(): Promise<void> {
    const retained = this.retainedExecContainers;
    this.retainedExecContainers = [];
    for (const name of retained) {
      if (!name || name === this.execContainerName) {
        continue;
      }
      try {
        await this.driver.stopExec(name);
      } catch {
        // A leftover exec must not block the phase change.
      }
    }
  }

  private stopController(): void {
    if (!this.runtimeLeaseId || !this.tenantId) {
      return;
    }
    try {
      this.controller.handle({
        action: "stop",
        runtimeLeaseId: this.runtimeLeaseId,
        tenantId: this.tenantId,
        userId: this.userId,
        agentId: this.agentId,
        snapshotVersion: this.snapshotVersion,
      });
    } catch {
      // The lease may already be gone. The worker phase is still authoritative.
    }
  }

  private async transition(next: AccountWorkerPhase): Promise<void> {
    const allowed = EDGES[this.phase];
    if (!allowed.includes(next)) {
      throw new AccountWorkerFailedError(
        `illegal account worker transition ${this.phase} → ${next}`,
        "illegal-phase",
        this.phase,
      );
    }
    this.phase = next;
    this.options.onPhase?.(next);
    await this.persist();
  }

  private touch(): void {
    this.lastActiveAtMs = this.now();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private async persist(): Promise<void> {
    if (!this.persistent || !this.runtimeLeaseId) {
      return;
    }
    const journal: Journal = {
      version: 1,
      phase: this.phase,
      tenantId: this.tenantId,
      userId: this.userId,
      agentId: this.agentId,
      executionId: this.executionId,
      decisionId: this.decisionId,
      runtimeLeaseId: this.runtimeLeaseId,
      snapshotVersion: this.snapshotVersion,
      execContainerName: this.execContainerName,
      retainedExecContainers: [...this.retainedExecContainers],
      browserPid: this.browserPid,
      browserContainerName: this.browserContainerName,
      lastFailure: this.lastFailure,
      lastActiveAtMs: this.lastActiveAtMs,
      ...this.persistent,
    };
    await writeJsonAtomic(this.options.statePath, journal);
  }

  private async readJournal(): Promise<Journal | null> {
    const parsed = await readJsonFile<Journal>(this.options.statePath);
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
      return null;
    }
    return parsed;
  }

  private restore(journal: Journal): void {
    this.tenantId = journal.tenantId;
    this.userId = journal.userId;
    this.agentId = journal.agentId;
    this.executionId = journal.executionId;
    this.decisionId = journal.decisionId;
    this.runtimeLeaseId = journal.runtimeLeaseId;
    this.snapshotVersion = journal.snapshotVersion;
    this.execContainerName = journal.execContainerName;
    this.retainedExecContainers = Array.isArray(journal.retainedExecContainers)
      ? journal.retainedExecContainers.filter((name) => typeof name === "string" && name.trim())
      : [];
    this.browserPid = journal.browserPid;
    this.browserContainerName = journal.browserContainerName;
    this.lastFailure = journal.lastFailure;
    this.lastActiveAtMs = journal.lastActiveAtMs;
    this.persistent = {
      workspaceDir: journal.workspaceDir,
      artifactsDir: journal.artifactsDir,
      memoryDir: journal.memoryDir,
      browserProfileDir: journal.browserProfileDir,
    };
  }
}

export async function readAccountWorkerJournal(
  statePath: string,
): Promise<AccountWorkerJournalView | null> {
  const parsed = await readJsonFile<Journal>(statePath);
  if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
    return null;
  }
  if (!(ACCOUNT_WORKER_PHASES as readonly string[]).includes(parsed.phase)) {
    return null;
  }
  if (
    !parsed.tenantId ||
    !parsed.userId ||
    !parsed.runtimeLeaseId ||
    !parsed.workspaceDir ||
    !parsed.artifactsDir ||
    !parsed.memoryDir ||
    !parsed.browserProfileDir
  ) {
    return null;
  }
  return {
    version: 1,
    phase: parsed.phase,
    tenantId: parsed.tenantId,
    userId: parsed.userId,
    runtimeLeaseId: parsed.runtimeLeaseId,
    browserPid: parsed.browserPid,
    browserProfileDir: parsed.browserProfileDir,
    workspaceDir: parsed.workspaceDir,
    artifactsDir: parsed.artifactsDir,
    memoryDir: parsed.memoryDir,
    lastFailure: parsed.lastFailure,
  };
}

/**
 * A journal that still says RUNNING while its browser container is gone.
 * Clears the phase so preview does not keep issuing a stream to that container.
 * Persistent directories stay. Returns false when the journal does not name
 * this container.
 */
export async function retireStaleRunningAccountWorkerJournal(params: {
  statePath: string;
  containerName: string;
  failure?: string;
}): Promise<boolean> {
  const parsed = await readJsonFile<Journal>(params.statePath);
  if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
    return false;
  }
  if (parsed.phase !== "RUNNING") {
    return false;
  }
  const recorded = parsed.browserContainerName?.trim() ?? "";
  if (!recorded || recorded !== params.containerName.trim()) {
    return false;
  }
  const failure = params.failure?.trim() || STALE_ACCOUNT_BROWSER_FAILURE;
  await writeJsonAtomic(params.statePath, {
    ...parsed,
    phase: "STOPPED",
    browserPid: null,
    browserContainerName: null,
    execContainerName: null,
    lastFailure: failure,
  });
  return true;
}

function toLeaseRegistration(lease: {
  runtimeLeaseId: string;
  tenantId: string;
  userId: string;
  agentId: string;
  executionId: string;
  decisionId: string;
  snapshotVersion: number;
  expiresAt: string;
  revoked: boolean;
}): RuntimeLeaseRegistration {
  return {
    runtimeLeaseId: lease.runtimeLeaseId,
    tenantId: lease.tenantId,
    userId: lease.userId,
    agentId: lease.agentId,
    executionId: lease.executionId,
    decisionId: lease.decisionId,
    snapshotVersion: lease.snapshotVersion,
    expiresAt: lease.expiresAt,
    revoked: lease.revoked,
  };
}

function requestFromJournal(journal: Journal): RuntimeControllerRequest {
  return {
    action: "start",
    runtimeLeaseId: journal.runtimeLeaseId,
    tenantId: journal.tenantId,
    userId: journal.userId,
    agentId: journal.agentId,
    snapshotVersion: journal.snapshotVersion,
  };
}
