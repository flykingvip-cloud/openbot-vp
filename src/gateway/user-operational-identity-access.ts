import { randomUUID } from "node:crypto";
import {
  decideEnterpriseImEmployeeProxy,
  type EnterpriseImDecisionInput,
} from "./enterprise-im-employee-decision.js";
import {
  defaultGrantModeForAgentScope,
  isAgentScopeAllowedByDefault,
} from "./user-operational-identity-agent-scope.js";
import type { EmployeeOperationalAuthorization } from "./user-operational-identity-enterprise-authorization.js";
import { formatUserOperationalIdentityDenialGuidance } from "./user-operational-identity-guidance.js";
import {
  getUserOperationalIdentityProviderAdapter,
  isUserOperationalIdentityPolicyAction,
  parseUserOperationalIdentityProvider,
} from "./user-operational-identity-providers.js";
import {
  listUserOperationalIdentityGrants,
  recordUserOperationalIdentityUsageEvent,
  assertUserOperationalIdentityCredentialHandleActive,
} from "./user-operational-identity-store.js";
import { buildTrustedUserOperationalIdentityAgentScopeIds } from "./user-operational-identity-trusted-agent-scope.js";
import type {
  UserOperationalIdentity,
  UserOperationalIdentityGrant,
  UserOperationalIdentityStore,
} from "./user-operational-identity-types.js";

export type ResolveUserOperationalIdentityInput = {
  store: UserOperationalIdentityStore;
  provider: string;
  action: string;
  currentUserId: string;
  currentUserEmail?: string | null;
  currentAgentId: string;
  currentSeatId?: string;
  tenantId?: string;
  sessionKey?: string | null;
  nowIso: string;
  audit?: boolean;
  /**
   * Enterprise authorization decision resolved by the async enforcement layer
   * (Task 3.2). When present, its `tenantId`/`seatId` are AUTHORITATIVE and used
   * for audit attribution in place of the request-supplied values; a `deny`
   * decision hard-denies before owner/grant evaluation.
   */
  enterpriseAuthorization?: EmployeeOperationalAuthorization;
  /** Feishu employee proxy only. Other providers ignore this. */
  enterpriseImIdentityId?: string;
  enterpriseImGate?: EnterpriseImDecisionInput["gate"];
  enterpriseImSeat?: EnterpriseImDecisionInput["seat"];
  /** @deprecated Ignored for authorization; scope is derived server-side. */
  ownedAgentIds?: string[];
  /** @deprecated Ignored for authorization; scope is derived server-side. */
  sharedAgentIds?: string[];
  /** @deprecated Ignored for authorization; scope is derived server-side. */
  groupAgentIds?: string[];
};

export type ResolveUserOperationalIdentityResult =
  | {
      allowed: true;
      identity: UserOperationalIdentity;
      grant: UserOperationalIdentityGrant;
    }
  | {
      allowed: false;
      code: string;
      message: string;
      identity?: UserOperationalIdentity;
      needsBinding?: boolean;
      needsGrantConfirmation?: boolean;
    };

function findActiveIdentityForProvider(
  store: UserOperationalIdentityStore,
  ownerId: string,
  provider: string,
): UserOperationalIdentity | null {
  return (
    Object.values(store.identities).find(
      (identity) =>
        identity.ownerId === ownerId &&
        identity.provider === provider &&
        !identity.revokedAt &&
        identity.status !== "revoked",
    ) ?? null
  );
}

function findMatchingGrant(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  identityId: string;
  agentId: string;
  action: string;
}): UserOperationalIdentityGrant | null {
  return (
    listUserOperationalIdentityGrants(params.store, params.ownerId, params.identityId).find(
      (grant) =>
        grant.agentId === params.agentId &&
        grant.status === "active" &&
        grant.allowedActions.includes(params.action),
    ) ?? null
  );
}

export function resolveUserOperationalIdentity(
  params: ResolveUserOperationalIdentityInput,
): ResolveUserOperationalIdentityResult {
  const provider = parseUserOperationalIdentityProvider(params.provider);
  const action = params.action.trim();
  const currentUserId = params.currentUserId.trim();
  const currentAgentId = params.currentAgentId.trim();
  if (!provider || !action || !currentUserId || !currentAgentId) {
    return {
      allowed: false,
      code: "USER_IDENTITY_CONTEXT_INVALID",
      message: "provider, action, currentUserId, and currentAgentId are required.",
    };
  }
  if (provider === "feishu-personal") {
    const grantCount = Object.keys(params.store.grants).length;
    const decision = decideEnterpriseImEmployeeProxy({
      store: params.store,
      ownerId: currentUserId,
      agentId: currentAgentId,
      action,
      identityId: params.enterpriseImIdentityId,
      gate: params.enterpriseImGate ?? {
        childExecutionBlocked: true,
        employeeUiHint: "enterprise_not_open",
      },
      seat: params.enterpriseImSeat ?? { kind: "missing", policyPresent: false },
      nowIso: params.nowIso,
    });
    if (Object.keys(params.store.grants).length !== grantCount) {
      throw new Error("enterprise IM resolve must not write a grant");
    }
    if (decision.outcome === "deny") {
      return { allowed: false, code: decision.code, message: decision.message };
    }
    const identity = params.store.identities[decision.identityId];
    const grant = Object.values(params.store.grants).find(
      (item) =>
        item.identityId === decision.identityId &&
        item.agentId === decision.agentId &&
        item.grantVersion === decision.grantVersion &&
        item.status === "active",
    );
    if (!identity || !grant) {
      return {
        allowed: false,
        code: "DELEGATION_MISSING",
        message: "没有员工确认的机器人授权。",
      };
    }
    return { allowed: true, identity, grant };
  }
  if (!isUserOperationalIdentityPolicyAction(provider, action)) {
    return {
      allowed: false,
      code: "USER_IDENTITY_ACTION_UNSUPPORTED",
      message: `Action ${action} is not allowed for provider ${provider}.`,
    };
  }
  // Task 3.2/3.3: prefer authoritative tenant/seat resolved by the enterprise
  // authorization gate over request-supplied values (never trust raw params).
  const authoritativeTenantId = params.enterpriseAuthorization?.tenantId ?? params.tenantId;
  const authoritativeSeatId = params.enterpriseAuthorization?.seatId ?? params.currentSeatId;
  if (params.enterpriseAuthorization?.decision === "deny") {
    const denialCode =
      params.enterpriseAuthorization.denialCode ?? "USER_IDENTITY_ENTERPRISE_NOT_AUTHORIZED";
    if (params.audit !== false) {
      recordUserOperationalIdentityUsageEvent({
        store: params.store,
        ownerId: currentUserId,
        identityId: "enterprise_denied",
        provider,
        agentId: currentAgentId,
        action,
        result: "denied",
        denialCode,
        tenantId: authoritativeTenantId,
        seatId: authoritativeSeatId,
        sessionKey: params.sessionKey,
        nowIso: params.nowIso,
      });
    }
    return {
      allowed: false,
      code: denialCode,
      message:
        params.enterpriseAuthorization.reason ??
        "Enterprise authorization denied operational identity use.",
    };
  }
  const trustedScope = buildTrustedUserOperationalIdentityAgentScopeIds({
    currentUserId,
    currentUserEmail: params.currentUserEmail,
    agentId: currentAgentId,
    sessionKey: params.sessionKey,
  });
  const classification = {
    agentId: currentAgentId,
    agentScope: trustedScope.agentScope,
    ownerUserId: trustedScope.agentScope === "owned" ? currentUserId : null,
  };
  const identity = findActiveIdentityForProvider(params.store, currentUserId, provider);
  if (!identity) {
    if (params.audit !== false) {
      recordUserOperationalIdentityUsageEvent({
        store: params.store,
        ownerId: currentUserId,
        identityId: "missing",
        provider,
        agentId: currentAgentId,
        action,
        result: "denied",
        denialCode: "USER_IDENTITY_NOT_BOUND",
        tenantId: authoritativeTenantId,
        seatId: authoritativeSeatId,
        sessionKey: params.sessionKey,
        nowIso: params.nowIso,
      });
    }
    return {
      allowed: false,
      code: "USER_IDENTITY_NOT_BOUND",
      message: formatUserOperationalIdentityDenialGuidance({
        provider,
        code: "USER_IDENTITY_NOT_BOUND",
        needsBinding: true,
      }),
      needsBinding: true,
    };
  }
  if (identity.status === "reauth_required") {
    if (params.audit !== false) {
      recordUserOperationalIdentityUsageEvent({
        store: params.store,
        ownerId: currentUserId,
        identityId: identity.identityId,
        provider: identity.provider,
        agentId: currentAgentId,
        action,
        result: "reauth_required",
        denialCode: "USER_IDENTITY_REAUTH_REQUIRED",
        tenantId: authoritativeTenantId,
        seatId: authoritativeSeatId,
        sessionKey: params.sessionKey,
        nowIso: params.nowIso,
      });
    }
    return {
      allowed: false,
      code: "USER_IDENTITY_REAUTH_REQUIRED",
      message:
        getUserOperationalIdentityProviderAdapter(identity.provider)?.reauthHint ??
        "Operational identity requires reauthorization.",
      identity,
      needsBinding: true,
    };
  }
  if (identity.status !== "active") {
    if (params.audit !== false) {
      recordUserOperationalIdentityUsageEvent({
        store: params.store,
        ownerId: currentUserId,
        identityId: identity.identityId,
        provider: identity.provider,
        agentId: currentAgentId,
        action,
        result: "denied",
        denialCode: "USER_IDENTITY_INACTIVE",
        tenantId: authoritativeTenantId,
        seatId: authoritativeSeatId,
        sessionKey: params.sessionKey,
        nowIso: params.nowIso,
      });
    }
    return {
      allowed: false,
      code: "USER_IDENTITY_INACTIVE",
      message: "Operational identity is not active.",
      identity,
    };
  }

  const credential = assertUserOperationalIdentityCredentialHandleActive({
    store: params.store,
    ownerId: currentUserId,
    identity,
  });
  if (!credential.ok) {
    if (params.audit !== false) {
      recordUserOperationalIdentityUsageEvent({
        store: params.store,
        ownerId: currentUserId,
        identityId: identity.identityId,
        provider: identity.provider,
        agentId: currentAgentId,
        action,
        result: "reauth_required",
        denialCode: credential.code,
        tenantId: authoritativeTenantId,
        seatId: authoritativeSeatId,
        sessionKey: params.sessionKey,
        nowIso: params.nowIso,
      });
    }
    return {
      allowed: false,
      code: credential.code,
      message: credential.error,
      identity,
      needsBinding: true,
    };
  }

  let grant = findMatchingGrant({
    store: params.store,
    ownerId: currentUserId,
    identityId: identity.identityId,
    agentId: currentAgentId,
    action,
  });

  if (!grant && isAgentScopeAllowedByDefault(classification.agentScope)) {
    const autoGrantMode = defaultGrantModeForAgentScope(classification.agentScope);
    grant = {
      grantId: randomUUID(),
      identityId: identity.identityId,
      ownerId: currentUserId,
      tenantId: authoritativeTenantId?.trim() || undefined,
      seatId: authoritativeSeatId?.trim() || undefined,
      agentId: currentAgentId,
      agentScope: classification.agentScope,
      allowedActions: [action],
      grantMode: autoGrantMode,
      status: "active",
      createdAt: params.nowIso,
      updatedAt: params.nowIso,
      confirmedAt: params.nowIso,
    };
    params.store.grants[grant.grantId] = grant;
  }

  if (!grant) {
    const needsGrantConfirmation = classification.agentScope !== "owned";
    if (params.audit !== false) {
      recordUserOperationalIdentityUsageEvent({
        store: params.store,
        ownerId: currentUserId,
        identityId: identity.identityId,
        provider: identity.provider,
        agentId: currentAgentId,
        action,
        result: "denied",
        denialCode: needsGrantConfirmation
          ? "USER_IDENTITY_GRANT_CONFIRMATION_REQUIRED"
          : "USER_IDENTITY_GRANT_MISSING",
        tenantId: authoritativeTenantId,
        seatId: authoritativeSeatId,
        sessionKey: params.sessionKey,
        nowIso: params.nowIso,
      });
    }
    return {
      allowed: false,
      code: needsGrantConfirmation
        ? "USER_IDENTITY_GRANT_CONFIRMATION_REQUIRED"
        : "USER_IDENTITY_GRANT_MISSING",
      message: formatUserOperationalIdentityDenialGuidance({
        provider: identity.provider,
        code: needsGrantConfirmation
          ? "USER_IDENTITY_GRANT_CONFIRMATION_REQUIRED"
          : "USER_IDENTITY_GRANT_MISSING",
        needsGrantConfirmation,
        message: needsGrantConfirmation
          ? "Shared/group agents require explicit grant confirmation before using this identity."
          : "No grant allows this agent to use the identity action.",
      }),
      identity,
      needsGrantConfirmation,
    };
  }

  if (params.audit !== false) {
    recordUserOperationalIdentityUsageEvent({
      store: params.store,
      ownerId: currentUserId,
      identityId: identity.identityId,
      provider: identity.provider,
      agentId: currentAgentId,
      action,
      result: "allowed",
      tenantId: authoritativeTenantId,
      seatId: authoritativeSeatId,
      sessionKey: params.sessionKey,
      nowIso: params.nowIso,
    });
  }
  return { allowed: true, identity, grant };
}

export function resolveOperationalIdentity(params: ResolveUserOperationalIdentityInput) {
  return resolveUserOperationalIdentity(params);
}

export function getUserOperationalIdentityAccessSummary(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  agentId: string;
  currentUserEmail?: string | null;
  sessionKey?: string | null;
}) {
  const trustedScope = buildTrustedUserOperationalIdentityAgentScopeIds({
    currentUserId: params.ownerId,
    currentUserEmail: params.currentUserEmail,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
  });
  const grants = listUserOperationalIdentityGrants(params.store, params.ownerId).filter(
    (grant) => grant.agentId === params.agentId && grant.status === "active",
  );
  return {
    agentId: params.agentId,
    agentScope: trustedScope.agentScope,
    grants,
  };
}

export function listUserOperationalIdentityAccessForAgent(params: {
  store: UserOperationalIdentityStore;
  ownerId: string;
  agentId: string;
}) {
  const identities = Object.values(params.store.identities).filter(
    (identity) => identity.ownerId === params.ownerId && !identity.revokedAt,
  );
  return identities.map((identity) => {
    const grants = listUserOperationalIdentityGrants(
      params.store,
      params.ownerId,
      identity.identityId,
    ).filter((entry) => entry.agentId === params.agentId && entry.status === "active");
    const adapter = getUserOperationalIdentityProviderAdapter(identity.provider);
    return {
      identityId: identity.identityId,
      displayName: identity.displayName,
      provider: identity.provider,
      providerLabel: adapter?.label ?? identity.provider,
      status: identity.status,
      allowedActions: [...new Set(grants.flatMap((entry) => entry.allowedActions))],
      grantIds: grants.map((entry) => entry.grantId),
      hasGrant: grants.length > 0,
    };
  });
}
