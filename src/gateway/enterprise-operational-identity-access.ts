import { EnterpriseDataStoreError } from "./enterprise-data/connector-action-store.js";
import { resolveIdentityUsagePolicyForSeatAgent } from "./enterprise-operational-identity-policy.js";
import { resolveOperationalIdentityProviderPresentation } from "./enterprise-operational-identity-providers.js";
import {
  getTenantEnterpriseIdentity,
  listTenantDataSourceIdentityBindings,
  listTenantEnterpriseIdentities,
  listTenantIdentityUsagePolicies,
  refreshEnterpriseIdentityStatus,
} from "./enterprise-operational-identity-store.js";
import type {
  EnterpriseIdentity,
  EnterpriseIdentityStatus,
  IdentityUsagePolicy,
} from "./enterprise-operational-identity-types.js";
import { recordEnterpriseAssetAuditEvent } from "./enterprise-seat-assets-audit.js";
import type {
  EnterpriseAuditMetadataValue,
  EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";

export type OperationalIdentityAccessDenialCode =
  | "IDENTITY_NOT_FOUND"
  | "IDENTITY_INACTIVE"
  | "IDENTITY_ACTION_DENIED"
  | "OWNER_GRANT_REQUIRED"
  | "OWNER_GRANT_ACTION_DENIED"
  | "OWNER_GRANT_POLICY_VERSION_MISMATCH"
  | "OWNER_GRANT_INACTIVE"
  | "AGENT_NOT_MANAGEABLE"
  | "SEAT_AGENT_REQUIRED"
  /** Collaboration-owner live revalidation failed (high-risk fail-closed). */
  | "COLLABORATION_OWNER_REVALIDATION_FAILED";

/** PDP decision meta projected into usage / usage_denied audit metadata (not LLM). */
export type OperationalIdentityAccessDecisionMeta = {
  /** Three-phase model stage; enforce/execute use runtime_decision. */
  stage?: string;
  /** Where the Seat scope came from: employee | collaboration-owner | enrollment. */
  scopeSource?: string;
  enrollmentId?: string;
  risk?: string;
  policyVersion?: string;
  policyVersionAtGrant?: string;
  grantMode?: string;
  grantStatus?: string;
  tenantGrantMode?: string;
  /** CollaborationIdentityDelegation id when a narrowing row participated. */
  collaborationDelegationId?: string;
  /** Live revalidation failure reason (collaboration-owner high-risk path). */
  revalidationReason?: string;
  [key: string]: string | undefined;
};

/** Flatten PDP meta into audit-safe metadata (drops empty/undefined). */
export function operationalIdentityAccessMetaForAudit(
  meta?: OperationalIdentityAccessDecisionMeta | null,
): Record<string, EnterpriseAuditMetadataValue> {
  if (!meta) {
    return {};
  }
  const out: Record<string, EnterpriseAuditMetadataValue> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

export type OperationalIdentityAccessResult =
  | {
      allowed: true;
      identity: EnterpriseIdentity;
      policy: IdentityUsagePolicy;
    }
  | {
      allowed: false;
      code: OperationalIdentityAccessDenialCode;
      message: string;
    };

export type OperationalIdentityAccessEntry = {
  identityId: string;
  displayName: string;
  provider: string;
  providerLabel: string;
  status: EnterpriseIdentityStatus;
  allowedActions: string[];
  policyIds: string[];
};

export type OperationalIdentityRelationshipSummary = {
  identityId: string;
  displayName: string;
  providerLabel: string;
  status: EnterpriseIdentityStatus;
  seats: string[];
  agents: string[];
  dataSourceIds: string[];
  allowedActions: string[];
};

const FORBIDDEN_OPERATIONAL_IDENTITY_INVOKE_FIELDS = [
  "identityId",
  "operationalIdentityId",
  "enterpriseIdentityId",
  "operationalIdentityAccessToken",
] as const;

export function listForbiddenOperationalIdentityInvokeFields(
  params: Record<string, unknown>,
): string[] {
  return FORBIDDEN_OPERATIONAL_IDENTITY_INVOKE_FIELDS.filter((field) => {
    const value = params[field];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function assertNoOperationalIdentityExecutionElevation(
  params: Record<string, unknown>,
): void {
  const supplied = listForbiddenOperationalIdentityInvokeFields(params);
  if (supplied.length > 0) {
    throw new EnterpriseDataStoreError(
      "UNTRUSTED_OPERATIONAL_IDENTITY_CONTEXT",
      `Operational identity must not be supplied to enterprise data invoke: ${supplied.join(", ")}.`,
    );
  }
}

export function assertEnterpriseDataInvokeContextExcludesOperationalIdentity(
  context: Record<string, unknown>,
): void {
  const supplied = listForbiddenOperationalIdentityInvokeFields(context);
  if (supplied.length > 0) {
    throw new EnterpriseDataStoreError(
      "UNTRUSTED_OPERATIONAL_IDENTITY_CONTEXT",
      `Enterprise data invoke context must not carry operational identity fields: ${supplied.join(", ")}.`,
    );
  }
}

function normalizeSeatAgent(params: {
  seatId?: string;
  agentId?: string;
}): { seatId: string; agentId: string } | null {
  const seatId = params.seatId?.trim() ?? "";
  const agentId = params.agentId?.trim() ?? "";
  if (!seatId || !agentId) {
    return null;
  }
  return { seatId, agentId };
}

export function resolveOperationalIdentityAccess(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  agentId: string;
  identityId: string;
  action: string;
  nowIso: string;
}): OperationalIdentityAccessResult {
  const normalized = normalizeSeatAgent(params);
  if (!normalized) {
    return {
      allowed: false,
      code: "SEAT_AGENT_REQUIRED",
      message: "seatId and agentId are required.",
    };
  }
  refreshEnterpriseIdentityStatus({
    store: params.store,
    tenantId: params.tenantId,
    identityId: params.identityId,
    nowIso: params.nowIso,
  });
  const identity = getTenantEnterpriseIdentity(params.store, params.tenantId, params.identityId);
  if (!identity || identity.revokedAt) {
    return {
      allowed: false,
      code: "IDENTITY_NOT_FOUND",
      message: "Operational identity not found.",
    };
  }
  if (identity.status !== "active") {
    return {
      allowed: false,
      code: "IDENTITY_INACTIVE",
      message: `Operational identity is ${identity.status}.`,
    };
  }
  const policy = resolveIdentityUsagePolicyForSeatAgent({
    store: params.store,
    tenantId: params.tenantId,
    identityId: params.identityId,
    seatId: normalized.seatId,
    agentId: normalized.agentId,
    action: params.action,
  });
  if (!policy) {
    return {
      allowed: false,
      code: "IDENTITY_ACTION_DENIED",
      message: "Seat, agent, and action combination is not allowed for this identity.",
    };
  }
  if (
    identity.capabilities &&
    identity.capabilities.length > 0 &&
    !identity.capabilities.includes(params.action)
  ) {
    return {
      allowed: false,
      code: "IDENTITY_ACTION_DENIED",
      message: `Action ${params.action} is not in verified capabilities for this identity.`,
    };
  }
  return { allowed: true, identity, policy };
}

export function listOperationalIdentityAccessForSeatAgent(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  agentId: string;
  nowIso: string;
}): OperationalIdentityAccessEntry[] {
  const normalized = normalizeSeatAgent(params);
  if (!normalized) {
    return [];
  }
  const output: OperationalIdentityAccessEntry[] = [];
  for (const identity of listTenantEnterpriseIdentities(params.store, params.tenantId)) {
    refreshEnterpriseIdentityStatus({
      store: params.store,
      tenantId: params.tenantId,
      identityId: identity.identityId,
      nowIso: params.nowIso,
    });
    const refreshed = getTenantEnterpriseIdentity(
      params.store,
      params.tenantId,
      identity.identityId,
    );
    if (!refreshed || refreshed.revokedAt || refreshed.status !== "active") {
      continue;
    }
    const policies = listTenantIdentityUsagePolicies(
      params.store,
      params.tenantId,
      identity.identityId,
    ).filter((policy) => policy.enabled && policy.seatIds.includes(normalized.seatId));
    const allowedActions = new Set<string>();
    const policyIds: string[] = [];
    for (const policy of policies) {
      policyIds.push(policy.policyId);
      for (const action of policy.allowedActions) {
        allowedActions.add(action);
      }
    }
    if (allowedActions.size === 0) {
      continue;
    }
    const providerLabel = resolveOperationalIdentityProviderPresentation(refreshed.provider).label;
    output.push({
      identityId: refreshed.identityId,
      displayName: refreshed.displayName,
      provider: refreshed.provider,
      providerLabel,
      status: refreshed.status,
      allowedActions: [...allowedActions].toSorted(),
      policyIds,
    });
  }
  return output.toSorted((left, right) => left.displayName.localeCompare(right.displayName));
}

/** Seat-level catalog: identities open to a岗位 via policy (ignores allowedAgentIds). */
export function listOperationalIdentityAccessForSeat(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  nowIso: string;
}): OperationalIdentityAccessEntry[] {
  const seatId = params.seatId.trim();
  if (!seatId) {
    return [];
  }
  const output: OperationalIdentityAccessEntry[] = [];
  for (const identity of listTenantEnterpriseIdentities(params.store, params.tenantId)) {
    refreshEnterpriseIdentityStatus({
      store: params.store,
      tenantId: params.tenantId,
      identityId: identity.identityId,
      nowIso: params.nowIso,
    });
    const refreshed = getTenantEnterpriseIdentity(
      params.store,
      params.tenantId,
      identity.identityId,
    );
    if (!refreshed || refreshed.revokedAt || refreshed.status !== "active") {
      continue;
    }
    const policies = listTenantIdentityUsagePolicies(
      params.store,
      params.tenantId,
      identity.identityId,
    ).filter((policy) => policy.enabled && policy.seatIds.includes(seatId));
    const allowedActions = new Set<string>();
    const policyIds: string[] = [];
    for (const policy of policies) {
      policyIds.push(policy.policyId);
      for (const action of policy.allowedActions) {
        allowedActions.add(action);
      }
    }
    if (allowedActions.size === 0) {
      continue;
    }
    const providerLabel = resolveOperationalIdentityProviderPresentation(refreshed.provider).label;
    output.push({
      identityId: refreshed.identityId,
      displayName: refreshed.displayName,
      provider: refreshed.provider,
      providerLabel,
      status: refreshed.status,
      allowedActions: [...allowedActions].toSorted(),
      policyIds,
    });
  }
  return output.toSorted((left, right) => left.displayName.localeCompare(right.displayName));
}

export function summarizeOperationalIdentityRelationships(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  nowIso: string;
}): OperationalIdentityRelationshipSummary[] {
  return listTenantEnterpriseIdentities(params.store, params.tenantId).map((identity) => {
    refreshEnterpriseIdentityStatus({
      store: params.store,
      tenantId: params.tenantId,
      identityId: identity.identityId,
      nowIso: params.nowIso,
    });
    const refreshed =
      getTenantEnterpriseIdentity(params.store, params.tenantId, identity.identityId) ?? identity;
    const policies = listTenantIdentityUsagePolicies(
      params.store,
      params.tenantId,
      identity.identityId,
    ).filter((policy) => policy.enabled);
    const seats = [...new Set(policies.flatMap((policy) => policy.seatIds))];
    const agents = [
      ...new Set(
        Object.values(params.store.employeeIdentityEnrollments ?? {})
          .filter(
            (enrollment) =>
              enrollment.tenantId === params.tenantId &&
              enrollment.identityId === identity.identityId,
          )
          .map((enrollment) => enrollment.agentId),
      ),
    ];
    const allowedActions = [
      ...new Set(policies.flatMap((policy) => policy.allowedActions)),
    ].toSorted();
    const dataSourceIds = listTenantDataSourceIdentityBindings(
      params.store,
      params.tenantId,
      identity.identityId,
    ).map((binding) => binding.dataSourceId);
    return {
      identityId: refreshed.identityId,
      displayName: refreshed.displayName,
      providerLabel: resolveOperationalIdentityProviderPresentation(refreshed.provider).label,
      status: refreshed.status,
      seats,
      agents,
      dataSourceIds,
      allowedActions,
    };
  });
}

export function recordOperationalIdentityUsage(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  identityId: string;
  seatId: string;
  agentId: string;
  action: string;
  policyId?: string;
  actorEmployeeId?: string;
  nowIso: string;
  auditId?: string;
  result?: "success" | "failure";
  /** PDP EffectiveAccess meta — closed into audit for allow-path usage. */
  meta?: OperationalIdentityAccessDecisionMeta | null;
}): void {
  recordEnterpriseAssetAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "identity.used",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    seatId: params.seatId,
    policyId: params.policyId,
    resourceType: "identity",
    resourceId: params.identityId,
    metadata: {
      agentId: params.agentId,
      action: params.action,
      result: params.result ?? "success",
      ...operationalIdentityAccessMetaForAudit(params.meta),
    },
  });
}

export function recordOperationalIdentityUsageDenied(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  identityId?: string;
  seatId?: string;
  agentId?: string;
  action?: string;
  code: OperationalIdentityAccessDenialCode | (string & {});
  message: string;
  actorEmployeeId?: string;
  nowIso: string;
  auditId?: string;
  /** PDP EffectiveAccess meta — closed into audit for usage_denied. */
  meta?: OperationalIdentityAccessDecisionMeta | null;
}): void {
  recordEnterpriseAssetAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "identity.usage_denied",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    ...(params.seatId ? { seatId: params.seatId } : {}),
    resourceType: "identity",
    resourceId: params.identityId,
    metadata: {
      ...(params.agentId ? { agentId: params.agentId } : {}),
      ...(params.action ? { action: params.action } : {}),
      code: params.code,
      message: params.message,
      ...operationalIdentityAccessMetaForAudit(params.meta),
    },
  });
}

export function resolveDataSourceOperationalIdentityBindings(params: {
  seatStore: EnterpriseSeatAssetsStore;
  tenantId: string;
  sourceId: string;
  nowIso: string;
}): Array<{
  bindingId: string;
  identityId: string;
  displayName: string;
  provider: string;
  providerLabel: string;
  status: EnterpriseIdentityStatus;
  purpose: string;
}> {
  return listTenantDataSourceIdentityBindings(params.seatStore, params.tenantId)
    .filter((binding) => binding.dataSourceId === params.sourceId)
    .flatMap((binding) => {
      refreshEnterpriseIdentityStatus({
        store: params.seatStore,
        tenantId: params.tenantId,
        identityId: binding.identityId,
        nowIso: params.nowIso,
      });
      const identity = getTenantEnterpriseIdentity(
        params.seatStore,
        params.tenantId,
        binding.identityId,
      );
      if (!identity || identity.revokedAt) {
        return [];
      }
      return [
        {
          bindingId: binding.bindingId,
          identityId: identity.identityId,
          displayName: identity.displayName,
          provider: identity.provider,
          providerLabel: resolveOperationalIdentityProviderPresentation(identity.provider).label,
          status: identity.status,
          purpose: binding.purpose,
        },
      ];
    })
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName));
}
