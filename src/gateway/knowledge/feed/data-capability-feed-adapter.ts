import { resolveCapabilitySupplyFreshness } from "../../enterprise-data/capability-supply-freshness.js";
import { listDataCapabilities } from "../../enterprise-data/data-capability-store.js";
import { listDataSources } from "../../enterprise-data/data-source-store.js";
import { listSeatActionGrants } from "../../enterprise-data/seat-action-grant-store.js";
import type { EnterpriseDataStore } from "../../enterprise-data/types.js";
import { hasPendingSeatCapabilityAccess } from "../seat-capability-access.js";
import {
  countExternalAccessCapabilities,
  resolveCapabilityAccessForKnowledge,
} from "../sources/capability-access-resolver.js";
import { mapCapabilityScenarios } from "../sources/capability-scenario-mapper.js";
import type { KnowledgeSourceContext } from "../sources/types.js";
import type { DataCapabilityDescriptor, KnowledgeObject } from "../types.js";
import type { KnowledgeFeedItem } from "./types.js";

function capabilityScopeLabel(accessState: DataCapabilityDescriptor["accessState"]): string {
  if (accessState === "granted") {
    return "已授权";
  }
  if (accessState === "pending") {
    return "审批中";
  }
  if (accessState === "external") {
    return "外部数据源";
  }
  return "待申请";
}

export function loadDataCapabilityFeed(params: {
  store: EnterpriseDataStore;
  context: KnowledgeSourceContext;
}): {
  feedItems: KnowledgeFeedItem[];
  objects: KnowledgeObject[];
  descriptors: DataCapabilityDescriptor[];
  summary: {
    grantedCount: number;
    requestableCount: number;
    externalSourceCount: number;
  };
} {
  if (!params.context.tenantId) {
    return {
      feedItems: [],
      objects: [],
      descriptors: [],
      summary: { grantedCount: 0, requestableCount: 0, externalSourceCount: 0 },
    };
  }
  const capabilities = listDataCapabilities({
    store: params.store,
    tenantId: params.context.tenantId,
    enabled: true,
  });
  const sources = listDataSources({ store: params.store, tenantId: params.context.tenantId });
  const sourcesById = new Map(sources.map((source) => [source.sourceId, source]));
  const grants = params.context.seatId
    ? listSeatActionGrants({
        store: params.store,
        tenantId: params.context.tenantId,
        seatId: params.context.seatId,
      })
    : [];

  let grantedCount = 0;
  let requestableCount = 0;
  const descriptors: DataCapabilityDescriptor[] = [];

  for (const capability of capabilities) {
    let accessState = resolveCapabilityAccessForKnowledge({
      store: params.store,
      capability,
      context: {
        tenantId: params.context.tenantId,
        seatId: params.context.seatId,
        departmentId: params.context.departmentId,
        roleCode: params.context.roleCode,
      },
      grants,
    });
    if (
      accessState === "requestable" &&
      params.context.seatId &&
      hasPendingSeatCapabilityAccess({
        store: params.store,
        tenantId: params.context.tenantId,
        seatId: params.context.seatId,
        capabilityId: capability.capabilityId,
      })
    ) {
      accessState = "pending";
    }
    if (accessState === "granted") {
      grantedCount += 1;
    } else if (accessState === "requestable") {
      requestableCount += 1;
    }
    const sourceSystems = capability.sourceIds
      .map((sourceId) => sourcesById.get(sourceId)?.displayName)
      .filter((value): value is string => !!value);
    const scenarios = mapCapabilityScenarios(capability.capabilityKey);
    // Catalog card freshness is supply metadata already written on FeedItems.
    // Live DataSource connection state must not invent it.
    const freshness = resolveCapabilitySupplyFreshness({
      store: params.store,
      tenantId: params.context.tenantId,
      capabilityId: capability.capabilityId,
    });
    const descriptor: DataCapabilityDescriptor = {
      id: capability.capabilityId,
      title: capability.displayName,
      summary: capability.description,
      sourceSystems,
      scenarios,
      visibleAgents: [],
      scopeLabel: capabilityScopeLabel(accessState),
      accessState,
      isSample: capability.seedOrigin === "demo",
      freshness,
    };
    descriptors.push(descriptor);
  }

  return {
    // Consumable objects come from persisted FeedItems (enterprise adapter).
    // The capability catalog must not synthesize display items.
    feedItems: [],
    objects: [],
    descriptors,
    summary: {
      grantedCount,
      requestableCount,
      externalSourceCount: countExternalAccessCapabilities(descriptors),
    },
  };
}

/** Stable id for the real, knowledge-index-backed data capability. */
export const KNOWLEDGE_INDEX_CAPABILITY_ID = "cap:knowledge-index-retrieval";

/**
 * A real (non-demo) data capability backed by the employee's own knowledge
 * index. Unlike the seeded demo connectors, this reflects live data — it only
 * surfaces when chunks have actually been indexed, and its summary is computed
 * from the real `indexedChunkCount`. The retrieval it represents is the same
 * governance-aware `retrieveKnowledgeFromIndex` path used by knowledge.search.
 */
export function buildKnowledgeIndexCapabilityDescriptor(params: {
  indexedChunkCount: number;
}): DataCapabilityDescriptor | null {
  if (params.indexedChunkCount <= 0) {
    return null;
  }
  return {
    id: KNOWLEDGE_INDEX_CAPABILITY_ID,
    title: "企业知识检索",
    summary: `基于已索引的 ${params.indexedChunkCount} 个知识片段，提供治理感知的语义检索（真实数据源）`,
    sourceSystems: ["知识库索引"],
    scenarios: ["知识问答", "证据检索", "Agent 上下文"],
    visibleAgents: [],
    scopeLabel: "已授权",
    accessState: "granted",
    isSample: false,
    freshness: "fresh",
  };
}
