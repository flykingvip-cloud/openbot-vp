import { LocalMetadataStore } from "../adapters/local-metadata.js";
import { PostgresMetadataStore, type PostgresSqlClient } from "../adapters/postgres-metadata.js";
import type { Scope } from "../models.js";
import { InMemoryCogniWeaveEngine } from "../runtime/in-memory-engine.js";
import type { PersistedSourceLifecycleReceipt } from "../storage/types.js";

export type LocalToPostgresMigrationCounts = {
  events: number;
  atoms: number;
  entities: number;
  scenarios: number;
  problems: number;
  evidence: number;
  relations: number;
  journals: number;
  sourceBindings: number;
  sourceObjectLinks: number;
  writeOperations: number;
  lifecycleReceipts: number;
};

export type LocalToPostgresMigrationResult = {
  schema: string;
  sourceStorePath: string;
  counts: LocalToPostgresMigrationCounts;
  dataPlaneId?: string;
  recoveredJournals: number;
  writeOperationCountAfterRecover: number;
  durationMs: number;
};

export type MigrateLocalCanonicalToPostgresInput = {
  sourceStorePath: string;
  client: PostgresSqlClient;
  schema?: string;
  /** When true (default), drop+recreate schema before bootstrap for a clean drill. */
  resetSchema?: boolean;
  scope?: Scope;
};

const engineConfig = {
  environment: "service" as const,
  metadataBackend: "memory" as const,
  graphBackend: "memory" as const,
  evidenceBackend: "memory" as const,
  vectorBackend: "memory" as const,
};

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function listLifecycleReceiptsFromLocal(
  store: LocalMetadataStore,
): Promise<PersistedSourceLifecycleReceipt[]> {
  if (typeof store.listSourceLifecycleReceipts === "function") {
    return store.listSourceLifecycleReceipts();
  }
  return [];
}

/**
 * CW2 Postgres migration drill: copy Local SQLite canonical rows into Postgres,
 * then recoverFromCanonical against the Postgres metadata store (no writeBack replay).
 */
export async function migrateLocalCanonicalToPostgres(
  input: MigrateLocalCanonicalToPostgresInput,
): Promise<LocalToPostgresMigrationResult> {
  const started = performance.now();
  const schema = (input.schema?.trim() || "cogniweave_drill").replace(/[^a-zA-Z0-9_]/g, "_");
  const source = new LocalMetadataStore({
    backend: "local",
    environment: "local",
    path: input.sourceStorePath,
  });
  const target = new PostgresMetadataStore({
    backend: "postgres",
    environment: "service",
    client: input.client,
    schema,
  });

  try {
    if (input.resetSchema !== false) {
      await input.client.query(`drop schema if exists ${quoteIdent(schema)} cascade`, []);
    }

    await target.bootstrapSchema();

    const events = await source.listEvents();
    const atoms = await source.listAtoms();
    const entities = await source.listEntities();
    const scenarios = await source.listScenarios();
    const problems = await source.listProblems();
    const evidence = await source.listEvidence();
    const relations = await source.listRelations();
    const journals = await source.listJournals();
    const sourceBindings = await source.listSourceBindings();
    const sourceObjectLinks = await source.listSourceObjectLinks();
    const writeOperations =
      typeof source.listWriteOperations === "function" ? await source.listWriteOperations() : [];
    const lifecycleReceipts = await listLifecycleReceiptsFromLocal(source);
    const dataPlaneId =
      typeof source.getDataPlaneId === "function" ? await source.getDataPlaneId() : undefined;

    await target.withTransaction!(async () => {
      for (const event of events) {
        await target.upsertEvent(event);
      }
      for (const atom of atoms) {
        await target.saveAtom(atom);
        if (atom.dedupKey && typeof target.bindDedupKey === "function") {
          await target.bindDedupKey(atom.dedupKey, atom.id);
        }
      }
      for (const entity of entities) {
        await target.saveEntity(entity);
      }
      for (const scenario of scenarios) {
        await target.saveScenario(scenario);
      }
      for (const problem of problems) {
        await target.saveProblem(problem);
      }
      for (const item of evidence) {
        await target.saveEvidence(item);
      }
      for (const relation of relations) {
        await target.saveRelation(relation);
      }
      for (const journal of journals) {
        await target.putJournal(journal);
      }
      for (const binding of sourceBindings) {
        await target.saveSourceBinding!(binding);
      }
      for (const link of sourceObjectLinks) {
        await target.saveSourceObjectLink!(link);
      }
      for (const op of writeOperations) {
        await target.putWriteOperation!(op);
      }
      for (const receipt of lifecycleReceipts) {
        await target.putSourceLifecycleReceipt!(receipt);
      }
      if (dataPlaneId) {
        await input.client.query(
          `insert into ${quoteIdent(schema)}.cogniweave_meta (key, value)
           values ('data_plane_id', $1)
           on conflict (key) do update set value = excluded.value`,
          [dataPlaneId],
        );
      }
    });

    const counts: LocalToPostgresMigrationCounts = {
      events: events.length,
      atoms: atoms.length,
      entities: entities.length,
      scenarios: scenarios.length,
      problems: problems.length,
      evidence: evidence.length,
      relations: relations.length,
      journals: journals.length,
      sourceBindings: sourceBindings.length,
      sourceObjectLinks: sourceObjectLinks.length,
      writeOperations: writeOperations.length,
      lifecycleReceipts: lifecycleReceipts.length,
    };

    // Verify target counts.
    expectEqual("events", (await target.listEvents()).length, counts.events);
    expectEqual("atoms", (await target.listAtoms()).length, counts.atoms);
    expectEqual("evidence", (await target.listEvidence()).length, counts.evidence);
    expectEqual("journals", (await target.listJournals()).length, counts.journals);
    expectEqual(
      "sourceBindings",
      (await target.listSourceBindings!()).length,
      counts.sourceBindings,
    );
    expectEqual(
      "sourceObjectLinks",
      (await target.listSourceObjectLinks!()).length,
      counts.sourceObjectLinks,
    );
    expectEqual(
      "writeOperations",
      (await target.listWriteOperations!()).length,
      counts.writeOperations,
    );
    if (dataPlaneId) {
      expectEqual("dataPlaneId", await target.getDataPlaneId!(), dataPlaneId);
    }

    const engine = new InMemoryCogniWeaveEngine(engineConfig, { metadataStore: target });
    const recovered = await engine.recoverFromCanonical(
      input.scope ? { scope: input.scope } : undefined,
    );
    if (recovered.status !== "RECOVERED") {
      throw new Error(`recoverFromCanonical failed: ${recovered.status}`);
    }

    return {
      schema,
      sourceStorePath: input.sourceStorePath,
      counts,
      dataPlaneId,
      recoveredJournals: recovered.journalsRebuilt,
      writeOperationCountAfterRecover: recovered.writeOperationCount,
      durationMs: performance.now() - started,
    };
  } finally {
    source.close();
  }
}

function expectEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(
      `migration verify failed for ${label}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}
