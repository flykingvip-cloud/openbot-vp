import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticateGovernanceCall,
  type GovernanceAuthenticatedCall,
} from "./cognitive-recommendation-auth.js";
import * as dataGovernanceBarrel from "./index.js";
import {
  resolveTenantKeyManagementAuth,
  writeTenantKeyManagementPolicyAtDeployBoundary,
  type TenantKeyManagementAuth,
} from "./key-rotation-auth.js";
import { writeTenantLongevityPolicyAtDeployBoundary } from "./longevity-policy-store.js";
import { readStorageGrowthBaseline, writeStorageGrowthBaseline } from "./longevity-report-store.js";
import {
  checkpointTenantStorageGrowthBaseline,
  DEFAULT_MAX_BACKUP_AGE_MS,
  evaluateBackupObservability,
  FIRST_WAVE_GOVERNED_RESOURCE_CLASSES,
  MS_PER_DAY,
  refuseLongevityMtimeAsTruth,
  refusePlacementFromLongevityReport,
  refusePurgeFromLongevityReport,
  runTenantLongevityReport,
} from "./longevity-report.js";
import {
  resolveCognitiveRecommendationRoot,
  resolveStorageGrowthBaselinePath,
  resolveTenantLongevityPolicyPath,
} from "./paths.js";
import { mutateRestoreDrillState } from "./restore-drill-store.js";
import {
  GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
  type CatalogRecord,
  type ProducerModelMatrixEntry,
} from "./types.js";

const resolveTenantContextMock = vi.hoisted(() =>
  vi.fn(async (): Promise<{ tenantId: string; userId: string; domain: string } | null> => null),
);
const resolveAuthoritativeMembershipMock = vi.hoisted(() => vi.fn(async () => null));

vi.mock("../tenant-context.js", () => ({
  resolveTenantContext: resolveTenantContextMock,
  resolveAuthoritativeMembership: resolveAuthoritativeMembershipMock,
  TenantContextError: class TenantContextError extends Error {
    constructor(
      message: string,
      readonly code: string,
    ) {
      super(message);
    }
  },
}));

const TENANT = "tenant-p5f";
const MEMBER = "user-p5f";
const REPORT_NOW = "2026-08-18T11:00:00.000Z";
const BACKUP_AT = "2026-08-17T12:00:00.000Z";
const RESTORE_AT = "2026-08-17T13:00:00.000Z";
const BACKUP_AGE_MS = Date.parse(REPORT_NOW) - Date.parse(BACKUP_AT);
const POLICY_UPDATED_AT = "2026-08-01T00:00:00.000Z";
const here = path.dirname(fileURLToPath(import.meta.url));

let stateDir = "";
let call: GovernanceAuthenticatedCall;
let auth: TenantKeyManagementAuth;

function tmpStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "p5f-longevity-report-"));
}

async function authCall(tenantId: string, userId: string): Promise<GovernanceAuthenticatedCall> {
  resolveTenantContextMock.mockResolvedValue({
    tenantId,
    userId,
    domain: "enterprise",
  });
  const authenticated = await authenticateGovernanceCall({
    connect: {} as never,
    user: `${userId}@${tenantId}.test`,
    sessionDomain: "enterprise",
  });
  if (!authenticated.ok) {
    throw new Error("expected GovernanceAuthenticatedCall");
  }
  return authenticated.call;
}

function seedKeyManagementPolicy(tenantId: string, userId: string): void {
  writeTenantKeyManagementPolicyAtDeployBoundary({
    stateDir,
    record: {
      schemaVersion: 1,
      tenantId,
      operators: [{ userId, role: "tenant-admin" }],
    },
  });
}

function seedLongevityPolicy(params?: {
  maxBackupAgeDays?: number;
  storageGrowthCheckpointMinDays?: number;
}): void {
  writeTenantLongevityPolicyAtDeployBoundary({
    stateDir,
    record: {
      schemaVersion: 1,
      tenantId: TENANT,
      maxBackupAgeDays: params?.maxBackupAgeDays ?? 30,
      storageGrowthCheckpointMinDays: params?.storageGrowthCheckpointMinDays ?? 1,
      updatedAt: POLICY_UPDATED_AT,
    },
  });
}

function catalogRecord(
  resourceId: string,
  resourceType: CatalogRecord["envelope"]["resourceType"],
  lifecycleState: CatalogRecord["envelope"]["lifecycleState"] = "active",
  projection?: Record<string, string | null>,
): CatalogRecord {
  return {
    envelope: {
      resourceId,
      resourceType,
      schemaVersion: GOVERNANCE_ENVELOPE_SCHEMA_VERSION,
      tenantId: TENANT,
      owner: { kind: "user", userId: MEMBER },
      scope: { kind: "tenant", tenantId: TENANT },
      lifecycleState,
      classification: "internal",
      governanceVersion: 1,
      canonicalBindingId: `bind-${resourceId}`,
      createdAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
      projection,
    },
    bindings: [
      {
        bindingId: `bind-${resourceId}`,
        resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: `/tmp/${resourceId}`,
        state: "active",
        contentVersion: "v1",
      },
    ],
  };
}

const producerMatrix: ProducerModelMatrixEntry[] = [
  {
    producerModelId: "producer-flagged",
    schemaVersion: "1",
    claimSupport: "flagged",
  },
  {
    producerModelId: "producer-unsupported",
    schemaVersion: "1",
    claimSupport: "unsupported",
  },
];

beforeEach(async () => {
  stateDir = tmpStateDir();
  seedKeyManagementPolicy(TENANT, MEMBER);
  seedLongevityPolicy();
  call = await authCall(TENANT, MEMBER);
  const resolved = resolveTenantKeyManagementAuth({ call, stateDir });
  if (!resolved.ok) {
    throw new Error("expected auth");
  }
  auth = resolved.auth;
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe("P5-f tenant longevity report", () => {
  it("reports storage growth for every first-wave resource class", async () => {
    const { createFileDataGovernanceCatalogStore } = await import("./catalog-store.js");
    const { resolveDataGovernanceCatalogPath } = await import("./paths.js");
    const store = createFileDataGovernanceCatalogStore({
      storePath: resolveDataGovernanceCatalogPath(stateDir),
    });
    await store.put(catalogRecord("res-ws", "workspace"));
    await store.put(catalogRecord("res-mem", "memory"));
    await store.put(catalogRecord("res-retired", "memory", "retired"));
    const { persistCognitiveRecommendationReceipt } =
      await import("./cognitive-recommendation-store.js");
    await persistCognitiveRecommendationReceipt({
      stateDir,
      receipt: {
        recommendationId: "rec-unsupported-1",
        candidateId: "cand-1",
        tenantId: TENANT,
        owner: { kind: "user", userId: MEMBER },
        sourceResourceIds: ["res-mem"],
        policyVersion: "policy-v1",
        scoreInputs: {
          admissionScore: { ieee754Hex: "0" },
          retrievalScore: { ieee754Hex: "0" },
          promotionScore: { ieee754Hex: "0" },
          scoreAlgorithmVersion: "cogniweave-atom-v1/scoreVersion=1",
          producerModelRef: "producer-unsupported",
        },
        decision: "recommend_deny",
        reasonCode: "unsupported_claim",
        requestedBy: { kind: "user", userId: MEMBER },
        executedBy: { kind: "system", systemId: "test" },
        requestFingerprint: "fp-1",
        createdAt: REPORT_NOW,
        expiresAt: "2026-09-18T11:00:00.000Z",
        status: "open",
      },
    });
    mutateRestoreDrillState({
      stateDir,
      tenantId: TENANT,
      fn: (state) => ({
        ok: true,
        value: state,
        state: { ...state, lastBackupAt: BACKUP_AT, lastRestoreAt: RESTORE_AT },
      }),
    });
    const report = await runTenantLongevityReport({
      auth,
      stateDir,
      now: REPORT_NOW,
      catalog: store,
      producerModelMatrix: producerMatrix,
    });
    expect(report.ok && report.value.kind).toBe("p5_tenant_longevity_report");
    expect(report.ok && report.value.storageGrowthByClass).toHaveLength(
      FIRST_WAVE_GOVERNED_RESOURCE_CLASSES.length,
    );
    const workspace = report.ok
      ? report.value.storageGrowthByClass.find((row) => row.resourceClass === "workspace")
      : null;
    expect(workspace).toMatchObject({
      resourceClass: "workspace",
      status: "observed",
      activeResourceCount: 1,
      governedResourceCount: 1,
      baselineCapturedAt: null,
      activeResourceCountDelta: null,
      growthRatePerDay: null,
    });
    const memory = report.ok
      ? report.value.storageGrowthByClass.find((row) => row.resourceClass === "memory")
      : null;
    expect(memory?.governedResourceCount).toBe(2);
    expect(report.ok && report.value.backup).toEqual({
      lastBackupAt: BACKUP_AT,
      lastProvenRestoreAt: RESTORE_AT,
      backupMissing: false,
      backupAgeFail: false,
      backupAgeMs: BACKUP_AGE_MS,
      maxBackupAgeMs: DEFAULT_MAX_BACKUP_AGE_MS,
      backupTimestampInvalid: false,
    });
    expect(report.ok && report.value.memoryHealth.unsupportedClaimCount).toBe(1);
    expect(report.ok && report.value.memoryHealth.retiredRecallCount).toBeGreaterThan(0);
  });

  it("does not mutate storage growth baseline on read", async () => {
    const { createFileDataGovernanceCatalogStore } = await import("./catalog-store.js");
    const { resolveDataGovernanceCatalogPath } = await import("./paths.js");
    const store = createFileDataGovernanceCatalogStore({
      storePath: resolveDataGovernanceCatalogPath(stateDir),
    });
    await store.put(catalogRecord("res-ws-1", "workspace"));
    const firstNow = "2026-08-16T11:00:00.000Z";
    await checkpointTenantStorageGrowthBaseline({
      auth,
      stateDir,
      now: firstNow,
      catalog: store,
    });
    const baselineBefore = readStorageGrowthBaseline({ stateDir, tenantId: TENANT });
    await runTenantLongevityReport({
      auth,
      stateDir,
      now: REPORT_NOW,
      catalog: store,
      producerModelMatrix: producerMatrix,
    });
    const baselineAfter = readStorageGrowthBaseline({ stateDir, tenantId: TENANT });
    expect(baselineAfter).toEqual(baselineBefore);
    expect(baselineAfter?.capturedAt).toBe(firstNow);
  });

  it("surfaces missing backup as a fail signal, not a silent zero", async () => {
    const report = await runTenantLongevityReport({
      auth,
      stateDir,
      now: REPORT_NOW,
      producerModelMatrix: producerMatrix,
    });
    expect(report.ok && report.value.backup).toEqual({
      lastBackupAt: null,
      lastProvenRestoreAt: null,
      backupMissing: true,
      backupAgeFail: true,
      backupAgeMs: null,
      maxBackupAgeMs: DEFAULT_MAX_BACKUP_AGE_MS,
      backupTimestampInvalid: false,
    });
  });

  it("binds backup SLO to deploy-boundary policy, not caller override", async () => {
    seedLongevityPolicy({ maxBackupAgeDays: 1 });
    mutateRestoreDrillState({
      stateDir,
      tenantId: TENANT,
      fn: (state) => ({
        ok: true,
        value: state,
        state: { ...state, lastBackupAt: "2020-01-01T00:00:00.000Z" },
      }),
    });
    const report = await runTenantLongevityReport({
      auth,
      stateDir,
      now: REPORT_NOW,
      producerModelMatrix: producerMatrix,
    });
    expect(report.ok && report.value.backup.backupAgeFail).toBe(true);
    expect(report.ok && report.value.backup.maxBackupAgeMs).toBe(MS_PER_DAY);
  });

  it("fail-closes when longevity policy is missing", async () => {
    fs.rmSync(resolveTenantLongevityPolicyPath(stateDir, TENANT), { force: true });
    const report = await runTenantLongevityReport({
      auth,
      stateDir,
      now: REPORT_NOW,
      producerModelMatrix: producerMatrix,
    });
    expect(report).toEqual({ ok: false, error: "longevity_policy_missing" });
  });

  it("fail-closes on stale backup age beyond SLO", () => {
    mutateRestoreDrillState({
      stateDir,
      tenantId: TENANT,
      fn: (state) => ({
        ok: true,
        value: state,
        state: { ...state, lastBackupAt: "2020-01-01T00:00:00.000Z" },
      }),
    });
    const evaluated = evaluateBackupObservability({
      stateDir,
      tenantId: TENANT,
      now: REPORT_NOW,
      maxBackupAgeMs: MS_PER_DAY,
    });
    expect(evaluated.backupAgeFail).toBe(true);
    expect(evaluated.backupAgeMs).toBeGreaterThan(MS_PER_DAY);
    expect(evaluated.backupTimestampInvalid).toBe(false);
  });

  it("fail-closes on future or invalid backup timestamps", () => {
    mutateRestoreDrillState({
      stateDir,
      tenantId: TENANT,
      fn: (state) => ({
        ok: true,
        value: state,
        state: { ...state, lastBackupAt: "2027-06-01T00:00:00.000Z" },
      }),
    });
    const future = evaluateBackupObservability({
      stateDir,
      tenantId: TENANT,
      now: REPORT_NOW,
      maxBackupAgeMs: DEFAULT_MAX_BACKUP_AGE_MS,
    });
    expect(future).toEqual({
      lastBackupAt: "2027-06-01T00:00:00.000Z",
      lastProvenRestoreAt: null,
      backupMissing: false,
      backupAgeFail: true,
      backupAgeMs: null,
      maxBackupAgeMs: DEFAULT_MAX_BACKUP_AGE_MS,
      backupTimestampInvalid: true,
    });

    mutateRestoreDrillState({
      stateDir,
      tenantId: TENANT,
      fn: (state) => ({
        ok: true,
        value: state,
        state: { ...state, lastBackupAt: "not-a-date" },
      }),
    });
    const invalid = evaluateBackupObservability({
      stateDir,
      tenantId: TENANT,
      now: REPORT_NOW,
      maxBackupAgeMs: DEFAULT_MAX_BACKUP_AGE_MS,
    });
    expect(invalid.backupTimestampInvalid).toBe(true);
    expect(invalid.backupAgeFail).toBe(true);
    expect(invalid.backupAgeMs).toBeNull();
  });

  it("computes storage growth delta and rate after explicit baseline checkpoints", async () => {
    const { createFileDataGovernanceCatalogStore } = await import("./catalog-store.js");
    const { resolveDataGovernanceCatalogPath } = await import("./paths.js");
    const store = createFileDataGovernanceCatalogStore({
      storePath: resolveDataGovernanceCatalogPath(stateDir),
    });
    await store.put(catalogRecord("res-ws-1", "workspace"));
    const firstNow = "2026-08-16T11:00:00.000Z";
    const first = await checkpointTenantStorageGrowthBaseline({
      auth,
      stateDir,
      now: firstNow,
      catalog: store,
    });
    expect(first.ok).toBe(true);
    await store.put(catalogRecord("res-ws-2", "workspace"));
    const second = await runTenantLongevityReport({
      auth,
      stateDir,
      now: REPORT_NOW,
      catalog: store,
      producerModelMatrix: producerMatrix,
    });
    expect(second.ok).toBe(true);
    const workspace = second.ok
      ? second.value.storageGrowthByClass.find((row) => row.resourceClass === "workspace")
      : null;
    expect(workspace).toMatchObject({
      activeResourceCount: 2,
      governedResourceCount: 2,
      baselineCapturedAt: firstNow,
      baselineActiveResourceCount: 1,
      baselineGovernedResourceCount: 1,
      activeResourceCountDelta: 1,
      governedResourceCountDelta: 1,
    });
    expect(workspace?.growthRatePerDay).toBeCloseTo(1 / 2, 5);
  });

  it("rejects baseline checkpoints inside the policy min period", async () => {
    const { createFileDataGovernanceCatalogStore } = await import("./catalog-store.js");
    const { resolveDataGovernanceCatalogPath } = await import("./paths.js");
    const store = createFileDataGovernanceCatalogStore({
      storePath: resolveDataGovernanceCatalogPath(stateDir),
    });
    const firstNow = "2026-08-16T11:00:00.000Z";
    await checkpointTenantStorageGrowthBaseline({
      auth,
      stateDir,
      now: firstNow,
      catalog: store,
    });
    const tooSoon = await checkpointTenantStorageGrowthBaseline({
      auth,
      stateDir,
      now: "2026-08-16T20:00:00.000Z",
      catalog: store,
    });
    expect(tooSoon).toEqual({ ok: false, error: "baseline_checkpoint_too_soon" });
  });

  it("rejects out-of-order baseline checkpoints via CAS", async () => {
    const { createFileDataGovernanceCatalogStore } = await import("./catalog-store.js");
    const { resolveDataGovernanceCatalogPath } = await import("./paths.js");
    const store = createFileDataGovernanceCatalogStore({
      storePath: resolveDataGovernanceCatalogPath(stateDir),
    });
    writeStorageGrowthBaseline({
      stateDir,
      baseline: {
        schemaVersion: 1,
        tenantId: TENANT,
        capturedAt: REPORT_NOW,
        countsByClass: Object.fromEntries(
          FIRST_WAVE_GOVERNED_RESOURCE_CLASSES.map((resourceClass) => [
            resourceClass,
            { activeResourceCount: 0, governedResourceCount: 0 },
          ]),
        ) as never,
      },
    });
    const stale = await checkpointTenantStorageGrowthBaseline({
      auth,
      stateDir,
      now: "2026-08-16T11:00:00.000Z",
      catalog: store,
    });
    expect(stale).toEqual({ ok: false, error: "baseline_checkpoint_stale" });
  });

  it("returns report_incomplete when a cognitive receipt file is corrupt", async () => {
    const root = resolveCognitiveRecommendationRoot(stateDir);
    const tenantDir = path.join(root, TENANT);
    fs.mkdirSync(tenantDir, { recursive: true });
    fs.writeFileSync(path.join(tenantDir, "broken.json"), '{"recommendationId":', "utf8");
    const report = await runTenantLongevityReport({
      auth,
      stateDir,
      now: REPORT_NOW,
      producerModelMatrix: producerMatrix,
    });
    expect(report).toEqual({ ok: false, error: "report_incomplete" });
  });

  it("returns report_incomplete when storage growth baseline is corrupt", async () => {
    const baselinePath = resolveStorageGrowthBaselinePath(stateDir, TENANT);
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, '{"schemaVersion":1,"tenantId":"wrong"}', "utf8");
    const report = await runTenantLongevityReport({
      auth,
      stateDir,
      now: REPORT_NOW,
      producerModelMatrix: producerMatrix,
    });
    expect(report).toEqual({ ok: false, error: "report_incomplete" });
  });

  it("refuses placement, purge, and mtime truth from longevity reports", () => {
    expect(refusePlacementFromLongevityReport()).toEqual({
      ok: false,
      error: "placement_authority_forbidden",
    });
    expect(refusePurgeFromLongevityReport()).toEqual({
      ok: false,
      error: "purge_authority_forbidden",
    });
    expect(refuseLongevityMtimeAsTruth()).toEqual({ ok: false, error: "mtime_truth_forbidden" });
  });

  it("keeps longevity report source free of placement forks in the barrel", () => {
    const source = fs.readFileSync(path.join(here, "longevity-report.ts"), "utf8");
    for (const token of [
      "decideShadowPromotion",
      "fs.stat",
      "statSync",
      "mtimeMs",
      "placement_export",
      "requestPurge",
    ]) {
      expect(source.includes(token), token).toBe(false);
    }
    expect(dataGovernanceBarrel).toHaveProperty("runTenantLongevityReport");
    expect(dataGovernanceBarrel).toHaveProperty("checkpointTenantStorageGrowthBaseline");
    expect(dataGovernanceBarrel).toHaveProperty("FIRST_WAVE_GOVERNED_RESOURCE_CLASSES");
    expect(dataGovernanceBarrel).toHaveProperty("evaluateBackupObservability");
    expect(dataGovernanceBarrel).not.toHaveProperty("mutateRestoreDrillState");
    expect(dataGovernanceBarrel).not.toHaveProperty("readStorageGrowthBaseline");
    expect(dataGovernanceBarrel).not.toHaveProperty("writeTenantLongevityPolicyAtDeployBoundary");
  });
});
