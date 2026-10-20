#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertP1BundlesFullPorts,
  formatOpenBotSurfaceSelection,
  resolveOpenBotSurface,
  selectPortsForSurface,
} from "./openbot-surface.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const uiDir = path.join(repoRoot, "ui");

const WINDOWS_SHELL_EXTENSIONS = new Set([".cmd", ".bat", ".com"]);
const WINDOWS_UNSAFE_SHELL_ARG_PATTERN = /[\r\n"&|<>^%!]/;

function usage() {
  // keep this tiny; it's invoked from npm scripts too
  process.stderr.write("Usage: node scripts/ui.js <install|dev|build|test> [...args]\n");
}

function which(cmd) {
  try {
    const key = process.platform === "win32" ? "Path" : "PATH";
    const paths = (process.env[key] ?? process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean);
    const extensions =
      process.platform === "win32"
        ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
        : [""];
    for (const entry of paths) {
      for (const ext of extensions) {
        const candidate = path.join(entry, process.platform === "win32" ? `${cmd}${ext}` : cmd);
        try {
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function resolveRunner() {
  const pnpm = which("pnpm");
  if (pnpm) {
    return { cmd: pnpm, kind: "pnpm" };
  }
  return null;
}

export function shouldUseShellForCommand(cmd, platform = process.platform) {
  if (platform !== "win32") {
    return false;
  }
  const extension = path.extname(cmd).toLowerCase();
  return WINDOWS_SHELL_EXTENSIONS.has(extension);
}

export function assertSafeWindowsShellArgs(args, platform = process.platform) {
  if (platform !== "win32") {
    return;
  }
  const unsafeArg = args.find((arg) => WINDOWS_UNSAFE_SHELL_ARG_PATTERN.test(arg));
  if (!unsafeArg) {
    return;
  }
  // SECURITY: `shell: true` routes through cmd.exe; reject risky metacharacters
  // in forwarded args to prevent shell control-flow/env-expansion injection.
  throw new Error(
    `Unsafe Windows shell argument: ${unsafeArg}. Remove shell metacharacters (" & | < > ^ % !).`,
  );
}

function createSpawnOptions(cmd, args, envOverride) {
  const useShell = shouldUseShellForCommand(cmd);
  if (useShell) {
    assertSafeWindowsShellArgs(args);
  }
  return {
    cwd: uiDir,
    stdio: "inherit",
    env: envOverride ?? process.env,
    ...(useShell ? { shell: true } : {}),
  };
}

function run(cmd, args) {
  let child;
  try {
    child = spawn(cmd, args, createSpawnOptions(cmd, args));
  } catch (err) {
    console.error(`Failed to launch ${cmd}:`, err);
    process.exit(1);
    return;
  }

  child.on("error", (err) => {
    console.error(`Failed to launch ${cmd}:`, err);
    process.exit(1);
  });
  child.on("exit", (code) => {
    if (code !== 0) {
      process.exit(code ?? 1);
    }
  });
}

function runSync(cmd, args, envOverride) {
  let result;
  try {
    result = spawnSync(cmd, args, createSpawnOptions(cmd, args, envOverride));
  } catch (err) {
    console.error(`Failed to launch ${cmd}:`, err);
    process.exit(1);
    return;
  }
  if (result.signal) {
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveConfiguredControlUiRoot() {
  try {
    const stateDir = process.env.OPENBOT_STATE_DIR?.trim() || path.join(os.homedir(), ".openbot");
    const configPath = path.join(stateDir, "openbot.json");
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const root = raw?.gateway?.controlUi?.root;
    if (typeof root === "string" && root.trim()) {
      return path.resolve(root.trim());
    }
  } catch {
    // Config missing or unreadable — skip sync.
  }
  return null;
}

/**
 * Local gateways often set gateway.controlUi.root to ~/.openbot/control-ui.
 * Vite writes to dist/control-ui; without this copy the running gateway keeps
 * serving a stale bundle (e.g. roster-only @ candidates that never open in
 * assistant / 大白管家 composers).
 */
function syncBuiltControlUiToConfiguredRoot() {
  const dest = resolveConfiguredControlUiRoot();
  const src = path.join(repoRoot, "dist", "control-ui");
  if (!dest) {
    return;
  }
  if (path.resolve(dest) === path.resolve(src)) {
    return;
  }
  if (!fs.existsSync(path.join(src, "index.html"))) {
    return;
  }
  // Optional pin (written by a tip/debug sync) blocks other worktree ui:build
  // from silently rolling ~/.openbot/control-ui back to an older hashed CSS.
  const pinPath = path.join(dest, ".control-ui-sync-pin");
  if (fs.existsSync(pinPath) && process.env.OPENBOT_CONTROL_UI_FORCE_SYNC !== "1") {
    const pin = fs.readFileSync(pinPath, "utf8").trim();
    process.stdout.write(
      `Skipped Control UI sync — pin active (${pin}). Set OPENBOT_CONTROL_UI_FORCE_SYNC=1 to override.\n`,
    );
    return;
  }
  fs.cpSync(src, dest, { recursive: true });
  process.stdout.write(`Synced Control UI → gateway.controlUi.root (${dest})\n`);
}

function depsInstalled(kind) {
  try {
    const require = createRequire(path.join(uiDir, "package.json"));
    require.resolve("vite");
    require.resolve("dompurify");
    if (kind === "test") {
      require.resolve("vitest");
      require.resolve("@vitest/browser-playwright");
      require.resolve("playwright");
    }
    return true;
  } catch {
    return false;
  }
}

function resolveScriptAction(action) {
  if (action === "install") {
    return null;
  }
  if (action === "dev") {
    return "dev";
  }
  if (action === "build") {
    return "build";
  }
  if (action === "test") {
    return "test";
  }
  return null;
}

export function main(argv = process.argv.slice(2)) {
  const [action, ...rest] = argv;
  if (!action) {
    usage();
    process.exit(2);
  }

  const runner = resolveRunner();
  if (!runner) {
    process.stderr.write("Missing UI runner: install pnpm, then retry.\n");
    process.exit(1);
  }

  const script = resolveScriptAction(action);
  if (action !== "install" && !script) {
    usage();
    process.exit(2);
  }

  if (action === "build") {
    const surface = resolveOpenBotSurface(process.env.OPENBOT_SURFACE);
    const ports = assertP1BundlesFullPorts(surface, selectPortsForSurface(surface));
    process.stdout.write(`${formatOpenBotSurfaceSelection(surface, ports)}\n`);
  }

  if (action === "install") {
    run(runner.cmd, ["install", ...rest]);
    return;
  }

  if (!depsInstalled(action === "test" ? "test" : "build")) {
    const installEnv =
      action === "build" ? { ...process.env, NODE_ENV: "production" } : process.env;
    const installArgs = action === "build" ? ["install", "--prod"] : ["install"];
    runSync(runner.cmd, installArgs, installEnv);
  }

  if (action === "build") {
    let child;
    try {
      child = spawn(
        runner.cmd,
        ["run", script, ...rest],
        createSpawnOptions(runner.cmd, ["run", script, ...rest]),
      );
    } catch (err) {
      console.error(`Failed to launch ${runner.cmd}:`, err);
      process.exit(1);
      return;
    }
    child.on("error", (err) => {
      console.error(`Failed to launch ${runner.cmd}:`, err);
      process.exit(1);
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        process.exit(code ?? 1);
        return;
      }
      try {
        syncBuiltControlUiToConfiguredRoot();
      } catch (err) {
        console.error("Failed to sync Control UI to gateway.controlUi.root:", err);
        process.exit(1);
        return;
      }
      process.exit(0);
    });
    return;
  }

  run(runner.cmd, ["run", script, ...rest]);
}

const isDirectExecution = (() => {
  const entry = process.argv[1];
  return Boolean(entry && path.resolve(entry) === fileURLToPath(import.meta.url));
})();

if (isDirectExecution) {
  main();
}
