/**
 * Account Computer P3 lifecycle (v4.1 §10–§11).
 *
 * A warm worker is attached to the lease it already holds. Otherwise the
 * account cold-starts: §4 directories are ensured, the browser profile is
 * mounted, and the control-plane snapshot is loaded. Idle reclaim stops
 * processes only. A crashed worker or browser comes back on the same profile,
 * or the lease fails explicitly. Device-bound credentials surface as
 * REAUTH_REQUIRED. Ordinary cookie files stay.
 *
 * Cold start, prewarm, and the running-worker cap are a small pool, not a
 * production warmer. The feature flag stays the P2 switch and defaults off.
 * This module does not export or migrate profiles (P4) and does not read
 * billing ledgers.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/types.js";
import { readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import {
  resolveDefaultAccountWorkerSandboxDriver,
  type AccountWorkerSandboxDriver,
} from "./account-worker-driver.js";
import { isAccountWorkerPrototypeEnabled } from "./account-worker-gateway.js";
import {
  AccountWorker,
  readAccountWorkerJournal,
  type AccountWorkerControlPlane,
  type AccountWorkerPhase,
  type AccountWorkerStatus,
} from "./account-worker.js";
import { parseRuntimeControllerRequest } from "./runtime-controller.js";

export const ACCOUNT_BROWSER_DEVICE_BOUND_FILE = "device-bound";
const COOKIE_FILE = "Cookies";

export type AccountBrowserLogin = "READY" | "REAUTH_REQUIRED";
export type AccountLifecycleMode = "warm" | "cold";

export type AccountWorkerLifecycleMetrics = {
  /** Worker lease start only. The browser image is `browserStartMs`. */
  coldStartMs: number[];
  /** Browser image create/start (`browse`). This is the slow cloud-PC slice. */
  browserStartMs: number[];
  warmAttachMs: number[];
  crashResumeAttempts: number;
  crashResumeSuccesses: number;
};

export type AccountLifecycleAcquireResult = {
  disposition: "ready";
  mode: AccountLifecycleMode;
  attachedExistingLease: boolean;
  fromPrewarm: boolean;
  prewarmed: boolean;
  durationMs: number;
  status: AccountWorkerStatus;
  persistentKept: true;
};

export type AccountIdleReclaimEntry = {
  tenantId: string;
  userId: string;
  persistentKept: true;
  workspaceDir: string;
  artifactsDir: string;
  memoryDir: string;
  browserProfileDir: string;
};

export type AccountIdleReclaimResult = {
  reclaimed: AccountIdleReclaimEntry[];
  skipped: number;
};

export type AccountBrowserCrashResult = {
  disposition: "resume" | "fail" | "unchanged";
  reason: string;
  login: AccountBrowserLogin | null;
  profileDir: string | null;
  previousPid: number | null;
  pid: number | null;
  persistentKept: boolean;
  cookiesPreserved: boolean | null;
};

export type AccountWorkerCrashRecovery = {
  tenantId: string;
  userId: string;
  disposition: "resume" | "fail";
  reason: string;
  login: AccountBrowserLogin | null;
  profileDir: string | null;
  persistentKept: boolean;
  cookiesPreserved: boolean | null;
  status: AccountWorkerStatus | null;
};

type Slot = {
  tenantId: string;
  userId: string;
  statePath: string;
  worker: AccountWorker;
  prewarmed: boolean;
};

type IndexSlot = {
  tenantId: string;
  userId: string;
  statePath: string;
};

type IndexFile = {
  version: 1;
  slots: Record<string, IndexSlot>;
};

const CRASH_PHASES = new Set<AccountWorkerPhase>(["STARTING", "RUNNING", "DRAINING", "STOPPING"]);

export class AccountWorkerLifecycleDisabledError extends Error {
  readonly reason = "disabled" as const;

  constructor() {
    super("account worker lifecycle is disabled");
    this.name = "AccountWorkerLifecycleDisabledError";
  }
}

export class AccountWorkerLifecycleQuotaError extends Error {
  readonly reason = "concurrency-quota" as const;

  constructor(
    readonly running: number,
    readonly maxRunning: number,
  ) {
    super(`account worker concurrency quota is ${running}/${maxRunning}`);
    this.name = "AccountWorkerLifecycleQuotaError";
  }
}

export class AccountWorkerLifecycleError extends Error {
  readonly reason: string;

  constructor(message: string, reason: string) {
    super(message);
    this.name = "AccountWorkerLifecycleError";
    this.reason = reason;
  }
}

export function percentile(samples: readonly number[], p: number): number | null {
  if (samples.length === 0 || p <= 0 || p > 100) {
    return null;
  }
  const sorted = [...samples].toSorted((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index] ?? null;
}

export async function inspectAccountBrowserLogin(profileDir: string): Promise<AccountBrowserLogin> {
  try {
    await fs.stat(path.join(profileDir, ACCOUNT_BROWSER_DEVICE_BOUND_FILE));
    return "REAUTH_REQUIRED";
  } catch {
    return "READY";
  }
}

function slotKey(tenantId: string, userId: string): string {
  return `${encodeURIComponent(tenantId)}/${encodeURIComponent(userId)}`;
}

function safeSegment(value: string, label: string): string {
  if (!value || value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new AccountWorkerLifecycleError(
      `${label} is not a single path segment`,
      "invalid-account",
    );
  }
  return value;
}

export class AccountWorkerLifecycle {
  private readonly slots = new Map<string, Slot>();
  private readonly driver: AccountWorkerSandboxDriver;
  private readonly maxRunning: number;
  private readonly samples: AccountWorkerLifecycleMetrics = {
    coldStartMs: [],
    browserStartMs: [],
    warmAttachMs: [],
    crashResumeAttempts: 0,
    crashResumeSuccesses: 0,
  };

  constructor(
    private readonly options: {
      cfg: OpenBotConfig | undefined;
      operatorImage: string;
      /** Operator browser sandbox image. Never from a Gateway body. */
      browserImage: string;
      /** Journals for this process. Not an account data directory. */
      runtimeDir: string;
      controlPlane: AccountWorkerControlPlane;
      driver?: AccountWorkerSandboxDriver;
      now?: () => number;
      elapsed?: () => number;
      idleAfterMs?: number;
      env?: NodeJS.ProcessEnv;
      /** Simplified cap on RUNNING workers. Warm attach does not take a slot. */
      maxRunningWorkers?: number;
    },
  ) {
    const maxRunning = options.maxRunningWorkers ?? 8;
    if (!Number.isInteger(maxRunning) || maxRunning < 1) {
      throw new AccountWorkerLifecycleError(
        "maxRunningWorkers must be a positive integer",
        "invalid-quota",
      );
    }
    this.maxRunning = maxRunning;
    this.driver = options.driver ?? resolveDefaultAccountWorkerSandboxDriver(options.env);
  }

  metrics(): AccountWorkerLifecycleMetrics {
    return {
      coldStartMs: [...this.samples.coldStartMs],
      browserStartMs: [...this.samples.browserStartMs],
      warmAttachMs: [...this.samples.warmAttachMs],
      crashResumeAttempts: this.samples.crashResumeAttempts,
      crashResumeSuccesses: this.samples.crashResumeSuccesses,
    };
  }

  coldStartPercentile(p: number): number | null {
    return percentile(this.samples.coldStartMs, p);
  }

  browserStartPercentile(p: number): number | null {
    return percentile(this.samples.browserStartMs, p);
  }

  warmAttachPercentile(p: number): number | null {
    return percentile(this.samples.warmAttachMs, p);
  }

  crashResumeSuccessRate(): number | null {
    if (this.samples.crashResumeAttempts === 0) {
      return null;
    }
    return this.samples.crashResumeSuccesses / this.samples.crashResumeAttempts;
  }

  /**
   * Warm hit attaches the running lease. No warm worker cold-starts, mounts
   * the §4 directories and browser profile, and loads the snapshot.
   * Same-user acquires are serialized so two agents cannot start two browsers.
   */
  async acquire(body: unknown): Promise<AccountLifecycleAcquireResult> {
    const scope = this.peekScope(body);
    const key = scope ? slotKey(scope.tenantId, scope.userId) : "invalid";
    return this.enqueue(key, () => this.acquireInner(body, false));
  }

  /** Leave a worker RUNNING so the next acquire is a warm hit. */
  async prewarm(body: unknown): Promise<AccountLifecycleAcquireResult> {
    const scope = this.peekScope(body);
    const key = scope ? slotKey(scope.tenantId, scope.userId) : "invalid";
    const acquired = await this.enqueue(key, () => this.acquireInner(body, true));
    const slot = this.slots.get(slotKey(acquired.status.tenantId, acquired.status.userId));
    if (slot) {
      slot.prewarmed = true;
    }
    return { ...acquired, prewarmed: true };
  }

  /** Start or reuse the account browser on the mounted profile. */
  async browse(params: {
    tenantId: string;
    userId: string;
  }): Promise<{ profileDir: string; pid: number; containerName: string }> {
    return this.enqueue(slotKey(params.tenantId, params.userId), () => this.browseInner(params));
  }

  private async browseInner(params: {
    tenantId: string;
    userId: string;
  }): Promise<{ profileDir: string; pid: number; containerName: string }> {
    this.assertEnabled();
    const slot = this.slots.get(slotKey(params.tenantId, params.userId));
    if (!slot || slot.worker.status().phase !== "RUNNING") {
      throw new AccountWorkerLifecycleError("account worker is not running", "worker-not-running");
    }
    return this.timeBrowserStart(() => slot.worker.browse());
  }

  /** Image start is not part of coldStartMs. Record it on its own. */
  private async timeBrowserStart<T>(run: () => Promise<T>): Promise<T> {
    const started = this.mark();
    try {
      return await run();
    } finally {
      this.samples.browserStartMs.push(Math.max(0, this.mark() - started));
    }
  }

  /**
   * Stop idle processes. workspace, artifacts, memory, and state/browser stay.
   */
  async reclaimIdle(nowMs?: number): Promise<AccountIdleReclaimResult> {
    this.assertEnabled();
    const reclaimed: AccountIdleReclaimEntry[] = [];
    let skipped = 0;
    for (const slot of this.slots.values()) {
      const outcome = await slot.worker.reclaimIfIdle(nowMs);
      if (!outcome.reclaimed) {
        skipped += 1;
        continue;
      }
      slot.prewarmed = false;
      if (!(await this.persistentKept(outcome.status)) || !this.layoutOk(outcome.status)) {
        throw new AccountWorkerLifecycleError(
          "idle reclaim dropped persistent account data",
          "persistent-data-lost",
        );
      }
      reclaimed.push({
        tenantId: slot.tenantId,
        userId: slot.userId,
        persistentKept: true,
        workspaceDir: outcome.status.workspaceDir ?? "",
        artifactsDir: outcome.status.artifactsDir ?? "",
        memoryDir: outcome.status.memoryDir ?? "",
        browserProfileDir: outcome.status.browserProfileDir ?? "",
      });
    }
    return { reclaimed, skipped };
  }

  /**
   * The worker process is still up and the browser process is not.
   * Relaunch on the same profile. Device-bound credentials need reauth.
   */
  async recoverBrowserCrash(params: {
    tenantId: string;
    userId: string;
  }): Promise<AccountBrowserCrashResult> {
    this.assertEnabled();
    const slot = this.slots.get(slotKey(params.tenantId, params.userId));
    const status = slot?.worker.status() ?? null;
    if (!slot || status?.phase !== "RUNNING") {
      return this.browserResult("fail", "worker-not-running", null, null, null, null, false, null);
    }
    const profileDir = status.browserProfileDir;
    const pid = status.browserPid;
    if (pid === null || !profileDir) {
      return this.browserResult(
        "fail",
        "browser-missing",
        null,
        profileDir,
        null,
        null,
        await this.persistentKept(status),
        null,
      );
    }
    const login = await inspectAccountBrowserLogin(profileDir);
    if (await this.driver.browserAlive(pid)) {
      return this.browserResult(
        "unchanged",
        "browser-alive",
        login,
        profileDir,
        pid,
        pid,
        true,
        true,
      );
    }
    this.samples.crashResumeAttempts += 1;
    const cookiesBefore = await readCookies(profileDir);
    try {
      const relaunched = await slot.worker.replaceCrashedBrowser();
      const cookiesAfter = await readCookies(relaunched.profileDir);
      const kept = await this.persistentKept(slot.worker.status());
      const sameProfile = path.resolve(relaunched.profileDir) === path.resolve(profileDir);
      const cookiesPreserved = cookiesBefore === null ? null : cookiesBefore === cookiesAfter;
      if (!kept || !sameProfile || cookiesPreserved === false) {
        return this.browserResult(
          "fail",
          cookiesPreserved === false ? "cookies-lost" : "persistent-data-lost",
          login,
          relaunched.profileDir,
          relaunched.previousPid,
          relaunched.pid,
          kept,
          cookiesPreserved,
        );
      }
      const nextLogin = await inspectAccountBrowserLogin(relaunched.profileDir);
      this.samples.crashResumeSuccesses += 1;
      return this.browserResult(
        "resume",
        nextLogin === "REAUTH_REQUIRED" ? "reauth-required" : "resumed",
        nextLogin,
        relaunched.profileDir,
        relaunched.previousPid,
        relaunched.pid,
        true,
        cookiesPreserved,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "browser-relaunch-failed";
      return this.browserResult(
        "fail",
        reason,
        login,
        profileDir,
        pid,
        null,
        await this.persistentKept(slot.worker.status()),
        cookiesBefore === null ? null : (await readCookies(profileDir)) === cookiesBefore,
      );
    }
  }

  /**
   * Rebuild workers from the on-disk index after this process died.
   * A live slot is not a crash. Clean STOPPED journals are not resume attempts.
   */
  async recoverWorkerCrash(): Promise<AccountWorkerCrashRecovery[]> {
    this.assertEnabled();
    const index = await this.readIndex();
    const results: AccountWorkerCrashRecovery[] = [];
    for (const [key, entry] of Object.entries(index.slots)) {
      if (this.slots.has(key)) {
        continue;
      }
      results.push(await this.recoverIndexedSlot(key, entry));
    }
    await this.writeIndex();
    return results;
  }

  private async acquireInner(
    body: unknown,
    prewarmCall: boolean,
  ): Promise<AccountLifecycleAcquireResult> {
    this.assertEnabled();
    const request = parseStart(body);
    const key = slotKey(request.tenantId, request.userId);
    const existing = this.slots.get(key);
    if (existing?.worker.status().phase === "RUNNING") {
      const started = this.mark();
      const status = await existing.worker.attachIncoming(body);
      const durationMs = Math.max(0, this.mark() - started);
      this.samples.warmAttachMs.push(durationMs);
      return {
        disposition: "ready",
        mode: "warm",
        attachedExistingLease: true,
        fromPrewarm: existing.prewarmed,
        prewarmed: prewarmCall,
        durationMs,
        status,
        persistentKept: true,
      };
    }
    if (this.runningCount() >= this.maxRunning) {
      throw new AccountWorkerLifecycleQuotaError(this.runningCount(), this.maxRunning);
    }
    const started = this.mark();
    const statePath = existing?.statePath ?? this.statePathFor(request.tenantId, request.userId);
    const worker = existing?.worker ?? this.createWorker(statePath);
    const status = await worker.start(body);
    if (!(await this.persistentKept(status)) || !this.layoutOk(status)) {
      await worker.stop().catch(() => undefined);
      throw new AccountWorkerLifecycleError(
        "cold start did not keep section 4 persistent directories",
        "persistent-data-lost",
      );
    }
    if (status.snapshotVersion !== request.snapshotVersion) {
      await worker.stop().catch(() => undefined);
      throw new AccountWorkerLifecycleError(
        "cold start did not load the requested snapshot",
        "snapshot-not-loaded",
      );
    }
    this.slots.set(key, {
      tenantId: request.tenantId,
      userId: request.userId,
      statePath,
      worker,
      prewarmed: existing?.prewarmed ?? false,
    });
    await this.writeIndex();
    const durationMs = Math.max(0, this.mark() - started);
    this.samples.coldStartMs.push(durationMs);
    return {
      disposition: "ready",
      mode: "cold",
      attachedExistingLease: false,
      fromPrewarm: false,
      prewarmed: prewarmCall,
      durationMs,
      status,
      persistentKept: true,
    };
  }

  private async recoverIndexedSlot(
    key: string,
    entry: IndexSlot,
  ): Promise<AccountWorkerCrashRecovery> {
    const journal = await readAccountWorkerJournal(entry.statePath);
    if (!journal || journal.tenantId !== entry.tenantId || journal.userId !== entry.userId) {
      this.samples.crashResumeAttempts += 1;
      return {
        tenantId: entry.tenantId,
        userId: entry.userId,
        disposition: "fail",
        reason: journal ? "scope-mismatch" : "unreadable-worker",
        login: null,
        profileDir: null,
        persistentKept: false,
        cookiesPreserved: null,
        status: null,
      };
    }
    const crashed = CRASH_PHASES.has(journal.phase);
    if (crashed) {
      this.samples.crashResumeAttempts += 1;
    }
    const worker = this.createWorker(entry.statePath);
    const recovered = await worker.recover();
    const kept = await this.persistentKept(recovered.status);
    let login: AccountBrowserLogin | null = null;
    let cookiesPreserved: boolean | null = null;
    let profileDir = recovered.status.browserProfileDir;
    if (recovered.disposition === "resume" && recovered.status.phase === "RUNNING") {
      if (journal.browserPid !== null && profileDir) {
        const cookiesBefore = await readCookies(profileDir);
        try {
          const browsed = await this.timeBrowserStart(() => worker.browse());
          profileDir = browsed.profileDir;
          login = await inspectAccountBrowserLogin(browsed.profileDir);
          const cookiesAfter = await readCookies(browsed.profileDir);
          cookiesPreserved = cookiesBefore === null ? null : cookiesBefore === cookiesAfter;
          if (path.resolve(browsed.profileDir) !== path.resolve(journal.browserProfileDir)) {
            return this.finishCrash(key, entry, worker, {
              disposition: "fail",
              reason: "profile-mismatch",
              login,
              profileDir,
              persistentKept: kept,
              cookiesPreserved,
              status: worker.status(),
              crashed,
            });
          }
        } catch (error) {
          return this.finishCrash(key, entry, worker, {
            disposition: "fail",
            reason: error instanceof Error ? error.message : "browser-relaunch-failed",
            login: null,
            profileDir,
            persistentKept: await this.persistentKept(worker.status()),
            cookiesPreserved:
              cookiesBefore === null ? null : (await readCookies(profileDir)) === cookiesBefore,
            status: worker.status(),
            crashed,
          });
        }
      }
    }
    const status = worker.status();
    if (!crashed) {
      return this.finishCrash(key, entry, worker, {
        disposition: recovered.disposition,
        reason: recovered.reason,
        login,
        profileDir,
        persistentKept: kept,
        cookiesPreserved,
        status,
        crashed,
      });
    }
    const cookiesLost = cookiesPreserved === false;
    const resumed =
      !cookiesLost &&
      recovered.disposition === "resume" &&
      kept &&
      recovered.status.phase === "RUNNING";
    return this.finishCrash(key, entry, worker, {
      disposition: resumed ? "resume" : "fail",
      reason: cookiesLost
        ? "cookies-lost"
        : resumed
          ? login === "REAUTH_REQUIRED"
            ? "reauth-required"
            : recovered.reason
          : recovered.reason,
      login,
      profileDir,
      persistentKept: kept,
      cookiesPreserved,
      status,
      crashed,
    });
  }

  private finishCrash(
    key: string,
    entry: IndexSlot,
    worker: AccountWorker,
    result: Omit<AccountWorkerCrashRecovery, "tenantId" | "userId"> & { crashed: boolean },
  ): AccountWorkerCrashRecovery {
    this.slots.set(key, {
      tenantId: entry.tenantId,
      userId: entry.userId,
      statePath: entry.statePath,
      worker,
      prewarmed: false,
    });
    if (result.crashed && result.disposition === "resume" && result.persistentKept) {
      this.samples.crashResumeSuccesses += 1;
    }
    return {
      tenantId: entry.tenantId,
      userId: entry.userId,
      disposition: result.disposition,
      reason: result.reason,
      login: result.login,
      profileDir: result.profileDir,
      persistentKept: result.persistentKept,
      cookiesPreserved: result.cookiesPreserved,
      status: result.status,
    };
  }

  private readonly slotTails = new Map<string, Promise<void>>();

  private enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.slotTails.get(key) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    this.slotTails.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private peekScope(body: unknown): { tenantId: string; userId: string } | null {
    try {
      return parseStart(body);
    } catch {
      return null;
    }
  }

  private runningCount(): number {
    let running = 0;
    for (const slot of this.slots.values()) {
      if (slot.worker.status().phase === "RUNNING") {
        running += 1;
      }
    }
    return running;
  }

  private createWorker(statePath: string): AccountWorker {
    return new AccountWorker({
      cfg: this.options.cfg,
      operatorImage: this.options.operatorImage,
      browserImage: this.options.browserImage,
      statePath,
      controlPlane: this.options.controlPlane,
      driver: this.driver,
      now: this.options.now,
      idleAfterMs: this.options.idleAfterMs,
      env: this.options.env,
    });
  }

  private statePathFor(tenantId: string, userId: string): string {
    return path.join(
      this.options.runtimeDir,
      "workers",
      safeSegment(tenantId, "tenantId"),
      safeSegment(userId, "userId"),
      "worker.json",
    );
  }

  private indexPath(): string {
    return path.join(this.options.runtimeDir, "lifecycle.json");
  }

  private async readIndex(): Promise<IndexFile> {
    const parsed = await readJsonFile<IndexFile>(this.indexPath());
    if (!parsed) {
      return { version: 1, slots: {} };
    }
    if (parsed.version !== 1 || !parsed.slots || typeof parsed.slots !== "object") {
      throw new AccountWorkerLifecycleError(
        "account worker lifecycle index is unreadable",
        "unreadable-index",
      );
    }
    return parsed;
  }

  private async writeIndex(): Promise<void> {
    const existing = await this.readIndex();
    const slots = { ...existing.slots };
    for (const [key, slot] of this.slots) {
      slots[key] = {
        tenantId: slot.tenantId,
        userId: slot.userId,
        statePath: slot.statePath,
      };
    }
    await writeJsonAtomic(this.indexPath(), { version: 1, slots } satisfies IndexFile);
  }

  private async persistentKept(status: AccountWorkerStatus): Promise<boolean> {
    const dirs = [
      status.workspaceDir,
      status.artifactsDir,
      status.memoryDir,
      status.browserProfileDir,
    ];
    if (dirs.some((dir) => !dir)) {
      return false;
    }
    for (const dir of dirs) {
      try {
        const stat = await fs.stat(dir ?? "");
        if (!stat.isDirectory()) {
          return false;
        }
      } catch {
        return false;
      }
    }
    return true;
  }

  private layoutOk(status: AccountWorkerStatus): boolean {
    const agentId = normalizeAgentId(status.agentId);
    const { workspaceDir, artifactsDir, memoryDir, browserProfileDir } = status;
    if (!workspaceDir || !artifactsDir || !memoryDir || !browserProfileDir) {
      return false;
    }
    return (
      workspaceDir.endsWith(path.join("OpenBot", "agents", agentId, "workspace")) &&
      artifactsDir.endsWith(path.join("OpenBot", "agents", agentId, "artifacts")) &&
      memoryDir.endsWith(path.join("OpenBot", "memory")) &&
      browserProfileDir.endsWith(path.join("state", "browser"))
    );
  }

  private assertEnabled(): void {
    if (!isAccountWorkerPrototypeEnabled(this.options.cfg, this.options.env ?? process.env)) {
      throw new AccountWorkerLifecycleDisabledError();
    }
  }

  private mark(): number {
    return this.options.elapsed?.() ?? Date.now();
  }

  private browserResult(
    disposition: AccountBrowserCrashResult["disposition"],
    reason: string,
    login: AccountBrowserLogin | null,
    profileDir: string | null,
    previousPid: number | null,
    pid: number | null,
    persistentKept: boolean,
    cookiesPreserved: boolean | null,
  ): AccountBrowserCrashResult {
    return {
      disposition,
      reason,
      login,
      profileDir,
      previousPid,
      pid,
      persistentKept,
      cookiesPreserved,
    };
  }
}

function parseStart(body: unknown): {
  tenantId: string;
  userId: string;
  snapshotVersion: number;
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AccountWorkerLifecycleError(
      "lifecycle acquire requires a start lease",
      "invalid-action",
    );
  }
  const action = (body as { action?: unknown }).action;
  if (action !== "start") {
    throw new AccountWorkerLifecycleError(
      "lifecycle acquire requires a start lease",
      "invalid-action",
    );
  }
  const request = parseRuntimeControllerRequest(body);
  return {
    tenantId: request.tenantId,
    userId: request.userId,
    snapshotVersion: request.snapshotVersion,
  };
}

async function readCookies(profileDir: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(profileDir, COOKIE_FILE), "utf8");
  } catch {
    return null;
  }
}
