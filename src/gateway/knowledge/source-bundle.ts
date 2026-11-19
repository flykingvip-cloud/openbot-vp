import fs from "node:fs";
import { loadConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { readKnowledgeEnterpriseStore } from "../enterprise-data/streaming-store-read.js";
import type { GatewayClient } from "../server-methods/types.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_ENTERPRISE_DATA_FILE } from "../tenant-store-paths.js";
import { resolveKnowledgeSourceContext } from "./context.js";
import { listDeliverableArchiveKnowledgeBaseIds } from "./deliverables/archive-store.js";
import { buildKnowledgeSourceBundleAsync } from "./empty-bundle.js";
import { createBudgetedEventLoopYielder } from "./event-loop-yield.js";
import { buildKnowledgeIndexCapabilityDescriptor } from "./feed/data-capability-feed-adapter.js";
import { loadKnowledgeFeedBundle } from "./feed/knowledge-feed-adapter.js";
import {
  countIndexedChunks,
  sumChunkReferenceCountsByKnowledgeBase,
} from "./governance/chunk-governance-store.js";
import { loadDocumentGovernanceOverlayAsync } from "./governance/runtime/object-writeback.js";
import { acquireKnowledgeIndexRead } from "./kb-index-read-pool.js";
import { resolveKnowledgeIndexDbPath } from "./kb-index.js";
import { listKnowledgeBases } from "./knowledge-base-store.js";
import { buildDefaultKnowledgeObjects, buildDefaultKnowledgeSourceSummary } from "./mock-graph.js";
import { buildIntelligentRelationshipGraph } from "./runtime/relationship-runtime.js";
import {
  formatKnowledgeSourceBundleCacheKey,
  getKnowledgeSourceBundleCache,
} from "./source-bundle-cache.js";
import { loadDataCapabilityCatalog } from "./sources/capability-catalog.js";
import { buildConfiguredChannelCapabilityDescriptors } from "./sources/channel-capability-source.js";
import { buildEnterpriseSourceSummary } from "./sources/enterprise-source.js";
import { loadExternalDataSourceSummaries } from "./sources/external-data-sources.js";
import {
  buildCrossKnowledgeBaseEdgesAsync,
  loadArchivedDeliverableObjects,
  loadKnowledgeBaseSpaceObjectsAsync,
  knowledgeBaseNodeObjectId,
} from "./sources/knowledge-index-source.js";
import {
  buildPersonalSourceSummary,
  loadPersonalKnowledgeObjects,
} from "./sources/personal-source.js";
import type { KnowledgeSourceBundle } from "./sources/types.js";
import type { DataCapabilityDescriptor, KnowledgeObject, RelationshipEdge } from "./types.js";

const log = createSubsystemLogger("gateway/knowledge");

function loadMockBundle(): KnowledgeSourceBundle {
  const objects = buildDefaultKnowledgeObjects();
  const runtime = buildIntelligentRelationshipGraph({ objects });
  return {
    objects: runtime.objects,
    dataCapabilities: [],
    sourceSummary: buildDefaultKnowledgeSourceSummary(),
    sourceBrowse: {
      personal: runtime.objects.filter((item) => item.source === "personal").slice(0, 12),
      enterprise: runtime.objects.filter((item) => item.source === "enterprise").slice(0, 12),
      enterpriseRestricted: [],
    },
    externalDataSources: [],
    feedItems: [],
    graph: runtime.graph,
  };
}

async function loadEnterpriseStoreBundle(
  client: GatewayClient | null,
  options?: {
    agentType?: import("../enterprise-data/types.js").KnowledgeAgentType | null;
    context?: import("./sources/types.js").KnowledgeSourceContext;
  },
): Promise<KnowledgeSourceBundle> {
  const yieldFn = createBudgetedEventLoopYielder();
  const context =
    options?.context ??
    (await resolveKnowledgeSourceContext(client, {
      agentType: options?.agentType ?? undefined,
    }));
  const storePath = await resolveControlPlaneStorePathForClient(
    client,
    TENANT_ENTERPRISE_DATA_FILE,
  );
  const store = await readKnowledgeEnterpriseStore({ storePath, tenantId: context.tenantId });
  // Fail-closed personal projection: only assets owned by the caller enter the graph.
  const personalObjects = loadPersonalKnowledgeObjects({ ownerUserId: context.userId });
  // Consumption reads FeedItems that supply already wrote. It does not materialize.
  const feedBundle = loadKnowledgeFeedBundle({ store, context });
  const dataCatalog = loadDataCapabilityCatalog({ store, context });
  const objects = [...personalObjects, ...feedBundle.objects];
  let documentGovernanceOverlay;
  let knowledgeIndexCapability: DataCapabilityDescriptor | null = null;
  // Real knowledge-base projection: KB spaces + archived deliverables become graph
  // nodes, and shared governance groups become cross-KB edges. This makes the 关系网络
  // reflect the actual knowledge base instead of only heuristic skill-asset/feed nodes.
  const knowledgeIndexObjects: KnowledgeObject[] = [];
  const knowledgeIndexEdges: RelationshipEdge[] = [];
  let usageCountByObjectId: Record<string, number> | undefined;
  let ownedKnowledgeBaseCount = 0;
  if (context.userId) {
    const dbPath = resolveKnowledgeIndexDbPath({
      ownerId: context.userId,
      tenantId: context.tenantId,
    });
    if (fs.existsSync(dbPath)) {
      const index = await acquireKnowledgeIndexRead({ dbPath, vectorEnabled: false });
      try {
        documentGovernanceOverlay = await loadDocumentGovernanceOverlayAsync(index.db, yieldFn);
        // Real, non-demo data source: surface the employee's own knowledge index
        // as a granted capability when it actually holds indexed chunks.
        knowledgeIndexCapability = buildKnowledgeIndexCapabilityDescriptor({
          indexedChunkCount: countIndexedChunks(index.db),
        });
        await yieldFn();
        const knowledgeBases = listKnowledgeBases({
          ownerId: context.userId,
          ...(context.tenantId ? { tenantId: context.tenantId } : {}),
        });
        ownedKnowledgeBaseCount = knowledgeBases.length;
        if (knowledgeBases.length > 0) {
          knowledgeIndexObjects.push(
            ...(await loadKnowledgeBaseSpaceObjectsAsync({
              db: index.db,
              knowledgeBases,
              yieldFn,
            })),
            ...loadArchivedDeliverableObjects({
              db: index.db,
              knowledgeBases,
              archiveMap: listDeliverableArchiveKnowledgeBaseIds(),
            }),
          );
          knowledgeIndexEdges.push(
            ...(await buildCrossKnowledgeBaseEdgesAsync({
              db: index.db,
              knowledgeBases,
              yieldFn,
            })),
          );
          usageCountByObjectId = {};
          const citationTotals = sumChunkReferenceCountsByKnowledgeBase(
            index.db,
            knowledgeBases.map((base) => base.id),
          );
          for (const [baseId, citationTotal] of citationTotals.entries()) {
            if (citationTotal > 0) {
              usageCountByObjectId[knowledgeBaseNodeObjectId(baseId)] = citationTotal;
            }
          }
          await yieldFn();
        }
      } finally {
        index.close();
      }
    }
  }
  objects.push(...knowledgeIndexObjects);
  log.info("knowledge source bundle isolation", {
    userId: context.userId,
    tenantId: context.tenantId,
    seatId: context.seatId,
    kbCount: ownedKnowledgeBaseCount,
    personalObjectCount: personalObjects.length,
    enterpriseObjectCount: feedBundle.enterpriseAccessible.length,
    enterpriseRestrictedCount: feedBundle.enterpriseRestricted.length,
    dataObjectCount: feedBundle.dataObjects.length,
    kbIndexObjectCount: knowledgeIndexObjects.length,
    totalObjectCount: objects.length,
  });
  const channelCapabilities = buildConfiguredChannelCapabilityDescriptors(loadConfig());
  const realCapabilities = [
    ...(knowledgeIndexCapability ? [knowledgeIndexCapability] : []),
    ...channelCapabilities,
  ];
  const dataCapabilities =
    realCapabilities.length > 0
      ? [...realCapabilities, ...dataCatalog.descriptors]
      : dataCatalog.descriptors;
  const dataSummary =
    realCapabilities.length > 0
      ? {
          ...dataCatalog.summary,
          grantedCount: dataCatalog.summary.grantedCount + realCapabilities.length,
        }
      : dataCatalog.summary;
  return buildKnowledgeSourceBundleAsync({
    objects,
    dataCapabilities,
    yieldFn,
    sourceSummary: {
      personal: buildPersonalSourceSummary(personalObjects),
      enterprise: buildEnterpriseSourceSummary({
        store,
        context,
        accessibleObjects: feedBundle.enterpriseAccessible,
      }),
      data: dataSummary,
    },
    enterpriseRestricted: feedBundle.enterpriseRestricted,
    // Empty on purpose: do not copy live DataSource category/status into the
    // consumption bundle. Connector health is not a FeedItem.
    externalDataSources: loadExternalDataSourceSummaries({
      store,
      tenantId: context.tenantId,
    }),
    feedItems: feedBundle.feedItems,
    extraEdges: knowledgeIndexEdges,
    documentGovernanceOverlay,
    usageCountByObjectId,
  });
}

export async function loadKnowledgeSourceBundleFromContext(
  context: import("./sources/types.js").KnowledgeSourceContext,
  client: GatewayClient | null = null,
  options?: {
    agentType?: import("../enterprise-data/types.js").KnowledgeAgentType | null;
  },
): Promise<KnowledgeSourceBundle> {
  const cacheKey = formatKnowledgeSourceBundleCacheKey({
    userId: context.userId,
    tenantId: context.tenantId,
    seatId: context.seatId,
    agentType: options?.agentType ?? context.agentType ?? null,
  });
  return getKnowledgeSourceBundleCache().getOrLoad(cacheKey, async () => {
    try {
      return await loadEnterpriseStoreBundle(client, {
        agentType: options?.agentType,
        context,
      });
    } catch {
      const personal = loadPersonalKnowledgeObjects({ ownerUserId: context.userId });
      log.warn("knowledge source bundle fell back to personal-only", {
        userId: context.userId,
        personalObjectCount: personal.length,
      });
      return buildKnowledgeSourceBundleAsync({
        objects: personal,
        yieldFn: createBudgetedEventLoopYielder(),
        sourceSummary: {
          personal: buildPersonalSourceSummary(personal),
          enterprise: { libraryCount: 0, accessibleCount: 0 },
          data: { grantedCount: 0, requestableCount: 0, externalSourceCount: 0 },
        },
      });
    }
  });
}

export async function loadKnowledgeSourceBundle(
  client: GatewayClient | null,
  options?: {
    preferMock?: boolean;
    agentType?: import("../enterprise-data/types.js").KnowledgeAgentType | null;
  },
): Promise<KnowledgeSourceBundle> {
  if (options?.preferMock) {
    return loadMockBundle();
  }
  const context = await resolveKnowledgeSourceContext(client, {
    agentType: options?.agentType ?? undefined,
  });
  return loadKnowledgeSourceBundleFromContext(context, client, options);
}
