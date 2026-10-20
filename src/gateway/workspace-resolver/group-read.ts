import fs from "node:fs";
import type { OpenBotConfig } from "../../config/types.js";
import type { GroupDeliverableManifest } from "../knowledge/deliverables/group-manifest.js";
import {
  buildCanonicalUpsertManifest,
  buildDraftUpsertManifest,
  emptyGroupDeliverableManifest,
  parseGroupDeliverableManifestUtf8,
  pruneExpiredDraftEntriesInManifest,
  resolveDraftRelativePath,
  serializeGroupDeliverableManifestUtf8,
  slugifyLogicalId,
} from "../knowledge/deliverables/group-manifest.js";
import { listActiveCutoverOperationsForResource } from "../workspace-cutover/runtime.js";
import type { WorkspaceCutoverStore } from "../workspace-cutover/store.js";
import { WorkspaceResourceAccess } from "./access.js";
import { buildGroupWorkspaceCatalogEntry, buildWorkspaceResourceId } from "./builders.js";
import { WorkspaceResolverCache } from "./cache.js";
import type { WorkspaceResourceCatalog } from "./catalog.js";
import {
  invalidateWorkspaceResourceCacheAfterWrite,
  openWorkspaceResourceAccess,
  resolveWorkspaceResource,
} from "./resolve.js";
import type { WorkspaceResolveActor, WorkspaceResourceOperation } from "./types.js";

export const GROUP_WORKSPACE_MANIFEST_RELATIVE_PATH = ".manifest.json";
const MAX_GROUP_MANIFEST_BYTES = 1_000_000;

export type ResolveGroupWorkspaceFileAccessParams = {
  catalog: WorkspaceResourceCatalog;
  cfg?: OpenBotConfig;
  actor: WorkspaceResolveActor;
  tenantId: string;
  groupId: string;
  /** Authoritative group workspace root from collaboration paths (server-resolved). */
  workspaceRoot: string;
  relativePath: string;
  operation?: WorkspaceResourceOperation;
  maxBytes?: number;
  /** Audit purpose; defaults to workbench.group-file.read */
  purpose?: string;
  /** When set, active cutover ops for this group are loaded and enforced on writes. */
  cutoverStore?: WorkspaceCutoverStore;
};

export type GroupWorkspaceFileAccessResult =
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

/** Personal/local sessions may lack enterprise tenantId; use a stable sentinel for catalog partition. */
export function resolveWorkspaceActorTenantId(tenantId: string | null | undefined): string {
  const trimmed = tenantId?.trim();
  return trimmed || "personal-local";
}

function cutoverOperationsForGroup(params: {
  cutoverStore?: WorkspaceCutoverStore;
  tenantId: string;
  groupId: string;
}) {
  if (!params.cutoverStore) {
    return undefined;
  }
  const resourceId = buildWorkspaceResourceId({
    tenantId: params.tenantId,
    scope: { kind: "group_owned", groupId: params.groupId },
  });
  const operations = listActiveCutoverOperationsForResource(params.cutoverStore, resourceId);
  return operations.length > 0 ? operations : undefined;
}

function mergeCatalogWithEntry(
  catalog: WorkspaceResourceCatalog,
  entry: ReturnType<typeof buildGroupWorkspaceCatalogEntry>,
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
 * Handler integration helper (P0-c checkpoint 2): resolve group workspace file access
 * through the catalog + resolver without concatenating tenant/user/group path segments.
 */
export function readGroupWorkspaceFileContent(
  params: ResolveGroupWorkspaceFileAccessParams,
): GroupWorkspaceFileAccessResult {
  const entry = buildGroupWorkspaceCatalogEntry({
    tenantId: params.tenantId,
    groupId: params.groupId,
    workspaceRoot: params.workspaceRoot,
  });
  const catalog = mergeCatalogWithEntry(params.catalog, entry);
  const operation = params.operation ?? "read";

  const resolved = resolveWorkspaceResource({
    catalog,
    cfg: params.cfg,
    actor: params.actor,
    resourceId: entry.resource.resourceId,
    operation,
    purpose: params.purpose ?? "workbench.group-file.read",
    cutoverOperations: cutoverOperationsForGroup(params),
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
  if (params.maxBytes != null && stat.size > params.maxBytes) {
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

export type ListGroupWorkspaceRelativeDirParams = Omit<
  ResolveGroupWorkspaceFileAccessParams,
  "relativePath" | "maxBytes" | "operation"
> & {
  relativeDir?: string;
};

export type GroupWorkspaceListResult =
  | { ok: true; entries: string[]; resourceId: string; bindingId: string }
  | { ok: false; reason: string };

/**
 * Handler integration helper (P0-c list): list a directory under group workspace via resolver.
 */
export function listGroupWorkspaceRelativeDir(
  params: ListGroupWorkspaceRelativeDirParams,
): GroupWorkspaceListResult {
  const entry = buildGroupWorkspaceCatalogEntry({
    tenantId: params.tenantId,
    groupId: params.groupId,
    workspaceRoot: params.workspaceRoot,
  });
  const catalog = mergeCatalogWithEntry(params.catalog, entry);

  const resolved = resolveWorkspaceResource({
    catalog,
    cfg: params.cfg,
    actor: params.actor,
    resourceId: entry.resource.resourceId,
    operation: "list",
    purpose: params.purpose ?? "workbench.group-file.list",
    cutoverOperations: cutoverOperationsForGroup(params),
  });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }

  const access = openWorkspaceResourceAccess({ catalog, resolved });
  if (!access) {
    return { ok: false, reason: "binding_not_found" };
  }

  const relativeDir = params.relativeDir?.trim() ?? "";
  const entries = access.listRelativeDir(relativeDir);
  if (entries == null) {
    return { ok: false, reason: "list_denied" };
  }

  return {
    ok: true,
    entries,
    resourceId: resolved.resourceId,
    bindingId: resolved.bindingId,
  };
}

export type GroupWorkspaceManifestReadResult =
  | {
      ok: true;
      manifest: GroupDeliverableManifest;
      resourceId: string;
      bindingId: string;
      missing: boolean;
    }
  | {
      ok: false;
      reason: string;
    };

/**
 * Handler integration helper (P0-c): read group deliverable manifest through resolver.
 * Missing manifest returns an empty document (same semantics as readGroupDeliverableManifest).
 */
export function readGroupWorkspaceManifestContent(
  params: Omit<ResolveGroupWorkspaceFileAccessParams, "relativePath" | "maxBytes">,
): GroupWorkspaceManifestReadResult {
  const file = readGroupWorkspaceFileContent({
    ...params,
    relativePath: GROUP_WORKSPACE_MANIFEST_RELATIVE_PATH,
    maxBytes: MAX_GROUP_MANIFEST_BYTES,
    operation: params.operation ?? "read",
    purpose: "workbench.group-manifest.read",
  });
  if (!file.ok) {
    if (file.reason === "file_not_found") {
      return {
        ok: true,
        manifest: emptyGroupDeliverableManifest(),
        resourceId: "",
        bindingId: "",
        missing: true,
      };
    }
    return { ok: false, reason: file.reason };
  }
  return {
    ok: true,
    manifest: parseGroupDeliverableManifestUtf8(file.buffer.toString("utf8")),
    resourceId: file.resourceId,
    bindingId: file.bindingId,
    missing: false,
  };
}

/** @deprecated Use readGroupWorkspaceFileContent */
export function resolveGroupWorkspaceFileAccess(
  params: ResolveGroupWorkspaceFileAccessParams,
): GroupWorkspaceFileAccessResult {
  return readGroupWorkspaceFileContent(params);
}

export type WriteGroupWorkspaceRelativeFileParams = Omit<
  ResolveGroupWorkspaceFileAccessParams,
  "relativePath" | "maxBytes" | "operation"
> & {
  relativePath: string;
  content: string;
  cache?: WorkspaceResolverCache;
};

export type GroupWorkspaceWriteResult =
  | { ok: true; resourceId: string; bindingId: string }
  | { ok: false; reason: string };

export type OpenGroupWorkspaceWriteAccessParams = Omit<
  ResolveGroupWorkspaceFileAccessParams,
  "relativePath" | "maxBytes" | "operation"
> & {
  cache?: WorkspaceResolverCache;
};

export type OpenGroupWorkspaceWriteAccessResult =
  | {
      ok: true;
      access: WorkspaceResourceAccess;
      catalog: WorkspaceResourceCatalog;
      resourceId: string;
      bindingId: string;
    }
  | { ok: false; reason: string };

function openGroupWorkspaceWriteAccess(
  params: OpenGroupWorkspaceWriteAccessParams,
): OpenGroupWorkspaceWriteAccessResult {
  const entry = buildGroupWorkspaceCatalogEntry({
    tenantId: params.tenantId,
    groupId: params.groupId,
    workspaceRoot: params.workspaceRoot,
  });
  const catalog = mergeCatalogWithEntry(params.catalog, entry);
  const resolved = resolveWorkspaceResource({
    catalog,
    cache: params.cache,
    cfg: params.cfg,
    actor: params.actor,
    resourceId: entry.resource.resourceId,
    operation: "write",
    purpose: params.purpose ?? "workbench.group-file.write",
    cutoverOperations: cutoverOperationsForGroup(params),
  });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason };
  }
  const access = openWorkspaceResourceAccess({ catalog, resolved });
  if (!access) {
    return { ok: false, reason: "binding_not_found" };
  }
  return {
    ok: true,
    access,
    catalog,
    resourceId: resolved.resourceId,
    bindingId: resolved.bindingId,
  };
}

function finishGroupWorkspaceWrite(
  params: OpenGroupWorkspaceWriteAccessParams,
  resourceId: string,
  bindingId: string,
): GroupWorkspaceWriteResult {
  if (params.cache) {
    invalidateWorkspaceResourceCacheAfterWrite(params.cache, resourceId);
  }
  return { ok: true, resourceId, bindingId };
}

/**
 * Handler integration helper (P0-c write): write a UTF-8 file under group workspace via resolver.
 */
export function writeGroupWorkspaceRelativeFile(
  params: WriteGroupWorkspaceRelativeFileParams,
): GroupWorkspaceWriteResult {
  const opened = openGroupWorkspaceWriteAccess(params);
  if (!opened.ok) {
    return opened;
  }
  const wrote = opened.access.writeRelativeFileUtf8(params.relativePath, params.content);
  if (!wrote) {
    return { ok: false, reason: "write_failed" };
  }
  return finishGroupWorkspaceWrite(params, opened.resourceId, opened.bindingId);
}

export type WriteGroupWorkspaceManifestParams = OpenGroupWorkspaceWriteAccessParams & {
  manifest: GroupDeliverableManifest;
};

export function writeGroupWorkspaceManifestContent(
  params: WriteGroupWorkspaceManifestParams,
): GroupWorkspaceWriteResult {
  return writeGroupWorkspaceRelativeFile({
    ...params,
    relativePath: GROUP_WORKSPACE_MANIFEST_RELATIVE_PATH,
    content: serializeGroupDeliverableManifestUtf8(params.manifest),
    purpose: params.purpose ?? "workbench.group-manifest.write",
  });
}

export type UpsertGroupWorkspaceDeliverableCanonicalParams = OpenGroupWorkspaceWriteAccessParams & {
  logicalId: string;
  relativePath: string;
  deliverableId: string;
  knowledgeBaseId: string;
  knowledgeBaseTitle?: string | null;
};

/**
 * Pin a canonical deliverable entry in `.manifest.json` through resolver (read-modify-write).
 */
export function upsertGroupWorkspaceDeliverableCanonical(
  params: UpsertGroupWorkspaceDeliverableCanonicalParams,
): GroupWorkspaceWriteResult {
  const readResult = readGroupWorkspaceManifestContent({
    catalog: params.catalog,
    cfg: params.cfg,
    actor: params.actor,
    tenantId: params.tenantId,
    groupId: params.groupId,
    workspaceRoot: params.workspaceRoot,
    operation: "read",
  });
  if (!readResult.ok) {
    return { ok: false, reason: readResult.reason };
  }

  const { manifest: nextManifest, draftRelativePathToRemove } = buildCanonicalUpsertManifest(
    readResult.manifest,
    {
      logicalId: params.logicalId,
      relativePath: params.relativePath,
      deliverableId: params.deliverableId,
      knowledgeBaseId: params.knowledgeBaseId,
      knowledgeBaseTitle: params.knowledgeBaseTitle,
    },
  );

  const opened = openGroupWorkspaceWriteAccess({
    ...params,
    purpose: params.purpose ?? "workbench.group-manifest.write",
  });
  if (!opened.ok) {
    return opened;
  }

  if (draftRelativePathToRemove?.trim()) {
    opened.access.removeRelativeFileTree(draftRelativePathToRemove);
  }

  const wrote = opened.access.writeRelativeFileUtf8(
    GROUP_WORKSPACE_MANIFEST_RELATIVE_PATH,
    serializeGroupDeliverableManifestUtf8(nextManifest),
  );
  if (!wrote) {
    return { ok: false, reason: "write_failed" };
  }
  return finishGroupWorkspaceWrite(params, opened.resourceId, opened.bindingId);
}

export function ensureGroupWorkspaceWriteRoot(workspacePath: string): string {
  fs.mkdirSync(workspacePath, { recursive: true });
  try {
    return fs.realpathSync(workspacePath);
  } catch {
    return workspacePath;
  }
}

export type UpsertGroupWorkspaceDeliverableDraftParams = OpenGroupWorkspaceWriteAccessParams & {
  logicalId: string;
  title: string;
  content: string;
  workspaceFilename?: string | null;
  deliverableId?: string | null;
};

export type GroupWorkspaceDraftUpsertResult =
  | { ok: true; logicalId: string; relativePath: string; resourceId: string; bindingId: string }
  | { ok: false; reason: string };

/**
 * Write a group deliverable draft file + manifest entry through resolver.
 */
export function upsertGroupWorkspaceDeliverableDraft(
  params: UpsertGroupWorkspaceDeliverableDraftParams,
): GroupWorkspaceDraftUpsertResult {
  const logicalId = slugifyLogicalId(params.logicalId);
  const relativePath = resolveDraftRelativePath(logicalId);
  const contentWrite = writeGroupWorkspaceRelativeFile({
    ...params,
    relativePath,
    content: params.content.trim(),
    purpose: params.purpose ?? "workbench.group-draft.write",
  });
  if (!contentWrite.ok) {
    return contentWrite;
  }

  const readResult = readGroupWorkspaceManifestContent({
    catalog: params.catalog,
    cfg: params.cfg,
    actor: params.actor,
    tenantId: params.tenantId,
    groupId: params.groupId,
    workspaceRoot: params.workspaceRoot,
    operation: "read",
  });
  if (!readResult.ok) {
    return readResult;
  }

  const nowMs = Date.now();
  const withDraft = buildDraftUpsertManifest(readResult.manifest, {
    logicalId,
    title: params.title,
    relativePath,
    workspaceFilename: params.workspaceFilename,
    deliverableId: params.deliverableId,
    nowMs,
  });
  const { manifest: prunedManifest, prunedRelativePaths } = pruneExpiredDraftEntriesInManifest(
    withDraft,
    { nowMs },
  );

  const opened = openGroupWorkspaceWriteAccess({
    ...params,
    purpose: params.purpose ?? "workbench.group-manifest.write",
  });
  if (!opened.ok) {
    return opened;
  }

  for (const prunedPath of prunedRelativePaths) {
    opened.access.removeRelativeFileTree(prunedPath);
  }

  const wrote = opened.access.writeRelativeFileUtf8(
    GROUP_WORKSPACE_MANIFEST_RELATIVE_PATH,
    serializeGroupDeliverableManifestUtf8(prunedManifest),
  );
  if (!wrote) {
    return { ok: false, reason: "write_failed" };
  }

  const finished = finishGroupWorkspaceWrite(params, opened.resourceId, opened.bindingId);
  if (!finished.ok) {
    return finished;
  }
  return {
    ok: true,
    logicalId,
    relativePath,
    resourceId: finished.resourceId,
    bindingId: finished.bindingId,
  };
}

export type PruneGroupWorkspaceExpiredDraftsParams = OpenGroupWorkspaceWriteAccessParams & {
  nowMs?: number;
  ttlMs?: number;
};

export type PruneGroupWorkspaceExpiredDraftsResult =
  | {
      ok: true;
      prunedLogicalIds: string[];
      removedPaths: string[];
      manifestUpdated: boolean;
      resourceId?: string;
      bindingId?: string;
    }
  | { ok: false; reason: string };

/**
 * Prune expired group deliverable drafts (read-modify-write via resolver).
 * No-op when nothing expired.
 */
export function pruneGroupWorkspaceExpiredDrafts(
  params: PruneGroupWorkspaceExpiredDraftsParams,
): PruneGroupWorkspaceExpiredDraftsResult {
  const readResult = readGroupWorkspaceManifestContent({
    catalog: params.catalog,
    cfg: params.cfg,
    actor: params.actor,
    tenantId: params.tenantId,
    groupId: params.groupId,
    workspaceRoot: params.workspaceRoot,
    operation: "read",
  });
  if (!readResult.ok) {
    return readResult;
  }

  const nowMs = params.nowMs ?? Date.now();
  const beforeDrafts = readResult.manifest.drafts ?? {};
  const { manifest: nextManifest, prunedRelativePaths } = pruneExpiredDraftEntriesInManifest(
    readResult.manifest,
    { nowMs, ttlMs: params.ttlMs },
  );
  const prunedLogicalIds = Object.keys(beforeDrafts).filter(
    (logicalId) => !(nextManifest.drafts ?? {})[logicalId],
  );
  if (prunedLogicalIds.length === 0) {
    return {
      ok: true,
      prunedLogicalIds: [],
      removedPaths: [],
      manifestUpdated: false,
    };
  }

  const opened = openGroupWorkspaceWriteAccess({
    ...params,
    purpose: params.purpose ?? "workbench.group-manifest.prune",
  });
  if (!opened.ok) {
    return opened;
  }

  const removedPaths: string[] = [];
  for (const prunedPath of prunedRelativePaths) {
    if (opened.access.removeRelativeFileTree(prunedPath)) {
      removedPaths.push(prunedPath);
    }
  }

  const wrote = opened.access.writeRelativeFileUtf8(
    GROUP_WORKSPACE_MANIFEST_RELATIVE_PATH,
    serializeGroupDeliverableManifestUtf8(nextManifest),
  );
  if (!wrote) {
    return { ok: false, reason: "write_failed" };
  }

  const finished = finishGroupWorkspaceWrite(params, opened.resourceId, opened.bindingId);
  if (!finished.ok) {
    return finished;
  }

  return {
    ok: true,
    prunedLogicalIds,
    removedPaths,
    manifestUpdated: true,
    resourceId: finished.resourceId,
    bindingId: finished.bindingId,
  };
}
