import { readIndexedEnterpriseSections } from "./indexed-store.js";
/** Read-only legacy JSON projection. Skipped sections are never assembled. */
import { normalizeEnterpriseDataStore, resolveDefaultEnterpriseDataStorePath } from "./store.js";
import type { EnterpriseDataStore } from "./types.js";
export const KNOWLEDGE_READ_SECTIONS = [
  "version",
  "dataSources",
  "dataCapabilities",
  "dataAccessPolicies",
  "seatActionGrants",
  "enterpriseKnowledgeProjectionSpecs",
  "enterpriseKnowledgeProjectionBindings",
  "knowledgeVisibilityPolicies",
  "knowledgeFeedItems",
  "knowledgeLineageRecords",
] as const;
const MAX_SELECTED_BYTES = 32 * 1024 * 1024;
export async function readKnowledgeEnterpriseStore(input: {
  storePath?: string;
  tenantId: string | null;
  maxSelectedBytes?: number;
}): Promise<EnterpriseDataStore> {
  if (!input.tenantId) {
    return normalizeEnterpriseDataStore(null);
  }
  return readIndexedEnterpriseSections(
    input.storePath ?? resolveDefaultEnterpriseDataStorePath(),
    normalizeEnterpriseDataStore(null),
    input.tenantId,
    KNOWLEDGE_READ_SECTIONS,
    input.maxSelectedBytes ?? MAX_SELECTED_BYTES,
  );
}
