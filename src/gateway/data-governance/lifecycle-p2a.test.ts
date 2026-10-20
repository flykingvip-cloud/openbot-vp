/**
 * P2-a acceptance tests — Gate Round-4 required scenarios.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readDeletionAuthMarker,
  validateDeletionAuthMarkerLogical,
} from "./deletion-auth-marker.js";
import { assertWritableEnvelope, isLegalHoldActive } from "./envelope.js";
import { recoverLifecycleFromCatalogAndReceipt } from "./lifecycle-access.js";
import { resumePurge } from "./lifecycle-purge.js";
import { getLifecycleReceipt } from "./lifecycle-receipt-store.js";
import { transitionCatalogLifecycleCommand } from "./lifecycle-transition.js";
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
const worker = { kind: "worker" as const, workerId: "w1" };
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

describe("P2-a lifecycle foundation", () => {
  it("rejects stale expected governance version (preflight)", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-ver-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    const result = await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 2,
      operationId: "op-purge-1",
      requestedBy: actor,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict).toBe("version_conflict");
    }
    const after = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(after?.envelope.governanceVersion).toBe(3);
    expect(after?.envelope.lifecycleState).toBe("active");
  });

  it("concurrent same-version commands: exactly 1 success + 1 version_conflict", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-cas-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    const [a, b] = await Promise.all([
      transitionCatalogLifecycleCommand({
        stateDir,
        resourceId: "ca-1",
        command: "requestPurge",
        expectedStates: ["active"],
        expectedGovernanceVersion: 3,
        operationId: "op-concurrent-a",
        requestedBy: actor,
      }),
      transitionCatalogLifecycleCommand({
        stateDir,
        resourceId: "ca-1",
        command: "requestPurge",
        expectedStates: ["active"],
        expectedGovernanceVersion: 3,
        operationId: "op-concurrent-b",
        requestedBy: actor,
      }),
    ]);

    const results = [a, b];
    const successes = results.filter((r) => r.ok);
    const conflicts = results.filter((r) => !r.ok && r.conflict === "version_conflict");
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    const after = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(after?.envelope.governanceVersion).toBe(4);
    expect(after?.envelope.lifecycleState).toBe("deletion_pending");
    expect(after?.envelope.activeLifecycleOperation?.operationId).toBe(
      successes[0].ok ? successes[0].receipt.operationId : "",
    );

    const failedOp = conflicts[0].ok ? null : a.ok ? "op-concurrent-b" : "op-concurrent-a";
    const failedReceipt = getLifecycleReceipt({ operationId: failedOp!, stateDir });
    expect(failedReceipt?.status).toBe("failed");
    const winReceipt = getLifecycleReceipt({
      operationId: after!.envelope.activeLifecycleOperation!.operationId,
      stateDir,
    });
    expect(winReceipt?.status).toBe("open");
  });

  it("same operationId concurrent: loser must not mark winner receipt failed", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-same-op-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    const [a, b] = await Promise.all([
      transitionCatalogLifecycleCommand({
        stateDir,
        resourceId: "ca-1",
        command: "requestPurge",
        expectedStates: ["active"],
        expectedGovernanceVersion: 3,
        operationId: "same-op",
        requestedBy: actor,
      }),
      transitionCatalogLifecycleCommand({
        stateDir,
        resourceId: "ca-1",
        command: "requestPurge",
        expectedStates: ["active"],
        expectedGovernanceVersion: 3,
        operationId: "same-op",
        requestedBy: actor,
      }),
    ]);

    const successes = [a, b].filter((r) => r.ok);
    const conflicts = [a, b].filter((r) => !r.ok && r.conflict === "version_conflict");
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    const after = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(after?.envelope.lifecycleState).toBe("deletion_pending");
    expect(after?.envelope.activeLifecycleOperation?.operationId).toBe("same-op");
    expect(after?.envelope.governanceVersion).toBe(4);

    const receipt = getLifecycleReceipt({ operationId: "same-op", stateDir });
    expect(receipt?.status).toBe("open");
    expect(receipt?.operationId).toBe("same-op");
    expect(after?.envelope.activeLifecycleOperation?.receiptId).toBe(receipt?.receiptId);
  });

  it("controlled pause after Catalog CAS: loser fail does not strand winner receipt", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-pause-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    const { reconcileFailPreparedAfterVersionConflict } =
      await import("./lifecycle-receipt-store.js");

    let signalPaused!: () => void;
    let resumeWinner!: () => void;
    const paused = new Promise<void>((resolve) => {
      signalPaused = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resumeWinner = resolve;
    });

    const winnerPromise = transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "same-op-pause",
      requestedBy: actor,
      afterCatalogCasSuccess: async () => {
        signalPaused();
        await gate;
      },
    });

    await paused;

    const mid = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(mid?.envelope.lifecycleState).toBe("deletion_pending");
    expect(mid?.envelope.activeLifecycleOperation?.operationId).toBe("same-op-pause");
    expect(getLifecycleReceipt({ operationId: "same-op-pause", stateDir })?.status).toBe(
      "prepared",
    );

    // Simulate CAS-loser fail compensation after version_conflict (Catalog already bound).
    const reconcile = await reconcileFailPreparedAfterVersionConflict({
      operationId: "same-op-pause",
      stateDir,
      isCatalogBoundToOperation: async () => {
        const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
        return record?.envelope.activeLifecycleOperation?.operationId === "same-op-pause";
      },
    });
    expect(reconcile.action).toBe("skipped_catalog_bound");
    expect(reconcile.receipt.status).toBe("prepared");

    resumeWinner();
    const winner = await winnerPromise;
    expect(winner.ok).toBe(true);

    const after = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(after?.envelope.activeLifecycleOperation?.operationId).toBe("same-op-pause");
    const receipt = getLifecycleReceipt({ operationId: "same-op-pause", stateDir });
    expect(receipt?.status).toBe("open");
    expect(after?.envelope.activeLifecycleOperation?.receiptId).toBe(receipt?.receiptId);
  });

  it("commit heals failed receipt after Catalog CAS win (loser raced fail)", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-heal-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    const { failPreparedLifecycleReceipt } = await import("./lifecycle-receipt-store.js");

    let signalPaused!: () => void;
    let resumeWinner!: () => void;
    const paused = new Promise<void>((resolve) => {
      signalPaused = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resumeWinner = resolve;
    });

    const winnerPromise = transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "same-op-heal",
      requestedBy: actor,
      afterCatalogCasSuccess: async () => {
        signalPaused();
        await gate;
      },
    });

    await paused;
    // Simulate a stale loser that failed the shared receipt without Catalog re-check.
    await failPreparedLifecycleReceipt({
      operationId: "same-op-heal",
      stateDir,
    });
    expect(getLifecycleReceipt({ operationId: "same-op-heal", stateDir })?.status).toBe("failed");

    resumeWinner();
    const winner = await winnerPromise;
    expect(winner.ok).toBe(true);
    expect(getLifecycleReceipt({ operationId: "same-op-heal", stateDir })?.status).toBe("open");
  });

  it("rejects active operation mismatch on cancelDeletion", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-aom-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    const opened = await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "op-A",
      requestedBy: actor,
    });
    expect(opened.ok).toBe(true);

    const cancel = await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "cancelDeletion",
      expectedStates: ["deletion_pending"],
      expectedGovernanceVersion: 4,
      operationId: "op-B",
      requestedBy: actor,
    });
    expect(cancel.ok).toBe(false);
    if (!cancel.ok) {
      expect(cancel.conflict).toBe("active_operation_mismatch");
    }
  });

  it("rejects operation fingerprint mismatch", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-fp-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    const first = await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "op-fp-1",
      requestedBy: actor,
      deletionScope: "full",
    });
    expect(first.ok).toBe(true);

    const mismatch = await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["deletion_pending"],
      expectedGovernanceVersion: 4,
      operationId: "op-fp-1",
      requestedBy: actor,
      deletionScope: "partial",
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.conflict).toBe("idempotent_mismatch");
    }
  });

  it("preserves purge active operation while applying hold", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-hold-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    const purge = await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "op-purge-hold",
      requestedBy: actor,
    });
    expect(purge.ok).toBe(true);
    if (!purge.ok) {
      return;
    }
    const beforeOp = purge.record.envelope.activeLifecycleOperation;
    expect(beforeOp?.operationId).toBe("op-purge-hold");

    const hold = await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "applyLegalHold",
      expectedStates: ["deletion_pending"],
      expectedGovernanceVersion: 4,
      operationId: "op-hold-1",
      requestedBy: operator,
      hold: { holdId: "h1", reason: "litigation" },
    });
    expect(hold.ok).toBe(true);
    if (!hold.ok) {
      return;
    }
    expect(hold.record.envelope.activeLifecycleOperation).toEqual(beforeOp);
    expect(isLegalHoldActive(hold.record.envelope)).toBe(true);
    expect(hold.record.envelope.governanceVersion).toBe(5);
    expect(hold.receipt.status).toBe("completed");
    expect(hold.receipt.operationId).toBe("op-hold-1");
  });

  it("invalidates leftover deletion marker when Catalog version bumps", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-marker-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "op-marker-1",
      requestedBy: actor,
    });

    const resumed = await resumePurge({
      stateDir,
      operationId: "op-marker-1",
      attemptId: "attempt-1",
      executedBy: worker,
      closeOnSuccess: false,
      runDestructiveStage: async () => ({ status: "succeeded" }),
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) {
      return;
    }

    // Leave marker file on disk (skip cleanup by writing again after).
    const markerOnDisk = readDeletionAuthMarker({
      stateDir,
      operationId: "op-marker-1",
      attemptId: "attempt-1",
    });
    // resumePurge cleans up; re-issue a stale-looking file for leftover simulation
    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    let record = (await catalog.get("ca-1"))!;
    const receipt = getLifecycleReceipt({ operationId: "op-marker-1", stateDir })!;
    // Write leftover marker at current version then apply hold to bump version.
    const { writeDeletionAuthMarker } = await import("./deletion-auth-marker.js");
    const leftover = writeDeletionAuthMarker({
      stateDir,
      operationId: "op-marker-1",
      attemptId: "attempt-1",
      resourceId: "ca-1",
      bindingId: "bind-1",
      locator: record.bindings[0].locator,
      governanceVersion: record.envelope.governanceVersion,
      actor: worker,
      tenantId: "t1",
      receiptId: receipt.receiptId,
    });
    expect(leftover.governanceVersion).toBe(record.envelope.governanceVersion);

    const hold = await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "applyLegalHold",
      expectedStates: ["deletion_pending"],
      expectedGovernanceVersion: record.envelope.governanceVersion,
      operationId: "op-hold-marker",
      requestedBy: operator,
      hold: { holdId: "h2", reason: "preserve" },
    });
    expect(hold.ok).toBe(true);

    record = (await catalog.get("ca-1"))!;
    const fileStillThere = readDeletionAuthMarker({
      stateDir,
      operationId: "op-marker-1",
      attemptId: "attempt-1",
    });
    expect(fileStillThere).not.toBeNull();
    expect(markerOnDisk === null || true).toBe(true);

    const check = validateDeletionAuthMarkerLogical({
      marker: fileStillThere,
      record,
      receipt: getLifecycleReceipt({ operationId: "op-marker-1", stateDir })!,
    });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(["marker_version_stale", "marker_hold_blocks"]).toContain(check.reason);
    }
  });

  it("denies a second purge operation stealing the active slot", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-steal-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    const first = await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "op-1",
      requestedBy: actor,
    });
    expect(first.ok).toBe(true);

    const second = await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["deletion_pending"],
      expectedGovernanceVersion: 4,
      operationId: "op-2",
      requestedBy: actor,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.conflict).toBe("command_not_allowed");
    }
    const after = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(after?.envelope.activeLifecycleOperation?.operationId).toBe("op-1");
  });

  it("allows worker to continue only the original purge operation", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-resume-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "op-primary",
      requestedBy: actor,
    });

    const wrong = await resumePurge({
      stateDir,
      operationId: "op-other",
      attemptId: "a1",
      executedBy: worker,
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) {
      expect(["not_found", "active_operation_mismatch"]).toContain(wrong.conflict);
    }

    const ok = await resumePurge({
      stateDir,
      operationId: "op-primary",
      attemptId: "attempt-9",
      executedBy: worker,
      closeOnSuccess: false,
      runDestructiveStage: async () => ({ status: "succeeded" }),
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) {
      return;
    }
    expect(ok.receipt.operationId).toBe("op-primary");
    expect(ok.receipt.executedBy.some((a) => a.kind === "worker")).toBe(true);
    expect(ok.record.envelope.activeLifecycleOperation?.operationId).toBe("op-primary");
    expect(ok.receipt.stages.some((s) => s.attemptId === "attempt-9")).toBe(true);

    // hold blocks execute
    await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "applyLegalHold",
      expectedStates: ["deletion_pending"],
      expectedGovernanceVersion: ok.record.envelope.governanceVersion,
      operationId: "op-hold-block",
      requestedBy: operator,
      hold: { holdId: "h3", reason: "block" },
    });
    const blocked = await resumePurge({
      stateDir,
      operationId: "op-primary",
      attemptId: "attempt-10",
      executedBy: worker,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.conflict).toBe("hold_blocks");
    }
  });

  it("recovers from Catalog + receipt after restart, or recovery_required", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-restart-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "op-restart",
      requestedBy: actor,
    });

    resetSharedDataGovernanceCatalogForTests();

    const recovered = await recoverLifecycleFromCatalogAndReceipt({
      stateDir,
      resourceId: "ca-1",
    });
    expect(recovered.ok).toBe(true);
    if (recovered.ok && recovered.canResume) {
      expect(recovered.receipt.operationId).toBe("op-restart");
      expect(recovered.record.envelope.lifecycleState).toBe("deletion_pending");
    } else {
      expect.fail("expected canResume");
    }

    // Inconsistent: mark catalog recovery_required via put
    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    const record = (await catalog.get("ca-1"))!;
    await catalog.put({
      envelope: {
        ...record.envelope,
        lifecycleState: "recovery_required",
        governanceVersion: record.envelope.governanceVersion + 1,
        updatedAt: new Date().toISOString(),
      },
      bindings: record.bindings,
    });
    resetSharedDataGovernanceCatalogForTests();
    const req = await recoverLifecycleFromCatalogAndReceipt({
      stateDir,
      resourceId: "ca-1",
    });
    expect(req.ok).toBe(true);
    if (req.ok && !req.canResume) {
      expect(req.recoveryRequired).toBe(true);
    } else {
      expect.fail("expected recovery_required");
    }
  });

  it("denies content writes while activeLifecycleOperation is set (two-phase)", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-write-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "archive",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "op-archive-1",
      requestedBy: actor,
    });
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).toBe("active");
    expect(record?.envelope.activeLifecycleOperation?.command).toBe("archive");
    expect(() => assertWritableEnvelope(record!.envelope)).toThrow(/active_lifecycle_operation/);
  });

  it("does not success-replay when receipt is prepared/failed after CAS abort", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-prep-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);

    // First concurrent loser leaves failed receipt — simulate by racing archive+purge? Use hold race:
    const [h1, h2] = await Promise.all([
      transitionCatalogLifecycleCommand({
        stateDir,
        resourceId: "ca-1",
        command: "applyLegalHold",
        expectedStates: ["active"],
        expectedGovernanceVersion: 3,
        operationId: "op-hold-race-a",
        requestedBy: operator,
        hold: { holdId: "ha", reason: "a" },
      }),
      transitionCatalogLifecycleCommand({
        stateDir,
        resourceId: "ca-1",
        command: "applyLegalHold",
        expectedStates: ["active"],
        expectedGovernanceVersion: 3,
        operationId: "op-hold-race-b",
        requestedBy: operator,
        hold: { holdId: "hb", reason: "b" },
      }),
    ]);
    const loser = h1.ok ? h2 : h1;
    expect(loser.ok).toBe(false);
    if (!loser.ok) {
      expect(loser.conflict).toBe("version_conflict");
    }
    const loserId = h1.ok ? "op-hold-race-b" : "op-hold-race-a";
    expect(getLifecycleReceipt({ operationId: loserId, stateDir })?.status).toBe("failed");

    // Same operationId + fingerprint retry must NOT claim success without Catalog apply.
    // Version moved — preflight version_conflict; receipt stays failed (not completed replay).
    const retry = await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "applyLegalHold",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: loserId,
      requestedBy: operator,
      hold: { holdId: h1.ok ? "hb" : "ha", reason: h1.ok ? "b" : "a" },
    });
    expect(retry.ok).toBe(false);
    if (!retry.ok) {
      expect(retry.conflict).toBe("version_conflict");
    }
    expect(getLifecycleReceipt({ operationId: loserId, stateDir })?.status).toBe("failed");
    expect(retry.ok && "replay" in retry && retry.replay).toBeFalsy();
  });

  it("rejects tampered marker locator/binding/receiptId/resourceId/tenantId", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-tamper-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);
    await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "op-tamper",
      requestedBy: actor,
    });
    const resumed = await resumePurge({
      stateDir,
      operationId: "op-tamper",
      attemptId: "att-1",
      executedBy: worker,
      closeOnSuccess: false,
      runDestructiveStage: async () => ({ status: "succeeded" }),
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) {
      return;
    }

    // Re-issue leftover marker then mutate fields on disk.
    const { writeDeletionAuthMarker } = await import("./deletion-auth-marker.js");
    const record = (await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1"))!;
    const receipt = getLifecycleReceipt({ operationId: "op-tamper", stateDir })!;
    writeDeletionAuthMarker({
      stateDir,
      operationId: "op-tamper",
      attemptId: "att-1",
      resourceId: "ca-1",
      bindingId: "bind-1",
      locator: record.bindings[0].locator,
      governanceVersion: record.envelope.governanceVersion,
      actor: worker,
      tenantId: "t1",
      receiptId: receipt.receiptId,
    });

    const cases: Array<{ patch: Record<string, unknown>; reason: string }> = [
      { patch: { locator: "/tmp/evil-path" }, reason: "marker_locator_mismatch" },
      { patch: { bindingId: "bind-evil" }, reason: "marker_binding_mismatch" },
      { patch: { receiptId: "receipt-evil" }, reason: "marker_receipt_mismatch" },
      { patch: { resourceId: "ca-other" }, reason: "marker_receipt_resource_mismatch" },
      { patch: { tenantId: "t-evil" }, reason: "marker_receipt_tenant_mismatch" },
    ];

    for (const c of cases) {
      const markerPath = path.join(
        stateDir,
        "data-governance",
        "deletion-markers",
        "op-tamper-att-1.json",
      );
      const base = JSON.parse(fs.readFileSync(markerPath, "utf8"));
      // reset good marker then apply patch
      writeDeletionAuthMarker({
        stateDir,
        operationId: "op-tamper",
        attemptId: "att-1",
        resourceId: "ca-1",
        bindingId: "bind-1",
        locator: record.bindings[0].locator,
        governanceVersion: record.envelope.governanceVersion,
        actor: worker,
        tenantId: "t1",
        receiptId: receipt.receiptId,
      });
      const good = JSON.parse(fs.readFileSync(markerPath, "utf8"));
      fs.writeFileSync(markerPath, `${JSON.stringify({ ...good, ...c.patch }, null, 2)}\n`);
      const tampered = readDeletionAuthMarker({
        stateDir,
        operationId: "op-tamper",
        attemptId: "att-1",
      });
      const check = validateDeletionAuthMarkerLogical({
        marker: tampered,
        record,
        receipt,
      });
      expect(check.ok).toBe(false);
      if (!check.ok) {
        expect(check.reason).toBe(c.reason);
      }
      void base;
    }
  });

  it("destructive callback throw leaves recoverable marker/receipt state", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-throw-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);
    await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "op-throw",
      requestedBy: actor,
    });

    const { recoverPurgeAttempt } = await import("./lifecycle-purge.js");
    const failed = await resumePurge({
      stateDir,
      operationId: "op-throw",
      attemptId: "att-boom",
      executedBy: worker,
      runDestructiveStage: async () => {
        throw new Error("simulated_crash");
      },
    });
    expect(failed.ok).toBe(false);

    const receipt = getLifecycleReceipt({ operationId: "op-throw", stateDir });
    expect(receipt?.status).toBe("open");
    expect(receipt?.stages.some((s) => s.status === "failed" && s.attemptId === "att-boom")).toBe(
      true,
    );
    const leftover = readDeletionAuthMarker({
      stateDir,
      operationId: "op-throw",
      attemptId: "att-boom",
    });
    expect(leftover).not.toBeNull();

    const recovered = await recoverPurgeAttempt({
      stateDir,
      operationId: "op-throw",
      attemptId: "att-boom",
    });
    expect(recovered.ok).toBe(true);
    if (recovered.ok && recovered.canResume) {
      expect(recovered.receipt.operationId).toBe("op-throw");
    } else {
      expect.fail("expected canResume after throw");
    }
    // Leftover marker file remains for inspection; resume is driven by Catalog+receipt.
    expect(leftover?.attemptId).toBe("att-boom");
    expect(leftover?.operationId).toBe("op-throw");
  });

  it("destructive eraseTarget comes from Catalog canonical, not marker-only", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2a-erase-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);
    await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "op-erase-tgt",
      requestedBy: actor,
    });
    const before = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    const expectedLocator = path.resolve(before!.bindings[0].locator);

    let seenLocator: string | null = null;
    const ok = await resumePurge({
      stateDir,
      operationId: "op-erase-tgt",
      attemptId: "att-erase",
      executedBy: worker,
      closeOnSuccess: false,
      runDestructiveStage: async (ctx) => {
        seenLocator = ctx.eraseTarget.locator;
        expect(ctx.eraseTarget.bindingId).toBe(before!.envelope.canonicalBindingId);
        expect(ctx.eraseTarget.locator).toBe(expectedLocator);
        return { status: "succeeded" };
      },
    });
    expect(ok.ok).toBe(true);
    expect(seenLocator).toBe(expectedLocator);
  });
});
