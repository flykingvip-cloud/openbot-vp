import { StorageConsistencyError } from "../errors.js";
import type { DistillationResult } from "../models.js";
import type { MetadataBundle, VectorStore } from "../storage/types.js";
import type { AdapterDescriptor, BackendAdapterConfig } from "./contracts.js";

function notImplemented(backend: string, method: string): never {
  throw new StorageConsistencyError(`Vector backend "${backend}" does not implement ${method}`);
}

export class PlaceholderVectorStore implements VectorStore {
  descriptor: AdapterDescriptor;

  constructor(config: BackendAdapterConfig) {
    this.descriptor = {
      kind: "vector",
      backend: config.backend,
      environment: config.environment,
      capabilities: [],
    };
  }

  async syncFromDistillation(_result: DistillationResult): Promise<{ documentCount: number }> {
    return notImplemented(this.descriptor.backend, "syncFromDistillation");
  }

  async rebuildFromBundle(_bundle: MetadataBundle): Promise<{ documentCount: number }> {
    return notImplemented(this.descriptor.backend, "rebuildFromBundle");
  }
}
