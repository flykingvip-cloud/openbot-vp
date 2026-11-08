/**
 * E2 data-asset linkage.
 *
 * Aggregates DataSource, AccountBinding, and EnterpriseSarExecutionBridge.
 * Does not invent a second binding or verification type. Observation clocks
 * stay off `updatedAt`. Probes only move `lastCheckedAt`.
 */

import type { AccountBinding } from "../../site-capability/session-handle.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { findDataConnectorDefinition } from "./connector-catalog.js";
import { listDataCapabilities } from "./data-capability-store.js";
import { findDataSource, listDataSources } from "./data-source-store.js";
import { listSarExecutionBridges } from "./sar-governance-bridge.js";
import type {
  ConnectorActionRef,
  DataConnectorAccessMethod,
  DataSource,
  DataSourceStatus,
  EnterpriseDataStore,
  EnterpriseSarExecutionBridge,
  ScopeType,
} from "./types.js";

export const DATA_ASSET_FRESHNESS_SLA_MS = 24 * 60 * 60 * 1000;

const SOURCE_STATUSES = new Set<DataSourceStatus>(["connected", "disconnected", "error"]);

export type DataAssetConnectionHealth = "healthy" | "unhealthy" | "unknown";

export type DataAssetVerificationStatus = EnterpriseSarExecutionBridge["verification"] | "unknown";

export type DataAssetFreshnessStatus = "fresh" | "stale" | "live_query" | "unknown";

export type DataAssetLinkedCapability = {
  /** SAR capability id. Not a DataCapability id and not a skill id. */
  capabilityId: string;
  version: string;
  artifactDigest: string;
  verification: EnterpriseSarExecutionBridge["verification"];
  skillId?: string;
  actionRef: ConnectorActionRef;
  /** DataCapability.capabilityId when a product groups this source. */
  dataCapabilityId?: string;
  demoCapability: boolean;
};

export type DataAssetLinkedProduct = {
  capabilityId: string;
  displayName: string;
};

export type DataAssetLinkage = {
  sourceId: string;
  tenantId: string;
  accessMethod: DataConnectorAccessMethod;
  demo: boolean;
  /** Data products whose sourceIds include this asset. Not a SAR verification. */
  products: DataAssetLinkedProduct[];
  connection: {
    status: DataSourceStatus | "unknown";
    health: DataAssetConnectionHealth;
    lastCheckedAt?: string;
  };
  verification: {
    status: DataAssetVerificationStatus;
    /** True only for an aggregate of passed. Unknown, failed, stale, unverified are not. */
    healthy: boolean;
    productionVerificationCount: number;
    capabilities: DataAssetLinkedCapability[];
  };
  freshness: {
    status: DataAssetFreshnessStatus;
    /** True only when materialized data is inside the freshness SLA. */
    healthy: boolean;
    lastSucceededAt?: string;
    lastMaterializedAt?: string;
    materializationCount: number;
    /** Live query and missing materialization never claim a sync or an ingest. */
    claimsSynced: boolean;
    claimsIngested: boolean;
  };
  scope: {
    supportedScopeTypes: ScopeType[];
    known: boolean;
  };
  account: {
    bindingId?: string;
    ownerUserId?: string;
    selectable: boolean;
  };
  links: {
    capabilityCenter: {
      capabilityId: string;
      version: string;
      skillId?: string;
    } | null;
    dataCenter: { sourceId: string } | null;
  };
};

export type DataAssetStats = {
  connection: { healthy: number; unhealthy: number; unknown: number };
  verification: {
    passed: number;
    failed: number;
    unverified: number;
    stale: number;
    unknown: number;
  };
  freshness: { fresh: number; stale: number; liveQuery: number; unknown: number };
  demo: number;
};

export type WebsiteAccessChoice =
  | { outcome: "select_existing"; selectable: AccountBinding[] }
  | { outcome: "owner_must_authorize"; selectable: AccountBinding[] };

export type OwnedAssetLink = {
  sourceId: string;
  displayName: string;
  capabilityId: string;
  version?: string;
  skillId?: string;
};

function copyBinding(binding: AccountBinding): AccountBinding {
  return {
    bindingId: binding.bindingId,
    tenantId: binding.tenantId,
    userId: binding.userId,
  };
}

export function registerCallerAccountBinding(params: {
  store: EnterpriseDataStore;
  caller: { tenantId: string; userId: string };
  bindingId: string;
}): AccountBinding {
  const bindingId = params.bindingId.trim();
  const userId = params.caller.userId.trim();
  const tenantId = params.caller.tenantId.trim();
  if (!bindingId || !userId || !tenantId) {
    throw new EnterpriseDataStoreError(
      "OWNER_IDENTITY_REQUIRED",
      "账户所有者身份和 AccountBinding.bindingId 都要有，才能登记授权。",
    );
  }
  const existing = params.store.accountBindings?.[bindingId];
  if (existing && (existing.userId !== userId || existing.tenantId !== tenantId)) {
    throw new EnterpriseDataStoreError(
      "SAR_BINDING_PRIVATE",
      "私人 AccountBinding 不因企业管理员身份共享。",
    );
  }
  const binding = copyBinding({ bindingId, tenantId, userId });
  params.store.accountBindings = {
    ...params.store.accountBindings,
    [bindingId]: binding,
  };
  return binding;
}

export function listSelectableAccountBindings(
  store: EnterpriseDataStore,
  caller: { tenantId: string; userId: string } | null,
): AccountBinding[] {
  if (!caller?.userId.trim()) {
    return [];
  }
  return Object.values(store.accountBindings ?? {})
    .filter((binding) => binding.tenantId === caller.tenantId && binding.userId === caller.userId)
    .map(copyBinding)
    .toSorted((left, right) => left.bindingId.localeCompare(right.bindingId));
}

export function resolveWebsiteAccessChoice(params: {
  store: EnterpriseDataStore;
  caller: { tenantId: string; userId: string } | null;
}): WebsiteAccessChoice {
  const selectable = listSelectableAccountBindings(params.store, params.caller);
  if (selectable.length === 0) {
    return { outcome: "owner_must_authorize", selectable: [] };
  }
  return { outcome: "select_existing", selectable };
}

export function assertWebsiteBindingAssignable(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  callerUserId: string | null;
  sourceId?: string;
  bindingId?: string;
}): void {
  const existing = params.sourceId
    ? findDataSource(params.store, params.tenantId, params.sourceId)
    : null;
  const bindingId = params.bindingId?.trim() || existing?.bindingId;
  if (!bindingId) {
    return;
  }
  if (existing?.bindingId === bindingId) {
    return;
  }
  if (!params.callerUserId?.trim()) {
    throw new EnterpriseDataStoreError(
      "OWNER_IDENTITY_REQUIRED",
      "账户所有者身份缺失，不能登记或改绑私人授权。",
    );
  }
  const binding = params.store.accountBindings?.[bindingId];
  if (!binding || binding.tenantId !== params.tenantId || binding.userId !== params.callerUserId) {
    const foreign = Boolean(
      binding && (binding.userId !== params.callerUserId || binding.tenantId !== params.tenantId),
    );
    throw new EnterpriseDataStoreError(
      foreign ? "SAR_BINDING_PRIVATE" : "DATA_SOURCE_BINDING_REQUIRED",
      foreign
        ? "私人 AccountBinding 不因企业管理员身份共享。"
        : "请先由账户所有者登记 AccountBinding，再选择该授权。",
    );
  }
}

export function recordSourceConnectionCheck(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId: string;
  nowIso: string;
}): DataSource | null {
  const source = findDataSource(params.store, params.tenantId, params.sourceId);
  if (!source) {
    return null;
  }
  source.lastCheckedAt = params.nowIso;
  return source;
}

export function recordGovernedReadSuccess(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  sourceId: string;
  nowIso: string;
}): DataSource | null {
  const source = findDataSource(params.store, params.tenantId, params.sourceId);
  if (!source) {
    return null;
  }
  const definition = findDataConnectorDefinition(source.connectorId);
  if (definition?.integrationTier === "demo") {
    return source;
  }
  source.lastSucceededAt = params.nowIso;
  return source;
}

export function recordMaterializedConnectorAction(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  actionRef: ConnectorActionRef;
  /** When the projection names one source, stamp only that instance. */
  sourceId?: string;
  nowIso: string;
}): string[] {
  const definition = findDataConnectorDefinition(params.actionRef.connectorId);
  if (definition?.integrationTier === "demo") {
    return [];
  }
  const namedSourceId = params.sourceId?.trim();
  if (namedSourceId) {
    const named = findDataSource(params.store, params.tenantId, namedSourceId);
    if (!named || named.connectorId !== params.actionRef.connectorId) {
      return [];
    }
    named.lastMaterializedAt = params.nowIso;
    named.materializationCount = (named.materializationCount ?? 0) + 1;
    return [named.sourceId];
  }
  const matches = listDataSources({ store: params.store, tenantId: params.tenantId }).filter(
    (source) => source.connectorId === params.actionRef.connectorId,
  );
  const explicit = matches.filter((source) =>
    sourceReferencesAction(params.store, source, params.actionRef),
  );
  const targets = explicit.length > 0 ? explicit : matches;
  if (targets.length !== 1) {
    return [];
  }
  const source = targets[0];
  if (!source) {
    return [];
  }
  source.lastMaterializedAt = params.nowIso;
  source.materializationCount = (source.materializationCount ?? 0) + 1;
  return [source.sourceId];
}

function sourceReferencesAction(
  store: EnterpriseDataStore,
  source: DataSource,
  actionRef: ConnectorActionRef,
): boolean {
  const bridges = listSarExecutionBridges({
    store,
    tenantId: source.tenantId,
    sourceId: source.sourceId,
  });
  if (
    bridges.some(
      (bridge) =>
        bridge.actionRef.connectorId === actionRef.connectorId &&
        bridge.actionRef.actionKey === actionRef.actionKey &&
        bridge.actionRef.version === actionRef.version,
    )
  ) {
    return true;
  }
  return listDataCapabilities({ store, tenantId: source.tenantId, sourceId: source.sourceId }).some(
    (capability) =>
      capability.actionRefs.some(
        (ref) =>
          ref.connectorId === actionRef.connectorId &&
          ref.actionKey === actionRef.actionKey &&
          ref.version === actionRef.version,
      ),
  );
}

function connectionOf(source: DataSource): DataAssetLinkage["connection"] {
  const status = SOURCE_STATUSES.has(source.status) ? source.status : "unknown";
  const health: DataAssetConnectionHealth =
    status === "unknown" ? "unknown" : status === "connected" ? "healthy" : "unhealthy";
  return {
    status,
    health,
    ...(source.lastCheckedAt ? { lastCheckedAt: source.lastCheckedAt } : {}),
  };
}

function aggregateVerification(
  capabilities: DataAssetLinkedCapability[],
): DataAssetLinkage["verification"] {
  const productionVerificationCount = capabilities.filter(
    (capability) => capability.verification === "passed",
  ).length;
  if (capabilities.length === 0) {
    return { status: "unknown", healthy: false, productionVerificationCount, capabilities };
  }
  const statuses = new Set(capabilities.map((capability) => capability.verification));
  let status: DataAssetVerificationStatus = "unknown";
  if (statuses.has("failed")) {
    status = "failed";
  } else if (statuses.has("stale")) {
    status = "stale";
  } else if (statuses.has("unverified")) {
    status = "unverified";
  } else if (statuses.size === 1 && statuses.has("passed")) {
    status = "passed";
  }
  return {
    status,
    healthy: status === "passed",
    productionVerificationCount,
    capabilities,
  };
}

function freshnessOf(source: DataSource, nowIso: string): DataAssetLinkage["freshness"] {
  const materializationCount = source.materializationCount ?? 0;
  const lastSucceededAt = source.lastSucceededAt;
  const lastMaterializedAt = source.lastMaterializedAt;
  const materializedMs = lastMaterializedAt ? Date.parse(lastMaterializedAt) : Number.NaN;
  const nowMs = Date.parse(nowIso);
  if (Number.isFinite(materializedMs) && Number.isFinite(nowMs)) {
    const fresh = nowMs - materializedMs <= DATA_ASSET_FRESHNESS_SLA_MS;
    return {
      status: fresh ? "fresh" : "stale",
      healthy: fresh,
      ...(lastSucceededAt ? { lastSucceededAt } : {}),
      lastMaterializedAt,
      materializationCount,
      claimsSynced: true,
      claimsIngested: true,
    };
  }
  if (lastSucceededAt && Number.isFinite(Date.parse(lastSucceededAt))) {
    return {
      status: "live_query",
      healthy: false,
      lastSucceededAt,
      materializationCount,
      claimsSynced: false,
      claimsIngested: false,
    };
  }
  return {
    status: "unknown",
    healthy: false,
    materializationCount,
    claimsSynced: false,
    claimsIngested: false,
  };
}

function buildOne(params: {
  store: EnterpriseDataStore;
  source: DataSource;
  callerUserId: string | null;
  nowIso: string;
}): DataAssetLinkage {
  const { source } = params;
  const definition = findDataConnectorDefinition(source.connectorId);
  const accessMethod = source.accessMethod ?? definition?.accessMethod ?? "credential";
  const bridges = listSarExecutionBridges({
    store: params.store,
    tenantId: source.tenantId,
    sourceId: source.sourceId,
  }).filter((bridge) => bridge.tenantId === source.tenantId);
  const dataCapabilities = listDataCapabilities({
    store: params.store,
    tenantId: source.tenantId,
    sourceId: source.sourceId,
  }).filter((capability) => capability.tenantId === source.tenantId);
  const capabilities: DataAssetLinkedCapability[] = bridges.map((bridge) => {
    const product = dataCapabilities.find((capability) =>
      capability.actionRefs.some(
        (ref) =>
          ref.connectorId === bridge.actionRef.connectorId &&
          ref.actionKey === bridge.actionRef.actionKey &&
          ref.version === bridge.actionRef.version,
      ),
    );
    return {
      capabilityId: bridge.capabilityId,
      version: bridge.version,
      artifactDigest: bridge.artifactDigest,
      verification: bridge.verification,
      ...(bridge.skillId ? { skillId: bridge.skillId } : {}),
      actionRef: bridge.actionRef,
      ...(product ? { dataCapabilityId: product.capabilityId } : {}),
      demoCapability: product?.seedOrigin === "demo",
    };
  });
  const scopeTypes = [
    ...new Set(bridges.flatMap((bridge) => bridge.supportedScopeTypes)),
  ].toSorted();
  const ownedBinding = source.bindingId
    ? params.store.accountBindings?.[source.bindingId]
    : undefined;
  const ownerUserId =
    ownedBinding && ownedBinding.tenantId === source.tenantId
      ? ownedBinding.userId
      : bridges.find((bridge) => bridge.bindingId === source.bindingId)?.userId;
  const primary = capabilities[0];
  const sameTenant = source.tenantId === params.store.dataSources[source.sourceId]?.tenantId;
  const products = dataCapabilities
    .filter((capability) => capability.enabled)
    .map((capability) => ({
      capabilityId: capability.capabilityId,
      displayName: capability.displayName,
    }))
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName, "zh"));
  return {
    sourceId: source.sourceId,
    tenantId: source.tenantId,
    accessMethod,
    demo: definition?.integrationTier === "demo",
    products,
    connection: connectionOf(source),
    verification: aggregateVerification(capabilities),
    freshness: freshnessOf(source, params.nowIso),
    scope: {
      supportedScopeTypes: scopeTypes,
      known: scopeTypes.length > 0,
    },
    account: {
      ...(source.bindingId ? { bindingId: source.bindingId } : {}),
      ...(ownerUserId ? { ownerUserId } : {}),
      selectable: Boolean(
        params.callerUserId &&
        ownedBinding &&
        ownedBinding.userId === params.callerUserId &&
        ownedBinding.tenantId === source.tenantId,
      ),
    },
    links: {
      capabilityCenter:
        sameTenant && primary
          ? {
              capabilityId: primary.capabilityId,
              version: primary.version,
              ...(primary.skillId ? { skillId: primary.skillId } : {}),
            }
          : null,
      dataCenter: sameTenant ? { sourceId: source.sourceId } : null,
    },
  };
}

export function buildDataAssetLinkage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  callerUserId: string | null;
  nowIso: string;
  sourceId?: string;
}): DataAssetLinkage[] {
  const sources = listDataSources({ store: params.store, tenantId: params.tenantId }).filter(
    (source) => source.tenantId === params.tenantId,
  );
  const selected = params.sourceId
    ? sources.filter((source) => source.sourceId === params.sourceId)
    : sources;
  return selected.map((source) =>
    buildOne({
      store: params.store,
      source,
      callerUserId: params.callerUserId,
      nowIso: params.nowIso,
    }),
  );
}

export function summarizeDataAssetLinkage(items: readonly DataAssetLinkage[]): DataAssetStats {
  const stats: DataAssetStats = {
    connection: { healthy: 0, unhealthy: 0, unknown: 0 },
    verification: { passed: 0, failed: 0, unverified: 0, stale: 0, unknown: 0 },
    freshness: { fresh: 0, stale: 0, liveQuery: 0, unknown: 0 },
    demo: 0,
  };
  for (const item of items) {
    stats.connection[item.connection.health] += 1;
    stats.verification[item.verification.status] += 1;
    if (item.freshness.status === "live_query") {
      stats.freshness.liveQuery += 1;
    } else {
      stats.freshness[item.freshness.status] += 1;
    }
    if (item.demo) {
      stats.demo += 1;
    }
  }
  return stats;
}

export function resolveOwnedAssetLinks(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  capabilityId: string;
}): OwnedAssetLink[] {
  const capabilityId = params.capabilityId.trim();
  if (!capabilityId) {
    return [];
  }
  const links: OwnedAssetLink[] = [];
  const seen = new Set<string>();
  const push = (link: OwnedAssetLink) => {
    const key = `${link.sourceId}:${link.capabilityId}`;
    if (seen.has(key)) {
      return;
    }
    const source = findDataSource(params.store, params.tenantId, link.sourceId);
    if (!source || source.tenantId !== params.tenantId) {
      return;
    }
    seen.add(key);
    links.push({ ...link, displayName: source.displayName });
  };
  for (const bridge of listSarExecutionBridges({
    store: params.store,
    tenantId: params.tenantId,
  })) {
    if (bridge.tenantId !== params.tenantId) {
      continue;
    }
    if (bridge.capabilityId !== capabilityId && bridge.skillId !== capabilityId) {
      continue;
    }
    push({
      sourceId: bridge.sourceId,
      displayName: bridge.sourceId,
      capabilityId: bridge.capabilityId,
      version: bridge.version,
      ...(bridge.skillId ? { skillId: bridge.skillId } : {}),
    });
  }
  for (const capability of listDataCapabilities({
    store: params.store,
    tenantId: params.tenantId,
  })) {
    if (capability.tenantId !== params.tenantId || capability.capabilityId !== capabilityId) {
      continue;
    }
    for (const sourceId of capability.sourceIds) {
      push({
        sourceId,
        displayName: sourceId,
        capabilityId: capability.capabilityId,
      });
    }
  }
  return links;
}
