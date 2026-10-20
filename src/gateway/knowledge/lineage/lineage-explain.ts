import { EnterpriseDataStoreError } from "../../enterprise-data/connector-action-store.js";
import { resolveKnowledgeLineageChain } from "../../enterprise-data/lineage-governance-store.js";
import type { EnterpriseDataStore } from "../../enterprise-data/types.js";
import { feedRecordObjectId } from "../feed/enterprise-feed-adapter.js";
import type { KnowledgeLineageExplain } from "../types.js";

function normalizeFeedObjectId(objectId: string): string {
  const prefix = "obj:enterprise:feed:";
  if (objectId.startsWith(prefix)) {
    return objectId.slice(prefix.length);
  }
  return objectId;
}

/** Consumption-side lineage explain: reads store records only, never invokes Gateway. */
export function explainKnowledgeLineage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  objectId?: string;
  lineageId?: string;
}): KnowledgeLineageExplain {
  const objectId = params.objectId ? normalizeFeedObjectId(params.objectId) : undefined;
  try {
    const resolution = resolveKnowledgeLineageChain({
      store: params.store,
      tenantId: params.tenantId,
      objectId,
      lineageId: params.lineageId,
    });
    const knowledgeObjectId = feedRecordObjectId(resolution.objectId);
    return {
      lineageId: resolution.lineageId,
      objectId: knowledgeObjectId,
      projectionId: resolution.projectionId,
      chain: resolution.chain.map((node) => ({
        layer: node.layer,
        id: node.id,
        label: node.label,
      })),
      reverseChain: resolution.reverseChain.map((node) => ({
        role: node.role,
        id: node.id,
        label: node.label,
      })),
    };
  } catch (error) {
    if (error instanceof EnterpriseDataStoreError && error.code === "LINEAGE_NOT_FOUND") {
      throw error;
    }
    throw error;
  }
}
