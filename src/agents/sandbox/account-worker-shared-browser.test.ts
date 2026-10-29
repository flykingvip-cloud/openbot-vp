/**
 * One Account Computer browser per user.
 * Exec containers stay per agent and attach to that shared browser.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/types.js";
import { AccountRuntimeSnapshotStore } from "../../gateway/governance/account-runtime-snapshot.js";
import { browserPreviewHandlers } from "../../gateway/server-methods/browser-preview.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import {
  peekAccountComputerBrowser,
  readAccountComputerPreview,
  resetAccountComputerSlotsForTests,
  setAccountBrowserLivenessForTests,
} from "./account-computer-stream.js";
import {
  accountSharedBrowserContainerName,
  chooseSharedAccountBrowser,
  createDockerAccountSandboxDriver,
  createMemoryAccountSandboxDriver,
  reconcileRunningAccountBrowsers,
  resetAccountWorkerBrowserNoVncPasswordsForTests,
  type AccountWorkerDockerRunner,
} from "./account-worker-driver.js";
import {
  resetEmbeddedAccountWorkerForTests,
  resolveEmbeddedRunSandboxContextParams,
  setAccountWorkerPreviewReadersForTests,
  setEmbeddedAccountWorkerRuntimeForTests,
} from "./account-worker-embedded.js";
import { createAccountWorkerControlPlane } from "./account-worker-gateway.js";
import { AccountWorkerLifecycle } from "./account-worker-lifecycle.js";
import {
  DEFAULT_SANDBOX_BROWSER_CDP_PORT,
  DEFAULT_SANDBOX_BROWSER_NOVNC_PORT,
} from "./constants.js";
import { resolveSandboxContext } from "./context.js";
import { NOVNC_PASSWORD_ENV_KEY } from "./novnc-auth.js";
import type { RuntimeContainerSpec } from "./runtime-controller.js";

const nowMs = Date.parse("2026-10-08T09:16:55.000Z");

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

type Endpoint = { cdpPort: number; noVncPort: number };

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

function browserSpec(root: string, leaseId: string): RuntimeContainerSpec {
  return {
    runtimeLeaseId: leaseId,
    snapshotVersion: 1,
    image: "openbot-account-sandbox:p3",
    browserImage: "openclaw-sandbox-browser:trixie",
    execMounts: [],
    browserMounts: [
      {
        hostPath: path.join(root, "browser"),
        containerPath: "/account/browser",
        access: "rw",
      },
    ],
  };
}

type SeededBrowser = {
  name: string;
  profile: string;
  startedAt: string;
  running: boolean;
};

function seededBrowserRunner(rows: SeededBrowser[]): {
  calls: string[][];
  run: AccountWorkerDockerRunner;
  rowsRunning: (name: string) => boolean;
} {
  const calls: string[][] = [];
  const run: AccountWorkerDockerRunner = async (args) => {
    calls.push([...args]);
    const verb = args[0];
    if (verb === "ps") {
      const names = rows.filter((row) => row.running).map((row) => row.name);
      return { stdout: names.join("\n"), stderr: "", code: 0 };
    }
    if (verb === "inspect") {
      const name = args[args.length - 1] ?? "";
      const row = rows.find((item) => item.name === name);
      if (!row) {
        return { stdout: "", stderr: "missing", code: 1 };
      }
      const formatIndex = args.indexOf("-f");
      const format = formatIndex >= 0 ? (args[formatIndex + 1] ?? "") : "";
      if (format.includes(".Mounts")) {
        return {
          stdout: `${row.running ? "true" : "false"}\t${row.startedAt}\t/account/browser=${row.profile}\n`,
          stderr: "",
          code: 0,
        };
      }
      return { stdout: row.running ? "true\n" : "false\n", stderr: "", code: 0 };
    }
    if (verb === "stop" || verb === "rm") {
      const name = args[args.length - 1] ?? "";
      const row = rows.find((item) => item.name === name);
      if (row) {
        row.running = false;
      }
      return { stdout: name, stderr: "", code: 0 };
    }
    return { stdout: "", stderr: `unexpected docker args: ${args.join(" ")}`, code: 1 };
  };
  return {
    calls,
    run,
    rowsRunning: (name) => rows.find((row) => row.name === name)?.running === true,
  };
}

describe("shared account computer browser", () => {
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

  function enableManaged(): void {
    prev = saveEnv();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-account-shared-browser-"));
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = root;
    process.env.OPENBOT_STATE_DIR = path.join(root, "operator-state");
    process.env.OPENBOT_ACCOUNT_WORKER = "1";
    process.env.OPENBOT_ACCOUNT_WORKER_DOCKER = "1";
    delete process.env.OPENBOT_SECURITY_PROFILE;
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
    const endpoints = new Map<string, Endpoint>();
    let nextPort = 50_000;
    setAccountWorkerPreviewReadersForTests({
      readPort: async (containerName, port) => {
        let endpoint = endpoints.get(containerName);
        if (!endpoint) {
          endpoint = { cdpPort: nextPort, noVncPort: nextPort + 1 };
          nextPort += 2;
          endpoints.set(containerName, endpoint);
        }
        if (port === DEFAULT_SANDBOX_BROWSER_CDP_PORT) {
          return endpoint.cdpPort;
        }
        if (port === DEFAULT_SANDBOX_BROWSER_NOVNC_PORT) {
          return endpoint.noVncPort;
        }
        return null;
      },
      readEnv: async (_container, key) => (key === NOVNC_PASSWORD_ENV_KEY ? "Abc123xy" : null),
    });
    return { driver, endpoints };
  }

  async function startAgent(params: { agentId: string; userId: string }) {
    const resolved = await resolveEmbeddedRunSandboxContextParams({
      config: managedCfg,
      sessionKey: `agent:${params.agentId}:main`,
      workspaceDir: root,
      agentId: params.agentId,
      gatewayClientUser: "ada@example.com",
      gatewayClientPlatformUserId: params.userId,
      gatewayClientSessionEnterpriseId: "tenant-a",
    });
    const started = await resolveSandboxContext({
      ...resolved,
      workspaceDir: root,
    });
    return { resolved, started };
  }

  async function preview(userId: string, sessionKey: string) {
    setAccountBrowserLivenessForTests(async () => "running");
    const calls: Array<[boolean, unknown?, { message?: string }?]> = [];
    await browserPreviewHandlers["browser.preview"]({
      params: { action: "open", sessionKey },
      respond: (ok, payload, error) => {
        calls.push([ok, payload, error]);
      },
      client: {
        sessionEnterpriseId: "tenant-a",
        platformUserId: userId,
      } as GatewayClient,
      context: { broadcast: () => undefined } as never,
      req: { type: "req", id: "req-shared", method: "browser.preview" },
      isWebchatConnect: () => false,
    });
    return calls[0];
  }

  it("shares one browser across two agents and gives another user a separate container", async () => {
    enableManaged();
    const { driver, endpoints } = installRuntime();

    const first = await startAgent({ agentId: "main", userId: "user-a" });
    const firstExec = first.started?.containerName ?? "";
    const profileDir = path.join(root, "operator-state", "operators", "user-a", "state", "browser");
    const journalPath = path.join(root, "runtime", "workers", "tenant-a", "user-a", "worker.json");
    const slot = peekAccountComputerBrowser("tenant-a", "user-a");
    expect(slot).not.toBeNull();
    const sharedContainer = slot?.containerName ?? "";
    const sharedPort = slot?.noVncPort;
    expect(sharedContainer.startsWith("aw-browser-user-")).toBe(true);
    expect(sharedContainer).toBe(accountSharedBrowserContainerName(profileDir));
    expect(endpoints.get(sharedContainer)?.cdpPort).toBeTypeOf("number");
    expect(endpoints.get(sharedContainer)?.noVncPort).toBe(sharedPort);

    await fsp.mkdir(path.join(profileDir, "Default"), { recursive: true });
    await fsp.writeFile(path.join(profileDir, "Cookies"), "jd-login");
    await fsp.writeFile(path.join(profileDir, "Default", "Tabs"), "jd-home");

    const second = await startAgent({ agentId: "bot--agent", userId: "user-a" });
    const again = peekAccountComputerBrowser("tenant-a", "user-a");
    expect(second.started?.containerName).not.toBe(firstExec);
    expect(second.started?.containerName?.startsWith("aw-exec-")).toBe(true);
    expect(again).toEqual(slot);
    expect(endpoints.get(sharedContainer)?.cdpPort).toBe(
      endpoints.get(again?.containerName ?? "")?.cdpPort,
    );
    expect(driver.browserStarts).toHaveLength(1);
    expect(driver.stoppedBrowsers).toEqual([]);
    expect(driver.stoppedExec).not.toContain(firstExec);
    expect(driver.execStarts).toHaveLength(2);

    const browserArtifacts = driver.browserStarts[0]?.browserMounts.find(
      (mount) => mount.containerPath === "/account/artifacts",
    );
    expect(browserArtifacts?.hostPath.endsWith(path.join("OpenBot", "artifacts"))).toBe(true);
    expect(browserArtifacts?.hostPath.includes(`${path.sep}agents${path.sep}`)).toBe(false);
    const execArtifacts = driver.execStarts.map(
      (spec) =>
        spec.execMounts.find((mount) => mount.containerPath === "/account/artifacts")?.hostPath,
    );
    expect(execArtifacts[0]).not.toBe(execArtifacts[1]);
    expect(execArtifacts[0]?.includes(`${path.sep}agents${path.sep}main${path.sep}artifacts`)).toBe(
      true,
    );
    expect(
      execArtifacts[1]?.includes(`${path.sep}agents${path.sep}bot--agent${path.sep}artifacts`),
    ).toBe(true);

    expect(await fsp.readFile(path.join(profileDir, "Cookies"), "utf8")).toBe("jd-login");
    expect(await fsp.readFile(path.join(profileDir, "Default", "Tabs"), "utf8")).toBe("jd-home");

    const journal = JSON.parse(await fsp.readFile(journalPath, "utf8")) as {
      agentId: string;
      browserContainerName: string;
      browserProfileDir: string;
      execContainerName: string;
      retainedExecContainers: string[];
    };
    expect(journal.agentId).toBe("bot--agent");
    expect(journal.browserContainerName).toBe(sharedContainer);
    expect(path.resolve(journal.browserProfileDir)).toBe(path.resolve(profileDir));
    expect(journal.execContainerName).toBe(second.started?.containerName);
    expect(journal.retainedExecContainers).toContain(firstExec);

    const index = JSON.parse(
      await fsp.readFile(path.join(root, "runtime", "lifecycle.json"), "utf8"),
    ) as { slots: Record<string, { statePath: string; userId: string }> };
    expect(Object.keys(index.slots)).toEqual(["tenant-a/user-a"]);
    expect(path.resolve(index.slots["tenant-a/user-a"]?.statePath ?? "")).toBe(
      path.resolve(journalPath),
    );

    const mainPreview = await preview("user-a", "agent:main:main");
    const botPreview = await preview("user-a", "agent:bot--agent:main");
    expect(mainPreview?.[0]).toBe(true);
    expect(botPreview?.[0]).toBe(true);
    const mainPayload = mainPreview?.[1] as { status?: string };
    const botPayload = botPreview?.[1] as { status?: string };
    expect(mainPayload.status).toBe("READY");
    expect(botPayload.status).toBe("READY");
    expect(JSON.stringify(mainPayload)).not.toContain(sharedContainer);
    expect(JSON.stringify(botPayload)).not.toContain(sharedContainer);
    expect(peekAccountComputerBrowser("tenant-a", "user-a")?.containerName).toBe(sharedContainer);
    expect(
      readAccountComputerPreview({ tenantId: "tenant-a", userId: "user-a", issueUrl: false })
        .status,
    ).toBe("READY");

    const other = await startAgent({ agentId: "main", userId: "user-b" });
    const otherSlot = peekAccountComputerBrowser("tenant-a", "user-b");
    expect(other.started?.containerName).not.toBe(firstExec);
    expect(otherSlot?.containerName).not.toBe(sharedContainer);
    expect(otherSlot?.noVncPort).not.toBe(sharedPort);
    expect(endpoints.get(otherSlot?.containerName ?? "")?.cdpPort).not.toBe(
      endpoints.get(sharedContainer)?.cdpPort,
    );
    expect(peekAccountComputerBrowser("tenant-a", "user-a")).toEqual(slot);
    expect(driver.browserStarts).toHaveLength(2);
    const after = JSON.parse(
      await fsp.readFile(path.join(root, "runtime", "lifecycle.json"), "utf8"),
    ) as { slots: Record<string, { userId: string }> };
    expect(Object.keys(after.slots).toSorted()).toEqual(["tenant-a/user-a", "tenant-a/user-b"]);
    const userAJournal = JSON.parse(await fsp.readFile(journalPath, "utf8")) as {
      browserContainerName: string;
    };
    expect(userAJournal.browserContainerName).toBe(sharedContainer);
  });

  it("adopts the running browser instead of starting a second Chromium on the same profile", async () => {
    const profileRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "aw-shared-profile-"));
    root = profileRoot;
    const profile = path.resolve(profileRoot, "browser");
    const otherProfile = path.resolve(profileRoot, "other", "browser");
    await fsp.mkdir(path.join(profile, "Default"), { recursive: true });
    await fsp.mkdir(otherProfile, { recursive: true });
    await fsp.writeFile(path.join(profile, "Cookies"), "jd-login");
    await fsp.writeFile(path.join(profile, "Default", "Tabs"), "jd-home");
    const older = "aw-browser-lease-93b4c8d2";
    const newer = "aw-browser-lease-30304877";
    const other = "aw-browser-lease-user-b";
    const seeded = seededBrowserRunner([
      {
        name: older,
        profile,
        startedAt: "2026-10-08T09:10:00.000Z",
        running: true,
      },
      {
        name: newer,
        profile,
        startedAt: "2026-10-08T09:16:55.000Z",
        running: true,
      },
      {
        name: other,
        profile: otherProfile,
        startedAt: "2026-10-08T08:00:00.000Z",
        running: true,
      },
    ]);
    const driver = createDockerAccountSandboxDriver({ runDocker: seeded.run });
    const started = await driver.startBrowser(browserSpec(profileRoot, "lease-second"));
    expect(started.containerName).toBe(newer);
    expect(seeded.calls.some((args) => args[0] === "create")).toBe(false);
    expect(seeded.rowsRunning(older)).toBe(false);
    expect(seeded.rowsRunning(newer)).toBe(true);
    expect(seeded.rowsRunning(other)).toBe(true);
    expect(await fsp.readFile(path.join(profile, "Cookies"), "utf8")).toBe("jd-login");
    expect(await fsp.readFile(path.join(profile, "Default", "Tabs"), "utf8")).toBe("jd-home");
    expect(await driver.browserAlive(started.pid)).toBe(true);
  });

  it("keeps the most recently started browser per profile at startup", async () => {
    const profileA = path.resolve("/tmp/openbot-user-a/state/browser");
    const profileB = path.resolve("/tmp/openbot-user-b/state/browser");
    const older = "aw-browser-lease-93b4c8d2";
    const newer = "aw-browser-lease-30304877";
    const canonical = "aw-browser-user-older";
    const other = "aw-browser-lease-user-b";
    const seeded = seededBrowserRunner([
      {
        name: canonical,
        profile: profileA,
        startedAt: "2026-10-08T09:00:00.000Z",
        running: true,
      },
      {
        name: older,
        profile: profileA,
        startedAt: "2026-10-08T09:10:00.000Z",
        running: true,
      },
      {
        name: newer,
        profile: profileA,
        startedAt: "2026-10-08T09:16:55.000Z",
        running: true,
      },
      {
        name: other,
        profile: profileB,
        startedAt: "2026-10-08T08:00:00.000Z",
        running: true,
      },
    ]);
    const result = await reconcileRunningAccountBrowsers(seeded.run);
    expect(result.kept.toSorted()).toEqual([newer, other].toSorted());
    expect(result.stopped.toSorted()).toEqual([canonical, older].toSorted());
    expect(seeded.rowsRunning(newer)).toBe(true);
    expect(seeded.rowsRunning(other)).toBe(true);
    expect(seeded.rowsRunning(older)).toBe(false);
    expect(seeded.rowsRunning(canonical)).toBe(false);
    expect(
      chooseSharedAccountBrowser([
        {
          name: "aw-browser-user-abc",
          running: true,
          startedAtMs: 1,
          profileHostPath: profileA,
        },
        {
          name: "aw-browser-lease-new",
          running: true,
          startedAtMs: 2,
          profileHostPath: profileA,
        },
      ]),
    ).toEqual({ keep: "aw-browser-lease-new", stop: ["aw-browser-user-abc"] });
  });
});
