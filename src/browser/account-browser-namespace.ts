/**
 * Account browser namespace (Account Computer v4.1 §5).
 *
 * One profile directory per tenantId + userId. Processes are recyclable on
 * that directory. CDP ports live only for the process lifetime and are never
 * written into the global 18800–18899 profile table.
 */
import fs from "node:fs/promises";
import net from "node:net";
import {
  ensureSandboxRuntimeOwnership,
  type SandboxOwnershipOptions,
} from "../agents/sandbox/sandbox-runtime-ownership.js";
import { isSharedTenantAddressingEnabled } from "../config/data-space.js";
import type { OpenBotConfig } from "../config/types.js";
import {
  resolveAccountBrowserProfileDirForContext,
  resolveAccountExecutionPaths,
  type AccountExecutionPaths,
} from "../gateway/account-execution-paths.js";
import type { TenantContext } from "../gateway/tenant-context.js";

export const GLOBAL_BROWSER_CDP_POOL_START = 18800;
export const GLOBAL_BROWSER_CDP_POOL_END = 18899;

export class AccountBrowserProfileOverrideError extends Error {
  readonly code = "ACCOUNT_BROWSER_PROFILE_OVERRIDE_REJECTED";

  constructor() {
    super(
      "Multitenant browser profile is derived from the server tenant context. Client profile, profilePath, and user-data overrides are rejected.",
    );
    this.name = "AccountBrowserProfileOverrideError";
  }
}

const reservedPorts = new Map<string, number>();
const reservedPortHolders = new Map<number, string>();
let cdpExitHookArmed = false;

/** Release every in-process CDP holder. Wired to `process` exit. */
export function releaseAccountBrowserCdpPortsOnExit(): void {
  let next = reservedPorts.keys().next();
  while (!next.done) {
    releaseAccountBrowserCdpPort(next.value);
    next = reservedPorts.keys().next();
  }
}

function armAccountBrowserCdpExitHook(): void {
  if (cdpExitHookArmed) {
    return;
  }
  cdpExitHookArmed = true;
  process.once("exit", releaseAccountBrowserCdpPortsOnExit);
}

export function isGlobalBrowserCdpPoolPort(port: number): boolean {
  return port >= GLOBAL_BROWSER_CDP_POOL_START && port <= GLOBAL_BROWSER_CDP_POOL_END;
}

export function isMultitenantManagedBrowser(
  cfg: OpenBotConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isSharedTenantAddressingEnabled(cfg, env);
}

export function assertNoClientBrowserProfileOverride(params: {
  multitenantManaged: boolean;
  profile?: string | null;
  profilePath?: string | null;
  userDataDir?: string | null;
}): void {
  if (!params.multitenantManaged) {
    return;
  }
  const supplied = [params.profile, params.profilePath, params.userDataDir].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  if (supplied) {
    throw new AccountBrowserProfileOverrideError();
  }
}

export function resolveAccountBrowserPaths(params: {
  ctx: TenantContext;
  cfg: OpenBotConfig | undefined;
  agentId: string;
  env?: NodeJS.ProcessEnv;
}): AccountExecutionPaths {
  return resolveAccountExecutionPaths(params);
}

export { resolveAccountBrowserProfileDirForContext };

/**
 * Create the account profile directory empty. Never copies the shared
 * `CONFIG_DIR/browser/openclaw/user-data` tree.
 */
export async function ensureColdAccountBrowserProfile(
  profileDir: string,
  ownership?: SandboxOwnershipOptions,
): Promise<void> {
  await fs.mkdir(profileDir, { recursive: true });
  await ensureSandboxRuntimeOwnership([profileDir], ownership);
}

function listenEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
  });
}

/**
 * Reserve a host CDP port for one browser process. The port is not written
 * to gateway config. Call `releaseAccountBrowserCdpPort` when the process exits.
 */
export async function allocateAccountBrowserCdpPort(holderId: string): Promise<number> {
  armAccountBrowserCdpExitHook();
  const existing = reservedPorts.get(holderId);
  if (existing) {
    return existing;
  }
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const port = await listenEphemeralPort();
    if (!port || isGlobalBrowserCdpPoolPort(port) || reservedPortHolders.has(port)) {
      continue;
    }
    reservedPorts.set(holderId, port);
    reservedPortHolders.set(port, holderId);
    return port;
  }
  throw new Error(
    "Failed to allocate an account browser CDP port outside the global profile pool.",
  );
}

export function releaseAccountBrowserCdpPort(holderId: string): void {
  const port = reservedPorts.get(holderId);
  if (port === undefined) {
    return;
  }
  reservedPorts.delete(holderId);
  if (reservedPortHolders.get(port) === holderId) {
    reservedPortHolders.delete(port);
  }
}

/**
 * Map an account sandbox key onto the browser CDP holder.
 * Exec keys (`account:<tid>:<uid>:agent:<agentId>`) and browser keys share one port.
 */
export function resolveAccountBrowserScopeKeyFromSandboxKey(
  scopeKey: string | undefined,
): string | undefined {
  const parts = scopeKey?.split(":") ?? [];
  if (parts[0] !== "account" || parts.length < 4) {
    return undefined;
  }
  const tenantId = parts[1]?.trim() ?? "";
  const userId = parts[2]?.trim() ?? "";
  if (!tenantId || !userId || tenantId.includes("/") || userId.includes("/")) {
    return undefined;
  }
  if (parts.length === 4 && parts[3] === "browser") {
    return `account:${tenantId}:${userId}:browser`;
  }
  if (parts.length === 5 && parts[3] === "agent" && (parts[4]?.trim() ?? "").length > 0) {
    return `account:${tenantId}:${userId}:browser`;
  }
  return undefined;
}

/** Release the account CDP port for an exec or browser sandbox key. Non-account keys are ignored. */
export function releaseAccountBrowserCdpForSandboxKey(scopeKey: string | undefined): void {
  const browserScopeKey = resolveAccountBrowserScopeKeyFromSandboxKey(scopeKey);
  if (!browserScopeKey) {
    return;
  }
  releaseAccountBrowserCdpPort(browserScopeKey);
}

export function peekAccountBrowserCdpPort(holderId: string): number | undefined {
  return reservedPorts.get(holderId);
}

/**
 * Record a host CDP port already published (e.g. Docker `-p` map, or
 * rediscovered after gateway restart). Does not listen.
 * Prefer `allocateAccountBrowserCdpPort` when creating a new local publish.
 */
export function registerAccountBrowserCdpPort(holderId: string, port: number): void {
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`registerAccountBrowserCdpPort: invalid port ${port}`);
  }
  const existing = reservedPorts.get(holderId);
  if (existing !== undefined && existing !== port) {
    releaseAccountBrowserCdpPort(holderId);
  }
  const priorHolder = reservedPortHolders.get(port);
  if (priorHolder && priorHolder !== holderId) {
    reservedPorts.delete(priorHolder);
  }
  reservedPorts.set(holderId, port);
  reservedPortHolders.set(port, holderId);
}

/** @deprecated Prefer registerAccountBrowserCdpPort — same implementation. */
export function registerAccountBrowserCdpPortForTests(holderId: string, port: number): void {
  registerAccountBrowserCdpPort(holderId, port);
}

/** Test hook. Production callers release individual holders. */
export function resetAccountBrowserCdpPortsForTests(): void {
  reservedPorts.clear();
  reservedPortHolders.clear();
}

/** Host publish spec. Refuses the global 18800–18899 pool. */
export function accountBrowserCdpPublishSpec(hostPort: number, containerPort: number): string {
  if (isGlobalBrowserCdpPoolPort(hostPort)) {
    throw new Error("Account browser CDP must not use the global 18800-18899 profile pool.");
  }
  return `127.0.0.1:${hostPort}:${containerPort}`;
}
