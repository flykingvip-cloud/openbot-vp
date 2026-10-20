import { StorageConsistencyError } from "../errors.js";
import type { DistillationResult } from "../models.js";
import type { MetadataBundle, GraphStore } from "../storage/types.js";
import type { AdapterDescriptor, BackendAdapterConfig } from "./contracts.js";

export interface Neo4jQueryResult<Row = Record<string, unknown>> {
  records: Row[];
}

export interface Neo4jCypherTransaction {
  run<Row = Record<string, unknown>>(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<Neo4jQueryResult<Row>>;
}

export interface Neo4jCypherClient {
  run<Row = Record<string, unknown>>(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<Neo4jQueryResult<Row>>;
  transaction?<T>(runner: (transaction: Neo4jCypherTransaction) => Promise<T>): Promise<T>;
}

export interface Neo4jGraphStoreConfig extends BackendAdapterConfig {
  client?: Neo4jCypherClient;
  database?: string;
  namespace?: string;
}

export interface Neo4jGraphBootstrapResult {
  database?: string;
  statementsExecuted: number;
}

export interface Neo4jGraphDocument {
  id: string;
  label: string;
  properties: Record<string, unknown>;
}

export interface Neo4jGraphEdge {
  fromId: string;
  toId: string;
  relationType: string;
  properties: Record<string, unknown>;
}

const SCHEMA_STATEMENTS = [
  "CREATE CONSTRAINT memory_atom_id IF NOT EXISTS FOR (n:MemoryAtom) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT event_skeleton_id IF NOT EXISTS FOR (n:EventSkeleton) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (n:Entity) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT scenario_id IF NOT EXISTS FOR (n:Scenario) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT problem_id IF NOT EXISTS FOR (n:Problem) REQUIRE n.id IS UNIQUE",
  "CREATE CONSTRAINT evidence_id IF NOT EXISTS FOR (n:Evidence) REQUIRE n.id IS UNIQUE",
];

function requireResult<Row>(result: Neo4jQueryResult<Row>, method: string): Neo4jQueryResult<Row> {
  if (!Array.isArray(result.records)) {
    throw new StorageConsistencyError(
      `Neo4j graph adapter returned malformed records for ${method}`,
    );
  }
  return result;
}

function mergeDocumentProperties(properties: Record<string, unknown>): Record<string, unknown> {
  return { ...properties };
}

export function buildNeo4jGraphSchema(): string[] {
  return [...SCHEMA_STATEMENTS];
}

export class Neo4jGraphStore implements GraphStore {
  readonly descriptor: AdapterDescriptor;
  readonly database?: string;
  readonly namespace?: string;

  private readonly client?: Neo4jCypherClient;

  constructor(config: Neo4jGraphStoreConfig) {
    this.client = config.client;
    this.database = config.database;
    this.namespace = config.namespace;
    this.descriptor = {
      kind: "graph",
      backend: config.backend,
      environment: config.environment,
      capabilities: ["derived-sync", "derived-rebuild", "path-query", "schema-bootstrap"],
    };
  }

  getSchemaStatements(): string[] {
    return buildNeo4jGraphSchema();
  }

  async bootstrapSchema(): Promise<Neo4jGraphBootstrapResult> {
    const statements = this.getSchemaStatements();
    await this.runInTransaction(async (transaction) => {
      for (const statement of statements) {
        await transaction.run(statement, {});
      }
    });
    return {
      database: this.database,
      statementsExecuted: statements.length,
    };
  }

  async syncFromDistillation(
    result: DistillationResult,
  ): Promise<{ nodeCount: number; edgeCount: number }> {
    const nodes = this.buildDocuments(result);
    const edges = this.buildEdges(result);
    await this.runInTransaction(async (transaction) => {
      for (const node of nodes) {
        await transaction.run(
          `MERGE (n:${node.label} {id: $id})
           SET n += $properties`,
          {
            id: node.id,
            properties: mergeDocumentProperties(node.properties),
          },
        );
      }
      for (const edge of edges) {
        await transaction.run(
          `MATCH (from {id: $fromId})
           MATCH (to {id: $toId})
           MERGE (from)-[r:${edge.relationType}]->(to)
           SET r += $properties`,
          {
            fromId: edge.fromId,
            toId: edge.toId,
            properties: mergeDocumentProperties(edge.properties),
          },
        );
      }
    });
    return { nodeCount: nodes.length, edgeCount: edges.length };
  }

  async rebuildFromBundle(
    bundle: MetadataBundle,
  ): Promise<{ nodeCount: number; edgeCount: number }> {
    const nodes = this.buildDocumentsFromBundle(bundle);
    const edges = this.buildEdgesFromBundle(bundle);
    await this.runInTransaction(async (transaction) => {
      for (const node of nodes) {
        await transaction.run(
          `MERGE (n:${node.label} {id: $id})
           SET n += $properties`,
          {
            id: node.id,
            properties: mergeDocumentProperties(node.properties),
          },
        );
      }
      for (const edge of edges) {
        await transaction.run(
          `MATCH (from {id: $fromId})
           MATCH (to {id: $toId})
           MERGE (from)-[r:${edge.relationType}]->(to)
           SET r += $properties`,
          {
            fromId: edge.fromId,
            toId: edge.toId,
            properties: mergeDocumentProperties(edge.properties),
          },
        );
      }
    });
    return { nodeCount: nodes.length, edgeCount: edges.length };
  }

  private buildDocuments(result: DistillationResult): Neo4jGraphDocument[] {
    return [
      {
        id: result.event.id,
        label: "EventSkeleton",
        properties: {
          goal: result.event.goal,
          context: result.event.context,
          scope: result.event.scope,
          provenance: result.event.provenance,
          kind: "event",
        },
      },
      ...result.atoms.map((atom) => ({
        id: atom.id,
        label: "MemoryAtom",
        properties: {
          atomType: atom.atomType,
          claim: atom.claim,
          trigger: atom.trigger,
          applicability: atom.applicability,
          scope: atom.scope,
          provenance: atom.provenance,
          versioning: atom.versioning,
          state: atom.state,
          metrics: atom.metrics,
        },
      })),
      ...result.entities.map((entity) => ({
        id: entity.id,
        label: "Entity",
        properties: {
          entityType: entity.entityType,
          name: entity.name,
          aliases: entity.aliases,
          tags: entity.tags,
          scope: entity.scope,
          provenance: entity.provenance,
        },
      })),
      ...result.scenarios.map((scenario) => ({
        id: scenario.id,
        label: "Scenario",
        properties: {
          name: scenario.name,
          tags: scenario.tags,
          summary: scenario.summary,
          scope: scenario.scope,
          provenance: scenario.provenance,
        },
      })),
      ...result.problems.map((problem) => ({
        id: problem.id,
        label: "Problem",
        properties: {
          statement: problem.statement,
          normalizedStatement: problem.normalizedStatement,
          tags: problem.tags,
          scope: problem.scope,
          provenance: problem.provenance,
        },
      })),
      ...result.evidence.map((evidence) => ({
        id: evidence.id,
        label: "Evidence",
        properties: {
          type: evidence.type,
          uri: evidence.uri,
          snippet: evidence.snippet,
          scope: evidence.scope,
          checksum: evidence.checksum,
          locator: evidence.locator,
        },
      })),
    ];
  }

  private buildDocumentsFromBundle(bundle: MetadataBundle): Neo4jGraphDocument[] {
    return [
      ...bundle.events.map((event) => ({
        id: event.id,
        label: "EventSkeleton",
        properties: {
          goal: event.goal,
          context: event.context,
          scope: event.scope,
          provenance: event.provenance,
        },
      })),
      ...bundle.atoms.map((atom) => ({
        id: atom.id,
        label: "MemoryAtom",
        properties: {
          atomType: atom.atomType,
          claim: atom.claim,
          trigger: atom.trigger,
          applicability: atom.applicability,
          scope: atom.scope,
          provenance: atom.provenance,
          versioning: atom.versioning,
          state: atom.state,
          metrics: atom.metrics,
        },
      })),
      ...bundle.entities.map((entity) => ({
        id: entity.id,
        label: "Entity",
        properties: {
          entityType: entity.entityType,
          name: entity.name,
          aliases: entity.aliases,
          tags: entity.tags,
          scope: entity.scope,
          provenance: entity.provenance,
        },
      })),
      ...bundle.scenarios.map((scenario) => ({
        id: scenario.id,
        label: "Scenario",
        properties: {
          name: scenario.name,
          tags: scenario.tags,
          summary: scenario.summary,
          scope: scenario.scope,
          provenance: scenario.provenance,
        },
      })),
      ...bundle.problems.map((problem) => ({
        id: problem.id,
        label: "Problem",
        properties: {
          statement: problem.statement,
          normalizedStatement: problem.normalizedStatement,
          tags: problem.tags,
          scope: problem.scope,
          provenance: problem.provenance,
        },
      })),
      ...bundle.evidence.map((evidence) => ({
        id: evidence.id,
        label: "Evidence",
        properties: {
          type: evidence.type,
          uri: evidence.uri,
          snippet: evidence.snippet,
          scope: evidence.scope,
          checksum: evidence.checksum,
          locator: evidence.locator,
        },
      })),
    ];
  }

  private buildEdges(result: DistillationResult): Neo4jGraphEdge[] {
    return result.relations.map((relation) => ({
      fromId: relation.fromId,
      toId: relation.toId,
      relationType: relation.relationType,
      properties: {
        scope: relation.scope,
        confidence: relation.confidence,
        status: relation.status,
        provenance: relation.provenance,
      },
    }));
  }

  private buildEdgesFromBundle(bundle: MetadataBundle): Neo4jGraphEdge[] {
    return bundle.relations.map((relation) => ({
      fromId: relation.fromId,
      toId: relation.toId,
      relationType: relation.relationType,
      properties: {
        scope: relation.scope,
        confidence: relation.confidence,
        status: relation.status,
        provenance: relation.provenance,
      },
    }));
  }

  private getClient(method: string): Neo4jCypherClient {
    if (!this.client) {
      throw new StorageConsistencyError(
        `Neo4j graph backend does not implement ${method}: no Cypher client configured`,
      );
    }
    return this.client;
  }

  private async runInTransaction<T>(
    runner: (transaction: Neo4jCypherTransaction) => Promise<T>,
  ): Promise<T> {
    const client = this.client;
    if (client?.transaction) {
      return client.transaction(runner);
    }
    return runner({
      run: (cypher, params) => this.run(cypher, params ?? {}, "transaction"),
    });
  }

  private async run<Row = Record<string, unknown>>(
    cypher: string,
    params: Record<string, unknown>,
    method: string,
  ): Promise<Neo4jQueryResult<Row>> {
    const client = this.getClient(method);
    return requireResult(await client.run<Row>(cypher, params), method);
  }
}
