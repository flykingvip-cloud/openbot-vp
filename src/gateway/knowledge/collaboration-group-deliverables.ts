/**
 * Collaboration group `deliverables/` is the birth+archive SoT for 团队成果.
 * Reserved `folders/team-deliverables` is the same write-through copy personal
 * 成果 already uses; this reader fills the gap when only the group workspace exists.
 */
import fs from "node:fs";
import path from "node:path";
import { assertSafeTenantId, resolveTenantsRoot } from "../tenant-store-paths.js";
import { readGroupDeliverableManifest } from "./deliverables/group-manifest.js";
import { firstHumanDocumentTitle } from "./document-display-title.js";

export type CollaborationGroupDeliverableFile = {
  filename: string;
  title: string;
  deliverableId?: string;
  updatedAtMs: number;
  absolutePath: string;
};

function isActiveGroupWorkspaceDir(name: string): boolean {
  if (!name || name.startsWith(".")) {
    return false;
  }
  if (name.includes(".bak") || name.includes(".legacy-backup")) {
    return false;
  }
  return true;
}

function resolveGroupsRoot(tenantId: string, tenantsRoot?: string): string | null {
  try {
    assertSafeTenantId(tenantId);
  } catch {
    return null;
  }
  const root = tenantsRoot?.trim() || resolveTenantsRoot();
  return path.join(root, tenantId, "collaboration", "groups");
}

function basenameOf(value: string | undefined): string {
  return path.basename((value ?? "").replace(/\\/g, "/")).trim();
}

function indexManifestByFilename(
  workspacePath: string,
): Map<string, { title: string; deliverableId?: string; updatedAtMs?: number }> {
  const map = new Map<string, { title: string; deliverableId?: string; updatedAtMs?: number }>();
  const manifest = readGroupDeliverableManifest(workspacePath);
  for (const draft of Object.values(manifest.drafts ?? {})) {
    const names = [draft.workspaceFilename, draft.relativePath].map(basenameOf).filter(Boolean);
    for (const name of names) {
      map.set(name, {
        title: draft.title?.trim() || name,
        deliverableId: draft.deliverableId?.trim() || undefined,
        updatedAtMs: draft.updatedAtMs,
      });
    }
  }
  for (const canonical of Object.values(manifest.canonical ?? {})) {
    const name = basenameOf(canonical.relativePath);
    if (!name) {
      continue;
    }
    map.set(name, {
      title: name,
      deliverableId: canonical.deliverableId?.trim() || undefined,
      updatedAtMs: canonical.savedAtMs,
    });
  }
  return map;
}

/** Human-titled files in every live group `deliverables/` for this tenant. */
export function listCollaborationGroupDeliverableFiles(params: {
  tenantId?: string | null;
  tenantsRoot?: string;
}): CollaborationGroupDeliverableFile[] {
  const tenantId = params.tenantId?.trim();
  if (!tenantId) {
    return [];
  }
  const groupsRoot = resolveGroupsRoot(tenantId, params.tenantsRoot);
  if (!groupsRoot || !fs.existsSync(groupsRoot)) {
    return [];
  }
  let groupDirs: fs.Dirent[];
  try {
    groupDirs = fs.readdirSync(groupsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: CollaborationGroupDeliverableFile[] = [];
  const seen = new Set<string>();
  for (const entry of groupDirs) {
    if (!entry.isDirectory() || !isActiveGroupWorkspaceDir(entry.name)) {
      continue;
    }
    const workspacePath = path.join(groupsRoot, entry.name);
    const deliverablesDir = path.join(workspacePath, "deliverables");
    if (!fs.existsSync(deliverablesDir)) {
      continue;
    }
    let files: fs.Dirent[];
    try {
      files = fs.readdirSync(deliverablesDir, { withFileTypes: true });
    } catch {
      continue;
    }
    const metaByName = indexManifestByFilename(workspacePath);
    for (const file of files) {
      if (!file.isFile() || file.name.startsWith(".")) {
        continue;
      }
      if (firstHumanDocumentTitle(file.name) == null) {
        continue;
      }
      if (seen.has(file.name)) {
        continue;
      }
      const absolutePath = path.join(deliverablesDir, file.name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(absolutePath);
      } catch {
        continue;
      }
      if (!stat.isFile()) {
        continue;
      }
      const meta = metaByName.get(file.name);
      seen.add(file.name);
      out.push({
        filename: file.name,
        title: meta?.title || file.name,
        ...(meta?.deliverableId ? { deliverableId: meta.deliverableId } : {}),
        updatedAtMs: Math.trunc(meta?.updatedAtMs ?? stat.mtimeMs),
        absolutePath,
      });
    }
  }
  return out.toSorted((left, right) => left.filename.localeCompare(right.filename, "zh"));
}

export function readCollaborationGroupDeliverableFile(params: {
  tenantId?: string | null;
  tenantsRoot?: string;
  filename: string;
}): { filename: string; buffer: Buffer } | null {
  const wanted = path.basename(params.filename.replace(/\\/g, "/")).trim();
  if (!wanted) {
    return null;
  }
  const hit = listCollaborationGroupDeliverableFiles({
    tenantId: params.tenantId,
    tenantsRoot: params.tenantsRoot,
  }).find((file) => file.filename === wanted);
  if (!hit) {
    return null;
  }
  try {
    return {
      filename: hit.filename,
      buffer: fs.readFileSync(hit.absolutePath),
    };
  } catch {
    return null;
  }
}
