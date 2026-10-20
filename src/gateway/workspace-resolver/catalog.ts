import type {
  WorkspaceBindingRecord,
  WorkspaceCatalogStatus,
  WorkspaceResourceCatalogSnapshot,
  WorkspaceResourceRecord,
} from "./types.js";

export type WorkspaceResourceCatalog = {
  snapshot(): WorkspaceResourceCatalogSnapshot;
  getResource(resourceId: string): WorkspaceResourceRecord | null;
  getBinding(bindingId: string): WorkspaceBindingRecord | null;
  listBindingsForResource(resourceId: string): WorkspaceBindingRecord[];
};

export class InMemoryWorkspaceResourceCatalog implements WorkspaceResourceCatalog {
  constructor(private readonly data: WorkspaceResourceCatalogSnapshot) {}

  snapshot(): WorkspaceResourceCatalogSnapshot {
    return this.data;
  }

  getResource(resourceId: string): WorkspaceResourceRecord | null {
    return this.data.resources[resourceId] ?? null;
  }

  getBinding(bindingId: string): WorkspaceBindingRecord | null {
    return this.data.bindings[bindingId] ?? null;
  }

  listBindingsForResource(resourceId: string): WorkspaceBindingRecord[] {
    return Object.values(this.data.bindings).filter((binding) => binding.resourceId === resourceId);
  }
}

export function createEmptyWorkspaceCatalog(params?: {
  governanceVersion?: number;
  status?: WorkspaceCatalogStatus;
}): InMemoryWorkspaceResourceCatalog {
  return new InMemoryWorkspaceResourceCatalog({
    governanceVersion: params?.governanceVersion ?? 1,
    status: params?.status ?? "available",
    resources: {},
    bindings: {},
  });
}

export function withCatalogEntries(
  catalog: InMemoryWorkspaceResourceCatalog,
  entries: {
    resource: WorkspaceResourceRecord;
    binding: WorkspaceBindingRecord;
  },
): InMemoryWorkspaceResourceCatalog {
  const snap = catalog.snapshot();
  return new InMemoryWorkspaceResourceCatalog({
    ...snap,
    resources: { ...snap.resources, [entries.resource.resourceId]: entries.resource },
    bindings: { ...snap.bindings, [entries.binding.bindingId]: entries.binding },
  });
}
