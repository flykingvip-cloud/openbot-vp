/**
 * M4 production migration closure: SLO evaluation, inventory drift, boundary gate,
 * C19 probe evidence, and receipted ops drills. Read-only on Catalog except drills
 * that delegate to existing M2/M3 receipted commands.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveSecurityProfile } from "../security-profile.js";
import type { DataGovernanceCatalogStore } from "./catalog-store.js";
import {
  MIGRATION_RECEIPT_KIND,
  type MigrationApplyItem,
  type MigrationReceipt,
} from "./migration-apply.js";
import {
  computeInventoryChecksum,
  refuseMtimeAsInventoryTruth,
  type MigrationInventoryReport,
} from "./migration-inventory.js";
import { repairMigrationRecord } from "./migration-verify.js";
import {
  listGovernanceLogicalOpMarkersForBatch,
  readGovernanceLogicalOpMarker,
  type GovernanceLogicalOpMarker,
} from "./operation-marker.js";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";
import type { CatalogRecord, StorageBinding } from "./types.js";
import type { GovernanceOwnershipProof } from "./write-gate.js";

export const M4_CLOSURE_RECEIPT_KIND = "m4_migration_closure_receipt" as const;
export const M4_DRILL_RECEIPT_KIND = "m4_migration_drill_receipt" as const;

export type MigrationSloPolicy = {
  /** Minimum migrated / total ratio (0–1). */
  minMigratedRatio: number;
  /** Maximum (blocked + recovery_required) / total ratio. */
  maxFailureRatio: number;
  /** Maximum quarantined / total ratio. */
  maxQuarantineRatio: number;
  /** Maximum open recovery_required rows allowed. */
  maxRecoveryBacklog: number;
};

export type MigrationSloEvaluation = {
  passed: boolean;
  total: number;
  migrated: number;
  quarantined: number;
  blocked: number;
  recoveryRequired: number;
  violations: string[];
};

export type MigrationClosureCheck =
  | "slo"
  | "inventory_drift"
  | "production_boundary"
  | "c19_probe"
  | "mtime_truth_forbidden";

export type MigrationClosureFinding = {
  check: MigrationClosureCheck;
  passed: boolean;
  detail: string;
};

export type MigrationClosureReceipt = {
  kind: typeof M4_CLOSURE_RECEIPT_KIND;
  receiptId: string;
  batchId: string;
  tenantId: string;
  findings: MigrationClosureFinding[];
  productionReady: boolean;
};

export type MigrationOpsDrillKind = "interrupt_resume" | "rollback" | "restore";

export type MigrationDrillReceipt = {
  kind: typeof M4_DRILL_RECEIPT_KIND;
  receiptId: string;
  batchId: string;
  tenantId: string;
  drill: MigrationOpsDrillKind;
  passed: boolean;
  detail: string;
};

export type MigrationClosureDeny =
  | "tenant_not_authorized"
  | "batch_required"
  | "inventory_drift"
  | "slo_breach"
  | "production_boundary_missing"
  | "c19_probe_invalid";

function writeJsonReceipt(receiptDir: string, receiptId: string, payload: unknown): void {
  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(
    path.join(receiptDir, `${receiptId}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

/** Policy-bound SLO evaluation from batch apply items (no caller-supplied truth). */
export function evaluateMigrationBatchSlos(params: {
  items: MigrationApplyItem[];
  policy: MigrationSloPolicy;
}): MigrationSloEvaluation {
  const total = params.items.length;
  if (total === 0) {
    return {
      passed: false,
      total: 0,
      migrated: 0,
      quarantined: 0,
      blocked: 0,
      recoveryRequired: 0,
      violations: ["empty_batch"],
    };
  }
  let migrated = 0;
  let quarantined = 0;
  let blocked = 0;
  let recoveryRequired = 0;
  for (const item of params.items) {
    switch (item.status) {
      case "migrated":
        migrated += 1;
        break;
      case "quarantined":
        quarantined += 1;
        break;
      case "blocked":
        blocked += 1;
        break;
      case "recovery_required":
        recoveryRequired += 1;
        break;
    }
  }
  const violations: string[] = [];
  const migratedRatio = migrated / total;
  const failureRatio = (blocked + recoveryRequired) / total;
  const quarantineRatio = quarantined / total;
  if (migratedRatio < params.policy.minMigratedRatio) {
    violations.push("migrated_ratio_below_floor");
  }
  if (failureRatio > params.policy.maxFailureRatio) {
    violations.push("failure_ratio_above_ceiling");
  }
  if (quarantineRatio > params.policy.maxQuarantineRatio) {
    violations.push("quarantine_ratio_above_ceiling");
  }
  if (recoveryRequired > params.policy.maxRecoveryBacklog) {
    violations.push("recovery_backlog_above_ceiling");
  }
  return {
    passed: violations.length === 0,
    total,
    migrated,
    quarantined,
    blocked,
    recoveryRequired,
    violations,
  };
}

/** Periodic drift: live inventory checksum must match signed baseline. */
export function detectInventoryDrift(params: {
  baselineChecksum: string;
  live: MigrationInventoryReport;
}): { ok: true } | { ok: false; liveChecksum: string } {
  const liveChecksum = computeInventoryChecksum({
    callerTenantId: params.live.callerTenantId,
    candidates: params.live.candidates,
  });
  if (liveChecksum !== params.baselineChecksum.trim()) {
    return { ok: false, liveChecksum };
  }
  return { ok: true };
}

/** Managed Enterprise production migration requires dedicated boundary + tenants root. */
export function assertMigrationProductionBoundary(params: {
  env?: NodeJS.ProcessEnv;
}):
  | { ok: true }
  | { ok: false; reasonCode: "production_boundary_missing" | "tenants_root_missing" } {
  const resolution = resolveSecurityProfile(undefined, params.env ?? process.env);
  if (resolution.profile !== "managed_enterprise") {
    return { ok: true };
  }
  if (resolution.tenantExecutionBoundary !== "dedicated") {
    return { ok: false, reasonCode: "production_boundary_missing" };
  }
  const tenantsRootOk = !resolution.errors.some(
    (error) => error.code === "SECURITY_PROFILE_MISSING_TENANTS_ROOT",
  );
  if (!tenantsRootOk) {
    return { ok: false, reasonCode: "tenants_root_missing" };
  }
  return { ok: true };
}

/** Verify C19 summary artifact has a reproducible summarySha256 (ops tracking). */
export function verifyC19ProbeEvidence(params: {
  summaryPath: string;
}):
  | { ok: true; summarySha256: string }
  | { ok: false; reasonCode: "c19_summary_missing" | "c19_summary_invalid" } {
  const resolved = path.resolve(params.summaryPath);
  if (!fs.existsSync(resolved)) {
    return { ok: false, reasonCode: "c19_summary_missing" };
  }
  let summary: Record<string, unknown>;
  try {
    summary = JSON.parse(fs.readFileSync(resolved, "utf8")) as Record<string, unknown>;
  } catch {
    return { ok: false, reasonCode: "c19_summary_invalid" };
  }
  const expectSha = typeof summary.summarySha256 === "string" ? summary.summarySha256 : "";
  if (!/^[a-f0-9]{64}$/.test(expectSha)) {
    return { ok: false, reasonCode: "c19_summary_invalid" };
  }
  const copy = { ...summary };
  delete copy.summarySha256;
  const got = createHash("sha256")
    .update(`${JSON.stringify(copy, null, 2)}\n`)
    .digest("hex");
  if (got !== expectSha) {
    return { ok: false, reasonCode: "c19_summary_invalid" };
  }
  return { ok: true, summarySha256: expectSha };
}

export async function runMigrationClosureReport(params: {
  callerTenantId: string;
  authorizedTenantId: string;
  batchId: string;
  items: MigrationApplyItem[];
  sloPolicy: MigrationSloPolicy;
  baselineInventoryChecksum: string;
  liveInventory: MigrationInventoryReport;
  /** Required C19 isolation summary artifact (ops tracking). */
  c19SummaryPath: string;
  env?: NodeJS.ProcessEnv;
  receiptDir: string;
}): Promise<
  | { ok: true; receipt: MigrationClosureReceipt }
  | { ok: false; reasonCode: MigrationClosureDeny; receipt: MigrationClosureReceipt }
> {
  const callerTenantId = params.callerTenantId.trim();
  const batchId = params.batchId.trim();
  if (!batchId) {
    return {
      ok: false,
      reasonCode: "batch_required",
      receipt: {
        kind: M4_CLOSURE_RECEIPT_KIND,
        receiptId: `m4c-${randomUUID()}`,
        batchId: "",
        tenantId: callerTenantId,
        findings: [{ check: "slo", passed: false, detail: "batch_required" }],
        productionReady: false,
      },
    };
  }
  if (!callerTenantId || callerTenantId !== params.authorizedTenantId.trim()) {
    return {
      ok: false,
      reasonCode: "tenant_not_authorized",
      receipt: {
        kind: M4_CLOSURE_RECEIPT_KIND,
        receiptId: `m4c-${randomUUID()}`,
        batchId,
        tenantId: callerTenantId,
        findings: [{ check: "slo", passed: false, detail: "tenant_not_authorized" }],
        productionReady: false,
      },
    };
  }

  const findings: MigrationClosureFinding[] = [];

  const slo = evaluateMigrationBatchSlos({ items: params.items, policy: params.sloPolicy });
  findings.push({
    check: "slo",
    passed: slo.passed,
    detail: slo.passed ? "within_policy" : slo.violations.join(","),
  });

  const drift = detectInventoryDrift({
    baselineChecksum: params.baselineInventoryChecksum,
    live: params.liveInventory,
  });
  findings.push({
    check: "inventory_drift",
    passed: drift.ok,
    detail: drift.ok ? "checksum_match" : `drift:${drift.liveChecksum}`,
  });

  const boundary = assertMigrationProductionBoundary({ env: params.env });
  findings.push({
    check: "production_boundary",
    passed: boundary.ok,
    detail: boundary.ok ? "boundary_ok" : boundary.reasonCode,
  });

  const c19Path = params.c19SummaryPath.trim();
  const c19 = c19Path
    ? verifyC19ProbeEvidence({ summaryPath: c19Path })
    : { ok: false as const, reasonCode: "c19_summary_missing" as const };
  findings.push({
    check: "c19_probe",
    passed: c19.ok,
    detail: c19.ok ? c19.summarySha256 : c19.reasonCode,
  });

  findings.push({
    check: "mtime_truth_forbidden",
    passed: true,
    detail: refuseMtimeAsInventoryTruth(),
  });

  const productionReady = findings.every((finding) => finding.passed);
  const receipt: MigrationClosureReceipt = {
    kind: M4_CLOSURE_RECEIPT_KIND,
    receiptId: `m4c-${randomUUID()}`,
    batchId,
    tenantId: callerTenantId,
    findings,
    productionReady,
  };
  writeJsonReceipt(params.receiptDir, receipt.receiptId, receipt);

  if (!productionReady) {
    if (!slo.passed) {
      return { ok: false, reasonCode: "slo_breach", receipt };
    }
    if (!drift.ok) {
      return { ok: false, reasonCode: "inventory_drift", receipt };
    }
    if (!boundary.ok) {
      return { ok: false, reasonCode: "production_boundary_missing", receipt };
    }
    if (!c19.ok) {
      return { ok: false, reasonCode: "c19_probe_invalid", receipt };
    }
  }
  return productionReady ? { ok: true, receipt } : { ok: false, reasonCode: "slo_breach", receipt };
}

type MigrationBatchItemSignature = {
  candidateId: string;
  status: MigrationApplyItem["status"];
  resourceId: string | null;
};

function normalizeBatchItemSignatures(items: MigrationApplyItem[]): MigrationBatchItemSignature[] {
  return items
    .map((item) => ({
      candidateId: item.candidateId,
      status: item.status,
      resourceId: item.resourceId,
    }))
    .toSorted((left, right) => left.candidateId.localeCompare(right.candidateId));
}

function activeCanonicalBindings(record: { bindings: StorageBinding[] }): StorageBinding[] {
  return record.bindings.filter(
    (binding) => binding.role === "canonical" && binding.state === "active",
  );
}

/** Build and validate the M2 batch operation marker id (`m2-{batchId}-{candidateId}`). */
export function buildMigrationBatchOperationId(params: {
  batchId: string;
  candidateId: string;
}): { ok: true; operationId: string } | { ok: false; reasonCode: "operation_id_unsafe" } {
  const operationId = `m2-${params.batchId.trim()}-${params.candidateId.trim()}`;
  try {
    return { ok: true, operationId: assertSafeRecoveryReceiptToken(operationId, "operationId") };
  } catch {
    return { ok: false, reasonCode: "operation_id_unsafe" };
  }
}

function resolveMigrationReceiptFilePath(receiptDir: string, receiptId: string): string | null {
  try {
    const safeReceiptId = assertSafeRecoveryReceiptToken(receiptId, "operationId");
    const root = path.resolve(receiptDir);
    const dest = path.resolve(root, `${safeReceiptId}.json`);
    const rel = path.relative(root, dest);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      return null;
    }
    return dest;
  } catch {
    return null;
  }
}

function loadMigrationReceiptFromDisk(
  receiptDir: string,
  receiptId: string,
): MigrationReceipt | null {
  const filePath = resolveMigrationReceiptFilePath(receiptDir, receiptId);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as MigrationReceipt;
    if (parsed?.kind !== MIGRATION_RECEIPT_KIND) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function migrationReceiptMatchesItem(params: {
  disk: MigrationReceipt;
  item: MigrationApplyItem;
  batchId: string;
  tenantId: string;
}): boolean {
  const diskTenant =
    typeof params.disk.tenantId === "string" && params.disk.tenantId.trim()
      ? params.disk.tenantId.trim()
      : params.tenantId;
  return (
    params.disk.receiptId === params.item.receipt.receiptId &&
    params.disk.batchId === params.batchId &&
    params.disk.candidateId === params.item.candidateId &&
    params.disk.operationId === params.item.receipt.operationId &&
    params.disk.status === params.item.status &&
    params.disk.resourceId === params.item.resourceId &&
    params.disk.resourceType === params.item.receipt.resourceType &&
    diskTenant === params.tenantId
  );
}

function migrationMarkerMatchesAssign(params: {
  marker: GovernanceLogicalOpMarker;
  item: MigrationApplyItem;
  operationId: string;
}): boolean {
  if (!params.item.resourceId) {
    return false;
  }
  return (
    params.marker.operationId === params.operationId &&
    params.marker.kind === "logical" &&
    params.marker.resourceId === params.item.resourceId &&
    params.marker.objectKey === params.item.resourceId &&
    params.marker.resourceType === params.item.receipt.resourceType &&
    path.resolve(params.marker.locator) === path.resolve(params.item.receipt.previousLocator)
  );
}

function catalogMatchesMigrationReceipt(params: {
  record: CatalogRecord;
  item: MigrationApplyItem;
  receipt: MigrationReceipt;
  tenantId: string;
}): boolean {
  const writers = activeCanonicalBindings(params.record);
  if (writers.length !== 1 || !params.item.resourceId) {
    return false;
  }
  const writer = writers[0];
  return (
    params.record.envelope.resourceId === params.item.resourceId &&
    params.record.envelope.tenantId === params.tenantId &&
    params.record.envelope.lifecycleState === "active" &&
    params.record.envelope.canonicalBindingId === params.receipt.canonicalBindingId &&
    writer.bindingId === params.receipt.canonicalBindingId &&
    writer.contentVersion === params.receipt.contentChecksum
  );
}

async function verifyMigrationPhaseItems(params: {
  batchId: string;
  tenantId: string;
  stateDir: string;
  receiptDir: string;
  items: MigrationApplyItem[];
  store: DataGovernanceCatalogStore;
  requireAssignMarker: boolean;
}): Promise<{ ok: true } | { ok: false; detail: string }> {
  for (const item of params.items) {
    const built = buildMigrationBatchOperationId({
      batchId: params.batchId,
      candidateId: item.candidateId,
    });
    if (!built.ok) {
      return { ok: false, detail: `operation_id_unsafe:${item.candidateId}` };
    }
    if (item.receipt.operationId !== built.operationId) {
      return { ok: false, detail: `item_operation_mismatch:${item.candidateId}` };
    }

    const diskReceipt = loadMigrationReceiptFromDisk(params.receiptDir, item.receipt.receiptId);
    if (!diskReceipt) {
      return { ok: false, detail: `receipt_file_missing:${item.receipt.receiptId}` };
    }
    if (
      !migrationReceiptMatchesItem({
        disk: diskReceipt,
        item,
        batchId: params.batchId,
        tenantId: params.tenantId,
      })
    ) {
      return { ok: false, detail: `receipt_disk_mismatch:${item.candidateId}` };
    }
    if (diskReceipt.operationId !== built.operationId) {
      return { ok: false, detail: `receipt_operation_mismatch:${item.candidateId}` };
    }

    if (params.requireAssignMarker && item.resourceId?.startsWith("mig:")) {
      const marker = readGovernanceLogicalOpMarker({
        stateDir: params.stateDir,
        operationId: built.operationId,
      });
      if (
        !marker ||
        !migrationMarkerMatchesAssign({ marker, item, operationId: built.operationId })
      ) {
        return { ok: false, detail: `operation_marker_mismatch:${built.operationId}` };
      }
    }

    if (item.status === "migrated" && item.resourceId) {
      const record = await params.store.get(item.resourceId);
      if (!record) {
        return { ok: false, detail: `catalog_missing:${item.resourceId}` };
      }
      if (
        !catalogMatchesMigrationReceipt({
          record,
          item,
          receipt: diskReceipt,
          tenantId: params.tenantId,
        })
      ) {
        return { ok: false, detail: `catalog_receipt_mismatch:${item.resourceId}` };
      }
    }
  }
  return { ok: true };
}

/** Load on-disk M2 batch receipts (rebuilt from receiptDir, not caller-supplied counts). */
export function listMigrationBatchReceipts(params: {
  receiptDir: string;
  batchId: string;
}): MigrationReceipt[] {
  const batchId = params.batchId.trim();
  const receiptDir = path.resolve(params.receiptDir);
  if (!batchId || !fs.existsSync(receiptDir)) {
    return [];
  }
  const receipts: MigrationReceipt[] = [];
  for (const file of fs.readdirSync(receiptDir)) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const receiptId = file.slice(0, -".json".length);
    const filePath = resolveMigrationReceiptFilePath(receiptDir, receiptId);
    if (!filePath) {
      continue;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as MigrationReceipt;
      if (parsed?.kind === MIGRATION_RECEIPT_KIND && parsed.batchId === batchId) {
        receipts.push(parsed);
      }
    } catch {
      // skip malformed receipt files
    }
  }
  return receipts;
}

/** Verify interrupt/resume idempotency from real markers, receipts, and Catalog state. */
export async function verifyMigrationInterruptResumeEvidence(params: {
  batchId: string;
  tenantId: string;
  stateDir: string;
  receiptDir: string;
  firstItems: MigrationApplyItem[];
  resumeItems: MigrationApplyItem[];
  store: DataGovernanceCatalogStore;
}): Promise<{ ok: true } | { ok: false; detail: string }> {
  const batchId = params.batchId.trim();
  const tenantId = params.tenantId.trim();
  if (!batchId) {
    return { ok: false, detail: "batch_required" };
  }
  if (!tenantId) {
    return { ok: false, detail: "tenant_required" };
  }
  if (params.firstItems.length === 0) {
    return { ok: false, detail: "empty_first_phase" };
  }
  if (params.firstItems.length !== params.resumeItems.length) {
    return {
      ok: false,
      detail: `item_count_mismatch:${params.firstItems.length}->${params.resumeItems.length}`,
    };
  }

  const firstSignature = normalizeBatchItemSignatures(params.firstItems);
  const resumeSignature = normalizeBatchItemSignatures(params.resumeItems);
  if (JSON.stringify(firstSignature) !== JSON.stringify(resumeSignature)) {
    return {
      ok: false,
      detail: `item_signature_mismatch:${JSON.stringify(firstSignature)}->${JSON.stringify(resumeSignature)}`,
    };
  }

  const diskReceipts = listMigrationBatchReceipts({
    receiptDir: params.receiptDir,
    batchId,
  });
  const knownCandidates = new Set(resumeSignature.map((entry) => entry.candidateId));
  const receiptsByCandidate = new Map<string, MigrationReceipt[]>();
  for (const receipt of diskReceipts) {
    if (!knownCandidates.has(receipt.candidateId)) {
      return { ok: false, detail: `receipt_orphan_candidate:${receipt.candidateId}` };
    }
    try {
      assertSafeRecoveryReceiptToken(receipt.operationId, "operationId");
    } catch {
      return { ok: false, detail: `receipt_operation_id_unsafe:${receipt.receiptId}` };
    }
    try {
      assertSafeRecoveryReceiptToken(receipt.receiptId, "operationId");
    } catch {
      return { ok: false, detail: `receipt_id_unsafe:${receipt.receiptId}` };
    }
    const bucket = receiptsByCandidate.get(receipt.candidateId) ?? [];
    bucket.push(receipt);
    receiptsByCandidate.set(receipt.candidateId, bucket);
  }
  if (receiptsByCandidate.size !== params.resumeItems.length) {
    return {
      ok: false,
      detail: `receipt_candidate_count:${receiptsByCandidate.size}->${params.resumeItems.length}`,
    };
  }

  const batchMarkers = listGovernanceLogicalOpMarkersForBatch({
    stateDir: params.stateDir,
    batchId,
  });
  const expectedMarkerIds = new Set<string>();
  for (const item of params.resumeItems) {
    if (!item.resourceId?.startsWith("mig:")) {
      continue;
    }
    const built = buildMigrationBatchOperationId({ batchId, candidateId: item.candidateId });
    if (built.ok) {
      expectedMarkerIds.add(built.operationId);
    }
  }
  for (const marker of batchMarkers) {
    if (!expectedMarkerIds.has(marker.operationId)) {
      return { ok: false, detail: `operation_marker_orphan:${marker.operationId}` };
    }
  }
  if (batchMarkers.length !== expectedMarkerIds.size) {
    return {
      ok: false,
      detail: `operation_marker_count:${batchMarkers.length}->${expectedMarkerIds.size}`,
    };
  }

  const firstPhase = await verifyMigrationPhaseItems({
    batchId,
    tenantId,
    stateDir: params.stateDir,
    receiptDir: params.receiptDir,
    items: params.firstItems,
    store: params.store,
    requireAssignMarker: false,
  });
  if (!firstPhase.ok) {
    return firstPhase;
  }

  const resumePhase = await verifyMigrationPhaseItems({
    batchId,
    tenantId,
    stateDir: params.stateDir,
    receiptDir: params.receiptDir,
    items: params.resumeItems,
    store: params.store,
    requireAssignMarker: true,
  });
  if (!resumePhase.ok) {
    return resumePhase;
  }

  return { ok: true };
}

/** Receipted rollback drill: mark_recovery_required via M3 repair (versioned CAS). */
export async function runMigrationRollbackDrill(params: {
  callerTenantId: string;
  authorizedTenantId: string;
  batchId: string;
  resourceId: string;
  proof: GovernanceOwnershipProof;
  store: DataGovernanceCatalogStore;
  receiptDir: string;
}): Promise<
  { ok: true; receipt: MigrationDrillReceipt } | { ok: false; receipt: MigrationDrillReceipt }
> {
  const repaired = await repairMigrationRecord({
    callerTenantId: params.callerTenantId,
    authorizedTenantId: params.authorizedTenantId,
    batchId: params.batchId,
    resourceId: params.resourceId,
    proof: params.proof,
    command: "mark_recovery_required",
    store: params.store,
    receiptDir: params.receiptDir,
  });
  const receipt: MigrationDrillReceipt = {
    kind: M4_DRILL_RECEIPT_KIND,
    receiptId: `m4d-${randomUUID()}`,
    batchId: params.batchId.trim(),
    tenantId: params.callerTenantId.trim(),
    drill: "rollback",
    passed: repaired.ok,
    detail: repaired.ok ? "recovery_marked" : repaired.reasonCode,
  };
  writeJsonReceipt(params.receiptDir, receipt.receiptId, receipt);
  return repaired.ok ? { ok: true, receipt } : { ok: false, receipt };
}

/** Interrupt/resume drill: rebuild phase evidence from markers, receipts, and Catalog. */
export async function runMigrationInterruptResumeDrill(params: {
  batchId: string;
  tenantId: string;
  stateDir: string;
  receiptDir: string;
  firstItems: MigrationApplyItem[];
  resumeItems: MigrationApplyItem[];
  store: DataGovernanceCatalogStore;
}): Promise<
  { ok: true; receipt: MigrationDrillReceipt } | { ok: false; receipt: MigrationDrillReceipt }
> {
  const verified = await verifyMigrationInterruptResumeEvidence(params);
  const receipt: MigrationDrillReceipt = {
    kind: M4_DRILL_RECEIPT_KIND,
    receiptId: `m4d-${randomUUID()}`,
    batchId: params.batchId.trim(),
    tenantId: params.tenantId.trim(),
    drill: "interrupt_resume",
    passed: verified.ok,
    detail: verified.ok ? `resume_ok:${params.resumeItems.length}` : verified.detail,
  };
  writeJsonReceipt(params.receiptDir, receipt.receiptId, receipt);
  return verified.ok ? { ok: true, receipt } : { ok: false, receipt };
}
