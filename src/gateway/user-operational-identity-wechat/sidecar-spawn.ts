import { spawn, type ChildProcess } from "node:child_process";
import { isLoopbackHttpUrl } from "./loopback.js";
import { WECHAT_WORKER_OFFLINE_ERROR } from "./worker-contract.js";

export const WECHAT_SIDECAR_SPAWN_TRIES = 8;
export const WECHAT_SIDECAR_SPAWN_INTERVAL_MS = 350;

export type WechatSidecarLaunchSpec = {
  proxyUrl: string;
  command?: string;
  args?: string[];
  cwd?: string | null;
};

export type WechatSidecarProbe = {
  ok: boolean;
  online: boolean;
  error?: string;
};

export type WechatSidecarSpawnFn = (spec: {
  command: string;
  args: string[];
  cwd?: string | null;
}) => boolean;

let spawned: ChildProcess | undefined;
let spawnImpl: WechatSidecarSpawnFn | undefined;

function collectErrnos(error: unknown, into = new Set<string>()): Set<string> {
  if (!error || typeof error !== "object") {
    return into;
  }
  const rec = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof rec.code === "string") {
    into.add(rec.code);
  }
  if (rec.cause) {
    collectErrnos(rec.cause, into);
  }
  if (Array.isArray(rec.errors)) {
    for (const item of rec.errors) {
      collectErrnos(item, into);
    }
  }
  return into;
}

export function formatWechatSidecarProbeError(error: unknown): string {
  const codes = collectErrnos(error);
  if (codes.has("ECONNREFUSED")) {
    return "connect ECONNREFUSED";
  }
  if (codes.has("EHOSTUNREACH") || codes.has("ENETUNREACH")) {
    return "connect EHOSTUNREACH";
  }
  if (codes.has("ENOTFOUND") || codes.has("EAI_AGAIN")) {
    return "getaddrinfo ENOTFOUND";
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return WECHAT_WORKER_OFFLINE_ERROR;
}

export function isWechatSidecarUnreachableProbe(probe: WechatSidecarProbe): boolean {
  if (probe.online) {
    return false;
  }
  const err = (probe.error ?? "").toLowerCase();
  return (
    err.includes("econnrefused") ||
    err.includes("ehostunreach") ||
    err.includes("enetunreach") ||
    err.includes("enotfound") ||
    err.includes("fetch failed")
  );
}

export function shouldSpawnWechatSidecar(
  spec: WechatSidecarLaunchSpec,
  probe: WechatSidecarProbe,
): boolean {
  const command = spec.command?.trim() ?? "";
  if (!command.startsWith("/")) {
    return false;
  }
  if (probe.online) {
    return false;
  }
  if (!isLoopbackHttpUrl(spec.proxyUrl)) {
    return false;
  }
  return isWechatSidecarUnreachableProbe(probe);
}

export function setWechatSidecarSpawnForTests(fn: WechatSidecarSpawnFn | null): void {
  spawnImpl = fn ?? undefined;
  if (fn === null) {
    spawned = undefined;
  }
}

export function resetWechatSidecarSpawnForTests(): void {
  spawnImpl = undefined;
  spawned = undefined;
}

function defaultSpawn(spec: { command: string; args: string[]; cwd?: string | null }): boolean {
  if (spawned && spawned.exitCode === null && !spawned.killed) {
    return false;
  }
  try {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd ?? undefined,
      env: process.env,
      stdio: "ignore",
      shell: false,
      windowsHide: true,
    });
    child.on("error", () => {
      // fail-closed; do not log argv (secrets live in inherited env, never print it)
    });
    spawned = child;
    return true;
  } catch {
    return false;
  }
}

export function spawnLocalWechatSidecarIfNeeded(spec: {
  command: string;
  args?: string[];
  cwd?: string | null;
}): boolean {
  const command = spec.command.trim();
  if (!command.startsWith("/")) {
    return false;
  }
  const launch = { command, args: spec.args ?? [], cwd: spec.cwd };
  if (spawnImpl) {
    return spawnImpl(launch);
  }
  return defaultSpawn(launch);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function ensureLocalWechatSidecarRunning(opts: {
  spec: WechatSidecarLaunchSpec;
  probe: () => Promise<WechatSidecarProbe>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<WechatSidecarProbe> {
  const first = await opts.probe();
  if (!shouldSpawnWechatSidecar(opts.spec, first)) {
    return first;
  }
  spawnLocalWechatSidecarIfNeeded({
    command: opts.spec.command!.trim(),
    args: opts.spec.args ?? [],
    cwd: opts.spec.cwd,
  });
  const sleep = opts.sleep ?? defaultSleep;
  let last = first;
  for (let i = 0; i < WECHAT_SIDECAR_SPAWN_TRIES; i += 1) {
    await sleep(WECHAT_SIDECAR_SPAWN_INTERVAL_MS);
    last = await opts.probe();
    if (last.online) {
      return last;
    }
    if (!isWechatSidecarUnreachableProbe(last)) {
      return last;
    }
  }
  return last;
}
