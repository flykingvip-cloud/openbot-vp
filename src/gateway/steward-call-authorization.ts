/**
 * Pending authorization for a cross-person 大白管家 call.
 * Lives on the employee steward session path (not a new channel).
 * Confirmation tickets do not fit: the target person must choose, not the caller.
 */
import { randomUUID } from "node:crypto";
import {
  assessForeignStewardCall,
  buildEmployeeBuiltinStewardSessionKey,
  extractEmployeeStewardUserIdFromSessionKey,
  resolveStewardDispatchRank,
  sanitizeEmployeeStewardIdentity,
  type StewardCallRoleLabel,
  type StewardCrossCallAction,
  type StewardDispatchRank,
} from "../agents/builtin-steward/employee-isolation.js";
import { loadConfig } from "../config/config.js";
import { resolveEmployeeWorkbenchActor } from "./employee-workbench-scope.js";
import { resolvePlatformRole } from "./platform-auth/auth-helpers.js";
import { resolvePlatformAuthConfig } from "./platform-auth/config.js";
import {
  findUserByEmail,
  findUserById,
  listMembershipsByUserId,
} from "./platform-auth/memberships.js";
import { normalizeEmail } from "./platform-auth/request-helpers.js";
import type { PlatformAuthStore } from "./platform-auth/store-types.js";
import { loadStore } from "./platform-auth/store.js";
import type { GatewayClient } from "./server-methods/types.js";

export const STEWARD_CROSS_CALL_OPEN_DENIAL = "you cannot open another person's steward";

export type PendingStewardCall = {
  id: string;
  callerUserId: string;
  targetUserId: string;
  callerRank: Exclude<StewardDispatchRank, "member">;
  roleLabel: StewardCallRoleLabel;
  callerTenantId: string | null;
  targetTenantIds: string[];
  prompt: string;
  actions: readonly ["同意", "不同意"];
  message: string;
  title: string;
  targetSessionKey: string;
  requesterSessionKey: string;
};

const pendingByPair = new Map<string, PendingStewardCall>();

function pairKey(callerUserId: string, targetUserId: string): string {
  return `${sanitizeEmployeeStewardIdentity(callerUserId)}\n${sanitizeEmployeeStewardIdentity(targetUserId)}`;
}

export function __clearStewardCallAuthorizationsForTest(): void {
  pendingByPair.clear();
}

export function issuePendingStewardCall(input: {
  callerUserId: string;
  targetUserId: string;
  callerRank: Exclude<StewardDispatchRank, "member">;
  roleLabel: StewardCallRoleLabel;
  callerTenantId?: string | null;
  targetTenantIds?: readonly string[];
  prompt: string;
  message: string;
  title: string;
  targetSessionKey: string;
  requesterSessionKey: string;
}): PendingStewardCall {
  const key = pairKey(input.callerUserId, input.targetUserId);
  const existing = pendingByPair.get(key);
  const pending: PendingStewardCall = {
    id: existing?.id ?? `steward-call-${randomUUID()}`,
    callerUserId: sanitizeEmployeeStewardIdentity(input.callerUserId),
    targetUserId: sanitizeEmployeeStewardIdentity(input.targetUserId),
    callerRank: input.callerRank,
    roleLabel: input.roleLabel,
    callerTenantId: input.callerTenantId?.trim() || null,
    targetTenantIds: [...(input.targetTenantIds ?? [])],
    prompt: input.prompt,
    actions: ["同意", "不同意"],
    message: input.message,
    title: input.title,
    targetSessionKey: input.targetSessionKey,
    requesterSessionKey: input.requesterSessionKey,
  };
  pendingByPair.set(key, pending);
  return pending;
}

export function listPendingStewardCallsForTarget(targetUserId: string): PendingStewardCall[] {
  const target = sanitizeEmployeeStewardIdentity(targetUserId);
  return [...pendingByPair.values()].filter((row) => row.targetUserId === target);
}

/**
 * Card payload on the steward session history, not a transcript line.
 * The workbench paints `stewardCallAuthorization` with the steward confirm card.
 * `content` stays empty so a client that only reads text cannot show the prompt as dialogue.
 */
export function stewardCallAuthorizationHistoryEntries(
  targetUserId: string,
): Array<Record<string, unknown>> {
  return listPendingStewardCallsForTarget(targetUserId).map((pending) => ({
    role: "assistant",
    content: [],
    stewardCallAuthorization: {
      id: pending.id,
      prompt: pending.prompt,
      actions: [...pending.actions],
      roleLabel: pending.roleLabel,
    },
  }));
}

export type StewardCallDecisionResult =
  | { outcome: "none" }
  | { outcome: "refused"; authorizationId: string }
  | { outcome: "agreed"; pending: PendingStewardCall };

export function decideStewardCallAuthorization(input: {
  targetUserId: string;
  decision: string;
  authorizationId?: string;
}): StewardCallDecisionResult {
  const decision = input.decision.trim() as StewardCrossCallAction;
  if (decision !== "同意" && decision !== "不同意") {
    return { outcome: "none" };
  }
  const target = sanitizeEmployeeStewardIdentity(input.targetUserId);
  const matches = [...pendingByPair.entries()].filter(([, row]) => {
    if (row.targetUserId !== target) {
      return false;
    }
    return input.authorizationId ? row.id === input.authorizationId : true;
  });
  if (matches.length === 0) {
    return { outcome: "none" };
  }
  const [key, pending] = matches[0];
  pendingByPair.delete(key);
  if (decision === "不同意") {
    return { outcome: "refused", authorizationId: pending.id };
  }
  return { outcome: "agreed", pending };
}

async function loadPlatformStore(): Promise<PlatformAuthStore | null> {
  try {
    const config = resolvePlatformAuthConfig(loadConfig().gateway?.auth?.trustedProxy);
    if (!config) {
      return null;
    }
    return await loadStore(config);
  } catch {
    return null;
  }
}

export async function listStewardUserTenantIds(userId: string): Promise<string[]> {
  const store = await loadPlatformStore();
  if (!store) {
    return [];
  }
  const id = userId.trim();
  const user = findUserById(store, id) ?? findUserByEmail(store, normalizeEmail(id));
  const resolved = user?.id ?? id;
  return [
    ...new Set(
      listMembershipsByUserId(store, resolved)
        .map((row) => row.enterpriseId.trim())
        .filter(Boolean),
    ),
  ];
}

export type StewardChatCaller = {
  userId: string;
  tenantId: string | null;
  rank: StewardDispatchRank;
};

export type StewardChatCallerClient = {
  user?: string;
  platformUserId?: string;
  sessionDomain?: string | null;
  sessionKind?: string | null;
  sessionEnterpriseId?: string | null;
  sessionTenantId?: string | null;
};

/**
 * Rank from the store only. Session stamps are passed through and do not
 * upgrade rank inside resolveStewardDispatchRank.
 */
export function resolveStewardChatCallerRank(input: {
  user?: Parameters<typeof resolvePlatformRole>[0];
  memberships?: ReadonlyArray<{ membershipRole?: string | null; enterpriseId?: string | null }>;
  tenantId?: string | null;
  sessionDomain?: string | null;
  sessionKind?: string | null;
}): StewardDispatchRank {
  const tenantId = input.tenantId?.trim() || null;
  const enterpriseAdminMembership = (input.memberships ?? []).some(
    (row) =>
      row.membershipRole === "enterprise-admin" &&
      (!tenantId || row.enterpriseId?.trim() === tenantId),
  );
  return resolveStewardDispatchRank({
    sessionDomain: input.sessionDomain,
    sessionKind: input.sessionKind,
    platformRole: resolvePlatformRole(input.user),
    enterpriseAdminMembership,
  });
}

export async function resolveStewardChatCaller(
  client: StewardChatCallerClient | null | undefined,
  options?: { tenantId?: string | null },
): Promise<StewardChatCaller | null> {
  const actor = await resolveEmployeeWorkbenchActor(
    client as GatewayClient | null | undefined,
  ).catch(() => null);
  const store = await loadPlatformStore();
  const rawUser = client?.user?.trim() || client?.platformUserId?.trim() || "";
  const byEmail = store && rawUser ? findUserByEmail(store, normalizeEmail(rawUser)) : undefined;
  const byId = store && rawUser ? findUserById(store, rawUser) : undefined;
  const userId = sanitizeEmployeeStewardIdentity(
    actor?.userId || client?.platformUserId || byId?.id || byEmail?.id || rawUser,
  );
  if (!userId) {
    return null;
  }
  const tenantId =
    options && "tenantId" in options
      ? options.tenantId?.trim() || null
      : actor?.tenantId?.trim() ||
        client?.sessionEnterpriseId?.trim() ||
        client?.sessionTenantId?.trim() ||
        null;
  const storeUser =
    byId ?? byEmail ?? (store ? findUserById(store, actor?.userId || userId) : undefined);
  const memberships = store ? listMembershipsByUserId(store, storeUser?.id || userId) : [];
  return {
    userId,
    tenantId,
    rank: resolveStewardChatCallerRank({
      user: storeUser,
      memberships,
      tenantId,
      sessionDomain: client?.sessionDomain,
      sessionKind: client?.sessionKind,
    }),
  };
}

export async function foreignEmployeeStewardAccessDenial(
  client: GatewayClient | null | undefined,
  sessionKey: string,
): Promise<string | null> {
  const owner = extractEmployeeStewardUserIdFromSessionKey(sessionKey);
  if (!owner) {
    return null;
  }
  const caller = await resolveStewardChatCaller(client);
  if (caller && caller.userId === owner) {
    return null;
  }
  return STEWARD_CROSS_CALL_OPEN_DENIAL;
}

export type StewardChatIntercept =
  | { handled: false }
  | { handled: true; ok: false; error: string; payload?: Record<string, unknown> }
  | { handled: true; ok: true; payload: Record<string, unknown> };

export async function interceptStewardCrossCallChatSend(input: {
  client: GatewayClient | null | undefined;
  rawSessionKey: string;
  message: string;
  authorizationId?: string;
  dispatchAgreed?: (
    pending: PendingStewardCall,
  ) => Promise<{ ok: boolean; reason: string; runId?: string }>;
}): Promise<StewardChatIntercept> {
  const caller = await resolveStewardChatCaller(input.client);
  const raw = input.rawSessionKey.trim();
  const foreignOwner = extractEmployeeStewardUserIdFromSessionKey(raw);
  const message = input.message.trim();
  const ownKey = caller ? buildEmployeeBuiltinStewardSessionKey(caller.userId) : "";
  const onOwnSteward =
    Boolean(caller) &&
    (!foreignOwner || foreignOwner === caller!.userId) &&
    (foreignOwner === caller!.userId ||
      raw === "" ||
      raw === "main" ||
      raw.toLowerCase() === "agent:main" ||
      raw === ownKey);

  if (caller && onOwnSteward && (message === "同意" || message === "不同意")) {
    const decision = decideStewardCallAuthorization({
      targetUserId: caller.userId,
      decision: message,
      authorizationId: input.authorizationId,
    });
    if (decision.outcome === "refused") {
      return {
        handled: true,
        ok: true,
        payload: {
          status: "refused",
          reason: "不同意",
          authorizationId: decision.authorizationId,
        },
      };
    }
    if (decision.outcome === "agreed") {
      const dispatchAgreed = input.dispatchAgreed;
      if (!dispatchAgreed) {
        return {
          handled: true,
          ok: false,
          error: "unavailable",
        };
      }
      const sent = await dispatchAgreed(decision.pending);
      if (!sent.ok) {
        return { handled: true, ok: false, error: sent.reason || "unavailable" };
      }
      return {
        handled: true,
        ok: true,
        payload: {
          status: "accepted",
          reason: "agreed",
          authorizationId: decision.pending.id,
          runId: sent.runId,
          targetSessionKey: decision.pending.targetSessionKey,
        },
      };
    }
  }

  if (!foreignOwner) {
    return { handled: false };
  }
  if (!caller || foreignOwner === caller.userId) {
    return { handled: false };
  }
  const targetTenantIds =
    caller.rank === "enterprise_admin" ? await listStewardUserTenantIds(foreignOwner) : [];
  const assessment = assessForeignStewardCall({
    callerUserId: caller.userId,
    targetUserId: foreignOwner,
    rank: caller.rank,
    callerTenantId: caller.tenantId,
    targetTenantIds,
  });
  if (assessment.disposition !== "needs_authorization") {
    return { handled: true, ok: false, error: STEWARD_CROSS_CALL_OPEN_DENIAL };
  }
  const pending = issuePendingStewardCall({
    callerUserId: caller.userId,
    targetUserId: foreignOwner,
    callerRank: caller.rank === "platform_admin" ? "platform_admin" : "enterprise_admin",
    roleLabel: assessment.roleLabel,
    callerTenantId: caller.tenantId,
    targetTenantIds,
    prompt: assessment.prompt,
    message,
    title: "大白管家对话",
    targetSessionKey: raw,
    requesterSessionKey: buildEmployeeBuiltinStewardSessionKey(caller.userId),
  });
  return {
    handled: true,
    ok: false,
    error: "pending_authorization",
    payload: {
      status: "pending_authorization",
      reason: "pending_authorization",
      authorizationId: pending.id,
      prompt: pending.prompt,
      actions: [...pending.actions],
      roleLabel: pending.roleLabel,
      targetSessionKey: pending.targetSessionKey,
    },
  };
}
