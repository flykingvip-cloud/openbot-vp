import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFileDataGovernanceCatalogStore,
  resetCatalogStoreSingletonsForTests,
} from "./catalog-store.js";
import {
  createCognitiveMutationReceiptUnique,
  getCognitiveMutationReceipt,
} from "./cognitive-mutation-store.js";
import { recoverCognitiveMutation, updateCognitiveGovernance } from "./cognitive-update.js";
import { updateCognitiveGovernanceForTests } from "./cognitive-update.test-harness.js";
import { unlockCognitiveWritesForTests } from "./cognitive-write-unlock.test-harness.js";
import { CATALOG_FIELD_LIMITS } from "./limits.js";
import type { CatalogRecord } from "./types.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetCatalogStoreSingletonsForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpStateDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p3a-r1-"));
  tempDirs.push(dir);
  return dir;
}

function memoryV1(resourceId = "mem-1"): CatalogRecord {
  return {
    envelope: {
      resourceId,
      resourceType: "memory",
      schemaVersion: 1,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "user", userId: "u1" },
      lifecycleState: "active",
      classification: "confidential",
      governanceVersion: 1,
      canonicalBindingId: `bind-${resourceId}`,
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:00:00Z",
      projection: { canonicalKind: "cogniweave", atomId: "a1", memoryTier: "working" },
    },
    bindings: [
      {
        bindingId: `bind-${resourceId}`,
        resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: `/data/${resourceId}`,
        state: "active",
        contentVersion: "v1",
      },
    ],
  };
}

function unlock(stateDir: string): void {
  unlockCognitiveWritesForTests(stateDir);
}

async function setupMemory(stateDir: string): Promise<{
  catalog: ReturnType<typeof createFileDataGovernanceCatalogStore>;
}> {
  unlock(stateDir);
  const catalog = createFileDataGovernanceCatalogStore({
    storePath: path.join(stateDir, "data-governance", "catalog.json"),
  });
  await catalog.put(memoryV1());
  return { catalog };
}

describe("P3-a R1 updateCognitiveGovernance", () => {
  it("stays schema_write_locked without fleet write-unlock", async () => {
    const stateDir = tmpStateDir();
    const catalog = createFileDataGovernanceCatalogStore({
      storePath: path.join(stateDir, "data-governance", "catalog.json"),
    });
    await catalog.put(memoryV1());
    const result = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 1,
      actor: { kind: "operator", operatorId: "op-1" },
      patch: { cognitiveTier: "C2" },
      mutationId: "mut-locked",
      stateDir,
      catalog,
    });
    expect(result).toEqual({ ok: false, error: "schema_write_locked" });
  });

  it("ordinary Catalog caller cannot change cognitive fields or marker even with a forged allow flag", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const current = (await catalog.get("mem-1"))!;
    const forged = {
      resourceId: "mem-1",
      expectedGovernanceVersion: 1,
      allowCognitiveMutation: true,
      next: {
        ...current,
        envelope: {
          ...current.envelope,
          schemaVersion: 2 as const,
          governanceVersion: 2,
          updatedAt: "2026-08-13T05:00:00Z",
          cognitiveTier: "C4" as const,
          lastCognitiveMutationId: "mut-forged",
        },
      },
    };
    await expect(catalog.compareAndPut(forged)).rejects.toThrow(/schema_write_locked/);
    await expect(
      catalog.put({
        ...current,
        envelope: {
          ...current.envelope,
          schemaVersion: 2,
          cognitiveTier: "C4",
          lastCognitiveMutationId: "mut-forged",
        },
      }),
    ).rejects.toThrow(/schema_write_locked/);
    const after = await catalog.get("mem-1");
    expect(after?.envelope.schemaVersion).toBe(1);
    expect(after?.envelope.cognitiveTier).toBeUndefined();
    expect(after?.envelope.lastCognitiveMutationId).toBeUndefined();
    expect(after?.envelope.governanceVersion).toBe(1);
  });

  it("replays the same mutation when patch key order differs", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const actor = { kind: "operator" as const, operatorId: "op-1" };
    const first = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 1,
      actor,
      patch: {
        retrievalPatch: {
          eligibility: "eligible",
          basePriority: 0.8,
          freshnessPolicyId: "fresh-1",
          applicabilityPolicyId: "app-1",
        },
      },
      mutationId: "mut-key-order",
      stateDir,
      catalog,
    });
    expect(first.ok).toBe(true);
    const replay = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 1,
      actor: { operatorId: "op-1", kind: "operator" },
      patch: {
        retrievalPatch: {
          applicabilityPolicyId: "app-1",
          freshnessPolicyId: "fresh-1",
          basePriority: 0.8,
          eligibility: "eligible",
        },
      },
      mutationId: "mut-key-order",
      stateDir,
      catalog,
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.receipt.status).toBe("applied");
      expect(replay.record.envelope.governanceVersion).toBe(2);
      expect(replay.record.envelope.retrievalGovernance).toEqual({
        applicabilityPolicyId: "app-1",
        basePriority: 0.8,
        eligibility: "eligible",
        freshnessPolicyId: "fresh-1",
      });
    }
  });

  it("operator write upgrades v1→v2 and finalizes applied", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const result = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 1,
      actor: { kind: "operator", operatorId: "op-1" },
      patch: { cognitiveTier: "C2" },
      mutationId: "mut-ok",
      stateDir,
      catalog,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.receipt.status).toBe("applied");
      expect(result.receipt.resultingGovernanceVersion).toBe(2);
      expect(result.record.envelope.schemaVersion).toBe(2);
      expect(result.record.envelope.cognitiveTier).toBe("C2");
      expect(result.record.envelope.lastCognitiveMutationId).toBe("mut-ok");
    }
  });

  it("denies user writes and worker raising eligibility/priority", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 1,
      actor: { kind: "operator", operatorId: "op-1" },
      patch: {
        retrievalPatch: {
          eligibility: "eligible",
          basePriority: 0.8,
          freshnessPolicyId: "fresh-1",
          applicabilityPolicyId: "app-1",
        },
      },
      mutationId: "mut-seed",
      stateDir,
      catalog,
    });
    const user = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 2,
      actor: { kind: "user", userId: "u1" },
      patch: { cognitiveTier: "C3" },
      mutationId: "mut-user",
      stateDir,
      catalog,
    });
    expect(user).toMatchObject({ ok: false, error: "actor_not_authorized" });
    const workerLeft = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 2,
      actor: { kind: "worker", workerId: "w1" },
      patch: { retrievalPatch: { eligibility: "retired" } },
      mutationId: "mut-w-ok",
      stateDir,
      catalog,
    });
    expect(workerLeft.ok).toBe(true);
    if (workerLeft.ok) {
      expect(workerLeft.record.envelope.retrievalGovernance?.freshnessPolicyId).toBe("fresh-1");
      expect(workerLeft.record.envelope.retrievalGovernance?.applicabilityPolicyId).toBe("app-1");
    }
    const workerBack = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 3,
      actor: { kind: "worker", workerId: "w1" },
      patch: { retrievalPatch: { eligibility: "eligible" } },
      mutationId: "mut-w-back",
      stateDir,
      catalog,
    });
    expect(workerBack).toMatchObject({ ok: false, error: "eligibility_not_monotonic" });
    const workerRaise = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 3,
      actor: { kind: "worker", workerId: "w1" },
      patch: { retrievalPatch: { basePriority: 0.9 } },
      mutationId: "mut-w-raise",
      stateDir,
      catalog,
    });
    expect(workerRaise).toMatchObject({ ok: false, error: "priority_not_monotonic" });
  });

  it("rejects unknown retrievalPatch fields", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const denied = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 1,
      actor: { kind: "operator", operatorId: "op-1" },
      patch: {
        retrievalPatch: {
          eligibility: "retired",
          unexpected: true,
        },
      },
      mutationId: "mut-unknown-patch",
      stateDir,
      catalog,
    });
    expect(denied).toMatchObject({ ok: false, error: "field_not_writable" });
    const after = await catalog.get("mem-1");
    expect(after?.envelope.governanceVersion).toBe(1);
    expect(after?.envelope.retrievalGovernance).toBeUndefined();
  });

  it("rejects illegal patch values before creating a mutation receipt", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const actor = { kind: "operator" as const, operatorId: "op-1" };
    const cases: Array<{ mutationId: string; patch: Record<string, unknown> }> = [
      { mutationId: "mut-bad-tier", patch: { cognitiveTier: "C9" } },
      { mutationId: "mut-bad-preservation", patch: { preservationPriority: "urgent" } },
      { mutationId: "mut-bad-eligibility", patch: { retrievalPatch: { eligibility: "paused" } } },
      { mutationId: "mut-empty-policy", patch: { retrievalPatch: { freshnessPolicyId: "   " } } },
      {
        mutationId: "mut-long-policy",
        patch: {
          retrievalPatch: {
            applicabilityPolicyId: "x".repeat(CATALOG_FIELD_LIMITS.bindingIdMax + 1),
          },
        },
      },
      { mutationId: "mut-bad-priority", patch: { retrievalPatch: { basePriority: Number.NaN } } },
      { mutationId: "mut-priority-high", patch: { retrievalPatch: { basePriority: 1.1 } } },
      {
        mutationId: "mut-priority-inf",
        patch: { retrievalPatch: { basePriority: Number.POSITIVE_INFINITY } },
      },
    ];
    for (const c of cases) {
      const denied = await updateCognitiveGovernance({
        resourceId: "mem-1",
        expectedGovernanceVersion: 1,
        actor,
        patch: c.patch,
        mutationId: c.mutationId,
        stateDir,
        catalog,
      });
      expect(denied, c.mutationId).toMatchObject({ ok: false, error: "invalid_cognitive_field" });
      expect(
        getCognitiveMutationReceipt({
          mutationId: c.mutationId,
          tenantId: "t1",
          stateDir,
        }),
        c.mutationId,
      ).toBeNull();
    }
    const after = await catalog.get("mem-1");
    expect(after?.envelope.governanceVersion).toBe(1);
    expect(after?.envelope.cognitiveTier).toBeUndefined();
  });

  it("denies worker policy ids, missing retrievalGovernance, blocked reverse, and blocked lifecycles", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const worker = { kind: "worker" as const, workerId: "w1" };
    const operator = { kind: "operator" as const, operatorId: "op-1" };
    const missing = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 1,
      actor: worker,
      patch: { retrievalPatch: { eligibility: "retired" } },
      mutationId: "mut-missing-rg",
      stateDir,
      catalog,
    });
    expect(missing).toMatchObject({ ok: false, error: "retrieval_governance_missing" });
    const seeded = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 1,
      actor: operator,
      patch: {
        retrievalPatch: {
          eligibility: "eligible",
          basePriority: 0.5,
          freshnessPolicyId: "fresh-1",
          applicabilityPolicyId: "app-1",
        },
      },
      mutationId: "mut-rg-seed",
      stateDir,
      catalog,
    });
    expect(seeded.ok).toBe(true);
    const policy = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 2,
      actor: worker,
      patch: { retrievalPatch: { freshnessPolicyId: "fresh-2" } },
      mutationId: "mut-policy",
      stateDir,
      catalog,
    });
    expect(policy).toMatchObject({ ok: false, error: "actor_not_authorized" });
    const retired = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 2,
      actor: worker,
      patch: { retrievalPatch: { eligibility: "retired" } },
      mutationId: "mut-retired",
      stateDir,
      catalog,
    });
    expect(retired.ok).toBe(true);
    const blocked = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 3,
      actor: worker,
      patch: { retrievalPatch: { eligibility: "blocked" } },
      mutationId: "mut-blocked",
      stateDir,
      catalog,
    });
    expect(blocked.ok).toBe(true);
    const reverse = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 4,
      actor: worker,
      patch: { retrievalPatch: { eligibility: "retired" } },
      mutationId: "mut-unblock",
      stateDir,
      catalog,
    });
    expect(reverse).toMatchObject({ ok: false, error: "eligibility_not_monotonic" });

    const activeOp = memoryV1("mem-op");
    activeOp.envelope.activeLifecycleOperation = {
      operationId: "forget-1",
      command: "forget",
      receiptId: "rcpt-1",
      previousLifecycleState: "active",
      startedAt: "2026-08-13T00:00:00Z",
    };
    await catalog.put(activeOp);
    const activeDenied = await updateCognitiveGovernance({
      resourceId: "mem-op",
      expectedGovernanceVersion: 1,
      actor: operator,
      patch: { cognitiveTier: "C1" },
      mutationId: "mut-active-op",
      stateDir,
      catalog,
    });
    expect(activeDenied).toMatchObject({ ok: false, error: "active_operation_blocks_write" });

    for (const lifecycleState of [
      "purged",
      "deletion_pending",
      "recovery_required",
      "quarantined",
    ] as const) {
      const row = memoryV1(`mem-${lifecycleState}`);
      row.envelope.lifecycleState = lifecycleState;
      await catalog.put(row);
      const denied = await updateCognitiveGovernance({
        resourceId: `mem-${lifecycleState}`,
        expectedGovernanceVersion: 1,
        actor: operator,
        patch: { cognitiveTier: "C1" },
        mutationId: `mut-${lifecycleState}`,
        stateDir,
        catalog,
      });
      expect(denied).toMatchObject({ ok: false, error: "lifecycle_blocks_write" });
    }

    const convo = memoryV1("convo-1");
    convo.envelope.resourceType = "conversation_archive";
    delete convo.envelope.projection;
    await catalog.put(convo);
    const typeDenied = await updateCognitiveGovernance({
      resourceId: "convo-1",
      expectedGovernanceVersion: 1,
      actor: operator,
      patch: { cognitiveTier: "C1" },
      mutationId: "mut-type",
      stateDir,
      catalog,
    });
    expect(typeDenied).toMatchObject({ ok: false, error: "command_denied_for_type" });
  });

  it("crash after CAS before finalize heals to applied without a second patch", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    await expect(
      updateCognitiveGovernanceForTests(
        {
          resourceId: "mem-1",
          expectedGovernanceVersion: 1,
          actor: { kind: "operator", operatorId: "op-1" },
          patch: { cognitiveTier: "C1" },
          mutationId: "mut-crash-after",
          stateDir,
          catalog,
        },
        {
          afterCatalogCasBeforeFinalize: () => {
            throw new Error("injected_crash_after_cas");
          },
        },
      ),
    ).rejects.toThrow(/injected_crash_after_cas/);
    const recovered = await recoverCognitiveMutation({
      mutationId: "mut-crash-after",
      tenantId: "t1",
      stateDir,
      catalog,
    });
    expect(recovered.ok).toBe(true);
    if (recovered.ok) {
      expect(recovered.receipt.status).toBe("applied");
      expect(recovered.record.envelope.cognitiveTier).toBe("C1");
      expect(recovered.record.envelope.governanceVersion).toBe(2);
    }
  });

  it("crash before CAS keeps prepared; replay retries and applies", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const actor = { kind: "operator" as const, operatorId: "op-1" };
    const patch = { cognitiveTier: "C2" };
    await expect(
      updateCognitiveGovernanceForTests(
        {
          resourceId: "mem-1",
          expectedGovernanceVersion: 1,
          actor,
          patch,
          mutationId: "mut-crash-before",
          stateDir,
          catalog,
        },
        {
          beforeCatalogCas: () => {
            throw new Error("injected_crash_before_cas");
          },
        },
      ),
    ).rejects.toThrow(/injected_crash_before_cas/);
    const before = await catalog.get("mem-1");
    expect(before?.envelope.governanceVersion).toBe(1);
    const recovered = await recoverCognitiveMutation({
      mutationId: "mut-crash-before",
      tenantId: "t1",
      stateDir,
      catalog,
    });
    expect(recovered.ok).toBe(false);
    expect(recovered.receipt?.status).toBe("prepared");
    const replay = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 1,
      actor,
      patch,
      mutationId: "mut-crash-before",
      stateDir,
      catalog,
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) {
      expect(replay.receipt.status).toBe("applied");
      expect(replay.record.envelope.cognitiveTier).toBe("C2");
      expect(replay.record.envelope.governanceVersion).toBe(2);
    }
  });

  it("two prepared mutations at one expected version: winner applied, loser conflicted", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const actor = { kind: "operator" as const, operatorId: "op-1" };
    const [a, b] = await Promise.all([
      updateCognitiveGovernance({
        resourceId: "mem-1",
        expectedGovernanceVersion: 1,
        actor,
        patch: { cognitiveTier: "C2" },
        mutationId: "mut-win",
        stateDir,
        catalog,
      }),
      updateCognitiveGovernance({
        resourceId: "mem-1",
        expectedGovernanceVersion: 1,
        actor,
        patch: { preservationPriority: "important" },
        mutationId: "mut-lose",
        stateDir,
        catalog,
      }),
    ]);
    const applied = [a, b].filter((r) => r.ok);
    const conflicted = [a, b].filter((r) => !r.ok && "error" in r && r.error === "conflicted");
    expect(applied).toHaveLength(1);
    expect(conflicted).toHaveLength(1);
    const final = (await catalog.get("mem-1"))!;
    expect(final.envelope.governanceVersion).toBe(2);
    expect(
      final.envelope.lastCognitiveMutationId === "mut-win" ||
        final.envelope.lastCognitiveMutationId === "mut-lose",
    ).toBe(true);
  });

  it("B fences A after A CAS crash; final A=applied and B=applied", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    await expect(
      updateCognitiveGovernanceForTests(
        {
          resourceId: "mem-1",
          expectedGovernanceVersion: 1,
          actor: { kind: "operator", operatorId: "op-1" },
          patch: { cognitiveTier: "C1" },
          mutationId: "mut-a",
          stateDir,
          catalog,
        },
        {
          afterCatalogCasBeforeFinalize: () => {
            throw new Error("injected_crash_after_cas");
          },
        },
      ),
    ).rejects.toThrow(/injected_crash_after_cas/);
    const b = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 2,
      actor: { kind: "operator", operatorId: "op-1" },
      patch: { preservationPriority: "important" },
      mutationId: "mut-b",
      stateDir,
      catalog,
    });
    expect(b.ok).toBe(true);
    const recoveredA = await recoverCognitiveMutation({
      mutationId: "mut-a",
      tenantId: "t1",
      stateDir,
      catalog,
    });
    expect(recoveredA.ok).toBe(true);
    if (recoveredA.ok && b.ok) {
      expect(recoveredA.receipt.status).toBe("applied");
      expect(b.receipt.status).toBe("applied");
      expect(b.record.envelope.lastCognitiveMutationId).toBe("mut-b");
    }
  });

  it("marker match with wrong version returns catalog_corrupt and keeps prepared", async () => {
    const stateDir = tmpStateDir();
    unlock(stateDir);
    const filePath = path.join(stateDir, "data-governance", "catalog.json");
    const seeded = memoryV1();
    seeded.envelope.schemaVersion = 2;
    seeded.envelope.governanceVersion = 4;
    seeded.envelope.lastCognitiveMutationId = "mut-badver";
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      `${JSON.stringify({ schemaVersion: 1, revision: 1, records: { "mem-1": seeded } }, null, 2)}\n`,
    );
    const catalog = createFileDataGovernanceCatalogStore({ storePath: filePath });
    await createCognitiveMutationReceiptUnique({
      mutationId: "mut-badver",
      requestFingerprint: "fp-badver",
      resourceId: "mem-1",
      tenantId: "t1",
      command: "updateCognitiveGovernance",
      expectedGovernanceVersion: 1,
      requestedBy: { kind: "operator", operatorId: "op-1" },
      executedBy: { kind: "operator", operatorId: "op-1" },
      patchedFields: ["cognitiveTier"],
      stateDir,
    });
    const recovered = await recoverCognitiveMutation({
      mutationId: "mut-badver",
      tenantId: "t1",
      stateDir,
      catalog,
    });
    expect(recovered.ok).toBe(false);
    if (recovered.ok) {
      throw new Error("expected catalog_corrupt");
    }
    expect(recovered.error).toBe("catalog_corrupt");
    expect(recovered.receipt?.status).toBe("prepared");
  });

  it("applied receipt with Catalog behind resultingGovernanceVersion is catalog_corrupt and stays applied", async () => {
    const stateDir = tmpStateDir();
    const { catalog } = await setupMemory(stateDir);
    const applied = await updateCognitiveGovernance({
      resourceId: "mem-1",
      expectedGovernanceVersion: 1,
      actor: { kind: "operator", operatorId: "op-1" },
      patch: { cognitiveTier: "C2" },
      mutationId: "mut-applied",
      stateDir,
      catalog,
    });
    expect(applied.ok).toBe(true);
    const filePath = path.join(stateDir, "data-governance", "catalog.json");
    const file = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      revision: number;
      records: Record<string, CatalogRecord>;
    };
    file.records["mem-1"].envelope.governanceVersion = 1;
    fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`);
    resetCatalogStoreSingletonsForTests();
    const catalog2 = createFileDataGovernanceCatalogStore({ storePath: filePath });
    const recovered = await recoverCognitiveMutation({
      mutationId: "mut-applied",
      tenantId: "t1",
      stateDir,
      catalog: catalog2,
    });
    expect(recovered.ok).toBe(false);
    if (recovered.ok) {
      throw new Error("expected catalog_corrupt");
    }
    expect(recovered.error).toBe("catalog_corrupt");
    expect(recovered.receipt?.status).toBe("applied");
  });
});
