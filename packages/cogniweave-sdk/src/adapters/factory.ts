import type { EngineConfig } from "../models.js";
import {
  InMemoryGraphStore,
  InMemoryMetadataStore,
  InMemoryVectorStore,
} from "../storage/in-memory.js";
import type { GraphStore, MetadataStore, VectorStore } from "../storage/types.js";
import type { AdapterResolution } from "./contracts.js";
import { PlaceholderGraphStore } from "./graph.js";
import { LocalMetadataStore } from "./local-metadata.js";
import { PlaceholderMetadataStore } from "./metadata.js";
import { Neo4jGraphStore } from "./neo4j-graph.js";
import { PgVectorStore } from "./pgvector-vector.js";
import { PostgresMetadataStore } from "./postgres-metadata.js";
import { PlaceholderVectorStore } from "./vector.js";

export interface AdapterBundle {
  metadataStore: MetadataStore;
  graphStore: GraphStore;
  vectorStore: VectorStore;
  resolutions: AdapterResolution[];
}

function createMetadataStore(config: EngineConfig): MetadataStore {
  if (config.metadataBackend === "memory") {
    return new InMemoryMetadataStore();
  }
  if (config.metadataBackend === "local") {
    return new LocalMetadataStore({
      backend: config.metadataBackend,
      environment: config.environment,
      path: requireMetadataStorePath(config),
    });
  }
  if (config.metadataBackend === "postgres") {
    if (config.postgres?.connectionString && !config.postgres.client) {
      throw new Error(
        'metadataBackend "postgres" with connectionString requires an injected client; call createPgSqlClient() and pass config.postgres.client',
      );
    }
    return new PostgresMetadataStore({
      backend: config.metadataBackend,
      environment: config.environment,
      client: config.postgres?.client,
      schema: config.postgres?.schema,
    });
  }
  return new PlaceholderMetadataStore({
    backend: config.metadataBackend,
    environment: config.environment,
  });
}

export function createAdapterBundle(config: EngineConfig): AdapterBundle {
  const metadataStore = createMetadataStore(config);

  const graphStore =
    config.graphBackend === "memory"
      ? new InMemoryGraphStore()
      : config.graphBackend === "neo4j" || config.graphBackend === "memgraph"
        ? new Neo4jGraphStore({
            backend: config.graphBackend,
            environment: config.environment,
          })
        : new PlaceholderGraphStore({
            backend: config.graphBackend,
            environment: config.environment,
          });

  const vectorBackend = config.vectorBackend ?? "memory";
  const vectorStore =
    vectorBackend === "memory"
      ? new InMemoryVectorStore()
      : vectorBackend === "pgvector"
        ? new PgVectorStore({
            backend: vectorBackend,
            environment: config.environment,
          })
        : new PlaceholderVectorStore({
            backend: vectorBackend,
            environment: config.environment,
          });

  return {
    metadataStore,
    graphStore,
    vectorStore,
    resolutions: [
      {
        descriptor: {
          kind: "metadata",
          backend: config.metadataBackend,
          environment: config.environment,
          capabilities:
            config.metadataBackend === "memory"
              ? ["read", "write", "journal"]
              : config.metadataBackend === "local"
                ? [
                    "canonical-read",
                    "canonical-write",
                    "journal",
                    "schema-bootstrap",
                    "restart-safe",
                  ]
                : config.metadataBackend === "postgres"
                  ? ["canonical-read", "canonical-write", "journal", "schema-bootstrap"]
                  : [],
        },
        implementation:
          config.metadataBackend === "memory"
            ? "in-memory"
            : config.metadataBackend === "local"
              ? "local-sqlite"
              : config.metadataBackend === "postgres"
                ? "sql-first"
                : "placeholder",
      },
      {
        descriptor: {
          kind: "graph",
          backend: config.graphBackend,
          environment: config.environment,
          capabilities:
            config.graphBackend === "memory"
              ? ["sync", "rebuild"]
              : config.graphBackend === "neo4j" || config.graphBackend === "memgraph"
                ? ["derived-sync", "derived-rebuild", "path-query", "schema-bootstrap"]
                : [],
        },
        implementation:
          config.graphBackend === "memory"
            ? "in-memory"
            : config.graphBackend === "neo4j" || config.graphBackend === "memgraph"
              ? "sql-first"
              : "placeholder",
      },
      {
        descriptor: {
          kind: "vector",
          backend: vectorBackend,
          environment: config.environment,
          capabilities:
            vectorBackend === "memory"
              ? ["sync", "rebuild"]
              : vectorBackend === "pgvector"
                ? ["seed-sync", "seed-rebuild", "similarity-search", "schema-bootstrap"]
                : [],
        },
        implementation:
          vectorBackend === "memory"
            ? "in-memory"
            : vectorBackend === "pgvector"
              ? "sql-first"
              : "placeholder",
      },
    ],
  };
}

function requireMetadataStorePath(config: EngineConfig): string {
  const storePath = config.metadataStorePath?.trim();
  if (!storePath) {
    throw new Error('metadataBackend "local" requires metadataStorePath');
  }
  return storePath;
}
