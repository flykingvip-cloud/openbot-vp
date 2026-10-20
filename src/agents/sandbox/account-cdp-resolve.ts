/**
 * Resolve the account browser CDP URL for Secure Form fill / handoff gate probe.
 *
 * After a gateway restart, in-memory `reservedPorts` and `BROWSER_BRIDGES` are
 * empty even though the Account Worker Docker container still publishes CDP.
 * Callers must rediscover (reattach) instead of fail-closed forever.
 */
import {
  peekAccountBrowserCdpPort,
  registerAccountBrowserCdpPort,
} from "../../browser/account-browser-namespace.js";
import { DEFAULT_OPENCLAW_BROWSER_PROFILE_NAME } from "../../browser/constants.js";
import { resolveAccountBrowserScopeKey } from "./account-scope.js";
import { BROWSER_BRIDGES } from "./browser-bridges.js";
import { DEFAULT_SANDBOX_BROWSER_CDP_PORT } from "./constants.js";

export type AccountCdpIdentity = { tenantId: string; userId: string };

type RediscoverFn = (account: AccountCdpIdentity) => Promise<number | null>;

let rediscoverOverride: RediscoverFn | null = null;
const inFlight = new Map<string, Promise<number | null>>();

/** Test seam: inject rediscovery without Docker / worker journal. */
export function setAccountCdpRediscoverForTests(next: RediscoverFn | null): void {
  rediscoverOverride = next;
}

export function resetAccountCdpResolveForTests(): void {
  rediscoverOverride = null;
  inFlight.clear();
}

function cdpUrlFromPort(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** Sync read of in-process maps only (no Docker). */
export function peekAccountCdpUrlFromMemory(account: AccountCdpIdentity): string | null {
  const scopeKey = resolveAccountBrowserScopeKey(account);
  const peeked = peekAccountBrowserCdpPort(scopeKey);
  if (typeof peeked === "number" && peeked > 0) {
    return cdpUrlFromPort(peeked);
  }
  const bridgeEntry = BROWSER_BRIDGES.get(scopeKey);
  const profile =
    bridgeEntry?.bridge.state.resolved.profiles?.[DEFAULT_OPENCLAW_BROWSER_PROFILE_NAME];
  const port = profile?.cdpPort;
  if (typeof port === "number" && port > 0) {
    // Re-bind peek so later probes do not depend solely on the bridge map.
    registerAccountBrowserCdpPort(scopeKey, port);
    return cdpUrlFromPort(port);
  }
  return null;
}

async function defaultRediscover(account: AccountCdpIdentity): Promise<number | null> {
  const scopeKey = resolveAccountBrowserScopeKey(account);
  // Prefer full control reattach (fills BROWSER_BRIDGES + registers CDP).
  try {
    const { tryAttachRunningAccountComputerBrowser } =
      await import("./account-computer-running-attach.js");
    await tryAttachRunningAccountComputerBrowser({
      tenantId: account.tenantId,
      userId: account.userId,
    });
  } catch {
    // Soft: keep trying light docker rediscovery below.
  }
  const afterAttach = peekAccountBrowserCdpPort(scopeKey);
  if (typeof afterAttach === "number" && afterAttach > 0) {
    return afterAttach;
  }
  const fromBridge = peekAccountCdpUrlFromMemory(account);
  if (fromBridge) {
    const peeked = peekAccountBrowserCdpPort(scopeKey);
    if (typeof peeked === "number" && peeked > 0) {
      return peeked;
    }
  }

  // Light path: journal + docker port map without requiring bridge start success.
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { SANDBOX_STATE_DIR } = await import("./constants.js");
    const { readDockerPort } = await import("./docker.js");
    const statePath = path.join(
      SANDBOX_STATE_DIR,
      "account-worker",
      "workers",
      account.tenantId.trim(),
      account.userId.trim(),
      "worker.json",
    );
    const raw = await fs.readFile(statePath, "utf8");
    const journal = JSON.parse(raw) as {
      version?: number;
      phase?: string;
      browserContainerName?: string | null;
    };
    if (journal.version !== 1 || journal.phase !== "RUNNING") {
      return null;
    }
    const containerName = journal.browserContainerName?.trim() ?? "";
    if (!containerName) {
      return null;
    }
    const mapped = await readDockerPort(containerName, DEFAULT_SANDBOX_BROWSER_CDP_PORT);
    if (!mapped || mapped <= 0) {
      return null;
    }
    registerAccountBrowserCdpPort(scopeKey, mapped);
    return mapped;
  } catch {
    return null;
  }
}

/**
 * When memory maps are empty, rediscover the published host CDP port and
 * register it. Dedupes concurrent callers per account scope.
 */
export async function ensureAccountBrowserCdpPort(
  account: AccountCdpIdentity,
): Promise<number | null> {
  const scopeKey = resolveAccountBrowserScopeKey(account);
  const existing = peekAccountBrowserCdpPort(scopeKey);
  if (typeof existing === "number" && existing > 0) {
    return existing;
  }
  const memUrl = peekAccountCdpUrlFromMemory(account);
  if (memUrl) {
    return peekAccountBrowserCdpPort(scopeKey) ?? null;
  }

  let pending = inFlight.get(scopeKey);
  if (!pending) {
    const rediscover = rediscoverOverride ?? defaultRediscover;
    pending = (async () => {
      try {
        const port = await rediscover(account);
        if (typeof port === "number" && port > 0) {
          registerAccountBrowserCdpPort(scopeKey, port);
          return port;
        }
        return null;
      } catch {
        return null;
      }
    })().finally(() => {
      if (inFlight.get(scopeKey) === pending) {
        inFlight.delete(scopeKey);
      }
    });
    inFlight.set(scopeKey, pending);
  }
  return pending;
}

/** Resolve CDP HTTP base URL, rediscovering after gateway restart when needed. */
export async function resolveAccountBrowserCdpUrl(
  account: AccountCdpIdentity,
): Promise<string | null> {
  const fromMem = peekAccountCdpUrlFromMemory(account);
  if (fromMem) {
    return fromMem;
  }
  const port = await ensureAccountBrowserCdpPort(account);
  if (typeof port === "number" && port > 0) {
    return cdpUrlFromPort(port);
  }
  return null;
}
