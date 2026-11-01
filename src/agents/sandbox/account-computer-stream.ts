import path from "node:path";
import { readJsonFile } from "../../infra/json-files.js";
import { defaultRuntime } from "../../runtime.js";
import {
  applyProductHandBack,
  applyProductHumanTakeover,
} from "../../site-capability/product-takeover.js";
import { resolveAccountBrowserScopeKey } from "./account-scope.js";
import {
  retireStaleRunningAccountWorkerJournal,
  STALE_ACCOUNT_BROWSER_FAILURE,
} from "./account-worker.js";
/**
 * Account Computer preview stream.
 *
 * One noVNC service (one port / slot) per tenantId + platform user id. Each
 * session open mints its own short-lived observer token for that slot. The
 * public URL is a root-relative `/sandbox/novnc` path on the gateway (or the
 * bridge, in tests). The page and websocket stay on that origin. The bridge
 * relays RFB and keeps the VNC password. A grant forwards key and pointer
 * messages only while it is the single input grant. Handoff and a repeated
 * open by the same controller clear that flag on the previous socket.
 *
 * CDP ports, profile paths, and container names stay on the server slot and are
 * never copied into the public payload.
 *
 * Account-scoped browser startup lives with PR #365 (`cursor/account-computer-p0-73a8`).
 * This module only attaches a viewer to a browser that code has already published
 * via `publishAccountComputerObserver` (optional `observerAccount` on
 * `ensureSandboxBrowser`). It does not start a second desktop stack or allocate
 * a second profile key.
 */
import { BROWSER_BRIDGES } from "./browser-bridges.js";
import { SANDBOX_STATE_DIR, DEFAULT_SANDBOX_BROWSER_NOVNC_PORT } from "./constants.js";
import { dockerContainerLiveness, execDocker, type DockerContainerLiveness } from "./docker.js";
import {
  buildNoVncObserverTokenUrl,
  disarmNoVncRelayGrant,
  issueNoVncObserverToken,
  NOVNC_PASSWORD_ENV_KEY,
  revokeNoVncObserverToken,
} from "./novnc-auth.js";
import { hasActiveHandoffWaiters } from "./secure-form-handoff-wait.js";
import { cancelSecureFormsForAccount, isAccountFormLocked } from "./secure-form-store.js";

const PREVIEW_TOKEN_TTL_MS = 3 * 60 * 1000;

/** Shown when worker.json says RUNNING but the gateway cannot ask the engine. */
export const ACCOUNT_COMPUTER_REATTACH_UNKNOWN_FAILURE =
  "云电脑预览暂时无法确认浏览器是否在运行。请再打开一次。";

/** Shown when the browser is up but the restarted gateway cannot read its preview. */
export const ACCOUNT_COMPUTER_REATTACH_PORT_FAILURE =
  "云电脑浏览器仍在运行，但网关重启后没有接上画面端口。请再打开一次。";

export type AccountComputerFormalStatus = "STARTING" | "READY" | "REAUTH_REQUIRED" | "DISCONNECTED";

export type AccountComputerPublicStatus = AccountComputerFormalStatus | "COLD";

export type AccountComputerOperator = {
  kind: "agent" | "user";
  label: string;
};

export type AccountComputerPreviewPayload = {
  tenantId: string;
  userId: string;
  status: AccountComputerPublicStatus;
  streamUrl?: string;
  controlledBy: AccountComputerOperator | null;
  /** Operator-facing reason when no desktop stream can start. Omitted when empty. */
  failure?: string;
};

type IssuedPreviewToken = {
  token: string;
  viewOnly: boolean;
};

type AccountComputerSlot = {
  tenantId: string;
  userId: string;
  noVncPort: number;
  password?: string;
  bridgeBaseUrl: string;
  scopeKey: string;
  containerName: string;
  status: AccountComputerFormalStatus;
  agentLabel: string | null;
  ended: boolean;
  /** Session that may send input. Null means the agent still has the desktop. */
  controlSessionKey: string | null;
  /** User who holds the single input grant. Null while the agent has the desktop. */
  controlOperator: AccountComputerOperator | null;
  /** Tokens minted for this slot. Input tokens are revoked when control moves. */
  issuedTokens: IssuedPreviewToken[];
};

const SLOTS = new Map<string, AccountComputerSlot>();
const FAILURES = new Map<string, string>();

let readBrowserLiveness: (containerName: string) => Promise<DockerContainerLiveness> =
  dockerContainerLiveness;

/** Test seam. Production asks the host engine whether the browser is running. */
export function setAccountBrowserLivenessForTests(
  next: ((containerName: string) => Promise<DockerContainerLiveness>) | null,
): void {
  readBrowserLiveness = next ?? dockerContainerLiveness;
}

function workerJournalPath(tenantId: string, userId: string): string {
  return path.join(SANDBOX_STATE_DIR, "account-worker", "workers", tenantId, userId, "worker.json");
}

type ReleaseDeps = {
  stopBridge: (scopeKey: string) => Promise<void>;
  stopContainer: (containerName: string) => Promise<void>;
};

const defaultReleaseDeps: ReleaseDeps = {
  stopBridge: async (scopeKey) => {
    const entry = BROWSER_BRIDGES.get(scopeKey);
    if (!entry) {
      return;
    }
    const { stopBrowserBridgeServer } = await import("../../browser/bridge-server.js");
    await stopBrowserBridgeServer(entry.bridge.server).catch(() => undefined);
    BROWSER_BRIDGES.delete(scopeKey);
  },
  stopContainer: async (containerName) => {
    await execDocker(["stop", containerName], { allowFailure: true });
  },
};

let releaseDeps: ReleaseDeps = defaultReleaseDeps;

export function accountComputerKey(tenantId: string, userId: string): string {
  const tenant = tenantId.trim();
  const user = userId.trim();
  if (!tenant || !user) {
    throw new Error("account computer requires tenantId and userId");
  }
  return `${tenant}\u0000${user}`;
}

export function setAccountComputerReleaseDepsForTests(next: ReleaseDeps | null) {
  releaseDeps = next ?? defaultReleaseDeps;
}

export function resetAccountComputerSlotsForTests() {
  SLOTS.clear();
  FAILURES.clear();
  releaseDeps = defaultReleaseDeps;
  readBrowserLiveness = dockerContainerLiveness;
}

export function invalidateAccountComputerSlot(params: {
  tenantId: string;
  userId: string;
  failure: string;
}): void {
  const key = accountComputerKey(params.tenantId, params.userId);
  const slot = SLOTS.get(key);
  if (slot) {
    revokeAllTokens(slot);
    SLOTS.delete(key);
  }
  publishAccountComputerFailure(params);
}

export function publishAccountComputerFailure(params: {
  tenantId: string;
  userId: string;
  failure: string;
}): void {
  const failure = params.failure.trim();
  if (!failure) {
    return;
  }
  FAILURES.set(accountComputerKey(params.tenantId, params.userId), failure);
}

/** Server slot behind browser.preview. Container names stay off the public payload. */
export function peekAccountComputerBrowser(
  tenantId: string,
  userId: string,
): { containerName: string; noVncPort: number } | null {
  const slot = SLOTS.get(accountComputerKey(tenantId, userId));
  if (!slot || slot.ended) {
    return null;
  }
  return { containerName: slot.containerName, noVncPort: slot.noVncPort };
}

export function publishAccountComputerObserver(params: {
  tenantId: string;
  userId: string;
  noVncPort: number;
  password?: string;
  bridgeBaseUrl: string;
  scopeKey: string;
  containerName: string;
  agentLabel?: string;
  status?: AccountComputerFormalStatus;
}): { reused: boolean } {
  const key = accountComputerKey(params.tenantId, params.userId);
  FAILURES.delete(key);
  const existing = SLOTS.get(key);
  if (existing && !existing.ended) {
    if (params.agentLabel?.trim()) {
      existing.agentLabel = params.agentLabel.trim();
    }
    if (params.status) {
      existing.status = params.status;
    }
    return { reused: true };
  }
  SLOTS.set(key, {
    tenantId: params.tenantId.trim(),
    userId: params.userId.trim(),
    noVncPort: params.noVncPort,
    password: params.password?.trim() || undefined,
    bridgeBaseUrl: params.bridgeBaseUrl.replace(/\/$/, ""),
    scopeKey: params.scopeKey,
    containerName: params.containerName,
    status: params.status ?? "READY",
    agentLabel: params.agentLabel?.trim() || null,
    ended: false,
    controlSessionKey: null,
    controlOperator: null,
    issuedTokens: [],
  });
  return { reused: false };
}

function revokeInputTokens(slot: AccountComputerSlot) {
  for (const issued of slot.issuedTokens) {
    if (issued.viewOnly) {
      continue;
    }
    revokeNoVncObserverToken(issued.token);
    disarmNoVncRelayGrant(issued.token);
    issued.viewOnly = true;
  }
}

function revokeAllTokens(slot: AccountComputerSlot) {
  for (const issued of slot.issuedTokens) {
    revokeNoVncObserverToken(issued.token);
    disarmNoVncRelayGrant(issued.token);
  }
  slot.issuedTokens = [];
}

function issueStreamUrl(
  slot: AccountComputerSlot,
  opts: { viewOnly: boolean; nowMs?: number },
): string {
  const token = issueNoVncObserverToken({
    noVncPort: slot.noVncPort,
    password: slot.password,
    ttlMs: PREVIEW_TOKEN_TTL_MS,
    nowMs: opts.nowMs,
    viewOnly: opts.viewOnly,
    relay: true,
    tenantId: slot.tenantId,
    userId: slot.userId,
  });
  slot.issuedTokens.push({ token, viewOnly: opts.viewOnly });
  // Root-relative so the control UI iframe stays on the gateway origin.
  return buildNoVncObserverTokenUrl("", token);
}

function userOperator(slot: AccountComputerSlot, label?: string): AccountComputerOperator {
  const raw = label?.trim() || slot.userId;
  return { kind: "user", label: raw.includes("@") ? slot.userId : raw };
}

function controlledBy(slot: AccountComputerSlot): AccountComputerOperator | null {
  if (slot.controlSessionKey) {
    return slot.controlOperator ?? userOperator(slot);
  }
  if (slot.agentLabel) {
    return { kind: "agent", label: slot.agentLabel };
  }
  return null;
}

export function readAccountComputerPreview(params: {
  tenantId: string;
  userId: string;
  issueUrl: boolean;
  /** Chat that is opening the picture. Control is per session, the port is not. */
  sessionKey?: string;
  /** This session takes the single input grant. Other sessions stay view-only. */
  takeControl?: boolean;
  /** The session that currently holds input is giving it back to the agent. */
  releaseControl?: boolean;
  /** Display label for the user who is taking the input grant. Email is ignored. */
  operatorLabel?: string;
  nowMs?: number;
}): AccountComputerPreviewPayload {
  const key = accountComputerKey(params.tenantId, params.userId);
  const slot = SLOTS.get(key);
  if (!slot || slot.ended) {
    const failure = slot?.ended ? undefined : FAILURES.get(key);
    return {
      tenantId: params.tenantId.trim(),
      userId: params.userId.trim(),
      status: slot?.ended ? "DISCONNECTED" : "COLD",
      controlledBy: null,
      ...(failure ? { failure } : {}),
    };
  }
  const sessionKey = params.sessionKey?.trim() ?? "";
  if (params.releaseControl && sessionKey && slot.controlSessionKey === sessionKey) {
    revokeInputTokens(slot);
    slot.controlSessionKey = null;
    slot.controlOperator = null;
    // Product hand-back: drop human desk hold so SAR / browser may claim again.
    applyProductHandBack({
      tenantId: slot.tenantId,
      userId: slot.userId,
      scopeKey: slot.scopeKey,
    });
  }
  if (params.takeControl && sessionKey) {
    // Decision C: takeover cancels any pending Secure Form (formLock → cancelled_by_takeover).
    if (isAccountFormLocked(slot.tenantId, slot.userId)) {
      cancelSecureFormsForAccount({
        tenantId: slot.tenantId,
        userId: slot.userId,
        code: "cancelled_by_takeover",
        detail: "takeControl",
      });
    }
    if (slot.controlSessionKey !== sessionKey) {
      revokeInputTokens(slot);
    }
    slot.controlSessionKey = sessionKey;
    slot.controlOperator = userOperator(slot, params.operatorLabel);
    // Product takeover event: bump fencing + invalidate old SAR on this desk.
    applyProductHumanTakeover({
      tenantId: slot.tenantId,
      userId: slot.userId,
      humanSessionKey: sessionKey,
      scopeKey: slot.scopeKey,
    });
  }
  // formLock (pending Secure Form): keep RFB view-only unless this call is takeControl
  // (CDP fill still works independently of viewOnly).
  const formLocked = isAccountFormLocked(slot.tenantId, slot.userId);
  const viewOnly =
    formLocked && !params.takeControl ? true : !sessionKey || slot.controlSessionKey !== sessionKey;
  if (!viewOnly) {
    // One input grant, including a second open from the session that already holds control.
    revokeInputTokens(slot);
  }
  const streamUrl = params.issueUrl
    ? issueStreamUrl(slot, { viewOnly, nowMs: params.nowMs })
    : undefined;
  return {
    tenantId: slot.tenantId,
    userId: slot.userId,
    status: slot.status,
    ...(streamUrl ? { streamUrl } : {}),
    controlledBy: controlledBy(slot),
  };
}

/**
 * Releases the browser process for this account. The profile directory is not
 * deleted; callers must not remove `state/browser`.
 */
/**
 * Drop a stale human desk hold so the agent can navigate again.
 * Skips when await_return waiters exist (password / OTP / Secure Form handoff).
 * Clears preview input grant + product coordinator HUMAN_TAKEOVER.
 */
export function releaseStaleHumanTakeoverForAgent(scopeKey: string): boolean {
  const key = scopeKey.trim();
  if (!key) {
    return false;
  }
  if (hasActiveHandoffWaiters()) {
    return false;
  }
  let matched = false;
  for (const slot of SLOTS.values()) {
    if (slot.scopeKey !== key || slot.ended) {
      continue;
    }
    matched = true;
    if (slot.controlSessionKey) {
      revokeInputTokens(slot);
      slot.controlSessionKey = null;
      slot.controlOperator = null;
    }
    applyProductHandBack({
      tenantId: slot.tenantId,
      userId: slot.userId,
      scopeKey: slot.scopeKey,
    });
  }
  if (!matched) {
    // Keep coordinator-only human locks (direct authority.humanTakeover / product
    // takeover without a live account-computer slot). Agents must wait for an
    // explicit hand-back; clearing here broke P0 serial denial after takeover.
    return false;
  }
  return true;
}

export async function endAccountComputer(params: {
  tenantId: string;
  userId: string;
}): Promise<AccountComputerPreviewPayload> {
  const key = accountComputerKey(params.tenantId, params.userId);
  const slot = SLOTS.get(key);
  const tenantId = params.tenantId.trim();
  const userId = params.userId.trim();
  if (!slot) {
    return { tenantId, userId, status: "COLD", controlledBy: null };
  }
  slot.ended = true;
  revokeAllTokens(slot);
  slot.controlSessionKey = null;
  slot.controlOperator = null;
  slot.status = "DISCONNECTED";
  cancelSecureFormsForAccount({
    tenantId: slot.tenantId,
    userId: slot.userId,
    code: "aborted",
    detail: "endAccountComputer",
  });
  const scopeKey = slot.scopeKey;
  const containerName = slot.containerName;
  await releaseDeps.stopBridge(scopeKey);
  if (containerName.trim()) {
    await releaseDeps.stopContainer(containerName);
  }
  return { tenantId, userId, status: "DISCONNECTED", controlledBy: null };
}

export const ACCOUNT_COMPUTER_PUBLIC_KEYS = [
  "tenantId",
  "userId",
  "status",
  "streamUrl",
  "controlledBy",
] as const;

/**
 * Local-preview / Gateway-restart recovery.
 * Account Computer slots are in-memory. After a Gateway restart the Docker
 * browser container and worker.json may still be RUNNING while SLOTS is empty,
 * so browser.preview returns COLD and the UI shows the cold placeholder.
 * Re-publish from the journal + live container. Does not start or recreate
 * containers and does not touch state/browser profiles.
 */
export async function tryReattachAccountComputerFromRunningWorker(params: {
  tenantId: string;
  userId: string;
}): Promise<boolean> {
  const tenantId = params.tenantId.trim();
  const userId = params.userId.trim();
  if (!tenantId || !userId) {
    return false;
  }
  if (peekAccountComputerBrowser(tenantId, userId)) {
    return true;
  }
  const statePath = workerJournalPath(tenantId, userId);
  type WorkerJournalLite = {
    version?: number;
    phase?: string;
    tenantId?: string;
    userId?: string;
    browserContainerName?: string | null;
  };
  const journal = await readJsonFile<WorkerJournalLite>(statePath);
  if (
    !journal ||
    journal.version !== 1 ||
    journal.phase !== "RUNNING" ||
    journal.tenantId !== tenantId ||
    journal.userId !== userId
  ) {
    return false;
  }
  const containerName = journal.browserContainerName?.trim() ?? "";
  if (!containerName) {
    return false;
  }
  const liveness = await readBrowserLiveness(containerName);
  if (liveness === "stopped") {
    await retireStaleRunningAccountWorkerJournal({
      statePath,
      containerName,
      failure: STALE_ACCOUNT_BROWSER_FAILURE,
    });
    publishAccountComputerFailure({
      tenantId,
      userId,
      failure: STALE_ACCOUNT_BROWSER_FAILURE,
    });
    defaultRuntime.error?.(
      `Account computer reattach retired stale RUNNING container=${containerName}`,
    );
    return false;
  }
  if (liveness !== "running") {
    // unknown: the engine could not be asked. Leave worker.json RUNNING.
    publishAccountComputerFailure({
      tenantId,
      userId,
      failure: ACCOUNT_COMPUTER_REATTACH_UNKNOWN_FAILURE,
    });
    defaultRuntime.error?.(
      `Account computer reattach skipped: liveness=${liveness} container=${containerName}`,
    );
    return false;
  }
  const { readDockerPort, readDockerContainerEnvVar } = await import("./docker.js");
  const noVncPort = await readDockerPort(containerName, DEFAULT_SANDBOX_BROWSER_NOVNC_PORT);
  const password =
    (await readDockerContainerEnvVar(containerName, NOVNC_PASSWORD_ENV_KEY))?.trim() ?? "";
  if (!noVncPort || !password) {
    publishAccountComputerFailure({
      tenantId,
      userId,
      failure: ACCOUNT_COMPUTER_REATTACH_PORT_FAILURE,
    });
    defaultRuntime.error?.(
      `Account computer reattach unpublished: container=${containerName} port=${noVncPort ? "ok" : "missing"} password=${password ? "ok" : "missing"}`,
    );
    return false;
  }
  publishAccountComputerObserver({
    tenantId,
    userId,
    noVncPort,
    password,
    bridgeBaseUrl: "http://127.0.0.1",
    scopeKey: resolveAccountBrowserScopeKey({ tenantId, userId }),
    containerName,
    status: "READY",
  });
  // Also re-seed CDP / BROWSER_BRIDGES so handoff gate probes and Secure Form
  // fill do not stay fail-closed after gateway restart (noVNC alone is not enough).
  try {
    const { tryAttachRunningAccountComputerBrowser } =
      await import("./account-computer-running-attach.js");
    await tryAttachRunningAccountComputerBrowser({ tenantId, userId });
  } catch {
    // Soft: preview is already READY; gate probe will rediscover on poll.
  }
  return Boolean(peekAccountComputerBrowser(tenantId, userId));
}

/**
 * Drop an in-memory preview slot whose browser container has exited.
 * Leaves the slot alone when the engine cannot be asked (`unknown`).
 */
export async function rejectDeadAccountComputerIfNeeded(params: {
  tenantId: string;
  userId: string;
}): Promise<void> {
  const tenantId = params.tenantId.trim();
  const userId = params.userId.trim();
  const peeked = peekAccountComputerBrowser(tenantId, userId);
  if (!peeked) {
    return;
  }
  const liveness = await readBrowserLiveness(peeked.containerName);
  if (liveness !== "stopped") {
    return;
  }
  invalidateAccountComputerSlot({
    tenantId,
    userId,
    failure: STALE_ACCOUNT_BROWSER_FAILURE,
  });
  await retireStaleRunningAccountWorkerJournal({
    statePath: workerJournalPath(tenantId, userId),
    containerName: peeked.containerName,
    failure: STALE_ACCOUNT_BROWSER_FAILURE,
  });
}
