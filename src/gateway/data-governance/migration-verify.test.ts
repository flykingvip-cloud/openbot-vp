import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMemoryWorkspaceCatalog,
  createWorkspaceResourceResolver,
} from "../workspace/resource-resolver.js";
import type { WorkspaceResourceRecord } from "../workspace/types.js";
import { createFileDataGovernanceCatalogStore } from "./catalog-store.js";
import type { DataGovernanceCatalogStore } from "./catalog-store.js";
import { applyMigrationBatch, type ConstrainedMigrationHandle } from "./migration-apply.js";
import { planMigrationIdentities } from "./migration-identity-plan.js";
import { inventoryMigrationCandidates } from "./migration-inventory.js";
import {
  repairMigrationRecord,
  restoreMigrationCanonical,
  verifyMigrationBatch,
} from "./migration-verify.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION, type CatalogRecord } from "./types.js";
import type { GovernanceOwnershipProof } from "./write-gate.js";

const SIGNING_KEY = "m3-verify-hmac-key";
const adaProof: GovernanceOwnershipProof = {
  owner: { kind: "user", userId: "user-ada" },
  scope: { kind: "tenant", tenantId: "tenant-acme" },
};

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-m3-"));
  tempDirs.push(dir);
  return dir;
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

function workspaceRecord(params: {
  resourceId: string;
  tenantId: string;
  locator: string;
  checksum: string;
  lifecycleState?: CatalogRecord["envelope"]["lifecycleState"];
  legalHold?: CatalogRecord["envelope"]["legalHold"];
}): CatalogRecord {
  return {
    envelope: {
      resourceId: params.resourceId,
      resourceType: "workspace",
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: params.tenantId,
      owner: { kind: "user", userId: "user-ada" },
      scope: { kind: "tenant", tenantId: params.tenantId },
      lifecycleState: params.lifecycleState ?? "active",
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: `canonical:${params.resourceId}`,
      createdAt: "2026-08-18T00:00:00Z",
      updatedAt: "2026-08-18T00:00:00Z",
      legalHold: params.legalHold ?? null,
    },
    bindings: [
      {
        bindingId: `canonical:${params.resourceId}`,
        resourceId: params.resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: params.locator,
        state: "active",
        contentVersion: params.checksum,
      },
    ],
  };
}

function projectLifecycle(
  lifecycle: CatalogRecord["envelope"]["lifecycleState"],
): WorkspaceResourceRecord["lifecycleState"] {
  if (lifecycle === "deletion_pending" || lifecycle === "purged" || lifecycle === "retired") {
    return "retired";
  }
  return lifecycle;
}

async function resolveCatalogLocator(record: CatalogRecord): Promise<{
  ok: boolean;
  locator: string | null;
  denyReason: string | null;
}> {
  const catalog = createMemoryWorkspaceCatalog();
  catalog.upsert(
    {
      resourceId: record.envelope.resourceId,
      resourceType: "workspace",
      tenantId: record.envelope.tenantId,
      ownerScope: { kind: "unknown", reason: "m3-restore-test" },
      lifecycleState: projectLifecycle(record.envelope.lifecycleState),
      classification: record.envelope.classification,
      governanceVersion: record.envelope.governanceVersion,
    },
    record.bindings.map((binding) => ({
      bindingId: binding.bindingId,
      resourceId: binding.resourceId,
      role: binding.role === "canonical" ? "canonical" : "compatibility",
      locator: binding.locator,
      state: binding.state,
      contentVersion: binding.contentVersion,
    })),
  );
  const resolver = createWorkspaceResourceResolver({ catalog });
  const resolved = await resolver.resolve({
    actor: {
      tenantId: record.envelope.tenantId,
      principalId: "user-ada",
      profile: "personal_local",
    },
    resourceId: record.envelope.resourceId,
    operation: "read",
    purpose: "m3-restore-consistency",
  });
  if (!resolved.ok) {
    return { ok: false, locator: null, denyReason: resolved.denyReason };
  }
  return { ok: true, locator: resolved.handle._locator, denyReason: null };
}

describe("verifyMigrationBatch M3", () => {
  it("verifies Catalog↔physical binding, checksum, proof, index rebuild, and same-tenant restore", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const inventory = inventoryMigrationCandidates({
      callerTenantId: "tenant-acme",
      catalogRecords: [],
      sources: [
        {
          candidateId: "src-owned-ws",
          tenantId: "tenant-acme",
          resourceType: "workspace",
          sourceLocator: "/tenants/tenant-acme/workspaces/new",
          checksum: "sha256:new-ws",
          schemaVersion: 1,
          ownershipProof: adaProof,
        },
      ],
    });
    const planned = planMigrationIdentities({
      inventory,
      callerTenantId: "tenant-acme",
      proofs: { "src-owned-ws": adaProof },
      signingKey: SIGNING_KEY,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) {
      return;
    }
    const applied = await applyMigrationBatch({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-m3",
      inventory,
      plan: planned.plan,
      proofs: { "src-owned-ws": adaProof },
      signingKey: SIGNING_KEY,
      store,
      handle: adoptingHandle(root),
      stateDir: root,
      receiptDir: path.join(root, "m2-receipts"),
      candidateIds: ["src-owned-ws"],
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }

    const physicalByLocator = new Map<string, string>();
    const record = await store.get(applied.items[0].resourceId!);
    const canonical = record!.bindings.find((b) => b.role === "canonical")!;
    physicalByLocator.set(canonical.locator, canonical.contentVersion);

    const verified = await verifyMigrationBatch({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-m3",
      store,
      items: applied.items,
      proofs: { "src-owned-ws": adaProof },
      physical: {
        async read(params) {
          const checksum = physicalByLocator.get(params.locator);
          return checksum ? { checksum } : null;
        },
      },
      indexRebuilder: {
        async rebuild() {
          return { ok: true, indexChecksum: "idx:sha256:new-ws" };
        },
      },
      receiptDir: path.join(root, "m3-receipts"),
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) {
      return;
    }
    expect(verified.receipts[0]?.passed).toBe(true);
    expect(verified.receipts[0]?.findings.map((f) => f.check)).toEqual(
      expect.arrayContaining([
        "catalog_binding",
        "checksum",
        "ownership_tenant",
        "tombstone_hold_retention",
        "index_rebuild",
        "same_tenant_restore",
        "no_resurrect",
      ]),
    );

    const restored = await restoreMigrationCanonical({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-m3",
      resourceId: applied.items[0].resourceId!,
      proof: adaProof,
      store,
      handle: {
        async restore(params) {
          const dest = path.join(root, "restore", params.resourceId);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, params.expectedChecksum, "utf8");
          return { checksum: params.expectedChecksum, restoredLocator: dest };
        },
      },
      receiptDir: path.join(root, "m3-receipts"),
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) {
      return;
    }
    expect(restored.receipt.kind).toBe("m3_restore_receipt");
    expect(restored.receipt.status).toBe("restored");
    expect(fs.existsSync(restored.receipt.restoredLocator!)).toBe(true);

    const after = await store.get(applied.items[0].resourceId!);
    const liveCanonical = after!.bindings.find(
      (b) => b.role === "canonical" && b.state === "active",
    );
    const demoted = after!.bindings.find((b) => b.locator === canonical.locator);
    expect(liveCanonical?.locator).toBe(restored.receipt.restoredLocator);
    expect(liveCanonical?.locator).not.toBe(canonical.locator);
    expect(demoted?.role).toBe("replica");
    expect(demoted?.state).toBe("read_only");
    expect(
      after!.bindings.filter((b) => b.role === "canonical" && b.state === "active"),
    ).toHaveLength(1);
    const resolved = await resolveCatalogLocator(after!);
    expect(resolved).toEqual({
      ok: true,
      locator: liveCanonical?.locator,
      denyReason: null,
    });
  });

  it("fails checksum mismatch and repairs only via a receipted domain command", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    await store.put(
      workspaceRecord({
        resourceId: "ws-bad",
        tenantId: "tenant-acme",
        locator: "/canonical/ws-bad",
        checksum: "sha256:expected",
      }),
    );
    const verified = await verifyMigrationBatch({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-bad",
      store,
      items: [
        {
          candidateId: "src-bad",
          status: "migrated",
          resourceId: "ws-bad",
          receipt: {
            kind: "m2_migration_receipt",
            receiptId: "r1",
            operationId: "op1",
            batchId: "batch-bad",
            tenantId: "tenant-acme",
            candidateId: "src-bad",
            resourceId: "ws-bad",
            resourceType: "workspace",
            status: "migrated",
            inventoryChecksum: "inv",
            planChecksum: "plan",
            contentChecksum: "sha256:expected",
            previousLocator: "/old",
            canonicalBindingId: "canonical:ws-bad",
            observationLocator: "/old",
          },
        },
      ],
      proofs: { "src-bad": adaProof },
      physical: {
        async read() {
          return { checksum: "sha256:other" };
        },
      },
      receiptDir: path.join(root, "m3-receipts"),
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) {
      return;
    }
    expect(verified.receipts[0]?.passed).toBe(false);
    expect(verified.receipts[0]?.findings.some((f) => f.detail === "checksum_mismatch")).toBe(true);

    const repaired = await repairMigrationRecord({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-bad",
      resourceId: "ws-bad",
      proof: adaProof,
      command: "mark_recovery_required",
      store,
      receiptDir: path.join(root, "m3-receipts"),
    });
    expect(repaired.ok).toBe(true);
    if (!repaired.ok) {
      return;
    }
    expect(repaired.receipt.kind).toBe("m3_repair_receipt");
    expect((await store.get("ws-bad"))?.envelope.lifecycleState).toBe("recovery_required");
  });

  it("refuses to restore deleted objects and blocks cross-tenant restore", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    await store.put(
      workspaceRecord({
        resourceId: "ws-gone",
        tenantId: "tenant-acme",
        locator: "/canonical/ws-gone",
        checksum: "sha256:gone",
        lifecycleState: "purged",
      }),
    );
    await store.put(
      workspaceRecord({
        resourceId: "ws-globex",
        tenantId: "tenant-globex",
        locator: "/canonical/ws-globex",
        checksum: "sha256:globex",
      }),
    );

    const resurrect = await restoreMigrationCanonical({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-del",
      resourceId: "ws-gone",
      proof: adaProof,
      store,
      handle: {
        async restore() {
          throw new Error("must-not-run");
        },
      },
      receiptDir: path.join(root, "m3-receipts"),
    });
    expect(resurrect).toEqual({ ok: false, reasonCode: "resurrect_forbidden" });
    expect((await store.get("ws-gone"))?.envelope.lifecycleState).toBe("purged");

    const cross = await restoreMigrationCanonical({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-del",
      resourceId: "ws-globex",
      proof: adaProof,
      store,
      handle: {
        async restore() {
          throw new Error("must-not-run");
        },
      },
      receiptDir: path.join(root, "m3-receipts"),
    });
    expect(cross).toEqual({ ok: false, reasonCode: "cross_tenant" });

    const verifyCross = await verifyMigrationBatch({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-del",
      store,
      items: [
        {
          candidateId: "src-globex",
          status: "migrated",
          resourceId: "ws-globex",
          receipt: {
            kind: "m2_migration_receipt",
            receiptId: "r2",
            operationId: "op2",
            batchId: "batch-del",
            tenantId: "tenant-acme",
            candidateId: "src-globex",
            resourceId: "ws-globex",
            resourceType: "workspace",
            status: "migrated",
            inventoryChecksum: "inv",
            planChecksum: "plan",
            contentChecksum: "sha256:globex",
            previousLocator: "/old",
            canonicalBindingId: "canonical:ws-globex",
            observationLocator: null,
          },
        },
      ],
      proofs: { "src-globex": adaProof },
      physical: {
        async read() {
          throw new Error("must-not-read-foreign-tenant");
        },
      },
      receiptDir: path.join(root, "m3-receipts"),
    });
    expect(verifyCross.ok).toBe(true);
    if (!verifyCross.ok) {
      return;
    }
    expect(verifyCross.receipts[0]?.findings[0]).toEqual({
      check: "cross_tenant_deny",
      outcome: "blocked",
      detail: "cross_tenant",
    });
    expect(verifyCross.receipts[0]?.passed).toBe(false);
  });

  it("records legal hold during verify and refuses unauthorized tenant batches", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    await store.put(
      workspaceRecord({
        resourceId: "ws-hold",
        tenantId: "tenant-acme",
        locator: "/canonical/ws-hold",
        checksum: "sha256:hold",
        legalHold: {
          holdId: "hold-1",
          reason: "litigation",
          appliedBy: { kind: "operator", operatorId: "ops-1" },
          appliedAt: "2026-08-18T00:00:00Z",
        },
      }),
    );
    const denied = await verifyMigrationBatch({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-globex",
      batchId: "batch-hold",
      store,
      items: [],
      proofs: {},
      physical: {
        async read() {
          return null;
        },
      },
      receiptDir: path.join(root, "m3-receipts"),
    });
    expect(denied).toEqual({ ok: false, reasonCode: "tenant_not_authorized" });

    const verified = await verifyMigrationBatch({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-hold",
      store,
      items: [
        {
          candidateId: "src-hold",
          status: "migrated",
          resourceId: "ws-hold",
          receipt: {
            kind: "m2_migration_receipt",
            receiptId: "r3",
            operationId: "op3",
            batchId: "batch-hold",
            tenantId: "tenant-acme",
            candidateId: "src-hold",
            resourceId: "ws-hold",
            resourceType: "workspace",
            status: "migrated",
            inventoryChecksum: "inv",
            planChecksum: "plan",
            contentChecksum: "sha256:hold",
            previousLocator: "/old",
            canonicalBindingId: "canonical:ws-hold",
            observationLocator: null,
          },
        },
      ],
      proofs: { "src-hold": adaProof },
      physical: {
        async read() {
          return { checksum: "sha256:hold" };
        },
      },
      receiptDir: path.join(root, "m3-receipts"),
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) {
      return;
    }
    expect(verified.receipts[0]?.legalHold?.holdId).toBe("hold-1");
    expect(
      verified.receipts[0]?.findings.some(
        (f) => f.check === "tombstone_hold_retention" && f.detail === "legal_hold",
      ),
    ).toBe(true);
  });

  it("CAS-switches Catalog when restore returns a new locator and Resolver follows it", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const previous = "/canonical/ws-move";
    const dest = path.join(root, "restore", "ws-move");
    await store.put(
      workspaceRecord({
        resourceId: "ws-move",
        tenantId: "tenant-acme",
        locator: previous,
        checksum: "sha256:move",
      }),
    );
    const restored = await restoreMigrationCanonical({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-move",
      resourceId: "ws-move",
      proof: adaProof,
      store,
      handle: {
        async restore(params) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, params.expectedChecksum, "utf8");
          return { checksum: params.expectedChecksum, restoredLocator: dest };
        },
      },
      receiptDir: path.join(root, "m3-receipts"),
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) {
      return;
    }
    const record = await store.get("ws-move");
    const canonical = record?.bindings.find((b) => b.role === "canonical" && b.state === "active");
    expect(canonical?.locator).toBe(dest);
    expect(record?.envelope.canonicalBindingId).toBe(canonical?.bindingId);
    expect(record?.bindings.find((b) => b.locator === previous)).toMatchObject({
      role: "replica",
      state: "read_only",
    });
    expect(restored.receipt.canonicalLocator).toBe(dest);
    expect(restored.receipt.previousLocator).toBe(previous);
    const resolved = await resolveCatalogLocator(record!);
    expect(resolved.locator).toBe(dest);
    expect(resolved.locator).not.toBe(previous);
  });

  it("returns recovery_conflict and leaves Catalog untouched when restore CAS conflicts", async () => {
    const root = tmp();
    const inner = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    await inner.put(
      workspaceRecord({
        resourceId: "ws-race",
        tenantId: "tenant-acme",
        locator: "/canonical/ws-race",
        checksum: "sha256:race",
      }),
    );
    let raced = false;
    const store: DataGovernanceCatalogStore = {
      get: (id) => inner.get(id),
      put: (record) => inner.put(record),
      remove: (id) => inner.remove(id),
      list: (type) => inner.list(type),
      async compareAndPut(params) {
        if (!raced) {
          raced = true;
          const current = await inner.get(params.resourceId);
          if (current) {
            await inner.compareAndPut({
              resourceId: params.resourceId,
              expectedGovernanceVersion: current.envelope.governanceVersion,
              next: {
                envelope: {
                  ...current.envelope,
                  governanceVersion: current.envelope.governanceVersion + 1,
                  updatedAt: new Date().toISOString(),
                },
                bindings: current.bindings,
              },
            });
          }
        }
        return inner.compareAndPut(params);
      },
    };
    const dest = path.join(root, "restore", "ws-race");
    const restored = await restoreMigrationCanonical({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-race",
      resourceId: "ws-race",
      proof: adaProof,
      store,
      handle: {
        async restore(params) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, params.expectedChecksum, "utf8");
          return { checksum: params.expectedChecksum, restoredLocator: dest };
        },
      },
      receiptDir: path.join(root, "m3-receipts"),
    });
    expect(restored.ok).toBe(false);
    if (restored.ok) {
      return;
    }
    expect(restored.reasonCode).toBe("cas_conflict");
    expect(restored.receipt?.status).toBe("recovery_conflict");
    expect(restored.receipt?.restoredLocator).toBe(dest);
    const record = await store.get("ws-race");
    expect(record?.envelope.lifecycleState).toBe("active");
    expect(record?.envelope.governanceVersion).toBe(2);
    const stillCanonical = record?.bindings.find(
      (b) => b.role === "canonical" && b.state === "active",
    );
    expect(stillCanonical?.locator).toBe("/canonical/ws-race");
    expect(
      record?.bindings.filter((b) => b.role === "canonical" && b.state === "active"),
    ).toHaveLength(1);
    const resolved = await resolveCatalogLocator(record!);
    expect(resolved).toEqual({
      ok: true,
      locator: "/canonical/ws-race",
      denyReason: null,
    });
  });

  it("marks recovery_required and writes a receipt when the restore handle fails", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    await store.put(
      workspaceRecord({
        resourceId: "ws-fail",
        tenantId: "tenant-acme",
        locator: "/canonical/ws-fail",
        checksum: "sha256:fail",
      }),
    );
    const thrown = await restoreMigrationCanonical({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-fail",
      resourceId: "ws-fail",
      proof: adaProof,
      store,
      handle: {
        async restore() {
          throw new Error("restore-handle-down");
        },
      },
      receiptDir: path.join(root, "m3-receipts"),
    });
    expect(thrown.ok).toBe(false);
    if (thrown.ok) {
      return;
    }
    expect(thrown.reasonCode).toBe("physical_missing");
    expect(thrown.receipt?.status).toBe("recovery_required");
    expect(thrown.receipt?.restoredLocator).toBeNull();
    expect((await store.get("ws-fail"))?.envelope.lifecycleState).toBe("recovery_required");

    await store.put(
      workspaceRecord({
        resourceId: "ws-sum",
        tenantId: "tenant-acme",
        locator: "/canonical/ws-sum",
        checksum: "sha256:expected",
      }),
    );
    const mismatch = await restoreMigrationCanonical({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-fail",
      resourceId: "ws-sum",
      proof: adaProof,
      store,
      handle: {
        async restore() {
          return { checksum: "sha256:other", restoredLocator: "/canonical/ws-sum-other" };
        },
      },
      receiptDir: path.join(root, "m3-receipts"),
    });
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) {
      return;
    }
    expect(mismatch.reasonCode).toBe("checksum_mismatch");
    expect(mismatch.receipt?.status).toBe("recovery_required");
    const sum = await store.get("ws-sum");
    expect(sum?.envelope.lifecycleState).toBe("recovery_required");
    expect(sum?.bindings.find((b) => b.role === "canonical" && b.state === "active")?.locator).toBe(
      "/canonical/ws-sum",
    );
    const resolved = await resolveCatalogLocator(sum!);
    expect(resolved.ok).toBe(false);
    expect(resolved.denyReason).toBe("lifecycle_blocks_access");
  });

  it("does not overwrite a concurrent writer's binding or version when restore failure marking CAS-misses", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    await store.put(
      workspaceRecord({
        resourceId: "ws-keep",
        tenantId: "tenant-acme",
        locator: "/canonical/ws-keep",
        checksum: "sha256:keep",
      }),
    );
    const writerLocator = "/canonical/ws-keep-v2";
    const restored = await restoreMigrationCanonical({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-keep",
      resourceId: "ws-keep",
      proof: adaProof,
      store,
      handle: {
        async restore() {
          const current = await store.get("ws-keep");
          if (!current) {
            throw new Error("missing");
          }
          const raced = await store.compareAndPut({
            resourceId: "ws-keep",
            expectedGovernanceVersion: current.envelope.governanceVersion,
            next: {
              envelope: {
                ...current.envelope,
                governanceVersion: current.envelope.governanceVersion + 1,
                updatedAt: new Date().toISOString(),
              },
              bindings: current.bindings.map((binding) =>
                binding.role === "canonical"
                  ? { ...binding, locator: writerLocator, contentVersion: "sha256:keep-v2" }
                  : binding,
              ),
            },
          });
          if (!raced.ok) {
            throw new Error("writer-cas-failed");
          }
          throw new Error("restore-handle-down");
        },
      },
      receiptDir: path.join(root, "m3-receipts"),
    });
    expect(restored.ok).toBe(false);
    if (restored.ok) {
      return;
    }
    expect(restored.reasonCode).toBe("recovery_conflict");
    expect(restored.receipt?.status).toBe("recovery_conflict");
    expect(restored.receipt?.canonicalLocator).toBe(writerLocator);
    const record = await store.get("ws-keep");
    expect(record?.envelope.lifecycleState).toBe("active");
    expect(record?.envelope.governanceVersion).toBe(2);
    expect(
      record?.bindings.find((b) => b.role === "canonical" && b.state === "active"),
    ).toMatchObject({
      locator: writerLocator,
      contentVersion: "sha256:keep-v2",
    });
    const resolved = await resolveCatalogLocator(record!);
    expect(resolved).toEqual({
      ok: true,
      locator: writerLocator,
      denyReason: null,
    });
  });

  it("accepts in-place restore only when the Catalog start snapshot is unchanged", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const locator = "/canonical/ws-inplace";
    await store.put(
      workspaceRecord({
        resourceId: "ws-inplace",
        tenantId: "tenant-acme",
        locator,
        checksum: "sha256:inplace",
      }),
    );
    const restored = await restoreMigrationCanonical({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-inplace",
      resourceId: "ws-inplace",
      proof: adaProof,
      store,
      handle: {
        async restore(params) {
          return { checksum: params.expectedChecksum, restoredLocator: params.canonicalLocator };
        },
      },
      receiptDir: path.join(root, "m3-receipts"),
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) {
      return;
    }
    expect(restored.receipt.status).toBe("restored");
    expect(restored.receipt.canonicalLocator).toBe(locator);
    const record = await store.get("ws-inplace");
    expect(record?.envelope.governanceVersion).toBe(1);
    expect(record?.bindings.find((b) => b.role === "canonical")?.contentVersion).toBe(
      "sha256:inplace",
    );
  });

  it("returns recovery_conflict when a same-locator concurrent writer changes Catalog during in-place restore", async () => {
    const root = tmp();
    const store = createFileDataGovernanceCatalogStore({
      storePath: path.join(root, "catalog.json"),
    });
    const locator = "/canonical/ws-same";
    await store.put(
      workspaceRecord({
        resourceId: "ws-same",
        tenantId: "tenant-acme",
        locator,
        checksum: "sha256:old",
      }),
    );
    const restored = await restoreMigrationCanonical({
      callerTenantId: "tenant-acme",
      authorizedTenantId: "tenant-acme",
      batchId: "batch-same",
      resourceId: "ws-same",
      proof: adaProof,
      store,
      handle: {
        async restore(params) {
          const current = await store.get("ws-same");
          if (!current) {
            throw new Error("missing");
          }
          const raced = await store.compareAndPut({
            resourceId: "ws-same",
            expectedGovernanceVersion: current.envelope.governanceVersion,
            next: {
              envelope: {
                ...current.envelope,
                governanceVersion: current.envelope.governanceVersion + 1,
                updatedAt: new Date().toISOString(),
              },
              bindings: current.bindings.map((binding) =>
                binding.role === "canonical"
                  ? { ...binding, contentVersion: "sha256:new" }
                  : binding,
              ),
            },
          });
          if (!raced.ok) {
            throw new Error("writer-cas-failed");
          }
          return { checksum: params.expectedChecksum, restoredLocator: params.canonicalLocator };
        },
      },
      receiptDir: path.join(root, "m3-receipts"),
    });
    expect(restored.ok).toBe(false);
    if (restored.ok) {
      return;
    }
    expect(restored.reasonCode).toBe("recovery_conflict");
    expect(restored.receipt?.status).toBe("recovery_conflict");
    expect(restored.receipt?.status).not.toBe("restored");
    const record = await store.get("ws-same");
    expect(record?.envelope.lifecycleState).toBe("active");
    expect(record?.envelope.governanceVersion).toBe(2);
    expect(
      record?.bindings.find((b) => b.role === "canonical" && b.state === "active"),
    ).toMatchObject({
      locator,
      contentVersion: "sha256:new",
    });
    const resolved = await resolveCatalogLocator(record!);
    expect(resolved).toEqual({ ok: true, locator, denyReason: null });
  });
});
