/**
 * Authz scope for builtin collaboration indexing.
 *
 * Cache identity includes the caller and each root's memory directory, so two
 * tenants that reuse a group id do not share a manager. Non-empty root sets
 * also get a distinct sqlite file so one caller's sync cannot delete or
 * return another caller's chunks.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import type { ResolvedMemorySearchConfig } from "../agents/memory-search.js";
import type { CollaborationMemoryIndexRoot } from "../gateway/collaboration-learning/memory-index-paths.js";

export type CollaborationIndexIdentity = {
  userId?: string | null;
  tenantId?: string | null;
};

/** Stable identity of the authorized root set. Empty roots use "-". */
export function collaborationRootFingerprint(
  roots: readonly Pick<CollaborationMemoryIndexRoot, "groupId" | "memoryDir">[],
): string {
  if (roots.length === 0) {
    return "-";
  }
  return roots
    .map((root) => `${root.groupId}\0${root.memoryDir}`)
    .toSorted()
    .join("\n");
}

export function collaborationCacheKey(params: {
  agentId: string;
  workspaceDir: string;
  settingsJson: string;
  roots: readonly Pick<CollaborationMemoryIndexRoot, "groupId" | "memoryDir">[];
  identity?: CollaborationIndexIdentity | null;
}): string {
  const userId = params.identity?.userId?.trim() || "";
  const tenantId = params.identity?.tenantId?.trim() || "";
  const identity = userId || tenantId ? `${userId}/${tenantId}` : "-";
  return `${params.agentId}:${params.workspaceDir}:${params.settingsJson}:id:${identity}:collab:${collaborationRootFingerprint(params.roots)}`;
}

/** True when a caller identity is present and sibling managers may be revoked. */
export function collaborationIdentityActive(identity?: CollaborationIndexIdentity | null): boolean {
  return Boolean(identity?.userId?.trim() || identity?.tenantId?.trim());
}

export function collaborationCachePrefix(key: string): string {
  const marker = ":collab:";
  const index = key.lastIndexOf(marker);
  if (index < 0) {
    return key;
  }
  return key.slice(0, index + marker.length);
}

/**
 * Personal indexes (no collaboration roots) stay on the configured store path.
 * Authorized collaboration sets get a sibling sqlite so roots cannot collide.
 */
export function isolateCollaborationStorePath(
  storePath: string,
  roots: readonly Pick<CollaborationMemoryIndexRoot, "groupId" | "memoryDir">[],
): string {
  if (roots.length === 0) {
    return storePath;
  }
  const fingerprint = createHash("sha256")
    .update(collaborationRootFingerprint(roots))
    .digest("hex")
    .slice(0, 24);
  return path.join(path.dirname(storePath), "authz-scopes", fingerprint, path.basename(storePath));
}

export function withIsolatedCollaborationStore(
  settings: ResolvedMemorySearchConfig,
  roots: readonly Pick<CollaborationMemoryIndexRoot, "groupId" | "memoryDir">[],
): ResolvedMemorySearchConfig {
  if (roots.length === 0) {
    return settings;
  }
  return {
    ...settings,
    store: {
      ...settings.store,
      path: isolateCollaborationStorePath(settings.store.path, roots),
    },
  };
}
