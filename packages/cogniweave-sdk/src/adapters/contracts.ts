import type { EngineEnvironment } from "../models.js";

export type AdapterKind = "metadata" | "graph" | "vector" | "evidence";

export interface AdapterDescriptor {
  kind: AdapterKind;
  backend: string;
  environment: EngineEnvironment;
  capabilities: string[];
}

export interface BackendAdapterConfig {
  backend: string;
  environment: EngineEnvironment;
  options?: Record<string, string | number | boolean>;
}

export interface AdapterResolution {
  descriptor: AdapterDescriptor;
  implementation: "in-memory" | "local-sqlite" | "sql-first" | "placeholder";
}
