import { createAdapterBundle } from "../adapters/factory.js";
import type { EngineConfig } from "../models.js";
import {
  createCogniWeaveHttpServer,
  type CogniWeaveHttpServerOptions,
} from "../rest/node-server.js";
import { CogniWeaveRestService } from "../rest/service.js";
import { InMemoryCogniWeaveEngine } from "./in-memory-engine.js";

export interface CogniWeaveRuntime {
  config: EngineConfig;
  engine: InMemoryCogniWeaveEngine;
  service: CogniWeaveRestService;
  server: ReturnType<typeof createCogniWeaveHttpServer>;
}

export interface CreateCogniWeaveRuntimeOptions {
  http?: CogniWeaveHttpServerOptions;
}

export function createCogniWeaveRuntime(
  config: EngineConfig,
  options?: CreateCogniWeaveRuntimeOptions,
): CogniWeaveRuntime {
  const bundle = createAdapterBundle(config);
  const engine = new InMemoryCogniWeaveEngine(config, {
    metadataStore: bundle.metadataStore,
    graphStore: bundle.graphStore,
    vectorStore: bundle.vectorStore,
  });
  const service = new CogniWeaveRestService(engine);
  const server = createCogniWeaveHttpServer(service, options?.http);

  return {
    config,
    engine,
    service,
    server,
  };
}
