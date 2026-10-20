import fs from "node:fs";
import path from "node:path";

/** Default TTL for unpromoted group drafts (7 days). */
export const DEFAULT_GROUP_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type GroupDeliverableDraftEntry = {
  relativePath: string;
  title?: string;
  deliverableId?: string;
  workspaceFilename?: string;
  createdAtMs?: number;
  updatedAtMs: number;
};

export type PruneExpiredGroupDraftsResult = {
  prunedLogicalIds: string[];
  removedPaths: string[];
};

export type GroupDeliverableCanonicalEntry = {
  relativePath: string;
  deliverableId: string;
  knowledgeBaseId: string;
  knowledgeBaseTitle?: string;
  savedAtMs: number;
};

export type GroupDeliverableManifest = {
  version?: number;
  drafts?: Record<string, GroupDeliverableDraftEntry>;
  canonical?: Record<string, GroupDeliverableCanonicalEntry>;
};

export function slugifyLogicalId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "deliverable";
}

export function resolveLogicalId(params: {
  explicit?: string | null;
  title?: string | null;
  filename?: string | null;
}): string {
  const explicit = params.explicit?.trim();
  if (explicit) {
    return slugifyLogicalId(explicit);
  }
  const filename = params.filename?.trim();
  if (filename) {
    const basename = filename.split(/[\\/]/).pop()?.trim();
    if (basename) {
      const withoutExt = basename.replace(/\.[a-z0-9]+$/i, "").trim();
      if (withoutExt) {
        return slugifyLogicalId(withoutExt);
      }
    }
  }
  return slugifyLogicalId(params.title?.trim() || "deliverable");
}

export function groupManifestPath(workspacePath: string): string {
  return path.join(workspacePath, ".manifest.json");
}

export function emptyGroupDeliverableManifest(): GroupDeliverableManifest {
  return { version: 1, drafts: {}, canonical: {} };
}

export function parseGroupDeliverableManifestUtf8(raw: string): GroupDeliverableManifest {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return emptyGroupDeliverableManifest();
    }
    const record = parsed as GroupDeliverableManifest;
    return {
      version: typeof record.version === "number" ? record.version : 1,
      drafts: record.drafts ?? {},
      canonical: record.canonical ?? {},
    };
  } catch {
    return emptyGroupDeliverableManifest();
  }
}

export function readGroupDeliverableManifest(
  workspacePath: string,
  manifestPath: string = groupManifestPath(workspacePath),
): GroupDeliverableManifest {
  try {
    if (!fs.existsSync(manifestPath)) {
      return emptyGroupDeliverableManifest();
    }
    return parseGroupDeliverableManifestUtf8(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return emptyGroupDeliverableManifest();
  }
}

export function serializeGroupDeliverableManifestUtf8(manifest: GroupDeliverableManifest): string {
  return `${JSON.stringify({ version: 1, ...manifest }, null, 2)}\n`;
}

export function buildCanonicalUpsertManifest(
  manifest: GroupDeliverableManifest,
  params: {
    logicalId: string;
    relativePath: string;
    deliverableId: string;
    knowledgeBaseId: string;
    knowledgeBaseTitle?: string | null;
    savedAtMs?: number;
  },
): { manifest: GroupDeliverableManifest; draftRelativePathToRemove?: string } {
  const logicalId = slugifyLogicalId(params.logicalId);
  const next: GroupDeliverableManifest = {
    version: manifest.version ?? 1,
    drafts: { ...manifest.drafts },
    canonical: { ...manifest.canonical },
  };
  next.canonical![logicalId] = {
    relativePath: params.relativePath,
    deliverableId: params.deliverableId,
    knowledgeBaseId: params.knowledgeBaseId,
    ...(params.knowledgeBaseTitle?.trim()
      ? { knowledgeBaseTitle: params.knowledgeBaseTitle.trim() }
      : {}),
    savedAtMs: params.savedAtMs ?? Date.now(),
  };
  let draftRelativePathToRemove: string | undefined;
  const draftEntry = next.drafts?.[logicalId];
  if (draftEntry?.relativePath?.trim()) {
    draftRelativePathToRemove = draftEntry.relativePath;
    delete next.drafts?.[logicalId];
  }
  return { manifest: next, draftRelativePathToRemove };
}

export function buildDraftUpsertManifest(
  manifest: GroupDeliverableManifest,
  params: {
    logicalId: string;
    title: string;
    relativePath: string;
    workspaceFilename?: string | null;
    deliverableId?: string | null;
    nowMs?: number;
  },
): GroupDeliverableManifest {
  const logicalId = slugifyLogicalId(params.logicalId);
  const nowMs = params.nowMs ?? Date.now();
  const next: GroupDeliverableManifest = {
    version: manifest.version ?? 1,
    drafts: { ...manifest.drafts },
    canonical: { ...manifest.canonical },
  };
  const previous = next.drafts?.[logicalId];
  next.drafts![logicalId] = {
    relativePath: params.relativePath,
    title: params.title.trim() || undefined,
    deliverableId: params.deliverableId?.trim() || undefined,
    workspaceFilename: params.workspaceFilename?.trim() || undefined,
    createdAtMs: previous?.createdAtMs ?? nowMs,
    updatedAtMs: nowMs,
  };
  return next;
}

export function pruneExpiredDraftEntriesInManifest(
  manifest: GroupDeliverableManifest,
  params?: { nowMs?: number; ttlMs?: number },
): { manifest: GroupDeliverableManifest; prunedRelativePaths: string[] } {
  const nowMs = params?.nowMs ?? Date.now();
  const ttlMs = params?.ttlMs ?? DEFAULT_GROUP_DRAFT_TTL_MS;
  const drafts = { ...manifest.drafts };
  const prunedRelativePaths: string[] = [];

  for (const [logicalId, entry] of Object.entries(drafts)) {
    if (manifest.canonical?.[logicalId]) {
      continue;
    }
    const anchorMs = entry.updatedAtMs || entry.createdAtMs || 0;
    if (!anchorMs || nowMs - anchorMs <= ttlMs) {
      continue;
    }
    if (entry.relativePath?.trim()) {
      prunedRelativePaths.push(entry.relativePath);
    }
    delete drafts[logicalId];
  }

  return {
    manifest: { ...manifest, drafts },
    prunedRelativePaths,
  };
}

export function writeGroupDeliverableManifest(
  workspacePath: string,
  manifest: GroupDeliverableManifest,
  manifestPath: string = groupManifestPath(workspacePath),
): void {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, serializeGroupDeliverableManifestUtf8(manifest), "utf8");
}

export function resolveDraftRelativePath(logicalId: string): string {
  return `drafts/${slugifyLogicalId(logicalId)}/content.md`;
}

function removeDraftTree(workspacePath: string, relativePath: string): boolean {
  const target = path.join(workspacePath, relativePath);
  const draftDir = path.dirname(target);
  try {
    if (fs.existsSync(draftDir)) {
      fs.rmSync(draftDir, { recursive: true, force: true });
      return true;
    }
  } catch {
    // Best-effort hygiene; manifest pruning still proceeds.
  }
  return false;
}

export function pruneExpiredGroupDeliverableDrafts(params: {
  workspacePath: string;
  nowMs?: number;
  ttlMs?: number;
  manifestPath?: string;
}): PruneExpiredGroupDraftsResult {
  const nowMs = params.nowMs ?? Date.now();
  const ttlMs = params.ttlMs ?? DEFAULT_GROUP_DRAFT_TTL_MS;
  const manifestPath = params.manifestPath ?? groupManifestPath(params.workspacePath);
  const manifest = readGroupDeliverableManifest(params.workspacePath, manifestPath);
  const { manifest: nextManifest, prunedRelativePaths } = pruneExpiredDraftEntriesInManifest(
    manifest,
    { nowMs, ttlMs },
  );
  const prunedLogicalIds = Object.keys(manifest.drafts ?? {}).filter(
    (logicalId) => !(nextManifest.drafts ?? {})[logicalId],
  );
  const removedPaths: string[] = [];
  for (const relativePath of prunedRelativePaths) {
    if (removeDraftTree(params.workspacePath, relativePath)) {
      removedPaths.push(relativePath);
    }
  }

  if (prunedLogicalIds.length > 0) {
    writeGroupDeliverableManifest(params.workspacePath, nextManifest, manifestPath);
  }
  return { prunedLogicalIds, removedPaths };
}

/**
 * Birth-path identity: `file=` / save filename is the workspace relative path.
 * Do not strip directories or force `deliverables/`. Untitled captures without a
 * filename still land under `deliverables/{logicalId}.md`.
 */
export function resolveDeliverableRelativePath(params: {
  logicalId: string;
  title?: string | null;
  filename?: string | null;
}): string {
  const logicalId = slugifyLogicalId(params.logicalId);
  const normalizedFilename = params.filename?.trim().replace(/\\/g, "/");
  if (normalizedFilename) {
    const segments = normalizedFilename.split("/").filter((segment) => segment.length > 0);
    if (
      segments.length > 0 &&
      !normalizedFilename.startsWith("/") &&
      !normalizedFilename.includes("\0") &&
      segments.every((segment) => segment !== ".." && segment !== ".")
    ) {
      return segments.join("/");
    }
  }
  return `deliverables/${logicalId}.md`;
}

export function upsertGroupDeliverableDraft(params: {
  workspacePath: string;
  logicalId: string;
  title: string;
  content: string;
  workspaceFilename?: string | null;
  deliverableId?: string | null;
}): { logicalId: string; relativePath: string } {
  const logicalId = slugifyLogicalId(params.logicalId);
  const relativePath = resolveDraftRelativePath(logicalId);
  const target = path.join(params.workspacePath, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, params.content.trim(), "utf8");

  const manifestPath = groupManifestPath(params.workspacePath);
  const manifest = readGroupDeliverableManifest(params.workspacePath, manifestPath);
  const nowMs = Date.now();
  const withDraft = buildDraftUpsertManifest(manifest, {
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
  for (const prunedPath of prunedRelativePaths) {
    removeDraftTree(params.workspacePath, prunedPath);
  }
  writeGroupDeliverableManifest(params.workspacePath, prunedManifest, manifestPath);
  return { logicalId, relativePath };
}

export function upsertGroupDeliverableCanonical(params: {
  workspacePath: string;
  logicalId: string;
  relativePath: string;
  deliverableId: string;
  knowledgeBaseId: string;
  knowledgeBaseTitle?: string | null;
}): void {
  const manifestPath = groupManifestPath(params.workspacePath);
  const manifest = readGroupDeliverableManifest(params.workspacePath, manifestPath);
  const { manifest: nextManifest, draftRelativePathToRemove } = buildCanonicalUpsertManifest(
    manifest,
    params,
  );
  if (draftRelativePathToRemove?.trim()) {
    removeDraftTree(params.workspacePath, draftRelativePathToRemove);
  }
  writeGroupDeliverableManifest(params.workspacePath, nextManifest, manifestPath);
}
