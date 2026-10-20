import type { GatewayBrowserClient } from "../gateway.ts";

export type GroupManifestLookup = {
  groupId: string;
  logicalId: string;
  draft: {
    relativePath: string;
    title?: string;
    deliverableId?: string;
    workspaceFilename?: string;
    updatedAtMs: number;
  } | null;
  canonical: {
    relativePath: string;
    deliverableId: string;
    knowledgeBaseId: string;
    knowledgeBaseTitle?: string;
    savedAtMs: number;
  } | null;
};

export async function readGroupDeliverableManifestEntry(
  client: GatewayBrowserClient | null,
  groupId: string,
  logicalId: string,
): Promise<GroupManifestLookup | null> {
  const trimmedGroupId = groupId.trim();
  const trimmedLogicalId = logicalId.trim();
  if (!client || !trimmedGroupId || !trimmedLogicalId) {
    return null;
  }
  try {
    return await client.request<GroupManifestLookup>("workbench.group-manifest.read", {
      groupId: trimmedGroupId,
      logicalId: trimmedLogicalId,
    });
  } catch {
    return null;
  }
}
