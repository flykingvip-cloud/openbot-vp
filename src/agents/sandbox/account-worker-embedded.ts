/**
 * Embedded-run wiring for the Account Worker prototype.
 *
 * When OPENBOT_ACCOUNT_WORKER is on and the run has a server-derived account,
 * the embedded runner acquires a lifecycle handle and passes it into sandbox
 * resolution. Tenant sandboxes then start through the worker (memory or docker
 * driver) instead of the gateway docker driver.
 *
 * The handle is a lease id plus trusted scope. Image, mounts, env, and the
 * noVNC password are not part of the request and are not placed in model context.
 * Flags stay default off. This is not a production cutover.
 */
import path from "node:path";
import type { OpenBotConfig } from "../../config/types.js";
import { resolveAccountExecutionPaths } from "../../gateway/account-execution-paths.js";
import { AccountRuntimeSnapshotStore } from "../../gateway/governance/account-runtime-snapshot.js";
import { newGovernanceDecisionId } from "../../gateway/governance/decision-id.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { defaultRuntime } from "../../runtime.js";
import { publishAccountComputerObserver } from "./account-computer-stream.js";
import {
  resolveAccountBrowserScopeKey,
  resolveEmbeddedRunSandboxParams,
  type EmbeddedSandboxAccountInput,
} from "./account-scope.js";
import {
  isAccountWorkerDockerDriverEnabled,
  readAccountWorkerBrowserNoVncPassword,
  reconcileRunningAccountBrowsers,
  resolveAccountWorkerImages,
} from "./account-worker-driver.js";
import {
  createAccountWorkerControlPlane,
  isAccountWorkerPrototypeEnabled,
} from "./account-worker-gateway.js";
import { AccountWorkerLifecycle } from "./account-worker-lifecycle.js";
import type { AccountWorkerSandboxHandle } from "./account-worker.js";
import { resolveSandboxConfigForAgent } from "./config.js";
import { DEFAULT_SANDBOX_BROWSER_NOVNC_PORT, SANDBOX_STATE_DIR } from "./constants.js";
import { NOVNC_PASSWORD_ENV_KEY } from "./novnc-auth.js";
import { resolveSandboxRuntimeStatus } from "./runtime-status.js";

/**
 * Snapshot field the worker may see. It does not read or write billing ledgers.
 * Model commercial gates stay on their own path.
 */
const PROTOTYPE_SNAPSHOT_CREDITS = 1;
const PROTOTYPE_MAX_CONCURRENT = 8;
const LEASE_TTL_MS = 12 * 60 * 60 * 1000;
const EXECUTION_ID_PREFIX = "embedded-account-worker";

type EmbeddedAccountWorkerRuntime = {
  lifecycle: AccountWorkerLifecycle;
  store: AccountRuntimeSnapshotStore;
  controlPlane: ReturnType<typeof createAccountWorkerControlPlane>;
  runtimeDir: string;
  now: () => number;
};

let singleton: EmbeddedAccountWorkerRuntime | null = null;
let testRuntime: EmbeddedAccountWorkerRuntime | null = null;
let previewReadersForTests: {
  readPort?: (containerName: string, port: number) => Promise<number | null>;
  readEnv?: (containerName: string, envVar: string) => Promise<string | null>;
} | null = null;

export function setEmbeddedAccountWorkerRuntimeForTests(
  runtime: EmbeddedAccountWorkerRuntime | null,
): void {
  testRuntime = runtime;
  singleton = null;
}

export function resetEmbeddedAccountWorkerForTests(): void {
  testRuntime = null;
  singleton = null;
  previewReadersForTests = null;
}

/** Exec leases stay per agent. The browser container is keyed by the user profile, not this id. */
function executionIdFor(agentId: string): string {
  return `${EXECUTION_ID_PREFIX}:${normalizeAgentId(agentId)}`;
}

function createRuntime(params: {
  config?: OpenBotConfig;
  env: NodeJS.ProcessEnv;
  agentId: string;
}): EmbeddedAccountWorkerRuntime {
  const sandboxCfg = resolveSandboxConfigForAgent(params.config, params.agentId);
  const images = resolveAccountWorkerImages({
    env: params.env,
    configExecImage: sandboxCfg.docker.image,
    configBrowserImage: sandboxCfg.browser.image,
  });
  const runtimeDir = path.join(SANDBOX_STATE_DIR, "account-worker");
  const store = new AccountRuntimeSnapshotStore(path.join(runtimeDir, "snapshots.json"));
  const controlPlane = createAccountWorkerControlPlane(store);
  const now = () => Date.now();
  const lifecycle = new AccountWorkerLifecycle({
    cfg: params.config,
    operatorImage: images.execImage,
    browserImage: images.browserImage,
    runtimeDir,
    controlPlane,
    now,
    env: params.env,
  });
  return { lifecycle, store, controlPlane, runtimeDir, now };
}

async function runtimeFor(params: {
  config?: OpenBotConfig;
  env: NodeJS.ProcessEnv;
  agentId: string;
}): Promise<EmbeddedAccountWorkerRuntime> {
  if (testRuntime) {
    return testRuntime;
  }
  if (singleton) {
    return singleton;
  }
  singleton = createRuntime(params);
  if (isAccountWorkerDockerDriverEnabled(params.env)) {
    await reconcileRunningAccountBrowsers().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      defaultRuntime.error?.(`Account browser reconcile failed: ${message}`);
    });
  }
  return singleton;
}

type StartLease = {
  action: "start";
  runtimeLeaseId: string;
  tenantId: string;
  userId: string;
  agentId: string;
  snapshotVersion: number;
};

async function leaseFor(params: {
  runtime: EmbeddedAccountWorkerRuntime;
  config?: OpenBotConfig;
  env: NodeJS.ProcessEnv;
  tenantId: string;
  userId: string;
  agentId: string;
}): Promise<StartLease> {
  const agentId = normalizeAgentId(params.agentId);
  const executionId = executionIdFor(agentId);
  const now = params.runtime.now();
  const current = await params.runtime.store.current({
    tenantId: params.tenantId,
    userId: params.userId,
    executionId,
  });
  const expiresAtMs = current ? Date.parse(current.lease.expiresAt) : Number.NaN;
  const reusable =
    current &&
    !current.lease.revoked &&
    !current.snapshot.revoked &&
    current.snapshot.capabilityDecision.effect === "allow" &&
    normalizeAgentId(current.lease.agentId) === agentId &&
    Number.isFinite(expiresAtMs) &&
    expiresAtMs > now;
  if (reusable && current) {
    return {
      action: "start",
      runtimeLeaseId: current.lease.runtimeLeaseId,
      tenantId: current.lease.tenantId,
      userId: current.lease.userId,
      agentId: current.lease.agentId,
      snapshotVersion: current.snapshot.snapshotVersion,
    };
  }
  const paths = resolveAccountExecutionPaths({
    ctx: { tenantId: params.tenantId, userId: params.userId, domain: "employee" },
    cfg: params.config,
    agentId,
    env: params.env,
  });
  const issuedAt = new Date(now).toISOString();
  const issued = await params.runtime.store.issue({
    tenantId: params.tenantId,
    userId: params.userId,
    agentId,
    executionId,
    decisionId: newGovernanceDecisionId(),
    authorizationVersion: "account-worker-embedded",
    dataSpaceRef: paths.dataSpaceRef,
    browserNamespaceRef: paths.browserNamespaceRef,
    modelEntitlement: { allowlist: [] },
    capabilityDecision: { effect: "allow" },
    commercialLimits: { creditsRemaining: PROTOTYPE_SNAPSHOT_CREDITS },
    concurrencyLimits: { maxConcurrentRuns: PROTOTYPE_MAX_CONCURRENT, activeCount: 0 },
    policyVersion: "account-worker-prototype",
    issuedAt,
    expiresAt: new Date(now + LEASE_TTL_MS).toISOString(),
  });
  return {
    action: "start",
    runtimeLeaseId: issued.lease.runtimeLeaseId,
    tenantId: issued.lease.tenantId,
    userId: issued.lease.userId,
    agentId: issued.lease.agentId,
    snapshotVersion: issued.snapshot.snapshotVersion,
  };
}

/**
 * Acquire the worker handle for this run.
 * Returns undefined when the prototype is off or this session is not sandboxed,
 * so the previous gateway docker path stays in place.
 */
export async function resolveEmbeddedAccountWorkerHandle(params: {
  config?: OpenBotConfig;
  sessionKey?: string;
  account?: { tenantId: string; userId: string };
  env?: NodeJS.ProcessEnv;
}): Promise<AccountWorkerSandboxHandle | undefined> {
  const env = params.env ?? process.env;
  if (!isAccountWorkerPrototypeEnabled(params.config, env)) {
    return undefined;
  }
  const tenantId = params.account?.tenantId?.trim() ?? "";
  const userId = params.account?.userId?.trim() ?? "";
  if (!tenantId || !userId) {
    return undefined;
  }
  const runtimeStatus = resolveSandboxRuntimeStatus({
    cfg: params.config,
    sessionKey: params.sessionKey,
  });
  if (!runtimeStatus.sandboxed) {
    return undefined;
  }
  const runtime = await runtimeFor({
    config: params.config,
    env,
    agentId: runtimeStatus.agentId,
  });
  const request = await leaseFor({
    runtime,
    config: params.config,
    env,
    tenantId,
    userId,
    agentId: runtimeStatus.agentId,
  });
  return {
    request,
    controlPlane: runtime.controlPlane,
    statePath: path.join(runtime.runtimeDir, "handle-state.json"),
    lifecycle: runtime.lifecycle,
    env,
  };
}

export async function resolveEmbeddedRunSandboxContextParams(
  params: EmbeddedSandboxAccountInput & {
    sessionKey?: string;
    workspaceDir: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<
  ReturnType<typeof resolveEmbeddedRunSandboxParams> & {
    accountWorker?: AccountWorkerSandboxHandle;
  }
> {
  const base = resolveEmbeddedRunSandboxParams(params);
  const accountWorker = await resolveEmbeddedAccountWorkerHandle({
    config: params.config,
    sessionKey: params.sessionKey,
    account: base.account,
    env: params.env,
  });
  return {
    ...base,
    ...(accountWorker ? { accountWorker } : {}),
  };
}

type PortReader = (containerName: string, port: number) => Promise<number | null>;
type EnvReader = (containerName: string, envVar: string) => Promise<string | null>;

type PreviewReaders = {
  readPort?: PortReader;
  readEnv?: EnvReader;
};

export function setAccountWorkerPreviewReadersForTests(readers: PreviewReaders | null): void {
  previewReadersForTests = readers;
}

async function defaultReadPort(containerName: string, port: number): Promise<number | null> {
  const { readDockerPort } = await import("./docker.js");
  return readDockerPort(containerName, port);
}

async function defaultReadEnv(containerName: string, envVar: string): Promise<string | null> {
  const { readDockerContainerEnvVar } = await import("./docker.js");
  return readDockerContainerEnvVar(containerName, envVar);
}

async function readUntilPresent<T>(
  read: () => Promise<T | null>,
  attempts: number,
): Promise<T | null> {
  const tries = Math.max(1, attempts);
  for (let i = 0; i < tries; i += 1) {
    const value = await read();
    if (value) {
      return value;
    }
    if (i + 1 < tries) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  return null;
}

/**
 * Publish the signed-in account's noVNC slot after the worker browser container
 * is up. browser.preview only attaches this slot; it does not start containers.
 * The password stays on the server slot. The public payload is a token URL.
 */
export async function publishAccountWorkerBrowserObserver(params: {
  tenantId: string;
  userId: string;
  containerName: string;
  agentLabel?: string;
  env?: NodeJS.ProcessEnv;
  bridgeBaseUrl?: string;
  readPort?: PortReader;
  readEnv?: EnvReader;
}): Promise<boolean> {
  const env = params.env ?? process.env;
  if (!isAccountWorkerDockerDriverEnabled(env)) {
    return false;
  }
  const containerName = params.containerName.trim();
  const tenantId = params.tenantId.trim();
  const userId = params.userId.trim();
  if (!containerName || !tenantId || !userId) {
    return false;
  }
  const readPort = params.readPort ?? previewReadersForTests?.readPort ?? defaultReadPort;
  const readEnv = params.readEnv ?? previewReadersForTests?.readEnv ?? defaultReadEnv;
  // Injected readers are deterministic. The docker CLI can lag one start, so retry it.
  const attempts = params.readPort || previewReadersForTests?.readPort ? 1 : 4;
  const noVncPort = await readUntilPresent(
    () => readPort(containerName, DEFAULT_SANDBOX_BROWSER_NOVNC_PORT),
    attempts,
  );
  const remembered = readAccountWorkerBrowserNoVncPassword(containerName) ?? "";
  const inspected = remembered
    ? ""
    : ((await readUntilPresent(() => readEnv(containerName, NOVNC_PASSWORD_ENV_KEY), attempts)) ??
      "");
  const password = (remembered || inspected).trim();
  if (!noVncPort || !password) {
    defaultRuntime.error?.(
      `Account worker preview unpublished: container=${containerName} port=${noVncPort ? "ok" : "missing"} password=${password ? "ok" : "missing"}`,
    );
    return false;
  }
  const agentLabel = params.agentLabel?.trim();
  publishAccountComputerObserver({
    tenantId,
    userId,
    ...(agentLabel && !agentLabel.includes("@") ? { agentLabel } : {}),
    noVncPort,
    password,
    bridgeBaseUrl: params.bridgeBaseUrl?.trim() || "http://127.0.0.1",
    scopeKey: resolveAccountBrowserScopeKey({ tenantId, userId }),
    containerName,
    status: "READY",
  });
  return true;
}
