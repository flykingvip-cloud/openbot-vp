#!/usr/bin/env node
/**
 * Print a local HTML file to PDF with the sandbox Chromium CLI.
 *
 * Root cause this wraps (HK sandbox, 2026-10-22):
 * `chromium --headless=new --print-to-pdf` waits for document load. A single
 * http(s) subresource whose SYN is dropped (sandbox egress, CDN font, remote
 * CSS/image) sits in TCP retransmit for about 120s. The process does not
 * exit, so the exec tool reports a 120s timeout. The whole time Chromium
 * logs `Failed to connect to socket /run/dbus/system_bus_socket`. That socket
 * is absent in openbot-sandbox / openbot-sandbox-browser by design. A minimal
 * local HTML file still prints in ~10s with the same log line, so dbus is
 * noise, not the hang.
 *
 * `--virtual-time-budget` does not cap that wait on `--headless=new`.
 * `--timeout=<ms>` does: Chromium prints and exits even if a subresource
 * never responds. When a build ignores `--timeout`, a second attempt maps
 * every remote host to ~NOTFOUND so load can finish and the PDF still has
 * selectable text. Inline SVG and local fonts are unchanged.
 *
 * No production flags. This does not start dbus and does not change exec policy.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_TIMEOUT_MS = 10_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 30_000;
const KILL_GRACE_MS = 2_500;
const DBUS_SOCKET_NEEDLE = "/run/dbus/system_bus_socket";

const PATH_CANDIDATES = ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"];
const PLAYWRIGHT_LAYOUTS = ["chrome-linux64/chrome", "chrome-linux/chrome"];

export function clampTimeoutMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(parsed)));
}

/**
 * Flags proven against a stalled subresource on Chrome 156 headless=new.
 * `--virtual-time-budget` is intentionally absent.
 */
export function buildChromePrintArgs({
  htmlPath,
  outPath,
  userDataDir,
  timeoutMs,
  blockRemoteHosts,
}) {
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--no-pdf-header-footer",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-sync",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--password-store=basic",
    "--disable-features=MediaRouter,Translate,DialMediaRouteProvider",
    `--timeout=${timeoutMs}`,
    `--user-data-dir=${userDataDir}`,
    `--print-to-pdf=${outPath}`,
  ];
  if (blockRemoteHosts) {
    args.push("--host-resolver-rules=MAP * ~NOTFOUND");
  }
  args.push(htmlPath);
  return args;
}

/** Point dbus at a socket that does not exist so Chromium does not retry the system bus. */
export function chromePrintEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/openbot-print-pdf-no-session-bus",
    DBUS_SYSTEM_BUS_ADDRESS: "unix:path=/tmp/openbot-print-pdf-no-system-bus",
  };
}

function isFile(filePath, exists = existsSync) {
  if (!exists(filePath)) {
    return false;
  }
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function findOnPath(pathEnv, exists) {
  const dirs = String(pathEnv ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  for (const name of PATH_CANDIDATES) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name);
      if (isFile(candidate, exists)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function findPlaywrightChrome(roots, exists, readDir) {
  const hits = [];
  for (const root of roots) {
    if (!root || !exists(root)) {
      continue;
    }
    let entries = [];
    try {
      entries = readDir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const match = /^chromium-(\d+)$/.exec(entry);
      if (!match) {
        continue;
      }
      const revision = Number(match[1]);
      for (const [rank, layout] of PLAYWRIGHT_LAYOUTS.entries()) {
        const full = path.join(root, entry, layout);
        if (isFile(full, exists)) {
          hits.push({ revision, rank, full });
        }
      }
    }
  }
  hits.sort((a, b) => b.revision - a.revision || a.rank - b.rank);
  return hits[0]?.full;
}

export function resolveChromeExecutable(options = {}) {
  const env = options.env ?? process.env;
  const exists = options.existsSync ?? existsSync;
  const readDir = options.readdirSync ?? readdirSync;
  const explicit = env.CHROME_BIN || env.OPENBOT_CHROME_BIN;
  if (explicit && isFile(explicit, exists)) {
    return explicit;
  }
  const fromPath = findOnPath(env.PATH, exists);
  if (fromPath) {
    return fromPath;
  }
  const cwd = options.cwd ?? process.cwd();
  const home = env.HOME || "";
  const roots = [
    path.join(cwd, ".pw-browsers"),
    home ? path.join(home, ".pw-browsers") : "",
    home ? path.join(home, ".cache", "ms-playwright") : "",
  ];
  return findPlaywrightChrome(roots, exists, readDir);
}

function countDbusNoise(stderr) {
  return String(stderr ?? "")
    .split(/\r?\n/)
    .filter((line) => line.includes(DBUS_SOCKET_NEEDLE)).length;
}

function pdfBytes(outPath) {
  try {
    const size = statSync(outPath).size;
    return size > 0 ? size : 0;
  } catch {
    return 0;
  }
}

function killProcessGroup(child) {
  if (!child?.pid) {
    return;
  }
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // The group is already gone, or this platform rejected the negative pid.
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // already exited
  }
}

function runChromeOnce({ chromeBin, args, env, timeoutMs, spawnImpl }) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawnImpl(chromeBin, args, {
      env,
      detached: process.platform !== "win32",
      // Ignore stdout. An unread pipe fills and Chromium blocks before it can print.
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const finish = (outcome) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        ...outcome,
        stderr,
        dbusNoiseLines: countDbusNoise(stderr),
        elapsedMs: Date.now() - started,
      });
    };
    const timer = setTimeout(() => {
      killProcessGroup(child);
      finish({ exitCode: null, timedOut: true, signal: "SIGKILL" });
    }, timeoutMs + KILL_GRACE_MS);
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 64_000) {
        stderr = stderr.slice(-64_000);
      }
    });
    child.on("error", (error) => {
      killProcessGroup(child);
      finish({ exitCode: null, timedOut: false, signal: null, error: error.message });
    });
    child.on("close", (exitCode, signal) => {
      finish({ exitCode, timedOut: false, signal: signal ?? null });
    });
  });
}

/**
 * @returns {Promise<{
 *   ok: boolean,
 *   outPath: string,
 *   bytes: number,
 *   elapsedMs: number,
 *   attempts: number,
 *   blockedRemoteHosts: boolean,
 *   dbusNoiseLines: number,
 *   chromeBin: string,
 *   args: string[],
 *   error?: string,
 * }>}
 */
export async function printHtmlToPdf(options) {
  const htmlPath = path.resolve(options.htmlPath);
  const outPath = path.resolve(options.outPath);
  const timeoutMs = clampTimeoutMs(options.timeoutMs);
  const spawnImpl = options.spawnImpl ?? spawn;
  const env = chromePrintEnv(options.env ?? process.env);
  if (!existsSync(htmlPath)) {
    return {
      ok: false,
      outPath,
      bytes: 0,
      elapsedMs: 0,
      attempts: 0,
      blockedRemoteHosts: false,
      dbusNoiseLines: 0,
      chromeBin: "",
      args: [],
      error: `html not found: ${htmlPath}`,
    };
  }
  const chromeBin = options.chromeBin || resolveChromeExecutable({ env, cwd: options.cwd });
  if (!chromeBin) {
    return {
      ok: false,
      outPath,
      bytes: 0,
      elapsedMs: 0,
      attempts: 0,
      blockedRemoteHosts: false,
      dbusNoiseLines: 0,
      chromeBin: "",
      args: [],
      error:
        "no Chromium/Chrome executable (looked for CHROME_BIN, chromium, google-chrome-stable, Playwright .pw-browsers)",
    };
  }
  mkdirSync(path.dirname(outPath), { recursive: true });
  const attempts = [
    { blockRemoteHosts: false, timeoutMs },
    { blockRemoteHosts: true, timeoutMs: Math.min(timeoutMs, 5_000) },
  ];
  let dbusNoiseLines = 0;
  let elapsedMs = 0;
  let lastArgs = [];
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    const userDataDir = mkdtempSync(path.join(tmpdir(), "openbot-print-pdf-"));
    rmSync(outPath, { force: true });
    const args = buildChromePrintArgs({
      htmlPath,
      outPath,
      userDataDir,
      timeoutMs: attempt.timeoutMs,
      blockRemoteHosts: attempt.blockRemoteHosts,
    });
    lastArgs = args;
    const run = await runChromeOnce({
      chromeBin,
      args,
      env,
      timeoutMs: attempt.timeoutMs,
      spawnImpl,
    });
    elapsedMs += run.elapsedMs;
    dbusNoiseLines += run.dbusNoiseLines;
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // The profile dir can still be busy for a moment after SIGKILL.
    }
    const bytes = pdfBytes(outPath);
    if (run.exitCode === 0 && !run.timedOut && bytes > 0) {
      return {
        ok: true,
        outPath,
        bytes,
        elapsedMs,
        attempts: index + 1,
        blockedRemoteHosts: attempt.blockRemoteHosts,
        dbusNoiseLines,
        chromeBin,
        args,
      };
    }
  }
  return {
    ok: false,
    outPath,
    bytes: pdfBytes(outPath),
    elapsedMs,
    attempts: attempts.length,
    blockedRemoteHosts: true,
    dbusNoiseLines,
    chromeBin,
    args: lastArgs,
    error:
      "headless print did not produce a PDF. A stalled http(s) subresource makes --print-to-pdf wait through TCP retransmit (~120s). dbus system_bus_socket errors are non-fatal sandbox noise.",
  };
}

export function formatPrintResult(result) {
  if (result.ok) {
    const lines = [
      `print-pdf: ok bytes=${result.bytes} ms=${result.elapsedMs} out=${result.outPath} attempts=${result.attempts}`,
    ];
    if (result.blockedRemoteHosts) {
      lines.push(
        "print-pdf: note: remote subresources stalled, so the reprint blocked them with --host-resolver-rules. External images or CSS may be missing; body text is still in the PDF.",
      );
    }
    if (result.dbusNoiseLines > 0) {
      lines.push(
        `print-pdf: note: ${result.dbusNoiseLines} line(s) of Failed to connect to socket /run/dbus/system_bus_socket. The sandbox has no system bus. That log is not a print failure.`,
      );
    }
    return lines.join("\n");
  }
  return [
    `print-pdf: failed attempts=${result.attempts} ms=${result.elapsedMs}`,
    `print-pdf: ${result.error ?? "unknown error"}`,
  ].join("\n");
}

function parseCli(argv) {
  const opts = { timeoutMs: undefined, htmlPath: "", outPath: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--html") {
      opts.htmlPath = argv[++i] ?? "";
    } else if (token === "--out") {
      opts.outPath = argv[++i] ?? "";
    } else if (token === "--timeout-ms") {
      opts.timeoutMs = argv[++i];
    } else if (token === "--help" || token === "-h") {
      opts.help = true;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return opts;
}

function isCliEntry() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isCliEntry()) {
  try {
    const cli = parseCli(process.argv.slice(2));
    if (cli.help || !cli.htmlPath || !cli.outPath) {
      process.stderr.write(
        "usage: node print-pdf.mjs --html page.html --out out.pdf [--timeout-ms 10000]\n",
      );
      process.exit(cli.help ? 0 : 2);
    }
    const result = await printHtmlToPdf({
      htmlPath: cli.htmlPath,
      outPath: cli.outPath,
      timeoutMs: cli.timeoutMs,
    });
    const text = formatPrintResult(result);
    if (result.ok) {
      process.stdout.write(`${text}\n`);
      process.exit(0);
    }
    process.stderr.write(`${text}\n`);
    process.exit(result.chromeBin ? 4 : 3);
  } catch (error) {
    process.stderr.write(`print-pdf: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}
