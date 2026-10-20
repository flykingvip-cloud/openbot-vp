import { StorageConsistencyError } from "../errors.js";
import type { DistillationResult } from "../models.js";
import type { GraphStore, MetadataBundle } from "../storage/types.js";
import type { AdapterDescriptor, BackendAdapterConfig } from "./contracts.js";

function notImplemented(backend: string, method: string): never {
  throw new StorageConsistencyError(`Graph backend "${backend}" does not implement ${method}`);
}

export class PlaceholderGraphStore implements GraphStore {
  descriptor: AdapterDescriptor;

  constructor(config: BackendAdapterConfig) {
    this.descriptor = {
      kind: "graph",
      backend: config.backend,
      environment: config.environment,
      capabilities: [],
    };
  }

  async syncFromDistillation(
    _result: DistillationResult,
  ): Promise<{ nodeCount: number; edgeCount: number }> {
    return notImplemented(this.descriptor.backend, "syncFromDistillation");
  }

  async rebuildFromBundle(
    _bundle: MetadataBundle,
  ): Promise<{ nodeCount: number; edgeCount: number }> {
    return notImplemented(this.descriptor.backend, "rebuildFromBundle");
  }
}
