/**
 * P2-d purge closure stages — no success stub; Catalog → purged after destructive.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issuePurgeStorageHandle } from "./lifecycle-purge-handle.js";
import { recoverPurgeAttempt, resumePurge, type ResumePurgeParams } from "./lifecycle-purge.js";
import { appendLifecycleReceiptStage, getLifecycleReceipt } from "./lifecycle-receipt-store.js";
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
const worker = { kind: "worker" as const, workerId: "w1" };
const operator = { kind: "operator" as const, operatorId: "op1" };
const userActor = { kind: "user" as const, userId: "u1" };

function tenantRoot(stateDir: string, tenantId = "t1"): string {
  return path.join(stateDir, "tenants", tenantId);
}

async function seedActiveRecord(
  stateDir: string,
  resourceId = "ca-1",
  locator = path.join(stateDir, "tenants", "t1", "blob.json"),
  storageKind: CatalogRecord["bindings"][number]["storageKind"] = "filesystem",
): Promise<CatalogRecord> {
  if (storageKind === "filesystem") {
    fs.mkdirSync(path.dirname(locator), { recursive: true });
    if (!fs.existsSync(locator)) {
      fs.writeFileSync(locator, '{"v":1}\n');
    }
  }
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
        storageKind,
        locator,
        state: "active",
        contentVersion: "1",
      },
    ],
  };
  await getSharedDataGovernanceCatalog({ stateDir }).put(record);
  return record;
}

async function requestThenResumePrep(params: {
  stateDir: string;
  resourceId?: string;
  operationId: string;
}): Promise<void> {
  await transitionCatalogLifecycleCommand({
    stateDir: params.stateDir,
    resourceId: params.resourceId ?? "ca-1",
    command: "requestPurge",
    expectedStates: ["active"],
    expectedGovernanceVersion: 3,
    operationId: params.operationId,
    requestedBy: actor,
  });
}

async function casCatalogPurgedForTest(stateDir: string, resourceId: string): Promise<void> {
  const catalog = getSharedDataGovernanceCatalog({ stateDir });
  const existing = await catalog.get(resourceId);
  if (!existing) {
    throw new Error("missing record for purged CAS fixture");
  }
  const put = await catalog.compareAndPut({
    resourceId,
    expectedGovernanceVersion: existing.envelope.governanceVersion,
    next: {
      envelope: {
        ...existing.envelope,
        lifecycleState: "purged",
        activeLifecycleOperation: null,
        governanceVersion: existing.envelope.governanceVersion + 1,
        updatedAt: new Date().toISOString(),
      },
      bindings: existing.bindings,
    },
  });
  if (!put.ok) {
    throw new Error(`purged CAS fixture failed: ${put.conflict}`);
  }
}

describe("P2-d purge closure", () => {
  it("closes Catalog to purged after FS destructive + cloud not_applicable", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-close-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);
    const locator = path.join(stateDir, "tenants", "t1", "blob.json");
    expect(fs.existsSync(locator)).toBe(true);

    await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "op-close-1",
      requestedBy: actor,
    });

    const closed = await resumePurge({
      stateDir,
      operationId: "op-close-1",
      attemptId: "att-1",
      executedBy: worker,
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) {
      return;
    }
    expect(closed.closed).toBe(true);
    expect(closed.record.envelope.lifecycleState).toBe("purged");
    expect(closed.record.envelope.activeLifecycleOperation).toBeNull();
    expect(fs.existsSync(locator)).toBe(false);

    const receipt = getLifecycleReceipt({ operationId: "op-close-1", stateDir });
    expect(receipt?.status).toBe("completed");
    expect(
      receipt?.stages.some((s) => s.stage === "purge_execute" && s.status === "succeeded"),
    ).toBe(true);
    expect(
      receipt?.stages.some((s) => s.stage === "cloud_tombstone" && s.status === "not_applicable"),
    ).toBe(true);
    expect(
      receipt?.stages.some((s) => s.stage === "catalog_close" && s.status === "succeeded"),
    ).toBe(true);
  });

  it("fails closed when destructive adapter reports failed (no Catalog purged stub)", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-fail-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);
    await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "op-fail-1",
      requestedBy: actor,
    });

    const failed = await resumePurge({
      stateDir,
      operationId: "op-fail-1",
      attemptId: "att-f",
      executedBy: worker,
      runDestructiveStage: async () => ({ status: "failed", errorCode: "erase_denied" }),
    });
    expect(failed.ok).toBe(false);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).toBe("deletion_pending");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
    expect(record?.envelope.activeLifecycleOperation?.operationId).toBe("op-fail-1");
    expect(getLifecycleReceipt({ operationId: "op-fail-1", stateDir })?.status).toBe("open");
  });

  it("object-store without cloud adapter fails closed (no success stub)", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-cloud-"));
    tempDirs.push(stateDir);
    const now = "2026-08-12T00:00:00Z";
    const record: CatalogRecord = {
      envelope: {
        resourceId: "ca-cloud",
        resourceType: "conversation_archive",
        schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
        tenantId: "t1",
        owner,
        scope,
        lifecycleState: "active",
        classification: "internal",
        governanceVersion: 1,
        canonicalBindingId: "bind-c",
        createdAt: now,
        updatedAt: now,
      },
      bindings: [
        {
          bindingId: "bind-c",
          resourceId: "ca-cloud",
          role: "canonical",
          storageKind: "object-store",
          locator: "s3://bucket/key",
          objectKey: "key",
          state: "active",
          contentVersion: "1",
        },
      ],
    };
    await getSharedDataGovernanceCatalog({ stateDir }).put(record);
    await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-cloud",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 1,
      operationId: "op-cloud-1",
      requestedBy: actor,
    });

    const result = await resumePurge({
      stateDir,
      operationId: "op-cloud-1",
      attemptId: "att-c",
      executedBy: worker,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/cloud_purge_adapter_missing/);
    }
    const after = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-cloud");
    expect(after?.envelope.lifecycleState).toBe("deletion_pending");
    expect(after?.envelope.lifecycleState).not.toBe("purged");
  });

  it("denies resumePurge for owner user actor (A7 execute = worker/operator/system)", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-auth-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);
    await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "op-auth-1",
      requestedBy: actor,
    });
    const denied = await resumePurge({
      stateDir,
      operationId: "op-auth-1",
      attemptId: "att-a",
      executedBy: userActor,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.message).toBe("actor_not_authorized");
    }
  });

  it("writes recovery receipt when Catalog CAS fails after destructive", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-cas-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);
    await transitionCatalogLifecycleCommand({
      stateDir,
      resourceId: "ca-1",
      command: "requestPurge",
      expectedStates: ["active"],
      expectedGovernanceVersion: 3,
      operationId: "op-cas-1",
      requestedBy: actor,
    });

    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    const realCompare = catalog.compareAndPut.bind(catalog);
    let closeAttempts = 0;
    catalog.compareAndPut = async (params) => {
      // First compareAndPut after destructive is catalog_close → force version_conflict.
      if (params.next.envelope.lifecycleState === "purged") {
        closeAttempts += 1;
        return { ok: false as const, conflict: "version_conflict" as const };
      }
      return realCompare(params);
    };

    const result = await resumePurge({
      stateDir,
      operationId: "op-cas-1",
      attemptId: "att-cas",
      executedBy: worker,
      runDestructiveStage: async () => ({ status: "succeeded" }),
    });
    expect(closeAttempts).toBe(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("destructive_ok_catalog_cas_failed");
    }
    const recovery = readGovernanceRecoveryReceipt({
      operationId: "op-cas-1",
      stage: "purge_catalog_close",
      stateDir,
    });
    expect(recovery).not.toBeNull();
    expect(recovery?.haltCompensation).toBe(true);
    const after = await catalog.get("ca-1");
    expect(after?.envelope.lifecycleState).not.toBe("purged");
  });

  it("filesystem file purge fails closed when parent dir fsync fails", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-fsync-file-"));
    tempDirs.push(stateDir);
    const locator = path.join(tenantRoot(stateDir), "mem-root", "blob.json");
    await seedActiveRecord(stateDir, "ca-1", locator);
    await requestThenResumePrep({ stateDir, operationId: "op-fsync-file" });

    const spy = vi.spyOn(fs, "fsyncSync").mockImplementation(() => {
      throw Object.assign(new Error("EIO"), { code: "EIO" });
    });
    try {
      const result = await resumePurge({
        stateDir,
        operationId: "op-fsync-file",
        attemptId: "att-ff",
        executedBy: worker,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/dir_fsync_failed:canonical_unlink:/);
      }
    } finally {
      spy.mockRestore();
    }
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
    expect(record?.envelope.lifecycleState).toBe("deletion_pending");
    expect(getLifecycleReceipt({ operationId: "op-fsync-file", stateDir })?.status).toBe("open");
  });

  it("filesystem directory purge fails closed when parent dir fsync fails", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-fsync-dir-"));
    tempDirs.push(stateDir);
    const locator = path.join(tenantRoot(stateDir), "mem-root", "canonical-dir");
    fs.mkdirSync(locator, { recursive: true });
    fs.writeFileSync(path.join(locator, "inner.json"), '{"v":1}\n');
    await seedActiveRecord(stateDir, "ca-1", locator);
    await requestThenResumePrep({ stateDir, operationId: "op-fsync-dir" });

    const spy = vi.spyOn(fs, "fsyncSync").mockImplementation(() => {
      throw Object.assign(new Error("EIO"), { code: "EIO" });
    });
    try {
      const result = await resumePurge({
        stateDir,
        operationId: "op-fsync-dir",
        attemptId: "att-fd",
        executedBy: worker,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/dir_fsync_failed:canonical_unlink:/);
      }
    } finally {
      spy.mockRestore();
    }
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
    expect(getLifecycleReceipt({ operationId: "op-fsync-dir", stateDir })?.status).toBe("open");
  });

  it("missing-on-resume purge fails closed until parent dir fsync succeeds", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-missing-resume-"));
    tempDirs.push(stateDir);
    const memDir = path.join(tenantRoot(stateDir), "mem-root");
    const locator = path.join(memDir, "blob.json");
    await seedActiveRecord(stateDir, "ca-1", locator);
    await requestThenResumePrep({ stateDir, operationId: "op-missing-resume" });

    fs.unlinkSync(locator);
    fs.rmdirSync(memDir);

    const result = await resumePurge({
      stateDir,
      operationId: "op-missing-resume",
      attemptId: "att-mr",
      executedBy: worker,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/dir_fsync_failed:canonical_unlink:/);
    }
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
    expect(record?.envelope.lifecycleState).toBe("deletion_pending");
    expect(getLifecycleReceipt({ operationId: "op-missing-resume", stateDir })?.status).toBe(
      "open",
    );
  });

  it("postgres binding fails closed to dedicated adapter missing and does not rm locator", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-pg-"));
    tempDirs.push(stateDir);
    const bait = path.join(stateDir, "must-not-delete.json");
    fs.writeFileSync(bait, '{"keep":true}\n');
    await seedActiveRecord(stateDir, "ca-1", bait, "postgres");
    await requestThenResumePrep({ stateDir, operationId: "op-pg-1" });

    const result = await resumePurge({
      stateDir,
      operationId: "op-pg-1",
      attemptId: "att-pg",
      executedBy: worker,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("postgres_purge_adapter_missing");
    }
    expect(fs.existsSync(bait)).toBe(true);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
    expect(record?.envelope.lifecycleState).toBe("deletion_pending");
  });

  it("sqlite non-file locator fails closed and does not use filesystem eraser", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-sqlite-uri-"));
    tempDirs.push(stateDir);
    const bait = path.join(stateDir, "must-not-delete.sqlite");
    fs.writeFileSync(bait, "sqlite-bait");
    await seedActiveRecord(stateDir, "ca-1", "sqlite:///tmp/not-a-controlled-file.db", "sqlite");
    await requestThenResumePrep({ stateDir, operationId: "op-sqlite-uri" });

    const result = await resumePurge({
      stateDir,
      operationId: "op-sqlite-uri",
      attemptId: "att-sql",
      executedBy: worker,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("sqlite_locator_not_local_file");
    }
    expect(fs.existsSync(bait)).toBe(true);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
  });

  it("heals open receipt after Catalog purged CAS before catalog_close stage", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-heal-pre-close-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);
    await requestThenResumePrep({ stateDir, operationId: "op-heal-pre" });

    const mid = await resumePurge({
      stateDir,
      operationId: "op-heal-pre",
      attemptId: "att-pre",
      executedBy: worker,
      closeOnSuccess: false,
    });
    expect(mid.ok).toBe(true);
    if (mid.ok) {
      expect(mid.closed).toBe(false);
    }
    await casCatalogPurgedForTest(stateDir, "ca-1");

    const recovered = await recoverPurgeAttempt({
      stateDir,
      operationId: "op-heal-pre",
      attemptId: "att-pre",
    });
    expect(recovered.ok).toBe(true);
    expect(recovered.canResume).toBe(false);
    if (!recovered.canResume && "healed" in recovered) {
      expect(recovered.healed).toBe(true);
      expect(recovered.receipt.status).toBe("completed");
      expect(
        recovered.receipt.stages.some(
          (s) => s.stage === "catalog_close" && s.status === "succeeded",
        ),
      ).toBe(true);
    } else {
      expect.fail("expected healed receipt after CAS-before-catalog_close crash");
    }
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).toBe("purged");
  });

  it("heals open receipt after catalog_close stage before finalize", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-heal-pre-final-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);
    await requestThenResumePrep({ stateDir, operationId: "op-heal-final" });

    const mid = await resumePurge({
      stateDir,
      operationId: "op-heal-final",
      attemptId: "att-final",
      executedBy: worker,
      closeOnSuccess: false,
    });
    expect(mid.ok).toBe(true);
    await casCatalogPurgedForTest(stateDir, "ca-1");
    await appendLifecycleReceiptStage({
      operationId: "op-heal-final",
      executedBy: worker,
      stateDir,
      stage: {
        stage: "catalog_close",
        status: "succeeded",
        attemptId: "att-final",
        attempt: 1,
        actor: worker,
        targetBindingIds: ["bind-1"],
        completedAt: new Date().toISOString(),
      },
    });
    expect(getLifecycleReceipt({ operationId: "op-heal-final", stateDir })?.status).toBe("open");

    const recovered = await recoverPurgeAttempt({
      stateDir,
      operationId: "op-heal-final",
      attemptId: "att-final",
    });
    expect(recovered.ok).toBe(true);
    expect(recovered.canResume).toBe(false);
    if (!recovered.canResume && "healed" in recovered) {
      expect(recovered.healed).toBe(true);
      expect(recovered.receipt.status).toBe("completed");
      expect(
        recovered.receipt.stages.filter(
          (s) => s.stage === "catalog_close" && s.status === "succeeded",
        ).length,
      ).toBe(1);
    } else {
      expect.fail("expected healed receipt after catalog_close-before-finalize crash");
    }
  });

  it("keeps recovery_required when Catalog is purged without destructive evidence", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-heal-no-evidence-"));
    tempDirs.push(stateDir);
    await seedActiveRecord(stateDir);
    await requestThenResumePrep({ stateDir, operationId: "op-heal-none" });
    await casCatalogPurgedForTest(stateDir, "ca-1");

    const recovered = await recoverPurgeAttempt({
      stateDir,
      operationId: "op-heal-none",
      attemptId: "att-none",
    });
    expect(recovered.ok).toBe(true);
    expect(recovered.canResume).toBe(false);
    if (!recovered.canResume && "recoveryRequired" in recovered) {
      expect(recovered.recoveryRequired).toBe(true);
      expect(recovered.reason).toBe("purged_open_receipt_insufficient_evidence");
    } else {
      expect.fail("expected recovery_required without guessing success");
    }
    expect(getLifecycleReceipt({ operationId: "op-heal-none", stateDir })?.status).toBe("open");
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).toBe("purged");
  });

  it("sqlite absolute path outside allowed root fails closed and does not delete", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-sqlite-out-"));
    tempDirs.push(stateDir);
    fs.mkdirSync(tenantRoot(stateDir), { recursive: true });
    const outside = path.join(stateDir, "unrelated.sqlite");
    fs.writeFileSync(outside, "sqlite-bait");
    await seedActiveRecord(stateDir, "ca-1", outside, "sqlite");
    await requestThenResumePrep({ stateDir, operationId: "op-sqlite-out" });

    const result = await resumePurge({
      stateDir,
      operationId: "op-sqlite-out",
      attemptId: "att-sql-out",
      executedBy: worker,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("purge_path_not_in_allowed_root");
    }
    expect(fs.existsSync(outside)).toBe(true);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
  });

  it("filesystem cross-tenant path fails closed and retains the other tenant file", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-xtenant-"));
    tempDirs.push(stateDir);
    fs.mkdirSync(tenantRoot(stateDir), { recursive: true });
    const t2Locator = path.join(tenantRoot(stateDir, "t2"), "blob.json");
    await seedActiveRecord(stateDir, "ca-1", t2Locator);
    await requestThenResumePrep({ stateDir, operationId: "op-xtenant" });

    const result = await resumePurge({
      stateDir,
      operationId: "op-xtenant",
      attemptId: "att-xt",
      executedBy: worker,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("purge_path_not_in_allowed_root");
    }
    expect(fs.existsSync(t2Locator)).toBe(true);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
  });

  it("locator equal to allowed root fails closed and does not rm the root", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-eqroot-"));
    tempDirs.push(stateDir);
    const root = tenantRoot(stateDir);
    fs.mkdirSync(root, { recursive: true });
    const keep = path.join(root, "keep.json");
    fs.writeFileSync(keep, '{"keep":true}\n');
    await seedActiveRecord(stateDir, "ca-1", root);
    await requestThenResumePrep({ stateDir, operationId: "op-eqroot" });

    const result = await resumePurge({
      stateDir,
      operationId: "op-eqroot",
      attemptId: "att-eq",
      executedBy: worker,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("purge_path_equals_allowed_root");
    }
    expect(fs.existsSync(root)).toBe(true);
    expect(fs.existsSync(keep)).toBe(true);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
  });

  it("symlink realpath escape fails closed and does not delete the target", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-symlink-"));
    tempDirs.push(stateDir);
    fs.mkdirSync(tenantRoot(stateDir), { recursive: true });
    const secret = path.join(tenantRoot(stateDir, "t2"), "secret.json");
    fs.mkdirSync(path.dirname(secret), { recursive: true });
    fs.writeFileSync(secret, "secret");
    const link = path.join(tenantRoot(stateDir), "escape.json");
    fs.symlinkSync(secret, link);
    await seedActiveRecord(stateDir, "ca-1", link);
    await requestThenResumePrep({ stateDir, operationId: "op-symlink" });

    const result = await resumePurge({
      stateDir,
      operationId: "op-symlink",
      attemptId: "att-sy",
      executedBy: worker,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("purge_path_symlink_escape");
    }
    expect(fs.existsSync(secret)).toBe(true);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
  });

  it("missing-on-resume parent outside allowed root fails closed", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-miss-out-"));
    tempDirs.push(stateDir);
    fs.mkdirSync(tenantRoot(stateDir), { recursive: true });
    const foreignDir = path.join(tenantRoot(stateDir, "t2"), "gone");
    const locator = path.join(foreignDir, "blob.json");
    fs.mkdirSync(foreignDir, { recursive: true });
    fs.writeFileSync(locator, '{"v":1}\n');
    await seedActiveRecord(stateDir, "ca-1", locator);
    await requestThenResumePrep({ stateDir, operationId: "op-miss-out" });
    fs.unlinkSync(locator);
    fs.rmdirSync(foreignDir);

    const result = await resumePurge({
      stateDir,
      operationId: "op-miss-out",
      attemptId: "att-mo",
      executedBy: worker,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(
        /purge_path_not_in_allowed_root|purge_parent_not_in_allowed_root/,
      );
    }
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(record?.envelope.lifecycleState).not.toBe("purged");
    expect(getLifecycleReceipt({ operationId: "op-miss-out", stateDir })?.status).toBe("open");
  });

  it("ignores worker/operator excess allowedRoots and keeps the trusted tenant root", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-widen-"));
    tempDirs.push(stateDir);
    fs.mkdirSync(tenantRoot(stateDir), { recursive: true });
    const t2Locator = path.join(tenantRoot(stateDir, "t2"), "blob.json");
    await seedActiveRecord(stateDir, "ca-1", t2Locator);
    await requestThenResumePrep({ stateDir, operationId: "op-widen-w" });

    const widened = {
      stateDir,
      operationId: "op-widen-w",
      attemptId: "att-ww",
      executedBy: worker,
      allowedRoots: [path.dirname(t2Locator)],
    };
    const workerResult = await resumePurge(widened as ResumePurgeParams);
    expect(workerResult.ok).toBe(false);
    if (!workerResult.ok) {
      expect(workerResult.message).toBe("purge_path_not_in_allowed_root");
    }
    expect(fs.existsSync(t2Locator)).toBe(true);

    await seedActiveRecord(stateDir, "ca-2", t2Locator);
    await requestThenResumePrep({
      stateDir,
      resourceId: "ca-2",
      operationId: "op-widen-op",
    });
    const opWidened = {
      stateDir,
      operationId: "op-widen-op",
      attemptId: "att-wo",
      executedBy: operator,
      allowedRoots: [stateDir],
    };
    const opResult = await resumePurge(opWidened as ResumePurgeParams);
    expect(opResult.ok).toBe(false);
    expect(fs.existsSync(t2Locator)).toBe(true);
    const ca2 = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-2");
    expect(ca2?.envelope.lifecycleState).not.toBe("purged");
  });

  it("rejects a storage handle that expands roots or is reused across resource/operation", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-p2d-handle-"));
    tempDirs.push(stateDir);
    const locator = path.join(tenantRoot(stateDir), "blob.json");
    await seedActiveRecord(stateDir, "ca-1", locator);
    await seedActiveRecord(stateDir, "ca-2", path.join(tenantRoot(stateDir), "other.json"));
    await requestThenResumePrep({ stateDir, operationId: "op-handle-1" });
    await requestThenResumePrep({
      stateDir,
      resourceId: "ca-2",
      operationId: "op-handle-2",
    });

    const record = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    const issued = issuePurgeStorageHandle({
      record: record!,
      operationId: "op-handle-1",
      stateDir,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) {
      return;
    }

    const expanded = await resumePurge({
      stateDir,
      operationId: "op-handle-1",
      attemptId: "att-exp",
      executedBy: worker,
      storageHandle: { ...issued.handle, allowedRoots: [stateDir] },
    });
    expect(expanded.ok).toBe(false);
    if (!expanded.ok) {
      expect(expanded.message).toBe("purge_handle_root_not_contained");
    }

    const crossResource = await resumePurge({
      stateDir,
      operationId: "op-handle-2",
      attemptId: "att-xr",
      executedBy: worker,
      storageHandle: issued.handle,
    });
    expect(crossResource.ok).toBe(false);
    if (!crossResource.ok) {
      expect(crossResource.message).toMatch(
        /purge_handle_resource_mismatch|purge_handle_operation_mismatch/,
      );
    }

    const crossOp = await resumePurge({
      stateDir,
      operationId: "op-handle-1",
      attemptId: "att-xo",
      executedBy: worker,
      storageHandle: { ...issued.handle, operationId: "op-handle-2" },
    });
    expect(crossOp.ok).toBe(false);
    if (!crossOp.ok) {
      expect(crossOp.message).toBe("purge_handle_operation_mismatch");
    }

    const crossBinding = await resumePurge({
      stateDir,
      operationId: "op-handle-1",
      attemptId: "att-xb",
      executedBy: worker,
      storageHandle: { ...issued.handle, bindingId: "bind-other" },
    });
    expect(crossBinding.ok).toBe(false);
    if (!crossBinding.ok) {
      expect(crossBinding.message).toBe("purge_handle_binding_mismatch");
    }

    const crossTenant = await resumePurge({
      stateDir,
      operationId: "op-handle-1",
      attemptId: "att-xtn",
      executedBy: worker,
      storageHandle: { ...issued.handle, tenantId: "t-other" },
    });
    expect(crossTenant.ok).toBe(false);
    if (!crossTenant.ok) {
      expect(crossTenant.message).toBe("purge_handle_tenant_mismatch");
    }

    expect(fs.existsSync(locator)).toBe(true);
    const stillPending = await getSharedDataGovernanceCatalog({ stateDir }).get("ca-1");
    expect(stillPending?.envelope.lifecycleState).not.toBe("purged");
  });
});
