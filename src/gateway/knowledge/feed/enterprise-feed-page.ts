/**
 * knowledge_get entry for a materialized enterprise feed page.
 * Loads the caller's tenant store and applies the same seat gate as the feed summary.
 */

import { loadEnterpriseDataStore } from "../../enterprise-data/store.js";
import type { GatewayClient } from "../../server-methods/types.js";
import { resolveControlPlaneStorePathForClient } from "../../tenant-context.js";
import { TENANT_ENTERPRISE_DATA_FILE } from "../../tenant-store-paths.js";
import { resolveKnowledgeSourceContext } from "../context.js";
import { readEnterpriseFeedPage, type EnterpriseFeedPageRead } from "./enterprise-feed-adapter.js";

export async function readEnterpriseFeedPageForTool(params: {
  client: GatewayClient | null;
  objectId: string;
  offset?: number;
  limit?: number;
}): Promise<EnterpriseFeedPageRead> {
  const context = await resolveKnowledgeSourceContext(params.client);
  if (!context.tenantId) {
    return { kind: "absent" };
  }
  const storePath = await resolveControlPlaneStorePathForClient(
    params.client,
    TENANT_ENTERPRISE_DATA_FILE,
  );
  const store = await loadEnterpriseDataStore(storePath);
  return readEnterpriseFeedPage({
    store,
    context,
    objectId: params.objectId,
    offset: params.offset,
    limit: params.limit,
  });
}
