import { randomUUID } from "node:crypto";
import { loadConfig } from "../config/config.js";
import { ownershipProofForEnterpriseOperationalIdentity } from "./data-governance/ownership-proof.js";
import { EnterpriseDataStoreError } from "./enterprise-data/connector-action-store.js";
import { resolveTrustedEnterpriseDataExecutionContext } from "./enterprise-data/enterprise-data-seat-context.js";
import {
  listOperationalIdentityAccessForSeat,
  listOperationalIdentityAccessForSeatAgent,
  recordOperationalIdentityUsage,
  recordOperationalIdentityUsageDenied,
  resolveOperationalIdentityAccess,
  type OperationalIdentityAccessDecisionMeta,
  type OperationalIdentityAccessDenialCode,
  type OperationalIdentityAccessEntry,
  type OperationalIdentityAccessResult,
} from "./enterprise-operational-identity-access.js";
import {
  executeEnterpriseOperationalIdentityAction,
  parseEnterpriseOperationalIdentityExecutionPayload,
  type EnterpriseOperationalIdentityExecutionResult,
} from "./enterprise-operational-identity-execution.js";
import { saveEnterpriseSeatAssetsStoreWithOiGovernance } from "./enterprise-operational-identity-governance.js";
import { resolveOperationalIdentityActionRisk } from "./enterprise-operational-identity-providers/provider-capability-registry.js";
import {
  findActiveCollaborationIdentityDelegation,
  findActiveEmployeeEnterpriseIdentityEnrollment,
  findEmployeeEnterpriseIdentityEnrollment,
  getOperationalIdentityTenantSettings,
  getTenantEnterpriseIdentity,
  isAgentManageableForOperationalIdentity,
  listActiveEmployeeEnterpriseIdentityEnrollments,
  listEnterpriseIdentityEnrollmentsForAgent,
  listTenantIdentityUsagePolicies,
  previewOperationalIdentityImplicitInheritExit,
  removeEmployeeEnterpriseIdentityEnrollment,
  resolveOperationalIdentityTenantGrantMode,
  setOperationalIdentityTenantGrantMode,
  upsertEmployeeEnterpriseIdentityEnrollment,
} from "./enterprise-operational-identity-store.js";
import type {
  EnterpriseOperationalIdentityProvider,
  OperationalIdentityAccessStage,
  OperationalIdentityTenantGrantMode,
  OperationalIdentityTenantSettings,
} from "./enterprise-operational-identity-types.js";
import {
  buildEmployeeAccessSnapshot,
  loadEnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";
import {
  hasPinnedEmployeeSessionContext,
  type CollaborationOwnerEntitlement,
} from "./execution-identity-context.js";
import {
  findUserByEmail,
  loadPlatformAuthStore,
  resolvePlatformAuthConfig,
} from "./platform-auth.js";
import type { GatewayClient } from "./server-methods/types.js";
import {
  resolveControlPlaneStorePathForClient,
  resolveControlPlaneStorePathForTenantId,
  TenantContextError,
} from "./tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "./tenant-store-paths.js";

async function persistEnterpriseOiRuntimeMutation(params: {
  storePath: string | undefined;
  store: Awaited<ReturnType<typeof loadEnterpriseSeatAssetsStore>>;
  tenantId: string;
  identityId: string;
}): Promise<void> {
  await saveEnterpriseSeatAssetsStoreWithOiGovernance({
    storePath: params.storePath,
    store: params.store,
    tenantId: params.tenantId,
    governedIdentityIds: [params.identityId],
    ownershipProof: ownershipProofForEnterpriseOperationalIdentity({
      tenantId: params.tenantId,
    }),
  });
}

export async function resolveActorEmployeeIdFromGatewayClient(
  client: GatewayClient | null,
): Promise<string | undefined> {
  const email = client?.user?.trim().toLowerCase();
  if (!email) {
    return undefined;
  }
  const cfg = loadConfig();
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    return undefined;
  }
  const platformStore = await loadPlatformAuthStore(authConfig);
  const user = findUserByEmail(platformStore, email);
  return user?.id;
}

export function resolveOperationalIdentityActorEmployeeIdFromPlatformUser(
  platformUserId: string | null | undefined,
): string | undefined {
  const trimmed = platformUserId?.trim();
  return trimmed || undefined;
}

export async function resolveOperationalIdentityActorEmployeeId(params: {
  platformUserId?: string | null;
  client?: GatewayClient | null;
}): Promise<string | undefined> {
  const direct = resolveOperationalIdentityActorEmployeeIdFromPlatformUser(params.platformUserId);
  if (direct) {
    return direct;
  }
  return resolveActorEmployeeIdFromGatewayClient(params.client ?? null);
}

export type OperationalIdentityRuntimeScope = {
  tenantId: string;
  seatId: string;
  agentId: string;
  employeeId: string;
};

/**
 * Where the resolved scope came from. Compatibility is expressed as an explicit context
 * source with a unique-resolution requirement, never as a catch-all fallback after an
 * employee-context error.
 */
export type OperationalIdentityScopeSource = "employee" | "collaboration-owner" | "enrollment";

/**
 * Typed denial reasons. Distinct failures must stay distinguishable: collapsing them into
 * one `NO_SEAT_CONTEXT` is what let a model invent "process environment is empty, so the
 * user is not logged in".
 */
export type OperationalIdentityScopeDenialCode =
  /** No authenticated employee identity and no enrolled agent to run as. */
  | "IDENTITY_CONTEXT_MISSING"
  /** Employee identity present, but no tenant could be bound to it. */
  | "TENANT_CONTEXT_MISSING"
  /** Membership unknown, half-bound, inactive, or account/enterprise suspended. */
  | "MEMBERSHIP_INVALID"
  /** Presented membership / requested tenant disagrees with the authoritative tenant. */
  | "TENANT_MISMATCH"
  /** Employee and tenant resolved, but the employee holds no active seat. */
  | "NO_CURRENT_SEAT"
  /** Seat resolved, but the requested agent is not assigned/enrolled. */
  | "AGENT_NOT_ENROLLED"
  /** Background enrollment fallback resolved more than one tenant/employee. */
  | "ENROLLMENT_AMBIGUOUS";

const SCOPE_DENIAL_MESSAGES: Record<OperationalIdentityScopeDenialCode, string> = {
  IDENTITY_CONTEXT_MISSING:
    "此回合没有携带已认证的员工身份，也没有可用的已登记机器人身份，无法解析企业席位。",
  TENANT_CONTEXT_MISSING: "已识别到员工身份，但没能绑定到所属企业租户，企业身份调用已拒绝。",
  MEMBERSHIP_INVALID: "员工的企业成员关系无效（未找到、已停用或企业已冻结），企业身份调用已拒绝。",
  TENANT_MISMATCH: "员工身份与请求的企业租户不一致，企业身份调用已拒绝。",
  NO_CURRENT_SEAT: "该员工当前没有生效的企业席位，请联系企业管理员分配席位后再调用企业身份。",
  AGENT_NOT_ENROLLED: "当前机器人未被分配到该员工席位，或尚未登记企业身份，企业身份调用已拒绝。",
  ENROLLMENT_AMBIGUOUS:
    "后台执行的机器人身份登记不唯一（跨多个企业或员工），无法确定归属，企业身份调用已拒绝。",
};

export type OperationalIdentityScopeDecision =
  | { ok: true; source: OperationalIdentityScopeSource; scope: OperationalIdentityRuntimeScope }
  | { ok: false; code: OperationalIdentityScopeDenialCode; message: string };

function denyScope(code: OperationalIdentityScopeDenialCode): OperationalIdentityScopeDecision {
  return { ok: false, code, message: SCOPE_DENIAL_MESSAGES[code] };
}

/** PDP/PEP audit stage for enforce/execute decisions (not projected to the LLM). */
export const OPERATIONAL_IDENTITY_RUNTIME_STAGE: OperationalIdentityAccessStage =
  "runtime_decision";

export type CollaborationOwnerLiveRevalidationReason =
  | "entitlement_incomplete"
  | "seat_missing"
  | "seat_unbound"
  | "employee_mismatch"
  | "not_group_owner";

export type CollaborationOwnerLiveRevalidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: CollaborationOwnerLiveRevalidationReason;
      message: string;
    };

/**
 * Authoritative collaboration-owner live revalidation (P2).
 * Checks owner still has an active seat binding and (when affirmed) is still group owner.
 * High-risk collaboration-owner paths must fail closed on `{ ok: false }`.
 */
export function revalidateCollaborationOwnerLive(params: {
  store: Awaited<ReturnType<typeof loadEnterpriseSeatAssetsStore>>;
  entitlement: CollaborationOwnerEntitlement;
}): CollaborationOwnerLiveRevalidationResult {
  const tenantId = params.entitlement.tenantId?.trim() ?? "";
  const seatId = params.entitlement.seatId?.trim() ?? "";
  const employeeId = params.entitlement.employeeId?.trim() ?? "";
  if (!tenantId || !seatId || !employeeId) {
    return {
      ok: false,
      reason: "entitlement_incomplete",
      message: "协作 Owner 资格信息不完整，无法完成权威复验。",
    };
  }
  const seat = params.store.seats[seatId];
  if (!seat || seat.tenantId !== tenantId) {
    return {
      ok: false,
      reason: "seat_missing",
      message: "协作 Owner 席位不存在或不属于当前企业，高风险动作已拒绝。",
    };
  }
  const activeBinding = Object.values(params.store.bindings).find(
    (binding) =>
      binding.tenantId === tenantId &&
      binding.seatId === seatId &&
      binding.employeeId === employeeId &&
      binding.bindingStatus === "active",
  );
  if (!activeBinding) {
    return {
      ok: false,
      reason: "seat_unbound",
      message: "协作 Owner 席位绑定已失效，高风险动作已拒绝。",
    };
  }
  if (seat.currentEmployeeId && seat.currentEmployeeId.trim() !== employeeId) {
    return {
      ok: false,
      reason: "employee_mismatch",
      message: "协作 Owner 已不在该席位任职，高风险动作已拒绝。",
    };
  }
  if (seat.status === "vacant" || seat.status === "frozen") {
    return {
      ok: false,
      reason: "seat_unbound",
      message: "协作 Owner 席位当前不可用，高风险动作已拒绝。",
    };
  }
  if (params.entitlement.stillGroupOwner === false) {
    return {
      ok: false,
      reason: "not_group_owner",
      message: "协作群 Owner 资格已失效，高风险动作已拒绝。",
    };
  }
  return { ok: true };
}

async function loadOperationalIdentityRuntimeStore(params: {
  client: GatewayClient | null;
  tenantId?: string;
}): Promise<{
  store: Awaited<ReturnType<typeof loadEnterpriseSeatAssetsStore>>;
  storePath: string | undefined;
}> {
  let storePath: string | undefined;
  if (params.client) {
    try {
      storePath = await resolveControlPlaneStorePathForClient(
        params.client,
        TENANT_SEAT_ASSETS_FILE,
      );
    } catch {
      storePath = undefined;
    }
  }
  if (!storePath && params.tenantId?.trim()) {
    storePath = resolveControlPlaneStorePathForTenantId(params.tenantId, TENANT_SEAT_ASSETS_FILE);
  }
  return {
    store: await loadEnterpriseSeatAssetsStore(storePath),
    storePath,
  };
}

/**
 * Unique PDP intersection (P0).
 *
 * EffectiveActions =
 *   seat policy actions
 *   ∩ (enrollment.allowedActions when this identity is enrolled)
 *   ∩ (capabilities when non-empty)
 *   and when the identity has no enrollment: strip registry risk === "high"
 *   (low/medium keep seat-inherit compatibility).
 *
 * When the agent already has any enrollment and this identity is not among them,
 * EffectiveActions is empty (identity not delegated).
 *
 * list / prompt projection / enforce / execute MUST call this — no parallel filter.
 */
export function computeEffectiveActions(params: {
  provider: string;
  policyActions: readonly string[];
  capabilities?: readonly string[] | null;
  /** Enrollment actions for THIS identity; null/undefined means not enrolled. */
  enrollmentActions?: readonly string[] | null;
  /**
   * Optional CollaborationIdentityDelegation actions (collaboration-owner path).
   * When present, further intersect — same PDP, no parallel filter.
   */
  collaborationDelegationActions?: readonly string[] | null;
  /** True when the agent has any *active* enrollment rows for this employee. */
  agentHasEnrollments: boolean;
  /**
   * Tenant grant mode. explicit_owner_grant exits implicit seat-inherit:
   * zero enrollment → no actions (high or low).
   */
  tenantGrantMode?: OperationalIdentityTenantGrantMode;
  /**
   * When false on collaboration-owner scope, strip registry high actions (fail-closed
   * projection). Undefined/true → no extra strip from live revalidation.
   */
  collaborationOwnerLiveOk?: boolean;
}): string[] {
  let actions = [...params.policyActions];
  if (params.capabilities && params.capabilities.length > 0) {
    const caps = new Set(params.capabilities);
    actions = actions.filter((action) => caps.has(action));
  }
  if (params.enrollmentActions) {
    const enrolled = new Set(params.enrollmentActions);
    actions = actions.filter((action) => enrolled.has(action));
  } else if (params.agentHasEnrollments) {
    return [];
  } else if (params.tenantGrantMode === "explicit_owner_grant") {
    // Tenant opted out of implicit inheritance — Owner grant required for every action.
    return [];
  } else {
    const provider = params.provider as EnterpriseOperationalIdentityProvider;
    actions = actions.filter(
      (action) => resolveOperationalIdentityActionRisk(provider, action) !== "high",
    );
  }
  if (params.collaborationDelegationActions) {
    const delegated = new Set(params.collaborationDelegationActions);
    actions = actions.filter((action) => delegated.has(action));
  }
  if (params.collaborationOwnerLiveOk === false) {
    const provider = params.provider as EnterpriseOperationalIdentityProvider;
    actions = actions.filter(
      (action) => resolveOperationalIdentityActionRisk(provider, action) !== "high",
    );
  }
  return [...new Set(actions)].toSorted();
}

export type EffectiveAccessDecision =
  | {
      allowed: true;
      identity: Extract<OperationalIdentityAccessResult, { allowed: true }>["identity"];
      policy: Extract<OperationalIdentityAccessResult, { allowed: true }>["policy"];
      meta: OperationalIdentityAccessDecisionMeta;
    }
  | {
      allowed: false;
      code: OperationalIdentityAccessDenialCode;
      message: string;
      meta?: OperationalIdentityAccessDecisionMeta;
    };

/**
 * Unique PDP single-action decision. Callers (enforce / execute) must use this —
 * do not re-implement enrollment or high-risk gates elsewhere.
 */
export function computeEffectiveAccess(params: {
  store: Awaited<ReturnType<typeof loadEnterpriseSeatAssetsStore>>;
  tenantId: string;
  seatId: string;
  agentId: string;
  employeeId: string;
  identityId: string;
  action: string;
  nowIso: string;
  /** When false, skip execute-time agent manageability re-check (tests / list-only). Default true. */
  verifyAgentManageable?: boolean;
  /** Scope source for audit meta (employee | collaboration-owner | enrollment). */
  scopeSource?: OperationalIdentityScopeSource;
  /**
   * Live revalidation result for collaboration-owner. High-risk fail-closed:
   * missing or ok:false → COLLABORATION_OWNER_REVALIDATION_FAILED.
   */
  collaborationOwnerLive?: CollaborationOwnerLiveRevalidationResult;
  /** Active CollaborationIdentityDelegation.allowedActions when present (same PDP intersect). */
  collaborationDelegationActions?: readonly string[] | null;
  collaborationDelegationId?: string;
}): EffectiveAccessDecision {
  const tenantGrantMode = resolveOperationalIdentityTenantGrantMode(params.store, params.tenantId);
  const base = resolveOperationalIdentityAccess({
    store: params.store,
    tenantId: params.tenantId,
    seatId: params.seatId,
    agentId: params.agentId,
    identityId: params.identityId,
    action: params.action,
    nowIso: params.nowIso,
  });
  // Single grant read path into PDP: active enrollments only.
  const enrollments = listActiveEmployeeEnterpriseIdentityEnrollments(params.store, {
    tenantId: params.tenantId,
    employeeId: params.employeeId,
    agentId: params.agentId,
  });
  const enrollment =
    findActiveEmployeeEnterpriseIdentityEnrollment(params.store, {
      tenantId: params.tenantId,
      employeeId: params.employeeId,
      agentId: params.agentId,
      identityId: params.identityId,
    }) ?? null;
  const inactiveEnrollment = !enrollment
    ? findEmployeeEnterpriseIdentityEnrollment(params.store, {
        tenantId: params.tenantId,
        employeeId: params.employeeId,
        agentId: params.agentId,
        identityId: params.identityId,
      })
    : null;
  const provider = (base.allowed ? base.identity.provider : undefined) as
    | EnterpriseOperationalIdentityProvider
    | undefined;
  const risk = provider ? resolveOperationalIdentityActionRisk(provider, params.action) : undefined;
  const policyVersion = base.allowed ? base.policy.policyVersion : undefined;
  const buildMeta = (
    extra?: OperationalIdentityAccessDecisionMeta,
  ): OperationalIdentityAccessDecisionMeta => ({
    stage: OPERATIONAL_IDENTITY_RUNTIME_STAGE,
    ...(params.scopeSource ? { scopeSource: params.scopeSource } : {}),
    ...(enrollment?.enrollmentId ? { enrollmentId: enrollment.enrollmentId } : {}),
    ...(params.collaborationDelegationId
      ? { collaborationDelegationId: params.collaborationDelegationId }
      : {}),
    ...(risk ? { risk } : {}),
    ...(policyVersion ? { policyVersion } : {}),
    ...(enrollment?.policyVersionAtGrant
      ? { policyVersionAtGrant: enrollment.policyVersionAtGrant }
      : {}),
    ...(enrollment?.grantMode ? { grantMode: enrollment.grantMode } : {}),
    ...(enrollment?.status ? { grantStatus: enrollment.status } : {}),
    tenantGrantMode,
    ...extra,
  });

  if (params.verifyAgentManageable !== false) {
    const manageable = isAgentManageableForOperationalIdentity({
      store: params.store,
      tenantId: params.tenantId,
      seatId: params.seatId,
      agentId: params.agentId,
    });
    if (!manageable) {
      return {
        allowed: false,
        code: "AGENT_NOT_MANAGEABLE",
        message: "该机器人已不在当前岗位可管理集合中，无法使用企业运营身份。",
        meta: buildMeta(),
      };
    }
  }

  if (!base.allowed) {
    // resolveOperationalIdentityAccess already failed (policy/capabilities/status) — keep its code.
    return {
      allowed: false,
      code: base.code,
      message: base.message,
      meta: buildMeta(),
    };
  }

  // P2: collaboration-owner + high → live revalidation is a PDP precondition (fail-closed).
  if (params.scopeSource === "collaboration-owner" && risk === "high") {
    const live = params.collaborationOwnerLive;
    if (!live || !live.ok) {
      return {
        allowed: false,
        code: "COLLABORATION_OWNER_REVALIDATION_FAILED",
        message: live && !live.ok ? live.message : "协作 Owner 权威复验未通过，高风险动作已拒绝。",
        meta: buildMeta(
          live && !live.ok
            ? { revalidationReason: live.reason }
            : { revalidationReason: "entitlement_incomplete" },
        ),
      };
    }
  }

  if (inactiveEnrollment && inactiveEnrollment.status !== "active") {
    return {
      allowed: false,
      code: "OWNER_GRANT_INACTIVE",
      message: "该企业身份授权已停用或撤销，请重新完成 Owner 绑定。",
      meta: buildMeta({
        enrollmentId: inactiveEnrollment.enrollmentId,
        grantStatus: inactiveEnrollment.status,
        grantMode: inactiveEnrollment.grantMode,
        ...(inactiveEnrollment.policyVersionAtGrant
          ? { policyVersionAtGrant: inactiveEnrollment.policyVersionAtGrant }
          : {}),
      }),
    };
  }

  const effective = computeEffectiveActions({
    provider: base.identity.provider,
    policyActions: [params.action],
    capabilities: base.identity.capabilities,
    enrollmentActions: enrollment?.allowedActions ?? null,
    collaborationDelegationActions: params.collaborationDelegationActions ?? null,
    agentHasEnrollments: enrollments.length > 0,
    tenantGrantMode,
    collaborationOwnerLiveOk:
      params.scopeSource === "collaboration-owner"
        ? params.collaborationOwnerLive?.ok !== false
        : undefined,
  });

  if (effective.includes(params.action)) {
    return {
      allowed: true,
      identity: base.identity,
      policy: base.policy,
      meta: buildMeta(),
    };
  }

  if (!enrollment && enrollments.length > 0) {
    return {
      allowed: false,
      code: "IDENTITY_ACTION_DENIED",
      message: "该机器人未被员工启用此企业身份。",
      meta: buildMeta(),
    };
  }
  if (!enrollment && (risk === "high" || tenantGrantMode === "explicit_owner_grant")) {
    return {
      allowed: false,
      code: "OWNER_GRANT_REQUIRED",
      message:
        tenantGrantMode === "explicit_owner_grant"
          ? "当前租户已关闭隐式席位继承，需先完成 Owner 授权绑定后才能执行。"
          : "该高风险动作需要员工先为企业身份完成 Owner 授权绑定后才能执行。",
      meta: buildMeta(),
    };
  }
  if (
    params.collaborationDelegationActions &&
    !params.collaborationDelegationActions.includes(params.action)
  ) {
    return {
      allowed: false,
      code: "OWNER_GRANT_ACTION_DENIED",
      message: "该动作不在协作群身份委托的允许集合中。",
      meta: buildMeta(),
    };
  }
  if (enrollment && !enrollment.allowedActions.includes(params.action)) {
    const versionMismatch =
      Boolean(enrollment.policyVersionAtGrant) &&
      Boolean(policyVersion) &&
      enrollment.policyVersionAtGrant !== policyVersion;
    if (versionMismatch) {
      return {
        allowed: false,
        code: "OWNER_GRANT_POLICY_VERSION_MISMATCH",
        message: "企业策略已更新且超出绑定时的授权快照，请重新完成 Owner 授权绑定。",
        meta: buildMeta(),
      };
    }
    return {
      allowed: false,
      code: "OWNER_GRANT_ACTION_DENIED",
      message: "该动作不在员工为企业身份委托的允许集合中。",
      meta: buildMeta(),
    };
  }
  return {
    allowed: false,
    code: "IDENTITY_ACTION_DENIED",
    message: "Seat, agent, and action combination is not allowed for this identity.",
    meta: buildMeta(),
  };
}

/**
 * List projection from the same PDP as enforce. Entries with empty EffectiveActions are dropped.
 */
export function computeEffectiveAccessEntries(params: {
  store: Awaited<ReturnType<typeof loadEnterpriseSeatAssetsStore>>;
  scope: OperationalIdentityRuntimeScope;
  nowIso: string;
  scopeSource?: OperationalIdentityScopeSource;
  collaborationOwnerLive?: CollaborationOwnerLiveRevalidationResult;
  collaborationGroupId?: string;
}): OperationalIdentityAccessEntry[] {
  // Parity with enforce: unmanageable agents project an empty menu.
  if (
    !isAgentManageableForOperationalIdentity({
      store: params.store,
      tenantId: params.scope.tenantId,
      seatId: params.scope.seatId,
      agentId: params.scope.agentId,
    })
  ) {
    return [];
  }
  const tenantGrantMode = resolveOperationalIdentityTenantGrantMode(
    params.store,
    params.scope.tenantId,
  );
  const baseEntries = listOperationalIdentityAccessForSeatAgent({
    store: params.store,
    tenantId: params.scope.tenantId,
    seatId: params.scope.seatId,
    agentId: params.scope.agentId,
    nowIso: params.nowIso,
  });
  const enrollments = listActiveEmployeeEnterpriseIdentityEnrollments(params.store, {
    tenantId: params.scope.tenantId,
    employeeId: params.scope.employeeId,
    agentId: params.scope.agentId,
  });
  const enrolledByIdentity = new Map(
    enrollments.map((enrollment) => [enrollment.identityId, enrollment] as const),
  );
  const agentHasEnrollments = enrollments.length > 0;
  const collaborationOwnerLiveOk =
    params.scopeSource === "collaboration-owner"
      ? params.collaborationOwnerLive?.ok !== false
      : undefined;

  return baseEntries.flatMap((entry) => {
    const identity = getTenantEnterpriseIdentity(
      params.store,
      params.scope.tenantId,
      entry.identityId,
    );
    const enrollment = enrolledByIdentity.get(entry.identityId) ?? null;
    const delegation =
      params.scopeSource === "collaboration-owner" && params.collaborationGroupId
        ? findActiveCollaborationIdentityDelegation(params.store, {
            tenantId: params.scope.tenantId,
            collaborationGroupId: params.collaborationGroupId,
            ownerEmployeeId: params.scope.employeeId,
            agentId: params.scope.agentId,
            identityId: entry.identityId,
          })
        : null;
    const allowedActions = computeEffectiveActions({
      provider: entry.provider,
      policyActions: entry.allowedActions,
      capabilities: identity?.capabilities,
      enrollmentActions: enrollment?.allowedActions ?? null,
      collaborationDelegationActions: delegation?.allowedActions ?? null,
      agentHasEnrollments,
      tenantGrantMode,
      collaborationOwnerLiveOk,
    });
    if (allowedActions.length === 0) {
      return [];
    }
    return [{ ...entry, allowedActions }];
  });
}

async function resolveScopeFromUniqueAgentEnrollment(params: {
  agentId: string;
  employeeId?: string;
  seatId?: string;
}): Promise<OperationalIdentityScopeDecision> {
  const agentId = params.agentId.trim();
  if (!agentId) {
    return denyScope("IDENTITY_CONTEXT_MISSING");
  }
  const { store } = await loadOperationalIdentityRuntimeStore({ client: null });
  const enrollments = listEnterpriseIdentityEnrollmentsForAgent(store, {
    agentId,
    employeeId: params.employeeId,
  });
  if (enrollments.length === 0) {
    return denyScope("AGENT_NOT_ENROLLED");
  }
  const employeeIds = [...new Set(enrollments.map((entry) => entry.employeeId))];
  if (employeeIds.length !== 1) {
    return denyScope("ENROLLMENT_AMBIGUOUS");
  }
  const employeeId = employeeIds[0];
  const tenantIds = [
    ...new Set(
      enrollments.filter((entry) => entry.employeeId === employeeId).map((entry) => entry.tenantId),
    ),
  ];
  if (tenantIds.length !== 1) {
    return denyScope("ENROLLMENT_AMBIGUOUS");
  }
  const tenantId = tenantIds[0];
  const tenantStore = params.employeeId
    ? store
    : (await loadOperationalIdentityRuntimeStore({ client: null, tenantId })).store;
  const access = buildEmployeeAccessSnapshot({
    store: tenantStore,
    tenantId,
    employeeId,
  });
  const seatId = params.seatId?.trim() || access.currentSeat?.seatId?.trim() || "";
  if (!seatId) {
    return denyScope("NO_CURRENT_SEAT");
  }
  return { ok: true, source: "enrollment", scope: { tenantId, seatId, agentId, employeeId } };
}

/**
 * Map an authoritative-membership / seat-resolution failure onto a typed denial.
 *
 * The employee resolver signals distinct causes through `EnterpriseDataStoreError.code` and
 * `TenantContextError.reason`; preserving them is what keeps a presented-but-invalid employee
 * context from degrading into the enrollment tier.
 */
function classifyEmployeeScopeFailure(error: unknown): OperationalIdentityScopeDenialCode {
  if (error instanceof TenantContextError) {
    return error.code === "hint_mismatch" ? "TENANT_MISMATCH" : "TENANT_CONTEXT_MISSING";
  }
  if (error instanceof EnterpriseDataStoreError) {
    if (
      error.code === "TENANT_MISMATCH" ||
      error.code === "NO_CURRENT_SEAT" ||
      error.code === "MEMBERSHIP_INVALID" ||
      error.code === "TENANT_CONTEXT_MISSING" ||
      error.code === "IDENTITY_CONTEXT_MISSING" ||
      error.code === "AGENT_NOT_ENROLLED"
    ) {
      return error.code;
    }
  }
  // Leftover NO_SEAT_CONTEXT and unknown errors fail closed. Do not guess a
  // more specific code from message text — that is how distinct failures used
  // to collapse into one misleading seat-context claim.
  return "MEMBERSHIP_INVALID";
}

export type ResolveOperationalIdentityScopeParams = {
  seatId?: string;
  agentId?: string;
  allowEnrollmentFallback?: boolean;
  /**
   * Explicit collaboration group owner entitlement. Used only when the group policy binds the
   * round to the owner's seat; it never substitutes the speaking member's seat implicitly.
   */
  collaborationOwnerEntitlement?: CollaborationOwnerEntitlement;
};

/**
 * Resolve the Seat-bound execution scope with explicit precedence:
 *
 * 1. valid authenticated employee context;
 * 2. explicit collaboration group owner entitlement;
 * 3. unique enrolled-agent context for non-interactive/background execution;
 * 4. typed denial.
 *
 * Fail closed: when an employee identity *was* presented but is suspended, cross-tenant,
 * membership-invalid, or seatless, the decision is that denial. Tier 3 is reachable only when
 * no employee identity was presented at all, so enrollment can never override a present but
 * invalid employee context.
 */
export async function resolveOperationalIdentityRuntimeScopeDecision(
  client: GatewayClient | null,
  params?: ResolveOperationalIdentityScopeParams,
): Promise<OperationalIdentityScopeDecision> {
  const requestedAgentId = params?.agentId?.trim() || "";
  // Pinned tenant/membership is what distinguishes an authenticated employee webchat
  // turn from a cron/knowledge owner email. Owner email without pins must not close
  // unique enrollment fallback, and must not be classified as MEMBERSHIP_INVALID.
  const hasPresentedEmployeeSession = hasPinnedEmployeeSessionContext(client);
  const entitlement = params?.collaborationOwnerEntitlement;
  const entitlementTenantId = entitlement?.tenantId?.trim();
  const entitlementSeatId = entitlement?.seatId?.trim();
  const entitlementEmployeeId = entitlement?.employeeId?.trim();
  const ownerEntitlementReady = Boolean(
    entitlementTenantId && entitlementSeatId && entitlementEmployeeId && requestedAgentId,
  );

  if (hasPresentedEmployeeSession) {
    let execution: Awaited<ReturnType<typeof resolveTrustedEnterpriseDataExecutionContext>>;
    try {
      execution = await resolveTrustedEnterpriseDataExecutionContext(client);
    } catch (error) {
      // A presented employee identity that fails authoritative resolution must NOT degrade
      // into enrollment fallback or owner-seat substitution.
      return denyScope(classifyEmployeeScopeFailure(error));
    }
    // Explicit group-owner entitlement is independent of the speaking member's seat.
    // Use it only after the speaker's membership has been revalidated.
    if (ownerEntitlementReady) {
      return {
        ok: true,
        source: "collaboration-owner",
        scope: {
          tenantId: entitlementTenantId!,
          seatId: entitlementSeatId!,
          agentId: requestedAgentId,
          employeeId: entitlementEmployeeId!,
        },
      };
    }
    const seatId = params?.seatId?.trim() || execution.seatId;
    if (!seatId) {
      return denyScope("NO_CURRENT_SEAT");
    }
    const agentId = requestedAgentId || execution.agentId?.trim() || "";
    if (!agentId) {
      return denyScope("AGENT_NOT_ENROLLED");
    }
    return {
      ok: true,
      source: "employee",
      scope: {
        tenantId: execution.tenantId,
        seatId,
        agentId,
        employeeId: execution.employeeId,
      },
    };
  }
  if (ownerEntitlementReady) {
    return {
      ok: true,
      source: "collaboration-owner",
      scope: {
        tenantId: entitlementTenantId!,
        seatId: entitlementSeatId!,
        agentId: requestedAgentId,
        employeeId: entitlementEmployeeId!,
      },
    };
  }
  if (params?.allowEnrollmentFallback === false || !requestedAgentId) {
    return denyScope("IDENTITY_CONTEXT_MISSING");
  }
  // Tier 3: non-interactive enrolled-agent execution; must resolve uniquely.
  return resolveScopeFromUniqueAgentEnrollment({
    agentId: requestedAgentId,
    seatId: params?.seatId,
  });
}

/**
 * Compatibility wrapper for callers that only branch on presence of a scope. New code should
 * use {@link resolveOperationalIdentityRuntimeScopeDecision} so the denial reason survives.
 */
export async function resolveOperationalIdentityRuntimeScope(
  client: GatewayClient | null,
  params?: ResolveOperationalIdentityScopeParams,
): Promise<OperationalIdentityRuntimeScope | null> {
  const decision = await resolveOperationalIdentityRuntimeScopeDecision(client, params);
  return decision.ok ? decision.scope : null;
}

/** Prepare PDP extras for a resolved scope (live revalidation + optional delegation). */
function resolvePdpCollaborationExtras(params: {
  store: Awaited<ReturnType<typeof loadEnterpriseSeatAssetsStore>>;
  source: OperationalIdentityScopeSource;
  scope: OperationalIdentityRuntimeScope;
  identityId?: string;
  collaborationOwnerEntitlement?: CollaborationOwnerEntitlement;
}): {
  scopeSource: OperationalIdentityScopeSource;
  collaborationOwnerLive?: CollaborationOwnerLiveRevalidationResult;
  collaborationGroupId?: string;
  collaborationDelegationActions?: readonly string[] | null;
  collaborationDelegationId?: string;
} {
  const collaborationGroupId =
    params.collaborationOwnerEntitlement?.collaborationGroupId?.trim() || undefined;
  let collaborationOwnerLive: CollaborationOwnerLiveRevalidationResult | undefined;
  if (params.source === "collaboration-owner") {
    collaborationOwnerLive = params.collaborationOwnerEntitlement
      ? revalidateCollaborationOwnerLive({
          store: params.store,
          entitlement: params.collaborationOwnerEntitlement,
        })
      : {
          ok: false,
          reason: "entitlement_incomplete",
          message: "协作 Owner 资格信息不完整，无法完成权威复验。",
        };
  }
  let collaborationDelegationActions: readonly string[] | null | undefined;
  let collaborationDelegationId: string | undefined;
  if (
    params.source === "collaboration-owner" &&
    collaborationGroupId &&
    params.identityId?.trim()
  ) {
    const delegation = findActiveCollaborationIdentityDelegation(params.store, {
      tenantId: params.scope.tenantId,
      collaborationGroupId,
      ownerEmployeeId: params.scope.employeeId,
      agentId: params.scope.agentId,
      identityId: params.identityId.trim(),
    });
    if (delegation) {
      collaborationDelegationActions = delegation.allowedActions;
      collaborationDelegationId = delegation.delegationId;
    }
  }
  return {
    scopeSource: params.source,
    ...(collaborationOwnerLive ? { collaborationOwnerLive } : {}),
    ...(collaborationGroupId ? { collaborationGroupId } : {}),
    ...(collaborationDelegationActions
      ? { collaborationDelegationActions, collaborationDelegationId }
      : {}),
  };
}

export async function listOperationalIdentityRuntimeAccess(params: {
  client: GatewayClient | null;
  seatId?: string;
  agentId?: string;
  collaborationOwnerEntitlement?: CollaborationOwnerEntitlement;
}): Promise<{
  scope: OperationalIdentityRuntimeScope;
  source: OperationalIdentityScopeSource;
  entries: OperationalIdentityAccessEntry[];
} | null> {
  const decision = await resolveOperationalIdentityRuntimeScopeDecision(params.client, {
    seatId: params.seatId,
    agentId: params.agentId,
    ...(params.collaborationOwnerEntitlement
      ? { collaborationOwnerEntitlement: params.collaborationOwnerEntitlement }
      : {}),
  });
  if (!decision.ok) {
    return null;
  }
  const { scope, source } = decision;
  const nowIso = new Date().toISOString();
  const { store: seatStore } = await loadOperationalIdentityRuntimeStore({
    client: params.client,
    tenantId: scope.tenantId,
  });
  const extras = resolvePdpCollaborationExtras({
    store: seatStore,
    source,
    scope,
    collaborationOwnerEntitlement: params.collaborationOwnerEntitlement,
  });
  const entries = computeEffectiveAccessEntries({
    store: seatStore,
    scope,
    nowIso,
    scopeSource: extras.scopeSource,
    collaborationOwnerLive: extras.collaborationOwnerLive,
    collaborationGroupId: extras.collaborationGroupId,
  });
  return { scope, source, entries };
}

export async function listOperationalIdentityRuntimeAccessForSeat(params: {
  client: GatewayClient | null;
  seatId?: string;
}): Promise<{
  scope: { tenantId: string; seatId: string; employeeId: string };
  entries: OperationalIdentityAccessEntry[];
} | null> {
  if (!params.client?.user?.trim() && !params.client?.platformUserId?.trim()) {
    return null;
  }
  try {
    const execution = await resolveTrustedEnterpriseDataExecutionContext(params.client);
    const seatId = params.seatId?.trim() || execution.seatId;
    if (!seatId) {
      return null;
    }
    const nowIso = new Date().toISOString();
    const seatStore = await loadEnterpriseSeatAssetsStore(
      await resolveControlPlaneStorePathForClient(params.client, TENANT_SEAT_ASSETS_FILE),
    );
    const entries = listOperationalIdentityAccessForSeat({
      store: seatStore,
      tenantId: execution.tenantId,
      seatId,
      nowIso,
    });
    return {
      scope: {
        tenantId: execution.tenantId,
        seatId,
        employeeId: execution.employeeId,
      },
      entries,
    };
  } catch {
    return null;
  }
}

/**
 * 列出某机器人（agent）在企业身份库中、员工已启用（enrolled）的身份 id 集合。
 */
export async function listEmployeeEnterpriseIdentityEnrollmentIds(params: {
  client: GatewayClient | null;
  agentId?: string;
}): Promise<{ scope: OperationalIdentityRuntimeScope; identityIds: string[] } | null> {
  const scope = await resolveOperationalIdentityRuntimeScope(params.client, {
    agentId: params.agentId,
  });
  if (!scope) {
    return null;
  }
  const { store: seatStore } = await loadOperationalIdentityRuntimeStore({
    client: params.client,
    tenantId: scope.tenantId,
  });
  const identityIds = listActiveEmployeeEnterpriseIdentityEnrollments(seatStore, {
    tenantId: scope.tenantId,
    employeeId: scope.employeeId,
    agentId: scope.agentId,
  }).map((enrollment) => enrollment.identityId);
  return { scope, identityIds };
}

/**
 * 员工域企业身份授权：把企业身份库中的某身份启用给员工名下的某机器人。
 * 受企业策略边界约束——仅当该身份已对员工席位 + agent 放行时才允许，否则拒绝越权。
 */
export async function enrollEmployeeEnterpriseIdentity(params: {
  client: GatewayClient | null;
  identityId: string;
  agentId?: string;
  /** Optional Owner-narrowed actions (must be subset of seat policy EffectiveActions). */
  allowedActions?: string[];
}): Promise<
  | { ok: true; scope: OperationalIdentityRuntimeScope; identityId: string }
  | { ok: false; code: string; message: string }
> {
  const identityId = params.identityId.trim();
  if (!identityId) {
    return { ok: false, code: "IDENTITY_REQUIRED", message: "identityId is required." };
  }
  const decision = await resolveOperationalIdentityRuntimeScopeDecision(params.client, {
    agentId: params.agentId,
    allowEnrollmentFallback: false,
  });
  if (!decision.ok) {
    return { ok: false, code: decision.code, message: decision.message };
  }
  const scope = decision.scope;
  const nowIso = new Date().toISOString();
  const { store: seatStore, storePath } = await loadOperationalIdentityRuntimeStore({
    client: params.client,
    tenantId: scope.tenantId,
  });
  // Stage-2 write-time eligibility: agent must belong to the seat manageability set.
  if (
    !isAgentManageableForOperationalIdentity({
      store: seatStore,
      tenantId: scope.tenantId,
      seatId: scope.seatId,
      agentId: scope.agentId,
    })
  ) {
    return {
      ok: false,
      code: "AGENT_NOT_MANAGEABLE",
      message: "该机器人不在当前岗位可管理集合中，无法完成 Owner 授权绑定。",
    };
  }
  // Enforce the enterprise policy boundary: the identity must already be
  // permitted for this seat + agent before the employee can enable it.
  const permitted = listOperationalIdentityAccessForSeat({
    store: seatStore,
    tenantId: scope.tenantId,
    seatId: scope.seatId,
    nowIso,
  }).find((entry) => entry.identityId === identityId);
  if (!permitted) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_NOT_PERMITTED",
      message: "该企业身份未对当前岗位开放，请联系企业管理员配置策略。",
    };
  }
  if (permitted.status !== "active") {
    return {
      ok: false,
      code: "IDENTITY_INACTIVE",
      message: "该企业身份当前不可用（未激活或需重授权）。",
    };
  }
  const policyCeiling = new Set(permitted.allowedActions);
  let grantActions = permitted.allowedActions;
  if (params.allowedActions && params.allowedActions.length > 0) {
    const narrowed = [
      ...new Set(params.allowedActions.map((entry) => entry.trim()).filter(Boolean)),
    ];
    if (narrowed.length === 0 || narrowed.some((action) => !policyCeiling.has(action))) {
      return {
        ok: false,
        code: "OWNER_GRANT_ACTION_DENIED",
        message: "授权动作必须是企业策略已放行动作的子集。",
      };
    }
    grantActions = narrowed;
  }
  const policies = listTenantIdentityUsagePolicies(seatStore, scope.tenantId, identityId).filter(
    (policy) => policy.enabled && policy.seatIds.includes(scope.seatId),
  );
  const policyVersionAtGrant =
    policies
      .map((policy) => policy.policyVersion)
      .filter(Boolean)
      .toSorted()
      .at(-1) ?? "1";
  upsertEmployeeEnterpriseIdentityEnrollment({
    store: seatStore,
    tenantId: scope.tenantId,
    employeeId: scope.employeeId,
    agentId: scope.agentId,
    identityId,
    allowedActions: grantActions,
    nowIso,
    status: "active",
    grantMode: "explicit_owner_grant",
    policyVersionAtGrant,
  });
  await persistEnterpriseOiRuntimeMutation({
    storePath,
    store: seatStore,
    tenantId: scope.tenantId,
    identityId,
  });
  return { ok: true, scope, identityId };
}

export async function revokeEmployeeEnterpriseIdentity(params: {
  client: GatewayClient | null;
  identityId: string;
  agentId?: string;
}): Promise<
  | { ok: true; scope: OperationalIdentityRuntimeScope; identityId: string }
  | { ok: false; code: string; message: string }
> {
  const identityId = params.identityId.trim();
  if (!identityId) {
    return { ok: false, code: "IDENTITY_REQUIRED", message: "identityId is required." };
  }
  const decision = await resolveOperationalIdentityRuntimeScopeDecision(params.client, {
    agentId: params.agentId,
    allowEnrollmentFallback: false,
  });
  if (!decision.ok) {
    return { ok: false, code: decision.code, message: decision.message };
  }
  const scope = decision.scope;
  const nowIso = new Date().toISOString();
  const { store: seatStore, storePath } = await loadOperationalIdentityRuntimeStore({
    client: params.client,
    tenantId: scope.tenantId,
  });
  removeEmployeeEnterpriseIdentityEnrollment({
    store: seatStore,
    tenantId: scope.tenantId,
    employeeId: scope.employeeId,
    agentId: scope.agentId,
    identityId,
    nowIso,
  });
  await persistEnterpriseOiRuntimeMutation({
    storePath,
    store: seatStore,
    tenantId: scope.tenantId,
    identityId,
  });
  return { ok: true, scope, identityId };
}

export async function enforceOperationalIdentityRuntimeAccess(params: {
  client: GatewayClient | null;
  identityId: string;
  action: string;
  seatId?: string;
  agentId?: string;
  audit?: boolean;
  collaborationOwnerEntitlement?: CollaborationOwnerEntitlement;
}): Promise<
  | {
      ok: true;
      source: OperationalIdentityScopeSource;
      scope: OperationalIdentityRuntimeScope;
      result: Extract<OperationalIdentityAccessResult, { allowed: true }> & {
        meta: OperationalIdentityAccessDecisionMeta;
      };
    }
  | {
      ok: false;
      source?: OperationalIdentityScopeSource;
      scope: OperationalIdentityRuntimeScope | null;
      result: {
        allowed: false;
        code: OperationalIdentityAccessDenialCode | OperationalIdentityScopeDenialCode;
        message: string;
        meta?: OperationalIdentityAccessDecisionMeta;
      } | null;
      message: string;
    }
> {
  const decision = await resolveOperationalIdentityRuntimeScopeDecision(params.client, {
    seatId: params.seatId,
    agentId: params.agentId,
    ...(params.collaborationOwnerEntitlement
      ? { collaborationOwnerEntitlement: params.collaborationOwnerEntitlement }
      : {}),
  });
  if (!decision.ok) {
    return {
      ok: false,
      scope: null,
      result: { allowed: false, code: decision.code, message: decision.message },
      message: decision.message,
    };
  }
  const scope = decision.scope;
  const source = decision.source;
  const nowIso = new Date().toISOString();
  const auditId = randomUUID();
  const { store: seatStore, storePath } = await loadOperationalIdentityRuntimeStore({
    client: params.client,
    tenantId: scope.tenantId,
  });
  const extras = resolvePdpCollaborationExtras({
    store: seatStore,
    source,
    scope,
    identityId: params.identityId,
    collaborationOwnerEntitlement: params.collaborationOwnerEntitlement,
  });
  // Unique PDP — list/prompt/enforce share computeEffectiveAccess; no parallel filter.
  const accessDecision = computeEffectiveAccess({
    store: seatStore,
    tenantId: scope.tenantId,
    seatId: scope.seatId,
    agentId: scope.agentId,
    employeeId: scope.employeeId,
    identityId: params.identityId,
    action: params.action,
    nowIso,
    scopeSource: extras.scopeSource,
    collaborationOwnerLive: extras.collaborationOwnerLive,
    collaborationDelegationActions: extras.collaborationDelegationActions,
    collaborationDelegationId: extras.collaborationDelegationId,
  });
  if (params.audit !== false) {
    const actorEmployeeId = await resolveOperationalIdentityActorEmployeeId({
      client: params.client,
    });
    if (accessDecision.allowed) {
      recordOperationalIdentityUsage({
        store: seatStore,
        tenantId: scope.tenantId,
        identityId: params.identityId,
        seatId: scope.seatId,
        agentId: scope.agentId,
        action: params.action,
        policyId: accessDecision.policy.policyId,
        actorEmployeeId,
        nowIso,
        auditId,
        meta: accessDecision.meta,
      });
    } else {
      recordOperationalIdentityUsageDenied({
        store: seatStore,
        tenantId: scope.tenantId,
        identityId: params.identityId,
        seatId: scope.seatId,
        agentId: scope.agentId,
        action: params.action,
        code: accessDecision.code,
        message: accessDecision.message,
        actorEmployeeId,
        nowIso,
        auditId,
        meta: accessDecision.meta,
      });
    }
    await persistEnterpriseOiRuntimeMutation({
      storePath,
      store: seatStore,
      tenantId: scope.tenantId,
      identityId: params.identityId,
    });
  }
  if (accessDecision.allowed) {
    return {
      ok: true,
      source,
      scope,
      result: {
        allowed: true,
        identity: accessDecision.identity,
        policy: accessDecision.policy,
        meta: accessDecision.meta,
      },
    };
  }
  return {
    ok: false,
    source,
    scope,
    result: {
      allowed: false,
      code: accessDecision.code,
      message: accessDecision.message,
      meta: accessDecision.meta,
    },
    message: accessDecision.message,
  };
}

/**
 * LLM context is not a trust boundary: this formatter only projects PDP EffectiveAccess
 * entries (a menu). Enforce/execute always re-call computeEffectiveAccess independently.
 */
export function formatOperationalIdentityRuntimePrompt(
  entries: OperationalIdentityAccessEntry[],
): string | undefined {
  // Projection only: entries MUST already be PDP EffectiveAccess (from list/computeEffectiveAccessEntries).
  // Do not inject enrollment / high-risk / denial-code rule prose here.
  const active = entries.filter(
    (entry) => entry.status === "active" && entry.allowedActions.length > 0,
  );
  if (active.length === 0) {
    return undefined;
  }
  const lines = active.map(
    (entry) =>
      `- ${entry.displayName} (${entry.providerLabel}, identityId=${entry.identityId}): ${entry.allowedActions.join(", ")}`,
  );
  const wechatDraft = active.some(
    (entry) =>
      entry.provider === "wechat-official" &&
      (entry.allowedActions.includes("publish_draft") ||
        entry.allowedActions.includes("upload_thumb")),
  );
  return [
    "Enterprise operational identity access (Seat-bound; use operational_identity tool: resolve then execute):",
    ...lines,
    ...(wechatDraft
      ? [
          "WeChat Official Account drafts: execute publish_draft with title, HTML content, and thumbUrl / thumbMediaId / thumbBase64 (≤64KB). Do not run wechat-article leftover publish scripts.",
        ]
      : []),
    "Operational identity access does not grant enterprise data invoke elevation.",
    "Server re-validates every operational_identity execute call.",
  ].join("\n");
}

export async function executeEnterpriseOperationalIdentityRuntimeAction(params: {
  client: GatewayClient | null;
  identityId: string;
  action: string;
  payload?: Record<string, unknown>;
  seatId?: string;
  agentId?: string;
  audit?: boolean;
  collaborationOwnerEntitlement?: CollaborationOwnerEntitlement;
}): Promise<
  | {
      ok: true;
      source: OperationalIdentityScopeSource;
      scope: OperationalIdentityRuntimeScope;
      execution: Extract<EnterpriseOperationalIdentityExecutionResult, { ok: true }>;
      policyId: string;
    }
  | {
      ok: false;
      source?: OperationalIdentityScopeSource;
      scope: OperationalIdentityRuntimeScope | null;
      code: string;
      message: string;
    }
> {
  const enforcement = await enforceOperationalIdentityRuntimeAccess({
    client: params.client,
    identityId: params.identityId,
    action: params.action,
    seatId: params.seatId,
    agentId: params.agentId,
    audit: false,
    ...(params.collaborationOwnerEntitlement
      ? { collaborationOwnerEntitlement: params.collaborationOwnerEntitlement }
      : {}),
  });
  if (!enforcement.ok) {
    // P0: authz denials must still be audited even though enforce ran with audit:false
    // (success path audits via executeEnterpriseOperationalIdentityAction).
    if (params.audit !== false && enforcement.scope) {
      const nowIso = new Date().toISOString();
      const auditId = randomUUID();
      const actorEmployeeId =
        (await resolveOperationalIdentityActorEmployeeId({
          client: params.client,
        })) ?? enforcement.scope.employeeId;
      const { store: seatStore, storePath } = await loadOperationalIdentityRuntimeStore({
        client: params.client,
        tenantId: enforcement.scope.tenantId,
      });
      recordOperationalIdentityUsageDenied({
        store: seatStore,
        tenantId: enforcement.scope.tenantId,
        identityId: params.identityId,
        seatId: enforcement.scope.seatId,
        agentId: enforcement.scope.agentId,
        action: params.action,
        code: enforcement.result?.code ?? "IDENTITY_ACTION_DENIED",
        message: enforcement.message,
        actorEmployeeId,
        nowIso,
        auditId,
        meta: enforcement.result?.meta,
      });
      await persistEnterpriseOiRuntimeMutation({
        storePath,
        store: seatStore,
        tenantId: enforcement.scope.tenantId,
        identityId: params.identityId,
      });
    }
    return {
      ok: false,
      source: enforcement.source,
      scope: enforcement.scope,
      code: enforcement.result?.code ?? "IDENTITY_ACTION_DENIED",
      message: enforcement.message,
    };
  }

  const parsedPayload = parseEnterpriseOperationalIdentityExecutionPayload(params.payload ?? {});
  const nowIso = new Date().toISOString();
  const auditId = randomUUID();
  const actorEmployeeId =
    (await resolveOperationalIdentityActorEmployeeId({
      client: params.client,
    })) ?? enforcement.scope.employeeId;
  const { store: seatStore, storePath } = await loadOperationalIdentityRuntimeStore({
    client: params.client,
    tenantId: enforcement.scope.tenantId,
  });
  const execution = await executeEnterpriseOperationalIdentityAction({
    store: seatStore,
    tenantId: enforcement.scope.tenantId,
    identity: enforcement.result.identity,
    action: params.action,
    payload: parsedPayload,
    seatId: enforcement.scope.seatId,
    agentId: enforcement.scope.agentId,
    policyId: enforcement.result.policy.policyId,
    actorEmployeeId,
    nowIso,
    auditId: params.audit === false ? undefined : auditId,
    accessMeta: enforcement.result.meta,
  });
  await persistEnterpriseOiRuntimeMutation({
    storePath,
    store: seatStore,
    tenantId: enforcement.scope.tenantId,
    identityId: enforcement.result.identity.identityId,
  });
  if (!execution.ok) {
    return {
      ok: false,
      source: enforcement.source,
      scope: enforcement.scope,
      code: execution.code,
      message: execution.message,
    };
  }
  return {
    ok: true,
    source: enforcement.source,
    scope: enforcement.scope,
    execution,
    policyId: enforcement.result.policy.policyId,
  };
}

/** Admin: read tenant OI grant mode (not projected to the model). */
export function readOperationalIdentityTenantGrantMode(
  store: Awaited<ReturnType<typeof loadEnterpriseSeatAssetsStore>>,
  tenantId: string,
): OperationalIdentityTenantSettings {
  return getOperationalIdentityTenantSettings(store, tenantId);
}

/**
 * Admin: switch tenant grant mode. When flipping to explicit_owner_grant, callers should
 * present previewOperationalIdentityImplicitInheritExitDelta to operators (not to the LLM).
 */
export function updateOperationalIdentityTenantGrantMode(params: {
  store: Awaited<ReturnType<typeof loadEnterpriseSeatAssetsStore>>;
  tenantId: string;
  grantMode: OperationalIdentityTenantGrantMode;
  nowIso: string;
  actorEmployeeId?: string;
}): {
  settings: OperationalIdentityTenantSettings;
  implicitInheritExitDelta: ReturnType<typeof previewOperationalIdentityImplicitInheritExit>;
} {
  const beforeDelta =
    params.grantMode === "explicit_owner_grant"
      ? previewOperationalIdentityImplicitInheritExit({
          store: params.store,
          tenantId: params.tenantId,
        })
      : [];
  const settings = setOperationalIdentityTenantGrantMode({
    store: params.store,
    tenantId: params.tenantId,
    grantMode: params.grantMode,
    nowIso: params.nowIso,
    actorEmployeeId: params.actorEmployeeId,
  });
  return { settings, implicitInheritExitDelta: beforeDelta };
}

/** Admin preview of agents that lose seat-inherit if the tenant exits implicit mode. */
export function previewOperationalIdentityImplicitInheritExitDelta(params: {
  store: Awaited<ReturnType<typeof loadEnterpriseSeatAssetsStore>>;
  tenantId: string;
}): ReturnType<typeof previewOperationalIdentityImplicitInheritExit> {
  return previewOperationalIdentityImplicitInheritExit(params);
}
