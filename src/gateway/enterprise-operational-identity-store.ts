import { randomUUID } from "node:crypto";
import { withEmployeeUniversalStewardAgentIds } from "../agents/builtin-steward/identity.js";
import { findDataSource } from "./enterprise-data/data-source-store.js";
import type { EnterpriseDataStore } from "./enterprise-data/types.js";
import type { EnterpriseOperationalIdentityCredentialSecret } from "./enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import { validateIdentityUsagePolicyInput } from "./enterprise-operational-identity-policy.js";
import {
  assessOperationalIdentityCredentialReadiness,
  isSupportedOperationalIdentityConnectorId,
  probeOperationalIdentityCredentialStatus,
  resolveIdentityStatusFromReadiness,
  resolveOperationalIdentityProviderFromConnectorId,
  resolveOperationalIdentityProviderPresentation,
  resolveUnsupportedOperationalIdentityConnectorMessage,
} from "./enterprise-operational-identity-providers.js";
import type { OperationalIdentityCapabilityDiscovery } from "./enterprise-operational-identity-providers/capability-discovery.js";
import type { OperationalIdentityCredentialProbeResult } from "./enterprise-operational-identity-providers/credential-probe.js";
import type {
  CollaborationIdentityDelegation,
  CollaborationIdentityDelegationStatus,
  DataSourceIdentityBinding,
  DataSourceIdentityBindingPurpose,
  EmployeeEnterpriseIdentityEnrollment,
  EmployeeEnterpriseIdentityGrantMode,
  EmployeeEnterpriseIdentityGrantStatus,
  EnterpriseIdentity,
  EnterpriseIdentityStatus,
  EnterpriseOperationalIdentityProvider,
  IdentityUsagePolicy,
  OperationalIdentityTenantGrantMode,
  OperationalIdentityTenantSettings,
} from "./enterprise-operational-identity-types.js";
import { recordEnterpriseAssetAuditEvent } from "./enterprise-seat-assets-audit.js";
import {
  listTenantAssetAuditEvents,
  resolveSeatGrantedAgentAssetIds,
  type EnterpriseAssetAuditEvent,
  type EnterprisePositionSeat,
  type EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";

export function listTenantEnterpriseIdentities(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
): EnterpriseIdentity[] {
  return Object.values(store.enterpriseIdentities)
    .filter((identity) => identity.tenantId === tenantId && !identity.revokedAt)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function listTenantIdentityUsagePolicies(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
  identityId?: string,
): IdentityUsagePolicy[] {
  return Object.values(store.identityUsagePolicies)
    .filter(
      (policy) =>
        policy.tenantId === tenantId && (identityId ? policy.identityId === identityId : true),
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function listTenantDataSourceIdentityBindings(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
  identityId?: string,
): DataSourceIdentityBinding[] {
  return Object.values(store.dataSourceIdentityBindings)
    .filter(
      (binding) =>
        binding.tenantId === tenantId && (identityId ? binding.identityId === identityId : true),
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function getTenantEnterpriseIdentity(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
  identityId: string,
): EnterpriseIdentity | null {
  const identity = store.enterpriseIdentities[identityId];
  if (!identity || identity.tenantId !== tenantId) {
    return null;
  }
  return identity;
}

function resolveCredentialBinding(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  credentialBindingId: string;
}) {
  const binding = params.store.credentialBindings[params.credentialBindingId];
  if (!binding || binding.tenantId !== params.tenantId) {
    return null;
  }
  return binding;
}

export type EnterpriseIdentitySteward = {
  kind: "seat" | "employee";
  ownerId: string;
};

/** Credential steward (岗位/员工) for a connected enterprise identity. */
export function resolveEnterpriseIdentitySteward(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  credentialBindingId: string;
}): EnterpriseIdentitySteward | null {
  const binding = resolveCredentialBinding(params);
  if (!binding || binding.revokedAt) {
    return null;
  }
  if (binding.ownerType !== "seat" && binding.ownerType !== "employee") {
    return null;
  }
  return { kind: binding.ownerType, ownerId: binding.ownerId };
}

export type EnterpriseIdentityStewardLabel = {
  label: string;
  kind: "seat" | "employee" | "unassigned";
  detail?: string;
};

/** Human-readable steward for admin UI (never raw internal ids when avoidable). */
export function resolveEnterpriseIdentityStewardLabel(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  steward: EnterpriseIdentitySteward;
  userLabelById: Map<string, { displayName?: string; email?: string }>;
}): EnterpriseIdentityStewardLabel {
  const formatSeat = (seat: EnterprisePositionSeat): EnterpriseIdentityStewardLabel => {
    const occupant = seat.currentEmployeeId
      ? params.userLabelById.get(seat.currentEmployeeId)
      : undefined;
    const occupantLabel = occupant?.displayName?.trim() || occupant?.email?.trim() || null;
    return {
      kind: "seat",
      label: occupantLabel ? `${seat.title} · ${occupantLabel}` : seat.title,
      detail: occupantLabel ? "保存凭证时绑定的岗位及在岗成员" : "保存凭证时绑定的岗位（当前空岗）",
    };
  };

  if (params.steward.kind === "seat") {
    const seat = params.store.seats[params.steward.ownerId];
    if (seat && seat.tenantId === params.tenantId) {
      return formatSeat(seat);
    }
  }

  const ownerId = params.steward.ownerId.trim();
  const user = params.userLabelById.get(ownerId);
  if (user) {
    const label = user.displayName?.trim() || user.email?.trim() || ownerId;
    const email = user.email?.trim();
    return {
      kind: "employee",
      label,
      detail: email && label !== email ? `保存凭证的企业成员（${email}）` : "保存凭证的企业成员",
    };
  }

  const seatByOwnerId = params.store.seats[ownerId];
  if (seatByOwnerId && seatByOwnerId.tenantId === params.tenantId) {
    return formatSeat(seatByOwnerId);
  }

  return {
    kind: params.steward.kind,
    label: params.steward.kind === "seat" ? "未知岗位" : "未知企业成员",
    detail: "请刷新组织与身份列表后重试",
  };
}

function resolveIdentityProviderFromCredential(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  credentialBindingId: string;
}): EnterpriseOperationalIdentityProvider | null {
  const binding = resolveCredentialBinding(params);
  if (!binding) {
    return null;
  }
  return resolveOperationalIdentityProviderFromConnectorId(binding.connectorId);
}

function ensureIdentityCredentialReuse(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  credentialBindingId: string;
  excludeIdentityId?: string;
}): EnterpriseIdentity | null {
  return (
    Object.values(params.store.enterpriseIdentities).find(
      (identity) =>
        identity.tenantId === params.tenantId &&
        identity.credentialBindingId === params.credentialBindingId &&
        !identity.revokedAt &&
        identity.identityId !== params.excludeIdentityId,
    ) ?? null
  );
}

function ensureEnterpriseExternalAccountReuse(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  provider: EnterpriseIdentity["provider"];
  externalAccountId: string;
  excludeIdentityId?: string;
}): EnterpriseIdentity | null {
  return (
    Object.values(params.store.enterpriseIdentities).find(
      (identity) =>
        identity.tenantId === params.tenantId &&
        identity.provider === params.provider &&
        identity.externalAccountId === params.externalAccountId &&
        !identity.revokedAt &&
        identity.identityId !== params.excludeIdentityId,
    ) ?? null
  );
}

export function registerEnterpriseIdentity(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  displayName: string;
  credentialBindingId: string;
  connectorProfileId?: string;
  externalAccountId?: string;
  expiresAt?: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): { ok: true; identity: EnterpriseIdentity } | { ok: false; code: string; error: string } {
  const credential = resolveCredentialBinding({
    store: params.store,
    tenantId: params.tenantId,
    credentialBindingId: params.credentialBindingId,
  });
  if (!credential) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_CREDENTIAL_NOT_FOUND",
      error: "credentialBindingId must reference an existing tenant credential binding.",
    };
  }
  if (!isSupportedOperationalIdentityConnectorId(credential.connectorId)) {
    const unsupportedMessage =
      resolveUnsupportedOperationalIdentityConnectorMessage(credential.connectorId) ??
      `Connector ${credential.connectorId} is not supported for operational identity.`;
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_PROVIDER_UNSUPPORTED",
      error: unsupportedMessage,
    };
  }
  const provider = resolveOperationalIdentityProviderFromConnectorId(credential.connectorId);
  if (!provider) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_PROVIDER_UNSUPPORTED",
      error: "Unable to resolve provider from credential binding.",
    };
  }
  const duplicate = ensureIdentityCredentialReuse({
    store: params.store,
    tenantId: params.tenantId,
    credentialBindingId: params.credentialBindingId,
  });
  if (duplicate) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_CREDENTIAL_ALREADY_BOUND",
      error: "An active identity already references this credential binding.",
    };
  }
  const externalAccountId = params.externalAccountId?.trim() || undefined;
  if (externalAccountId) {
    const sameExternalAccount = ensureEnterpriseExternalAccountReuse({
      store: params.store,
      tenantId: params.tenantId,
      provider,
      externalAccountId,
    });
    if (sameExternalAccount) {
      return {
        ok: false,
        code: "ENTERPRISE_IDENTITY_EXTERNAL_ACCOUNT_ALREADY_BOUND",
        error: "An active identity already references this external account.",
      };
    }
  }
  const displayName = params.displayName.trim();
  if (!displayName) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_DISPLAY_NAME_REQUIRED",
      error: "displayName is required.",
    };
  }
  const status = probeOperationalIdentityCredentialStatus({
    credential,
    nowIso: params.nowIso,
  });
  const identity: EnterpriseIdentity = {
    identityId: randomUUID(),
    tenantId: params.tenantId,
    provider,
    displayName,
    credentialBindingId: params.credentialBindingId,
    status,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
    lastVerifiedAt: params.nowIso,
    ...(params.connectorProfileId ? { connectorProfileId: params.connectorProfileId } : {}),
    ...(params.externalAccountId ? { externalAccountId: params.externalAccountId } : {}),
    ...(params.expiresAt ? { expiresAt: params.expiresAt } : {}),
  };
  params.store.enterpriseIdentities[identity.identityId] = identity;
  recordEnterpriseAssetAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "identity.registered",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    resourceType: "identity",
    resourceId: identity.identityId,
    metadata: {
      provider: identity.provider,
      credentialBindingId: identity.credentialBindingId,
      displayName: identity.displayName,
    },
  });
  return { ok: true, identity };
}

export function updateEnterpriseIdentity(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  identityId: string;
  displayName?: string;
  connectorProfileId?: string | null;
  externalAccountId?: string | null;
  expiresAt?: string | null;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): { ok: true; identity: EnterpriseIdentity } | { ok: false; code: string; error: string } {
  const identity = getTenantEnterpriseIdentity(params.store, params.tenantId, params.identityId);
  if (!identity || identity.revokedAt) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_NOT_FOUND",
      error: "Identity not found.",
    };
  }
  if (typeof params.displayName === "string") {
    const displayName = params.displayName.trim();
    if (!displayName) {
      return {
        ok: false,
        code: "ENTERPRISE_IDENTITY_DISPLAY_NAME_REQUIRED",
        error: "displayName is required.",
      };
    }
    identity.displayName = displayName;
  }
  if (params.connectorProfileId !== undefined) {
    if (params.connectorProfileId === null) {
      delete identity.connectorProfileId;
    } else {
      identity.connectorProfileId = params.connectorProfileId;
    }
  }
  if (params.externalAccountId !== undefined) {
    if (params.externalAccountId === null) {
      delete identity.externalAccountId;
    } else {
      identity.externalAccountId = params.externalAccountId;
    }
  }
  if (params.expiresAt !== undefined) {
    if (params.expiresAt === null) {
      delete identity.expiresAt;
    } else {
      identity.expiresAt = params.expiresAt;
    }
  }
  identity.updatedAt = params.nowIso;
  params.store.enterpriseIdentities[identity.identityId] = identity;
  return { ok: true, identity };
}

export function refreshEnterpriseIdentityStatus(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  identityId: string;
  nowIso: string;
}): EnterpriseIdentityStatus | null {
  const identity = getTenantEnterpriseIdentity(params.store, params.tenantId, params.identityId);
  if (!identity || identity.revokedAt) {
    return null;
  }
  const credential = resolveCredentialBinding({
    store: params.store,
    tenantId: params.tenantId,
    credentialBindingId: identity.credentialBindingId,
  });
  if (!credential) {
    identity.status = "expired";
    identity.updatedAt = params.nowIso;
    return identity.status;
  }
  identity.status = probeOperationalIdentityCredentialStatus({
    credential,
    nowIso: params.nowIso,
  });
  identity.lastVerifiedAt = params.nowIso;
  identity.updatedAt = params.nowIso;
  params.store.enterpriseIdentities[identity.identityId] = identity;
  return identity.status;
}

export function verifyEnterpriseIdentity(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  identityId: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
  secret?: EnterpriseOperationalIdentityCredentialSecret | null;
  probeResults?: Record<string, OperationalIdentityCredentialProbeResult>;
  capabilityDiscovery?: OperationalIdentityCapabilityDiscovery;
}):
  | {
      ok: true;
      identity: EnterpriseIdentity;
      readiness?: ReturnType<typeof assessOperationalIdentityCredentialReadiness>;
    }
  | { ok: false; code: string; error: string } {
  const identity = getTenantEnterpriseIdentity(params.store, params.tenantId, params.identityId);
  if (!identity || identity.revokedAt) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_NOT_FOUND",
      error: "Identity not found.",
    };
  }
  const credential = resolveCredentialBinding({
    store: params.store,
    tenantId: params.tenantId,
    credentialBindingId: identity.credentialBindingId,
  });
  if (!credential) {
    identity.status = "expired";
    identity.updatedAt = params.nowIso;
    params.store.enterpriseIdentities[identity.identityId] = identity;
    return { ok: true, identity };
  }
  if (credential.status === "revoked") {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_CREDENTIAL_REVOKED",
      error: "Linked credential binding is revoked; register a new identity instead.",
    };
  }
  const readiness = assessOperationalIdentityCredentialReadiness({
    provider: identity.provider,
    credential,
    secret: params.secret ?? null,
    externalAccountId: identity.externalAccountId,
    probeResults: params.probeResults,
  });
  identity.status = resolveIdentityStatusFromReadiness({
    credentialStatus: credential.status,
    ready: readiness.ready,
    expiresAt: identity.expiresAt,
    nowIso: params.nowIso,
  });
  identity.lastVerifiedAt = params.nowIso;
  identity.configReadiness = {
    items: readiness.items.map((item) => ({
      key: item.key,
      label: item.label,
      satisfied: item.satisfied,
      scope: item.scope,
      ...(item.detail ? { detail: item.detail } : {}),
    })),
    probedAt: params.probeResults ? params.nowIso : identity.configReadiness?.probedAt,
  };
  if (params.capabilityDiscovery) {
    identity.capabilities = params.capabilityDiscovery.capabilities;
    identity.capabilityMissing = params.capabilityDiscovery.missing;
    identity.capabilityDiscoveredAt = params.capabilityDiscovery.discoveredAt;
    if (params.capabilityDiscovery.metadata) {
      identity.providerMetadata = {
        ...identity.providerMetadata,
        ...params.capabilityDiscovery.metadata,
      };
    }
  }
  identity.lastVerifyResult = {
    result: readiness.ready ? "SUCCESS" : "FAILED",
    verifiedAt: params.nowIso,
    ...(readiness.ready
      ? {}
      : {
          errorCode: "IDENTITY_002",
          detail: readiness.items
            .filter((item) => !item.satisfied)
            .map((item) => item.detail?.trim() || item.label)
            .join("；"),
        }),
  };
  identity.updatedAt = params.nowIso;
  params.store.enterpriseIdentities[identity.identityId] = identity;
  const refreshed = getTenantEnterpriseIdentity(params.store, params.tenantId, params.identityId);
  if (!refreshed) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_NOT_FOUND",
      error: "Identity not found.",
    };
  }
  recordEnterpriseAssetAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "identity.verified",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    resourceType: "identity",
    resourceId: refreshed.identityId,
    metadata: {
      provider: refreshed.provider,
      status: refreshed.status,
      readinessUnsatisfied: readiness.items
        .filter((item) => !item.satisfied)
        .map((item) => item.key),
      ...(params.capabilityDiscovery?.capabilities
        ? { capabilities: params.capabilityDiscovery.capabilities }
        : {}),
      ...(params.capabilityDiscovery?.missing
        ? { capabilityMissing: params.capabilityDiscovery.missing }
        : {}),
    },
  });
  return { ok: true, identity: refreshed, readiness };
}

export function snapshotEnterpriseIdentityConfigReadiness(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  identity: EnterpriseIdentity;
  secret: EnterpriseOperationalIdentityCredentialSecret | null;
}): NonNullable<EnterpriseIdentity["configReadiness"]> {
  if (params.identity.configReadiness?.items?.length) {
    return params.identity.configReadiness;
  }
  const credential = resolveCredentialBinding({
    store: params.store,
    tenantId: params.tenantId,
    credentialBindingId: params.identity.credentialBindingId,
  });
  const readiness = assessOperationalIdentityCredentialReadiness({
    provider: params.identity.provider,
    credential,
    secret: params.secret,
    externalAccountId: params.identity.externalAccountId,
  });
  return {
    items: readiness.items.map((item) => ({
      key: item.key,
      label: item.label,
      satisfied: item.satisfied,
      scope: item.scope,
      ...(item.detail ? { detail: item.detail } : {}),
    })),
  };
}

export function reauthorizeEnterpriseIdentity(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  identityId: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): { ok: true; identity: EnterpriseIdentity } | { ok: false; code: string; error: string } {
  const identity = getTenantEnterpriseIdentity(params.store, params.tenantId, params.identityId);
  if (!identity || identity.revokedAt) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_NOT_FOUND",
      error: "Identity not found.",
    };
  }
  const credential = resolveCredentialBinding({
    store: params.store,
    tenantId: params.tenantId,
    credentialBindingId: identity.credentialBindingId,
  });
  if (!credential) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_CREDENTIAL_NOT_FOUND",
      error: "Linked credential binding is missing.",
    };
  }
  if (credential.status === "revoked") {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_CREDENTIAL_REVOKED",
      error: "Linked credential binding is revoked; register a new identity instead.",
    };
  }
  identity.status = probeOperationalIdentityCredentialStatus({
    credential,
    nowIso: params.nowIso,
  });
  identity.lastVerifiedAt = params.nowIso;
  identity.updatedAt = params.nowIso;
  params.store.enterpriseIdentities[identity.identityId] = identity;
  recordEnterpriseAssetAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "identity.reauthorized",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    resourceType: "identity",
    resourceId: identity.identityId,
    metadata: {
      provider: identity.provider,
      status: identity.status,
    },
  });
  return { ok: true, identity };
}

export function revokeEnterpriseIdentity(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  identityId: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): { ok: true; identity: EnterpriseIdentity } | { ok: false; code: string; error: string } {
  const identity = getTenantEnterpriseIdentity(params.store, params.tenantId, params.identityId);
  if (!identity || identity.revokedAt) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_NOT_FOUND",
      error: "Identity not found.",
    };
  }
  identity.status = "expired";
  identity.revokedAt = params.nowIso;
  identity.updatedAt = params.nowIso;
  params.store.enterpriseIdentities[identity.identityId] = identity;
  for (const policy of Object.values(params.store.identityUsagePolicies)) {
    if (policy.tenantId === params.tenantId && policy.identityId === identity.identityId) {
      policy.enabled = false;
      policy.updatedAt = params.nowIso;
    }
  }
  recordEnterpriseAssetAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "identity.revoked",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    resourceType: "identity",
    resourceId: identity.identityId,
    metadata: {
      provider: identity.provider,
    },
  });
  return { ok: true, identity };
}

export function upsertIdentityUsagePolicy(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  identityId: string;
  policyId?: string;
  seatIds: string[];
  allowedAgentIds: string[];
  allowedActions: string[];
  enabled?: boolean;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): { ok: true; policy: IdentityUsagePolicy } | { ok: false; code: string; error: string } {
  const identity = getTenantEnterpriseIdentity(params.store, params.tenantId, params.identityId);
  if (!identity || identity.revokedAt) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_NOT_FOUND",
      error: "Identity not found.",
    };
  }
  const validation = validateIdentityUsagePolicyInput({
    store: params.store,
    tenantId: params.tenantId,
    identityId: params.identityId,
    provider: identity.provider,
    seatIds: params.seatIds,
    allowedAgentIds: params.allowedAgentIds,
    allowedActions: params.allowedActions,
    discoveredCapabilities: identity.capabilities,
  });
  if (!validation.ok) {
    return validation;
  }
  const existingPolicy =
    params.policyId && params.store.identityUsagePolicies[params.policyId]
      ? params.store.identityUsagePolicies[params.policyId]
      : null;
  if (existingPolicy && existingPolicy.tenantId !== params.tenantId) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_POLICY_FORBIDDEN",
      error: "Policy belongs to another tenant.",
    };
  }
  const nextAllowedActions = [
    ...new Set(params.allowedActions.map((entry) => entry.trim()).filter(Boolean)),
  ];
  const nextSeatIds = [...new Set(params.seatIds.map((entry) => entry.trim()).filter(Boolean))];
  const nextAllowedAgentIds = [
    ...new Set(params.allowedAgentIds.map((entry) => entry.trim()).filter(Boolean)),
  ];
  const nextEnabled = params.enabled ?? existingPolicy?.enabled ?? true;
  const materialChange =
    !existingPolicy ||
    existingPolicy.enabled !== nextEnabled ||
    JSON.stringify([...existingPolicy.allowedActions].toSorted()) !==
      JSON.stringify([...nextAllowedActions].toSorted()) ||
    JSON.stringify([...existingPolicy.seatIds].toSorted()) !==
      JSON.stringify([...nextSeatIds].toSorted()) ||
    JSON.stringify([...existingPolicy.allowedAgentIds].toSorted()) !==
      JSON.stringify([...nextAllowedAgentIds].toSorted());
  const previousVersion = Number.parseInt(existingPolicy?.policyVersion ?? "1", 10);
  const nextPolicyVersion = existingPolicy
    ? materialChange
      ? String(Number.isFinite(previousVersion) && previousVersion > 0 ? previousVersion + 1 : 2)
      : existingPolicy.policyVersion?.trim() || "1"
    : "1";
  const policy: IdentityUsagePolicy = {
    policyId: existingPolicy?.policyId ?? params.policyId ?? randomUUID(),
    tenantId: params.tenantId,
    identityId: params.identityId,
    seatIds: nextSeatIds,
    allowedAgentIds: nextAllowedAgentIds,
    allowedActions: nextAllowedActions,
    enabled: nextEnabled,
    policyVersion: nextPolicyVersion,
    createdAt: existingPolicy?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.identityUsagePolicies[policy.policyId] = policy;
  recordEnterpriseAssetAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: existingPolicy ? "identity.bound" : "identity.bound",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    policyId: policy.policyId,
    resourceType: "identity",
    resourceId: params.identityId,
    metadata: {
      seatIds: policy.seatIds,
      allowedAgentIds: policy.allowedAgentIds,
      allowedActions: policy.allowedActions,
      enabled: policy.enabled,
    },
  });
  return { ok: true, policy };
}

export function createDataSourceIdentityBinding(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  identityId: string;
  dataSourceId: string;
  purpose: DataSourceIdentityBindingPurpose;
  dataSourceStore: EnterpriseDataStore;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): { ok: true; binding: DataSourceIdentityBinding } | { ok: false; code: string; error: string } {
  const identity = getTenantEnterpriseIdentity(params.store, params.tenantId, params.identityId);
  if (!identity || identity.revokedAt) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_NOT_FOUND",
      error: "Identity not found.",
    };
  }
  const dataSourceId = params.dataSourceId.trim();
  if (!dataSourceId) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_DATASOURCE_REQUIRED",
      error: "dataSourceId is required.",
    };
  }
  if (!findDataSource(params.dataSourceStore, params.tenantId, dataSourceId)) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_DATASOURCE_NOT_FOUND",
      error: "dataSourceId must reference an existing tenant data source.",
    };
  }
  const duplicate = Object.values(params.store.dataSourceIdentityBindings).find(
    (binding) =>
      binding.tenantId === params.tenantId &&
      binding.identityId === params.identityId &&
      binding.dataSourceId === dataSourceId &&
      binding.purpose === params.purpose,
  );
  if (duplicate) {
    return { ok: true, binding: duplicate };
  }
  const binding: DataSourceIdentityBinding = {
    bindingId: randomUUID(),
    tenantId: params.tenantId,
    identityId: params.identityId,
    dataSourceId,
    purpose: params.purpose,
    createdAt: params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.dataSourceIdentityBindings[binding.bindingId] = binding;
  recordEnterpriseAssetAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "identity.bound",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    bindingId: binding.bindingId,
    resourceType: "identity",
    resourceId: params.identityId,
    metadata: {
      dataSourceId,
      purpose: params.purpose,
    },
  });
  return { ok: true, binding };
}

export function removeDataSourceIdentityBinding(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  bindingId: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): { ok: true } | { ok: false; code: string; error: string } {
  const binding = params.store.dataSourceIdentityBindings[params.bindingId];
  if (!binding || binding.tenantId !== params.tenantId) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_BINDING_NOT_FOUND",
      error: "Data source identity binding not found.",
    };
  }
  delete params.store.dataSourceIdentityBindings[params.bindingId];
  recordEnterpriseAssetAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "identity.unbound",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId,
    bindingId: params.bindingId,
    resourceType: "identity",
    resourceId: binding.identityId,
    metadata: {
      dataSourceId: binding.dataSourceId,
      purpose: binding.purpose,
    },
  });
  return { ok: true };
}

export function summarizeEnterpriseIdentityCatalog(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  nowIso: string;
}): {
  identities: Array<
    EnterpriseIdentity & {
      providerLabel: string;
      category: "official" | "communication" | "business";
      policyCount: number;
      dataSourceBindingCount: number;
    }
  >;
  providerCounts: Record<string, number>;
} {
  const identities = listTenantEnterpriseIdentities(params.store, params.tenantId).map(
    (identity) => {
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
      const presentation = resolveOperationalIdentityProviderPresentation(identity.provider);
      return {
        ...(refreshed ?? identity),
        providerLabel: presentation.label,
        category: presentation.category,
        policyCount: listTenantIdentityUsagePolicies(
          params.store,
          params.tenantId,
          identity.identityId,
        ).filter((policy) => policy.enabled).length,
        dataSourceBindingCount: listTenantDataSourceIdentityBindings(
          params.store,
          params.tenantId,
          identity.identityId,
        ).length,
      };
    },
  );
  const providerCounts: Record<string, number> = {};
  for (const identity of identities) {
    providerCounts[identity.provider] = (providerCounts[identity.provider] ?? 0) + 1;
  }
  return { identities, providerCounts };
}

export function listEligibleOperationalIdentityCredentialBindings(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
}): Array<{
  credentialBindingId: string;
  connectorId: string;
  ownerType: string;
  ownerId: string;
  status: string;
}> {
  const activeIdentityCredentialIds = new Set(
    Object.values(params.store.enterpriseIdentities)
      .filter(
        (identity) =>
          identity.tenantId === params.tenantId &&
          !identity.revokedAt &&
          identity.credentialBindingId.trim(),
      )
      .map((identity) => identity.credentialBindingId),
  );
  return Object.values(params.store.credentialBindings)
    .filter(
      (binding) =>
        binding.tenantId === params.tenantId &&
        isSupportedOperationalIdentityConnectorId(binding.connectorId) &&
        !activeIdentityCredentialIds.has(binding.credentialBindingId),
    )
    .map((binding) => ({
      credentialBindingId: binding.credentialBindingId,
      connectorId: binding.connectorId,
      ownerType: binding.ownerType,
      ownerId: binding.ownerId,
      status: binding.status,
    }))
    .toSorted((left, right) => left.connectorId.localeCompare(right.connectorId));
}

export { resolveIdentityProviderFromCredential, resolveOperationalIdentityProviderFromConnectorId };

// ── Employee-domain enterprise identity enrollments ───────────────────────────

export function listEmployeeEnterpriseIdentityEnrollments(
  store: EnterpriseSeatAssetsStore,
  params: { tenantId: string; employeeId: string; agentId?: string },
): EmployeeEnterpriseIdentityEnrollment[] {
  return Object.values(store.employeeIdentityEnrollments ?? {}).filter(
    (enrollment) =>
      enrollment.tenantId === params.tenantId &&
      enrollment.employeeId === params.employeeId &&
      (params.agentId ? enrollment.agentId === params.agentId : true),
  );
}

export function listEnterpriseIdentityEnrollmentsForAgent(
  store: EnterpriseSeatAssetsStore,
  params: { agentId: string; employeeId?: string },
): EmployeeEnterpriseIdentityEnrollment[] {
  const agentId = params.agentId.trim();
  const employeeId = params.employeeId?.trim() ?? "";
  if (!agentId) {
    return [];
  }
  return Object.values(store.employeeIdentityEnrollments ?? {}).filter(
    (enrollment) =>
      enrollment.agentId === agentId && (!employeeId || enrollment.employeeId === employeeId),
  );
}

export function findEmployeeEnterpriseIdentityEnrollment(
  store: EnterpriseSeatAssetsStore,
  params: { tenantId: string; employeeId: string; agentId: string; identityId: string },
): EmployeeEnterpriseIdentityEnrollment | null {
  return (
    Object.values(store.employeeIdentityEnrollments ?? {}).find(
      (enrollment) =>
        enrollment.tenantId === params.tenantId &&
        enrollment.employeeId === params.employeeId &&
        enrollment.agentId === params.agentId &&
        enrollment.identityId === params.identityId,
    ) ?? null
  );
}

/** Active grants only — single read path into PDP. */
export function listActiveEmployeeEnterpriseIdentityEnrollments(
  store: EnterpriseSeatAssetsStore,
  params: { tenantId: string; employeeId: string; agentId?: string },
): EmployeeEnterpriseIdentityEnrollment[] {
  return listEmployeeEnterpriseIdentityEnrollments(store, params).filter(
    (enrollment) => (enrollment.status ?? "active") === "active",
  );
}

export function findActiveEmployeeEnterpriseIdentityEnrollment(
  store: EnterpriseSeatAssetsStore,
  params: { tenantId: string; employeeId: string; agentId: string; identityId: string },
): EmployeeEnterpriseIdentityEnrollment | null {
  const enrollment = findEmployeeEnterpriseIdentityEnrollment(store, params);
  if (!enrollment || (enrollment.status ?? "active") !== "active") {
    return null;
  }
  return enrollment;
}

export function resolveOperationalIdentityTenantGrantMode(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
): OperationalIdentityTenantGrantMode {
  const settings = store.operationalIdentityTenantSettings?.[tenantId];
  return settings?.grantMode === "explicit_owner_grant"
    ? "explicit_owner_grant"
    : "seat_inherit_until_curated";
}

export function getOperationalIdentityTenantSettings(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
): OperationalIdentityTenantSettings {
  const existing = store.operationalIdentityTenantSettings?.[tenantId];
  if (existing) {
    return existing;
  }
  return {
    tenantId,
    grantMode: "seat_inherit_until_curated",
    updatedAt: "1970-01-01T00:00:00.000Z",
  };
}

export function setOperationalIdentityTenantGrantMode(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  grantMode: OperationalIdentityTenantGrantMode;
  nowIso: string;
  actorEmployeeId?: string;
}): OperationalIdentityTenantSettings {
  if (!params.store.operationalIdentityTenantSettings) {
    params.store.operationalIdentityTenantSettings = {};
  }
  const settings: OperationalIdentityTenantSettings = {
    tenantId: params.tenantId,
    grantMode: params.grantMode,
    updatedAt: params.nowIso,
    ...(params.actorEmployeeId ? { updatedByEmployeeId: params.actorEmployeeId } : {}),
  };
  params.store.operationalIdentityTenantSettings[params.tenantId] = settings;
  recordEnterpriseAssetAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "identity.grant_mode_updated",
    nowIso: params.nowIso,
    actorEmployeeId: params.actorEmployeeId,
    resourceType: "identity",
    resourceId: params.tenantId,
    metadata: {
      scope: "operational-identity-tenant-grant-mode",
      grantMode: params.grantMode,
    },
  });
  return settings;
}

/**
 * Agents on a seat that currently rely on zero-enrollment seat-inherit (admin delta; not for LLM).
 */
export function previewOperationalIdentityImplicitInheritExit(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
}): Array<{
  seatId: string;
  employeeId: string | null;
  agentId: string;
  identityIdsWithPolicy: string[];
}> {
  const rows: Array<{
    seatId: string;
    employeeId: string | null;
    agentId: string;
    identityIdsWithPolicy: string[];
  }> = [];
  const seats = Object.values(params.store.seats).filter(
    (seat) => seat.tenantId === params.tenantId,
  );
  for (const seat of seats) {
    const binding =
      Object.values(params.store.bindings)
        .filter(
          (entry) =>
            entry.tenantId === params.tenantId &&
            entry.seatId === seat.seatId &&
            entry.bindingStatus === "active",
        )
        .toSorted((left, right) => right.effectiveAt.localeCompare(left.effectiveAt))[0] ?? null;
    const employeeId = binding?.employeeId ?? seat.currentEmployeeId ?? null;
    const agentIds = withEmployeeUniversalStewardAgentIds(
      resolveSeatGrantedAgentAssetIds({
        store: params.store,
        tenantId: params.tenantId,
        seat,
      }),
    );
    const identityIdsWithPolicy = [
      ...new Set(
        Object.values(params.store.identityUsagePolicies)
          .filter(
            (policy) =>
              policy.tenantId === params.tenantId &&
              policy.enabled &&
              policy.seatIds.includes(seat.seatId),
          )
          .map((policy) => policy.identityId),
      ),
    ].toSorted();
    if (identityIdsWithPolicy.length === 0) {
      continue;
    }
    for (const agentId of agentIds) {
      const hasActiveEnrollment =
        employeeId != null &&
        listActiveEmployeeEnterpriseIdentityEnrollments(params.store, {
          tenantId: params.tenantId,
          employeeId,
          agentId,
        }).length > 0;
      if (hasActiveEnrollment) {
        continue;
      }
      rows.push({
        seatId: seat.seatId,
        employeeId,
        agentId,
        identityIdsWithPolicy,
      });
    }
  }
  return rows;
}

/** Write-time / execute-time: agent still belongs to the seat (and thus Owner-manageable set). */
export function isAgentManageableForOperationalIdentity(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
  agentId: string;
}): boolean {
  const seat = params.store.seats[params.seatId];
  if (!seat || seat.tenantId !== params.tenantId) {
    return false;
  }
  const agentId = params.agentId.trim();
  if (!agentId) {
    return false;
  }
  const granted = withEmployeeUniversalStewardAgentIds(
    resolveSeatGrantedAgentAssetIds({
      store: params.store,
      tenantId: params.tenantId,
      seat,
    }),
  );
  return granted.includes(agentId);
}

export function upsertEmployeeEnterpriseIdentityEnrollment(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  employeeId: string;
  agentId: string;
  identityId: string;
  allowedActions: string[];
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
  status?: EmployeeEnterpriseIdentityGrantStatus;
  grantMode?: EmployeeEnterpriseIdentityGrantMode;
  policyVersionAtGrant?: string;
}): EmployeeEnterpriseIdentityEnrollment {
  const existing = findEmployeeEnterpriseIdentityEnrollment(params.store, {
    tenantId: params.tenantId,
    employeeId: params.employeeId,
    agentId: params.agentId,
    identityId: params.identityId,
  });
  const enrollment: EmployeeEnterpriseIdentityEnrollment = {
    enrollmentId: existing?.enrollmentId ?? randomUUID(),
    tenantId: params.tenantId,
    employeeId: params.employeeId,
    agentId: params.agentId,
    identityId: params.identityId,
    allowedActions: [
      ...new Set(params.allowedActions.map((entry) => entry.trim()).filter(Boolean)),
    ],
    status: params.status ?? existing?.status ?? "active",
    grantMode: params.grantMode ?? existing?.grantMode ?? "explicit_owner_grant",
    ...(params.policyVersionAtGrant !== undefined
      ? { policyVersionAtGrant: params.policyVersionAtGrant }
      : existing?.policyVersionAtGrant
        ? { policyVersionAtGrant: existing.policyVersionAtGrant }
        : {}),
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.employeeIdentityEnrollments[enrollment.enrollmentId] = enrollment;
  recordEnterpriseAssetAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "identity.bound",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId ?? params.employeeId,
    resourceType: "identity",
    resourceId: params.identityId,
    metadata: {
      agentId: params.agentId,
      employeeId: params.employeeId,
      allowedActions: enrollment.allowedActions,
      scope: "employee-enrollment",
      status: enrollment.status,
      grantMode: enrollment.grantMode,
      ...(enrollment.policyVersionAtGrant
        ? { policyVersionAtGrant: enrollment.policyVersionAtGrant }
        : {}),
    },
  });
  return enrollment;
}

/**
 * Revoke (soft): set status=revoked rather than hard-delete.
 * PDP / listActive only recognize active grants, so revoked rows stay for audit & OWNER_GRANT_INACTIVE.
 */
export function removeEmployeeEnterpriseIdentityEnrollment(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  employeeId: string;
  agentId: string;
  identityId: string;
  nowIso: string;
  actorEmployeeId?: string;
  auditId?: string;
}): boolean {
  const existing = findEmployeeEnterpriseIdentityEnrollment(params.store, {
    tenantId: params.tenantId,
    employeeId: params.employeeId,
    agentId: params.agentId,
    identityId: params.identityId,
  });
  if (!existing) {
    return false;
  }
  if ((existing.status ?? "active") === "revoked") {
    return true;
  }
  params.store.employeeIdentityEnrollments[existing.enrollmentId] = {
    ...existing,
    status: "revoked",
    updatedAt: params.nowIso,
  };
  recordEnterpriseAssetAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "identity.unbound",
    nowIso: params.nowIso,
    auditId: params.auditId,
    actorEmployeeId: params.actorEmployeeId ?? params.employeeId,
    resourceType: "identity",
    resourceId: params.identityId,
    metadata: {
      agentId: params.agentId,
      employeeId: params.employeeId,
      scope: "employee-enrollment",
      status: "revoked",
      ...(existing.grantMode ? { grantMode: existing.grantMode } : {}),
      ...(existing.policyVersionAtGrant
        ? { policyVersionAtGrant: existing.policyVersionAtGrant }
        : {}),
    },
  });
  return true;
}

/** Recent employee↔robot identity binding/unbinding audit feed for enterprise admins. */
export function listEmployeeIdentityBindingActivity(
  store: EnterpriseSeatAssetsStore,
  tenantId: string,
  limit = 40,
): EnterpriseAssetAuditEvent[] {
  return listTenantAssetAuditEvents(store, tenantId)
    .filter(
      (event) =>
        (event.eventType === "identity.bound" || event.eventType === "identity.unbound") &&
        event.metadata?.scope === "employee-enrollment",
    )
    .slice(0, Math.max(1, limit));
}

// --- CollaborationIdentityDelegation (P2, optional narrowing) ----------------

export function listCollaborationIdentityDelegations(
  store: EnterpriseSeatAssetsStore,
  params: {
    tenantId: string;
    collaborationGroupId?: string;
    ownerEmployeeId?: string;
    agentId?: string;
    identityId?: string;
  },
): CollaborationIdentityDelegation[] {
  const groupId = params.collaborationGroupId?.trim() ?? "";
  const ownerEmployeeId = params.ownerEmployeeId?.trim() ?? "";
  const agentId = params.agentId?.trim() ?? "";
  const identityId = params.identityId?.trim() ?? "";
  return Object.values(store.collaborationIdentityDelegations ?? {}).filter(
    (row) =>
      row.tenantId === params.tenantId &&
      (!groupId || row.collaborationGroupId === groupId) &&
      (!ownerEmployeeId || row.ownerEmployeeId === ownerEmployeeId) &&
      (!agentId || row.agentId === agentId) &&
      (!identityId || row.identityId === identityId),
  );
}

export function findActiveCollaborationIdentityDelegation(
  store: EnterpriseSeatAssetsStore,
  params: {
    tenantId: string;
    collaborationGroupId: string;
    ownerEmployeeId: string;
    agentId: string;
    identityId: string;
  },
): CollaborationIdentityDelegation | null {
  const groupId = params.collaborationGroupId.trim();
  const ownerEmployeeId = params.ownerEmployeeId.trim();
  const agentId = params.agentId.trim();
  const identityId = params.identityId.trim();
  if (!groupId || !ownerEmployeeId || !agentId || !identityId) {
    return null;
  }
  return (
    Object.values(store.collaborationIdentityDelegations ?? {}).find(
      (row) =>
        row.tenantId === params.tenantId &&
        row.collaborationGroupId === groupId &&
        row.ownerEmployeeId === ownerEmployeeId &&
        row.agentId === agentId &&
        row.identityId === identityId &&
        (row.status ?? "active") === "active",
    ) ?? null
  );
}

export function upsertCollaborationIdentityDelegation(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  collaborationGroupId: string;
  ownerEmployeeId: string;
  agentId: string;
  identityId: string;
  allowedActions: string[];
  nowIso: string;
  actorEmployeeId?: string;
  status?: CollaborationIdentityDelegationStatus;
}): CollaborationIdentityDelegation {
  if (!params.store.collaborationIdentityDelegations) {
    params.store.collaborationIdentityDelegations = {};
  }
  const existing =
    findActiveCollaborationIdentityDelegation(params.store, {
      tenantId: params.tenantId,
      collaborationGroupId: params.collaborationGroupId,
      ownerEmployeeId: params.ownerEmployeeId,
      agentId: params.agentId,
      identityId: params.identityId,
    }) ??
    Object.values(params.store.collaborationIdentityDelegations).find(
      (row) =>
        row.tenantId === params.tenantId &&
        row.collaborationGroupId === params.collaborationGroupId.trim() &&
        row.ownerEmployeeId === params.ownerEmployeeId.trim() &&
        row.agentId === params.agentId.trim() &&
        row.identityId === params.identityId.trim(),
    );
  const delegation: CollaborationIdentityDelegation = {
    delegationId: existing?.delegationId ?? randomUUID(),
    tenantId: params.tenantId,
    collaborationGroupId: params.collaborationGroupId.trim(),
    ownerEmployeeId: params.ownerEmployeeId.trim(),
    agentId: params.agentId.trim(),
    identityId: params.identityId.trim(),
    allowedActions: [
      ...new Set(params.allowedActions.map((entry) => entry.trim()).filter(Boolean)),
    ],
    status: params.status ?? existing?.status ?? "active",
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.collaborationIdentityDelegations[delegation.delegationId] = delegation;
  recordEnterpriseAssetAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "identity.bound",
    nowIso: params.nowIso,
    actorEmployeeId: params.actorEmployeeId ?? params.ownerEmployeeId,
    resourceType: "identity",
    resourceId: params.identityId,
    metadata: {
      scope: "collaboration-identity-delegation",
      stage: "owner_delegation",
      collaborationGroupId: delegation.collaborationGroupId,
      agentId: delegation.agentId,
      ownerEmployeeId: delegation.ownerEmployeeId,
      allowedActions: delegation.allowedActions,
      status: delegation.status,
      delegationId: delegation.delegationId,
    },
  });
  return delegation;
}

export function revokeCollaborationIdentityDelegation(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  collaborationGroupId: string;
  ownerEmployeeId: string;
  agentId: string;
  identityId: string;
  nowIso: string;
  actorEmployeeId?: string;
}): boolean {
  const existing =
    Object.values(params.store.collaborationIdentityDelegations ?? {}).find(
      (row) =>
        row.tenantId === params.tenantId &&
        row.collaborationGroupId === params.collaborationGroupId.trim() &&
        row.ownerEmployeeId === params.ownerEmployeeId.trim() &&
        row.agentId === params.agentId.trim() &&
        row.identityId === params.identityId.trim(),
    ) ?? null;
  if (!existing) {
    return false;
  }
  if ((existing.status ?? "active") === "revoked") {
    return true;
  }
  if (!params.store.collaborationIdentityDelegations) {
    params.store.collaborationIdentityDelegations = {};
  }
  params.store.collaborationIdentityDelegations[existing.delegationId] = {
    ...existing,
    status: "revoked",
    updatedAt: params.nowIso,
  };
  recordEnterpriseAssetAuditEvent({
    store: params.store,
    tenantId: params.tenantId,
    eventType: "identity.unbound",
    nowIso: params.nowIso,
    actorEmployeeId: params.actorEmployeeId ?? params.ownerEmployeeId,
    resourceType: "identity",
    resourceId: params.identityId,
    metadata: {
      scope: "collaboration-identity-delegation",
      stage: "owner_delegation",
      collaborationGroupId: existing.collaborationGroupId,
      agentId: existing.agentId,
      ownerEmployeeId: existing.ownerEmployeeId,
      status: "revoked",
      delegationId: existing.delegationId,
    },
  });
  return true;
}
