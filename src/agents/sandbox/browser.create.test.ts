import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  peekAccountBrowserCdpPort,
  resetAccountBrowserCdpPortsForTests,
} from "../../browser/account-browser-namespace.js";
import {
  readAccountComputerPreview,
  resetAccountComputerSlotsForTests,
} from "./account-computer-stream.js";
import {
  buildAccountSandboxMountPlan,
  collectDockerVolumeBinds,
  formatAccountDockerBind,
} from "./account-mounts.js";
import { BROWSER_BRIDGES } from "./browser-bridges.js";
import { ensureSandboxBrowser } from "./browser.js";
import { resetNoVncObserverTokensForTests } from "./novnc-auth.js";
import { collectDockerFlagValues, findDockerArgsCall } from "./test-args.js";
import type { SandboxConfig } from "./types.js";

const dockerMocks = vi.hoisted(() => ({
  dockerContainerState: vi.fn(),
  execDocker: vi.fn(),
  readDockerContainerEnvVar: vi.fn(),
  readDockerContainerLabel: vi.fn(),
  readDockerPort: vi.fn(),
}));

const registryMocks = vi.hoisted(() => ({
  readBrowserRegistry: vi.fn(),
  updateBrowserRegistry: vi.fn(),
}));

const bridgeMocks = vi.hoisted(() => ({
  startBrowserBridgeServer: vi.fn(),
  stopBrowserBridgeServer: vi.fn(),
}));

vi.mock("./docker.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./docker.js")>();
  return {
    ...actual,
    dockerContainerState: dockerMocks.dockerContainerState,
    execDocker: dockerMocks.execDocker,
    readDockerContainerEnvVar: dockerMocks.readDockerContainerEnvVar,
    readDockerContainerLabel: dockerMocks.readDockerContainerLabel,
    readDockerPort: dockerMocks.readDockerPort,
  };
});

vi.mock("./registry.js", () => ({
  readBrowserRegistry: registryMocks.readBrowserRegistry,
  updateBrowserRegistry: registryMocks.updateBrowserRegistry,
}));

vi.mock("../../browser/bridge-server.js", () => ({
  startBrowserBridgeServer: bridgeMocks.startBrowserBridgeServer,
  stopBrowserBridgeServer: bridgeMocks.stopBrowserBridgeServer,
}));

function buildConfig(enableNoVnc: boolean): SandboxConfig {
  return {
    mode: "all",
    scope: "session",
    workspaceAccess: "none",
    workspaceRoot: "/tmp/openclaw-sandboxes",
    docker: {
      image: "openclaw-sandbox:bookworm-slim",
      containerPrefix: "openclaw-sbx-",
      workdir: "/workspace",
      readOnlyRoot: true,
      tmpfs: ["/tmp", "/var/tmp", "/run"],
      network: "none",
      capDrop: ["ALL"],
      env: { LANG: "C.UTF-8" },
    },
    browser: {
      enabled: true,
      image: "openclaw-sandbox-browser:trixie",
      containerPrefix: "openclaw-sbx-browser-",
      network: "openclaw-sandbox-browser",
      cdpPort: 9222,
      vncPort: 5900,
      noVncPort: 6080,
      headless: false,
      enableNoVnc,
      allowHostControl: false,
      autoStart: true,
      autoStartTimeoutMs: 12_000,
    },
    tools: {
      allow: ["browser"],
      deny: [],
    },
    prune: {
      idleHours: 24,
      maxAgeDays: 7,
    },
  };
}

describe("ensureSandboxBrowser create args", () => {
  beforeEach(() => {
    BROWSER_BRIDGES.clear();
    resetAccountComputerSlotsForTests();
    resetNoVncObserverTokensForTests();
    dockerMocks.dockerContainerState.mockClear();
    dockerMocks.execDocker.mockClear();
    dockerMocks.readDockerContainerEnvVar.mockClear();
    dockerMocks.readDockerContainerLabel.mockClear();
    dockerMocks.readDockerPort.mockClear();
    registryMocks.readBrowserRegistry.mockClear();
    registryMocks.updateBrowserRegistry.mockClear();
    bridgeMocks.startBrowserBridgeServer.mockClear();
    bridgeMocks.stopBrowserBridgeServer.mockClear();

    dockerMocks.dockerContainerState.mockResolvedValue({ exists: false, running: false });
    dockerMocks.execDocker.mockImplementation(async (args: string[]) => {
      if (args[0] === "image" && args[1] === "inspect") {
        return { stdout: "[]", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    });
    dockerMocks.readDockerContainerLabel.mockResolvedValue(null);
    dockerMocks.readDockerContainerEnvVar.mockResolvedValue(null);
    dockerMocks.readDockerPort.mockImplementation(async (_containerName: string, port: number) => {
      if (port === 9222) {
        return 49100;
      }
      if (port === 6080) {
        return 49101;
      }
      return null;
    });
    registryMocks.readBrowserRegistry.mockResolvedValue({ entries: [] });
    registryMocks.updateBrowserRegistry.mockResolvedValue(undefined);
    bridgeMocks.startBrowserBridgeServer.mockResolvedValue({
      server: {} as never,
      port: 19000,
      baseUrl: "http://127.0.0.1:19000",
      state: {
        server: null,
        port: 19000,
        resolved: { profiles: {} },
        profiles: new Map(),
      },
    });
    bridgeMocks.stopBrowserBridgeServer.mockResolvedValue(undefined);
  });

  it("publishes noVNC on loopback and injects noVNC password env", async () => {
    const result = await ensureSandboxBrowser({
      scopeKey: "session:test",
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/workspace",
      cfg: buildConfig(true),
    });

    const createArgs = findDockerArgsCall(dockerMocks.execDocker.mock.calls, "create");

    expect(createArgs).toBeDefined();
    expect(createArgs).toContain("127.0.0.1::6080");
    expect(createArgs).not.toContain("0.0.0.0::6080");
    const envEntries = collectDockerFlagValues(createArgs ?? [], "-e");
    expect(envEntries).toContain("OPENCLAW_BROWSER_NO_SANDBOX=1");
    const passwordEntry = envEntries.find((entry) =>
      entry.startsWith("OPENCLAW_BROWSER_NOVNC_PASSWORD="),
    );
    expect(passwordEntry).toMatch(/^OPENCLAW_BROWSER_NOVNC_PASSWORD=[A-Za-z0-9]{8}$/);
    expect(result?.noVncUrl).toMatch(/^http:\/\/127\.0\.0\.1:19000\/sandbox\/novnc\?token=/);
    expect(result?.noVncUrl).not.toContain("password=");
  });

  it("does not inject noVNC password env when noVNC is disabled", async () => {
    const result = await ensureSandboxBrowser({
      scopeKey: "session:test",
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/workspace",
      cfg: buildConfig(false),
    });

    const createArgs = findDockerArgsCall(dockerMocks.execDocker.mock.calls, "create");
    const envEntries = collectDockerFlagValues(createArgs ?? [], "-e");
    expect(envEntries.some((entry) => entry.startsWith("OPENCLAW_BROWSER_NOVNC_PASSWORD="))).toBe(
      false,
    );
    expect(result?.noVncUrl).toBeUndefined();
  });

  it("mounts the main workspace read-only when workspaceAccess is none", async () => {
    const cfg = buildConfig(false);
    cfg.workspaceAccess = "none";

    await ensureSandboxBrowser({
      scopeKey: "session:test",
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/workspace",
      cfg,
    });

    const createArgs = findDockerArgsCall(dockerMocks.execDocker.mock.calls, "create");

    expect(createArgs).toBeDefined();
    expect(createArgs).toContain("/tmp/workspace:/workspace:ro");
  });

  it("keeps the main workspace writable when workspaceAccess is rw", async () => {
    const cfg = buildConfig(false);
    cfg.workspaceAccess = "rw";

    await ensureSandboxBrowser({
      scopeKey: "session:test",
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/workspace",
      cfg,
    });

    const createArgs = findDockerArgsCall(dockerMocks.execDocker.mock.calls, "create");

    expect(createArgs).toBeDefined();
    expect(createArgs).toContain("/tmp/workspace:/workspace");
    expect(createArgs).not.toContain("/tmp/workspace:/workspace:ro");
  });

  it("mounts the account browser profile, publishes a dynamic CDP port, and keeps Cookies", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-account-browser-create-"));
    const tenantsRoot = path.join(root, "tenants");
    const userRoot = path.join(tenantsRoot, "tenant-a", "users", "user-a");
    const dataRoot = path.join(userRoot, "OpenBot");
    const workspaceDir = path.join(dataRoot, "agents", "bot", "workspace");
    const artifactsDir = path.join(dataRoot, "agents", "bot", "artifacts");
    const browserProfileDir = path.join(userRoot, "state", "browser");
    const credentialDir = path.join(userRoot, "state", "agents", "bot", "agent");
    await fs.mkdir(browserProfileDir, { recursive: true });
    await fs.writeFile(path.join(browserProfileDir, "Cookies"), "ordinary-cookie", "utf8");
    const plan = buildAccountSandboxMountPlan({
      workspaceDir,
      artifactsDir,
      browserProfileDir,
    });
    const cfg = buildConfig(false);
    cfg.scope = "account";
    cfg.workspaceAccess = "rw";
    cfg.account = { tenantId: "tenant-a", userId: "user-a", agentId: "bot" };
    cfg.accountBrowserBinds = plan.browser.map(formatAccountDockerBind);
    cfg.accountMountGuard = {
      execAllow: plan.exec,
      browserAllow: plan.browser,
      tenantsRoot,
      userRoot,
      credentialDir,
      configDir: path.join(root, "config"),
      agentId: "bot",
      dataRoot,
      browserProfileDir,
    };
    try {
      await ensureSandboxBrowser({
        scopeKey: "account:tenant-a:user-a:agent:bot",
        workspaceDir,
        agentWorkspaceDir: workspaceDir,
        cfg,
      });
      const createArgs = findDockerArgsCall(dockerMocks.execDocker.mock.calls, "create");
      expect(createArgs).toBeDefined();
      const volumes = collectDockerVolumeBinds(createArgs ?? []);
      expect(
        volumes.some((bind) => bind.includes(`${browserProfileDir}:/account/browser:rw`)),
      ).toBe(true);
      expect(volumes.join("\n")).not.toContain(credentialDir);
      expect(volumes.join("\n")).not.toContain("/var/run/docker.sock");
      const publish = (createArgs ?? []).find(
        (arg) => arg.startsWith("127.0.0.1:") && arg.endsWith(":9222"),
      );
      expect(publish).toBeTruthy();
      const hostPort = Number(publish?.split(":")[1]);
      expect(hostPort).toBeGreaterThan(0);
      expect(hostPort < 18800 || hostPort > 18899).toBe(true);
      const envEntries = collectDockerFlagValues(createArgs ?? [], "-e");
      expect(envEntries).toContain("OPENBOT_BROWSER_USER_DATA_DIR=/account/browser");
      expect(await fs.readFile(path.join(browserProfileDir, "Cookies"), "utf8")).toBe(
        "ordinary-cookie",
      );
    } finally {
      resetAccountBrowserCdpPortsForTests();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("releases the account CDP holder when recreating a stale browser container", async () => {
    const cfg = buildConfig(false);
    cfg.scope = "account";
    cfg.account = { tenantId: "tenant-a", userId: "user-a", agentId: "bot" };
    const holder = "account:tenant-a:user-a:browser";
    const params = {
      scopeKey: "account:tenant-a:user-a:agent:bot",
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/workspace",
      cfg,
    };
    await ensureSandboxBrowser(params);
    expect(peekAccountBrowserCdpPort(holder)).toBeTypeOf("number");
    const namespace = await import("../../browser/account-browser-namespace.js");
    const release = vi.spyOn(namespace, "releaseAccountBrowserCdpPort");
    dockerMocks.dockerContainerState.mockResolvedValue({ exists: true, running: false });
    dockerMocks.readDockerContainerLabel.mockResolvedValue("stale-hash");
    try {
      await ensureSandboxBrowser(params);
      expect(release).toHaveBeenCalledWith(holder);
      expect(peekAccountBrowserCdpPort(holder)).toBeTypeOf("number");
    } finally {
      release.mockRestore();
      resetAccountBrowserCdpPortsForTests();
    }
  });

  it("rejects a credential directory on the account browser create args", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-account-browser-deny-"));
    const tenantsRoot = path.join(root, "tenants");
    const userRoot = path.join(tenantsRoot, "tenant-a", "users", "user-a");
    const dataRoot = path.join(userRoot, "OpenBot");
    const workspaceDir = path.join(dataRoot, "agents", "bot", "workspace");
    const artifactsDir = path.join(dataRoot, "agents", "bot", "artifacts");
    const browserProfileDir = path.join(userRoot, "state", "browser");
    const credentialDir = path.join(userRoot, "state", "agents", "bot", "agent");
    const plan = buildAccountSandboxMountPlan({
      workspaceDir,
      artifactsDir,
      browserProfileDir,
    });
    const cfg = buildConfig(false);
    cfg.scope = "account";
    cfg.account = { tenantId: "tenant-a", userId: "user-a", agentId: "bot" };
    cfg.accountBrowserBinds = [
      ...plan.browser.map(formatAccountDockerBind),
      `${credentialDir}:/account/secrets:ro`,
    ];
    cfg.accountMountGuard = {
      execAllow: plan.exec,
      browserAllow: plan.browser,
      tenantsRoot,
      userRoot,
      credentialDir,
      configDir: path.join(root, "config"),
      agentId: "bot",
      dataRoot,
      browserProfileDir,
    };
    try {
      await expect(
        ensureSandboxBrowser({
          scopeKey: "account:tenant-a:user-a:agent:bot",
          workspaceDir,
          agentWorkspaceDir: workspaceDir,
          cfg,
        }),
      ).rejects.toThrow(/credential/);
    } finally {
      resetAccountBrowserCdpPortsForTests();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("publishes the account observer with the platform user id", async () => {
    const cfg = buildConfig(true);
    cfg.scope = "account";
    cfg.account = { tenantId: "tenant-a", userId: "user-a", agentId: "bot" };
    await ensureSandboxBrowser({
      scopeKey: "account:tenant-a:user-a:agent:bot",
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/workspace",
      cfg,
      observerAccount: { tenantId: "tenant-a", userId: "user-a", agentLabel: "Ada" },
    });
    expect(BROWSER_BRIDGES.has("account:tenant-a:user-a:browser")).toBe(true);
    const preview = readAccountComputerPreview({
      tenantId: "tenant-a",
      userId: "user-a",
      issueUrl: false,
    });
    expect(preview.status).toBe("READY");
    expect(preview.userId).toBe("user-a");
    expect(preview.controlledBy).toEqual({ kind: "agent", label: "Ada" });

    resetAccountComputerSlotsForTests();
    await ensureSandboxBrowser({
      scopeKey: "account:tenant-a:user-a:agent:bot",
      workspaceDir: "/tmp/workspace",
      agentWorkspaceDir: "/tmp/workspace",
      cfg,
      observerAccount: { tenantId: "tenant-a", userId: "ada@example.com" },
    });
    expect(
      readAccountComputerPreview({
        tenantId: "tenant-a",
        userId: "ada@example.com",
        issueUrl: false,
      }).status,
    ).toBe("COLD");
    resetAccountBrowserCdpPortsForTests();
  });
});
