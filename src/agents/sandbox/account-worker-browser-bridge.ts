/**
 * Attach a browser-control bridge to the Account Worker desktop container.
 *
 * The worker already started that container and published the noVNC preview.
 * This module does not create a second desktop. It points the existing
 * attach-only bridge at the container's published CDP port so the `browser`
 * tool can navigate and click the same screen the Computer tab shows.
 */
import crypto from "node:crypto";
import { registerAccountBrowserCdpPort } from "../../browser/account-browser-namespace.js";
import { startBrowserBridgeServer, stopBrowserBridgeServer } from "../../browser/bridge-server.js";
import { CLOUD_PC_CONTROL_STARTING_TOOL_ERROR } from "../../browser/cloud-pc-control-copy.js";
import { resolveProfile } from "../../browser/config.js";
import { DEFAULT_BROWSER_EVALUATE_ENABLED } from "../../browser/constants.js";
import { ensureBrowserControlAuth, resolveBrowserControlAuth } from "../../browser/control-auth.js";
import { BrowserProfileUnavailableError } from "../../browser/errors.js";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { resolveAccountBrowserScopeKey } from "./account-scope.js";
import { isAccountWorkerDockerDriverEnabled } from "./account-worker-driver.js";
import { BROWSER_BRIDGES } from "./browser-bridges.js";
import { buildSandboxBrowserResolvedConfig, waitForSandboxCdp } from "./browser.js";
import { DEFAULT_SANDBOX_BROWSER_CDP_PORT } from "./constants.js";
import type { SandboxBrowserContext } from "./types.js";

/**
 * In-request CDP probe. Must finish well under the browser tool's 15s client
 * abort (`browserStart` / `browserOpenTab`), or the client reports the bridge
 * as unreachable while noVNC is already serving the desktop.
 */
export const ACCOUNT_WORKER_CDP_PROBE_MS = 2_000;
/** Background Chrome boot. Does not block preview publish or the agent turn. */
const ACCOUNT_WORKER_CDP_PREWARM_MS = 45_000;

const cdpPrewarms = new Map<string, Promise<boolean>>();
const cdpPrewarmAborts = new Map<string, AbortController>();

function cdpPrewarmKey(containerName: string, cdpPort: number): string {
  return `${containerName}:${cdpPort}`;
}

/** Drop background CDP waits. Tests call this so a closed port is not polled. */
export function resetAccountWorkerCdpPrewarmForTests(): void {
  for (const ctrl of cdpPrewarmAborts.values()) {
    ctrl.abort();
  }
  cdpPrewarmAborts.clear();
  cdpPrewarms.clear();
}

/**
 * Poll CDP off the request path as soon as the published port is known.
 * Preview (noVNC) does not wait for this. A later tool call reuses the wait.
 */
export function primeAccountWorkerBrowserCdp(containerName: string, cdpPort: number): void {
  const key = cdpPrewarmKey(containerName, cdpPort);
  if (cdpPrewarms.has(key)) {
    return;
  }
  const ctrl = new AbortController();
  cdpPrewarmAborts.set(key, ctrl);
  const pending = waitForSandboxCdp({
    cdpPort,
    timeoutMs: ACCOUNT_WORKER_CDP_PREWARM_MS,
    signal: ctrl.signal,
  });
  cdpPrewarms.set(key, pending);
  void pending.finally(() => {
    if (cdpPrewarms.get(key) === pending) {
      cdpPrewarms.delete(key);
    }
    if (cdpPrewarmAborts.get(key) === ctrl) {
      cdpPrewarmAborts.delete(key);
    }
  });
}

async function probeAccountWorkerCdp(containerName: string, cdpPort: number): Promise<boolean> {
  const pending = cdpPrewarms.get(cdpPrewarmKey(containerName, cdpPort));
  if (!pending) {
    return await waitForSandboxCdp({ cdpPort, timeoutMs: ACCOUNT_WORKER_CDP_PROBE_MS });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const probeExpired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ACCOUNT_WORKER_CDP_PROBE_MS);
  });
  try {
    return await Promise.race([pending, probeExpired]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export type AccountWorkerBrowserControlAttachParams = {
  tenantId: string;
  userId: string;
  containerName: string;
  config?: OpenBotConfig;
  env?: NodeJS.ProcessEnv;
  /** Test seam. Production reads the docker port map. */
  readCdpPort?: (containerName: string, containerPort: number) => Promise<number | null>;
};

type Attacher = (
  params: AccountWorkerBrowserControlAttachParams,
) => Promise<SandboxBrowserContext | null>;

export type AccountWorkerBrowserControlResolution =
  | { status: "attached"; browser: SandboxBrowserContext }
  | { status: "unavailable"; reason: string }
  | { status: "skipped" };

let attacherForTests: Attacher | null = null;

export function setAccountWorkerBrowserControlAttacherForTests(next: Attacher | null): void {
  attacherForTests = next;
}

async function defaultReadCdpPort(
  containerName: string,
  containerPort: number,
): Promise<number | null> {
  try {
    const { readDockerPort } = await import("./docker.js");
    return await readDockerPort(containerName, containerPort);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The docker flag can be on in tests that only stub the preview reader.
    // Missing docker means there is no control port to attach.
    if (/docker/i.test(message) && /not found/i.test(message)) {
      return null;
    }
    throw error;
  }
}

async function resolveBridgeAuth(params: {
  config?: OpenBotConfig;
  env?: NodeJS.ProcessEnv;
  existingToken?: string;
  existingPassword?: string;
}): Promise<{ token?: string; password?: string }> {
  const cfg = params.config ?? loadConfig();
  const env = params.env ?? process.env;
  let auth = resolveBrowserControlAuth(cfg, env);
  try {
    const ensured = await ensureBrowserControlAuth({ cfg, env });
    auth = ensured.auth;
  } catch {
    // Keep the resolved auth. The bridge still requires a token below.
  }
  let token = auth.token?.trim() || undefined;
  let password = auth.password?.trim() || undefined;
  if (!token && !password) {
    token = params.existingToken?.trim() || crypto.randomBytes(24).toString("hex");
    password = params.existingPassword?.trim() || undefined;
  }
  return { token, password };
}

/**
 * Start or reuse the loopback control bridge for this user's browser container.
 * Returns null when the CDP port is not published yet.
 */
export async function attachAccountWorkerBrowserControl(
  params: AccountWorkerBrowserControlAttachParams,
): Promise<SandboxBrowserContext | null> {
  const containerName = params.containerName.trim();
  const tenantId = params.tenantId.trim();
  const userId = params.userId.trim();
  if (!containerName || !tenantId || !userId) {
    return null;
  }
  const readCdpPort = params.readCdpPort ?? defaultReadCdpPort;
  const mappedCdp = await readCdpPort(containerName, DEFAULT_SANDBOX_BROWSER_CDP_PORT);
  if (!mappedCdp) {
    return null;
  }
  // Chrome boot overlaps bridge setup. The Computer tab does not wait on CDP.
  primeAccountWorkerBrowserCdp(containerName, mappedCdp);

  const scopeKey = resolveAccountBrowserScopeKey({ tenantId, userId });
  // Persist host CDP in the in-process map so gate probes / fill survive only
  // having BROWSER_BRIDGES — and so rediscovery after restart can re-seed peek.
  registerAccountBrowserCdpPort(scopeKey, mappedCdp);
  const existing = BROWSER_BRIDGES.get(scopeKey);
  const existingProfile = existing
    ? resolveProfile(existing.bridge.state.resolved, existing.bridge.state.resolved.defaultProfile)
    : null;
  if (
    existing &&
    existing.containerName === containerName &&
    existingProfile?.cdpPort === mappedCdp
  ) {
    return { bridgeUrl: existing.bridge.baseUrl, containerName };
  }
  if (existing) {
    await stopBrowserBridgeServer(existing.bridge.server).catch(() => undefined);
    BROWSER_BRIDGES.delete(scopeKey);
  }

  const auth = await resolveBridgeAuth({
    config: params.config,
    env: params.env,
    existingToken: existing?.authToken,
    existingPassword: existing?.authPassword,
  });
  const evaluateEnabled =
    params.config?.browser?.evaluateEnabled ?? DEFAULT_BROWSER_EVALUATE_ENABLED;
  const bridge = await startBrowserBridgeServer({
    resolved: buildSandboxBrowserResolvedConfig({
      controlPort: 0,
      cdpPort: mappedCdp,
      headless: false,
      evaluateEnabled,
      accountComputerWorkArea: true,
    }),
    authToken: auth.token,
    authPassword: auth.password,
    onEnsureAttachTarget: async () => {
      const ready = await probeAccountWorkerCdp(containerName, mappedCdp);
      if (!ready) {
        primeAccountWorkerBrowserCdp(containerName, mappedCdp);
        throw new BrowserProfileUnavailableError(CLOUD_PC_CONTROL_STARTING_TOOL_ERROR);
      }
    },
  });
  BROWSER_BRIDGES.set(scopeKey, {
    bridge,
    containerName,
    authToken: auth.token,
    authPassword: auth.password,
  });
  return { bridgeUrl: bridge.baseUrl, containerName };
}

/**
 * Docker driver attaches the real bridge. Tests may substitute an attacher.
 * Memory-driver runs (no docker flag, no test attacher) leave control unwired.
 */
export async function resolveAccountWorkerBrowserControl(
  params: AccountWorkerBrowserControlAttachParams,
): Promise<AccountWorkerBrowserControlResolution> {
  if (attacherForTests) {
    const browser = await attacherForTests(params);
    if (!browser) {
      return { status: "unavailable", reason: "CDP port not published" };
    }
    return { status: "attached", browser };
  }
  if (!isAccountWorkerDockerDriverEnabled(params.env)) {
    return { status: "skipped" };
  }
  const browser = await attachAccountWorkerBrowserControl(params);
  if (!browser) {
    return { status: "unavailable", reason: "CDP port not published" };
  }
  return { status: "attached", browser };
}
