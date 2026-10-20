import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { migrateLocalCanonicalToPostgres } from "../migration/local-to-postgres.js";
import type { Scope } from "../models.js";
import { InMemoryCogniWeaveEngine } from "../runtime/in-memory-engine.js";
import { createAdapterBundle } from "./factory.js";
import { LocalMetadataStore } from "./local-metadata.js";
import { createPgSqlClient, resolveCogniWeavePostgresUrl } from "./postgres-client.js";

const scope: Scope = {
  workspaceId: "ws_pg_drill",
  projectId: "proj_pg_drill",
  agentId: "agent_main",
  visibility: "private",
};

const DEFAULT_LOCAL_URL = "postgresql://postgres@127.0.0.1:5432/cogniweave_drill";

async function resolveLivePostgresUrl(): Promise<string | undefined> {
  const fromEnv = resolveCogniWeavePostgresUrl();
  const candidates = [fromEnv, DEFAULT_LOCAL_URL].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  for (const url of candidates) {
    try {
      const client = await createPgSqlClient({ connectionString: url, max: 1 });
      await client.query("select 1 as ok", []);
      await client.end();
      return url;
    } catch {
      // try next
    }
  }
  return undefined;
}

describe("CW2 Postgres migration drill (real PG)", () => {
  const tempDirs: string[] = [];
  let liveUrl: string | undefined;

  beforeAll(async () => {
    liveUrl = await resolveLivePostgresUrl();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("migrates Local SQLite canonical → Postgres and recoverFromCanonical", async ({ skip }) => {
    if (!liveUrl) {
      skip("No reachable Postgres (set COGNIWEAVE_POSTGRES_URL or local cogniweave_drill)");
      return;
    }

    const dir = await mkdtemp(join(tmpdir(), "cw-pg-drill-"));
    tempDirs.push(dir);
    const localPath = join(dir, "canonical.sqlite");

    const local = new LocalMetadataStore({
      backend: "local",
      environment: "local",
      path: localPath,
    });
    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      { metadataStore: local },
    );

    const first = await engine.writeBack({
      rawInput: "PostgresDrillPhraseUniqueAlpha durable migration body",
      scope,
      sourceType: "document",
      metadata: { openbotPath: "MEMORY.md" },
    });
    expect(first.status).toBe("COMPLETED");

    const second = await engine.writeBack({
      rawInput: "PostgresDrillPhraseUniqueBeta second journal body",
      scope,
      sourceType: "document",
      metadata: { openbotPath: "memory/note.md" },
    });
    expect(second.status).toBe("COMPLETED");

    const dataPlaneId = await local.ensureDataPlaneId();
    const binding = {
      id: "sb_pg_drill_1",
      sourceIdentityId: "sid_pg_drill_1",
      sourceLocator: "MEMORY.md",
      status: "active" as const,
      scope,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await local.saveSourceBinding(binding);
    await local.saveSourceObjectLink({
      id: "sol_pg_drill_1",
      sourceBindingId: binding.id,
      objectType: "evidence",
      objectId: (await local.listEvidence())[0]!.id,
      linkRole: "primary",
      createdAt: new Date().toISOString(),
    });
    await local.putSourceLifecycleReceipt({
      operationId: "op_pg_drill_seed",
      sourceBindingId: binding.id,
      sourceIdentityId: binding.sourceIdentityId,
      previousStatus: "active",
      currentStatus: "active",
      affectedObjectCount: 0,
      completedAt: new Date().toISOString(),
    });
    local.close();

    const client = await createPgSqlClient({ connectionString: liveUrl, max: 2 });
    try {
      const schema = `cw_drill_${Date.now().toString(36)}`;
      const result = await migrateLocalCanonicalToPostgres({
        sourceStorePath: localPath,
        client,
        schema,
        resetSchema: true,
        scope,
      });

      expect(result.counts.journals).toBeGreaterThanOrEqual(2);
      expect(result.counts.atoms).toBeGreaterThan(0);
      expect(result.counts.evidence).toBeGreaterThan(0);
      expect(result.counts.sourceBindings).toBe(1);
      expect(result.counts.sourceObjectLinks).toBe(1);
      expect(result.counts.lifecycleReceipts).toBe(1);
      expect(result.dataPlaneId).toBe(dataPlaneId);
      expect(result.recoveredJournals).toBe(result.counts.journals);
      expect(result.writeOperationCountAfterRecover).toBe(result.counts.writeOperations);

      const bundle = createAdapterBundle({
        environment: "service",
        metadataBackend: "postgres",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
        postgres: { client, schema },
      });
      expect(bundle.resolutions[0]?.implementation).toBe("sql-first");
      const atoms = await bundle.metadataStore.listAtoms();
      expect(atoms.length).toBe(result.counts.atoms);

      await client.query(`drop schema if exists "${schema}" cascade`, []);
    } finally {
      await client.end();
    }
  }, 120_000);
});
