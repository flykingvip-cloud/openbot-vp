import { EnterpriseDataStoreError, findConnectorAction } from "./connector-action-store.js";
import { listDataAccessPolicies } from "./data-access-policy-store.js";
import { findDataCapability, listDataCapabilities } from "./data-capability-store.js";
import { findDataSource } from "./data-source-store.js";
import {
  buildConnectorActionRefKey,
  type ConnectorAction,
  type ConnectorActionRef,
  type DataAccessPolicyTargetKind,
  type DataCapability,
  type DataSource,
  type EnterpriseDataStore,
  type EnterpriseKnowledgeProjectionSpec,
  type SeatActionGrant,
} from "./types.js";

export type CapabilitySourceMapping = {
  sourceId: string;
  source: DataSource;
};

export type CapabilityActionMapping = {
  ref: ConnectorActionRef;
  action: ConnectorAction | null;
  handlerRegistered: boolean;
};

export type CapabilityAccessScopeEntry = {
  policyId: string;
  displayName: string;
  targetKind: DataAccessPolicyTargetKind;
  targetId: string;
  enabled: boolean;
  matchingActionRefs: ConnectorActionRef[];
};

export type CapabilityGovernanceView = {
  capability: DataCapability;
  sourceMappings: CapabilitySourceMapping[];
  actionMappings: CapabilityActionMapping[];
  projectionSpecs: EnterpriseKnowledgeProjectionSpec[];
  accessScope: {
    policies: CapabilityAccessScopeEntry[];
    activeGrants: SeatActionGrant[];
  };
  supplyHealth: {
    enabled: boolean;
    projectionCount: number;
    bindingCount: number;
    activeGrantCount: number;
    enabledPolicyCount: number;
  };
};

export type CapabilityOverview = {
  capabilityCount: number;
  enabledCapabilityCount: number;
  sourceLinkedCapabilityCount: number;
  projectionLinkedCapabilityCount: number;
};

function capabilityActionKeys(capability: DataCapability): Set<string> {
  return new Set(capability.actionRefs.map((ref) => buildConnectorActionRefKey(ref)));
}

export function resolveCapabilitySourceMapper(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  capabilityId: string;
}): CapabilitySourceMapping[] {
  const capability = findDataCapability(params.store, params.tenantId, params.capabilityId);
  if (!capability) {
    throw new EnterpriseDataStoreError("DATA_CAPABILITY_NOT_FOUND", "DataCapability not found.");
  }
  return capability.sourceIds
    .map((sourceId) => {
      const source = findDataSource(params.store, params.tenantId, sourceId);
      if (!source) {
        return null;
      }
      return { sourceId, source };
    })
    .filter((entry): entry is CapabilitySourceMapping => entry != null);
}

export function resolveCapabilityActionMapper(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  capabilityId: string;
}): CapabilityActionMapping[] {
  const capability = findDataCapability(params.store, params.tenantId, params.capabilityId);
  if (!capability) {
    throw new EnterpriseDataStoreError("DATA_CAPABILITY_NOT_FOUND", "DataCapability not found.");
  }
  return capability.actionRefs.map((ref) => {
    const action = findConnectorAction(params.store, params.tenantId, ref);
    const handlerRegistered = Object.values(params.store.connectorRuntimeRegistry).some(
      (entry) =>
        entry.tenantId === params.tenantId &&
        buildConnectorActionRefKey(entry) === buildConnectorActionRefKey(ref),
    );
    return { ref: { ...ref }, action, handlerRegistered };
  });
}

export function resolveCapabilitiesByActionRef(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  ref: ConnectorActionRef;
}): DataCapability[] {
  const key = buildConnectorActionRefKey(params.ref);
  return listDataCapabilities({ store: params.store, tenantId: params.tenantId }).filter(
    (capability) =>
      capability.actionRefs.some((actionRef) => buildConnectorActionRefKey(actionRef) === key),
  );
}

export function resolveCapabilityGovernanceView(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  capabilityId: string;
}): CapabilityGovernanceView {
  const capability = findDataCapability(params.store, params.tenantId, params.capabilityId);
  if (!capability) {
    throw new EnterpriseDataStoreError("DATA_CAPABILITY_NOT_FOUND", "DataCapability not found.");
  }
  const actionKeys = capabilityActionKeys(capability);
  const sourceMappings = resolveCapabilitySourceMapper(params);
  const actionMappings = resolveCapabilityActionMapper(params);
  const projectionSpecs = Object.values(params.store.enterpriseKnowledgeProjectionSpecs).filter(
    (spec) => spec.tenantId === params.tenantId && spec.capabilityId === capability.capabilityId,
  );
  const bindings = Object.values(params.store.enterpriseKnowledgeProjectionBindings).filter(
    (binding) =>
      binding.tenantId === params.tenantId && binding.capabilityId === capability.capabilityId,
  );
  const policies = listDataAccessPolicies({ store: params.store, tenantId: params.tenantId })
    .map((policy) => {
      const matchingActionRefs = policy.actionRefs.filter((ref) =>
        actionKeys.has(buildConnectorActionRefKey(ref)),
      );
      if (matchingActionRefs.length === 0) {
        return null;
      }
      return {
        policyId: policy.policyId,
        displayName: policy.displayName,
        targetKind: policy.targetKind,
        targetId: policy.targetId,
        enabled: policy.enabled,
        matchingActionRefs: matchingActionRefs.map((ref) => ({ ...ref })),
      };
    })
    .filter((entry): entry is CapabilityAccessScopeEntry => entry != null);
  const activeGrants = Object.values(params.store.seatActionGrants).filter(
    (grant) =>
      grant.tenantId === params.tenantId &&
      !grant.revokedAt &&
      actionKeys.has(buildConnectorActionRefKey(grant)),
  );
  return {
    capability,
    sourceMappings,
    actionMappings,
    projectionSpecs,
    accessScope: {
      policies,
      activeGrants,
    },
    supplyHealth: {
      enabled: capability.enabled,
      projectionCount: projectionSpecs.length,
      bindingCount: bindings.length,
      activeGrantCount: activeGrants.length,
      enabledPolicyCount: policies.filter((policy) => policy.enabled).length,
    },
  };
}

export function resolveCapabilityOverview(params: {
  store: EnterpriseDataStore;
  tenantId: string;
}): CapabilityOverview {
  const capabilities = listDataCapabilities({ store: params.store, tenantId: params.tenantId });
  const enabled = capabilities.filter((capability) => capability.enabled);
  const sourceLinked = capabilities.filter((capability) => capability.sourceIds.length > 0);
  const projectionLinkedIds = new Set(
    Object.values(params.store.enterpriseKnowledgeProjectionSpecs)
      .filter((spec) => spec.tenantId === params.tenantId && spec.capabilityId)
      .map((spec) => spec.capabilityId as string),
  );
  return {
    capabilityCount: capabilities.length,
    enabledCapabilityCount: enabled.length,
    sourceLinkedCapabilityCount: sourceLinked.length,
    projectionLinkedCapabilityCount: capabilities.filter((capability) =>
      projectionLinkedIds.has(capability.capabilityId),
    ).length,
  };
}
