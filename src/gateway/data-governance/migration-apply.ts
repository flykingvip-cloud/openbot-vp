/**
 * M2 tenant-batched migration + canonical cutover.
 * Domain command only. One writable canonical. Old locators stay read-only.
 * Later-wave adapters stay fail-closed. Does not delete source bytes.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DataGovernanceCatalogStore } from "./catalog-store.js";
import { runManagedGovernedCreateTxn } from "./managed-create-txn.js";
import {
  planMigrationIdentities,
  verifyMigrationPlan,
  type MigrationPlanEntry,
  type SignedMigrationPlan,
} from "./migration-identity-plan.js";
import {
  computeInventoryChecksum,
  type MigrationInventoryReport,
  type MigrationInventoryResourceType,
} from "./migration-inventory.js";
import { writeGovernanceLogicalOpMarker } from "./operation-marker.js";
import type { CatalogRecord, GovernedResourceType, StorageBinding } from "./types.js";
import { GOVERNANCE_ENVELOPE_SCHEMA_VERSION } from "./types.js";
import type { GovernanceOwnershipProof } from "./write-gate.js";

export const MIGRATION_RECEIPT_KIND = "m2_migration_receipt" as const;

export const M2_APPLY_ORDER: GovernedResourceType[] = [
  "workspace",
  "agent",
  "conversation_archive",
  "knowledge",
  "memory",
  "operational_identity",
];

export type MigrationApplyStatus = "migrated" | "quarantined" | "blocked" | "recovery_required";

export type MigrationApplyDeny =
  | "tenant_not_authorized"
  | "batch_required"
  | "plan_invalid"
  | "inventory_checksum_mismatch"
  | "plan_replay_mismatch";

export type ConstrainedMigrationHandle = {
  write(params: {
    tenantId: string;
    resourceId: string;
    sourceLocator: string;
    expectedChecksum: string;
  }): Promise<{
    checksum: string;
    bindingLocator: string;
    storageKind?: StorageBinding["storageKind"];
  }>;
};

export type MigrationReceipt = {
  kind: typeof MIGRATION_RECEIPT_KIND;
  receiptId: string;
  operationId: string;
  batchId: string;
  tenantId: string;
  candidateId: string;
  resourceId: string | null;
  resourceType: MigrationInventoryResourceType;
  status: MigrationApplyStatus;
  inventoryChecksum: string;
  planChecksum: string;
  contentChecksum: string | null;
  changeSnapshot?: import("./migration-verify.js").MigrationVerifyChangeSnapshot;
  previousLocator: string;
  canonicalBindingId: string | null;
  observationLocator: string | null;
};

export type MigrationApplyItem = {
  candidateId: string;
  status: MigrationApplyStatus;
  resourceId: string | null;
  receipt: MigrationReceipt;
};

export type ApplyMigrationBatchParams = {
  callerTenantId: string;
  authorizedTenantId: string;
  batchId: string;
  inventory: MigrationInventoryReport;
  plan: SignedMigrationPlan;
  proofs: Readonly<Record<string, GovernanceOwnershipProof | undefined>>;
  signingKey: string;
  store: DataGovernanceCatalogStore;
  handle: ConstrainedMigrationHandle;
  stateDir: string;
  receiptDir: string;
  candidateIds?: string[];
};

export type ApplyMigrationBatchResult =
  | { ok: true; batchId: string; tenantId: string; items: MigrationApplyItem[] }
  | { ok: false; reasonCode: MigrationApplyDeny; items: MigrationApplyItem[] };

const IDENTITY_TYPES = new Set<string>(M2_APPLY_ORDER);

function applyRank(resourceType: MigrationInventoryResourceType): number {
  const index = M2_APPLY_ORDER.indexOf(resourceType as GovernedResourceType);
  return index === -1 ? M2_APPLY_ORDER.length : index;
}

function writeReceipt(receiptDir: string, receipt: MigrationReceipt): void {
  fs.mkdirSync(receiptDir, { recursive: true });
  const dest = path.join(receiptDir, `${receipt.receiptId}.json`);
  fs.writeFileSync(dest, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function makeReceipt(params: {
  batchId: string;
  callerTenantId: string;
  entry: MigrationPlanEntry;
  status: MigrationApplyStatus;
  inventoryChecksum: string;
  planChecksum: string;
  resourceId: string | null;
  contentChecksum: string | null;
  canonicalBindingId: string | null;
  observationLocator: string | null;
  operationId: string;
}): MigrationReceipt {
  return {
    kind: MIGRATION_RECEIPT_KIND,
    receiptId: `m2r-${randomUUID()}`,
    operationId: params.operationId,
    batchId: params.batchId,
    tenantId: params.callerTenantId,
    candidateId: params.entry.candidateId,
    resourceId: params.resourceId,
    resourceType: params.entry.resourceType,
    status: params.status,
    inventoryChecksum: params.inventoryChecksum,
    planChecksum: params.planChecksum,
    contentChecksum: params.contentChecksum,
    previousLocator: params.entry.sourceLocator,
    canonicalBindingId: params.canonicalBindingId,
    observationLocator: params.observationLocator,
  };
}

function itemFrom(
  receiptDir: string,
  receipt: MigrationReceipt,
  status: MigrationApplyStatus,
  resourceId: string | null,
): MigrationApplyItem {
  writeReceipt(receiptDir, receipt);
  return { candidateId: receipt.candidateId, status, resourceId, receipt };
}

function liveEntryById(entries: MigrationPlanEntry[]): Map<string, MigrationPlanEntry> {
  return new Map(entries.map((entry) => [entry.candidateId, entry]));
}

function activeCanonicals(record: CatalogRecord): StorageBinding[] {
  return record.bindings.filter((b) => b.role === "canonical" && b.state === "active");
}

async function applyReuse(params: {
  store: DataGovernanceCatalogStore;
  entry: MigrationPlanEntry;
  callerTenantId: string;
  batchId: string;
  inventoryChecksum: string;
  planChecksum: string;
  receiptDir: string;
  operationId: string;
}): Promise<MigrationApplyItem> {
  const resourceId = params.entry.resourceId;
  if (!resourceId) {
    const receipt = makeReceipt({
      ...params,
      status: "blocked",
      resourceId: null,
      contentChecksum: null,
      canonicalBindingId: null,
      observationLocator: null,
    });
    return itemFrom(params.receiptDir, receipt, "blocked", null);
  }
  const existing = await params.store.get(resourceId);
  if (!existing || existing.envelope.tenantId !== params.callerTenantId) {
    const receipt = makeReceipt({
      ...params,
      status: "blocked",
      resourceId,
      contentChecksum: null,
      canonicalBindingId: null,
      observationLocator: null,
    });
    return itemFrom(params.receiptDir, receipt, "blocked", resourceId);
  }
  if (activeCanonicals(existing).length !== 1) {
    const receipt = makeReceipt({
      ...params,
      status: "recovery_required",
      resourceId,
      contentChecksum: null,
      canonicalBindingId: existing.envelope.canonicalBindingId,
      observationLocator: params.entry.sourceLocator,
    });
    return itemFrom(params.receiptDir, receipt, "recovery_required", resourceId);
  }
  const receipt = makeReceipt({
    ...params,
    status: "migrated",
    resourceId,
    contentChecksum: activeCanonicals(existing)[0]?.contentVersion ?? null,
    canonicalBindingId: existing.envelope.canonicalBindingId,
    observationLocator: params.entry.sourceLocator,
  });
  return itemFrom(params.receiptDir, receipt, "migrated", resourceId);
}

async function applyAssign(params: {
  store: DataGovernanceCatalogStore;
  handle: ConstrainedMigrationHandle;
  stateDir: string;
  entry: MigrationPlanEntry;
  proof: GovernanceOwnershipProof;
  candidateChecksum: string;
  callerTenantId: string;
  batchId: string;
  inventoryChecksum: string;
  planChecksum: string;
  receiptDir: string;
}): Promise<MigrationApplyItem> {
  const resourceId = params.entry.resourceId;
  const operationId = `m2-${params.batchId}-${params.entry.candidateId}`;
  if (!resourceId || !params.entry.tenantId || params.entry.tenantId !== params.callerTenantId) {
    const receipt = makeReceipt({
      ...params,
      operationId,
      status: "blocked",
      resourceId: resourceId ?? null,
      contentChecksum: null,
      canonicalBindingId: null,
      observationLocator: null,
    });
    return itemFrom(params.receiptDir, receipt, "blocked", resourceId ?? null);
  }

  const existing = await params.store.get(resourceId);
  if (existing) {
    return applyReuse({ ...params, operationId });
  }

  const resourceType = params.entry.resourceType as GovernedResourceType;
  const now = new Date().toISOString();
  const canonicalBindingId = `canonical:${resourceId}`;
  let written:
    | { checksum: string; bindingLocator: string; storageKind?: StorageBinding["storageKind"] }
    | undefined;

  const txn = await runManagedGovernedCreateTxn({
    operationId,
    beginPending: async () => {
      writeGovernanceLogicalOpMarker({
        stateDir: params.stateDir,
        operationId,
        resourceId,
        resourceType,
        locator: params.entry.sourceLocator,
        objectKey: resourceId,
      });
      const pending: CatalogRecord = {
        envelope: {
          resourceId,
          resourceType,
          schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
          tenantId: params.callerTenantId,
          owner: params.proof.owner,
          scope: params.proof.scope,
          lifecycleState: "pending",
          classification: "internal",
          governanceVersion: 1,
          canonicalBindingId,
          createdAt: now,
          updatedAt: now,
        },
        bindings: [
          {
            bindingId: canonicalBindingId,
            resourceId,
            role: "canonical",
            storageKind: "filesystem",
            locator: params.entry.sourceLocator,
            state: "active",
            contentVersion: params.candidateChecksum,
          },
        ],
      };
      await params.store.put(pending);
      return { resourceId };
    },
    physicalWrite: async () => {
      written = await params.handle.write({
        tenantId: params.callerTenantId,
        resourceId,
        sourceLocator: params.entry.sourceLocator,
        expectedChecksum: params.candidateChecksum,
      });
      if (written.storageKind === "byos") {
        throw new Error("later_wave_adapter_locked");
      }
      if (written.checksum !== params.candidateChecksum) {
        throw new Error("migration_checksum_mismatch");
      }
      return written;
    },
    activate: async () => {
      const current = await params.store.get(resourceId);
      if (!current || current.envelope.lifecycleState !== "pending") {
        throw new Error("migration_not_pending");
      }
      if (current.envelope.tenantId !== params.callerTenantId) {
        throw new Error("migration_tenant_mismatch");
      }
      if (activeCanonicals(current).length !== 1) {
        throw new Error("migration_dual_canonical");
      }
      if (!written) {
        throw new Error("migration_write_missing");
      }
      const dest = written.bindingLocator;
      const canonical: StorageBinding = {
        bindingId: canonicalBindingId,
        resourceId,
        role: "canonical",
        storageKind: written.storageKind ?? "filesystem",
        locator: dest,
        state: "active",
        contentVersion: written.checksum,
      };
      const observation: StorageBinding[] =
        dest !== params.entry.sourceLocator
          ? [
              {
                bindingId: `observe:${resourceId}`,
                resourceId,
                role: "replica",
                storageKind: "filesystem",
                locator: params.entry.sourceLocator,
                state: "read_only",
                contentVersion: params.candidateChecksum,
              },
            ]
          : [];
      const next: CatalogRecord = {
        envelope: {
          ...current.envelope,
          lifecycleState: "active",
          governanceVersion: current.envelope.governanceVersion + 1,
          canonicalBindingId,
          updatedAt: new Date().toISOString(),
        },
        bindings: [canonical, ...observation],
      };
      if (
        next.bindings.filter((b) => b.role === "canonical" && b.state === "active").length !== 1
      ) {
        throw new Error("migration_dual_canonical");
      }
      const cas = await params.store.compareAndPut({
        resourceId,
        expectedGovernanceVersion: current.envelope.governanceVersion,
        next,
      });
      if (!cas.ok) {
        throw new Error(`migration_cas_${cas.conflict}`);
      }
    },
    abort: async () => {
      const current = await params.store.get(resourceId);
      if (current) {
        await params.store.put({
          envelope: {
            ...current.envelope,
            lifecycleState: "recovery_required",
            governanceVersion: current.envelope.governanceVersion + 1,
            updatedAt: new Date().toISOString(),
          },
          bindings: current.bindings,
        });
      }
      return { recoveryRequired: true };
    },
  });

  if (!txn.ok) {
    const receipt = makeReceipt({
      ...params,
      operationId,
      status: "recovery_required",
      resourceId,
      contentChecksum: params.candidateChecksum,
      canonicalBindingId,
      observationLocator: params.entry.sourceLocator,
    });
    return itemFrom(params.receiptDir, receipt, "recovery_required", resourceId);
  }

  const active = await params.store.get(resourceId);
  const receipt = makeReceipt({
    ...params,
    operationId,
    status: "migrated",
    resourceId,
    contentChecksum: params.candidateChecksum,
    canonicalBindingId: active?.envelope.canonicalBindingId ?? canonicalBindingId,
    observationLocator:
      active?.bindings.find((b) => b.role === "replica")?.locator ?? params.entry.sourceLocator,
  });
  return itemFrom(params.receiptDir, receipt, "migrated", resourceId);
}

/** Apply one authorized tenant batch. Never enumerates other tenants. */
export async function applyMigrationBatch(
  params: ApplyMigrationBatchParams,
): Promise<ApplyMigrationBatchResult> {
  const callerTenantId = params.callerTenantId.trim();
  const authorizedTenantId = params.authorizedTenantId.trim();
  const batchId = params.batchId.trim();
  if (!batchId) {
    return { ok: false, reasonCode: "batch_required", items: [] };
  }
  if (!callerTenantId || callerTenantId !== authorizedTenantId) {
    return { ok: false, reasonCode: "tenant_not_authorized", items: [] };
  }

  const verified = verifyMigrationPlan({ plan: params.plan, signingKey: params.signingKey });
  if (!verified.ok) {
    return { ok: false, reasonCode: "plan_invalid", items: [] };
  }
  const expectedInventory = computeInventoryChecksum({
    callerTenantId: params.inventory.callerTenantId,
    candidates: params.inventory.candidates,
  });
  if (
    expectedInventory !== params.inventory.inventoryChecksum ||
    params.plan.inventoryChecksum !== params.inventory.inventoryChecksum ||
    params.plan.callerTenantId !== callerTenantId
  ) {
    return { ok: false, reasonCode: "inventory_checksum_mismatch", items: [] };
  }

  const replay = planMigrationIdentities({
    inventory: params.inventory,
    callerTenantId,
    proofs: params.proofs,
    signingKey: params.signingKey,
  });
  if (!replay.ok) {
    return { ok: false, reasonCode: "plan_replay_mismatch", items: [] };
  }
  const live = liveEntryById(replay.plan.entries);
  const checksumByCandidate = new Map(
    params.inventory.candidates.map((candidate) => [candidate.candidateId, candidate.checksum]),
  );

  const selected = new Set(params.candidateIds);
  const queue = params.plan.entries
    .filter((entry) => IDENTITY_TYPES.has(entry.resourceType))
    .filter((entry) => (params.candidateIds ? selected.has(entry.candidateId) : true))
    .toSorted((a, b) => {
      const rank = applyRank(a.resourceType) - applyRank(b.resourceType);
      return rank !== 0 ? rank : a.candidateId.localeCompare(b.candidateId);
    });

  const items: MigrationApplyItem[] = [];
  for (const submitted of queue) {
    const current = live.get(submitted.candidateId);
    const operationId = `m2-${batchId}-${submitted.candidateId}`;
    if (!current) {
      items.push(
        itemFrom(
          params.receiptDir,
          makeReceipt({
            batchId,
            callerTenantId,
            entry: submitted,
            status: "blocked",
            inventoryChecksum: params.inventory.inventoryChecksum,
            planChecksum: params.plan.planChecksum,
            resourceId: null,
            contentChecksum: null,
            canonicalBindingId: null,
            observationLocator: null,
            operationId,
          }),
          "blocked",
          null,
        ),
      );
      continue;
    }
    if (current.action === "quarantine") {
      items.push(
        itemFrom(
          params.receiptDir,
          makeReceipt({
            batchId,
            callerTenantId,
            entry: current,
            status: "quarantined",
            inventoryChecksum: params.inventory.inventoryChecksum,
            planChecksum: params.plan.planChecksum,
            resourceId: null,
            contentChecksum: null,
            canonicalBindingId: null,
            observationLocator: null,
            operationId,
          }),
          "quarantined",
          null,
        ),
      );
      continue;
    }
    if (current.action !== "assign_identity" && current.action !== "reuse_identity") {
      items.push(
        itemFrom(
          params.receiptDir,
          makeReceipt({
            batchId,
            callerTenantId,
            entry: current,
            status: "blocked",
            inventoryChecksum: params.inventory.inventoryChecksum,
            planChecksum: params.plan.planChecksum,
            resourceId: null,
            contentChecksum: null,
            canonicalBindingId: null,
            observationLocator: null,
            operationId,
          }),
          "blocked",
          null,
        ),
      );
      continue;
    }
    if (current.resourceId !== submitted.resourceId || current.action !== submitted.action) {
      items.push(
        itemFrom(
          params.receiptDir,
          makeReceipt({
            batchId,
            callerTenantId,
            entry: current,
            status: "blocked",
            inventoryChecksum: params.inventory.inventoryChecksum,
            planChecksum: params.plan.planChecksum,
            resourceId: null,
            contentChecksum: null,
            canonicalBindingId: null,
            observationLocator: null,
            operationId,
          }),
          "blocked",
          null,
        ),
      );
      continue;
    }

    const proof = params.proofs[current.candidateId];
    if (current.action === "reuse_identity") {
      items.push(
        await applyReuse({
          store: params.store,
          entry: current,
          callerTenantId,
          batchId,
          inventoryChecksum: params.inventory.inventoryChecksum,
          planChecksum: params.plan.planChecksum,
          receiptDir: params.receiptDir,
          operationId,
        }),
      );
      continue;
    }
    if (!proof) {
      items.push(
        itemFrom(
          params.receiptDir,
          makeReceipt({
            batchId,
            callerTenantId,
            entry: current,
            status: "blocked",
            inventoryChecksum: params.inventory.inventoryChecksum,
            planChecksum: params.plan.planChecksum,
            resourceId: current.resourceId,
            contentChecksum: null,
            canonicalBindingId: null,
            observationLocator: null,
            operationId,
          }),
          "blocked",
          current.resourceId,
        ),
      );
      continue;
    }
    items.push(
      await applyAssign({
        store: params.store,
        handle: params.handle,
        stateDir: params.stateDir,
        entry: current,
        proof,
        candidateChecksum: checksumByCandidate.get(current.candidateId) ?? "",
        callerTenantId,
        batchId,
        inventoryChecksum: params.inventory.inventoryChecksum,
        planChecksum: params.plan.planChecksum,
        receiptDir: params.receiptDir,
      }),
    );
  }

  return { ok: true, batchId, tenantId: callerTenantId, items };
}
