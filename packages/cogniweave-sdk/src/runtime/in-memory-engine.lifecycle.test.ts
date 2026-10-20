import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryCogniWeaveEngine, InMemoryMetadataStore } from "../index.js";
import type {
  EntityRecord,
  EventSkeleton,
  EvidenceRecord,
  MemoryAtom,
  ProblemRecord,
  RelationRecord,
  ScenarioRecord,
  Scope,
  SourceObjectLink,
  SourceObjectType,
} from "../models.js";

function bindingIdForIdentity(identity: string): string {
  const locator = `msrc://${identity}`;
  return `sb_${createHash("sha256").update(`${identity}\0${locator}`).digest("hex").slice(0, 20)}`;
}

function linkIdFor(
  bindingId: string,
  objectId: string,
  objectType: SourceObjectType = "evidence",
): string {
  return `sol_${createHash("sha256")
    .update(`${bindingId}\0${objectType}\0${objectId}`)
    .digest("hex")
    .slice(0, 20)}`;
}

function makeAtom(input: {
  id: string;
  scope: Scope;
  evidenceRefs: string[];
  confidence?: number;
}): MemoryAtom {
  return {
    id: input.id,
    atomType: "strategy",
    scope: input.scope,
    claim: { type: "causal", statement: "multi-source atom claim" },
    trigger: { conditions: [], contextTags: [] },
    applicability: { include: [], exclude: [] },
    provenance: { sourceEventIds: [], evidenceRefs: input.evidenceRefs },
    versioning: { version: 1 },
    state: { status: "active", conflictsWith: [] },
    metrics: { confidence: input.confidence ?? 0.8, reuseCount: 0 },
  };
}

const scope: Scope = {
  workspaceId: "ws_lifecycle",
  projectId: "proj_lifecycle",
  agentId: "agent_main",
  visibility: "private",
};

function makeEvidence(uri: string, snippet: string): EvidenceRecord {
  return {
    id: `ev_${uri.replace(/[^a-z0-9]+/gi, "_").slice(0, 24)}`,
    type: "document",
    uri,
    snippet,
    trustScore: 0.9,
    scope,
    locator: { messageIds: [], toolCallIds: [] },
  };
}

describe("InMemoryCogniWeaveEngine source lifecycle", () => {
  it("archives, restores, forgets, and purges with idempotent operationIds", async () => {
    const metadataStore = new InMemoryMetadataStore();
    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      { metadataStore },
    );

    const identity = "sid_lifecycle_alpha";
    await metadataStore.saveEvidence(
      makeEvidence(`msrc://${identity}`, "lifecycle alpha secret phrase"),
    );
    await metadataStore.saveEvidence(
      makeEvidence("agents/main/sessions/other.jsonl", "unrelated keep me"),
    );

    const subject = { scope };
    const archive = await engine.archiveSource({
      operationId: "op-archive-1",
      selector: { mode: "identity", sourceIdentityId: identity },
      subject,
      reasonCode: "TEST_ARCHIVE",
    });
    expect(archive.currentStatus).toBe("archived");
    expect(archive.previousStatus).toBe("active");

    const archiveAgain = await engine.archiveSource({
      operationId: "op-archive-1",
      selector: { mode: "identity", sourceIdentityId: identity },
      subject,
      reasonCode: "TEST_ARCHIVE",
    });
    expect(archiveAgain.currentStatus).toBe("archived");

    const afterArchive = await engine.searchEvidence("lifecycle alpha secret", { scope });
    expect(afterArchive.map((r) => r.evidence.uri)).not.toContain(`msrc://${identity}`);
    const keep = await engine.searchEvidence("unrelated keep me", { scope });
    expect(keep.some((r) => r.evidence.uri.includes("other.jsonl"))).toBe(true);

    const restored = await engine.restoreSource({
      operationId: "op-restore-1",
      selector: { mode: "identity", sourceIdentityId: identity },
      subject,
      reasonCode: "TEST_RESTORE",
    });
    expect(restored.currentStatus).toBe("active");
    expect(restored.previousStatus).toBe("archived");

    const afterRestore = await engine.searchEvidence("lifecycle alpha secret", { scope });
    expect(afterRestore.map((r) => r.evidence.uri)).toContain(`msrc://${identity}`);

    const forgotten = await engine.forgetSource({
      operationId: "op-forget-1",
      selector: { mode: "identity", sourceIdentityId: identity },
      subject,
      reasonCode: "TEST_FORGET",
    });
    expect(forgotten.currentStatus).toBe("forgotten");
    expect(forgotten.affectedObjectCount).toBeGreaterThan(0);

    await expect(
      engine.restoreSource({
        operationId: "op-restore-bad",
        selector: { mode: "identity", sourceIdentityId: identity },
        subject,
        reasonCode: "TEST_RESTORE",
      }),
    ).rejects.toThrow(/invalid source lifecycle transition forgotten/);

    const purged = await engine.purgeSource({
      operationId: "op-purge-1",
      selector: { mode: "identity", sourceIdentityId: identity },
      subject,
      reasonCode: "TEST_PURGE",
    });
    expect(purged.currentStatus).toBe("purged");
    expect(engine.getSourceBindingStatus({ mode: "identity", sourceIdentityId: identity })).toBe(
      "purged",
    );
    expect(engine.isSourcePathRetrievable(`msrc://${identity}/chunk`)).toBe(false);
    expect(engine.isSourcePathRetrievable("agents/main/sessions/other.jsonl")).toBe(true);
  });

  it("supports legacy locator selectors", async () => {
    const metadataStore = new InMemoryMetadataStore();
    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      { metadataStore },
    );
    const locator = "agents/main/sessions/conv_lifecycle.jsonl";
    await metadataStore.saveEvidence(makeEvidence(locator, "locator only secret phrase"));

    await engine.archiveSource({
      operationId: "op-loc-archive",
      selector: { mode: "legacyLocator", sourceLocator: locator },
      subject: { scope },
      reasonCode: "TEST_LOCATOR",
    });

    const hits = await engine.searchEvidence("locator only secret", { scope });
    expect(hits).toHaveLength(0);
    expect(engine.isSourcePathRetrievable(locator)).toBe(false);
  });

  it("keeps multi-source evidence after forget; purge only deletes orphans", async () => {
    const metadataStore = new InMemoryMetadataStore();
    const identityA = "sid_multi_a";
    const identityB = "sid_multi_b";
    const now = new Date().toISOString();
    const bindingA = {
      id: bindingIdForIdentity(identityA),
      sourceIdentityId: identityA,
      sourceLocator: `msrc://${identityA}`,
      status: "active" as const,
      scope,
      createdAt: now,
      updatedAt: now,
    };
    const bindingB = {
      id: bindingIdForIdentity(identityB),
      sourceIdentityId: identityB,
      sourceLocator: `msrc://${identityB}`,
      status: "active" as const,
      scope,
      createdAt: now,
      updatedAt: now,
    };
    const shared = makeEvidence("doc://shared-multi", "shared multi-source phrase");
    await metadataStore.saveEvidence(shared);
    await metadataStore.saveSourceBinding(bindingA);
    await metadataStore.saveSourceBinding(bindingB);
    const linkA: SourceObjectLink = {
      id: linkIdFor(bindingA.id, shared.id),
      sourceBindingId: bindingA.id,
      objectType: "evidence",
      objectId: shared.id,
      linkRole: "supporting",
      createdAt: now,
    };
    const linkB: SourceObjectLink = {
      id: linkIdFor(bindingB.id, shared.id),
      sourceBindingId: bindingB.id,
      objectType: "evidence",
      objectId: shared.id,
      linkRole: "supporting",
      createdAt: now,
    };
    await metadataStore.saveSourceObjectLink(linkA);
    await metadataStore.saveSourceObjectLink(linkB);

    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      { metadataStore },
    );

    const forgottenA = await engine.forgetSource({
      operationId: "op-multi-forget-a",
      selector: { mode: "identity", sourceIdentityId: identityA },
      subject: { scope },
      reasonCode: "TEST_MULTI_FORGET",
    });
    expect(forgottenA.affectedObjectCount).toBe(1);
    const afterForgetA = await engine.searchEvidence("shared multi-source phrase", { scope });
    expect(afterForgetA.map((r) => r.evidence.id)).toContain(shared.id);
    expect((await metadataStore.listEvidence()).map((e) => e.id)).toContain(shared.id);

    const purgedA = await engine.purgeSource({
      operationId: "op-multi-purge-a",
      selector: { mode: "identity", sourceIdentityId: identityA },
      subject: { scope },
      reasonCode: "TEST_MULTI_PURGE",
    });
    expect(purgedA.currentStatus).toBe("purged");
    // B still has a live link — shared evidence must remain.
    expect((await metadataStore.listEvidence()).map((e) => e.id)).toContain(shared.id);
    const stillVisible = await engine.searchEvidence("shared multi-source phrase", { scope });
    expect(stillVisible.map((r) => r.evidence.id)).toContain(shared.id);

    await engine.forgetSource({
      operationId: "op-multi-forget-b",
      selector: { mode: "identity", sourceIdentityId: identityB },
      subject: { scope },
      reasonCode: "TEST_MULTI_FORGET",
    });
    await engine.purgeSource({
      operationId: "op-multi-purge-b",
      selector: { mode: "identity", sourceIdentityId: identityB },
      subject: { scope },
      reasonCode: "TEST_MULTI_PURGE",
    });
    expect((await metadataStore.listEvidence()).map((e) => e.id)).not.toContain(shared.id);
  });

  it("recomputes multi-source atom provenance on forget and tombstones when orphaned", async () => {
    const metadataStore = new InMemoryMetadataStore();
    const identityA = "sid_atom_a";
    const identityB = "sid_atom_b";
    const now = new Date().toISOString();
    const bindingA = {
      id: bindingIdForIdentity(identityA),
      sourceIdentityId: identityA,
      sourceLocator: `msrc://${identityA}`,
      status: "active" as const,
      scope,
      createdAt: now,
      updatedAt: now,
    };
    const bindingB = {
      id: bindingIdForIdentity(identityB),
      sourceIdentityId: identityB,
      sourceLocator: `msrc://${identityB}`,
      status: "active" as const,
      scope,
      createdAt: now,
      updatedAt: now,
    };
    const evA = makeEvidence(`msrc://${identityA}`, "atom source a phrase");
    const evB = makeEvidence(`msrc://${identityB}`, "atom source b phrase");
    await metadataStore.saveEvidence(evA);
    await metadataStore.saveEvidence(evB);
    await metadataStore.saveSourceBinding(bindingA);
    await metadataStore.saveSourceBinding(bindingB);
    await metadataStore.saveSourceObjectLink({
      id: linkIdFor(bindingA.id, evA.id),
      sourceBindingId: bindingA.id,
      objectType: "evidence",
      objectId: evA.id,
      linkRole: "primary_evidence",
      createdAt: now,
    });
    await metadataStore.saveSourceObjectLink({
      id: linkIdFor(bindingB.id, evB.id),
      sourceBindingId: bindingB.id,
      objectType: "evidence",
      objectId: evB.id,
      linkRole: "primary_evidence",
      createdAt: now,
    });
    const atom = makeAtom({
      id: "atom_multi_src",
      scope,
      evidenceRefs: [evA.id, evB.id],
      confidence: 1,
    });
    await metadataStore.saveAtom(atom);

    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      { metadataStore },
    );

    await engine.forgetSource({
      operationId: "op-atom-forget-a",
      selector: { mode: "identity", sourceIdentityId: identityA },
      subject: { scope },
      reasonCode: "TEST_ATOM_FORGET",
    });
    const afterForgetA = await metadataStore.getAtom(atom.id);
    expect(afterForgetA?.state.status).toBe("active");
    expect(afterForgetA?.provenance.evidenceRefs).toEqual([evB.id]);
    expect(afterForgetA?.metrics.confidence).toBe(0.5);

    await engine.forgetSource({
      operationId: "op-atom-forget-b",
      selector: { mode: "identity", sourceIdentityId: identityB },
      subject: { scope },
      reasonCode: "TEST_ATOM_FORGET",
    });
    const afterForgetB = await metadataStore.getAtom(atom.id);
    expect(afterForgetB?.state.status).toBe("deprecated");
    expect(afterForgetB?.provenance.evidenceRefs).toEqual([]);

    await engine.purgeSource({
      operationId: "op-atom-purge-b",
      selector: { mode: "identity", sourceIdentityId: identityB },
      subject: { scope },
      reasonCode: "TEST_ATOM_PURGE",
    });
    expect(await metadataStore.getAtom(atom.id)).toBeUndefined();
  });

  it("keeps multi-source events until all bindings are purged", async () => {
    const metadataStore = new InMemoryMetadataStore();
    const identityA = "sid_event_a";
    const identityB = "sid_event_b";
    const now = new Date().toISOString();
    const bindingA = {
      id: bindingIdForIdentity(identityA),
      sourceIdentityId: identityA,
      sourceLocator: `msrc://${identityA}`,
      status: "active" as const,
      scope,
      createdAt: now,
      updatedAt: now,
    };
    const bindingB = {
      id: bindingIdForIdentity(identityB),
      sourceIdentityId: identityB,
      sourceLocator: `msrc://${identityB}`,
      status: "active" as const,
      scope,
      createdAt: now,
      updatedAt: now,
    };
    const evA = makeEvidence(`msrc://${identityA}`, "event source a phrase");
    const evB = makeEvidence(`msrc://${identityB}`, "event source b phrase");
    await metadataStore.saveEvidence(evA);
    await metadataStore.saveEvidence(evB);
    await metadataStore.saveSourceBinding(bindingA);
    await metadataStore.saveSourceBinding(bindingB);
    await metadataStore.saveSourceObjectLink({
      id: linkIdFor(bindingA.id, evA.id),
      sourceBindingId: bindingA.id,
      objectType: "evidence",
      objectId: evA.id,
      linkRole: "primary_evidence",
      createdAt: now,
    });
    await metadataStore.saveSourceObjectLink({
      id: linkIdFor(bindingB.id, evB.id),
      sourceBindingId: bindingB.id,
      objectType: "evidence",
      objectId: evB.id,
      linkRole: "primary_evidence",
      createdAt: now,
    });
    const event: EventSkeleton = {
      id: "evt_multi_src",
      scope,
      goal: "multi-source event",
      context: "test",
      constraints: [],
      decisions: [],
      turningPoints: [],
      linkedAtoms: [],
      evidenceRefs: [evA.id, evB.id],
      provenance: {},
    };
    await metadataStore.upsertEvent(event);

    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      { metadataStore },
    );

    await engine.forgetSource({
      operationId: "op-event-forget-a",
      selector: { mode: "identity", sourceIdentityId: identityA },
      subject: { scope },
      reasonCode: "TEST_EVENT_FORGET",
    });
    expect(await metadataStore.getEvent(event.id)).toBeDefined();

    await engine.purgeSource({
      operationId: "op-event-purge-a",
      selector: { mode: "identity", sourceIdentityId: identityA },
      subject: { scope },
      reasonCode: "TEST_EVENT_PURGE",
    });
    expect(await metadataStore.getEvent(event.id)).toBeDefined();

    await engine.forgetSource({
      operationId: "op-event-forget-b",
      selector: { mode: "identity", sourceIdentityId: identityB },
      subject: { scope },
      reasonCode: "TEST_EVENT_FORGET",
    });
    await engine.purgeSource({
      operationId: "op-event-purge-b",
      selector: { mode: "identity", sourceIdentityId: identityB },
      subject: { scope },
      reasonCode: "TEST_EVENT_PURGE",
    });
    expect(await metadataStore.getEvent(event.id)).toBeUndefined();
  });

  it("recomputes multi-source relations on forget and deletes when purged orphan", async () => {
    const metadataStore = new InMemoryMetadataStore();
    const identityA = "sid_rel_a";
    const identityB = "sid_rel_b";
    const now = new Date().toISOString();
    const bindingA = {
      id: bindingIdForIdentity(identityA),
      sourceIdentityId: identityA,
      sourceLocator: `msrc://${identityA}`,
      status: "active" as const,
      scope,
      createdAt: now,
      updatedAt: now,
    };
    const bindingB = {
      id: bindingIdForIdentity(identityB),
      sourceIdentityId: identityB,
      sourceLocator: `msrc://${identityB}`,
      status: "active" as const,
      scope,
      createdAt: now,
      updatedAt: now,
    };
    const evA = makeEvidence(`msrc://${identityA}`, "relation source a phrase");
    const evB = makeEvidence(`msrc://${identityB}`, "relation source b phrase");
    await metadataStore.saveEvidence(evA);
    await metadataStore.saveEvidence(evB);
    await metadataStore.saveSourceBinding(bindingA);
    await metadataStore.saveSourceBinding(bindingB);
    await metadataStore.saveSourceObjectLink({
      id: linkIdFor(bindingA.id, evA.id),
      sourceBindingId: bindingA.id,
      objectType: "evidence",
      objectId: evA.id,
      linkRole: "primary_evidence",
      createdAt: now,
    });
    await metadataStore.saveSourceObjectLink({
      id: linkIdFor(bindingB.id, evB.id),
      sourceBindingId: bindingB.id,
      objectType: "evidence",
      objectId: evB.id,
      linkRole: "primary_evidence",
      createdAt: now,
    });
    const atomA = makeAtom({ id: "atom_rel_a", scope, evidenceRefs: [evA.id] });
    const atomB = makeAtom({ id: "atom_rel_b", scope, evidenceRefs: [evB.id] });
    await metadataStore.saveAtom(atomA);
    await metadataStore.saveAtom(atomB);
    const relation: RelationRecord = {
      id: "rel_multi_src",
      fromId: atomA.id,
      fromNodeType: "MemoryAtom",
      relationType: "SUPPORTED_BY",
      toId: atomB.id,
      toNodeType: "MemoryAtom",
      scope,
      confidence: 0.9,
      status: "active",
      provenance: { sourceEventIds: [], evidenceRefs: [evA.id, evB.id] },
    };
    await metadataStore.saveRelation(relation);

    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      { metadataStore },
    );

    await engine.forgetSource({
      operationId: "op-rel-forget-a",
      selector: { mode: "identity", sourceIdentityId: identityA },
      subject: { scope },
      reasonCode: "TEST_REL_FORGET",
    });
    const afterForgetA = await metadataStore.getRelation(relation.id);
    expect(afterForgetA?.status).toBe("active");
    expect(afterForgetA?.provenance.evidenceRefs).toEqual([evB.id]);

    await engine.forgetSource({
      operationId: "op-rel-forget-b",
      selector: { mode: "identity", sourceIdentityId: identityB },
      subject: { scope },
      reasonCode: "TEST_REL_FORGET",
    });
    const afterForgetB = await metadataStore.getRelation(relation.id);
    expect(afterForgetB?.status).toBe("deprecated");
    expect(afterForgetB?.provenance.evidenceRefs).toEqual([]);

    await engine.purgeSource({
      operationId: "op-rel-purge-b",
      selector: { mode: "identity", sourceIdentityId: identityB },
      subject: { scope },
      reasonCode: "TEST_REL_PURGE",
    });
    expect(await metadataStore.getRelation(relation.id)).toBeUndefined();
  });

  it("recomputes multi-source entity/scenario/problem provenance and purges orphans", async () => {
    const metadataStore = new InMemoryMetadataStore();
    const identityA = "sid_esp_a";
    const identityB = "sid_esp_b";
    const now = new Date().toISOString();
    const bindingA = {
      id: bindingIdForIdentity(identityA),
      sourceIdentityId: identityA,
      sourceLocator: `msrc://${identityA}`,
      status: "active" as const,
      scope,
      createdAt: now,
      updatedAt: now,
    };
    const bindingB = {
      id: bindingIdForIdentity(identityB),
      sourceIdentityId: identityB,
      sourceLocator: `msrc://${identityB}`,
      status: "active" as const,
      scope,
      createdAt: now,
      updatedAt: now,
    };
    const evA = makeEvidence(`msrc://${identityA}`, "esp source a phrase");
    const evB = makeEvidence(`msrc://${identityB}`, "esp source b phrase");
    await metadataStore.saveEvidence(evA);
    await metadataStore.saveEvidence(evB);
    await metadataStore.saveSourceBinding(bindingA);
    await metadataStore.saveSourceBinding(bindingB);
    await metadataStore.saveSourceObjectLink({
      id: linkIdFor(bindingA.id, evA.id),
      sourceBindingId: bindingA.id,
      objectType: "evidence",
      objectId: evA.id,
      linkRole: "primary_evidence",
      createdAt: now,
    });
    await metadataStore.saveSourceObjectLink({
      id: linkIdFor(bindingB.id, evB.id),
      sourceBindingId: bindingB.id,
      objectType: "evidence",
      objectId: evB.id,
      linkRole: "primary_evidence",
      createdAt: now,
    });

    const entity: EntityRecord = {
      id: "ent_multi_src",
      entityType: "person",
      name: "shared entity",
      aliases: [],
      tags: [],
      scope,
      provenance: { sourceEventIds: [], evidenceRefs: [evA.id, evB.id] },
    };
    const scenario: ScenarioRecord = {
      id: "scn_multi_src",
      name: "shared scenario",
      tags: [],
      summary: "multi-source scenario",
      scope,
      provenance: { sourceEventIds: [], evidenceRefs: [evA.id, evB.id] },
    };
    const problem: ProblemRecord = {
      id: "prob_multi_src",
      statement: "shared problem",
      normalizedStatement: "shared problem",
      tags: [],
      scope,
      provenance: { sourceEventIds: [], evidenceRefs: [evA.id, evB.id] },
    };
    await metadataStore.saveEntity(entity);
    await metadataStore.saveScenario(scenario);
    await metadataStore.saveProblem(problem);

    const engine = new InMemoryCogniWeaveEngine(
      {
        environment: "local",
        metadataBackend: "memory",
        graphBackend: "memory",
        evidenceBackend: "memory",
        vectorBackend: "memory",
      },
      { metadataStore },
    );

    await engine.forgetSource({
      operationId: "op-esp-forget-a",
      selector: { mode: "identity", sourceIdentityId: identityA },
      subject: { scope },
      reasonCode: "TEST_ESP_FORGET",
    });
    expect((await metadataStore.getEntity(entity.id))?.provenance.evidenceRefs).toEqual([evB.id]);
    expect((await metadataStore.getScenario(scenario.id))?.provenance.evidenceRefs).toEqual([
      evB.id,
    ]);
    expect((await metadataStore.getProblem(problem.id))?.provenance.evidenceRefs).toEqual([evB.id]);

    await engine.purgeSource({
      operationId: "op-esp-purge-a",
      selector: { mode: "identity", sourceIdentityId: identityA },
      subject: { scope },
      reasonCode: "TEST_ESP_PURGE",
    });
    expect(await metadataStore.getEntity(entity.id)).toBeDefined();
    expect(await metadataStore.getScenario(scenario.id)).toBeDefined();
    expect(await metadataStore.getProblem(problem.id)).toBeDefined();

    await engine.forgetSource({
      operationId: "op-esp-forget-b",
      selector: { mode: "identity", sourceIdentityId: identityB },
      subject: { scope },
      reasonCode: "TEST_ESP_FORGET",
    });
    expect((await metadataStore.getEntity(entity.id))?.provenance.evidenceRefs).toEqual([]);
    expect((await metadataStore.getScenario(scenario.id))?.provenance.evidenceRefs).toEqual([]);
    expect((await metadataStore.getProblem(problem.id))?.provenance.evidenceRefs).toEqual([]);

    await engine.purgeSource({
      operationId: "op-esp-purge-b",
      selector: { mode: "identity", sourceIdentityId: identityB },
      subject: { scope },
      reasonCode: "TEST_ESP_PURGE",
    });
    expect(await metadataStore.getEntity(entity.id)).toBeUndefined();
    expect(await metadataStore.getScenario(scenario.id)).toBeUndefined();
    expect(await metadataStore.getProblem(problem.id)).toBeUndefined();
  });
});
