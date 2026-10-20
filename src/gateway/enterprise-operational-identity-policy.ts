import {
  isOperationalIdentityPolicyAction,
  resolveOperationalIdentityProviderPresentation,
  tryGetOperationalIdentityProviderAdapter,
} from "./enterprise-operational-identity-providers.js";
import type {
  EnterpriseIdentity,
  IdentityUsagePolicy,
} from "./enterprise-operational-identity-types.js";
import type { EnterpriseSeatAssetsStore } from "./enterprise-seat-assets-store.js";

export type IdentityUsagePolicyValidationResult =
  | { ok: true }
  | { ok: false; code: string; error: string };

export function validateIdentityUsagePolicyInput(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  identityId: string;
  provider: EnterpriseIdentity["provider"];
  seatIds: string[];
  allowedAgentIds: string[];
  allowedActions: string[];
  discoveredCapabilities?: string[];
}): IdentityUsagePolicyValidationResult {
  if (params.seatIds.length === 0) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_SEAT_REQUIRED",
      error: "At least one seatId is required for identity usage policy.",
    };
  }
  for (const seatId of params.seatIds) {
    const seat = params.store.seats[seatId];
    if (!seat || seat.tenantId !== params.tenantId) {
      return {
        ok: false,
        code: "ENTERPRISE_IDENTITY_SEAT_NOT_FOUND",
        error: `Seat not found: ${seatId}`,
      };
    }
  }
  if (params.allowedActions.length === 0) {
    return {
      ok: false,
      code: "ENTERPRISE_IDENTITY_ACTIONS_REQUIRED",
      error: "allowedActions must be an explicit non-empty whitelist.",
    };
  }
  for (const action of params.allowedActions) {
    if (!isOperationalIdentityPolicyAction(params.provider, action)) {
      const adapter = tryGetOperationalIdentityProviderAdapter(params.provider);
      const isSyncOnly = adapter?.actions.some(
        (entry) => entry.action === action && entry.kind === "data_sync",
      );
      return {
        ok: false,
        code: isSyncOnly
          ? "ENTERPRISE_IDENTITY_ACTION_SYNC_ONLY"
          : "ENTERPRISE_IDENTITY_ACTION_UNSUPPORTED",
        error: isSyncOnly
          ? `Action ${action} is data-sync only; bind via DataSourceIdentityBinding instead of usage policy.`
          : `Action not allowed for provider ${params.provider}: ${action}`,
      };
    }
  }
  if (params.discoveredCapabilities && params.discoveredCapabilities.length > 0) {
    for (const action of params.allowedActions) {
      if (!params.discoveredCapabilities.includes(action)) {
        return {
          ok: false,
          code: "ENTERPRISE_IDENTITY_CAPABILITY_NOT_DISCOVERED",
          error: `Action ${action} is not among verified capabilities for this identity. Run verify first or adjust allowedActions.`,
        };
      }
    }
  }
  for (const agentId of params.allowedAgentIds) {
    const normalizedAgentId = agentId.trim();
    if (!normalizedAgentId) {
      continue;
    }
    const allowedBySeat = params.seatIds.some((seatId) => {
      const seat = params.store.seats[seatId];
      return seat?.defaultAgentAssetIds.includes(normalizedAgentId) ?? false;
    });
    if (!allowedBySeat) {
      return {
        ok: false,
        code: "ENTERPRISE_IDENTITY_AGENT_NOT_IN_SEAT",
        error: `Agent ${normalizedAgentId} is not configured on any allowed seat.`,
      };
    }
  }
  return { ok: true };
}

export function resolveIdentityUsagePolicyForSeatAgent(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  identityId: string;
  seatId: string;
  agentId: string;
  action: string;
}): IdentityUsagePolicy | null {
  const policies = Object.values(params.store.identityUsagePolicies).filter(
    (policy) =>
      policy.tenantId === params.tenantId &&
      policy.identityId === params.identityId &&
      policy.enabled,
  );
  for (const policy of policies) {
    if (!policy.seatIds.includes(params.seatId)) {
      continue;
    }
    if (!policy.allowedActions.includes(params.action)) {
      continue;
    }
    // Seat-level authorization only: allowedAgentIds is legacy metadata and no longer
    // gates runtime access; employees bind identities to their own robots via enrollment.
    return policy;
  }
  return null;
}

export function summarizeIdentityUsagePolicy(params: {
  policy: IdentityUsagePolicy;
  provider: EnterpriseIdentity["provider"];
}): {
  policyId: string;
  seatCount: number;
  agentCount: number;
  actionCount: number;
  providerLabel: string;
} {
  const providerLabel = resolveOperationalIdentityProviderPresentation(params.provider).label;
  return {
    policyId: params.policy.policyId,
    seatCount: params.policy.seatIds.length,
    agentCount: params.policy.allowedAgentIds.length,
    actionCount: params.policy.allowedActions.length,
    providerLabel,
  };
}
