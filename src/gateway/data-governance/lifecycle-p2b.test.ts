/**
 * P2-b conversation_archive two-phase bridge tests (Gate A5).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertWritableEnvelope } from "./envelope.js";
import {
  archiveConversationWithGovernance,
  compensateConversationArchiveDomain,
  createConversationArchiveDomainVerifier,
  materializeConversationArchiveDomain,
  restoreConversationWithGovernance,
  type ConversationArchiveDomainPlan,
} from "./lifecycle-conversation-adapter.js";
import {
  beginConversationTwoPhase,
  completeConversationTwoPhase,
  runConversationArchiveTwoPhase,
  runConversationRestoreTwoPhase,
} from "./lifecycle-conversation.js";
import { getLifecycleReceipt } from "./lifecycle-receipt-store.js";
import { transitionCatalogLifecycleCommand } from "./lifecycle-transition.js";
import { readGovernanceRecoveryReceipt } from "./recovery-receipt.js";
import {
  getSharedDataGovernanceCatalog,
  resetSharedDataGovernanceCatalogForTests,
} from "./runtime-catalog.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION, type CatalogRecord } from "./types.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const owner = { kind: "user" as const, userId: "u1" };
const scope = { kind: "tenant" as const, tenantId: "t1" };
const actor = { kind: "user" as const, userId: "u1" };
const operator = { kind: "operator" as const, operatorId: "op-hold" };

async function seedActiveRecord(stateDir: string, resourceId = "ca-1"): Promise<CatalogRecord> {
  const locator = path.join(stateDir, "blob.json");
  fs.writeFileSync(locator, "{}");
  const now = "2026-08-12T00:00:00Z";
  const record: CatalogRecord = {
    envelope: {
      resourceId,
      resourceType: "conversation_archive",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: "t1",
      owner,
      scope,
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 3,
      canonicalBindingId: "bind-1",
      createdAt: now,
      updatedAt: now,
    },
    bindings: [
      {
        bindingId: "bind-1",
        resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator,
        state: "active",
        contentVersion: "1",
      },
    ],
  };
  await getSharedDataGovernanceCatalog({ stateDir }).put(record);
  return record;
}

describe("P2-b conversation two-phase", () => {
  it("phase1 keeps business lifecycle active and denies writes", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-p1-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    const begun = await beginConversationTwoPhase({
      stateDir,
      resourceId: "ca-1",
      command: "archive",
      expectedGovernanceVersion: 3,
      operationId: "op-arch-1",
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).toBe("active");
    expect(record?.envelope.activeLifecycleOperation?.command).toBe("archive");
    expect(() => assertWritableEnvelope(record!.envelope)).toThrow(/active_lifecycle_operation/);
  });

  it("does not CAS to archived when domain verify fails", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-dom-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    const result = await runConversationArchiveTwoPhase({
      stateDir,
      resourceId: "ca-1",
      operationId: "op-arch-fail",
      expectedGovernanceVersion: 3,
      requestedBy: actor,
      verifyDomain: async () => {
        throw new Error("domain_missing_archive");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict).toBe("domain_failed");
    }
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
    expect(record?.envelope.lifecycleState).not.toBe("archived");
    expect(getLifecycleReceipt({ operationId: "op-arch-fail", stateDir })?.status).toBe("failed");
  });

  it("CAS to archived only after domain verify succeeds", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-ok-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);
    let domainRan = false;

    const begun = await beginConversationTwoPhase({
      stateDir,
      resourceId: "ca-1",
      command: "archive",
      expectedGovernanceVersion: 3,
      operationId: "op-arch-ok",
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }

    const mid = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(mid?.envelope.lifecycleState).toBe("active");

    const done = await completeConversationTwoPhase({
      stateDir,
      resourceId: "ca-1",
      operationId: "op-arch-ok",
      expectedGovernanceVersion: begun.governanceVersion,
      executedBy: actor,
      verifyDomain: async () => {
        domainRan = true;
        const still = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
        expect(still?.envelope.lifecycleState).toBe("active");
        expect(still?.envelope.activeLifecycleOperation?.operationId).toBe("op-arch-ok");
      },
    });
    expect(domainRan).toBe(true);
    expect(done.ok).toBe(true);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).toBe("archived");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
    expect(getLifecycleReceipt({ operationId: "op-arch-ok", stateDir })?.status).toBe("completed");
  });

  it("restore two-phase: archived → active after domain verify", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-rst-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    const archived = await runConversationArchiveTwoPhase({
      stateDir,
      resourceId: "ca-1",
      operationId: "op-arch-pre",
      expectedGovernanceVersion: 3,
      requestedBy: actor,
      verifyDomain: async () => {},
    });
    expect(archived.ok).toBe(true);
    if (!archived.ok) {
      return;
    }

    const restored = await runConversationRestoreTwoPhase({
      stateDir,
      resourceId: "ca-1",
      operationId: "op-rst-1",
      expectedGovernanceVersion: archived.governanceVersion,
      requestedBy: actor,
      verifyDomain: async () => {},
    });
    expect(restored.ok).toBe(true);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).toBe("active");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
  });

  it("hold during archive phase1 preserves active archive op", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-hold-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    const begun = await beginConversationTwoPhase({
      stateDir,
      resourceId: "ca-1",
      command: "archive",
      expectedGovernanceVersion: 3,
      operationId: "op-arch-hold",
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }
    const beforeOp = begun.record.envelope.activeLifecycleOperation;

    const hold = await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "applyLegalHold",
      expectedStates: ["active"],
      expectedGovernanceVersion: begun.governanceVersion,
      operationId: "op-hold-during-arch",
      requestedBy: operator,
      hold: { holdId: "h1", reason: "litigation" },
    });
    expect(hold.ok).toBe(true);
    if (!hold.ok) {
      return;
    }
    expect(hold.record.envelope.activeLifecycleOperation).toEqual(beforeOp);
    expect(hold.record.envelope.lifecycleState).toBe("active");
  });

  it("requestPurge + cancelDeletion remain available on conversation_archive", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-purge-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    const purge = await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "op-purge-ca",
      requestedBy: actor,
    });
    expect(purge.ok).toBe(true);
    if (!purge.ok) {
      return;
    }
    expect(purge.record.envelope.lifecycleState).toBe("deletion_pending");

    const cancel = await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "cancelDeletion",
      expectedStates: ["deletion_pending"],
      expectedGovernanceVersion: purge.governanceVersion,
      operationId: "op-purge-ca",
      requestedBy: actor,
    });
    expect(cancel.ok).toBe(true);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).toBe("active");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
  });

  it("domain failure writes recovery receipt and does not leave archived", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-recv-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    const result = await runConversationArchiveTwoPhase({
      stateDir,
      resourceId: "ca-1",
      operationId: "op-arch-recv",
      expectedGovernanceVersion: 3,
      requestedBy: actor,
      verifyDomain: async () => {
        throw new Error("domain_inject_fail");
      },
    });
    expect(result.ok).toBe(false);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
    expect(record?.envelope.lifecycleState).not.toBe("archived");
    const receipt = readGovernanceRecoveryReceipt({
      operationId: "op-arch-recv",
      stage: "conversation_two_phase_abort",
      stateDir,
    });
    expect(receipt).not.toBeNull();
    expect(receipt?.reason).toContain("domain_inject_fail");
    expect(receipt?.haltCompensation).toBe(false);
    expect(receipt?.resourceIds).toEqual(["ca-1"]);
  });

  it("onDomainFailure keep_prior restores active without recovery receipt", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-keep-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    const result = await runConversationArchiveTwoPhase({
      stateDir,
      resourceId: "ca-1",
      operationId: "op-arch-keep",
      expectedGovernanceVersion: 3,
      requestedBy: actor,
      onDomainFailure: "keep_prior",
      verifyDomain: async () => {
        throw new Error("domain_soft_fail");
      },
    });
    expect(result.ok).toBe(false);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).toBe("active");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
    expect(
      readGovernanceRecoveryReceipt({
        operationId: "op-arch-keep",
        stage: "conversation_two_phase_abort",
        stateDir,
      }),
    ).toBeNull();
    expect(getLifecycleReceipt({ operationId: "op-arch-keep", stateDir })?.status).toBe("failed");
  });
});

describe("P2-b conversation domain adapter", () => {
  async function seedAdapterFixture(stateDir: string): Promise<{
    record: CatalogRecord;
    plan: ConversationArchiveDomainPlan;
  }> {
    const dataRoot = path.join(stateDir, "data");
    const runtimePath = path.join(stateDir, "runtime", "sess-1.jsonl");
    const archivePath = path.join(
      dataRoot,
      "agents",
      "agent-1",
      "conversations",
      "archive",
      "sess-1.jsonl",
    );
    fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
    fs.writeFileSync(runtimePath, '{"type":"session","id":"sess-1"}\n', "utf8");
    // Canonical locator points at intended archive path (materialize fills it).
    const now = "2026-08-12T00:00:00Z";
    const resourceId = "ca-adapter-1";
    const record: CatalogRecord = {
      envelope: {
        resourceId,
        resourceType: "conversation_archive",
        schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
        tenantId: "t1",
        owner,
        scope,
        lifecycleState: "active",
        classification: "internal",
        governanceVersion: 3,
        canonicalBindingId: "bind-1",
        createdAt: now,
        updatedAt: now,
      },
      bindings: [
        {
          bindingId: "bind-1",
          resourceId,
          role: "canonical",
          storageKind: "filesystem",
          locator: archivePath,
          state: "active",
          contentVersion: "1",
        },
      ],
    };
    await getSharedDataGovernanceCatalog({ stateDir }).put(record);
    const plan: ConversationArchiveDomainPlan = {
      resourceId,
      agentId: "agent-1",
      sessionId: "sess-1",
      runtimePath,
      archivePath,
      dataRoot,
      operationId: "op-adapter-arch",
      stateDir,
    };
    return { record, plan };
  }

  it("adapter materializes archive+index then CAS to archived", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-adp-ok-"));
    tempDirs.push(stateDir);
    const { plan } = await seedAdapterFixture(stateDir);

    const result = await archiveConversationWithGovernance({
      plan,
      expectedGovernanceVersion: 3,
      requestedBy: actor,
    });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(plan.archivePath)).toBe(true);
    const indexPath = path.join(plan.dataRoot, "agents", "agent-1", "conversations", "index.json");
    expect(fs.existsSync(indexPath)).toBe(true);
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as {
      sessions: Array<{ sessionId: string }>;
    };
    expect(index.sessions.some((s) => s.sessionId === "sess-1")).toBe(true);

    const record = await getSharedDataGovernanceCatalog({ stateDir }).get(plan.resourceId);
    expect(record?.envelope.lifecycleState).toBe("archived");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
    // Domain ran before Catalog target: mid-flight would still be active (covered by bridge test);
    // here assert success receipt + no abort recovery crumb.
    expect(getLifecycleReceipt({ operationId: plan.operationId, stateDir })?.status).toBe(
      "completed",
    );
    expect(
      readGovernanceRecoveryReceipt({
        operationId: plan.operationId,
        stage: "conversation_two_phase_abort",
        stateDir,
      }),
    ).toBeNull();
  });

  it("adapter compensates create-owned archive on verify fail + recovery_required", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-adp-fail-"));
    tempDirs.push(stateDir);
    const { plan } = await seedAdapterFixture(stateDir);
    const failPlan: ConversationArchiveDomainPlan = {
      ...plan,
      operationId: "op-adapter-fail",
    };

    const begun = await beginConversationTwoPhase({
      stateDir,
      resourceId: failPlan.resourceId,
      command: "archive",
      expectedGovernanceVersion: 3,
      operationId: failPlan.operationId,
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }

    const done = await completeConversationTwoPhase({
      stateDir,
      resourceId: failPlan.resourceId,
      operationId: failPlan.operationId,
      expectedGovernanceVersion: begun.governanceVersion,
      executedBy: actor,
      onDomainFailure: "recovery_required",
      verifyDomain: async () => {
        const material = await materializeConversationArchiveDomain(failPlan);
        expect(material.createdArchive).toBe(true);
        expect(fs.existsSync(failPlan.archivePath)).toBe(true);
        await compensateConversationArchiveDomain({
          plan: failPlan,
          createdArchive: true,
          indexSnapshot: material.indexSnapshot,
          reason: "inject_fail_after_materialize",
        });
        expect(fs.existsSync(failPlan.archivePath)).toBe(false);
        throw new Error("inject_fail_after_materialize");
      },
    });
    expect(done.ok).toBe(false);
    if (!done.ok) {
      expect(done.conflict).toBe("domain_failed");
    }
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get(failPlan.resourceId);
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
    expect(record?.envelope.lifecycleState).not.toBe("archived");
    expect(fs.existsSync(failPlan.archivePath)).toBe(false);
    const abortReceipt = readGovernanceRecoveryReceipt({
      operationId: failPlan.operationId,
      stage: "conversation_two_phase_abort",
      stateDir,
    });
    expect(abortReceipt).not.toBeNull();
    expect(abortReceipt?.reason).toContain("inject_fail_after_materialize");
    expect(getLifecycleReceipt({ operationId: failPlan.operationId, stateDir })?.status).toBe(
      "failed",
    );
  });

  it("adapter success then restore materializes runtime and CAS to active", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-adp-rst-"));
    tempDirs.push(stateDir);
    const { plan } = await seedAdapterFixture(stateDir);

    const archived = await archiveConversationWithGovernance({
      plan,
      expectedGovernanceVersion: 3,
      requestedBy: actor,
    });
    expect(archived.ok).toBe(true);
    if (!archived.ok) {
      return;
    }

    // Remove runtime to prove restore re-creates it.
    fs.rmSync(plan.runtimePath, { force: true });
    expect(fs.existsSync(plan.runtimePath)).toBe(false);

    const restorePlan: ConversationArchiveDomainPlan = {
      ...plan,
      operationId: "op-adapter-rst",
    };
    const restored = await restoreConversationWithGovernance({
      plan: restorePlan,
      expectedGovernanceVersion: archived.governanceVersion,
      requestedBy: actor,
    });
    expect(restored.ok).toBe(true);
    expect(fs.existsSync(plan.runtimePath)).toBe(true);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get(plan.resourceId);
    expect(record?.envelope.lifecycleState).toBe("active");
  });

  it("adapter keep_prior on domain fail leaves active and compensates archive bytes", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-adp-keep-"));
    tempDirs.push(stateDir);
    const { plan } = await seedAdapterFixture(stateDir);

    const begun = await beginConversationTwoPhase({
      stateDir,
      resourceId: plan.resourceId,
      command: "archive",
      expectedGovernanceVersion: 3,
      operationId: "op-adapter-keep",
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }

    const keepPlan: ConversationArchiveDomainPlan = {
      ...plan,
      operationId: "op-adapter-keep",
    };
    const done = await completeConversationTwoPhase({
      stateDir,
      resourceId: plan.resourceId,
      operationId: "op-adapter-keep",
      expectedGovernanceVersion: begun.governanceVersion,
      executedBy: actor,
      onDomainFailure: "keep_prior",
      verifyDomain: async () => {
        const material = await materializeConversationArchiveDomain(keepPlan);
        expect(material.createdArchive).toBe(true);
        expect(fs.existsSync(keepPlan.archivePath)).toBe(true);
        await compensateConversationArchiveDomain({
          plan: keepPlan,
          createdArchive: true,
          indexSnapshot: material.indexSnapshot,
          reason: "inject_fail_after_materialize",
        });
        throw new Error("inject_fail_after_materialize");
      },
    });
    expect(done.ok).toBe(false);
    expect(fs.existsSync(keepPlan.archivePath)).toBe(false);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get(plan.resourceId);
    expect(record?.envelope.lifecycleState).toBe("active");
    expect(
      readGovernanceRecoveryReceipt({
        operationId: "op-adapter-keep",
        stage: "conversation_two_phase_abort",
        stateDir,
      }),
    ).toBeNull();
  });
});

describe("P2-b CR: hold race + formal adapter compensate", () => {
  async function seedAdapterFixture(stateDir: string): Promise<{
    plan: ConversationArchiveDomainPlan;
  }> {
    const dataRoot = path.join(stateDir, "data");
    const runtimePath = path.join(stateDir, "runtime", "sess-1.jsonl");
    const archivePath = path.join(
      dataRoot,
      "agents",
      "agent-1",
      "conversations",
      "archive",
      "sess-1.jsonl",
    );
    fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
    fs.writeFileSync(runtimePath, '{"type":"session","id":"sess-1"}\n', "utf8");
    const now = "2026-08-12T00:00:00Z";
    const resourceId = "ca-cr-1";
    await getSharedDataGovernanceCatalog({ stateDir }).put({
      envelope: {
        resourceId,
        resourceType: "conversation_archive",
        schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
        tenantId: "t1",
        owner,
        scope,
        lifecycleState: "active",
        classification: "internal",
        governanceVersion: 3,
        canonicalBindingId: "bind-1",
        createdAt: now,
        updatedAt: now,
      },
      bindings: [
        {
          bindingId: "bind-1",
          resourceId,
          role: "canonical",
          storageKind: "filesystem",
          locator: archivePath,
          state: "active",
          contentVersion: "1",
        },
      ],
    });
    return {
      plan: {
        resourceId,
        agentId: "agent-1",
        sessionId: "sess-1",
        runtimePath,
        archivePath,
        dataRoot,
        operationId: "op-cr-arch",
        stateDir,
      },
    };
  }

  it("hold concurrent version bump retries CAS and archives successfully", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-hold-race-"));
    tempDirs.push(stateDir);
    const { plan } = await seedAdapterFixture(stateDir);

    const begun = await beginConversationTwoPhase({
      stateDir,
      resourceId: plan.resourceId,
      command: "archive",
      expectedGovernanceVersion: 3,
      operationId: plan.operationId,
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }
    const phase1Version = begun.governanceVersion;

    const done = await completeConversationTwoPhase({
      stateDir,
      resourceId: plan.resourceId,
      operationId: plan.operationId,
      expectedGovernanceVersion: phase1Version,
      executedBy: actor,
      verifyDomain: async () => {
        const handle = await createConversationArchiveDomainVerifier(plan)();
        // Simulate applyLegalHold racing after domain materialize (version++ , keep active op).
        const hold = await transitionCatalogLifecycleCommand({
          stateDir,
          resourceId: plan.resourceId,
          command: "applyLegalHold",
          expectedStates: ["active"],
          expectedGovernanceVersion: phase1Version,
          operationId: "op-hold-race",
          requestedBy: operator,
          hold: { holdId: "h-race", reason: "litigation" },
        });
        expect(hold.ok).toBe(true);
        if (hold.ok) {
          expect(hold.record.envelope.governanceVersion).toBe(phase1Version + 1);
          expect(hold.record.envelope.activeLifecycleOperation?.operationId).toBe(plan.operationId);
        }
        return handle;
      },
    });
    expect(done.ok).toBe(true);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get(plan.resourceId);
    expect(record?.envelope.lifecycleState).toBe("archived");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
    expect(record?.envelope.legalHold?.holdId).toBe("h-race");
    expect(getLifecycleReceipt({ operationId: plan.operationId, stateDir })?.status).toBe(
      "completed",
    );
  });

  it("formal archiveConversationWithGovernance auto-compensates archive+index on CAS fail", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-cas-comp-"));
    tempDirs.push(stateDir);
    const { plan } = await seedAdapterFixture(stateDir);
    const indexPath = path.join(plan.dataRoot, "agents", "agent-1", "conversations", "index.json");

    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    const realCompare = catalog.compareAndPut.bind(catalog);
    catalog.compareAndPut = async (params) => {
      if (
        params.next.envelope.lifecycleState === "archived" &&
        params.next.envelope.activeLifecycleOperation === null
      ) {
        return { ok: false as const, conflict: "version_conflict" as const };
      }
      return realCompare(params);
    };

    const result = await archiveConversationWithGovernance({
      plan,
      expectedGovernanceVersion: 3,
      requestedBy: actor,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("domain_ok_catalog_cas_failed_recovery_required");
    }
    expect(fs.existsSync(plan.archivePath)).toBe(false);
    expect(fs.existsSync(indexPath)).toBe(false);
    const record = await catalog.get(plan.resourceId);
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
    expect(getLifecycleReceipt({ operationId: plan.operationId, stateDir })?.status).toBe("failed");
  });

  it("hold race + exhausted target CAS aborts with latest version (no stuck active op)", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-hold-stuck-"));
    tempDirs.push(stateDir);
    const { plan } = await seedAdapterFixture(stateDir);
    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    const realCompare = catalog.compareAndPut.bind(catalog);
    catalog.compareAndPut = async (params) => {
      // Allow hold + abort recovery_required; block only successful archive close.
      if (
        params.next.envelope.lifecycleState === "archived" &&
        params.next.envelope.activeLifecycleOperation === null
      ) {
        return { ok: false as const, conflict: "version_conflict" as const };
      }
      return realCompare(params);
    };

    const begun = await beginConversationTwoPhase({
      stateDir,
      resourceId: plan.resourceId,
      command: "archive",
      expectedGovernanceVersion: 3,
      operationId: plan.operationId,
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }

    const done = await completeConversationTwoPhase({
      stateDir,
      resourceId: plan.resourceId,
      operationId: plan.operationId,
      expectedGovernanceVersion: begun.governanceVersion,
      executedBy: actor,
      verifyDomain: async () => {
        const handle = await createConversationArchiveDomainVerifier(plan)();
        const hold = await transitionCatalogLifecycleCommand({
          stateDir,
          resourceId: plan.resourceId,
          command: "applyLegalHold",
          expectedStates: ["active"],
          expectedGovernanceVersion: begun.governanceVersion,
          operationId: "op-hold-stuck",
          requestedBy: operator,
          hold: { holdId: "h-stuck", reason: "block" },
        });
        expect(hold.ok).toBe(true);
        return handle;
      },
    });
    expect(done.ok).toBe(false);
    const record = await catalog.get(plan.resourceId);
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
    expect(record?.envelope.lifecycleState).not.toBe("archived");
    expect(fs.existsSync(plan.archivePath)).toBe(false);
    expect(getLifecycleReceipt({ operationId: plan.operationId, stateDir })?.status).toBe("failed");
    // Must not leave a stuck archive active op (the P0 hang).
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
  });

  it("formal restoreConversationWithGovernance auto-compensates create-owned runtime on CAS fail", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-rst-comp-"));
    tempDirs.push(stateDir);
    const { plan } = await seedAdapterFixture(stateDir);

    const archived = await archiveConversationWithGovernance({
      plan,
      expectedGovernanceVersion: 3,
      requestedBy: actor,
    });
    expect(archived.ok).toBe(true);
    if (!archived.ok) {
      return;
    }
    fs.rmSync(plan.runtimePath, { force: true });

    const restorePlan: ConversationArchiveDomainPlan = {
      ...plan,
      operationId: "op-cr-rst",
    };
    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    const realCompare = catalog.compareAndPut.bind(catalog);
    catalog.compareAndPut = async (params) => {
      if (
        params.next.envelope.lifecycleState === "active" &&
        params.next.envelope.activeLifecycleOperation === null
      ) {
        return { ok: false as const, conflict: "version_conflict" as const };
      }
      return realCompare(params);
    };

    const restored = await restoreConversationWithGovernance({
      plan: restorePlan,
      expectedGovernanceVersion: archived.governanceVersion,
      requestedBy: actor,
    });
    expect(restored.ok).toBe(false);
    expect(fs.existsSync(restorePlan.runtimePath)).toBe(false);
    const record = await catalog.get(plan.resourceId);
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
  });

  it("canonical locator drift after domain verify fails closed (no archived retry)", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-loc-drift-"));
    tempDirs.push(stateDir);
    const { plan } = await seedAdapterFixture(stateDir);
    const catalog = getSharedDataGovernanceCatalog({ stateDir });

    const begun = await beginConversationTwoPhase({
      stateDir,
      resourceId: plan.resourceId,
      command: "archive",
      expectedGovernanceVersion: 3,
      operationId: plan.operationId,
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }

    const done = await completeConversationTwoPhase({
      stateDir,
      resourceId: plan.resourceId,
      operationId: plan.operationId,
      expectedGovernanceVersion: begun.governanceVersion,
      executedBy: actor,
      verifyDomain: async () => {
        const handle = await createConversationArchiveDomainVerifier(plan)();
        // Concurrent Catalog rewrite: bump version + move canonical locator (non-whitelist).
        const cur = (await catalog.get(plan.resourceId))!;
        const driftedLocator = path.join(stateDir, "drifted-canonical.jsonl");
        fs.writeFileSync(driftedLocator, "drift\n", "utf8");
        await catalog.put({
          envelope: {
            ...cur.envelope,
            governanceVersion: cur.envelope.governanceVersion + 1,
            updatedAt: new Date().toISOString(),
          },
          bindings: cur.bindings.map((b) =>
            b.role === "canonical" ? { ...b, locator: driftedLocator } : b,
          ),
        });
        return handle;
      },
    });
    expect(done.ok).toBe(false);
    if (!done.ok) {
      expect(done.message).toBe("domain_ok_snapshot_mismatch_recovery_required");
    }
    const record = await catalog.get(plan.resourceId);
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
    expect(record?.envelope.lifecycleState).not.toBe("archived");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
    // Domain create-owned archive at original plan path must be compensated.
    expect(fs.existsSync(plan.archivePath)).toBe(false);
  });

  it("classification/createdAt drift after domain verify fails closed", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-proj-drift-"));
    tempDirs.push(stateDir);
    const { plan } = await seedAdapterFixture(stateDir);
    const catalog = getSharedDataGovernanceCatalog({ stateDir });

    const begun = await beginConversationTwoPhase({
      stateDir,
      resourceId: plan.resourceId,
      command: "archive",
      expectedGovernanceVersion: 3,
      operationId: "op-proj-drift",
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }

    const done = await completeConversationTwoPhase({
      stateDir,
      resourceId: plan.resourceId,
      operationId: "op-proj-drift",
      expectedGovernanceVersion: begun.governanceVersion,
      executedBy: actor,
      verifyDomain: async () => {
        const handle = await createConversationArchiveDomainVerifier({
          ...plan,
          operationId: "op-proj-drift",
        })();
        const cur = (await catalog.get(plan.resourceId))!;
        await catalog.put({
          envelope: {
            ...cur.envelope,
            governanceVersion: cur.envelope.governanceVersion + 1,
            updatedAt: new Date().toISOString(),
            // Non-whitelist drifts (still valid envelope fields).
            createdAt: "2020-01-01T00:00:00.000Z",
            classification: "restricted",
          },
          bindings: cur.bindings,
        });
        return handle;
      },
    });
    expect(done.ok).toBe(false);
    if (!done.ok) {
      expect(done.message).toBe("domain_ok_snapshot_mismatch_recovery_required");
    }
    const record = await catalog.get(plan.resourceId);
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
    expect(record?.envelope.activeLifecycleOperation).toBeNull();
  });

  it("index fingerprint mismatch keeps subsequent entry and archive target", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2b-idx-fp-"));
    tempDirs.push(stateDir);
    const { plan } = await seedAdapterFixture(stateDir);
    const begun = await beginConversationTwoPhase({
      stateDir,
      resourceId: plan.resourceId,
      command: "archive",
      expectedGovernanceVersion: 3,
      operationId: "op-idx-fp",
      requestedBy: actor,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) {
      return;
    }
    const fpPlan = { ...plan, operationId: "op-idx-fp" };
    const material = await materializeConversationArchiveDomain(fpPlan);
    expect(material.indexSnapshot.writtenEntryFingerprint).toBeTruthy();
    expect(fs.existsSync(plan.archivePath)).toBe(true);

    const indexPath = material.indexPath;
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as {
      sessions: Array<{
        sessionId: string;
        archivedAt: string;
        relativePath: string;
        bytes?: number;
      }>;
    };
    const row = index.sessions.find((s) => s.sessionId === "sess-1");
    expect(row).toBeTruthy();
    row!.archivedAt = "2099-12-31T00:00:00Z";
    fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

    const result = await compensateConversationArchiveDomain({
      plan: fpPlan,
      createdArchive: true,
      indexSnapshot: material.indexSnapshot,
      reason: "test_fp_mismatch",
    });

    expect(result.compensated).toBe(false);
    expect(result.partial).toBe(true);
    expect(result.indexOutcome).toBe("skipped_fingerprint_mismatch");
    expect(result.archiveDeleted).toBe(false);

    const after = JSON.parse(fs.readFileSync(indexPath, "utf8")) as {
      sessions: Array<{ sessionId: string; archivedAt: string }>;
    };
    // Concurrent rewrite preserved; compensate did not clobber entry or archive bytes.
    expect(after.sessions.find((s) => s.sessionId === "sess-1")?.archivedAt).toBe(
      "2099-12-31T00:00:00Z",
    );
    expect(fs.existsSync(plan.archivePath)).toBe(true);
    expect(result.recoveryReceiptPath).toBeTruthy();
    expect(
      readGovernanceRecoveryReceipt({
        operationId: "op-idx-fp",
        stage: "conversation_archive_index_compensate_skip",
        stateDir,
      }),
    ).not.toBeNull();
  });
});
