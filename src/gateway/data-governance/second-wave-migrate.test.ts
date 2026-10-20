import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listGovernanceRecoveryReceipts } from "./recovery-receipt.js";
import {
  getSharedDataGovernanceCatalog,
  resetSharedDataGovernanceCatalogForTests,
} from "./runtime-catalog.js";
import {
  migrateSecondWaveCandidates,
  rollbackSecondWaveMigration,
  SECOND_WAVE_MIGRATION_EXCLUDED,
  type SecondWaveMigrationCandidate,
} from "./second-wave-migrate.js";

const tempDirs: string[] = [];
afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function knowledgeCandidate(
  stateDir: string,
  overrides?: Partial<SecondWaveMigrationCandidate>,
): SecondWaveMigrationCandidate {
  const locator = path.join(stateDir, "docs", "d1-v1.json");
  fs.mkdirSync(path.dirname(locator), { recursive: true });
  fs.writeFileSync(locator, "{}");
  return {
    classId: "K3",
    resourceType: "knowledge",
    tenantId: "t1",
    owner: { kind: "user", userId: "u1" },
    scope: { kind: "tenant", tenantId: "t1" },
    contentClass: "document_version",
    docId: "d1",
    versionId: "v1",
    canonicalLocator: locator,
    ...overrides,
  };
}

describe("second-wave migration (P1-2-f)", () => {
  it("excludes secrets classes from Catalog migration", () => {
    expect(SECOND_WAVE_MIGRATION_EXCLUDED.has("OI2")).toBe(true);
    expect(SECOND_WAVE_MIGRATION_EXCLUDED.has("OI6")).toBe(true);
  });

  it("dry-run plans without writing Catalog", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-mig-dry-"));
    tempDirs.push(stateDir);
    const candidate = knowledgeCandidate(stateDir);
    const report = await migrateSecondWaveCandidates({
      operationId: "op-dry-1",
      candidates: [candidate],
      stateDir,
      dryRun: true,
    });
    expect(report.items[0]?.status).toBe("planned");
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get(
      report.items[0].resourceId,
    );
    expect(record).toBeNull();
  });

  it("migrates knowledge pending→dual-read→cutover idempotently", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-mig-ok-"));
    tempDirs.push(stateDir);
    const candidate = knowledgeCandidate(stateDir);

    const first = await migrateSecondWaveCandidates({
      operationId: "op-mig-1",
      candidates: [candidate],
      stateDir,
    });
    expect(first.items[0]?.status).toBe("cutover_active");
    expect(first.dualWriteDetected).toBe(false);

    const record = await getSharedDataGovernanceCatalog({ stateDir }).get(
      first.items[0].resourceId,
    );
    expect(record?.envelope.lifecycleState).toBe("active");
    expect(JSON.stringify(record)).not.toMatch(/embedding|chunk text/i);

    const second = await migrateSecondWaveCandidates({
      operationId: "op-mig-1b",
      candidates: [candidate],
      stateDir,
    });
    expect(second.items[0]?.status).toBe("skipped_already_active");
  });

  it("skips excluded OI secrets and migrates OI metadata only", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-mig-oi-"));
    tempDirs.push(stateDir);
    const meta = path.join(stateDir, "openbot-user-operational-identity.json");
    const secrets = path.join(stateDir, "openbot-user-operational-identity-secrets.json");
    fs.writeFileSync(meta, "{}");
    fs.writeFileSync(secrets, JSON.stringify({ token: "secret-value" }));

    const report = await migrateSecondWaveCandidates({
      operationId: "op-oi-1",
      candidates: [
        {
          classId: "OI2",
          resourceType: "operational_identity",
          tenantId: "t1",
          owner: { kind: "user", userId: "u1" },
          scope: { kind: "tenant", tenantId: "t1" },
          identityId: "should-not-migrate",
          canonicalLocator: secrets,
        },
        {
          classId: "OI1",
          resourceType: "operational_identity",
          tenantId: "t1",
          owner: { kind: "user", userId: "u1" },
          scope: { kind: "tenant", tenantId: "t1" },
          identityId: "id-github-1",
          credentialHandleId: "cred-1",
          agentAssetId: "asset-1",
          canonicalLocator: meta,
        },
      ],
      stateDir,
    });

    expect(report.items[0]?.status).toBe("skipped_excluded");
    expect(report.items[1]?.status).toBe("cutover_active");
    const oi = await getSharedDataGovernanceCatalog({ stateDir }).get(report.items[1].resourceId);
    expect(JSON.stringify(oi)).not.toContain("secret-value");
    expect(oi?.envelope.projection?.credentialHandleId).toBe("cred-1");
  });

  it("fault after dual_read rolls back to recovery_required without dual active canonicals", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-mig-fault-"));
    tempDirs.push(stateDir);
    const candidate = knowledgeCandidate(stateDir);

    const report = await migrateSecondWaveCandidates({
      operationId: "op-fault-1",
      candidates: [candidate],
      stateDir,
      faultAfter: "dual_read",
      rollbackOnFault: true,
    });

    expect(report.items[0]?.status).toBe("recovery_required");
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get(
      report.items[0].resourceId,
    );
    expect(record?.envelope.lifecycleState).toBe("recovery_required");

    const receipts = listGovernanceRecoveryReceipts({
      operationId: "op-fault-1",
      stateDir,
    });
    expect(receipts.length).toBeGreaterThan(0);
  });

  it("allows shared KB locator across document versions (objectKey uniqueness)", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-mig-shared-"));
    tempDirs.push(stateDir);
    const shared = path.join(stateDir, "shared.sqlite");
    fs.writeFileSync(shared, "");

    const a = knowledgeCandidate(stateDir, {
      docId: "d1",
      versionId: "v1",
      canonicalLocator: shared,
    });
    const b = knowledgeCandidate(stateDir, {
      docId: "d2",
      versionId: "v1",
      canonicalLocator: shared,
    });

    const first = await migrateSecondWaveCandidates({
      operationId: "op-shared-1",
      candidates: [a],
      stateDir,
    });
    expect(first.items[0]?.status).toBe("cutover_active");

    const second = await migrateSecondWaveCandidates({
      operationId: "op-shared-2",
      candidates: [b],
      stateDir,
      rollbackOnFault: true,
    });
    expect(second.dualWriteDetected).toBe(false);
    expect(second.items[0]?.status).toBe("cutover_active");
  });

  it("detects duplicate canonical when locator+objectKey collide", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-mig-dup-"));
    tempDirs.push(stateDir);
    const shared = path.join(stateDir, "exclusive.json");
    fs.writeFileSync(shared, "{}");

    const a = knowledgeCandidate(stateDir, {
      docId: "d1",
      versionId: "v1",
      canonicalLocator: shared,
    });

    const first = await migrateSecondWaveCandidates({
      operationId: "op-dup-1",
      candidates: [a],
      stateDir,
    });
    expect(first.items[0]?.status).toBe("cutover_active");

    // Force a true uniqueness collision: same locator + same objectKey on another resourceId.
    const catalog = getSharedDataGovernanceCatalog({ stateDir });
    const existing = await catalog.get(first.items[0].resourceId);
    expect(existing).toBeTruthy();
    const collidingId = "knowledge:t1:doc:d1:v1-collision";
    const collidingBindId = `bind:${collidingId}`;
    await catalog.put({
      envelope: {
        ...existing!.envelope,
        resourceId: collidingId,
        canonicalBindingId: collidingBindId,
        projection: {
          ...existing!.envelope.projection,
          versionId: "v1-collision",
        },
      },
      bindings: existing!.bindings.map((b) =>
        b.role === "canonical"
          ? {
              ...b,
              bindingId: collidingBindId,
              resourceId: collidingId,
              // Same objectKey as the first resource → duplicate_canonical.
              objectKey: existing!.envelope.resourceId,
            }
          : {
              ...b,
              bindingId: `bind:${collidingId}:${b.role}`,
              resourceId: collidingId,
              objectKey: existing!.envelope.resourceId,
            },
      ),
    });

    const b = knowledgeCandidate(stateDir, {
      docId: "d2",
      versionId: "v9",
      canonicalLocator: shared,
    });
    const second = await migrateSecondWaveCandidates({
      operationId: "op-dup-2",
      candidates: [b],
      stateDir,
      rollbackOnFault: true,
    });
    // dual-read scans all catalog rows; colliding objectKey triggers fail-closed.
    expect(
      second.dualWriteDetected ||
        second.items[0]?.error?.includes("duplicate") ||
        second.duplicateCanonicals.length > 0,
    ).toBe(true);
  });

  it("explicit rollback marks cutover rows recovery_required", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-mig-rb-"));
    tempDirs.push(stateDir);
    const candidate = knowledgeCandidate(stateDir);
    const report = await migrateSecondWaveCandidates({
      operationId: "op-rb-1",
      candidates: [candidate],
      stateDir,
    });
    const resourceId = report.items[0].resourceId;
    const rb = await rollbackSecondWaveMigration({
      operationId: "op-rb-2",
      items: [{ resourceType: "knowledge", resourceId }],
      reason: "operator_rollback",
      stateDir,
    });
    expect(rb.rolledBack).toEqual([resourceId]);
    const record = await getSharedDataGovernanceCatalog({ stateDir }).get(resourceId);
    expect(record?.envelope.lifecycleState).toBe("recovery_required");
  });

  it("refuses active skip when locator/owner diverge", async () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-mig-conflict-"));
    tempDirs.push(stateDir);
    const candidate = knowledgeCandidate(stateDir);
    const first = await migrateSecondWaveCandidates({
      operationId: "op-c-1",
      candidates: [candidate],
      stateDir,
    });
    expect(first.items[0]?.status).toBe("cutover_active");

    const otherLocator = path.join(stateDir, "docs", "other.json");
    fs.writeFileSync(otherLocator, "{}");
    const conflictLocator = await migrateSecondWaveCandidates({
      operationId: "op-c-2",
      candidates: [{ ...candidate, canonicalLocator: otherLocator }],
      stateDir,
      rollbackOnFault: false,
    });
    expect(conflictLocator.items[0]?.status).toBe("conflict_existing");
    expect(conflictLocator.items[0]?.error).toMatch(/locator/);

    const conflictOwner = await migrateSecondWaveCandidates({
      operationId: "op-c-3",
      candidates: [
        {
          ...candidate,
          owner: { kind: "user", userId: "u-other" },
        },
      ],
      stateDir,
      rollbackOnFault: false,
    });
    expect(conflictOwner.items[0]?.status).toBe("conflict_existing");
    expect(conflictOwner.items[0]?.error).toMatch(/owner/);
  });
});
