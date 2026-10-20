import type { EnterpriseIdentity } from "../enterprise-operational-identity-types.js";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { tryGetOperationalIdentityProviderAdapter } from "./adapters.js";
import {
  resolveOperationalIdentityConnectionStatus,
  resolveOperationalIdentityHealthStatus,
  resolveOperationalIdentityUiStatusLabel,
} from "./identity-lifecycle.js";
import { enrichOperationalIdentityCapabilities } from "./provider-capability-registry.js";

export type OperationalIdentityApiView = EnterpriseIdentity & {
  connectionStatus: ReturnType<typeof resolveOperationalIdentityConnectionStatus>;
  healthStatus: ReturnType<typeof resolveOperationalIdentityHealthStatus>;
  connectionStatusLabel: string;
  capabilityDetails: ReturnType<typeof enrichOperationalIdentityCapabilities>;
  agentReady: boolean;
};

export function enrichOperationalIdentityApiView(params: {
  identity: EnterpriseIdentity;
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  nowIso: string;
}): OperationalIdentityApiView {
  const hasEnabledPolicy = Object.values(params.store.identityUsagePolicies).some(
    (policy) =>
      policy.tenantId === params.tenantId &&
      policy.identityId === params.identity.identityId &&
      policy.enabled &&
      policy.allowedActions.length > 0,
  );
  const connectionStatus = resolveOperationalIdentityConnectionStatus({
    identity: params.identity,
    hasEnabledPolicy,
    nowIso: params.nowIso,
  });
  const healthStatus = resolveOperationalIdentityHealthStatus({
    identity: params.identity,
    connectionStatus,
  });
  const capabilityDetails = (() => {
    const adapter = tryGetOperationalIdentityProviderAdapter(params.identity.provider);
    if (!adapter) {
      return (params.identity.capabilities ?? []).map((action) => ({
        action,
        label: action,
        risk: "medium" as const,
        enabled: true,
      }));
    }
    return enrichOperationalIdentityCapabilities({
      provider: adapter.provider,
      granted: params.identity.capabilities ?? [],
      missing: params.identity.capabilityMissing ?? [],
    });
  })();
  const agentReady =
    connectionStatus === "active" &&
    healthStatus !== "failed" &&
    (params.identity.capabilities?.length ?? 0) > 0 &&
    hasEnabledPolicy;

  return {
    ...params.identity,
    connectionStatus,
    healthStatus,
    connectionStatusLabel: resolveOperationalIdentityUiStatusLabel(connectionStatus),
    capabilityDetails,
    agentReady,
  };
}
