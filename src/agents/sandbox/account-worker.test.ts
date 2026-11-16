import { vi } from "vitest";
vi.mock("../../gateway/workspace-resolver/execution-workspace.js", () => ({
  resolveExecutionWorkspace: vi.fn(async () => null),
}));
/**
 * Account Computer v4.1 §10–§11 single-account worker prototype.
 *
 * Start, stop, browse, download into agent artifacts, and restart resume or
 * explicit failure. The gateway request cannot carry a container spec.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import { AccountRuntimeSnapshotStore } from "../../gateway/governance/account-runtime-snapshot.js";
import type { IssueAccountRuntimeSnapshotInput } from "../../gateway/governance/account-runtime-snapshot.js";
import { resolveExecutionWorkspace } from "../../gateway/workspace-resolver/execution-workspace.js";
import {
  readAccountComputerPreview,
  resetAccountComputerSlotsForTests,
} from "./account-computer-stream.js";
import { buildAccountSandboxMountPlan } from "./account-mounts.js";
import { resolveSharedAccountMountDirs } from "./account-shared-mounts.js";
import { setAccountWorkerBrowserControlAttacherForTests } from "./account-worker-browser-bridge.js";
import {
  buildAccountWorkerContainerArgs,
  createMemoryAccountSandboxDriver,
} from "./account-worker-driver.js";
import {
  createAccountWorkerControlPlane,
  isAccountWorkerPrototypeEnabled,
} from "./account-worker-gateway.js";
import {
  AccountWorker,
  AccountWorkerFailedError,
  type AccountWorkerPhase,
} from "./account-worker.js";
import { resolveSandboxContext } from "./context.js";
import { DockerCliMissingError } from "./docker-engine-client.js";
import { RuntimeControllerRejectedError } from "./runtime-controller.js";
import { isToolAllowed } from "./tool-policy.js";

const issuedAt = "2026-10-06T00:00:00.000Z";
const expiresAt = "2026-10-06T00:30:00.000Z";
const nowMs = Date.parse("2026-10-06T00:05:00.000Z");

const ENV_KEYS = [
  "OPENBOT_DATA_MODE",
  "OPENBOT_MULTITENANT",
  "OPENBOT_TENANTS_ROOT",
  "OPENBOT_STATE_DIR",
  "OPENBOT_ACCOUNT_WORKER",
  "OPENBOT_ACCOUNT_WORKER_DOCKER",
  "OPENBOT_SECURITY_PROFILE",
] as const;

function saveEnv(): Record<string, string | undefined> {
  const prev: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    prev[key] = process.env[key];
  }
  return prev;
}

function restoreEnv(prev: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function baseInput(): IssueAccountRuntimeSnapshotInput {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    agentId: "bot",
    executionId: "exec-1",
    decisionId: "gd-test-decision",
    authorizationVersion: "authz-v1",
    dataSpaceRef: "tenants/tenant-a/users/user-a/OpenBot",
    browserNamespaceRef: "tenants/tenant-a/users/user-a/state/browser",
    modelEntitlement: { allowlist: ["openai/gpt"] },
    capabilityDecision: { effect: "allow" },
    commercialLimits: { creditsRemaining: 5 },
    concurrencyLimits: { maxConcurrentRuns: 2, activeCount: 1 },
    policyVersion: "policy-1",
    issuedAt,
    expiresAt,
  };
}

function requestOf(leaseId: string, snapshotVersion: number) {
  return {
    action: "start" as const,
    runtimeLeaseId: leaseId,
    tenantId: "tenant-a",
    userId: "user-a",
    agentId: "bot",
    snapshotVersion,
  };
}

const managedCfg: OpenBotConfig = {
  data: { mode: "managed" },
  agents: {
    defaults: {
      sandbox: {
        mode: "all",
        docker: { image: "openbot-account-sandbox:p2" },
      },
    },
  },
};

describe("account worker prototype", () => {
  let prev: Record<string, string | undefined> = {};
  let root = "";

  afterEach(async () => {
    setAccountWorkerBrowserControlAttacherForTests(null);
    resetAccountComputerSlotsForTests();
    restoreEnv(prev);
    if (root) {
      await fsp.rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  function enableManaged(workerFlag: boolean): void {
    prev = saveEnv();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-account-worker-"));
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = root;
    process.env.OPENBOT_STATE_DIR = path.join(root, "operator-state");
    // Memory-driver unit path: keep docker flag explicitly off (P6b unset→ON).
    process.env.OPENBOT_ACCOUNT_WORKER_DOCKER = "0";
    if (workerFlag) {
      process.env.OPENBOT_ACCOUNT_WORKER = "1";
    } else {
      // P6b: unset defaults ON — explicit off for disabled cases.
      process.env.OPENBOT_ACCOUNT_WORKER = "0";
    }
  }

  async function issuedWorker(params?: { onPhase?: (phase: AccountWorkerPhase) => void }) {
    enableManaged(true);
    let leaseSequence = 0;
    const store = new AccountRuntimeSnapshotStore(
      path.join(root, "snapshots.json"),
      () => `lease-${++leaseSequence}`,
    );
    const issued = await store.issue(baseInput());
    const driver = createMemoryAccountSandboxDriver();
    const phases: AccountWorkerPhase[] = [];
    const worker = new AccountWorker({
      cfg: managedCfg,
      operatorImage: "openbot-account-sandbox:p2",
      browserImage: "openclaw-sandbox-browser:trixie",
      statePath: path.join(root, "worker.json"),
      controlPlane: createAccountWorkerControlPlane(store),
      driver,
      now: () => nowMs,
      idleAfterMs: 1_000,
      env: process.env,
      onPhase: (phase) => {
        phases.push(phase);
        params?.onPhase?.(phase);
      },
    });
    return { store, issued, driver, worker, phases };
  }

  it("P6b: defaults on for managed_enterprise; personal_local stays off; explicit 0 rolls back", () => {
    expect(isAccountWorkerPrototypeEnabled(undefined, {})).toBe(false);
    expect(
      isAccountWorkerPrototypeEnabled(
        { data: { mode: "local" } },
        { OPENBOT_ACCOUNT_WORKER: "1", OPENBOT_SECURITY_PROFILE: "personal_local" },
      ),
    ).toBe(false);
    expect(
      isAccountWorkerPrototypeEnabled(
        { data: { mode: "managed" } },
        {
          OPENBOT_ACCOUNT_WORKER: "1",
          OPENBOT_DATA_MODE: "managed",
          OPENBOT_MULTITENANT: "1",
          OPENBOT_SECURITY_PROFILE: "personal_local",
        },
      ),
    ).toBe(false);
    // Unset flag + managed multitenant → default ON (P6b).
    expect(
      isAccountWorkerPrototypeEnabled(
        { data: { mode: "managed" } },
        {
          OPENBOT_DATA_MODE: "managed",
          OPENBOT_MULTITENANT: "1",
        },
      ),
    ).toBe(true);
    expect(
      isAccountWorkerPrototypeEnabled(
        { data: { mode: "managed" } },
        {
          OPENBOT_DATA_MODE: "managed",
          OPENBOT_MULTITENANT: "1",
          OPENBOT_ACCOUNT_WORKER: "0",
        },
      ),
    ).toBe(false);
  });

  it("mounts a server-resolved canonical root and remounts exec without restarting browser", async () => {
    const { worker, driver, issued } = await issuedWorker();
    const firstRoot = path.join(root, "canonical-one");
    const secondRoot = path.join(root, "canonical-two");
    await fsp.mkdir(firstRoot);
    await fsp.mkdir(secondRoot);
    const resolved = vi.mocked(resolveExecutionWorkspace);
    resolved.mockResolvedValue({ rootPath: firstRoot } as Awaited<
      ReturnType<typeof resolveExecutionWorkspace>
    >);
    const request = requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion);
    await worker.start(request);
    expect(
      driver.execStarts[0]?.execMounts.find((m) => m.containerPath === "/account/workspace")
        ?.hostPath,
    ).toBe(firstRoot);
    const browser = await worker.browse();
    resolved.mockResolvedValue({ rootPath: secondRoot } as Awaited<
      ReturnType<typeof resolveExecutionWorkspace>
    >);
    await worker.attachIncoming(request);
    expect(
      driver.execStarts[1]?.execMounts.find((m) => m.containerPath === "/account/workspace")
        ?.hostPath,
    ).toBe(secondRoot);
    expect(driver.stoppedExec).toContain("aw-exec-lease-1");
    expect((await worker.browse()).pid).toBe(browser.pid);
    resolved.mockResolvedValue(null);
  });

  it("uses only the server snapshot group scope and rejects unavailable group binding", async () => {
    const { worker, driver, store, issued } = await issuedWorker();
    const resolved = vi.mocked(resolveExecutionWorkspace);
    const personal = path.join(root, "personal");
    const group = path.join(root, "group");
    await fsp.mkdir(personal);
    await fsp.mkdir(group);
    resolved.mockResolvedValue({ rootPath: personal } as Awaited<
      ReturnType<typeof resolveExecutionWorkspace>
    >);
    await worker.start(requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion));
    const browser = await worker.browse();
    const grouped = await store.issue({
      ...baseInput(),
      executionId: "exec-group",
      collaborationGroupId: "trusted-group",
    });
    resolved.mockResolvedValue({ rootPath: group } as Awaited<
      ReturnType<typeof resolveExecutionWorkspace>
    >);
    await expect(
      worker.attachIncoming({
        ...requestOf(grouped.lease.runtimeLeaseId, grouped.snapshot.snapshotVersion),
        collaborationGroupId: "forged-group",
      }),
    ).rejects.toThrow("cannot pass collaborationGroupId");
    await worker.attachIncoming(
      requestOf(grouped.lease.runtimeLeaseId, grouped.snapshot.snapshotVersion),
    );
    expect(resolved).toHaveBeenLastCalledWith(
      expect.objectContaining({ groupId: "trusted-group" }),
    );
    expect(
      driver.execStarts[1]?.execMounts.find((m) => m.containerPath === "/account/workspace")
        ?.hostPath,
    ).toBe(group);
    expect((await worker.browse()).pid).toBe(browser.pid);
    resolved.mockRejectedValueOnce(new Error("workspace_binding_required:binding_unplaced"));
    await expect(
      worker.attachIncoming(
        requestOf(grouped.lease.runtimeLeaseId, grouped.snapshot.snapshotVersion),
      ),
    ).rejects.toThrow("binding_unplaced");
    expect(driver.execStarts).toHaveLength(2);
    resolved.mockResolvedValue(null);
  });

  it("starts and stops through the lifecycle without attaching a gateway", async () => {
    const { worker, driver, issued, phases } = await issuedWorker();
    const running = await worker.start(
      requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion),
    );
    expect(running.phase).toBe("RUNNING");
    expect(running.gatewayAttached).toBe(false);
    expect(running.execContainerName).toBe("aw-exec-lease-1");
    expect(phases).toEqual(["STARTING", "RUNNING"]);
    expect(driver.execStarts).toHaveLength(1);
    expect(driver.execStarts[0]?.image).toBe("openbot-account-sandbox:p2");

    const again = await worker.start(
      requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion),
    );
    expect(again.phase).toBe("RUNNING");
    expect(driver.execStarts).toHaveLength(1);

    const stopped = await worker.stop();
    expect(stopped.phase).toBe("STOPPED");
    expect(stopped.execContainerName).toBeNull();
    expect(phases).toEqual(["STARTING", "RUNNING", "DRAINING", "STOPPING", "STOPPED"]);
    expect(driver.stoppedExec).toEqual(["aw-exec-lease-1"]);
    await expect(fsp.stat(running.workspaceDir ?? "")).resolves.toBeTruthy();
    await expect(fsp.stat(running.artifactsDir ?? "")).resolves.toBeTruthy();
    await expect(fsp.stat(running.memoryDir ?? "")).resolves.toBeTruthy();
    await expect(fsp.stat(running.browserProfileDir ?? "")).resolves.toBeTruthy();
  });

  it("rejects an illegal start body before the sandbox driver runs", async () => {
    const { worker, driver } = await issuedWorker();
    const illegal = {
      ...requestOf("lease-1", 1),
      image: "evil:latest",
      mounts: ["/tmp:/tmp"],
      hostPath: "/var/host",
      docker: { privileged: true },
    };
    await expect(worker.start(illegal)).rejects.toBeInstanceOf(RuntimeControllerRejectedError);
    expect(worker.status().phase).toBe("STOPPED");
    expect(driver.execStarts).toHaveLength(0);
    expect(driver.browserStarts).toHaveLength(0);
  });

  it("fails a revoked lease from STARTING to FAILED to STOPPED", async () => {
    const { worker, store, driver, phases } = await issuedWorker();
    await store.revoke({
      tenantId: "tenant-a",
      userId: "user-a",
      executionId: "exec-1",
      nowIso: "2026-10-06T00:06:00.000Z",
    });
    await expect(worker.start(requestOf("lease-1", 2))).rejects.toBeInstanceOf(
      AccountWorkerFailedError,
    );
    expect(worker.status().phase).toBe("STOPPED");
    expect(worker.status().lastFailure).toMatch(/revoked/);
    expect(phases).toEqual(["STARTING", "FAILED", "STOPPED"]);
    expect(driver.execStarts).toHaveLength(0);
  });

  it("browses on one profile and keeps that profile after the process is reclaimed", async () => {
    const { worker, issued } = await issuedWorker();
    await worker.start(requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion));
    const first = await worker.browse();
    const second = await worker.browse();
    expect(second.pid).toBe(first.pid);
    expect(second.profileDir).toBe(first.profileDir);
    expect(first.profileDir.endsWith(`${path.sep}state${path.sep}browser`)).toBe(true);
    await fsp.writeFile(path.join(first.profileDir, "Cookies"), "a-login");

    const idle = await worker.reclaimIfIdle(nowMs + 5_000);
    expect(idle.reclaimed).toBe(true);
    expect(idle.status.phase).toBe("STOPPED");
    expect(idle.status.browserPid).toBeNull();
    expect(await fsp.readFile(path.join(first.profileDir, "Cookies"), "utf8")).toBe("a-login");

    await worker.start(requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion));
    const restarted = await worker.browse();
    expect(restarted.pid).not.toBe(first.pid);
    expect(restarted.profileDir).toBe(first.profileDir);
    expect(await fsp.readFile(path.join(restarted.profileDir, "Cookies"), "utf8")).toBe("a-login");
  });

  it("recreates a browser that exited while the worker journal still says RUNNING", async () => {
    const { worker, driver, issued } = await issuedWorker();
    await worker.start(requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion));
    const first = await worker.browse();
    driver.crashBrowser(first.pid);
    const replaced = await worker.browse();
    expect(replaced.pid).not.toBe(first.pid);
    expect(replaced.containerName).not.toBe("");
    expect(replaced.profileDir).toBe(first.profileDir);
    expect(worker.status().phase).toBe("RUNNING");
    expect(worker.status().browserPid).toBe(replaced.pid);
    expect(worker.status().lastFailure).toBeNull();
  });

  it("lands a browser download in the agent artifacts directory", async () => {
    const { worker, issued } = await issuedWorker();
    const running = await worker.start(
      requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion),
    );
    const tempDir = path.join(root, "ephemeral");
    await fsp.mkdir(tempDir);
    const source = path.join(tempDir, "report.txt");
    await fsp.writeFile(source, "downloaded");
    const destination = await worker.acceptDownload({ sourcePath: source, fileName: "report.txt" });
    expect(destination).toBe(path.join(running.artifactsDir ?? "", "report.txt"));
    expect(await fsp.readFile(destination, "utf8")).toBe("downloaded");
    await expect(fsp.stat(source)).rejects.toThrow();
    await expect(
      worker.acceptDownload({ sourcePath: destination, fileName: "../secret.txt" }),
    ).rejects.toBeInstanceOf(AccountWorkerFailedError);

    await worker.reclaimIfIdle(nowMs + 5_000);
    expect(await fsp.readFile(destination, "utf8")).toBe("downloaded");
    expect(worker.status().phase).toBe("STOPPED");
  });

  it("resumes a running worker after process restart, or fails explicitly when revoked", async () => {
    const { worker, store, issued } = await issuedWorker();
    await worker.start(requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion));
    const browsed = await worker.browse();
    await fsp.writeFile(path.join(browsed.profileDir, "Cookies"), "still-here");
    const memoryFile = path.join(worker.status().memoryDir ?? "", "note.txt");
    await fsp.writeFile(memoryFile, "kept");

    const restarted = new AccountWorker({
      cfg: managedCfg,
      operatorImage: "openbot-account-sandbox:p2",
      browserImage: "openclaw-sandbox-browser:trixie",
      statePath: path.join(root, "worker.json"),
      controlPlane: createAccountWorkerControlPlane(store),
      driver: createMemoryAccountSandboxDriver(),
      now: () => nowMs,
      env: process.env,
    });
    const resumed = await restarted.recover();
    expect(resumed.disposition).toBe("resume");
    expect(resumed.reason).toBe("resumed");
    expect(resumed.status.phase).toBe("RUNNING");
    expect(resumed.status.browserPid).toBeNull();
    expect(resumed.status.gatewayAttached).toBe(false);
    const again = await restarted.recover();
    expect(again.disposition).toBe("resume");
    expect(again.reason).toBe("already-running");
    const rebrowsed = await restarted.browse();
    expect(rebrowsed.profileDir).toBe(browsed.profileDir);
    expect(rebrowsed.pid).toBe(1);
    expect(await fsp.readFile(path.join(rebrowsed.profileDir, "Cookies"), "utf8")).toBe(
      "still-here",
    );
    expect(await fsp.readFile(memoryFile, "utf8")).toBe("kept");

    await store.revoke({
      tenantId: "tenant-a",
      userId: "user-a",
      executionId: "exec-1",
      nowIso: "2026-10-06T00:07:00.000Z",
    });
    const afterRevoke = new AccountWorker({
      cfg: managedCfg,
      operatorImage: "openbot-account-sandbox:p2",
      browserImage: "openclaw-sandbox-browser:trixie",
      statePath: path.join(root, "worker.json"),
      controlPlane: createAccountWorkerControlPlane(store),
      driver: createMemoryAccountSandboxDriver(),
      now: () => nowMs,
      env: process.env,
    });
    const failed = await afterRevoke.recover();
    expect(failed.disposition).toBe("fail");
    expect(failed.reason).toBe("revoked");
    expect(failed.status.phase).toBe("STOPPED");
    expect(await fsp.readFile(path.join(browsed.profileDir, "Cookies"), "utf8")).toBe("still-here");
    expect(await fsp.readFile(memoryFile, "utf8")).toBe("kept");
  });

  it("does not treat a missing worker journal as an allow", async () => {
    enableManaged(true);
    const store = new AccountRuntimeSnapshotStore(path.join(root, "snapshots.json"));
    const worker = new AccountWorker({
      cfg: managedCfg,
      operatorImage: "openbot-account-sandbox:p2",
      browserImage: "openclaw-sandbox-browser:trixie",
      statePath: path.join(root, "missing-worker.json"),
      controlPlane: createAccountWorkerControlPlane(store),
      now: () => nowMs,
      env: process.env,
    });
    const recovered = await worker.recover();
    expect(recovered.disposition).toBe("fail");
    expect(recovered.reason).toBe("missing-worker");
    expect(recovered.status.phase).toBe("STOPPED");
  });

  it("routes the production sandbox path through the controller when the flag is on", async () => {
    enableManaged(true);
    const store = new AccountRuntimeSnapshotStore(
      path.join(root, "snapshots.json"),
      () => "lease-prod",
    );
    const issued = await store.issue(baseInput());
    const driver = createMemoryAccountSandboxDriver();
    const context = await resolveSandboxContext({
      config: managedCfg,
      sessionKey: "agent:bot:work",
      workspaceDir: path.join(root, "ignored-gateway-workspace"),
      account: { tenantId: "tenant-a", userId: "user-a" },
      accountWorker: {
        request: requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion),
        controlPlane: createAccountWorkerControlPlane(store),
        statePath: path.join(root, "worker.json"),
        driver,
        now: () => nowMs,
        env: process.env,
      },
    });
    expect(context?.enabled).toBe(true);
    expect(context?.containerName).toBe("aw-exec-lease-prod");
    expect(context?.browserAllowHostControl).toBe(false);
    expect(context?.accountComputerBrowser).toBeUndefined();
    expect(isToolAllowed(context?.tools ?? {}, "browser")).toBe(false);
    expect(context?.workspaceDir).toContain(
      `${path.sep}operators${path.sep}user-a${path.sep}OpenBot${path.sep}`,
    );
    expect(
      context?.workspaceDir.endsWith(`${path.sep}agents${path.sep}bot${path.sep}workspace`),
    ).toBe(true);
    expect(driver.execStarts).toHaveLength(1);
    expect(driver.execStarts[0]?.image).toBe("openbot-account-sandbox:p2");
    const shared = resolveSharedAccountMountDirs(managedCfg);
    const plan = buildAccountSandboxMountPlan({
      workspaceDir: context?.workspaceDir ?? "",
      artifactsDir: path.join(path.dirname(context?.workspaceDir ?? ""), "artifacts"),
      browserProfileDir: path.join(
        root,
        "operator-state",
        "operators",
        "user-a",
        "state",
        "browser",
      ),
      sharedSkillsDir: shared.sharedSkillsDir,
      sharedCanvasDir: shared.sharedCanvasDir,
    });
    expect(driver.execStarts[0]?.execMounts).toEqual(plan.exec);
    expect(
      driver.execStarts[0]?.browserMounts.map((mount) => mount.containerPath).toSorted(),
    ).toEqual(plan.browser.map((mount) => mount.containerPath).toSorted());
    expect(
      driver.execStarts[0]?.execMounts.some((mount) =>
        mount.hostPath.includes(`${path.sep}agent${path.sep}`),
      ),
    ).toBe(false);

    const rejected = createMemoryAccountSandboxDriver();
    await expect(
      resolveSandboxContext({
        config: managedCfg,
        sessionKey: "agent:bot:work",
        workspaceDir: path.join(root, "ignored-gateway-workspace"),
        account: { tenantId: "tenant-a", userId: "user-a" },
        accountWorker: {
          request: {
            ...requestOf("lease-prod", issued.snapshot.snapshotVersion),
            image: "evil:latest",
          },
          controlPlane: createAccountWorkerControlPlane(store),
          statePath: path.join(root, "worker-rejected.json"),
          driver: rejected,
          now: () => nowMs,
          env: process.env,
        },
      }),
    ).rejects.toBeInstanceOf(RuntimeControllerRejectedError);
    expect(rejected.execStarts).toHaveLength(0);

    await expect(
      resolveSandboxContext({
        config: managedCfg,
        sessionKey: "agent:bot:work",
        workspaceDir: path.join(root, "ignored-gateway-workspace"),
        account: { tenantId: "tenant-a", userId: "user-a" },
      }),
    ).rejects.toThrow(/gateway docker driver/);
  });

  it("grants Account Computer browser control when a bridge is attached", async () => {
    enableManaged(true);
    const store = new AccountRuntimeSnapshotStore(
      path.join(root, "snapshots.json"),
      () => "lease-bridge",
    );
    const issued = await store.issue(baseInput());
    const driver = createMemoryAccountSandboxDriver();
    setAccountWorkerBrowserControlAttacherForTests(async () => ({
      bridgeUrl: "http://127.0.0.1:18792",
      containerName: "aw-browser-lease-bridge",
    }));
    const context = await resolveSandboxContext({
      config: managedCfg,
      sessionKey: "agent:bot:work",
      workspaceDir: path.join(root, "ignored-gateway-workspace"),
      account: { tenantId: "tenant-a", userId: "user-a" },
      accountWorker: {
        request: requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion),
        controlPlane: createAccountWorkerControlPlane(store),
        statePath: path.join(root, "worker.json"),
        driver,
        now: () => nowMs,
        env: process.env,
      },
    });
    expect(context?.browserAllowHostControl).toBe(false);
    expect(context?.accountComputerBrowser).toBe(true);
    expect(context?.browser?.bridgeUrl).toBe("http://127.0.0.1:18792");
    expect(isToolAllowed(context?.tools ?? {}, "browser")).toBe(true);
    expect(isToolAllowed(context?.tools ?? {}, "gateway")).toBe(false);
    expect(driver.browserStarts).toHaveLength(1);
  });

  it("does not attach browser control when sandbox deny explicitly lists browser", async () => {
    enableManaged(true);
    const store = new AccountRuntimeSnapshotStore(
      path.join(root, "snapshots.json"),
      () => "lease-denied",
    );
    const issued = await store.issue(baseInput());
    const driver = createMemoryAccountSandboxDriver();
    let calls = 0;
    setAccountWorkerBrowserControlAttacherForTests(async () => {
      calls += 1;
      return {
        bridgeUrl: "http://127.0.0.1:18792",
        containerName: "aw-browser-lease-denied",
      };
    });
    const context = await resolveSandboxContext({
      config: {
        ...managedCfg,
        tools: { sandbox: { tools: { deny: ["browser"] } } },
      },
      sessionKey: "agent:bot:work",
      workspaceDir: path.join(root, "ignored-gateway-workspace"),
      account: { tenantId: "tenant-a", userId: "user-a" },
      accountWorker: {
        request: requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion),
        controlPlane: createAccountWorkerControlPlane(store),
        statePath: path.join(root, "worker.json"),
        driver,
        now: () => nowMs,
        env: process.env,
      },
    });
    expect(calls).toBe(0);
    expect(context?.accountComputerBrowser).toBeUndefined();
    expect(context?.accountComputerAttachFailure).toBeUndefined();
    expect(context?.browserAllowHostControl).toBe(false);
    expect(isToolAllowed(context?.tools ?? {}, "browser")).toBe(false);
  });

  it("records an attach failure when the browser lease has no CDP bridge", async () => {
    enableManaged(true);
    const store = new AccountRuntimeSnapshotStore(
      path.join(root, "snapshots.json"),
      () => "lease-cold",
    );
    const issued = await store.issue(baseInput());
    const driver = createMemoryAccountSandboxDriver();
    setAccountWorkerBrowserControlAttacherForTests(async () => null);
    const context = await resolveSandboxContext({
      config: managedCfg,
      sessionKey: "agent:bot:work",
      workspaceDir: path.join(root, "ignored-gateway-workspace"),
      account: { tenantId: "tenant-a", userId: "user-a" },
      accountWorker: {
        request: requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion),
        controlPlane: createAccountWorkerControlPlane(store),
        statePath: path.join(root, "worker.json"),
        driver,
        now: () => nowMs,
        env: process.env,
      },
    });
    expect(context?.accountComputerBrowser).toBeUndefined();
    expect(context?.accountComputerAttachFailure).toBe("CDP port not published");
    expect(context?.browserAllowHostControl).toBe(false);
    expect(isToolAllowed(context?.tools ?? {}, "browser")).toBe(false);
  });

  it("keeps the turn on the host when docker CLI and socket are both missing", async () => {
    enableManaged(true);
    const store = new AccountRuntimeSnapshotStore(
      path.join(root, "snapshots.json"),
      () => "lease-cli",
    );
    const issued = await store.issue(baseInput());
    const driver = createMemoryAccountSandboxDriver();
    driver.startExec = async () => {
      throw new DockerCliMissingError();
    };
    const context = await resolveSandboxContext({
      config: managedCfg,
      sessionKey: "agent:bot:work",
      workspaceDir: path.join(root, "ignored-gateway-workspace"),
      account: { tenantId: "tenant-a", userId: "user-a" },
      accountWorker: {
        request: requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion),
        controlPlane: createAccountWorkerControlPlane(store),
        statePath: path.join(root, "worker.json"),
        driver,
        now: () => nowMs,
        env: process.env,
      },
    });
    expect(context).toBeNull();
    const preview = readAccountComputerPreview({
      tenantId: "tenant-a",
      userId: "user-a",
      issueUrl: false,
    });
    expect(preview.status).toBe("COLD");
    expect(preview.failure).toContain("DOCKER_CLI_MISSING");
  });

  it("shows a docker start failure instead of moving the turn onto the gateway host", async () => {
    enableManaged(true);
    const store = new AccountRuntimeSnapshotStore(
      path.join(root, "snapshots.json"),
      () => "lease-image",
    );
    const issued = await store.issue(baseInput());
    const driver = createMemoryAccountSandboxDriver();
    driver.startExec = async () => {
      throw new Error("docker create failed: image missing");
    };
    await expect(
      resolveSandboxContext({
        config: managedCfg,
        sessionKey: "agent:bot:work",
        workspaceDir: path.join(root, "ignored-gateway-workspace"),
        account: { tenantId: "tenant-a", userId: "user-a" },
        accountWorker: {
          request: requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion),
          controlPlane: createAccountWorkerControlPlane(store),
          statePath: path.join(root, "worker.json"),
          driver,
          now: () => nowMs,
          env: process.env,
        },
      }),
    ).rejects.toThrow(/云电脑没有启动/);
    const preview = readAccountComputerPreview({
      tenantId: "tenant-a",
      userId: "user-a",
      issueUrl: false,
    });
    expect(preview.failure).toContain("docker create failed");
    expect(preview.failure).not.toContain("DOCKER_CLI_MISSING");
  });

  it("builds container args from the controller spec only", () => {
    const spec = {
      runtimeLeaseId: "lease-1",
      snapshotVersion: 1,
      image: "openbot-account-sandbox:p2",
      browserImage: "openclaw-sandbox-browser:trixie",
      execMounts: [
        { hostPath: "/data/workspace", containerPath: "/account/workspace", access: "rw" as const },
        { hostPath: "/data/artifacts", containerPath: "/account/artifacts", access: "rw" as const },
      ],
      browserMounts: [
        { hostPath: "/data/browser", containerPath: "/account/browser", access: "rw" as const },
      ],
    };
    const args = buildAccountWorkerContainerArgs({ spec, kind: "exec", name: "aw-exec-lease-1" });
    expect(args[0]).toBe("create");
    expect(args).toContain("openbot-account-sandbox:p2");
    expect(args.some((arg) => arg.includes("/account/workspace:rw"))).toBe(true);
    expect(args.some((arg) => arg.includes("/account/artifacts:rw"))).toBe(true);
    expect(args).not.toContain("evil:latest");
    expect(args.some((arg) => arg.includes("docker.sock"))).toBe(false);
  });

  it("keeps billing ledgers and the docker CLI out of the worker and gateway switch", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const workerSource = fs.readFileSync(path.join(here, "account-worker.ts"), "utf8");
    const driverSource = fs.readFileSync(path.join(here, "account-worker-driver.ts"), "utf8");
    const gatewaySource = fs.readFileSync(path.join(here, "account-worker-gateway.ts"), "utf8");
    // Worker + gateway switch stay free of the docker CLI and billing authority.
    // The docker driver (worker-side) may call the CLI via an injectable runner.
    expect(workerSource).not.toMatch(
      /account-runtime-charge-authority|credit-reservation|agent-run-registry|enterprise-seat|seat-assets|from "\.\/docker\.js"|execDocker\(/,
    );
    expect(gatewaySource).not.toMatch(/from "\.\/docker\.js"|execDocker|child_process/);
    expect(driverSource).not.toMatch(
      /account-runtime-charge-authority|credit-reservation|agent-run-registry|enterprise-seat|seat-assets/,
    );
    expect(driverSource).toMatch(/createDockerAccountSandboxDriver/);
    expect(driverSource).toMatch(/buildAccountWorkerContainerArgs/);
    // src/account-computer is the browser plan-once module. The worker must not import it.
    expect(workerSource).not.toMatch(/src\/account-computer/);
    expect(workerSource).not.toMatch(/account-computer\/browser-plan-once/);
  });
});
