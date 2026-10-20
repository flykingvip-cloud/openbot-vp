/**
 * P5-f tenant longevity report: storage growth, backup age, memory health (L14).
 * Read-only aggregates. Reuses P3-e health. No placement, promotion, or purge authority.
 */
import fs from "node:fs";
import path from "node:path";
import { isGovernanceActionAllowed } from "../governance-policy.js";
import {
  getOrCreateFileDataGovernanceCatalogStore,
  type DataGovernanceCatalogStore,
} from "./catalog-store.js";
import { reportCognitiveHealth } from "./cognitive-health.js";
import { isTenantKeyManagementAuth, type TenantKeyManagementAuth } from "./key-rotation-auth.js";
import { readTenantLongevityPolicyOrCorrupt } from "./longevity-policy-store.js";
import {
  readStorageGrowthBaselineOrCorrupt,
  writeStorageGrowthBaselineCas,
} from "./longevity-report-store.js";
import { resolveCognitiveRecommendationRoot, resolveDataGovernanceCatalogPath } from "./paths.js";
import { lookupProducerClaimSupport } from "./producer-model-matrix.js";
import { readRestoreDrillState } from "./restore-drill-store.js";
import type {
  CatalogRecord,
  CognitiveHealthIndicator,
  CognitiveRecommendationReceipt,
  GovernedResourceType,
  LongevityBackupObservability,
  LongevityMemoryHealthAggregates,
  LongevityStorageGrowthEntry,
  ProducerModelMatrixEntry,
  TenantLongevityPolicy,
  TenantLongevityReport,
  TenantStorageGrowthBaseline,
} from "./types.js";

export type LongevityReportDenyCode =
  | "actor_not_authorized"
  | "baseline_checkpoint_stale"
  | "baseline_checkpoint_too_soon"
  | "longevity_policy_missing"
  | "report_incomplete"
  | "placement_authority_forbidden"
  | "purge_authority_forbidden"
  | "mtime_truth_forbidden";

export type LongevityReportResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: LongevityReportDenyCode };

export type LongevityReportAuthParams = {
  auth: TenantKeyManagementAuth;
  stateDir: string;
  tenantId?: never;
};

/** Architecture first-wave governed classes (P1 + P1-2). */
export const FIRST_WAVE_GOVERNED_RESOURCE_CLASSES: readonly GovernedResourceType[] = [
  "workspace",
  "agent",
  "conversation_archive",
  "knowledge",
  "memory",
  "operational_identity",
] as const;

/** Fallback when no deploy-boundary policy exists (reports fail-closed instead). */
export const DEFAULT_MAX_BACKUP_AGE_DAYS = 30;

export const MS_PER_DAY = 86_400_000;

export const DEFAULT_MAX_BACKUP_AGE_MS = DEFAULT_MAX_BACKUP_AGE_DAYS * MS_PER_DAY;

const POLLUTION_HEALTH_INDICATORS = new Set<CognitiveHealthIndicator["indicator"]>([
  "danglingProvenanceRef",
  "staleMergeAttach",
  "unpublishedMergeProduct",
  "openConflictBacklog",
  "postCommitConflict",
]);

const ACTIVE_LIFECYCLE = new Set<CatalogRecord["envelope"]["lifecycleState"]>([
  "pending",
  "active",
  "read_only",
  "archived",
  "recovery_required",
  "quarantined",
  "retired",
  "deletion_pending",
]);

function authorizeTenantRead(
  params: LongevityReportAuthParams,
): LongevityReportResult<{ tenantId: string }> {
  if (params.tenantId != null) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!isTenantKeyManagementAuth(params.auth)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const tenantId = params.auth.callerTenantId.trim();
  if (!tenantId || params.auth.actor.kind !== "user") {
    return { ok: false, error: "actor_not_authorized" };
  }
  const allowed = isGovernanceActionAllowed(
    { role: params.auth.role, tenantId, userId: params.auth.actor.userId },
    "read",
    { kind: "tenant", tenantId },
  );
  if (!allowed) {
    return { ok: false, error: "actor_not_authorized" };
  }
  return { ok: true, value: { tenantId } };
}

function authorizeTenantWrite(
  params: LongevityReportAuthParams,
): LongevityReportResult<{ tenantId: string }> {
  if (params.tenantId != null) {
    return { ok: false, error: "actor_not_authorized" };
  }
  if (!isTenantKeyManagementAuth(params.auth)) {
    return { ok: false, error: "actor_not_authorized" };
  }
  const tenantId = params.auth.callerTenantId.trim();
  if (!tenantId || params.auth.actor.kind !== "user") {
    return { ok: false, error: "actor_not_authorized" };
  }
  const allowed = isGovernanceActionAllowed(
    { role: params.auth.role, tenantId, userId: params.auth.actor.userId },
    "write",
    { kind: "tenant", tenantId },
  );
  if (!allowed) {
    return { ok: false, error: "actor_not_authorized" };
  }
  return { ok: true, value: { tenantId } };
}

function parseAuthoritativeTimestamp(value: string): number | null {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return ms;
}

export function resolveMaxBackupAgeMsFromPolicy(
  policy: TenantLongevityPolicy | null,
): LongevityReportResult<{ maxBackupAgeMs: number }> {
  if (!policy) {
    return { ok: false, error: "longevity_policy_missing" };
  }
  const maxBackupAgeMs = policy.maxBackupAgeDays * MS_PER_DAY;
  if (!Number.isFinite(maxBackupAgeMs) || maxBackupAgeMs <= 0) {
    return { ok: false, error: "report_incomplete" };
  }
  return { ok: true, value: { maxBackupAgeMs } };
}

function tenantScopedRows(rows: readonly CatalogRecord[], tenantId: string): CatalogRecord[] {
  return rows.filter((row) => row.envelope.tenantId === tenantId);
}

function countRows(rows: readonly CatalogRecord[]): {
  activeResourceCount: number;
  governedResourceCount: number;
} {
  const governedResourceCount = rows.filter(
    (row) => row.envelope.lifecycleState !== "purged",
  ).length;
  const activeResourceCount = rows.filter((row) =>
    ACTIVE_LIFECYCLE.has(row.envelope.lifecycleState),
  ).length;
  return { activeResourceCount, governedResourceCount };
}

function growthRatePerDay(delta: number, baselineCapturedAt: string, nowMs: number): number | null {
  const baselineMs = parseAuthoritativeTimestamp(baselineCapturedAt);
  if (baselineMs === null || nowMs <= baselineMs) {
    return null;
  }
  const windowDays = (nowMs - baselineMs) / MS_PER_DAY;
  if (windowDays <= 0) {
    return null;
  }
  return delta / windowDays;
}

function buildStorageGrowthByClass(params: {
  rowsByType: Record<GovernedResourceType, CatalogRecord[]>;
  baseline: TenantStorageGrowthBaseline | null;
  nowMs: number;
}): LongevityStorageGrowthEntry[] {
  return FIRST_WAVE_GOVERNED_RESOURCE_CLASSES.map((resourceClass) => {
    const rows = params.rowsByType[resourceClass] ?? [];
    const current = countRows(rows);
    const prior = params.baseline?.countsByClass[resourceClass];
    const baselineCapturedAt = params.baseline?.capturedAt ?? null;
    const baselineActiveResourceCount = prior?.activeResourceCount ?? null;
    const baselineGovernedResourceCount = prior?.governedResourceCount ?? null;
    const activeResourceCountDelta =
      prior != null ? current.activeResourceCount - prior.activeResourceCount : null;
    const governedResourceCountDelta =
      prior != null ? current.governedResourceCount - prior.governedResourceCount : null;
    return {
      resourceClass,
      status: "observed" as const,
      activeResourceCount: current.activeResourceCount,
      governedResourceCount: current.governedResourceCount,
      baselineCapturedAt,
      baselineActiveResourceCount,
      baselineGovernedResourceCount,
      activeResourceCountDelta,
      governedResourceCountDelta,
      growthRatePerDay:
        prior != null && baselineCapturedAt != null && activeResourceCountDelta != null
          ? growthRatePerDay(activeResourceCountDelta, baselineCapturedAt, params.nowMs)
          : null,
    };
  });
}

export function evaluateBackupObservability(params: {
  stateDir: string;
  tenantId: string;
  now: string;
  maxBackupAgeMs: number;
}): LongevityBackupObservability {
  const maxBackupAgeMs = params.maxBackupAgeMs;
  const nowMs = parseAuthoritativeTimestamp(params.now);
  const state = readRestoreDrillState({ stateDir: params.stateDir, tenantId: params.tenantId });
  const lastBackupAt = state?.lastBackupAt ?? null;
  const lastProvenRestoreAt = state?.lastRestoreAt ?? null;

  if (nowMs === null || !Number.isFinite(maxBackupAgeMs) || maxBackupAgeMs <= 0) {
    return {
      lastBackupAt,
      lastProvenRestoreAt,
      backupMissing: !lastBackupAt,
      backupAgeFail: true,
      backupAgeMs: null,
      maxBackupAgeMs: Number.isFinite(maxBackupAgeMs) ? maxBackupAgeMs : DEFAULT_MAX_BACKUP_AGE_MS,
      backupTimestampInvalid: nowMs === null,
    };
  }

  if (!lastBackupAt) {
    return {
      lastBackupAt,
      lastProvenRestoreAt,
      backupMissing: true,
      backupAgeFail: true,
      backupAgeMs: null,
      maxBackupAgeMs,
      backupTimestampInvalid: false,
    };
  }

  const backupMs = parseAuthoritativeTimestamp(lastBackupAt);
  if (backupMs === null || backupMs > nowMs) {
    return {
      lastBackupAt,
      lastProvenRestoreAt,
      backupMissing: false,
      backupAgeFail: true,
      backupAgeMs: null,
      maxBackupAgeMs,
      backupTimestampInvalid: true,
    };
  }

  const backupAgeMs = nowMs - backupMs;
  return {
    lastBackupAt,
    lastProvenRestoreAt,
    backupMissing: false,
    backupAgeFail: backupAgeMs > maxBackupAgeMs,
    backupAgeMs,
    maxBackupAgeMs,
    backupTimestampInvalid: false,
  };
}

function isCognitiveRecommendationReceipt(value: unknown): value is CognitiveRecommendationReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const raw = value as CognitiveRecommendationReceipt;
  return (
    typeof raw.recommendationId === "string" &&
    raw.scoreInputs != null &&
    typeof raw.scoreInputs === "object" &&
    typeof raw.scoreInputs.producerModelRef === "string" &&
    typeof raw.scoreInputs.scoreAlgorithmVersion === "string"
  );
}

function scanTenantRecommendationReceipts(params: {
  stateDir: string;
  tenantId: string;
}): { ok: true; receipts: CognitiveRecommendationReceipt[] } | { ok: false; corrupt: true } {
  const root = path.resolve(resolveCognitiveRecommendationRoot(params.stateDir));
  const dir = path.resolve(root, params.tenantId);
  const rel = path.relative(root, dir);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(dir)) {
    return { ok: true, receipts: [] };
  }
  const receipts: CognitiveRecommendationReceipt[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const filePath = path.join(dir, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    } catch {
      return { ok: false, corrupt: true };
    }
    if (!isCognitiveRecommendationReceipt(parsed)) {
      return { ok: false, corrupt: true };
    }
    receipts.push(parsed);
  }
  return { ok: true, receipts };
}

function countUnsupportedProducerClaims(params: {
  receipts: readonly CognitiveRecommendationReceipt[];
  tenantId: string;
  matrix: readonly ProducerModelMatrixEntry[];
}): number {
  if (params.matrix.length === 0) {
    return 0;
  }
  const seen = new Set<string>();
  let count = 0;
  for (const receipt of params.receipts) {
    if (receipt.tenantId !== params.tenantId) {
      continue;
    }
    const producerModelId = receipt.scoreInputs.producerModelRef.trim();
    if (!producerModelId) {
      continue;
    }
    const schemaVersion = receipt.scoreInputs.scoreAlgorithmVersion.includes("v2") ? "2" : "1";
    const dedupeKey = `${producerModelId}:${schemaVersion}:${receipt.recommendationId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    const lookup = lookupProducerClaimSupport({
      matrix: params.matrix,
      producerModelId,
      schemaVersion,
    });
    if (lookup.ok && (lookup.claimSupport === "unsupported" || lookup.claimSupport === "flagged")) {
      count += 1;
    }
  }
  return count;
}

function buildMemoryHealthAggregates(params: {
  tenantId: string;
  stateDir: string;
  catalog: DataGovernanceCatalogStore;
  producerModelMatrix: readonly ProducerModelMatrixEntry[];
  receipts: readonly CognitiveRecommendationReceipt[];
  now: string;
}): Promise<LongevityMemoryHealthAggregates> {
  return reportCognitiveHealth({
    tenantId: params.tenantId,
    stateDir: params.stateDir,
    catalog: params.catalog,
    now: new Date(params.now),
  }).then((health) => {
    const retiredRecallCount =
      health.indicators.find((item) => item.indicator === "retiredInRecall")?.count ?? 0;
    const pollutionCount = health.indicators
      .filter((item) => POLLUTION_HEALTH_INDICATORS.has(item.indicator))
      .reduce((sum, item) => sum + item.count, 0);
    const unsupportedClaimCount = countUnsupportedProducerClaims({
      receipts: params.receipts,
      tenantId: params.tenantId,
      matrix: params.producerModelMatrix,
    });
    return {
      retiredRecallCount,
      pollutionCount,
      unsupportedClaimCount,
      indicators: health.indicators,
    };
  });
}

function buildBaselineSnapshot(params: {
  tenantId: string;
  capturedAt: string;
  rowsByType: Record<GovernedResourceType, CatalogRecord[]>;
}): TenantStorageGrowthBaseline {
  const countsByClass = Object.fromEntries(
    FIRST_WAVE_GOVERNED_RESOURCE_CLASSES.map((resourceClass) => [
      resourceClass,
      countRows(params.rowsByType[resourceClass] ?? []),
    ]),
  ) as TenantStorageGrowthBaseline["countsByClass"];
  return {
    schemaVersion: 1,
    tenantId: params.tenantId,
    capturedAt: params.capturedAt,
    countsByClass,
  };
}

async function loadTenantCatalogRows(params: {
  tenantId: string;
  stateDir: string;
  catalog?: DataGovernanceCatalogStore;
}): Promise<Record<GovernedResourceType, CatalogRecord[]>> {
  const catalog =
    params.catalog ??
    getOrCreateFileDataGovernanceCatalogStore({
      storePath: resolveDataGovernanceCatalogPath(params.stateDir),
    });
  return Object.fromEntries(
    await Promise.all(
      FIRST_WAVE_GOVERNED_RESOURCE_CLASSES.map(async (resourceClass) => [
        resourceClass,
        tenantScopedRows(await catalog.list(resourceClass), params.tenantId),
      ]),
    ),
  ) as Record<GovernedResourceType, CatalogRecord[]>;
}

/** Read-only tenant longevity report. Never mutates storage growth baselines. */
export async function runTenantLongevityReport(
  params: LongevityReportAuthParams & {
    now: string;
    producerModelMatrix?: readonly ProducerModelMatrixEntry[];
    catalog?: DataGovernanceCatalogStore;
  },
): Promise<LongevityReportResult<TenantLongevityReport>> {
  const authorized = authorizeTenantRead(params);
  if (!authorized.ok) {
    return authorized;
  }
  const tenantId = authorized.value.tenantId;
  const nowMs = parseAuthoritativeTimestamp(params.now);
  if (nowMs === null) {
    return { ok: false, error: "report_incomplete" };
  }
  const policyRead = readTenantLongevityPolicyOrCorrupt({ stateDir: params.stateDir, tenantId });
  if (!policyRead.ok) {
    return { ok: false, error: "report_incomplete" };
  }
  const maxBackupAge = resolveMaxBackupAgeMsFromPolicy(policyRead.policy);
  if (!maxBackupAge.ok) {
    return maxBackupAge;
  }
  const baselineRead = readStorageGrowthBaselineOrCorrupt({
    stateDir: params.stateDir,
    tenantId,
  });
  if (!baselineRead.ok) {
    return { ok: false, error: "report_incomplete" };
  }
  const receiptScan = scanTenantRecommendationReceipts({
    stateDir: params.stateDir,
    tenantId,
  });
  if (!receiptScan.ok) {
    return { ok: false, error: "report_incomplete" };
  }
  const catalog =
    params.catalog ??
    getOrCreateFileDataGovernanceCatalogStore({
      storePath: resolveDataGovernanceCatalogPath(params.stateDir),
    });
  const rowsByType = await loadTenantCatalogRows({
    tenantId,
    stateDir: params.stateDir,
    catalog,
  });
  const storageGrowthByClass = buildStorageGrowthByClass({
    rowsByType,
    baseline: baselineRead.baseline,
    nowMs,
  });
  if (storageGrowthByClass.length !== FIRST_WAVE_GOVERNED_RESOURCE_CLASSES.length) {
    return { ok: false, error: "report_incomplete" };
  }
  const memoryHealth = await buildMemoryHealthAggregates({
    tenantId,
    stateDir: params.stateDir,
    catalog,
    producerModelMatrix: params.producerModelMatrix ?? [],
    receipts: receiptScan.receipts,
    now: params.now,
  });
  return {
    ok: true,
    value: {
      kind: "p5_tenant_longevity_report",
      tenantId,
      generatedAt: params.now,
      storageGrowthByClass,
      backup: evaluateBackupObservability({
        stateDir: params.stateDir,
        tenantId,
        now: params.now,
        maxBackupAgeMs: maxBackupAge.value.maxBackupAgeMs,
      }),
      memoryHealth,
    },
  };
}

/**
 * Write-authorized storage growth baseline checkpoint.
 * Enforces deploy-boundary checkpoint min period and CAS (no out-of-order overwrite).
 */
export async function checkpointTenantStorageGrowthBaseline(
  params: LongevityReportAuthParams & {
    now: string;
    catalog?: DataGovernanceCatalogStore;
  },
): Promise<LongevityReportResult<TenantStorageGrowthBaseline>> {
  const authorized = authorizeTenantWrite(params);
  if (!authorized.ok) {
    return authorized;
  }
  const tenantId = authorized.value.tenantId;
  const nowMs = parseAuthoritativeTimestamp(params.now);
  if (nowMs === null) {
    return { ok: false, error: "report_incomplete" };
  }
  const policyRead = readTenantLongevityPolicyOrCorrupt({ stateDir: params.stateDir, tenantId });
  if (!policyRead.ok) {
    return { ok: false, error: "report_incomplete" };
  }
  if (!policyRead.policy) {
    return { ok: false, error: "longevity_policy_missing" };
  }
  const baselineRead = readStorageGrowthBaselineOrCorrupt({
    stateDir: params.stateDir,
    tenantId,
  });
  if (!baselineRead.ok) {
    return { ok: false, error: "report_incomplete" };
  }
  if (baselineRead.baseline) {
    const priorMs = parseAuthoritativeTimestamp(baselineRead.baseline.capturedAt);
    if (priorMs === null) {
      return { ok: false, error: "report_incomplete" };
    }
    if (nowMs <= priorMs) {
      return { ok: false, error: "baseline_checkpoint_stale" };
    }
    const minPeriodMs = policyRead.policy.storageGrowthCheckpointMinDays * MS_PER_DAY;
    if (nowMs - priorMs < minPeriodMs) {
      return { ok: false, error: "baseline_checkpoint_too_soon" };
    }
  }
  const rowsByType = await loadTenantCatalogRows({
    tenantId,
    stateDir: params.stateDir,
    catalog: params.catalog,
  });
  const snapshot = buildBaselineSnapshot({
    tenantId,
    capturedAt: params.now,
    rowsByType,
  });
  const write = writeStorageGrowthBaselineCas({
    stateDir: params.stateDir,
    baseline: snapshot,
  });
  if (!write.ok) {
    return { ok: false, error: write.error };
  }
  return { ok: true, value: snapshot };
}

export function refusePlacementFromLongevityReport(): LongevityReportResult<never> {
  return { ok: false, error: "placement_authority_forbidden" };
}

export function refusePurgeFromLongevityReport(): LongevityReportResult<never> {
  return { ok: false, error: "purge_authority_forbidden" };
}

export function refuseLongevityMtimeAsTruth(): LongevityReportResult<never> {
  return { ok: false, error: "mtime_truth_forbidden" };
}
