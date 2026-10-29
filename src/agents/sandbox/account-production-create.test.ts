/**
 * Account Computer v4.1 P0: production sandbox builders, not the mount plan alone.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAccountSandboxMountPlan,
  collectDockerVolumeBinds,
  formatAccountDockerBind,
  type AccountMountGuard,
} from "./account-mounts.js";
import { resolveEmbeddedRunSandboxParams } from "./account-scope.js";
import { applyAccountSandboxConfig, resolveSandboxContext } from "./context.js";
import {
  buildSandboxContainerCreateArgs,
  buildSandboxCreateArgs,
  createSandboxContainer,
} from "./docker.js";
import type { SandboxConfig, SandboxDockerConfig } from "./types.js";

const execFileAsync = promisify(execFile);

const ENV_KEYS = [
  "OPENBOT_DATA_MODE",
  "OPENBOT_MULTITENANT",
  "OPENBOT_TENANTS_ROOT",
  "OPENBOT_STATE_DIR",
  "OPENCLAW_BUNDLED_SKILLS_DIR",
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

function dockerCfg(binds: string[]): SandboxDockerConfig {
  return {
    image: "openclaw-sandbox:bookworm-slim",
    containerPrefix: "openclaw-sbx-",
    workdir: "/workspace",
    readOnlyRoot: true,
    tmpfs: ["/tmp", "/var/tmp", "/run"],
    network: "none",
    capDrop: ["ALL"],
    binds,
  };
}

function baseSandboxConfig(binds: string[]): SandboxConfig {
  return {
    mode: "all",
    scope: "agent",
    workspaceAccess: "rw",
    workspaceRoot: "/tmp/openclaw-sandboxes",
    docker: dockerCfg(binds),
    browser: {
      enabled: false,
      image: "openclaw-sandbox-browser:trixie",
      containerPrefix: "openclaw-sbx-browser-",
      network: "openclaw-sandbox-browser",
      cdpPort: 9222,
      vncPort: 5900,
      noVncPort: 6080,
      headless: true,
      enableNoVnc: false,
      allowHostControl: false,
      autoStart: true,
      autoStartTimeoutMs: 1000,
    },
    tools: { allow: ["exec"], deny: [] },
    prune: { idleHours: 24, maxAgeDays: 7 },
  };
}

describe("account production sandbox create", () => {
  let prev: Record<string, string | undefined>;
  let root: string;

  afterEach(async () => {
    if (prev) {
      restoreEnv(prev);
    }
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("createSandboxContainer emits workspace mounts plus account binds and omits credentials", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-account-create-"));
    const tenantsRoot = path.join(root, "tenants");
    const userRoot = path.join(tenantsRoot, "tenant-a", "users", "user-a");
    const dataRoot = path.join(userRoot, "OpenBot");
    const workspaceDir = path.join(dataRoot, "agents", "bot", "workspace");
    const artifactsDir = path.join(dataRoot, "agents", "bot", "artifacts");
    const browserProfileDir = path.join(userRoot, "state", "browser");
    const credentialDir = path.join(userRoot, "state", "agents", "bot", "agent");
    const otherAgentWorkspace = path.join(dataRoot, "agents", "other", "workspace");
    const skills = path.join(root, "shared-skills");
    const canvas = path.join(root, "shared-canvas");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(otherAgentWorkspace, { recursive: true });
    const plan = buildAccountSandboxMountPlan({
      workspaceDir,
      artifactsDir,
      browserProfileDir,
      sharedSkillsDir: skills,
      sharedCanvasDir: canvas,
    });
    const guard: AccountMountGuard = {
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
    const cfg = dockerCfg(plan.exec.map(formatAccountDockerBind));
    const planned = buildSandboxCreateArgs({
      name: "openclaw-sbx-account",
      cfg,
      scopeKey: "account:tenant-a:user-a:agent:bot",
      includeBinds: true,
      bindSourceRoots: plan.exec.map((mount) => mount.hostPath),
    });
    expect(
      collectDockerVolumeBinds(planned).some((bind) => bind.includes("/account/skills:ro")),
    ).toBe(true);

    const calls: string[][] = [];
    await createSandboxContainer({
      name: "openclaw-sbx-account",
      cfg,
      workspaceDir,
      workspaceAccess: "rw",
      agentWorkspaceDir: workspaceDir,
      scopeKey: "account:tenant-a:user-a:agent:bot",
      accountMountGuard: guard,
      runDocker: async (args) => {
        calls.push(args);
        return { stdout: "", stderr: "", code: 0 };
      },
    });
    const createArgs = calls[0] ?? [];
    expect(createArgs[0]).toBe("create");
    const volumes = collectDockerVolumeBinds(createArgs);
    expect(volumes.some((bind) => bind.startsWith(`${workspaceDir}:/workspace`))).toBe(true);
    expect(volumes.some((bind) => bind.includes("/account/workspace:rw"))).toBe(true);
    expect(volumes.some((bind) => bind.includes("/account/artifacts:rw"))).toBe(true);
    expect(volumes.some((bind) => bind.includes("/account/skills:ro"))).toBe(true);
    expect(volumes.some((bind) => bind.includes("/account/canvas:ro"))).toBe(true);
    expect(volumes.join("\n")).not.toContain(credentialDir);
    expect(volumes.join("\n")).not.toContain(otherAgentWorkspace);
    expect(volumes.join("\n")).not.toContain("docker.sock");
    expect(calls[1]).toEqual(["start", "openclaw-sbx-account"]);

    const otherAgentCfg = dockerCfg(plan.exec.map(formatAccountDockerBind));
    expect(() =>
      buildSandboxContainerCreateArgs({
        name: "openclaw-sbx-other",
        cfg: otherAgentCfg,
        workspaceDir: otherAgentWorkspace,
        workspaceAccess: "rw",
        agentWorkspaceDir: otherAgentWorkspace,
        scopeKey: "account:tenant-a:user-a:agent:bot",
        accountMountGuard: guard,
      }),
    ).toThrow(/another agent's workspace/);

    expect(() =>
      buildSandboxContainerCreateArgs({
        name: "openclaw-sbx-cred",
        cfg: dockerCfg([
          ...plan.exec.map(formatAccountDockerBind),
          `${credentialDir}:/account/secrets:ro`,
        ]),
        workspaceDir,
        workspaceAccess: "rw",
        agentWorkspaceDir: workspaceDir,
        scopeKey: "account:tenant-a:user-a:agent:bot",
        accountMountGuard: guard,
      }),
    ).toThrow(/credential/);

    expect(() =>
      buildSandboxContainerCreateArgs({
        name: "openclaw-sbx-sock",
        cfg: dockerCfg([
          ...plan.exec.map(formatAccountDockerBind),
          "/var/run/docker.sock:/var/run/docker.sock:rw",
        ]),
        workspaceDir,
        workspaceAccess: "rw",
        agentWorkspaceDir: workspaceDir,
        scopeKey: "account:tenant-a:user-a:agent:bot",
        accountMountGuard: guard,
      }),
    ).toThrow(/docker\.sock/);

    expect(() =>
      buildSandboxContainerCreateArgs({
        name: "openclaw-sbx-tenants",
        cfg: dockerCfg([`${tenantsRoot}:/tenants:rw`]),
        workspaceDir,
        workspaceAccess: "rw",
        agentWorkspaceDir: workspaceDir,
        scopeKey: "account:tenant-a:user-a:agent:bot",
        accountMountGuard: guard,
      }),
    ).toThrow(/tenants/);
  });

  it("applyAccountSandboxConfig mounts shared skills and canvas read-only", async () => {
    prev = saveEnv();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-account-shared-"));
    const skills = path.join(root, "skills");
    const canvas = path.join(root, "canvas");
    await fs.mkdir(skills, { recursive: true });
    await fs.mkdir(canvas, { recursive: true });
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = path.join(root, "tenants");
    process.env.OPENBOT_STATE_DIR = path.join(root, "operator-state");
    process.env.OPENCLAW_BUNDLED_SKILLS_DIR = skills;
    const cfg = applyAccountSandboxConfig({
      cfg: baseSandboxConfig([]),
      config: { data: { mode: "managed" }, canvasHost: { root: canvas } },
      account: { tenantId: "tenant-a", userId: "user-a" },
      agentId: "bot",
    });
    const binds = cfg.docker.binds ?? [];
    expect(cfg.scope).toBe("account");
    expect(cfg.docker.workdir).toBe("/account/workspace");
    expect(binds.some((bind) => bind.endsWith(":/account/skills:ro"))).toBe(true);
    expect(binds.some((bind) => bind.endsWith(":/account/canvas:ro"))).toBe(true);
    expect(binds.join("\n")).not.toContain("/state/agents/");
  });

  it("fails closed when managed multitenant sandbox has no server-derived account", async () => {
    prev = saveEnv();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-account-failclosed-"));
    process.env.OPENBOT_DATA_MODE = "managed";
    process.env.OPENBOT_MULTITENANT = "1";
    process.env.OPENBOT_TENANTS_ROOT = path.join(root, "tenants");
    process.env.OPENBOT_STATE_DIR = path.join(root, "operator-state");
    await expect(
      resolveSandboxContext({
        config: {
          data: { mode: "managed" },
          agents: { defaults: { sandbox: { mode: "all" } } },
        },
        sessionKey: "agent:bot:main",
        workspaceDir: root,
      }),
    ).rejects.toThrow(/server-derived account/);

    expect(
      resolveEmbeddedRunSandboxParams({
        config: { data: { mode: "managed" } },
        sessionKey: "agent:bot:main",
        workspaceDir: root,
        agentId: "bot",
        executionIdentity: { enterpriseId: "tenant-a", platformUserId: "user-a", agentId: "bot" },
      }).account,
    ).toEqual({ tenantId: "tenant-a", userId: "user-a" });

    expect(
      resolveEmbeddedRunSandboxParams({
        config: { data: { mode: "managed" } },
        sessionKey: "agent:bot:main",
        workspaceDir: root,
        agentId: "bot",
        gatewayClientUser: "ada@example.com",
        gatewayClientPlatformUserId: "user-platform",
        gatewayClientSessionEnterpriseId: "tenant-a",
      }).account,
    ).toEqual({ tenantId: "tenant-a", userId: "user-platform" });

    expect(() =>
      resolveEmbeddedRunSandboxParams({
        config: { data: { mode: "managed" } },
        sessionKey: "agent:bot:main",
        workspaceDir: root,
        gatewayClientUser: "ada@example.com",
        gatewayClientSessionEnterpriseId: "tenant-a",
      }),
    ).toThrow(/server-derived account/);

    expect(() =>
      resolveEmbeddedRunSandboxParams({
        config: { data: { mode: "managed" } },
        sessionKey: "agent:bot:main",
        workspaceDir: root,
      }),
    ).toThrow(/server-derived account/);
  });

  it("keeps Cookies in the account user-data dir across entrypoint relaunch", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-account-entrypoint-"));
    const profile = path.join(root, "state", "browser");
    const home = path.join(root, "home");
    await fs.mkdir(profile, { recursive: true });
    await fs.writeFile(path.join(profile, "Cookies"), "ordinary-cookie", "utf8");
    const script = path.resolve("scripts/sandbox-browser-entrypoint.sh");
    const run = (env: NodeJS.ProcessEnv) =>
      execFileAsync("bash", [script], {
        env: { ...process.env, HOME: home, ...env },
      });
    const first = await run({
      OPENBOT_BROWSER_USER_DATA_DIR: profile,
      OPENBOT_BROWSER_ENTRYPOINT_PRINT_USER_DATA: "1",
    });
    expect(first.stdout.trim()).toBe(profile);
    expect(await fs.readFile(path.join(profile, "Cookies"), "utf8")).toBe("ordinary-cookie");
    const second = await run({
      OPENBOT_BROWSER_USER_DATA_DIR: profile,
      OPENBOT_BROWSER_ENTRYPOINT_PRINT_USER_DATA: "1",
    });
    expect(second.stdout.trim()).toBe(profile);
    expect(await fs.readFile(path.join(profile, "Cookies"), "utf8")).toBe("ordinary-cookie");

    const fallback = await run({
      OPENBOT_BROWSER_USER_DATA_DIR: "",
      OPENCLAW_BROWSER_USER_DATA_DIR: "",
      OPENBOT_BROWSER_ENTRYPOINT_PRINT_USER_DATA: "1",
    });
    expect(fallback.stdout.trim()).toBe("/tmp/openbot-home/.chrome");
  });

  it("binds websockify on all container interfaces while x11vnc stays on localhost", async () => {
    const script = await fs.readFile(path.resolve("scripts/sandbox-browser-entrypoint.sh"), "utf8");
    expect(script).toContain(
      'websockify --web /usr/share/novnc/ "0.0.0.0:${NOVNC_PORT}" "127.0.0.1:${VNC_PORT}"',
    );
    expect(script).not.toContain('"127.0.0.1:${NOVNC_PORT}"');
    expect(script).toContain(
      'x11vnc -display :1 -rfbport "${VNC_PORT}" -shared -forever -rfbauth "${NOVNC_PASSWD_FILE}" -localhost',
    );
  });

  it("starts a dock desktop for headed browsers and keeps Chromium off the wallpaper", async () => {
    const script = await fs.readFile(path.resolve("scripts/sandbox-browser-entrypoint.sh"), "utf8");
    const dockerfile = await fs.readFile(path.resolve("Dockerfile.sandbox-browser"), "utf8");
    const desktop = await fs.readFile(path.resolve("scripts/sandbox-browser-desktop.py"), "utf8");
    expect(script).toContain("OPENBOT_BROWSER_DESKTOP");
    expect(script).toContain("DESKTOP_ENABLED=1");
    expect(script).toContain('chromium "${CHROME_ARGS[@]}" --no-startup-window');
    expect(script).toContain('chromium "${CHROME_ARGS[@]}" about:blank');
    expect(script).toContain("export HOME=/tmp/openbot-home");
    expect(script).toContain("/tmp/openbot-desktop.log");
    expect(script).toContain("/tmp/openbot-openbox.log");
    expect(script).toContain('export SANDBOX_DESKTOP_BIN="/usr/local/bin/openbot-sandbox-desktop"');
    expect(script).toContain('ENVIRON["SANDBOX_DESKTOP_BIN"]');
    expect(script).not.toContain("/tmp/openclaw-home");
    expect(script).not.toContain("/tmp/openclaw-desktop.log");
    expect(script).not.toContain("/tmp/openclaw-openbox.log");
    expect(script).not.toContain("/usr/local/bin/openclaw-sandbox-desktop");
    expect(script).toContain("Xvfb :1 -screen 0 1280x800x24");
    expect(dockerfile).toContain("openbox");
    expect(dockerfile).toContain("python3-tk");
    expect(dockerfile).toContain("\n    thunar \\\n");
    expect(dockerfile).toContain("xdg-utils");
    expect(dockerfile).toContain("xdg-mime default thunar.desktop inode/directory");
    expect(dockerfile).toContain("xterm");
    expect(dockerfile).toContain("fonts-wqy-microhei");
    expect(dockerfile).toContain(
      "COPY --chmod=755 scripts/sandbox-browser-entrypoint.sh /usr/local/bin/openbot-sandbox-browser",
    );
    expect(dockerfile).toContain(
      "COPY --chmod=755 scripts/sandbox-browser-desktop.py /usr/local/bin/openbot-sandbox-desktop",
    );
    expect(dockerfile).toContain('CMD ["openbot-sandbox-browser"]');
    expect(dockerfile).not.toContain("openclaw-sandbox-desktop");
    expect(dockerfile).not.toContain("openclaw-sandbox-browser");
    expect(desktop).not.toContain("打开浏览器");
    expect(desktop).toContain("def open_chrome");
    expect(desktop).toContain("def open_files");
    expect(desktop).toContain("def files_argv");
    expect(desktop).toContain('shutil.which("thunar")');
    expect(desktop).toContain('shutil.which("xdg-open")');
    expect(desktop).toContain("files_start_dir()");
    expect(desktop).not.toContain("class FileWindow");
    expect(desktop).not.toContain("tk.Listbox");
    expect(desktop).not.toContain('title("文件")');
    expect(desktop).not.toContain('text="上一级"');
    expect(desktop).not.toContain("WM_DELETE_WINDOW");
    expect(desktop).toContain("def is_thunar_client");
    expect(desktop).toContain("def show_desktop");
    expect(desktop).toContain("def windows_to_hide");
    expect(desktop).toContain("def desktop_hotspots");
    expect(desktop).toContain("def hit_launcher");
    expect(desktop).toContain('WALLPAPER = "#e7e7eb"');
    expect(desktop).toContain("/usr/local/share/openbot/desktop/openbot-logo.png");
    expect(desktop).toContain("OPENBOT_BROWSER_START_URL");
    expect(desktop).not.toContain("#d9d9de");
    expect(desktop).not.toContain("#f6f6f8");
    expect(script).toContain("--disable-session-crashed-bubble");
    expect(script).toContain("--hide-crash-restore-bubble");
    expect(script).toContain("--noerrdialogs");
    expect(script).toContain("exited_cleanly");
    expect(dockerfile).toContain("CommandLineFlagSecurityWarningsEnabled");
    expect(desktop).toContain("def open_terminal");
    expect(desktop).not.toContain("NOVNC_PASSWORD");
    expect(desktop).not.toContain("#fbfbfc");
    expect(desktop).not.toContain("#ececf1");
    expect(desktop).not.toContain("#f7f4ea");
    expect(desktop).not.toContain("DOCK_SHADOW");
    expect(desktop).toContain('FOLDER_BODY = "#9a5a0a"');
    expect(desktop).toContain('FOLDER_FRONT = "#b86a0e"');
    expect(desktop).toContain('"<ButtonRelease-1>"');
    expect(desktop).toContain("create_window");
    expect(desktop).toContain("OpenBot Dock");
    expect(desktop).toContain("--window-size=");
    expect(desktop).toContain("--window-position=0,0");
    expect(desktop).toContain("overrideredirect(True)");
    expect(desktop).not.toContain("--start-maximized");
    expect(desktop).not.toContain("_NET_WM_STRUT");
    expect(desktop).toContain("def dock_click_action");
    expect(desktop).toContain("def shelf_should_show");
    expect(desktop).toContain("def sync_desktop");
    expect(desktop).toContain("def stacking_needs_app_raise");
    expect(desktop).toContain("def ensure_wallpaper_below");
    expect(desktop).toContain("--stacking-needs-raise");
    expect(desktop).toContain("dock.withdraw()");
    expect(desktop).toContain("def app_work_area");
    expect(desktop).not.toContain('"minimize"');
    expect(desktop).not.toContain("100x28+80+48");
    expect(desktop).not.toContain("640x440+180+80");
    expect(script).toContain("OpenBot Dock");
    expect(script).toContain("*hromium*");
    expect(script).toContain("<layer>above</layer>");
    expect(script).toContain("<fullscreen>no</fullscreen>");
    expect(script).toMatch(/class=\\"\*hromium\*\\"[\s\S]{0,220}<maximized>yes<\/maximized>/);
    expect(script).not.toMatch(/title=\\"文件\\"/);
    expect(script).toMatch(/class=\\"Thunar\\"[\s\S]{0,220}<maximized>yes<\/maximized>/);
    expect(script).toMatch(/name=\\"thunar\\"[\s\S]{0,220}<maximized>yes<\/maximized>/);
    expect(script).toMatch(/title=\\"\* - Thunar\\"[\s\S]{0,220}<maximized>yes<\/maximized>/);
    expect(script).toMatch(/title=\\"终端\\"[\s\S]{0,220}<maximized>yes<\/maximized>/);
    expect(script).toMatch(/class=\\"XTerm\\"[\s\S]{0,220}<maximized>yes<\/maximized>/);
    expect(script).toContain("终端");
    expect(script).toContain("xdg-mime default thunar.desktop inode/directory");
    expect(script).not.toContain("文件");
    expect(script).toContain('keybind key=\\"C-A-d\\"');
    expect(script).toContain("--show-desktop");
    expect(dockerfile).toContain("wmctrl");
    await execFileAsync("bash", ["-n", path.resolve("scripts/sandbox-browser-entrypoint.sh")]);
    await execFileAsync("python3", [
      "-m",
      "py_compile",
      path.resolve("scripts/sandbox-browser-desktop.py"),
    ]);
    const { stdout: plan } = await execFileAsync("python3", [
      path.resolve("scripts/sandbox-browser-desktop.py"),
      "--show-desktop-plan",
      "hidden:0x3",
      "Chromium",
      "Google",
      "0x2",
      "thunar.Thunar",
      "openbot-home - Thunar",
      "0x3",
      "OpenBot Desktop",
      "OpenBot Desktop",
      "0x1",
    ]);
    expect(plan.trim()).toBe("0x2");
    const { stdout: stackingOk } = await execFileAsync("python3", [
      path.resolve("scripts/sandbox-browser-desktop.py"),
      "--stacking-needs-raise",
      "stacking:0x1,0x2",
      "wallpaper:0x1",
      "app:0x2",
    ]);
    expect(stackingOk.trim()).toBe("no");
    const { stdout: stackingBad } = await execFileAsync("python3", [
      path.resolve("scripts/sandbox-browser-desktop.py"),
      "--stacking-needs-raise",
      "stacking:0x2,0x1",
      "wallpaper:0x1",
      "app:0x2",
    ]);
    expect(stackingBad.trim()).toBe("yes");
  });

  it("serves a local OpenBot start page and keeps about:blank when the dock is off", async () => {
    const script = await fs.readFile(path.resolve("scripts/sandbox-browser-entrypoint.sh"), "utf8");
    const dockerfile = await fs.readFile(path.resolve("Dockerfile.sandbox-browser"), "utf8");
    const page = await fs.readFile(path.resolve("scripts/sandbox-browser-start.html"), "utf8");
    const setup = await fs.readFile(path.resolve("scripts/sandbox-browser-setup.sh"), "utf8");
    expect(script).toContain('BROWSER_START_PAGE="/usr/local/share/openbot/desktop/index.html"');
    expect(script).toContain('export OPENBOT_BROWSER_START_URL="file://${BROWSER_START_PAGE}"');
    expect(script).toContain('export OPENBOT_BROWSER_START_URL="about:blank"');
    expect(script).toContain('chromium "${CHROME_ARGS[@]}" "${OPENBOT_BROWSER_START_URL}"');
    expect(script).toContain('chromium "${CHROME_ARGS[@]}" about:blank');
    expect(script).toContain('chromium "${CHROME_ARGS[@]}" --no-startup-window');
    expect(dockerfile).toContain(
      "COPY ui/public/openbot-logo.png /usr/local/share/openbot/desktop/openbot-logo.png",
    );
    expect(dockerfile).toContain(
      "COPY scripts/sandbox-browser-start.html /usr/local/share/openbot/desktop/index.html",
    );
    expect(page).toContain("openbot-logo.png");
    expect(page).toContain("OpenBot 云电脑");
    expect(page).toContain("#e7e7eb");
    expect(setup).toContain("Dockerfile.sandbox-browser");
    expect(setup).toContain("OPENBOT_ACCOUNT_WORKER");
    expect(setup).toContain("OPENBOT_ACCOUNT_WORKER_DOCKER");
    expect(setup).toContain("not a production cutover");
  });
});
