/**
 * Embedded run acquires an Account Worker handle and passes it into sandbox
 * resolution. Without the handle, Worker ON still refuses the gateway docker driver.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import { AccountRuntimeSnapshotStore } from "../../gateway/governance/account-runtime-snapshot.js";
import { createOpenClawCodingTools } from "../pi-tools.js";
import {
  readAccountComputerPreview,
  resetAccountComputerSlotsForTests,
} from "./account-computer-stream.js";
import {
  createMemoryAccountSandboxDriver,
  resetAccountWorkerBrowserNoVncPasswordsForTests,
} from "./account-worker-driver.js";
import {
  publishAccountWorkerBrowserObserver,
  resetEmbeddedAccountWorkerForTests,
  resolveEmbeddedRunSandboxContextParams,
  setAccountWorkerPreviewReadersForTests,
  setEmbeddedAccountWorkerRuntimeForTests,
} from "./account-worker-embedded.js";
import { createAccountWorkerControlPlane } from "./account-worker-gateway.js";
import { AccountWorkerLifecycle } from "./account-worker-lifecycle.js";
import { resolveSandboxContext } from "./context.js";
import { NOVNC_PASSWORD_ENV_KEY } from "./novnc-auth.js";

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

describe("embedded account worker handle", () => {
  let prev: Record<string, string | undefined> = {};
  let root = "";

  afterEach(async () => {
    resetEmbeddedAccountWorkerForTests();
    resetAccountComputerSlotsForTests();
    resetAccountWorkerBrowserNoVncPasswordsForTests();
    restoreEnv(prev);
    if (root) {
      await fsp.rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  function enableManaged(flagOn: boolean): void {
    prev = saveEnv();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-account-embedded-"));
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = root;
    process.env.OPENBOT_STATE_DIR = path.join(root, "operator-state");
    // P6b: docker defaults ON when unset — keep memory path for embedded unit tests.
    process.env.OPENBOT_ACCOUNT_WORKER_DOCKER = "0";
    delete process.env.OPENBOT_SECURITY_PROFILE;
    if (flagOn) {
      process.env.OPENBOT_ACCOUNT_WORKER = "1";
    } else {
      process.env.OPENBOT_ACCOUNT_WORKER = "0";
    }
  }

  function installRuntime() {
    let leases = 0;
    const store = new AccountRuntimeSnapshotStore(path.join(root, "snapshots.json"), () => {
      leases += 1;
      return `lease-${leases}`;
    });
    const driver = createMemoryAccountSandboxDriver();
    const controlPlane = createAccountWorkerControlPlane(store);
    const lifecycle = new AccountWorkerLifecycle({
      cfg: managedCfg,
      operatorImage: "openbot-account-sandbox:p3",
      browserImage: "openclaw-sandbox-browser:trixie",
      runtimeDir: path.join(root, "runtime"),
      controlPlane,
      driver,
      now: () => nowMs,
      env: process.env,
    });
    setEmbeddedAccountWorkerRuntimeForTests({
      lifecycle,
      store,
      controlPlane,
      runtimeDir: path.join(root, "runtime"),
      now: () => nowMs,
    });
    return { store, driver, lifecycle };
  }

  const runInput = {
    config: managedCfg,
    sessionKey: "agent:bot:main",
    workspaceDir: "",
    agentId: "bot",
    gatewayClientUser: "ada@example.com",
    gatewayClientPlatformUserId: "user-a",
    gatewayClientSessionEnterpriseId: "tenant-a",
  };

  it("keeps the trusted executing member when the shared group session key belongs to main", async () => {
    enableManaged(true);
    installRuntime();
    const resolved = await resolveEmbeddedRunSandboxContextParams({
      ...runInput,
      workspaceDir: root,
      sessionKey: "agent:main:space:group-a",
      agentId: "bot-member",
    });
    expect(resolved.accountWorker?.request).toMatchObject({ agentId: "bot-member" });
    const sandbox = await resolveSandboxContext(resolved);
    expect(sandbox?.workspaceDir).toContain(`${path.sep}bot-member${path.sep}workspace`);
    expect(sandbox?.workspaceDir).not.toContain(`${path.sep}main${path.sep}workspace`);
  });

  it("leaves the gateway docker path unchanged when the worker flag is off", async () => {
    enableManaged(false);
    runInput.workspaceDir = root;
    const resolved = await resolveEmbeddedRunSandboxContextParams(runInput);
    expect(resolved.account).toEqual({ tenantId: "tenant-a", userId: "user-a" });
    expect(resolved.accountWorker).toBeUndefined();
  });

  it("does not acquire a worker when the session is not sandboxed", async () => {
    enableManaged(true);
    const { driver } = installRuntime();
    const resolved = await resolveEmbeddedRunSandboxContextParams({
      ...runInput,
      workspaceDir: root,
      config: { data: { mode: "managed" }, agents: { defaults: { sandbox: { mode: "off" } } } },
    });
    expect(resolved.accountWorker).toBeUndefined();
    expect(driver.execStarts).toHaveLength(0);
    await expect(
      resolveSandboxContext({
        ...resolved,
        workspaceDir: root,
      }),
    ).resolves.toBeNull();
  });

  it("acquires a handle, passes it, and refuses the same account without one", async () => {
    enableManaged(true);
    const { driver } = installRuntime();
    const resolved = await resolveEmbeddedRunSandboxContextParams({
      ...runInput,
      workspaceDir: root,
    });
    const handle = resolved.accountWorker;
    expect(handle).toBeDefined();
    const request = handle?.request as Record<string, unknown>;
    expect(request).toEqual({
      action: "start",
      runtimeLeaseId: "lease-1",
      tenantId: "tenant-a",
      userId: "user-a",
      agentId: "bot",
      snapshotVersion: 1,
    });
    expect(request).not.toHaveProperty("image");
    expect(request).not.toHaveProperty("mounts");
    expect(request).not.toHaveProperty("env");
    expect(JSON.stringify(request)).not.toContain("password");

    const started = await resolveSandboxContext({
      ...resolved,
      workspaceDir: root,
    });
    expect(started?.enabled).toBe(true);
    expect(started?.containerName).toBe("aw-exec-lease-1");
    expect(started?.containerWorkdir).toBe("/account/workspace");
    expect(started?.docker.workdir).toBe("/account/workspace");
    expect(started?.fsBridge).toBeDefined();
    const mapped = started?.fsBridge?.resolvePath({
      filePath: "note.txt",
      cwd: started.workspaceDir,
    });
    expect(mapped?.containerPath).toBe("/account/workspace/note.txt");
    expect(mapped?.hostPath).toBe(path.join(started?.workspaceDir ?? "", "note.txt"));
    expect(started?.browserAllowHostControl).toBe(false);
    expect(started?.browser?.noVncUrl).toBeUndefined();
    expect(driver.execStarts).toHaveLength(1);
    expect(driver.browserStarts).toHaveLength(1);
    expect(driver.execStarts[0]?.image).toBe("openbot-account-sandbox:p3");

    const again = await resolveEmbeddedRunSandboxContextParams({
      ...runInput,
      workspaceDir: root,
    });
    const againRequest = again.accountWorker?.request as { runtimeLeaseId?: string } | undefined;
    expect(againRequest?.runtimeLeaseId).toBe("lease-1");
    const second = await resolveSandboxContext({
      ...again,
      workspaceDir: root,
    });
    expect(second?.containerName).toBe("aw-exec-lease-1");
    expect(driver.execStarts).toHaveLength(1);
    expect(driver.browserStarts).toHaveLength(1);

    await expect(
      resolveSandboxContext({
        config: managedCfg,
        sessionKey: "agent:bot:main",
        workspaceDir: root,
        account: { tenantId: "tenant-a", userId: "user-a" },
      }),
    ).rejects.toThrow(/gateway docker driver/);
  });

  it("publishes a preview slot without putting the noVNC password in the public payload", async () => {
    resetAccountComputerSlotsForTests();
    const published = await publishAccountWorkerBrowserObserver({
      tenantId: "tenant-a",
      userId: "user-a",
      containerName: "aw-browser-lease-1",
      agentLabel: "bot",
      env: { OPENBOT_ACCOUNT_WORKER_DOCKER: "1" },
      readPort: async () => 16080,
      readEnv: async (_container, key) => (key === NOVNC_PASSWORD_ENV_KEY ? "Abc123xy" : null),
    });
    expect(published).toBe(true);
    const preview = readAccountComputerPreview({
      tenantId: "tenant-a",
      userId: "user-a",
      issueUrl: true,
      sessionKey: "agent:bot:main",
    });
    expect(preview.status).toBe("READY");
    expect(preview.streamUrl).toContain("/sandbox/novnc");
    expect(JSON.stringify(preview)).not.toContain("Abc123xy");

    const skipped = await publishAccountWorkerBrowserObserver({
      tenantId: "tenant-a",
      userId: "user-a",
      containerName: "aw-browser-lease-1",
      env: { OPENBOT_ACCOUNT_WORKER_DOCKER: "0" },
      readPort: async () => 16080,
      readEnv: async () => "Abc123xy",
    });
    expect(skipped).toBe(false);
  });

  it("does not fail tool construction on the account worker bridge, and still refuses a sandbox with no bridge", async () => {
    enableManaged(true);
    installRuntime();
    const resolved = await resolveEmbeddedRunSandboxContextParams({
      ...runInput,
      workspaceDir: root,
    });
    const started = await resolveSandboxContext({
      ...resolved,
      workspaceDir: root,
    });
    expect(started?.fsBridge).toBeDefined();
    expect(() =>
      createOpenClawCodingTools({
        config: managedCfg,
        sessionKey: "agent:bot:main",
        workspaceDir: started?.workspaceDir,
        sandbox: started ?? undefined,
      }),
    ).not.toThrow(/Sandbox filesystem bridge is unavailable/);
    expect(() =>
      createOpenClawCodingTools({
        config: managedCfg,
        sessionKey: "agent:bot:main",
        workspaceDir: started?.workspaceDir,
        sandbox: started ? { ...started, fsBridge: undefined } : undefined,
      }),
    ).toThrow(/Sandbox filesystem bridge is unavailable/);
  });

  it("publishes a bindable streamUrl after browse and keeps the noVNC password off the public payload", async () => {
    enableManaged(true);
    process.env.OPENBOT_ACCOUNT_WORKER_DOCKER = "1";
    installRuntime();
    setAccountWorkerPreviewReadersForTests({
      readPort: async () => 59316,
      readEnv: async (_container, key) => (key === NOVNC_PASSWORD_ENV_KEY ? "Abc123xy" : null),
    });
    const resolved = await resolveEmbeddedRunSandboxContextParams({
      ...runInput,
      workspaceDir: root,
    });
    const started = await resolveSandboxContext({
      ...resolved,
      workspaceDir: root,
    });
    expect(started?.fsBridge).toBeDefined();
    expect(JSON.stringify(started?.docker)).not.toContain("Abc123xy");
    const preview = readAccountComputerPreview({
      tenantId: "tenant-a",
      userId: "user-a",
      issueUrl: true,
      sessionKey: "agent:bot:main",
    });
    expect(preview.status).toBe("READY");
    expect(preview.streamUrl).toMatch(/^\/sandbox\/novnc\?token=/);
    expect(JSON.stringify(preview)).not.toContain("Abc123xy");
    expect(JSON.stringify(preview)).not.toContain("password");
  });

  it("keeps the filesystem bridge when the noVNC slot cannot be published", async () => {
    enableManaged(true);
    process.env.OPENBOT_ACCOUNT_WORKER_DOCKER = "1";
    installRuntime();
    setAccountWorkerPreviewReadersForTests({
      readPort: async () => null,
      readEnv: async () => null,
    });
    const resolved = await resolveEmbeddedRunSandboxContextParams({
      ...runInput,
      workspaceDir: root,
    });
    const started = await resolveSandboxContext({
      ...resolved,
      workspaceDir: root,
    });
    expect(started?.enabled).toBe(true);
    expect(started?.fsBridge).toBeDefined();
    expect(() =>
      createOpenClawCodingTools({
        config: managedCfg,
        sessionKey: "agent:bot:main",
        workspaceDir: started?.workspaceDir,
        sandbox: started ?? undefined,
      }),
    ).not.toThrow(/Sandbox filesystem bridge is unavailable/);
    const preview = readAccountComputerPreview({
      tenantId: "tenant-a",
      userId: "user-a",
      issueUrl: true,
      sessionKey: "agent:bot:main",
    });
    expect(preview.status).toBe("COLD");
    expect(preview.streamUrl).toBeUndefined();
  });
});
