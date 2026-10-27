import { describe, expect, it } from "vitest";
import type { MemoryAtom, Scope } from "../../packages/cogniweave-sdk/src/index.js";
import { createCogniWeaveRuntime } from "../../packages/cogniweave-sdk/src/runtime/bootstrap.js";

function atom(
  id: string,
  scope: Scope,
  status: MemoryAtom["state"]["status"] = "active",
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
  };
}

describe("queryAtoms ACL v1", () => {
  const scopeA: Scope = {
    workspaceId: "ws1",
    projectId: "agent:main",
    agentId: "main",
    visibility: "private",
  };
  const scopeB: Scope = {
    workspaceId: "ws1",
    projectId: "agent:other",
    agentId: "other",
    visibility: "private",
  };

  async function seedRuntime() {
    const runtime = createCogniWeaveRuntime({
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
      defaultScope: scopeA,
    });
    await runtime.engine.upsertAtoms([
      atom("a1", scopeA, "active"),
      atom("a2", scopeB, "active"),
      atom("a3", scopeA, "deprecated"),
    ]);
    return runtime;
  }

  it("returns only active atoms within requested scope for a bound legal subject", async () => {
    const runtime = await seedRuntime();
    await runtime.engine.ensureMemorySubjectBinding({
      scope: scopeA,
      caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
      scopeType: "agent",
    });
    const hits = await runtime.engine.queryAtoms({
      scope: scopeA,
      caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
      filter: { limit: 10 },
    });
    expect(hits.map((hit) => hit.atom.id)).toEqual(["a1"]);
  });

  it("rejects unbound callers with empty hits (fail-closed)", async () => {
    const runtime = await seedRuntime();
    const hits = await runtime.engine.queryAtoms({
      scope: scopeA,
      caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
      filter: { limit: 10 },
    });
    expect(hits).toEqual([]);
  });

  it("rejects wrong-owner callers with empty hits", async () => {
    const runtime = await seedRuntime();
    await runtime.engine.ensureMemorySubjectBinding({
      scope: scopeA,
      caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
      scopeType: "agent",
    });
    const hits = await runtime.engine.queryAtoms({
      scope: scopeA,
      caller: { tenantId: "__local__", ownerType: "agent", ownerId: "intruder" },
      filter: { limit: 10 },
    });
    expect(hits).toEqual([]);
  });

  it("rejects cross-tenant callers with empty hits", async () => {
    const runtime = await seedRuntime();
    await runtime.engine.ensureMemorySubjectBinding({
      scope: scopeA,
      caller: { tenantId: "__local__", ownerType: "agent", ownerId: "main" },
      scopeType: "agent",
    });
    const hits = await runtime.engine.queryAtoms({
      scope: scopeA,
      caller: { tenantId: "other-tenant", ownerType: "agent", ownerId: "main" },
      filter: { limit: 10 },
    });
    expect(hits).toEqual([]);
  });
});
