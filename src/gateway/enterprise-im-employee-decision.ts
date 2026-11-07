/**
 * Slice 2 decision entry for the Feishu employee-identity proxy.
 *
 * Confirm writes an explicit grant. Resolve and execute only read that grant.
 * Owned-robot auto-create and the no-seat compatibility allow are not used.
 */
import type { FeishuEmployeeChannelGate } from "./enterprise-im-employee-connection.js";
import { upsertUserOperationalIdentityGrant } from "./user-operational-identity-store.js";
import type {
  UserOperationalIdentityGrant,
  UserOperationalIdentityStore,
} from "./user-operational-identity-types.js";

export const ENTERPRISE_IM_DELEGATION_ACTIONS = ["read", "draft", "send"] as const;

export type EnterpriseImSeatCheck = {
  kind: "missing" | "ambiguous" | "present";
  policyPresent: boolean;
};

export type EnterpriseImDenyCode =
  | "ENTERPRISE_CONNECTION_DISABLED"
  | "ENTERPRISE_POLICY_MISSING"
  | "SEAT_MISSING"
  | "SEAT_BINDING_AMBIGUOUS"
  | "DELEGATION_MISSING"
  | "DELEGATION_EXPIRED"
  | "DELEGATION_ACTION_MISSING"
  | "DELEGATION_AMBIGUOUS";

export type EnterpriseImDecision =
  | {
      outcome: "allow";
      identityId: string;
      agentId: string;
      action: string;
      grantVersion: number;
    }
  | {
      outcome: "deny";
      code: EnterpriseImDenyCode;
      message: string;
    };

export type EnterpriseImDecisionInput = {
  store: UserOperationalIdentityStore;
  ownerId: string;
  agentId: string;
  action: string;
  identityId?: string;
  gate: Pick<FeishuEmployeeChannelGate, "childExecutionBlocked" | "employeeUiHint">;
  seat: EnterpriseImSeatCheck;
  nowIso: string;
};

const DENY_MESSAGE: Record<EnterpriseImDenyCode, string> = {
  ENTERPRISE_CONNECTION_DISABLED: "企业连接已关闭。",
  ENTERPRISE_POLICY_MISSING: "缺少企业策略，不能放行。",
  SEAT_MISSING: "缺少企业席位，不能放行。",
  SEAT_BINDING_AMBIGUOUS: "席位绑定不唯一，不能放行。",
  DELEGATION_MISSING: "没有员工确认的机器人授权。",
  DELEGATION_EXPIRED: "机器人授权已过期。",
  DELEGATION_ACTION_MISSING: "该机器人的授权不包含这个动作。",
  DELEGATION_AMBIGUOUS: "多个授权同时匹配，不能按第一条放行。",
};

function deny(code: EnterpriseImDenyCode): EnterpriseImDecision {
  return { outcome: "deny", code, message: DENY_MESSAGE[code] };
}

function isExpired(grant: UserOperationalIdentityGrant, nowIso: string): boolean {
  if (!grant.expiresAt) {
    return false;
  }
  const expiresMs = Date.parse(grant.expiresAt);
  return !Number.isFinite(expiresMs) || expiresMs <= Date.parse(nowIso);
}

function explicitGrants(params: EnterpriseImDecisionInput): UserOperationalIdentityGrant[] {
  return Object.values(params.store.grants).filter(
    (grant) =>
      grant.ownerId === params.ownerId &&
      grant.agentId === params.agentId &&
      grant.status === "active" &&
      !grant.revokedAt &&
      grant.grantMode === "explicit" &&
      Boolean(grant.confirmedAt) &&
      (!params.identityId || grant.identityId === params.identityId),
  );
}

/** Read-only. Does not insert a grant. */
export function decideEnterpriseImEmployeeProxy(
  params: EnterpriseImDecisionInput,
): EnterpriseImDecision {
  if (params.gate.childExecutionBlocked || params.gate.employeeUiHint !== "app_can_attempt") {
    return deny("ENTERPRISE_CONNECTION_DISABLED");
  }
  if (params.seat.kind === "missing") {
    return deny("SEAT_MISSING");
  }
  if (params.seat.kind === "ambiguous") {
    return deny("SEAT_BINDING_AMBIGUOUS");
  }
  if (!params.seat.policyPresent) {
    return deny("ENTERPRISE_POLICY_MISSING");
  }
  const grants = explicitGrants(params);
  if (grants.length === 0) {
    const expired = Object.values(params.store.grants).some(
      (grant) =>
        grant.ownerId === params.ownerId &&
        grant.agentId === params.agentId &&
        grant.grantMode === "explicit" &&
        Boolean(grant.confirmedAt) &&
        isExpired(grant, params.nowIso),
    );
    return deny(expired ? "DELEGATION_EXPIRED" : "DELEGATION_MISSING");
  }
  const current = grants.filter((grant) => !isExpired(grant, params.nowIso));
  if (current.length === 0) {
    return deny("DELEGATION_EXPIRED");
  }
  const matched = current.filter((grant) => grant.allowedActions.includes(params.action));
  if (matched.length === 0) {
    return deny("DELEGATION_ACTION_MISSING");
  }
  if (matched.length > 1) {
    return deny("DELEGATION_AMBIGUOUS");
  }
  const grant = matched[0];
  if (!grant) {
    return deny("DELEGATION_MISSING");
  }
  return {
    outcome: "allow",
    identityId: grant.identityId,
    agentId: grant.agentId,
    action: params.action,
    grantVersion: grant.grantVersion ?? 1,
  };
}

/** Same read-only decision. Execute does not write a grant and does not call the platform. */
export function executeEnterpriseImEmployeeProxy(
  params: EnterpriseImDecisionInput,
): EnterpriseImDecision {
  return decideEnterpriseImEmployeeProxy(params);
}

export function confirmEnterpriseImRobotGrant(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  identityId: string;
  agentId: string;
  agentScope: "owned" | "shared" | "group";
  allowedActions: string[];
  gate: EnterpriseImDecisionInput["gate"];
  nowIso: string;
  expiresAt?: string;
}): { ok: true; grant: UserOperationalIdentityGrant } | EnterpriseImDecision {
  if (params.gate.childExecutionBlocked || params.gate.employeeUiHint !== "app_can_attempt") {
    return deny("ENTERPRISE_CONNECTION_DISABLED");
  }
  const identity = params.store.identities[params.identityId];
  const scopesBefore = identity?.enterpriseIm?.userGrantedScopes?.join(" ") ?? "";
  const written = upsertUserOperationalIdentityGrant({
    store: params.store,
    ownerId: params.ownerId,
    identityId: params.identityId,
    agentId: params.agentId,
    agentScope: params.agentScope,
    allowedActions: params.allowedActions,
    grantMode: "explicit",
    confirmExplicit: true,
    expiresAt: params.expiresAt,
    nowIso: params.nowIso,
  });
  if (!written.ok) {
    return deny("DELEGATION_MISSING");
  }
  const scopesAfter =
    params.store.identities[params.identityId]?.enterpriseIm?.userGrantedScopes?.join(" ") ?? "";
  if (scopesBefore !== scopesAfter) {
    throw new Error("enterprise IM confirm must not widen platform scopes");
  }
  return written;
}
