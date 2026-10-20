import type { OpenBotConfig } from "../../config/types.js";
import { buildLocalFolderIndexCatalogEntry } from "./builders.js";
import type { WorkspaceResourceCatalog } from "./catalog.js";
import { openWorkspaceResourceAccess, resolveWorkspaceResource } from "./resolve.js";
import type { WorkspaceResolveActor, WorkspaceResourceOperation } from "./types.js";

const MAX_LOCAL_INDEX_PREVIEW_BYTES = 20 * 1024 * 1024;

export type ReadLocalIndexDocumentParams = {
  catalog: WorkspaceResourceCatalog;
  cfg?: OpenBotConfig;
  actor: WorkspaceResolveActor;
  tenantId: string;
  userId: string;
  bindingId: string;
  workspaceRoot: string;
  relativePath: string;
  operation?: WorkspaceResourceOperation;
  maxBytes?: number;
  purpose?: string;
};

export type LocalIndexDocumentReadResult =
  | {
      ok: true;
      buffer: Buffer;
      byteLength: number;
      resourceId: string;
      bindingId: string;
    }
  | {
      ok: false;
      reason: string;
    };

function mergeCatalogWithEntry(
  catalog: WorkspaceResourceCatalog,
  entry: ReturnType<typeof buildLocalFolderIndexCatalogEntry>,
): WorkspaceResourceCatalog {
  const snap = catalog.snapshot();
  if (snap.resources[entry.resource.resourceId]) {
    return catalog;
  }
  const merged = {
    ...snap,
    resources: { ...snap.resources, [entry.resource.resourceId]: entry.resource },
    bindings: { ...snap.bindings, [entry.binding.bindingId]: entry.binding },
  };
  return {
    snapshot: () => merged,
    getResource: (id: string) => merged.resources[id] ?? null,
    getBinding: (id: string) => merged.bindings[id] ?? null,
    listBindingsForResource: (resourceId: string) =>
      Object.values(merged.bindings).filter((binding) => binding.resourceId === resourceId),
  };
}

/**
 * Handler integration helper (P0-c preview): read local_index folder document via resolver.
 */
export function readLocalIndexDocumentContent(
  params: ReadLocalIndexDocumentParams,
): LocalIndexDocumentReadResult {
  const entry = buildLocalFolderIndexCatalogEntry({
    tenantId: params.tenantId,
    userId: params.userId,
    bindingId: params.bindingId,
    workspaceRoot: params.workspaceRoot,
  });
  const catalog = mergeCatalogWithEntry(params.catalog, entry);
  const operation = params.operation ?? "preview";

  const resolved = resolveWorkspaceResource({
    catalog,
    cfg: params.cfg,
    actor: params.actor,
    resourceId: entry.resource.resourceId,
    operation,
    purpose: params.purpose ?? "knowledge.document.preview",
  });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }

  const access = openWorkspaceResourceAccess({ catalog, resolved });
  if (!access) {
    return { ok: false, reason: "binding_not_found" };
  }

  const stat = access.statRelativeFile(params.relativePath);
  if (!stat) {
    return { ok: false, reason: "file_not_found" };
  }
  const maxBytes = params.maxBytes ?? MAX_LOCAL_INDEX_PREVIEW_BYTES;
  if (stat.size > maxBytes) {
    return { ok: false, reason: "file_too_large" };
  }

  const buffer = access.readRelativeFile(params.relativePath);
  if (!buffer) {
    return { ok: false, reason: "file_not_found" };
  }

  return {
    ok: true,
    buffer,
    byteLength: stat.size,
    resourceId: resolved.resourceId,
    bindingId: resolved.bindingId,
  };
}
