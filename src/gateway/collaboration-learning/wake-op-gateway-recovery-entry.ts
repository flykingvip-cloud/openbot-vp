/**
 * R3 — production gateway composition root for wake-op mint → recovery exec →
 * release / confirm.
 *
 * Fail-closed behind `collaboration.task.wakeOpGatewayRecovery` (default off)
 * or `wakeOpGatewayRecoveryGroupAllowlist` gray entries (`tenantId/groupId`).
 *
 * Identity MUST come from handshake-stamped platform/gateway session fields
 * (`platformUserId` / authenticated `user` + `sessionDomain` / `sessionKind`).
 * Bare `actorId` params and TEST_ONLY mint are refused on this path.
 */
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { episodeIdForClientRun } from "../collaboration-dispatch/collaboration-event-key.js";
import { matchGrayGroupAllowlist } from "../collaboration-dispatch/gray-group-allowlist.js";
import { resolveGroupPolicyInput } from "../collaboration-dispatch/resolve-effective-policy.js";
import {
  createRoundPolicySnapshot,
  generatePolicySnapshotId,
} from "../collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import type {
  ConfirmWakeOpResult,
  ReleaseWakeOpResult,
} from "../collaboration-dispatch/wake-op-ledger.js";
import { resolveSecurityProfile } from "../security-profile.js";
import type { GatewayClient } from "../server-methods/types.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  resolveCollaborationGroupTenantId,
} from "./shared.js";
import {
  resolveAuthorityTenantForEntry,
  type CollaborationTenantResolution,
} from "./trusted-tenant.js";
import {
  confirmWakeOpCompletedAuthorized,
  createGatewaySessionRecoveryExecContext,
  mintWakeOpTrustedGatewaySessionFromPlatformAuth,
  releaseWakeOpForRetryAuthorized,
  type WakeOpTrustedGatewaySession,
} from "./wake-op-recovery-entry.js";

export class WakeOpGatewayRecoveryFlagOffError extends Error {
  readonly code = "WAKE_OP_GATEWAY_RECOVERY_FLAG_OFF";
  constructor() {
    super(
      "collaboration.task.wakeOpGatewayRecovery is off; enable the flag or add the group to wakeOpGatewayRecoveryGroupAllowlist (tenantId/groupId) for gray canary — default fail-closed",
    );
    this.name = "WakeOpGatewayRecoveryFlagOffError";
  }
}

export class WakeOpGatewayRecoveryEntryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WakeOpGatewayRecoveryEntryError";
    this.code = code;
  }
}

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Plan flag allowlist reader (default empty). */
export function resolveWakeOpGatewayRecoveryGroupAllowlist(cfg?: OpenBotConfig): string[] {
  try {
    const raw = (cfg ?? loadConfig()).collaboration?.task?.wakeOpGatewayRecoveryGroupAllowlist;
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
  } catch {
    return [];
  }
}

/**
 * True when global `wakeOpGatewayRecovery===true` **or** group is on the gray
 * allowlist. Platform default: both off (fail-closed).
 */
export function isWakeOpGatewayRecoveryEnabled(
  cfg?: OpenBotConfig,
  groupId?: string | null,
  tenantId?: string | null,
): boolean {
  try {
    const resolved = cfg ?? loadConfig();
    if (resolved.collaboration?.task?.wakeOpGatewayRecovery === true) {
      return true;
    }
    const gid = groupId?.trim();
    if (!gid) {
      return false;
    }
    return matchGrayGroupAllowlist({
      groupId: gid,
      tenantId,
      entries: resolveWakeOpGatewayRecoveryGroupAllowlist(resolved),
    });
  } catch {
    return false;
  }
}

export type PlatformAuthFieldsFromGatewayClient = {
  userId: string;
  userStatus: "active";
  sessionKind: string;
  sessionId: string | null;
};

/**
 * Map handshake-stamped gateway client fields to platform-auth mint inputs.
 * Refuses caller-chosen `connect.user` when no stamped platform subject exists.
 */
export function resolvePlatformAuthFieldsFromGatewayClient(
  client: GatewayClient | null | undefined,
): { ok: true; fields: PlatformAuthFieldsFromGatewayClient } | { ok: false; reason: string } {
  if (!client) {
    return { ok: false, reason: "missing_gateway_session_user" };
  }
  const platformUserId = compact(client.platformUserId);
  const stampedUser = compact(client.user);
  const sessionDomain = compact(client.sessionDomain);
  const sessionKind = compact(client.sessionKind) || "unknown";
  // Prefer durable platform user id; fall back to stamped session user only when
  // a session domain was established by the handshake (not raw connect.user).
  const userId = platformUserId || (sessionDomain ? stampedUser : "");
  if (!userId) {
    return { ok: false, reason: "missing_gateway_session_user" };
  }
  // Suspended / unbound users never receive session stamps on this gateway path.
  const fields: PlatformAuthFieldsFromGatewayClient = {
    userId,
    userStatus: "active",
    sessionKind,
    sessionId: compact(client.sessionMembershipId) || compact(client.connId) || null,
  };
  return { ok: true, fields };
}

/**
 * Production mint from a live gateway client. Does NOT use TEST_ONLY mint.
 */
export function mintTrustedGatewaySessionFromClient(
  client: GatewayClient | null | undefined,
): { ok: true; session: WakeOpTrustedGatewaySession } | { ok: false; reason: string } {
  const resolved = resolvePlatformAuthFieldsFromGatewayClient(client);
  if (!resolved.ok) {
    return resolved;
  }
  return mintWakeOpTrustedGatewaySessionFromPlatformAuth(resolved.fields);
}

function requireFlag(cfg: OpenBotConfig, groupId: string, tenantId?: string | null): void {
  if (!isWakeOpGatewayRecoveryEnabled(cfg, groupId, tenantId)) {
    throw new WakeOpGatewayRecoveryFlagOffError();
  }
}

async function buildRecoveryAuthority(params: {
  groupId: string;
  taskId: string;
  cfg: OpenBotConfig;
  tenant?: CollaborationTenantResolution | null;
}) {
  const stores = createWorkspaceCollaborationStores();
  const operatingState = await readGroupOperatingState({
    fileStore: stores.fileStore,
    groupId: params.groupId,
  });
  const now = Date.now();
  const snapshot = createRoundPolicySnapshot(resolveGroupPolicyInput({ operatingState }), {
    now,
    idGen: () => generatePolicySnapshotId(now),
  });
  const groupTenantId = resolveCollaborationGroupTenantId(params.groupId);
  const tenant: CollaborationTenantResolution = resolveAuthorityTenantForEntry({
    preferred: params.tenant,
    groupTenantId,
  });
  const profile = resolveSecurityProfile(params.cfg).profile;
  const authority = createRuntimeAuthority({
    snapshot,
    episodeId: episodeIdForClientRun(`task-wake-op-recovery:${params.groupId}:${params.taskId}`),
    tenant,
    groupId: params.groupId,
    profile,
    cfg: params.cfg,
  });
  return { authority, tenant };
}

export type GatewayWakeOpRecoveryClientParams = {
  client: GatewayClient | null;
  groupId: string;
  taskId: string;
  opKey: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
  nowMs?: number;
  detail?: string;
  /** Forbidden — production path never accepts bare actorId. */
  actorId?: unknown;
};

function refuseBareActorId(params: { actorId?: unknown }): void {
  if (params.actorId === undefined || params.actorId === null) {
    return;
  }
  throw new WakeOpGatewayRecoveryEntryError(
    "operator_identity_not_trusted",
    "bare actorId is not accepted on the wake-op gateway recovery production path",
  );
}

/**
 * Gateway method path: mint from platform session → recovery exec → release.
 */
export async function releaseWakeOpForRetryViaGatewaySession(
  params: GatewayWakeOpRecoveryClientParams & { verificationId: string },
): Promise<ReleaseWakeOpResult & { identityProvenance?: "gateway_session" }> {
  refuseBareActorId(params);
  const cfg = params.cfg ?? loadConfig();
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  const opKey = compact(params.opKey);
  const verificationId = compact(params.verificationId);
  if (!groupId || !taskId || !opKey || !verificationId) {
    throw new WakeOpGatewayRecoveryEntryError(
      "invalid_input",
      "groupId, taskId, opKey, and verificationId are required",
    );
  }
  const tenantHint = params.tenant?.tenantId ?? resolveCollaborationGroupTenantId(groupId);
  requireFlag(cfg, groupId, tenantHint);

  const minted = mintTrustedGatewaySessionFromClient(params.client);
  if (!minted.ok) {
    throw new WakeOpGatewayRecoveryEntryError(minted.reason, minted.reason);
  }
  const execCreated = await createGatewaySessionRecoveryExecContext({
    session: minted.session,
    groupId,
    taskId,
    action: "release_for_retry",
    cfg,
  });
  if (!execCreated.ok) {
    throw new WakeOpGatewayRecoveryEntryError(execCreated.reason, execCreated.reason);
  }
  const { authority } = await buildRecoveryAuthority({
    groupId,
    taskId,
    cfg,
    tenant: params.tenant,
  });
  const result = await releaseWakeOpForRetryAuthorized({
    authority,
    groupId,
    taskId,
    opKey,
    verificationId,
    exec: execCreated.exec,
    cfg,
    nowMs: params.nowMs,
    detail: params.detail,
  });
  if (!result.ok) {
    return result;
  }
  return { ...result, identityProvenance: "gateway_session" };
}

/**
 * Gateway method path: mint from platform session → recovery exec → confirm.
 */
export async function confirmWakeOpCompletedViaGatewaySession(
  params: GatewayWakeOpRecoveryClientParams & { roundId: string },
): Promise<ConfirmWakeOpResult & { identityProvenance?: "gateway_session" }> {
  refuseBareActorId(params);
  const cfg = params.cfg ?? loadConfig();
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  const opKey = compact(params.opKey);
  const roundId = compact(params.roundId);
  if (!groupId || !taskId || !opKey || !roundId) {
    throw new WakeOpGatewayRecoveryEntryError(
      "invalid_input",
      "groupId, taskId, opKey, and roundId are required",
    );
  }
  const tenantHint = params.tenant?.tenantId ?? resolveCollaborationGroupTenantId(groupId);
  requireFlag(cfg, groupId, tenantHint);

  const minted = mintTrustedGatewaySessionFromClient(params.client);
  if (!minted.ok) {
    throw new WakeOpGatewayRecoveryEntryError(minted.reason, minted.reason);
  }
  const execCreated = await createGatewaySessionRecoveryExecContext({
    session: minted.session,
    groupId,
    taskId,
    action: "confirm_completed",
    cfg,
  });
  if (!execCreated.ok) {
    throw new WakeOpGatewayRecoveryEntryError(execCreated.reason, execCreated.reason);
  }
  const { authority } = await buildRecoveryAuthority({
    groupId,
    taskId,
    cfg,
    tenant: params.tenant,
  });
  const result = await confirmWakeOpCompletedAuthorized({
    authority,
    groupId,
    taskId,
    opKey,
    roundId,
    exec: execCreated.exec,
    cfg,
    nowMs: params.nowMs,
    detail: params.detail,
  });
  if (!result.ok) {
    return result;
  }
  return { ...result, identityProvenance: "gateway_session" };
}
