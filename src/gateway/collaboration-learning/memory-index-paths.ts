import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveTrustedCollaborationGroupsRoot } from "../workspace/group-locator.js";
import {
  resolveConfiguredCollaborationWorkspaceRoot,
  resolveGroupWorkspacePath,
} from "./shared.js";

export type CollaborationMemoryIndexRoot = {
  groupId: string;
  memoryDir: string;
  indexPrefix: string;
  sessionKey: string;
};

export type CollaborationMemoryIndexDoc = {
  groupId: string;
  absPath: string;
  relPath: string;
  text: string;
  sessionKey: string;
};

async function listGroupIds(groupRootDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(groupRootDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        try {
          return decodeURIComponent(entry.name);
        } catch {
          return entry.name;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export type DiscoverCollaborationMemoryIndexRootsOptions = {
  /** When set, only these group ids are returned (empty set → no roots). */
  authorizedGroupIds?: ReadonlySet<string> | readonly string[];
  tenantId?: string | null;
  profile?: "personal_local" | "managed_enterprise";
};

function normalizeAuthorizedGroupIdSet(
  value: ReadonlySet<string> | readonly string[] | undefined,
): Set<string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof Set) {
    return value;
  }
  return new Set([...value].map((id) => id.trim()).filter(Boolean));
}

/**
 * Discover collaboration memory roots.
 *
 * Pass `authorizedGroupIds` so callers (builtin index) never dump every group's
 * markdown into every agent index. Managed tenants may pass tenantId+profile so
 * roots resolve under `tenants/<tid>/collaboration/groups` instead of the
 * personal collaboration workspace.
 */
export async function discoverCollaborationMemoryIndexRoots(
  cfg: OpenBotConfig,
  options?: DiscoverCollaborationMemoryIndexRootsOptions,
): Promise<CollaborationMemoryIndexRoot[]> {
  const authorized = normalizeAuthorizedGroupIdSet(options?.authorizedGroupIds);
  if (authorized && authorized.size === 0) {
    return [];
  }

  let groupsRoot: string;
  const profile = options?.profile ?? "personal_local";
  const tenantId = options?.tenantId?.trim() || null;
  if (profile === "managed_enterprise") {
    if (!tenantId) {
      return [];
    }
    groupsRoot = resolveTrustedCollaborationGroupsRoot({
      tenantId,
      profile: "managed_enterprise",
      cfg,
    });
  } else {
    const collaborationRoot = resolveConfiguredCollaborationWorkspaceRoot(cfg);
    if (!collaborationRoot) {
      return [];
    }
    groupsRoot = path.join(collaborationRoot, "groups");
  }

  const groupIds = await listGroupIds(groupsRoot);
  return groupIds
    .filter((groupId) => (authorized ? authorized.has(groupId) : true))
    .map((groupId) => {
      const groupDir = resolveGroupWorkspacePath(groupsRoot, groupId);
      return {
        groupId,
        memoryDir: path.join(groupDir, "memory"),
        indexPrefix: `collaboration/${groupId}/memory`,
        sessionKey: `space:${groupId}`,
      };
    });
}

export async function listCollaborationMemoryMarkdownDocs(
  root: CollaborationMemoryIndexRoot,
): Promise<CollaborationMemoryIndexDoc[]> {
  const docs: CollaborationMemoryIndexDoc[] = [];

  async function walk(dir: string, relBase: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absPath = path.join(dir, entry.name);
      const relPath = path.posix.join(relBase, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath, relPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
        continue;
      }
      try {
        const text = await fs.readFile(absPath, "utf8");
        docs.push({
          groupId: root.groupId,
          absPath,
          relPath,
          text,
          sessionKey: root.sessionKey,
        });
      } catch {
        // skip unreadable files
      }
    }
  }

  await walk(root.memoryDir, root.indexPrefix);
  return docs;
}

export async function listAllCollaborationMemoryMarkdownDocs(
  cfg: OpenBotConfig,
  options?: DiscoverCollaborationMemoryIndexRootsOptions,
): Promise<CollaborationMemoryIndexDoc[]> {
  const roots = await discoverCollaborationMemoryIndexRoots(cfg, options);
  const docs = await Promise.all(roots.map((root) => listCollaborationMemoryMarkdownDocs(root)));
  return docs.flat();
}

export type CollaborationQmdCollection = {
  name: string;
  path: string;
  pattern: string;
  kind: "memory";
};

export type ResolveCollaborationQmdCollectionsParams = {
  cfg: OpenBotConfig;
  agentId: string;
  existingNames: Set<string>;
  scopeCollectionBase: (base: string, agentId: string) => string;
  ensureUniqueName: (base: string, existing: Set<string>) => string;
  /**
   * Membership / tenant filter. When omitted, default deny (no all-groups dump).
   * Pass an empty set to explicitly index no collaboration collections.
   */
  authorizedGroupIds?: ReadonlySet<string> | readonly string[];
  tenantId?: string | null;
  profile?: "personal_local" | "managed_enterprise";
};

/**
 * QMD collaboration collections — same authorizedGroupIds / tenant-scoped roots
 * filter as builtin. Missing authz context → no collections (fail closed).
 */
export async function resolveCollaborationQmdCollections(
  params: ResolveCollaborationQmdCollectionsParams,
): Promise<CollaborationQmdCollection[]> {
  // Default deny: never dump every group's memory into every agent QMD index.
  if (params.authorizedGroupIds === undefined) {
    return [];
  }
  const roots = await discoverCollaborationMemoryIndexRoots(params.cfg, {
    authorizedGroupIds: params.authorizedGroupIds,
    tenantId: params.tenantId,
    profile: params.profile,
  });
  const collections: CollaborationQmdCollection[] = [];
  for (const root of roots) {
    const base = params.scopeCollectionBase(`collab-${root.groupId}`, params.agentId);
    const name = params.ensureUniqueName(base, params.existingNames);
    params.existingNames.add(name);
    collections.push({
      name,
      path: root.memoryDir,
      pattern: "**/*.md",
      kind: "memory",
    });
  }
  return collections;
}

export function resolveCollaborationQmdCollectionsSync(
  params: ResolveCollaborationQmdCollectionsParams,
): CollaborationQmdCollection[] {
  // Default deny: missing authz context must not enumerate all groups.
  if (params.authorizedGroupIds === undefined) {
    return [];
  }
  const authorized = normalizeAuthorizedGroupIdSet(params.authorizedGroupIds);
  if (!authorized || authorized.size === 0) {
    return [];
  }

  const profile = params.profile ?? "personal_local";
  const tenantId = params.tenantId?.trim() || null;
  let groupsRoot: string;
  if (profile === "managed_enterprise") {
    if (!tenantId) {
      return [];
    }
    groupsRoot = resolveTrustedCollaborationGroupsRoot({
      tenantId,
      profile: "managed_enterprise",
      cfg: params.cfg,
    });
  } else {
    const collaborationRoot = resolveConfiguredCollaborationWorkspaceRoot(params.cfg);
    if (!collaborationRoot) {
      return [];
    }
    groupsRoot = path.join(collaborationRoot, "groups");
  }

  let entries: fsSync.Dirent[];
  try {
    entries = fsSync.readdirSync(groupsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const collections: CollaborationQmdCollection[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const groupId = (() => {
      try {
        return decodeURIComponent(entry.name);
      } catch {
        return entry.name;
      }
    })();
    if (!authorized.has(groupId)) {
      continue;
    }
    const memoryDir = path.join(groupsRoot, entry.name, "memory");
    if (!fsSync.existsSync(memoryDir)) {
      continue;
    }
    const base = params.scopeCollectionBase(`collab-${groupId}`, params.agentId);
    const name = params.ensureUniqueName(base, params.existingNames);
    params.existingNames.add(name);
    collections.push({
      name,
      path: memoryDir,
      pattern: "**/*.md",
      kind: "memory",
    });
  }
  return collections;
}
