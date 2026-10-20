import { upsertConnectorAction } from "./connector-action-store.js";
import { listConnectorActions } from "./connector-action-store.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import type { EnterpriseDataStore } from "./types.js";

const NOTION_SEARCH_OUTPUT_V1 = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          object: { type: "string" },
        },
      },
    },
  },
} as const;

export function seedNotionConnectorPackage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): void {
  upsertConnectorAction({
    store: params.store,
    tenantId: params.tenantId,
    nowIso: params.nowIso,
    action: {
      connectorId: "notion",
      actionKey: "oa.kb.search",
      version: "v1",
      displayName: "知识库页面搜索",
      category: "oa",
      riskLevel: "LOW",
      requiresApproval: false,
      readOnly: true,
      outputSchema: NOTION_SEARCH_OUTPUT_V1,
      lifecycle: "active",
    },
  });
  registerRuntimeHandler({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "notion",
    actionKey: "oa.kb.search",
    version: "v1",
    handlerRef: "enterprise-data/handlers/notion-kb-search-v1",
    nowIso: params.nowIso,
  });
}

export function ensureNotionConnectorPackage(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  nowIso: string;
}): { installed: boolean; actionCount: number } {
  const existing = listConnectorActions({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "notion",
  });
  if (existing.length > 0) {
    return { installed: false, actionCount: existing.length };
  }
  seedNotionConnectorPackage(params);
  const actionCount = listConnectorActions({
    store: params.store,
    tenantId: params.tenantId,
    connectorId: "notion",
  }).length;
  return { installed: true, actionCount };
}
