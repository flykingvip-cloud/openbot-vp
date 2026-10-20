import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalMetadataStore } from "../adapters/local-metadata.js";
import {
  InMemoryCogniWeaveEngine,
  InMemoryMetadataStore,
  createMemoryPartitionKeyV1,
  createMemorySubjectBinding,
} from "../index.js";
import type { MemoryAtom, Scope } from "../models.js";

const scope: Scope = {
  workspaceId: "ws_p4",
  projectId: "proj_p4",
  agentId: "agent_main",
  visibility: "private",
};

function makeAtom(id: string, status: MemoryAtom["state"]["status"] = "active"): MemoryAtom {
  return {
    id,
    atomType: "strategy",
    scope,
    claim: { type: "causal", statement: `claim ${id}` },
    trigger: { conditions: ["c1"], contextTags: ["t1"] },
    applicability: { include: [], exclude: [] },
    provenance: { sourceEventIds: [], evidenceRefs: [] },
    versioning: { version: 1 },
    state: { status, conflictsWith: [] },
    metrics: { confidence: 0.8, reuseCount: 0 },
  };
}

async function seedBoundEngine(params?: {
  tenantId?: string;
  ownerId?: string;
  atoms?: MemoryAtom[];
}): Promise<{
  engine: InMemoryCogniWeaveEngine;
  store: InMemoryMetadataStore;
  caller: { tenantId: string; ownerType: "user"; ownerId: string };
}> {
  const store = new InMemoryMetadataStore();
  const engine = new InMemoryCogniWeaveEngine(
    {
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
    },
    { metadataStore: store },
  );
  const tenantId = params?.tenantId ?? "tenant_a";
  const ownerId = params?.ownerId ?? "user_a";
  const dataPlaneId = await store.ensureDataPlaneId();
  const partition = createMemoryPartitionKeyV1(dataPlaneId, scope);
  await store.saveMemorySubjectBinding(
    createMemorySubjectBinding({
      partition,
      scope,
      subject: { tenantId, ownerType: "user", ownerId },
      scopeType: "personal",
    }),
  );
  for (const atom of params?.atoms ?? [makeAtom("atm_ok")]) {
    await store.saveAtom(atom);
  }
  return {
    engine,
    store,
    caller: { tenantId, ownerType: "user", ownerId },
  };
}

describe("CW2-P4-01 queryAtoms ACL + lifecycle", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns hits for authorized caller with explain.bindingId", async () => {
    const { engine, caller } = await seedBoundEngine();
    const hits = await engine.queryAtoms({ scope, caller });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.atom.id).toBe("atm_ok");
    expect(hits[0]?.explain.acl).toBe("allowed");
    expect(hits[0]?.explain.bindingId).toMatch(/^msb_/);
    expect(hits[0]?.explain.evidenceRefCount).toBe(0);
  });

  it("denies cross-tenant and wrong-owner callers (false-allow = 0)", async () => {
    const { engine } = await seedBoundEngine();
    expect(
      await engine.queryAtoms({
        scope,
        caller: { tenantId: "tenant_b", ownerType: "user", ownerId: "user_a" },
      }),
    ).toEqual([]);
    expect(
      await engine.queryAtoms({
        scope,
        caller: { tenantId: "tenant_a", ownerType: "user", ownerId: "user_other" },
      }),
    ).toEqual([]);
  });

  it("excludes deprecated / tombstoned atoms (deleted recall = 0)", async () => {
    const { engine, caller } = await seedBoundEngine({
      atoms: [
        makeAtom("atm_active"),
        makeAtom("atm_dep", "deprecated"),
        {
          ...makeAtom("atm_tomb"),
          lifecycle: { tombstonedAt: "2026-07-19T00:00:00.000Z" },
        },
      ],
    });
    const hits = await engine.queryAtoms({ scope, caller });
    expect(hits.map((hit) => hit.atom.id)).toEqual(["atm_active"]);
  });

  it("LocalMetadataStore queryAtoms is scope-indexed (ignores out-of-scope rows)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cw2-p4-query-"));
    tempDirs.push(dir);
    const store = new LocalMetadataStore({
      path: join(dir, "meta.sqlite"),
      backend: "local",
      environment: "local",
    });
    await store.saveAtom(makeAtom("atm_in"));
    await store.saveAtom({
      ...makeAtom("atm_out"),
      scope: { ...scope, workspaceId: "ws_other" },
    });
    await store.saveAtom(makeAtom("atm_dep", "deprecated"));
    const rows = await store.queryAtoms!({ scope });
    expect(rows.map((atom) => atom.id)).toEqual(["atm_in"]);
    store.close();
  });
});
