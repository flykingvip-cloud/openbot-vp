/**
 * Slice 2 decision entry for the Feishu employee-identity proxy.
 *
 * Confirm writes an explicit grant only after the enterprise connection and
 * the employee identity are usable. Resolve and execute only read that grant.
 * Owned-robot auto-create and the no-seat compatibility allow are not used.
 */
import type { EnterpriseImAuthorizationJudgment } from "./enterprise-im-employee-authorization.js";
import {
  allowFeishuEmployeeCredentialUse,
  type FeishuEmployeeChannelGate,
} from "./enterprise-im-employee-connection.js";
import { upsertUserOperationalIdentityGrant } from "./user-operational-identity-store.js";
import type {
  EnterpriseImConfirmMode,
  EnterpriseImResourceScope,
  UserOperationalIdentity,
  UserOperationalIdentityCredentialSecretStore,
  UserOperationalIdentityGrant,
  UserOperationalIdentityStore,
} from "./user-operational-identity-types.js";

export const ENTERPRISE_IM_DELEGATION_ACTIONS = ["read", "draft", "send"] as const;

export type EnterpriseImDenyCode =
  | "ENTERPRISE_CONNECTION_DISABLED"
  | "ENTERPRISE_CONNECTION_MISMATCH"
  | "ENTERPRISE_POLICY_MISSING"
  | "ENTERPRISE_POLICY_DENIED"
  | "SEAT_MISSING"
  | "SEAT_BINDING_AMBIGUOUS"
  | "IDENTITY_NOT_USABLE"
  | "IDENTITY_AMBIGUOUS"
  | "CONFIRM_REQUIRED"
  | "GRANT_FIELDS_INVALID"
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
      grantId: string;
      grantVersion: number;
    }
  | {
      outcome: "deny";
      code: EnterpriseImDenyCode;
      message: string;
    };

export type EnterpriseImDecisionInput = {
  store: UserOperationalIdentityStore;
  secretStore?: UserOperationalIdentityCredentialSecretStore;
  ownerId: string;
  agentId: string;
  action: string;
  /** Session tenant. Not a client-supplied id. */
  tenantId: string | null;
  identityId?: string;
  gate: FeishuEmployeeChannelGate;
  /** Produced by resolveEnterpriseImSeatAndPolicy. Not a caller-invented flag. */
  authorization: EnterpriseImAuthorizationJudgment;
  nowIso: string;
};

const DENY_MESSAGE: Record<EnterpriseImDenyCode, string> = {
  ENTERPRISE_CONNECTION_DISABLED: "企业连接已关闭。",
  ENTERPRISE_CONNECTION_MISMATCH: "员工身份与当前企业连接不一致。",
  ENTERPRISE_POLICY_MISSING: "缺少企业策略，不能放行。",
  ENTERPRISE_POLICY_DENIED: "企业策略不允许这个机器人执行这个动作。",
  SEAT_MISSING: "缺少企业席位，不能放行。",
  SEAT_BINDING_AMBIGUOUS: "席位绑定不唯一，不能放行。",
  IDENTITY_NOT_USABLE: "飞书员工身份当前不可用。",
  IDENTITY_AMBIGUOUS: "多个飞书员工身份同时可用，不能按第一条放行。",
  CONFIRM_REQUIRED: "需要员工明确确认后才能写入授权。",
  GRANT_FIELDS_INVALID: "授权的动作、范围或确认方式无效。",
  DELEGATION_MISSING: "没有员工确认的机器人授权。",
  DELEGATION_EXPIRED: "机器人授权已过期。",
  DELEGATION_ACTION_MISSING: "该机器人的授权不包含这个动作。",
  DELEGATION_AMBIGUOUS: "多个授权同时匹配，不能按第一条放行。",
};

/**
 * Confirm mode is when a later send must wait for a human. It is not a ban on
 * storing send. `read_only` cannot include send. `draft_then_confirm` may include
 * send; the content, target, and grant-version confirmation record is Slice 4.
 * `limited_auto` may include send and is still limited by resource scope and
 * enterprise policy. Slice 2 only persists this delegation.
 */
const MODE_ACTIONS: Record<EnterpriseImConfirmMode, ReadonlySet<string>> = {
  read_only: new Set(["read"]),
  draft_then_confirm: new Set(["read", "draft", "send"]),
  limited_auto: new Set(["read", "draft", "send"]),
};

function deny(code: EnterpriseImDenyCode, message?: string): EnterpriseImDecision {
  return { outcome: "deny", code, message: message ?? DENY_MESSAGE[code] };
}

function isExpired(grant: UserOperationalIdentityGrant, nowIso: string): boolean {
  if (!grant.expiresAt) {
    return false;
  }
  const expiresMs = Date.parse(grant.expiresAt);
  return !Number.isFinite(expiresMs) || expiresMs <= Date.parse(nowIso);
}

function connectionOpen(gate: FeishuEmployeeChannelGate): boolean {
  return !gate.childExecutionBlocked && gate.employeeUiHint === "app_can_attempt";
}

function mapCredentialDenial(code: string): EnterpriseImDecision {
  if (code === "PLATFORM_ENTERPRISE_MISMATCH") {
    return deny("ENTERPRISE_CONNECTION_MISMATCH");
  }
  if (
    code === "ENTERPRISE_CONNECTION_BLOCKED" ||
    code === "WAITING_ADMIN_SCOPES" ||
    code === "ENTERPRISE_NOT_OPEN"
  ) {
    return deny("ENTERPRISE_CONNECTION_DISABLED");
  }
  return deny("IDENTITY_NOT_USABLE");
}

function resolveUsableFeishuIdentity(
  params: EnterpriseImDecisionInput,
): { ok: true; identity: UserOperationalIdentity } | EnterpriseImDecision {
  const tenantId = params.tenantId?.trim() || "";
  const requested = params.identityId?.trim() || "";
  const owned = Object.values(params.store.identities).filter(
    (identity) => identity.ownerId === params.ownerId && identity.provider === "feishu-personal",
  );
  const candidates = requested
    ? owned.filter((identity) => identity.identityId === requested)
    : owned;
  if (requested && candidates.length === 0) {
    return deny("IDENTITY_NOT_USABLE");
  }
  const usable: UserOperationalIdentity[] = [];
  let failure: EnterpriseImDecision | null = null;
  for (const identity of candidates) {
    if (!identity.enterpriseIm || identity.enterpriseIm.channel !== "feishu") {
      failure = deny("IDENTITY_NOT_USABLE");
      continue;
    }
    if (identity.tenantId && tenantId && identity.tenantId !== tenantId) {
      failure = deny("ENTERPRISE_CONNECTION_MISMATCH");
      continue;
    }
    if (identity.enterpriseIm.accountId !== params.gate.accountId) {
      failure = deny("ENTERPRISE_CONNECTION_MISMATCH");
      continue;
    }
    const credential = allowFeishuEmployeeCredentialUse({
      store: params.store,
      secretStore: params.secretStore,
      ownerId: params.ownerId,
      identityId: identity.identityId,
      gate: params.gate,
      nowIso: params.nowIso,
    });
    if (!credential.ok) {
      failure = mapCredentialDenial(credential.code);
      continue;
    }
    usable.push(identity);
  }
  if (usable.length === 1 && usable[0]) {
    return { ok: true, identity: usable[0] };
  }
  if (usable.length > 1) {
    return deny("IDENTITY_AMBIGUOUS");
  }
  return failure ?? deny(owned.length > 0 ? "IDENTITY_NOT_USABLE" : "DELEGATION_MISSING");
}

/** Read-only. Does not insert a grant. Returns the one matching grant id. */
export function decideEnterpriseImEmployeeProxy(
  params: EnterpriseImDecisionInput,
): EnterpriseImDecision {
  if (!connectionOpen(params.gate)) {
    return deny("ENTERPRISE_CONNECTION_DISABLED");
  }
  if (!params.authorization.ok) {
    return deny(params.authorization.code, params.authorization.message);
  }
  const identityResult = resolveUsableFeishuIdentity(params);
  if (!("identity" in identityResult)) {
    return identityResult;
  }
  const identity = identityResult.identity;
  const grants = Object.values(params.store.grants).filter(
    (grant) =>
      grant.ownerId === params.ownerId &&
      grant.identityId === identity.identityId &&
      grant.agentId === params.agentId &&
      grant.status === "active" &&
      !grant.revokedAt &&
      grant.grantMode === "explicit" &&
      Boolean(grant.confirmedAt),
  );
  if (grants.length === 0) {
    const expired = Object.values(params.store.grants).some(
      (grant) =>
        grant.ownerId === params.ownerId &&
        grant.identityId === identity.identityId &&
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
  if (!grant?.grantId) {
    return deny("DELEGATION_MISSING");
  }
  // Allow means this action is on a valid delegation. It does not clear a
  // specific document, recipient, or content-confirmation record. Slice 3
  // checks the resource. Slice 4 checks recipients and the confirm record.
  // A missing enterpriseImEmployeeProxy policy stays a deny. Do not default-allow.
  return {
    outcome: "allow",
    identityId: identity.identityId,
    agentId: grant.agentId,
    action: params.action,
    grantId: grant.grantId,
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
  secretStore?: UserOperationalIdentityCredentialSecretStore;
  ownerId: string;
  identityId: string;
  agentId: string;
  agentScope: "owned" | "shared" | "group";
  allowedActions: string[];
  gate: FeishuEmployeeChannelGate;
  tenantId: string | null;
  confirmExplicit: boolean;
  resourceScope: EnterpriseImResourceScope;
  confirmMode: EnterpriseImConfirmMode;
  nowIso: string;
  expiresAt?: string;
}): { ok: true; grant: UserOperationalIdentityGrant } | EnterpriseImDecision {
  if (!params.confirmExplicit) {
    return deny("CONFIRM_REQUIRED");
  }
  if (!connectionOpen(params.gate)) {
    return deny("ENTERPRISE_CONNECTION_DISABLED");
  }
  const tenantId = params.tenantId?.trim() || "";
  if (!tenantId) {
    return deny("ENTERPRISE_CONNECTION_DISABLED");
  }
  const actions = params.allowedActions.map((action) => action.trim()).filter(Boolean);
  const modeActions = MODE_ACTIONS[params.confirmMode];
  if (
    actions.length === 0 ||
    actions.some((action) => !modeActions.has(action)) ||
    !params.resourceScope
  ) {
    return deny("GRANT_FIELDS_INVALID");
  }
  if (params.expiresAt) {
    const expiresMs = Date.parse(params.expiresAt);
    if (!Number.isFinite(expiresMs)) {
      return deny("GRANT_FIELDS_INVALID");
    }
  }
  const usable = resolveUsableFeishuIdentity({
    store: params.store,
    secretStore: params.secretStore,
    ownerId: params.ownerId,
    agentId: params.agentId,
    action: actions[0] ?? "read",
    tenantId,
    identityId: params.identityId,
    gate: params.gate,
    authorization: { ok: true, tenantId, seatId: "confirm", policyId: "confirm" },
    nowIso: params.nowIso,
  });
  if (!("identity" in usable)) {
    return usable;
  }
  const scopesBefore = usable.identity.enterpriseIm?.userGrantedScopes?.join(" ") ?? "";
  const written = upsertUserOperationalIdentityGrant({
    store: params.store,
    ownerId: params.ownerId,
    identityId: usable.identity.identityId,
    agentId: params.agentId,
    agentScope: params.agentScope,
    allowedActions: actions,
    grantMode: "explicit",
    confirmExplicit: true,
    tenantId,
    resourceScope: params.resourceScope,
    confirmMode: params.confirmMode,
    expiresAt: params.expiresAt,
    nowIso: params.nowIso,
  });
  if (!written.ok) {
    return deny("GRANT_FIELDS_INVALID", written.error);
  }
  const scopesAfter =
    params.store.identities[usable.identity.identityId]?.enterpriseIm?.userGrantedScopes?.join(
      " ",
    ) ?? "";
  if (scopesBefore !== scopesAfter) {
    throw new Error("enterprise IM confirm must not widen platform scopes");
  }
  return written;
}
