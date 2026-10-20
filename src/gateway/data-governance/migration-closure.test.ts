import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createFileDataGovernanceCatalogStore } from "./catalog-store.js";
import type { DataGovernanceCatalogStore } from "./catalog-store.js";
import {
  applyMigrationBatch,
  type ConstrainedMigrationHandle,
  type MigrationApplyItem,
} from "./migration-apply.js";
import {
  assertMigrationProductionBoundary,
  detectInventoryDrift,
  evaluateMigrationBatchSlos,
  runMigrationClosureReport,
  runMigrationInterruptResumeDrill,
  runMigrationRollbackDrill,
  verifyC19ProbeEvidence,
  verifyMigrationInterruptResumeEvidence,
} from "./migration-closure.js";
import { planMigrationIdentities } from "./migration-identity-plan.js";
import {
  inventoryMigrationCandidates,
  type MigrationInventoryInput,
  type ObservedMigrationSource,
} from "./migration-inventory.js";
import { GOV_LOGICAL_OP_DIR, readGovernanceLogicalOpMarker } from "./operation-marker.js";
import {
  GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
  type CatalogRecord,
  type GovernanceLifecycleReceipt,
} from "./types.js";
import type { GovernanceOwnershipProof } from "./write-gate.js";

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.kiro/specs/data-governance-v2-migration/fixtures/tenant-m0-dry-run.json",
);
const c19SummaryPath = path.resolve(
  process.cwd(),
  "docs/design/evidence/workspace-isolation-20260810-001.summary.json",
);

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
  callerTenantId: string;
  catalogRecords: CatalogRecord[];
  receipts: unknown[];
  sources: ObservedMigrationSource[];
};

const SIGNING_KEY = "m4-closure-hmac-key";

const adaProof: GovernanceOwnershipProof = {
  owner: { kind: "user", userId: "user-ada" },
  scope: { kind: "tenant", tenantId: "tenant-acme" },
};

const oiProof: GovernanceOwnershipProof = {
  owner: { kind: "system", systemId: "enterprise-oi" },
  scope: { kind: "tenant", tenantId: "tenant-acme" },
};

const DEFAULT_SLO = {
  minMigratedRatio: 0.8,
  maxFailureRatio: 0.1,
  maxQuarantineRatio: 0.1,
  maxRecoveryBacklog: 2,
};

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-m4-"));
  tempDirs.push(dir);
  return dir;
}

function fixtureInput(): MigrationInventoryInput {
  return {
    callerTenantId: fixture.callerTenantId,
    catalogRecords: fixture.catalogRecords,
    receipts: fixture.receipts as GovernanceLifecycleReceipt[],
    sources: fixture.sources,
  };
}

function fixtureProofs(): Record<string, GovernanceOwnershipProof> {
  return {
    "src-owned-ws": adaProof,
    "src-already-ws": adaProof,
    "catalog:ws-acme-root": adaProof,
    "catalog:agent-acme-ada": adaProof,
    "catalog:conv-acme-1": adaProof,
    "catalog:kb-acme-policy": adaProof,
    "catalog:mem-acme-1": adaProof,
    "catalog:oi-acme-ada": oiProof,
    "catalog:ws-acme-hold": adaProof,
  };
}

function adoptingHandle(root: string): ConstrainedMigrationHandle {
  return {
    async write(params) {
      const dest = path.join(root, "canonical", params.resourceId);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, params.expectedChecksum, "utf8");
      return { checksum: params.expectedChecksum, bindingLocator: dest, storageKind: "filesystem" };
    },
  };
}

function item(status: MigrationApplyItem["status"], candidateId: string): MigrationApplyItem {
  return {
    candidateId,
    status,
    resourceId: status === "migrated" ? `res-${candidateId}` : null,
    receipt: {
      kind: "m2_migration_receipt",
      receiptId: `r-${candidateId}`,
      operationId: `op-${candidateId}`,
      batchId: "batch-m4",
      tenantId: "tenant-acme",
      candidateId,
      resourceId: status === "migrated" ? `res-${candidateId}` : null,
      resourceType: "workspace",
      status,
      inventoryChecksum: "inv",
      planChecksum: "plan",
      contentChecksum: null,
      previousLocator: "/old",
      canonicalBindingId: null,
      observationLocator: null,
    },
  };
}

function workspaceRecord(resourceId: string): CatalogRecord {
  return {
    envelope: {
      resourceId,
      resourceType: "workspace",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: "tenant-acme",
      owner: { kind: "user", userId: "user-ada" },
      scope: { kind: "tenant", tenantId: "tenant-acme" },
      lifecycleState: "active",
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: `canonical:${resourceId}`,
      createdAt: "2026-08-18T00:00:00Z",
      updatedAt: "2026-08-18T00:00:00Z",
    },
    bindings: [
      {
        bindingId: `canonical:${resourceId}`,
        resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: `/canonical/${resourceId}`,
        state: "active",
        contentVersion: "sha256:ws",
      },
    ],
  };
}

function failOnceCompareAndPutStore(inner: DataGovernanceCatalogStore): DataGovernanceCatalogStore {
  let failed = false;
  return {
    get: (resourceId) => inner.get(resourceId),
    put: (record) => inner.put(record),
    remove: (resourceId) => inner.remove(resourceId),
    list: (resourceType) => inner.list(resourceType),
    compareAndPut: async (params) => {
      if (!failed) {
        failed = true;
        return { ok: false, conflict: "version_conflict" };
      }
      return inner.compareAndPut(params);
    },
  };
}

async function applyOwnedWorkspaceBatch(params: {
  root: string;
  store: DataGovernanceCatalogStore;
  batchId: string;
  handle: ConstrainedMigrationHandle;
}) {
  const inventory = inventoryMigrationCandidates(fixtureInput());
  const planned = planMigrationIdentities({
    inventory,
    callerTenantId: "tenant-acme",
    proofs: fixtureProofs(),
    signingKey: SIGNING_KEY,
  });
  expect(planned.ok).toBe(true);
  if (!planned.ok) {
    throw new Error("plan_failed");
  }
  const result = await applyMigrationBatch({
    callerTenantId: "tenant-acme",
    authorizedTenantId: "tenant-acme",
    batchId: params.batchId,
    inventory,
    plan: planned.plan,
    proofs: fixtureProofs(),
    signingKey: SIGNING_KEY,
    store: params.store,
    handle: params.handle,
    stateDir: params.root,
    receiptDir: path.join(params.root, "receipts"),
    candidateIds: ["src-owned-ws"],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.reasonCode);
  }
  return result;
}

describe("migration closure M4", () => {
  it("evaluates batch SLOs from apply item statuses", () => {
    const pass = evaluateMigrationBatchSlos({
      items: [
        item("migrated", "a"),
        item("migrated", "b"),
        item("migrated", "c"),
        item("migrated", "d"),
        item("migrated", "e"),
        item("migrated", "f"),
        item("migrated", "g"),
        item("migrated", "h"),
        item("migrated", "i"),
        item("quarantined", "j"),
      ],
      policy: DEFAULT_SLO,
    });
    expect(pass.passed).toBe(true);
    expect(pass.migrated).toBe(9);

    const fail = evaluateMigrationBatchSlos({
      items: [
        item("migrated", "a"),
        item("blocked", "b"),
        item("recovery_required", "c"),
        item("recovery_required", "d"),
        item("recovery_required", "e"),
      ],
      policy: DEFAULT_SLO,
    });
    expect(fail.passed).toBe(false);
    expect(fail.violations).toContain("failure_ratio_above_ceiling");
    expect(fail.violations).toContain("recovery_backlog_above_ceiling");
  });

  it("detects inventory drift against a signed baseline checksum", () => {
    const live = inventoryMigrationCandidates(fixtureInput());
    expect(detectInventoryDrift({ baselineChecksum: live.inventoryChecksum, live })).toEqual({
      ok: true,
    });
    expect(detectInventoryDrift({ baselineChecksum: "sha256:stale-baseline", live }).ok).toBe(
      false,
    );
  });

  it("requires Managed Enterprise dedicated boundary and tenants root for production", () => {
    const ok = assertMigrationProductionBoundary({
      env: { OPENBOT_SECURITY_PROFILE: "personal_local" },
    });
    expect(ok).toEqual({ ok: true });

    const missing = assertMigrationProductionBoundary({
      env: {
        OPENBOT_SECURITY_PROFILE: "managed_enterprise",
        OPENBOT_TENANT_EXECUTION_BOUNDARY: "shared_process",
      },
    });
    expect(missing).toEqual({ ok: false, reasonCode: "production_boundary_missing" });

    const noRoot = assertMigrationProductionBoundary({
      env: {
        OPENBOT_SECURITY_PROFILE: "managed_enterprise",
        OPENBOT_TENANT_EXECUTION_BOUNDARY: "dedicated",
      },
    });
    expect(noRoot).toEqual({ ok: false, reasonCode: "tenants_root_missing" });

    const ready = assertMigrationProductionBoundary({
      env: {
        OPENBOT_SECURITY_PROFILE: "managed_enterprise",
        OPENBOT_TENANT_EXECUTION_BOUNDARY: "dedicated",
        OPENBOT_TENANTS_ROOT: "/var/openbot/tenants",
      },
    });
    expect(ready).toEqual({ ok: true });
  });

  it("verifies C19 summarySha256 evidence artifact", () => {
    const verified = verifyC19ProbeEvidence({ summaryPath: c19SummaryPath });
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.summarySha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(verifyC19ProbeEvidence({ summaryPath: path.join(tmp(), "missing.json") })).toEqual({
      ok: false,
      reasonCode: "c19_summary_missing",
    });
  });

  it("writes a production-ready closure receipt when all checks pass", async () => {
    const root = tmp();
    const live = inventoryMigrationCandidates(fixtureInput());
    const report = await runMigrationClosureReport({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-close",
      items: [item("migrated", "a"), item("migrated", "b")],
      sloPolicy: DEFAULT_SLO,
      baselineInventoryChecksum: live.inventoryChecksum,
      liveInventory: live,
      c19SummaryPath,
      env: { OPENBOT_SECURITY_PROFILE: "personal_local" },
      receiptDir: path.join(root, "m4-receipts"),
    });
    expect(report.ok).toBe(true);
    if (!report.ok) {
      return;
    }
    expect(report.receipt.productionReady).toBe(true);
    expect(report.receipt.findings.every((f) => f.passed)).toBe(true);
    expect(fs.existsSync(path.join(root, "m4-receipts", `${report.receipt.receiptId}.json`))).toBe(
      true,
    );
  });

  it("fails closed when C19 summary path is missing and does not claim production ready", async () => {
    const root = tmp();
    const live = inventoryMigrationCandidates(fixtureInput());
    const report = await runMigrationClosureReport({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-no-c19",
      items: [item("migrated", "a")],
      sloPolicy: DEFAULT_SLO,
      baselineInventoryChecksum: live.inventoryChecksum,
      liveInventory: live,
      c19SummaryPath: "",
      env: { OPENBOT_SECURITY_PROFILE: "personal_local" },
      receiptDir: path.join(root, "m4-receipts"),
    });
    expect(report.ok).toBe(false);
    if (report.ok) {
      return;
    }
    expect(report.reasonCode).toBe("c19_probe_invalid");
    expect(report.receipt.productionReady).toBe(false);
    expect(report.receipt.findings.find((f) => f.check === "c19_probe")?.passed).toBe(false);
  });

  it("fails closed on inventory drift and does not claim production ready", async () => {
    const root = tmp();
    const live = inventoryMigrationCandidates(fixtureInput());
    const report = await runMigrationClosureReport({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-drift",
      items: [item("migrated", "a")],
      sloPolicy: DEFAULT_SLO,
      baselineInventoryChecksum: "sha256:wrong",
      liveInventory: live,
      c19SummaryPath,
      env: { OPENBOT_SECURITY_PROFILE: "personal_local" },
      receiptDir: path.join(root, "m4-receipts"),
    });
    expect(report.ok).toBe(false);
    if (report.ok) {
      return;
    }
    expect(report.reasonCode).toBe("inventory_drift");
    expect(report.receipt.productionReady).toBe(false);
    expect(report.receipt.findings.find((f) => f.check === "inventory_drift")?.passed).toBe(false);
  });

  it("runs receipted rollback drill", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    await store.put(workspaceRecord("ws-drill"));
    const rollback = await runMigrationRollbackDrill({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-drill",
      resourceId: "ws-drill",
      proof: adaProof,
      store,
      receiptDir: path.join(root, "m4-receipts"),
    });
    expect(rollback.ok).toBe(true);
    expect((await store.get("ws-drill"))?.envelope.lifecycleState).toBe("recovery_required");
  });
});

describe("migration interrupt/resume drill M4", () => {
  it("passes idempotent dual apply using real markers, receipts, and single canonical", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const first = await applyOwnedWorkspaceBatch({
      root,
      store,
      batchId: "batch-resume-ok",
      handle: adoptingHandle(root),
    });
    const resume = await applyOwnedWorkspaceBatch({
      root,
      store,
      batchId: "batch-resume-ok",
      handle: adoptingHandle(root),
    });
    const drill = await runMigrationInterruptResumeDrill({
      batchId: "batch-resume-ok",
      tenantId: "tenant-acme",
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      firstItems: first.items,
      resumeItems: resume.items,
      store,
    });
    expect(drill.ok).toBe(true);
    expect(drill.receipt.drill).toBe("interrupt_resume");
  });

  it("fails when resume item signatures mismatch", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const first = await applyOwnedWorkspaceBatch({
      root,
      store,
      batchId: "batch-mismatch",
      handle: adoptingHandle(root),
    });
    const resume = await applyOwnedWorkspaceBatch({
      root,
      store,
      batchId: "batch-mismatch",
      handle: adoptingHandle(root),
    });
    const tampered = resume.items.map((entry) =>
      entry.candidateId === resume.items[0]?.candidateId
        ? { ...entry, status: "recovery_required" as const }
        : entry,
    );
    const drill = await runMigrationInterruptResumeDrill({
      batchId: "batch-mismatch",
      tenantId: "tenant-acme",
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      firstItems: first.items,
      resumeItems: tampered,
      store,
    });
    expect(drill.ok).toBe(false);
    expect(drill.receipt.detail).toContain("item_signature_mismatch");
  });

  it("fails when catalog has dual writable canonical bindings", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const first = await applyOwnedWorkspaceBatch({
      root,
      store,
      batchId: "batch-dual",
      handle: adoptingHandle(root),
    });
    const resume = await applyOwnedWorkspaceBatch({
      root,
      store,
      batchId: "batch-dual",
      handle: adoptingHandle(root),
    });
    const resourceId = resume.items[0]?.resourceId;
    expect(resourceId).toBeTruthy();
    const canonical = await store.get(resourceId!);
    expect(canonical).toBeTruthy();
    const dualRecord: CatalogRecord = {
      ...canonical!,
      bindings: [
        ...canonical!.bindings,
        {
          bindingId: "canonical:shadow",
          resourceId: resourceId!,
          role: "canonical",
          storageKind: "filesystem",
          locator: "/shadow",
          state: "active",
          contentVersion: "sha256:shadow",
        },
      ],
    };
    const dualStore: DataGovernanceCatalogStore = {
      get: async (id) => (id === resourceId ? dualRecord : store.get(id)),
      put: (record) => store.put(record),
      remove: (id) => store.remove(id),
      list: (resourceType) => store.list(resourceType),
      compareAndPut: (params) => store.compareAndPut(params),
    };
    const verified = await verifyMigrationInterruptResumeEvidence({
      batchId: "batch-dual",
      tenantId: "tenant-acme",
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      firstItems: first.items,
      resumeItems: resume.items,
      store: dualStore,
    });
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.detail).toContain("catalog_receipt_mismatch");
    }
  });

  it("fails when on-disk receipt content diverges from resume item", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const first = await applyOwnedWorkspaceBatch({
      root,
      store,
      batchId: "batch-tamper-receipt",
      handle: adoptingHandle(root),
    });
    const resume = await applyOwnedWorkspaceBatch({
      root,
      store,
      batchId: "batch-tamper-receipt",
      handle: adoptingHandle(root),
    });
    const receiptPath = path.join(root, "receipts", `${resume.items[0].receipt.receiptId}.json`);
    const tampered = {
      ...JSON.parse(fs.readFileSync(receiptPath, "utf8")),
      status: "recovery_required",
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");
    const verified = await verifyMigrationInterruptResumeEvidence({
      batchId: "batch-tamper-receipt",
      tenantId: "tenant-acme",
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      firstItems: first.items,
      resumeItems: resume.items,
      store,
    });
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.detail).toContain("receipt_disk_mismatch");
    }
  });

  it("fails when operation marker fields diverge from catalog and receipt", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const first = await applyOwnedWorkspaceBatch({
      root,
      store,
      batchId: "batch-tamper-marker",
      handle: adoptingHandle(root),
    });
    const resume = await applyOwnedWorkspaceBatch({
      root,
      store,
      batchId: "batch-tamper-marker",
      handle: adoptingHandle(root),
    });
    const markerPath = path.join(
      root,
      GOV_LOGICAL_OP_DIR,
      "m2-batch-tamper-marker-src-owned-ws.json",
    );
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    marker.resourceId = "mig:workspace:shadow";
    fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    const verified = await verifyMigrationInterruptResumeEvidence({
      batchId: "batch-tamper-marker",
      tenantId: "tenant-acme",
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      firstItems: first.items,
      resumeItems: resume.items,
      store,
    });
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.detail).toContain("operation_marker_mismatch");
    }
  });

  it("rejects unsafe operationId paths when reading logical markers", () => {
    const root = tmp();
    expect(
      readGovernanceLogicalOpMarker({
        stateDir: root,
        operationId: "../escape",
      }),
    ).toBeNull();
  });

  it("fails after pending-stage interrupt without catalog recovery", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const inventory = inventoryMigrationCandidates(fixtureInput());
    const planned = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }
    const interrupted = await applyMigrationBatch({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-pending-int",
      inventory,
      plan: planned.plan,
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
      store,
      handle: {
        async write() {
          throw new Error("pending_stage_interrupt");
        },
      },
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      candidateIds: ["src-owned-ws"],
    });
    expect(interrupted.ok).toBe(true);
    if (!interrupted.ok) {
      return;
    }
    expect(interrupted.items[0]?.status).toBe("recovery_required");
    expect(
      fs.existsSync(path.join(root, GOV_LOGICAL_OP_DIR, "m2-batch-pending-int-src-owned-ws.json")),
    ).toBe(true);

    const resumed = await applyOwnedWorkspaceBatch({
      root,
      store,
      batchId: "batch-pending-int",
      handle: adoptingHandle(root),
    });
    const drill = await runMigrationInterruptResumeDrill({
      batchId: "batch-pending-int",
      tenantId: "tenant-acme",
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      firstItems: interrupted.items,
      resumeItems: resumed.items,
      store,
    });
    expect(drill.ok).toBe(false);
    expect(drill.receipt.detail).toMatch(/item_signature_mismatch|lifecycle_not_active/);
  });

  it("passes after pending-stage interrupt once catalog and marker are reset", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const inventory = inventoryMigrationCandidates(fixtureInput());
    const planned = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }
    const interrupted = await applyMigrationBatch({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-pending-recover",
      inventory,
      plan: planned.plan,
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
      store,
      handle: {
        async write() {
          throw new Error("pending_stage_interrupt");
        },
      },
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      candidateIds: ["src-owned-ws"],
    });
    expect(interrupted.items[0]?.resourceId).toBeTruthy();
    await store.remove(interrupted.items[0].resourceId!);
    fs.rmSync(path.join(root, GOV_LOGICAL_OP_DIR, "m2-batch-pending-recover-src-owned-ws.json"), {
      force: true,
    });

    const first = await applyOwnedWorkspaceBatch({
      root,
      store,
      batchId: "batch-pending-recover",
      handle: adoptingHandle(root),
    });
    const resume = await applyOwnedWorkspaceBatch({
      root,
      store,
      batchId: "batch-pending-recover",
      handle: adoptingHandle(root),
    });
    const drill = await runMigrationInterruptResumeDrill({
      batchId: "batch-pending-recover",
      tenantId: "tenant-acme",
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      firstItems: first.items,
      resumeItems: resume.items,
      store,
    });
    expect(drill.ok).toBe(true);
  });

  it("fails after write-stage interrupt without catalog recovery", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const inventory = inventoryMigrationCandidates(fixtureInput());
    const planned = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }
    const interrupted = await applyMigrationBatch({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-write-int",
      inventory,
      plan: planned.plan,
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
      store,
      handle: {
        async write() {
          return { checksum: "wrong", bindingLocator: "/tmp/wrong", storageKind: "filesystem" };
        },
      },
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      candidateIds: ["src-owned-ws"],
    });
    expect(interrupted.items[0]?.status).toBe("recovery_required");

    const resumed = await applyOwnedWorkspaceBatch({
      root,
      store,
      batchId: "batch-write-int",
      handle: adoptingHandle(root),
    });
    const drill = await runMigrationInterruptResumeDrill({
      batchId: "batch-write-int",
      tenantId: "tenant-acme",
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      firstItems: interrupted.items,
      resumeItems: resumed.items,
      store,
    });
    expect(drill.ok).toBe(false);
  });

  it("fails after activate-stage interrupt without catalog recovery", async () => {
    const root = tmp();
    const inner = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const store = failOnceCompareAndPutStore(inner);
    const inventory = inventoryMigrationCandidates(fixtureInput());
    const planned = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }
    const interrupted = await applyMigrationBatch({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-activate-int",
      inventory,
      plan: planned.plan,
      proofs: fixtureProofs(),
      signingKey: SIGNING_KEY,
      store,
      handle: adoptingHandle(root),
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      candidateIds: ["src-owned-ws"],
    });
    expect(interrupted.items[0]?.status).toBe("recovery_required");

    const resumed = await applyOwnedWorkspaceBatch({
      root,
      store: inner,
      batchId: "batch-activate-int",
      handle: adoptingHandle(root),
    });
    const drill = await runMigrationInterruptResumeDrill({
      batchId: "batch-activate-int",
      tenantId: "tenant-acme",
      stateDir: root,
      receiptDir: path.join(root, "receipts"),
      firstItems: interrupted.items,
      resumeItems: resumed.items,
      store: inner,
    });
    expect(drill.ok).toBe(false);
  });
});
