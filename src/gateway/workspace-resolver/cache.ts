import type { WorkspaceResourceOperation } from "./types.js";

export type WorkspaceCacheKeyParts = {
  tenantId: string;
  principalId: string;
  resourceId: string;
  operation: WorkspaceResourceOperation;
  governanceVersion: number;
};

export type CachedWorkspaceAccess = {
  bindingId: string;
  rootPath: string;
  epoch: number;
};

export class WorkspaceResolverCache {
  private epoch = 0;
  private readonly entries = new Map<string, CachedWorkspaceAccess>();

  buildKey(parts: WorkspaceCacheKeyParts): string {
    return [
      parts.tenantId,
      parts.principalId,
      parts.resourceId,
      parts.operation,
      String(parts.governanceVersion),
    ].join("|");
  }

  get(key: string): CachedWorkspaceAccess | null {
    const hit = this.entries.get(key);
    if (!hit) {
      return null;
    }
    if (hit.epoch !== this.epoch) {
      this.entries.delete(key);
      return null;
    }
    return hit;
  }

  set(key: string, value: Omit<CachedWorkspaceAccess, "epoch">): void {
    this.entries.set(key, { ...value, epoch: this.epoch });
  }

  /** Call before a successful write cutover or mutation. */
  invalidateAll(): void {
    this.epoch += 1;
    this.entries.clear();
  }

  invalidateResource(resourceId: string): void {
    this.epoch += 1;
    for (const [key] of this.entries) {
      if (key.includes(`|${resourceId}|`)) {
        this.entries.delete(key);
      }
    }
  }
}
