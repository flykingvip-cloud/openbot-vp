import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { listDataAccessPolicies, resolveCompiledActionRefs } from "./data-access-policy-store.js";
import { listDataCapabilities } from "./data-capability-store.js";
import { findDataSource, listDataSources } from "./data-source-store.js";
import type {
  ConnectorActionRef,
  DataAccessPolicy,
  DataAccessPolicyTargetKind,
  DataCapability,
  DataSource,
  EnterpriseDataStore,
  EnterpriseKnowledgeProjectionSpec,
  SeatActionGrant,
} from "./types.js";

export type AccessGovernanceDimension = "source" | "seat" | "department" | "role";

export type AccessGovernancePolicyView = {
  policyId: string;
  displayName: string;
  targetKind: DataAccessPolicyTargetKind;
  targetId: string;
  sourceId?: string;
  enabled: boolean;
  runtimeActionRefs: ConnectorActionRef[];
  compiledGrantIds: string[];
  activeGrantCount: number;
  compilationSupported: boolean;
};

export type AccessGovernanceMatrixEntry = {
  dimension: AccessGovernanceDimension;
  targetId: string;
  source?: DataSource;
  policies: AccessGovernancePolicyView[];
};

export type AccessGovernanceOverview = {
  dataSourceCount: number;
  connectedSourceCount: number;
  accessPolicyCount: number;
  enabledPolicyCount: number;
  seatPolicyCount: number;
  unsupportedTargetPolicyCount: number;
  activeCompiledGrantCount: number;
};

export type DataSourceGovernanceView = {
  source: DataSource;
  capabilities: DataCapability[];
  projectionSpecs: EnterpriseKnowledgeProjectionSpec[];
  accessPolicies: DataAccessPolicy[];
  boundOperationalIdentities: Array<{
    bindingId: string;
    identityId: string;
    displayName: string;
    provider: string;
    providerLabel: string;
    status: string;
    purpose: string;
  }>;
  supplyHealth: {
    status: DataSource["status"];
    capabilityCount: number;
    projectionCount: number;
    enabledPolicyCount: number;
    activeCompiledGrantCount: number;
  };
};

function countActiveCompiledGrants(store: EnterpriseDataStore, policy: DataAccessPolicy): number {
  if (!policy.enabled) {
    return 0;
  }
  return policy.compiledGrantIds.filter((grantId) => {
    const grant = store.seatActionGrants[grantId];
    return grant != null && !grant.revokedAt;
  }).length;
}

function toPolicyView(
  store: EnterpriseDataStore,
  policy: DataAccessPolicy,
): AccessGovernancePolicyView {
  return {
    policyId: policy.policyId,
    displayName: policy.displayName,
    targetKind: policy.targetKind,
    targetId: policy.targetId,
    sourceId: policy.sourceId,
    enabled: policy.enabled,
    runtimeActionRefs: policy.actionRefs.map((ref) => ({ ...ref })),
    compiledGrantIds: [...policy.compiledGrantIds],
    activeGrantCount: countActiveCompiledGrants(store, policy),
    compilationSupported: policy.targetKind === "seat",
  };
}

export function resolveAccessGovernanceOverview(params: {
  store: EnterpriseDataStore;
  tenantId: string;
}): AccessGovernanceOverview {
  const sources = listDataSources({ store: params.store, tenantId: params.tenantId });
  const policies = listDataAccessPolicies({ store: params.store, tenantId: params.tenantId });
  const enabledPolicies = policies.filter((policy) => policy.enabled);
  const activeCompiledGrantCount = enabledPolicies.reduce(
    (count, policy) => count + countActiveCompiledGrants(params.store, policy),
    0,
  );
  return {
    dataSourceCount: sources.length,
    connectedSourceCount: sources.filter((source) => source.status === "connected").length,
    accessPolicyCount: policies.length,
    enabledPolicyCount: enabledPolicies.length,
    seatPolicyCount: policies.filter((policy) => policy.targetKind === "seat").length,
    unsupportedTargetPolicyCount: policies.filter((policy) => policy.targetKind !== "seat").length,
    activeCompiledGrantCount,
  };
}

export function listAccessGovernanceMatrix(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  dimension: AccessGovernanceDimension;
  targetId?: string;
}): AccessGovernanceMatrixEntry[] {
  const policies = listDataAccessPolicies({ store: params.store, tenantId: params.tenantId });
  const entries = new Map<string, AccessGovernanceMatrixEntry>();

  if (params.dimension === "source") {
    const sources = listDataSources({ store: params.store, tenantId: params.tenantId });
    for (const source of sources) {
      if (params.targetId && source.sourceId !== params.targetId) {
        continue;
      }
      entries.set(source.sourceId, {
        dimension: "source",
        targetId: source.sourceId,
        source,
        policies: [],
      });
    }
    for (const policy of policies) {
      if (!policy.sourceId) {
        continue;
      }
      if (params.targetId && policy.sourceId !== params.targetId) {
        continue;
      }
      const entry = entries.get(policy.sourceId);
      if (!entry) {
        continue;
      }
      entry.policies.push(toPolicyView(params.store, policy));
    }
    return [...entries.values()].toSorted((left, right) =>
      (left.source?.sourceKey ?? left.targetId).localeCompare(
        right.source?.sourceKey ?? right.targetId,
      ),
    );
  }

  const targetKind: DataAccessPolicyTargetKind =
    params.dimension === "seat"
      ? "seat"
      : params.dimension === "department"
        ? "department"
        : "role";

  for (const policy of policies) {
    if (policy.targetKind !== targetKind) {
      continue;
    }
    if (params.targetId && policy.targetId !== params.targetId) {
      continue;
    }
    const existing = entries.get(policy.targetId);
    if (existing) {
      existing.policies.push(toPolicyView(params.store, policy));
      continue;
    }
    entries.set(policy.targetId, {
      dimension: params.dimension,
      targetId: policy.targetId,
      policies: [toPolicyView(params.store, policy)],
    });
  }
  return [...entries.values()].toSorted((left, right) =>
    left.targetId.localeCompare(right.targetId),
  );
}

export function resolveAccessGovernanceTarget(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  targetKind: DataAccessPolicyTargetKind;
  targetId: string;
}): {
  targetKind: DataAccessPolicyTargetKind;
  targetId: string;
  policies: AccessGovernancePolicyView[];
  runtimeActionRefs: ConnectorActionRef[];
  compiledGrants: SeatActionGrant[];
} {
  const policies = listDataAccessPolicies({
    store: params.store,
    tenantId: params.tenantId,
    targetKind: params.targetKind,
    targetId: params.targetId,
  });
  const policyViews = policies.map((policy) => toPolicyView(params.store, policy));
  const runtimeActionRefs = policies.flatMap((policy) =>
    resolveCompiledActionRefs(params.store, params.tenantId, policy.policyId),
  );
  const compiledGrants = policies.flatMap((policy) =>
    policy.compiledGrantIds
      .map((grantId) => params.store.seatActionGrants[grantId])
      .filter(
        (grant): grant is SeatActionGrant => grant != null && grant.tenantId === params.tenantId,
      ),
  );
  return {
    targetKind: params.targetKind,
    targetId: params.targetId,
    policies: policyViews,
    runtimeActionRefs,
    compiledGrants,
  };
}

export function resolveDataSourceGovernanceView(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId: string;
}): DataSourceGovernanceView {
  const source = findDataSource(params.store, params.tenantId, params.sourceId);
  if (!source) {
    throw new EnterpriseDataStoreError("DATA_SOURCE_NOT_FOUND", "DataSource not found.");
  }
  const capabilities = listDataCapabilities({
    store: params.store,
    tenantId: params.tenantId,
    sourceId: source.sourceId,
  });
  const linkedCapabilityIds = new Set(capabilities.map((capability) => capability.capabilityId));
  const projectionSpecs = Object.values(params.store.enterpriseKnowledgeProjectionSpecs).filter(
    (spec) => {
      if (spec.tenantId !== params.tenantId) {
        return false;
      }
      return spec.capabilityId != null && linkedCapabilityIds.has(spec.capabilityId);
    },
  );
  const accessPolicies = listDataAccessPolicies({
    store: params.store,
    tenantId: params.tenantId,
    sourceId: source.sourceId,
  });
  const activeCompiledGrantCount = accessPolicies.reduce(
    (count, policy) => count + countActiveCompiledGrants(params.store, policy),
    0,
  );
  return {
    source,
    capabilities,
    projectionSpecs,
    accessPolicies,
    boundOperationalIdentities: [],
    supplyHealth: {
      status: source.status,
      capabilityCount: capabilities.length,
      projectionCount: projectionSpecs.length,
      enabledPolicyCount: accessPolicies.filter((policy) => policy.enabled).length,
      activeCompiledGrantCount,
    },
  };
}
