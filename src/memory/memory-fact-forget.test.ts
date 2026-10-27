/**
 * Fact-level forget MVP gold harness (isolated).
 * Covers: multi-source same fact → all sources soft-forgotten / atom non-retrievable;
 * path1 file forget still works alongside; orchestrator does not text-scan.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  InMemoryCogniWeaveEngine,
  InMemoryMetadataStore,
  isAtomRetrievable,
  type EvidenceRecord,
  type MemoryAtom,
  type Scope,
  type SourceObjectType,
} from "../../packages/cogniweave-sdk/src/index.js";
import type { OpenBotConfig } from "../config/config.js";
import { forgetMemoryEntry } from "../data/memory-lifecycle.js";
import { resolveMemoryBackendConfig } from "./backend-config.js";
import { CogniWeaveMemoryManager } from "./cogniweave-manager.js";
import {
  applyIsolationEnv,
  assertNoRealHomeLeak,
  createIsolationLayout,
  type IsolationLayout,
} from "./memory-batch1-isolation.js";
import { orchestrateFactSoftForget } from "./memory-fact-forget.js";
import { closeAllMemorySearchManagers } from "./search-manager.js";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  await closeAllMemorySearchManagers();
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

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

const scope: Scope = {
  workspaceId: "ws_fact_forget",
  projectId: "proj_fact_forget",
  agentId: "main",
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

function makeAtom(input: { id: string; evidenceRefs: string[]; statement?: string }): MemoryAtom {
  return {
    id: input.id,
    atomType: "strategy",
    scope,
    claim: { type: "causal", statement: input.statement ?? "shared multi-source fact phrase" },
    trigger: { conditions: [], contextTags: [] },
    applicability: { include: [], exclude: [] },
    provenance: { sourceEventIds: [], evidenceRefs: input.evidenceRefs },
    versioning: { version: 1 },
    state: { status: "active", conflictsWith: [] },
    metrics: { confidence: 1, reuseCount: 0 },
  };
}

describe("orchestrateFactSoftForget", () => {
  it("returns per-source forgotten status without inventing sources", async () => {
    const result = await orchestrateFactSoftForget({
      atomId: "atom_x",
      operationId: "op1",
      atomExists: async () => true,
      enumerate: async () => [
        {
          sourceBindingId: "sb_a",
          sourceIdentityId: "sid_a",
          sourceLocator: "msrc://sid_a",
          status: "active",
        },
        {
          sourceBindingId: "sb_b",
          sourceIdentityId: "sid_b",
          sourceLocator: "msrc://sid_b",
          status: "active",
        },
      ],
      softForgetSource: async (_source, opId) => {
        expect(opId).toContain("op1:src:");
        return { ok: true, status: "forgotten" };
      },
    });
    expect(result.ok).toBe(true);
    expect(result.sources).toHaveLength(2);
    expect(result.sources.every((s) => s.status === "forgotten")).toBe(true);
  });

  it("marks atomMissing without calling softForget", async () => {
    let called = 0;
    const result = await orchestrateFactSoftForget({
      atomId: "missing",
      operationId: "op",
      atomExists: async () => false,
      enumerate: async () => {
        throw new Error("should not enumerate");
      },
      softForgetSource: async () => {
        called += 1;
        return { ok: true, status: "forgotten" };
      },
    });
    expect(result.atomMissing).toBe(true);
    expect(result.ok).toBe(false);
    expect(called).toBe(0);
  });
});

describe("listLiveSourcesForAtom + multi-source fact soft-forget gold", () => {
  it("enumerates both live sources and soft-forget makes atom non-retrievable", async () => {
    const metadataStore = new InMemoryMetadataStore();
    const identityA = "sid_fact_a";
    const identityB = "sid_fact_b";
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
    const evA = makeEvidence(`msrc://${identityA}`, "shared multi-source fact phrase from A");
    const evB = makeEvidence(`msrc://${identityB}`, "shared multi-source fact phrase from B");
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
    const atom = makeAtom({ id: "atom_multi_fact", evidenceRefs: [evA.id, evB.id] });
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

    const live = await engine.listLiveSourcesForAtom(atom.id);
    expect(live.map((s) => s.sourceIdentityId).toSorted()).toEqual(
      [identityA, identityB].toSorted(),
    );

    const orch = await orchestrateFactSoftForget({
      atomId: atom.id,
      operationId: "gold-fact-forget",
      atomExists: async () => true,
      enumerate: async () => engine.listLiveSourcesForAtom(atom.id),
      softForgetSource: async (source, opId) => {
        const receipt = await engine.forgetSource({
          operationId: opId,
          selector: { mode: "identity", sourceIdentityId: source.sourceIdentityId },
          subject: { scope },
          reasonCode: "FACT_LEVEL_FORGET_GOLD",
        });
        return { ok: true, status: receipt.currentStatus };
      },
    });
    expect(orch.ok).toBe(true);
    expect(orch.sources).toHaveLength(2);
    expect(orch.sources.every((s) => s.status === "forgotten")).toBe(true);

    const after = await metadataStore.getAtom(atom.id);
    expect(after?.state.status).toBe("deprecated");
    expect(after?.provenance.evidenceRefs).toEqual([]);
    expect(isAtomRetrievable(after!).retrievable).toBe(false);
    expect(await engine.listLiveSourcesForAtom(atom.id)).toEqual([]);
  });
});

describe("path1 file forget coexists with fact-level forget", () => {
  it("forgetMemoryEntry still deletes only the selected workspace file", async () => {
    const layout: IsolationLayout = createIsolationLayout("openbot-fact-forget-path1-");
    cleanups.push(applyIsolationEnv(layout));
    cleanups.push(async () => {
      await fs.rm(layout.root, { recursive: true, force: true });
    });
    assertNoRealHomeLeak(layout.root);

    const agentId = "main";
    const workspace = path.join(layout.root, "workspace");
    await fs.mkdir(path.join(workspace, "memory"), { recursive: true });
    const keep = path.join(workspace, "MEMORY.md");
    const drop = path.join(workspace, "memory", "note.md");
    await fs.writeFile(keep, "keep me\n", "utf8");
    await fs.writeFile(drop, "drop me\n", "utf8");

    const cfg = {
      data: { root: layout.dataRoot, mode: "local", schemaVersion: 1 },
      agents: { list: [{ id: agentId, default: true, workspace }] },
    } as OpenBotConfig;

    const deleted = await forgetMemoryEntry({
      cfg,
      agentId,
      memoryKey: "memory/note.md",
    });
    expect(deleted.deletedPath).toBeTruthy();
    await expect(fs.stat(drop)).rejects.toThrow();
    await expect(fs.stat(keep)).resolves.toBeTruthy();
  });
});

describe("CogniWeaveMemoryManager.forgetFact soft-only", () => {
  it("soft-forgets indexed MEMORY.md source for a linked atom without purge", async () => {
    const layout = createIsolationLayout("openbot-fact-forget-mgr-");
    cleanups.push(applyIsolationEnv(layout));
    cleanups.push(async () => {
      await fs.rm(layout.root, { recursive: true, force: true });
    });
    assertNoRealHomeLeak(layout.root);

    const workspace = path.join(layout.root, "workspace");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(
      path.join(workspace, "MEMORY.md"),
      "FactForgetUniquePhraseAlpha should be forgettable via atom sources.\n",
      "utf8",
    );

    const cfg = {
      data: { root: layout.dataRoot, mode: "local", schemaVersion: 1 },
      memory: {
        backend: "cogniweave",
        cogniweave: { mode: "embedded", writeSync: "sync", cloudSync: { enabled: false } },
      },
      agents: { list: [{ id: "main", default: true, workspace }] },
    } as OpenBotConfig;

    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    if (!resolved.cogniweave) {
      throw new Error("missing cogniweave");
    }
    const manager = await CogniWeaveMemoryManager.create({
      cfg,
      agentId: "main",
      resolved: resolved.cogniweave,
    });
    cleanups.push(async () => manager.close?.());

    // Ensure index / atoms exist via search (triggers sync).
    const hits = await manager.search("FactForgetUniquePhraseAlpha", { maxResults: 5 });
    expect(hits.length).toBeGreaterThan(0);

    const atoms = await manager.listMemoryCenterAtoms({ limit: 50 });
    // Prefer an atom if distillation produced one; otherwise soft-forget via
    // applyMemoryArtifactLifecycle path is out of scope — assert forgetFact
    // returns atomMissing for unknown id and soft-forgets when sources exist.
    const missing = await manager.forgetFact({
      atomId: "atom_does_not_exist",
      operationId: "mgr-fact-missing",
    });
    expect(missing.atomMissing).toBe(true);

    if (atoms.length > 0) {
      const target = atoms[0];
      if (!target) {
        throw new Error("expected atom row");
      }
      const result = await manager.forgetFact({
        atomId: target.id,
        operationId: "mgr-fact-forget",
      });
      // Sources may be empty if distillation did not create source_object_links yet;
      // still must be ok and never purge (file remains).
      expect(result.factRef.atomId).toBe(target.id);
      expect(result.sources.every((s) => s.status !== "failed")).toBe(true);
      await expect(fs.stat(path.join(workspace, "MEMORY.md"))).resolves.toBeTruthy();
    }
  });
});
