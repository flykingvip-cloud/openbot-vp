import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
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

export async function discoverCollaborationMemoryIndexRoots(
  cfg: OpenBotConfig,
): Promise<CollaborationMemoryIndexRoot[]> {
  const collaborationRoot = resolveConfiguredCollaborationWorkspaceRoot(cfg);
  if (!collaborationRoot) {
    return [];
  }
  const groupsRoot = path.join(collaborationRoot, "groups");
  const groupIds = await listGroupIds(groupsRoot);
  return groupIds.map((groupId) => {
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
): Promise<CollaborationMemoryIndexDoc[]> {
  const roots = await discoverCollaborationMemoryIndexRoots(cfg);
  const docs = await Promise.all(roots.map((root) => listCollaborationMemoryMarkdownDocs(root)));
  return docs.flat();
}

export type CollaborationQmdCollection = {
  name: string;
  path: string;
  pattern: string;
  kind: "memory";
};

export async function resolveCollaborationQmdCollections(params: {
  cfg: OpenBotConfig;
  agentId: string;
  existingNames: Set<string>;
  scopeCollectionBase: (base: string, agentId: string) => string;
  ensureUniqueName: (base: string, existing: Set<string>) => string;
}): Promise<CollaborationQmdCollection[]> {
  const roots = await discoverCollaborationMemoryIndexRoots(params.cfg);
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

export function resolveCollaborationQmdCollectionsSync(params: {
  cfg: OpenBotConfig;
  agentId: string;
  existingNames: Set<string>;
  scopeCollectionBase: (base: string, agentId: string) => string;
  ensureUniqueName: (base: string, existing: Set<string>) => string;
}): CollaborationQmdCollection[] {
  const collaborationRoot = resolveConfiguredCollaborationWorkspaceRoot(params.cfg);
  if (!collaborationRoot) {
    return [];
  }
  const groupsRoot = path.join(collaborationRoot, "groups");
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
