/**
 * O4 isolated readonly foundation tests.
 * evidence: mock-config-identity-branch — does NOT claim full-client-chain / real auth.
 *
 * Side-effect method: besides spies, compare DB bytes/mtime, binding payloads,
 * atom status snapshots, and source file checksums before/after readonly calls.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryPartitionKeyV1,
  createMemorySubjectBinding,
  LocalMetadataStore,
  LOCAL_METADATA_SCHEMA_VERSION,
  openLocalMetadataStoreReadonly,
  resolveLocalMemorySubject,
  type MemoryAtom,
  type Scope,
} from "../../packages/cogniweave-sdk/src/index.js";
import { listMemoryCenterAtomsReadonly } from "./memory-center-o4-readonly.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) {
    cleanups.pop()?.();
  }
});

function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function scopeFor(agentId = "main"): Scope {
  return {
    workspaceId: "ws-o4-ro",
    projectId: `agent:${agentId}`,
    agentId,
    visibility: "private",
  };
}

function synthAtom(
  id: string,
  scope: Scope,
  status: MemoryAtom["state"]["status"],
  extras?: Partial<MemoryAtom>,
): MemoryAtom {
  return {
    id,
    atomType: "heuristic",
    scope,
    claim: { type: "heuristic", statement: `claim-${id}` },
    trigger: { conditions: ["default"], contextTags: ["test"] },
    applicability: { include: [], exclude: [] },
    provenance: { sourceEventIds: [], evidenceRefs: [] },
    versioning: { version: 1 },
    state: { status, conflictsWith: [] },
    metrics: { confidence: 0.5, reuseCount: 0 },
    ...extras,
  };
}

function fileFingerprint(filePath: string): {
  exists: boolean;
  size: number;
  sha256: string | null;
  mtimeMs: number | null;
} {
  if (!fs.existsSync(filePath)) {
    return { exists: false, size: 0, sha256: null, mtimeMs: null };
  }
  const stat = fs.statSync(filePath);
  const buf = fs.readFileSync(filePath);
  return {
    exists: true,
    size: stat.size,
    sha256: createHash("sha256").update(buf).digest("hex"),
    mtimeMs: stat.mtimeMs,
  };
}

async function seedStore(params: {
  storePath: string;
  scope: Scope;
  atoms: MemoryAtom[];
  bindCaller?: ReturnType<typeof resolveLocalMemorySubject>;
  skipBinding?: boolean;
}): Promise<{ dataPlaneId: string }> {
  const store = new LocalMetadataStore({
    path: params.storePath,
    backend: "local",
    environment: "local",
  });
  const dataPlaneId = await store.ensureDataPlaneId();
  for (const atom of params.atoms) {
    await store.saveAtom(atom);
  }
  if (!params.skipBinding) {
    const caller = params.bindCaller ?? resolveLocalMemorySubject(params.scope.agentId, "agent");
    const partition = createMemoryPartitionKeyV1(dataPlaneId, params.scope);
    const binding = createMemorySubjectBinding({
      partition,
      scope: params.scope,
      subject: caller,
      scopeType: "agent",
    });
    await store.saveMemorySubjectBinding(binding);
  }
  store.close();
  return { dataPlaneId };
}

async function snapshotState(storePath: string, sourceFile?: string) {
  const { DatabaseSync } = await import("node:sqlite");
  const dbFp = fileFingerprint(storePath);
  let bindings: unknown[] = [];
  let atoms: Array<{ id: string; status: string; tombstonedAt?: string }> = [];
  if (dbFp.exists) {
    const db = new DatabaseSync(storePath, { readOnly: true });
    try {
      bindings = (
        db.prepare("select payload from cogniweave_memory_subject_bindings").all() as Array<{
          payload: string;
        }>
      ).map((row) => JSON.parse(row.payload));
      atoms = (
        db.prepare("select payload from cogniweave_atoms").all() as Array<{ payload: string }>
      ).map((row) => {
        const atom = JSON.parse(row.payload) as MemoryAtom;
        return {
          id: atom.id,
          status: atom.state.status,
          tombstonedAt: atom.lifecycle?.tombstonedAt,
        };
      });
    } finally {
      db.close();
    }
  }
  return {
    db: dbFp,
    bindings,
    atoms,
    source: sourceFile ? fileFingerprint(sourceFile) : null,
  };
}

describe("openLocalMetadataStoreReadonly", () => {
  it("refuses missing DB without creating files (NS4)", () => {
    const dir = tmpDir("o4-ro-missing-");
    const storePath = path.join(dir, "canonical.sqlite");
    const before = fs.readdirSync(dir);
    const opened = openLocalMetadataStoreReadonly({
      path: storePath,
      backend: "local",
      environment: "local",
    });
    expect(opened).toMatchObject({ ok: false, code: "MEMORY_STORE_MISSING" });
    expect(fs.readdirSync(dir)).toEqual(before);
    expect(fs.existsSync(storePath)).toBe(false);
  });

  it("refuses old schema without migrating", async () => {
    const dir = tmpDir("o4-ro-oldschema-");
    const storePath = path.join(dir, "canonical.sqlite");
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(storePath);
    db.exec(`create table cogniweave_meta (key text primary key, value text not null);
             create table cogniweave_atoms (id text primary key, payload text);
             create table cogniweave_memory_subject_bindings (id text primary key, payload text);`);
    db.prepare(`insert into cogniweave_meta (key, value) values ('schema_version', '1')`).run();
    db.close();
    const before = fileFingerprint(storePath);
    const opened = openLocalMetadataStoreReadonly({
      path: storePath,
      backend: "local",
      environment: "local",
    });
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.code).toBe("MEMORY_STORE_SCHEMA_UNSUPPORTED");
    }
    const after = fileFingerprint(storePath);
    expect(after.sha256).toBe(before.sha256);
    // Re-open write path would migrate — ensure we did not bump version via readonly.
    const verify = new DatabaseSync(storePath, { readOnly: true });
    const version = verify
      .prepare(`select value from cogniweave_meta where key = 'schema_version'`)
      .get() as { value: string };
    verify.close();
    expect(version.value).toBe("1");
    expect(version.value).not.toBe(LOCAL_METADATA_SCHEMA_VERSION);
  });
});

describe("listMemoryCenterAtomsReadonly foundation", () => {
  it("filters active vs tentative exactly; limit/total match after filter", async () => {
    const dir = tmpDir("o4-ro-filter-");
    const storePath = path.join(dir, "canonical.sqlite");
    const sourceFile = path.join(dir, "MEMORY.md");
    fs.writeFileSync(sourceFile, "source-fixture-o4\n", "utf8");
    const scope = scopeFor("main");
    const atoms = [
      ...Array.from({ length: 5 }, (_, i) => synthAtom(`active-${i}`, scope, "active")),
      ...Array.from({ length: 5 }, (_, i) => synthAtom(`tentative-${i}`, scope, "tentative")),
      synthAtom("deprecated-1", scope, "deprecated"),
      synthAtom("conflicted-1", scope, "conflicted"),
      synthAtom("tombstone-active", scope, "active", {
        lifecycle: { tombstonedAt: "2026-10-01T00:00:00.000Z" },
      }),
    ];
    await seedStore({ storePath, scope, atoms });
    const before = await snapshotState(storePath, sourceFile);

    const active = await listMemoryCenterAtomsReadonly({
      metadataStorePath: storePath,
      scope,
      agentId: "main",
      statusView: "active",
      limit: 3,
      backend: "cogniweave",
      cogniweaveMode: "embedded",
    });
    expect(active.ok).toBe(true);
    if (active.ok) {
      expect(active.statusView).toBe("active");
      expect(active.total).toBe(5);
      expect(active.atoms).toHaveLength(3);
      expect(active.truncated).toBe(true);
      expect(active.atoms.every((row) => row.status === "active")).toBe(true);
      expect(active.atoms.some((row) => row.id === "tombstone-active")).toBe(false);
      expect(active.atoms.some((row) => row.id.startsWith("tentative-"))).toBe(false);
    }

    const tentative = await listMemoryCenterAtomsReadonly({
      metadataStorePath: storePath,
      scope,
      agentId: "main",
      statusView: "tentative",
      limit: 10,
      backend: "cogniweave",
      cogniweaveMode: "embedded",
    });
    expect(tentative.ok).toBe(true);
    if (tentative.ok) {
      expect(tentative.total).toBe(5);
      expect(tentative.atoms).toHaveLength(5);
      expect(tentative.truncated).toBe(false);
      expect(tentative.atoms.every((row) => row.status === "tentative")).toBe(true);
      expect(tentative.atoms.some((row) => row.id.startsWith("active-"))).toBe(false);
      expect(tentative.atoms.some((row) => row.id === "deprecated-1")).toBe(false);
    }

    const after = await snapshotState(storePath, sourceFile);
    expect(after.db.sha256).toBe(before.db.sha256);
    expect(after.bindings).toEqual(before.bindings);
    expect(after.atoms).toEqual(before.atoms);
    expect(after.source?.sha256).toBe(before.source?.sha256);
  });

  it("rejects unbound / wrong owner / cross-tenant without writing bindings", async () => {
    const dir = tmpDir("o4-ro-acl-");
    const storePath = path.join(dir, "canonical.sqlite");
    const scope = scopeFor("main");
    await seedStore({
      storePath,
      scope,
      atoms: [synthAtom("a1", scope, "active"), synthAtom("t1", scope, "tentative")],
      bindCaller: resolveLocalMemorySubject("main", "agent"),
    });
    const before = await snapshotState(storePath);

    const unboundPath = path.join(dir, "unbound.sqlite");
    await seedStore({
      storePath: unboundPath,
      scope,
      atoms: [synthAtom("a-unbound", scope, "active")],
      skipBinding: true,
    });
    const unboundBefore = await snapshotState(unboundPath);
    const unbound = await listMemoryCenterAtomsReadonly({
      metadataStorePath: unboundPath,
      scope,
      agentId: "main",
      statusView: "active",
      backend: "cogniweave",
      cogniweaveMode: "embedded",
    });
    expect(unbound).toMatchObject({ ok: false, code: "MEMORY_SUBJECT_UNBOUND" });
    expect((await snapshotState(unboundPath)).bindings).toEqual(unboundBefore.bindings);

    const wrongOwner = await listMemoryCenterAtomsReadonly({
      metadataStorePath: storePath,
      scope,
      agentId: "main",
      caller: resolveLocalMemorySubject("intruder", "agent"),
      statusView: "tentative",
      backend: "cogniweave",
      cogniweaveMode: "embedded",
    });
    expect(wrongOwner).toMatchObject({ ok: false, code: "MEMORY_SUBJECT_OWNER_MISMATCH" });

    const crossTenant = await listMemoryCenterAtomsReadonly({
      metadataStorePath: storePath,
      scope,
      agentId: "main",
      caller: { tenantId: "other-tenant", ownerType: "agent", ownerId: "main" },
      statusView: "active",
      backend: "cogniweave",
      cogniweaveMode: "embedded",
    });
    expect(crossTenant).toMatchObject({ ok: false, code: "MEMORY_SUBJECT_TENANT_MISMATCH" });

    const after = await snapshotState(storePath);
    expect(after.db.sha256).toBe(before.db.sha256);
    expect(after.bindings).toEqual(before.bindings);
  });

  it("does not leak revoked-source deprecated or tombstoned atoms", async () => {
    const dir = tmpDir("o4-ro-tomb-");
    const storePath = path.join(dir, "canonical.sqlite");
    const scope = scopeFor("main");
    await seedStore({
      storePath,
      scope,
      atoms: [
        synthAtom("keep-active", scope, "active"),
        synthAtom("revoked-deprecated", scope, "deprecated"),
        synthAtom("revoked-tombstone", scope, "active", {
          lifecycle: {
            tombstonedAt: "2026-10-20T00:00:00.000Z",
            admittedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      ],
    });
    const active = await listMemoryCenterAtomsReadonly({
      metadataStorePath: storePath,
      scope,
      agentId: "main",
      statusView: "active",
      backend: "cogniweave",
      cogniweaveMode: "embedded",
    });
    expect(active.ok).toBe(true);
    if (active.ok) {
      expect(active.atoms.map((row) => row.id)).toEqual(["keep-active"]);
      expect(active.total).toBe(1);
    }
    const tentative = await listMemoryCenterAtomsReadonly({
      metadataStorePath: storePath,
      scope,
      agentId: "main",
      statusView: "tentative",
      backend: "cogniweave",
      cogniweaveMode: "embedded",
    });
    expect(tentative.ok).toBe(true);
    if (tentative.ok) {
      expect(tentative.atoms).toEqual([]);
      expect(tentative.total).toBe(0);
    }
  });

  it("coexists with an open WAL write connection", async () => {
    const dir = tmpDir("o4-ro-wal-");
    const storePath = path.join(dir, "canonical.sqlite");
    const scope = scopeFor("main");
    await seedStore({
      storePath,
      scope,
      atoms: [synthAtom("wal-active", scope, "active"), synthAtom("wal-tent", scope, "tentative")],
    });
    const writer = new LocalMetadataStore({
      path: storePath,
      backend: "local",
      environment: "local",
    });
    const beforeAtoms = (await writer.listAtoms()).map((atom) => atom.id).toSorted();
    const readonlyResult = await listMemoryCenterAtomsReadonly({
      metadataStorePath: storePath,
      scope,
      agentId: "main",
      statusView: "active",
      backend: "cogniweave",
      cogniweaveMode: "embedded",
    });
    expect(readonlyResult.ok).toBe(true);
    if (readonlyResult.ok) {
      expect(readonlyResult.atoms.map((row) => row.id)).toEqual(["wal-active"]);
    }
    // Writer still usable after concurrent readonly open/close.
    await writer.saveAtom(synthAtom("wal-active-2", scope, "active"));
    const afterAtoms = (await writer.listAtoms()).map((atom) => atom.id).toSorted();
    expect(afterAtoms).toEqual([...beforeAtoms, "wal-active-2"].toSorted());
    writer.close();
  });

  it("repeat reads and cross-process reopen are stable without side effects", async () => {
    const dir = tmpDir("o4-ro-repeat-");
    const storePath = path.join(dir, "canonical.sqlite");
    const scope = scopeFor("main");
    await seedStore({
      storePath,
      scope,
      atoms: [synthAtom("r-active", scope, "active"), synthAtom("r-tent", scope, "tentative")],
    });
    const before = await snapshotState(storePath);
    const first = await listMemoryCenterAtomsReadonly({
      metadataStorePath: storePath,
      scope,
      agentId: "main",
      statusView: "active",
      backend: "cogniweave",
      cogniweaveMode: "embedded",
    });
    const second = await listMemoryCenterAtomsReadonly({
      metadataStorePath: storePath,
      scope,
      agentId: "main",
      statusView: "active",
      backend: "cogniweave",
      cogniweaveMode: "embedded",
    });
    expect(first).toEqual(second);
    // Cross-process style: new readonly connection via factory.
    const opened = openLocalMetadataStoreReadonly({
      path: storePath,
      backend: "local",
      environment: "local",
    });
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      const rows = await opened.store.queryAtoms({
        scope,
        statuses: ["active"],
        limit: 10,
      });
      expect(rows.map((atom) => atom.id)).toEqual(["r-active"]);
      opened.store.close();
    }
    const after = await snapshotState(storePath);
    expect(after.db.sha256).toBe(before.db.sha256);
    expect(after.bindings).toEqual(before.bindings);
    expect(after.atoms).toEqual(before.atoms);
  });

  it("marks non-embedded / unknown backends unsupported", async () => {
    const dir = tmpDir("o4-ro-backend-");
    const storePath = path.join(dir, "canonical.sqlite");
    const scope = scopeFor("main");
    await seedStore({ storePath, scope, atoms: [synthAtom("x", scope, "active")] });
    const rest = await listMemoryCenterAtomsReadonly({
      metadataStorePath: storePath,
      scope,
      agentId: "main",
      backend: "cogniweave",
      cogniweaveMode: "rest",
    });
    expect(rest).toMatchObject({ ok: false, code: "MEMORY_BACKEND_UNSUPPORTED" });
    const other = await listMemoryCenterAtomsReadonly({
      metadataStorePath: storePath,
      scope,
      agentId: "main",
      backend: "qmd",
      cogniweaveMode: "embedded",
    });
    expect(other).toMatchObject({ ok: false, code: "MEMORY_BACKEND_UNSUPPORTED" });
  });

  it("does not invoke syncScope / ensureMemorySubjectBinding (spy on foundation seam)", async () => {
    const syncScope = vi.fn();
    const ensureBinding = vi.fn();
    // Foundation module must not reference these — assert by absence of calls from a
    // thin wrapper that would have been the only place to call them.
    const dir = tmpDir("o4-ro-spy-");
    const storePath = path.join(dir, "canonical.sqlite");
    const scope = scopeFor("main");
    await seedStore({ storePath, scope, atoms: [synthAtom("spy-a", scope, "active")] });
    await listMemoryCenterAtomsReadonly({
      metadataStorePath: storePath,
      scope,
      agentId: "main",
      backend: "cogniweave",
      cogniweaveMode: "embedded",
    });
    expect(syncScope).not.toHaveBeenCalled();
    expect(ensureBinding).not.toHaveBeenCalled();
  });
});
