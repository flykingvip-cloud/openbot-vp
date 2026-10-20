/**
 * Account Computer v4.1 §10–§11 P3 lifecycle.
 *
 * Warm attach versus cold start, idle process reclaim, and crash recovery.
 * Section 4 data stays. Device-bound credentials come back as REAUTH_REQUIRED.
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
import { ACCOUNT_BROWSER_CONTAINER_DIR } from "./account-mounts.js";
import { createMemoryAccountSandboxDriver } from "./account-worker-driver.js";
import { createAccountWorkerControlPlane } from "./account-worker-gateway.js";
import {
  ACCOUNT_BROWSER_DEVICE_BOUND_FILE,
  AccountWorkerLifecycle,
  AccountWorkerLifecycleDisabledError,
  AccountWorkerLifecycleQuotaError,
  percentile,
} from "./account-worker-lifecycle.js";
import { AccountWorkerFailedError } from "./account-worker.js";
import { resolveSandboxContext } from "./context.js";
import { RuntimeControllerRejectedError } from "./runtime-controller.js";

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

const managedCfg: OpenBotConfig = {
  data: { mode: "managed" },
  agents: {
    defaults: {
      sandbox: {
        mode: "all",
        docker: { image: "openbot-account-sandbox:p3" },
      },
    },
  },
};

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

function baseInput(
  patch?: Partial<IssueAccountRuntimeSnapshotInput>,
): IssueAccountRuntimeSnapshotInput {
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
    ...patch,
  };
}

function requestOf(
  leaseId: string,
  snapshotVersion: number,
  scope?: { tenantId?: string; userId?: string; agentId?: string },
) {
  return {
    action: "start" as const,
    runtimeLeaseId: leaseId,
    tenantId: scope?.tenantId ?? "tenant-a",
    userId: scope?.userId ?? "user-a",
    agentId: scope?.agentId ?? "bot",
    snapshotVersion,
  };
}

async function plant(status: {
  workspaceDir: string | null;
  artifactsDir: string | null;
  memoryDir: string | null;
  browserProfileDir: string | null;
}): Promise<void> {
  await fsp.writeFile(path.join(status.workspaceDir ?? "", "note.txt"), "workspace");
  await fsp.writeFile(path.join(status.artifactsDir ?? "", "file.txt"), "artifact");
  await fsp.writeFile(path.join(status.memoryDir ?? "", "mem.txt"), "memory");
  await fsp.writeFile(path.join(status.browserProfileDir ?? "", "Cookies"), "login-a");
}

async function expectPlanted(status: {
  workspaceDir: string | null;
  artifactsDir: string | null;
  memoryDir: string | null;
  browserProfileDir: string | null;
}): Promise<void> {
  expect(await fsp.readFile(path.join(status.workspaceDir ?? "", "note.txt"), "utf8")).toBe(
    "workspace",
  );
  expect(await fsp.readFile(path.join(status.artifactsDir ?? "", "file.txt"), "utf8")).toBe(
    "artifact",
  );
  expect(await fsp.readFile(path.join(status.memoryDir ?? "", "mem.txt"), "utf8")).toBe("memory");
  expect(await fsp.readFile(path.join(status.browserProfileDir ?? "", "Cookies"), "utf8")).toBe(
    "login-a",
  );
}

describe("account worker lifecycle", () => {
  let prev: Record<string, string | undefined> = {};
  let root = "";

  afterEach(async () => {
    restoreEnv(prev);
    if (root) {
      await fsp.rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  function enableManaged(flagOn: boolean): void {
    prev = saveEnv();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-account-lifecycle-"));
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = root;
    process.env.OPENBOT_STATE_DIR = path.join(root, "operator-state");
    process.env.OPENBOT_ACCOUNT_WORKER_DOCKER = "0";
    if (flagOn) {
      process.env.OPENBOT_ACCOUNT_WORKER = "1";
    } else {
      process.env.OPENBOT_ACCOUNT_WORKER = "0";
    }
  }

  function openLifecycle(params?: { maxRunningWorkers?: number; elapsed?: () => number }) {
    enableManaged(true);
    let leaseSerial = 0;
    const store = new AccountRuntimeSnapshotStore(path.join(root, "snapshots.json"), () => {
      leaseSerial += 1;
      return `lease-${leaseSerial}`;
    });
    const driver = createMemoryAccountSandboxDriver();
    const lifecycle = new AccountWorkerLifecycle({
      cfg: managedCfg,
      operatorImage: "openbot-account-sandbox:p3",
      browserImage: "openclaw-sandbox-browser:bookworm-slim",
      runtimeDir: path.join(root, "runtime"),
      controlPlane: createAccountWorkerControlPlane(store),
      driver,
      now: () => nowMs,
      elapsed: params?.elapsed,
      idleAfterMs: 1_000,
      env: process.env,
      maxRunningWorkers: params?.maxRunningWorkers,
    });
    return { store, driver, lifecycle };
  }

  it("ranks cold-start and warm-attach samples", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
  });

  it("explicit off disables; personal_local is never forced", async () => {
    enableManaged(false);
    const driver = createMemoryAccountSandboxDriver();
    const lifecycle = new AccountWorkerLifecycle({
      cfg: managedCfg,
      operatorImage: "openbot-account-sandbox:p3",
      browserImage: "openclaw-sandbox-browser:bookworm-slim",
      runtimeDir: path.join(root, "runtime"),
      controlPlane: createAccountWorkerControlPlane(
        new AccountRuntimeSnapshotStore(path.join(root, "snapshots.json")),
      ),
      driver,
      env: process.env,
    });
    await expect(lifecycle.acquire(requestOf("lease-1", 1))).rejects.toBeInstanceOf(
      AccountWorkerLifecycleDisabledError,
    );

    process.env.OPENBOT_ACCOUNT_WORKER = "1";
    process.env.OPENBOT_SECURITY_PROFILE = "personal_local";
    await expect(lifecycle.acquire(requestOf("lease-1", 1))).rejects.toBeInstanceOf(
      AccountWorkerLifecycleDisabledError,
    );
    expect(driver.execStarts).toHaveLength(0);
    expect(lifecycle.metrics().coldStartMs).toEqual([]);
  });

  it("cold-starts once, then warm-attaches the same lease", async () => {
    const marks = [10, 30, 40, 55];
    let cursor = 0;
    const { store, driver, lifecycle } = openLifecycle({
      elapsed: () => marks[cursor++] ?? marks[marks.length - 1] ?? 0,
    });
    const issued = await store.issue(baseInput());
    const request = requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion);
    const cold = await lifecycle.acquire(request);
    expect(cold.mode).toBe("cold");
    expect(cold.attachedExistingLease).toBe(false);
    expect(cold.durationMs).toBe(20);
    expect(cold.status.phase).toBe("RUNNING");
    expect(cold.status.gatewayAttached).toBe(false);
    expect(cold.status.snapshotVersion).toBe(issued.snapshot.snapshotVersion);
    expect(cold.status.workspaceDir?.endsWith(path.join("agents", "bot", "workspace"))).toBe(true);
    expect(cold.status.artifactsDir?.endsWith(path.join("agents", "bot", "artifacts"))).toBe(true);
    expect(cold.status.memoryDir?.endsWith(path.join("OpenBot", "memory"))).toBe(true);
    expect(cold.status.browserProfileDir?.endsWith(path.join("state", "browser"))).toBe(true);
    expect(driver.execStarts).toHaveLength(1);
    expect(driver.execStarts[0]?.snapshotVersion).toBe(1);
    expect(
      driver.execStarts[0]?.browserMounts.some(
        (mount) =>
          mount.containerPath === ACCOUNT_BROWSER_CONTAINER_DIR &&
          mount.hostPath === cold.status.browserProfileDir,
      ),
    ).toBe(true);
    expect(
      driver.execStarts[0]?.execMounts.some((mount) =>
        mount.hostPath.endsWith(`${path.sep}memory`),
      ),
    ).toBe(false);

    const other = await store.issue(
      baseInput({
        executionId: "exec-2",
        decisionId: "gd-test-decision-2",
        authorizationVersion: "authz-v2",
      }),
    );
    const warm = await lifecycle.acquire(
      requestOf(other.lease.runtimeLeaseId, other.snapshot.snapshotVersion),
    );
    expect(warm.mode).toBe("warm");
    expect(warm.attachedExistingLease).toBe(true);
    expect(warm.durationMs).toBe(15);
    expect(warm.status.runtimeLeaseId).toBe(issued.lease.runtimeLeaseId);
    expect(warm.status.execContainerName).toBe(cold.status.execContainerName);
    expect(driver.execStarts).toHaveLength(1);
    expect(lifecycle.coldStartPercentile(50)).toBe(20);
    expect(lifecycle.warmAttachPercentile(50)).toBe(15);
    expect(lifecycle.crashResumeSuccessRate()).toBeNull();
  });

  it("prewarm leaves a warm worker for the next acquire", async () => {
    const { store, driver, lifecycle } = openLifecycle();
    const issued = await store.issue(baseInput());
    const request = requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion);
    const warmed = await lifecycle.prewarm(request);
    expect(warmed.mode).toBe("cold");
    expect(warmed.prewarmed).toBe(true);
    const hit = await lifecycle.acquire(request);
    expect(hit.mode).toBe("warm");
    expect(hit.fromPrewarm).toBe(true);
    expect(driver.execStarts).toHaveLength(1);
  });

  it("rejects a container spec and a second cold start past the quota", async () => {
    const { store, driver, lifecycle } = openLifecycle({ maxRunningWorkers: 1 });
    const issued = await store.issue(baseInput());
    await expect(
      lifecycle.acquire({
        ...requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion),
        image: "evil:latest",
        hostPath: "/var/host",
      }),
    ).rejects.toBeInstanceOf(RuntimeControllerRejectedError);
    expect(driver.execStarts).toHaveLength(0);

    await lifecycle.acquire(
      requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion),
    );
    const other = await store.issue(
      baseInput({
        userId: "user-b",
        executionId: "exec-b",
        dataSpaceRef: "tenants/tenant-a/users/user-b/OpenBot",
        browserNamespaceRef: "tenants/tenant-a/users/user-b/state/browser",
      }),
    );
    await expect(
      lifecycle.acquire(
        requestOf(other.lease.runtimeLeaseId, other.snapshot.snapshotVersion, { userId: "user-b" }),
      ),
    ).rejects.toBeInstanceOf(AccountWorkerLifecycleQuotaError);
    expect(driver.execStarts).toHaveLength(1);

    const warm = await lifecycle.acquire(
      requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion),
    );
    expect(warm.mode).toBe("warm");
    expect(driver.execStarts).toHaveLength(1);
  });

  it("reclaims idle processes and keeps section 4 data across a later cold start", async () => {
    const { store, driver, lifecycle } = openLifecycle();
    const issued = await store.issue(baseInput());
    const request = requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion);
    const cold = await lifecycle.acquire(request);
    await plant(cold.status);
    const profile = cold.status.browserProfileDir ?? "";
    const startedBrowser = await lifecycle.browse({ tenantId: "tenant-a", userId: "user-a" });
    expect(startedBrowser.profileDir).toBe(profile);
    expect(lifecycle.metrics().browserStartMs).toHaveLength(1);
    expect(lifecycle.metrics().coldStartMs).toHaveLength(1);
    expect(lifecycle.browserStartPercentile(50)).toBe(lifecycle.metrics().browserStartMs[0]);

    const idle = await lifecycle.reclaimIdle(nowMs + 5_000);
    expect(idle.reclaimed).toHaveLength(1);
    expect(idle.reclaimed[0]?.browserProfileDir).toBe(profile);
    expect(await fsp.readFile(path.join(profile, "Cookies"), "utf8")).toBe("login-a");
    await expectPlanted(cold.status);
    expect(driver.stoppedBrowsers).toEqual([startedBrowser?.pid]);

    const again = await lifecycle.acquire(request);
    expect(again.mode).toBe("cold");
    expect(again.status.phase).toBe("RUNNING");
    expect(again.status.browserProfileDir).toBe(profile);
    expect(again.status.execContainerName).toBe(cold.status.execContainerName);
    expect(driver.stoppedExec).toEqual([cold.status.execContainerName]);
    expect(driver.execStarts).toHaveLength(2);
    await expectPlanted(again.status);
    expect(again.status.browserPid).toBeNull();
  });

  it("relaunches a crashed browser on the same profile and reports device-bound reauth", async () => {
    const { store, driver, lifecycle } = openLifecycle();
    const issued = await store.issue(baseInput());
    const cold = await lifecycle.acquire(
      requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion),
    );
    await plant(cold.status);
    const first = await lifecycle.browse({ tenantId: "tenant-a", userId: "user-a" });
    expect(first.pid).toBe(1);

    const alive = await lifecycle.recoverBrowserCrash({ tenantId: "tenant-a", userId: "user-a" });
    expect(alive.disposition).toBe("unchanged");
    expect(alive.reason).toBe("browser-alive");
    expect(lifecycle.metrics().crashResumeAttempts).toBe(0);

    driver.crashBrowser(first.pid);
    const resumed = await lifecycle.recoverBrowserCrash({
      tenantId: "tenant-a",
      userId: "user-a",
    });
    expect(resumed.disposition).toBe("resume");
    expect(resumed.reason).toBe("resumed");
    expect(resumed.login).toBe("READY");
    expect(resumed.pid).not.toBe(first.pid);
    expect(resumed.profileDir).toBe(first.profileDir);
    expect(resumed.cookiesPreserved).toBe(true);
    expect(resumed.persistentKept).toBe(true);
    await expectPlanted(cold.status);

    await fsp.writeFile(path.join(first.profileDir, ACCOUNT_BROWSER_DEVICE_BOUND_FILE), "webauthn");
    driver.crashBrowser(resumed.pid ?? 0);
    const reauth = await lifecycle.recoverBrowserCrash({ tenantId: "tenant-a", userId: "user-a" });
    expect(reauth.disposition).toBe("resume");
    expect(reauth.reason).toBe("reauth-required");
    expect(reauth.login).toBe("REAUTH_REQUIRED");
    expect(reauth.profileDir).toBe(first.profileDir);
    expect(reauth.cookiesPreserved).toBe(true);
    expect(await fsp.readFile(path.join(first.profileDir, "Cookies"), "utf8")).toBe("login-a");
    expect(lifecycle.crashResumeSuccessRate()).toBe(1);
  });

  it("resumes a crashed worker on the same profile or fails the lease explicitly", async () => {
    const { store, driver, lifecycle } = openLifecycle();
    const issued = await store.issue(baseInput());
    const cold = await lifecycle.acquire(
      requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion),
    );
    await plant(cold.status);
    await lifecycle.browse({ tenantId: "tenant-a", userId: "user-a" });

    const crashedDriver = createMemoryAccountSandboxDriver();
    const crashed = new AccountWorkerLifecycle({
      cfg: managedCfg,
      operatorImage: "openbot-account-sandbox:p3",
      browserImage: "openclaw-sandbox-browser:bookworm-slim",
      runtimeDir: path.join(root, "runtime"),
      controlPlane: createAccountWorkerControlPlane(store),
      driver: crashedDriver,
      now: () => nowMs,
      idleAfterMs: 1_000,
      env: process.env,
    });
    const [resumed] = await crashed.recoverWorkerCrash();
    expect(resumed?.disposition).toBe("resume");
    expect(resumed?.reason).toBe("resumed");
    expect(resumed?.login).toBe("READY");
    expect(resumed?.persistentKept).toBe(true);
    expect(resumed?.cookiesPreserved).toBe(true);
    expect(resumed?.status?.phase).toBe("RUNNING");
    expect(resumed?.status?.gatewayAttached).toBe(false);
    expect(resumed?.profileDir).toBe(cold.status.browserProfileDir);
    expect(resumed?.status?.browserPid).not.toBeNull();
    await expectPlanted(cold.status);
    expect(crashed.crashResumeSuccessRate()).toBe(1);
    expect(driver.execStarts).toHaveLength(1);
    expect(crashedDriver.execStarts).toHaveLength(1);
    expect(crashedDriver.browserStarts).toHaveLength(1);

    await store.revoke({
      tenantId: "tenant-a",
      userId: "user-a",
      executionId: "exec-1",
      nowIso: "2026-10-06T00:07:00.000Z",
    });
    const afterRevoke = new AccountWorkerLifecycle({
      cfg: managedCfg,
      operatorImage: "openbot-account-sandbox:p3",
      browserImage: "openclaw-sandbox-browser:bookworm-slim",
      runtimeDir: path.join(root, "runtime"),
      controlPlane: createAccountWorkerControlPlane(store),
      driver: createMemoryAccountSandboxDriver(),
      now: () => nowMs,
      env: process.env,
    });
    const [failed] = await afterRevoke.recoverWorkerCrash();
    expect(failed?.disposition).toBe("fail");
    expect(failed?.reason).toBe("revoked");
    expect(failed?.persistentKept).toBe(true);
    await expectPlanted(cold.status);
    expect(afterRevoke.crashResumeSuccessRate()).toBe(0);
  });

  it("does not count an idle stop as a crash and still keeps the files", async () => {
    const { store, lifecycle } = openLifecycle();
    const issued = await store.issue(baseInput());
    const cold = await lifecycle.acquire(
      requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion),
    );
    await plant(cold.status);
    await lifecycle.reclaimIdle(nowMs + 5_000);
    const restarted = new AccountWorkerLifecycle({
      cfg: managedCfg,
      operatorImage: "openbot-account-sandbox:p3",
      browserImage: "openclaw-sandbox-browser:bookworm-slim",
      runtimeDir: path.join(root, "runtime"),
      controlPlane: createAccountWorkerControlPlane(store),
      now: () => nowMs,
      env: process.env,
    });
    const [stopped] = await restarted.recoverWorkerCrash();
    expect(stopped?.disposition).toBe("resume");
    expect(stopped?.reason).toBe("already-stopped");
    expect(stopped?.persistentKept).toBe(true);
    expect(restarted.metrics().crashResumeAttempts).toBe(0);
    await expectPlanted(cold.status);
  });

  it("fails a revoked warm lease without starting another process", async () => {
    const { store, driver, lifecycle } = openLifecycle();
    const issued = await store.issue(baseInput());
    const cold = await lifecycle.acquire(
      requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion),
    );
    await plant(cold.status);
    await store.revoke({
      tenantId: "tenant-a",
      userId: "user-a",
      executionId: "exec-1",
      nowIso: "2026-10-06T00:06:00.000Z",
    });
    await expect(
      lifecycle.acquire(requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion)),
    ).rejects.toBeInstanceOf(AccountWorkerFailedError);
    expect(driver.execStarts).toHaveLength(1);
    await expectPlanted(cold.status);
  });

  it("routes a second sandbox start through the warm lifecycle", async () => {
    const { store, driver, lifecycle } = openLifecycle();
    const issued = await store.issue(baseInput());
    const request = requestOf(issued.lease.runtimeLeaseId, issued.snapshot.snapshotVersion);
    const start = {
      config: managedCfg,
      sessionKey: "agent:bot:work",
      workspaceDir: path.join(root, "ignored-gateway-workspace"),
      account: { tenantId: "tenant-a", userId: "user-a" },
      accountWorker: {
        request,
        controlPlane: createAccountWorkerControlPlane(store),
        statePath: path.join(root, "unused-worker.json"),
        lifecycle,
        env: process.env,
        now: () => nowMs,
      },
    };
    const first = await resolveSandboxContext(start);
    const second = await resolveSandboxContext(start);
    expect(first?.containerName).toBe("aw-exec-lease-1");
    expect(second?.containerName).toBe(first?.containerName);
    expect(driver.execStarts).toHaveLength(1);
    expect(second?.workspaceDir).toBe(first?.workspaceDir);
  });

  it("keeps billing, docker, and profile migration out of the lifecycle", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, "account-worker-lifecycle.ts"), "utf8");
    expect(source).not.toMatch(
      /account-runtime-charge-authority|credit-reservation|agent-run-registry|from "\.\/docker\.js"|execDocker|exportSingleOwnerBrowserProfile|src\/account-computer/,
    );
    // src/account-computer may exist on tip; lifecycle must not import it (regex above).
  });
});
