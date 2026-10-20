import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFileDataGovernanceCatalogStore,
  resetCatalogStoreSingletonsForTests,
} from "./catalog-store.js";
import { installCognitiveMutationFaultHookForTests } from "./cognitive-fault-slot.js";
import { createCognitiveProvenanceBindingUnique } from "./cognitive-provenance-internal.js";
import {
  getCognitiveProvenanceBinding,
  hashCognitiveGenerationProvenance,
  listCognitiveProvenanceHistory,
  provenanceBindingIdFor,
} from "./cognitive-provenance-store.js";
import { supersedeCognitiveProvenanceRef } from "./cognitive-update.js";
import { supersedeCognitiveProvenanceRefForTests } from "./cognitive-update.test-harness.js";
import { unlockCognitiveWritesForTests } from "./cognitive-write-unlock.test-harness.js";
import { validateGovernanceEnvelope } from "./envelope.js";
import type { CatalogRecord, CognitiveProvenanceRef } from "./types.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetCatalogStoreSingletonsForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpStateDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p3d-"));
  tempDirs.push(dir);
  return dir;
}

function memoryV1(): CatalogRecord {
  return {
    envelope: {
      resourceId: "mem-1",
      resourceType: "memory",
      schemaVersion: 1,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "tenant", tenantId: "t1" },
      lifecycleState: "active",
      classification: "confidential",
      governanceVersion: 1,
      canonicalBindingId: "bind-mem-1",
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:00:00Z",
      projection: { canonicalKind: "cogniweave", atomId: "a1", memoryTier: "working" },
    },
    bindings: [
      {
        bindingId: "bind-mem-1",
        resourceId: "mem-1",
        role: "canonical",
        storageKind: "filesystem",
        locator: "/data/mem-1",
        state: "active",
        contentVersion: "v1",
      },
    ],
  };
}

function unlock(stateDir: string): void {
  unlockCognitiveWritesForTests(stateDir);
}

async function setupMemory(stateDir: string) {
  unlock(stateDir);
  const catalog = createFileDataGovernanceCatalogStore({
    storePath: path.join(stateDir, "data-governance", "catalog.json"),
  });
  await catalog.put(memoryV1());
  return { catalog };
}

function ref(overrides: Partial<CognitiveProvenanceRef> = {}): CognitiveProvenanceRef {
  return {
    schemaPackage: "cogniweave-sdk",
    nodeType: "MemoryAtom",
    objectId: "atom-1",
    version: 1,
    provenanceHash: hashCognitiveGenerationProvenance({
      representationSchemaVersion: 1,
      algorithmVersion: "cw-atom-v2",
      admissionPolicyVersion: "admit-v1",
      normalizationVersion: "norm-v1",
      sourceEventIds: ["evt-1"],
      evidenceRefs: ["ev-1"],
      generatedAt: "2026-08-14T00:00:00Z",
    }),
    ...overrides,
  };
}

describe("P3-d supersedeCognitiveProvenanceRef", () => {
  it("unique-creates a binding and CAS-updates current + head only", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const firstRef = ref();
    const first = await supersedeCognitiveProvenanceRef({
      resourceId: "mem-1",
      expectedGovernanceVersion: 1,
      actor: { kind: "operator", operatorId: "op-1" },
      next: firstRef,
      mutationId: "mut-prov-1",
      stateDir,
      catalog,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.receipt.status).toBe("applied");
    expect(first.record.envelope.schemaVersion).toBe(2);
    expect(first.record.envelope.cognitiveProvenanceRef).toEqual(firstRef);
    const headId = first.record.envelope.cognitiveProvenanceBindingId;
    expect(headId).toBe(provenanceBindingIdFor({ resourceId: "mem-1", ref: firstRef }));
    expect(
      (first.record.envelope as { previousCognitiveProvenanceRefs?: unknown })
        .previousCognitiveProvenanceRefs,
    ).toBeUndefined();
    const stored = getCognitiveProvenanceBinding({
      resourceId: "mem-1",
      tenantId: "t1",
      bindingId: headId!,
      stateDir,
    });
    expect(stored?.previousBindingId).toBeNull();
    expect(stored?.ref).toEqual(firstRef);

    const secondRef = ref({
      version: 2,
      provenanceHash: hashCognitiveGenerationProvenance({ algorithmVersion: "cw-atom-v3" }),
    });
    const second = await supersedeCognitiveProvenanceRef({
      resourceId: "mem-1",
      expectedGovernanceVersion: 2,
      actor: { kind: "system", systemId: "sys-1" },
      next: secondRef,
      mutationId: "mut-prov-2",
      stateDir,
      catalog,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.record.envelope.cognitiveProvenanceRef).toEqual(secondRef);
    expect(second.record.envelope.cognitiveProvenanceBindingId).toBe(
      provenanceBindingIdFor({ resourceId: "mem-1", ref: secondRef }),
    );
    expect(stored?.ref).toEqual(firstRef);
    const history = listCognitiveProvenanceHistory({
      resourceId: "mem-1",
      tenantId: "t1",
      headBindingId: second.record.envelope.cognitiveProvenanceBindingId!,
      stateDir,
    });
    expect(history.bindings.map((row) => row.ref.version)).toEqual([2, 1]);
    expect(history.bindings[0]?.previousBindingId).toBe(headId);
  });

  it("denies worker/user and lower or equal CogniWeave versions", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const firstRef = ref();
    expect(
      await supersedeCognitiveProvenanceRef({
        resourceId: "mem-1",
        expectedGovernanceVersion: 1,
        actor: { kind: "worker", workerId: "w1" },
        next: firstRef,
        mutationId: "mut-worker",
        stateDir,
        catalog,
      }),
    ).toMatchObject({ ok: false, error: "actor_not_authorized" });
    expect(
      await supersedeCognitiveProvenanceRef({
        resourceId: "mem-1",
        expectedGovernanceVersion: 1,
        actor: { kind: "user", userId: "u1" },
        next: firstRef,
        mutationId: "mut-user",
        stateDir,
        catalog,
      }),
    ).toMatchObject({ ok: false, error: "actor_not_authorized" });
    const first = await supersedeCognitiveProvenanceRef({
      resourceId: "mem-1",
      expectedGovernanceVersion: 1,
      actor: { kind: "operator", operatorId: "op-1" },
      next: firstRef,
      mutationId: "mut-ok",
      stateDir,
      catalog,
    });
    expect(first.ok).toBe(true);
    expect(
      await supersedeCognitiveProvenanceRef({
        resourceId: "mem-1",
        expectedGovernanceVersion: 2,
        actor: { kind: "operator", operatorId: "op-1" },
        next: firstRef,
        mutationId: "mut-same-ver",
        stateDir,
        catalog,
      }),
    ).toMatchObject({ ok: false, error: "provenance_supersession_invalid" });
    expect(
      await supersedeCognitiveProvenanceRef({
        resourceId: "mem-1",
        expectedGovernanceVersion: 2,
        actor: { kind: "operator", operatorId: "op-1" },
        next: ref({ version: 1, provenanceHash: "other-hash" }),
        mutationId: "mut-same-ver-diff-hash",
        stateDir,
        catalog,
      }),
    ).toMatchObject({ ok: false, error: "provenance_supersession_invalid" });
  });

  it("replays identical unique-key bytes and rejects a different hash for the same version", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const firstRef = ref();
    const first = await supersedeCognitiveProvenanceRef({
      resourceId: "mem-1",
      expectedGovernanceVersion: 1,
      actor: { kind: "operator", operatorId: "op-1" },
      next: firstRef,
      mutationId: "mut-replay",
      stateDir,
      catalog,
    });
    expect(first.ok).toBe(true);
    const replay = await supersedeCognitiveProvenanceRef({
      resourceId: "mem-1",
      expectedGovernanceVersion: 1,
      actor: { kind: "operator", operatorId: "op-1" },
      next: firstRef,
      mutationId: "mut-replay",
      stateDir,
      catalog,
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.receipt.status).toBe("applied");
      expect(replay.record.envelope.governanceVersion).toBe(2);
    }
    const mismatch = await createCognitiveProvenanceBindingUnique({
      resourceId: "mem-1",
      tenantId: "t1",
      ref: { ...firstRef, provenanceHash: "different-hash" },
      previousBindingId: null,
      actor: { kind: "operator", operatorId: "op-1" },
      stateDir,
    });
    expect(mismatch).toEqual({ ok: false, error: "idempotent_mismatch" });
  });

  it("rejects provenance arrays on the envelope and on the Catalog ref", async () => {
    expect(
      validateGovernanceEnvelope({
        ...memoryV1().envelope,
        schemaVersion: 2,
        sourceEventIds: ["evt-1"],
        evidenceRefs: ["ev-1"],
      }).ok,
    ).toBe(false);
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    expect(
      await supersedeCognitiveProvenanceRef({
        resourceId: "mem-1",
        expectedGovernanceVersion: 1,
        actor: { kind: "operator", operatorId: "op-1" },
        next: {
          ...ref(),
          sourceEventIds: ["evt-1"],
          evidenceRefs: ["ev-1"],
        },
        mutationId: "mut-arrays",
        stateDir,
        catalog,
      }),
    ).toMatchObject({ ok: false, error: "invalid_cognitive_field" });
  });

  it("stays schema_write_locked without fleet unlock and does not import P2 purge", async () => {
    expect(
      await supersedeCognitiveProvenanceRef({
        resourceId: "mem-1",
        expectedGovernanceVersion: 1,
        actor: { kind: "operator", operatorId: "op-1" },
        next: ref(),
      }),
    ).toEqual({ ok: false, error: "schema_write_locked" });
    const source = fs.readFileSync(
      path.join(path.resolve(import.meta.dirname), "cognitive-update.ts"),
      "utf8",
    );
    for (const token of ["lifecycle-purge", "requestPurge", "resumePurge", "forget"]) {
      expect(source.includes(token), token).toBe(false);
    }
  });

  it("keeps the winner in history when a same-expected loser retries a stale orphan", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const headRef = ref();
    const first = await supersedeCognitiveProvenanceRef({
      resourceId: "mem-1",
      expectedGovernanceVersion: 1,
      actor: { kind: "operator", operatorId: "op-1" },
      next: headRef,
      mutationId: "mut-head",
      stateDir,
      catalog,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const headH1 = first.record.envelope.cognitiveProvenanceBindingId!;
    const winnerRef = ref({
      version: 2,
      provenanceHash: hashCognitiveGenerationProvenance({ algorithmVersion: "cw-atom-v2-win" }),
    });
    const loserRef = ref({
      version: 3,
      provenanceHash: hashCognitiveGenerationProvenance({ algorithmVersion: "cw-atom-v3-lose" }),
    });
    const loserFirst = await supersedeCognitiveProvenanceRefForTests(
      {
        resourceId: "mem-1",
        expectedGovernanceVersion: 2,
        actor: { kind: "operator", operatorId: "op-lose" },
        next: loserRef,
        mutationId: "mut-lose-1",
        stateDir,
        catalog,
      },
      {
        beforeCatalogCas: async () => {
          installCognitiveMutationFaultHookForTests(undefined);
          const winner = await supersedeCognitiveProvenanceRef({
            resourceId: "mem-1",
            expectedGovernanceVersion: 2,
            actor: { kind: "system", systemId: "sys-win" },
            next: winnerRef,
            mutationId: "mut-win",
            stateDir,
            catalog,
          });
          expect(winner.ok).toBe(true);
        },
      },
    );
    expect(loserFirst.ok).toBe(false);
    const afterWin = await catalog.get("mem-1");
    const headH2 = afterWin?.envelope.cognitiveProvenanceBindingId;
    expect(headH2).toBe(provenanceBindingIdFor({ resourceId: "mem-1", ref: winnerRef }));
    const orphan = getCognitiveProvenanceBinding({
      resourceId: "mem-1",
      tenantId: "t1",
      bindingId: provenanceBindingIdFor({ resourceId: "mem-1", ref: loserRef }),
      stateDir,
    });
    expect(orphan?.previousBindingId).toBe(headH1);
    const loserRetry = await supersedeCognitiveProvenanceRef({
      resourceId: "mem-1",
      expectedGovernanceVersion: 3,
      actor: { kind: "operator", operatorId: "op-lose" },
      next: loserRef,
      mutationId: "mut-lose-2",
      stateDir,
      catalog,
    });
    expect(loserRetry).toMatchObject({ ok: false, error: "provenance_supersession_invalid" });
    const stillWinner = listCognitiveProvenanceHistory({
      resourceId: "mem-1",
      tenantId: "t1",
      headBindingId: headH2!,
      stateDir,
    });
    expect(stillWinner.bindings.map((row) => row.ref.version)).toEqual([2, 1]);
    const higher = await supersedeCognitiveProvenanceRef({
      resourceId: "mem-1",
      expectedGovernanceVersion: 3,
      actor: { kind: "operator", operatorId: "op-lose" },
      next: ref({
        version: 4,
        provenanceHash: hashCognitiveGenerationProvenance({ algorithmVersion: "cw-atom-v4" }),
      }),
      mutationId: "mut-lose-3",
      stateDir,
      catalog,
    });
    expect(higher.ok).toBe(true);
    if (!higher.ok) {
      return;
    }
    const history = listCognitiveProvenanceHistory({
      resourceId: "mem-1",
      tenantId: "t1",
      headBindingId: higher.record.envelope.cognitiveProvenanceBindingId!,
      stateDir,
    });
    expect(history.bindings.map((row) => row.ref.version)).toEqual([4, 2, 1]);
    expect(history.bindings[1]?.bindingId).toBe(headH2);
  });

  it("rejects a stored binding whose resource partition does not match the request", () => {
    const stateDir = tmpStateDir();
    const bindingId = provenanceBindingIdFor({ resourceId: "mem-1", ref: ref() });
    const dest = path.join(
      stateDir,
      "data-governance",
      "cognitive-provenance",
      "t1",
      "mem-1",
      `${bindingId}.json`,
    );
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(
      dest,
      `${JSON.stringify({
        bindingId,
        resourceId: "mem-other",
        tenantId: "t1",
        ref: ref(),
        previousBindingId: null,
        createdAt: "2026-08-14T00:00:00Z",
        actor: { kind: "operator", operatorId: "op-1" },
      })}\n`,
    );
    expect(
      getCognitiveProvenanceBinding({
        resourceId: "mem-1",
        tenantId: "t1",
        bindingId,
        stateDir,
      }),
    ).toBeNull();
  });
});
