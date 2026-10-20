/**
 * Pinned-fixture threshold run (B28). Executes labeled semantic cases against
 * production detect / merge / shadow-promotion / retrieval commands.
 * Not a public barrel export. Setup/auth/write failures fail the run.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFileDataGovernanceCatalogStore } from "./catalog-store.js";
import { resolveGovernanceApprovalAuth } from "./cognitive-approval-auth.js";
import { writeGovernanceApprovalGrantAtDeployBoundary } from "./cognitive-approval-grant-store.js";
import {
  detectAndRecordCognitiveConflict,
  type CognitiveComparableClaim,
} from "./cognitive-conflict-detect.js";
import { readConflictGraphHead } from "./cognitive-conflict-graph.js";
import {
  evaluateCognitiveThresholds,
  loadThresholdContract,
  type EvaluateThresholdsResult,
  type EvaluatorRow,
  type ThresholdContract,
} from "./cognitive-evaluator.js";
import { applyCognitiveMerge } from "./cognitive-merge.js";
import {
  authenticateGovernanceCall,
  resolveCognitiveRecommendationAuth,
} from "./cognitive-recommendation-auth.js";
import { recordCognitiveRecommendation } from "./cognitive-recommendation.js";
import { decideConstrainedRetrieval } from "./cognitive-retrieval.js";
import { decideShadowPromotion } from "./cognitive-shadow-promotion.js";
import { updateCognitiveGovernance } from "./cognitive-update.js";
import { unlockCognitiveWritesForTests } from "./cognitive-write-unlock.test-harness.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import type { CatalogRecord, DataClassification, LifecycleState } from "./types.js";

const MERGE_BLOCKED = new Set(["conflict_open_blocks_merge", "conflicted", "conflict_graph_stale"]);

export class EvaluatorRunError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "EvaluatorRunError";
  }
}

export type FixtureCase = {
  id: string;
  label: string;
  left?: CognitiveComparableClaim;
  right?: CognitiveComparableClaim;
  admissionScore?: number;
  retrievalScore?: number;
  promotionScore?: number;
  classification?: DataClassification;
  lifecycleState?: LifecycleState;
  privacyLevel?: "public" | "internal" | "private";
  syncEligibility?: "promoted" | "allowed" | "blocked";
  eligibility?: string;
};

function fail(code: string): never {
  throw new EvaluatorRunError(code);
}

function readJsonl(filePath: string): FixtureCase[] {
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as FixtureCase);
}

function memoryRow(resourceId: string, patch?: Partial<CatalogRecord["envelope"]>): CatalogRecord {
  return {
    envelope: {
      resourceId,
      resourceType: "memory",
      schemaVersion: 1,
      tenantId: "t1",
      owner: { kind: "user", userId: "u1" },
      scope: { kind: "tenant", tenantId: "t1" },
      lifecycleState: "active",
      classification: "confidential",
      governanceVersion: 1,
      canonicalBindingId: `bind-${resourceId}`,
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:00:00Z",
      projection: { canonicalKind: "cogniweave", atomId: resourceId, memoryTier: "working" },
      ...patch,
    },
    bindings: [
      {
        bindingId: `bind-${resourceId}`,
        resourceId,
        role: "canonical",
        storageKind: "filesystem",
        locator: `/data/${resourceId}`,
        state: "active",
        contentVersion: "v1",
      },
    ],
  };
}

async function enterpriseCall() {
  const authenticated = await authenticateGovernanceCall({
    connect: {} as never,
    user: "u1@acme.test",
    sessionDomain: "enterprise",
  });
  if (!authenticated.ok) {
    fail("auth_failed");
  }
  return authenticated.call;
}

function requireClaims(row: FixtureCase): {
  left: CognitiveComparableClaim;
  right: CognitiveComparableClaim;
} {
  if (!row.left || !row.right) {
    fail(`missing_semantic_input:${row.id}`);
  }
  return { left: row.left, right: row.right };
}

async function detectPair(params: {
  row: FixtureCase;
  stateDir: string;
}): Promise<{ detected: boolean }> {
  const { left, right } = requireClaims(params.row);
  const detected = await detectAndRecordCognitiveConflict({
    tenantId: "t1",
    stateDir: params.stateDir,
    leftResourceId: "mem-target",
    rightResourceId: "mem-src",
    leftClaim: left,
    rightClaim: right,
    evaluatorId: `eval-${params.row.id}`,
  });
  if (!detected.ok) {
    fail(`conflict_detect_failed:${detected.error}`);
  }
  return { detected: detected.detected };
}

async function mergeAuth(stateDir: string, grantId: string) {
  writeGovernanceApprovalGrantAtDeployBoundary({
    record: {
      grantId,
      kind: "governance_approval_grant",
      grantKind: "cognitive_merge_apply",
      tenantId: "t1",
      scope: { kind: "resource", resourceId: "mem-target" },
      approverUserId: "u1",
      issuedBy: "enterprise_ops",
      issuedAt: "2026-08-11T00:00:00Z",
      expiresAt: "2027-08-11T00:00:00Z",
    },
    stateDir,
  });
  const resolved = await resolveGovernanceApprovalAuth({
    call: await enterpriseCall(),
    owner: { kind: "user", userId: "u1" },
    grantId,
    requiredKind: "cognitive_merge_apply",
    requiredScope: { kind: "resource", resourceId: "mem-target" },
    stateDir,
  });
  if (!resolved.ok) {
    fail(`merge_auth_failed:${resolved.reason}`);
  }
  return resolved.auth;
}

async function applyLabeledMerge(params: {
  row: FixtureCase;
  stateDir: string;
  catalog: ReturnType<typeof createFileDataGovernanceCatalogStore>;
}): Promise<boolean> {
  const auth = await mergeAuth(params.stateDir, `grant-merge-${params.row.id}`);
  const head = readConflictGraphHead({ tenantId: "t1", stateDir: params.stateDir });
  const merged = await applyCognitiveMerge({
    mergeId: `merge-${params.row.id}`,
    targetResourceId: "mem-target",
    sourceResourceIds: ["mem-src"],
    expectedGovernanceVersion: (await params.catalog.get("mem-target"))!.envelope.governanceVersion,
    expectedConflictGraphVersion: head.graphVersion,
    expectedConflictGraphHash: head.graphHash,
    policyVersion: "merge-v1",
    auth,
    stateDir: params.stateDir,
    catalog: params.catalog,
  });
  if (merged.ok) {
    return true;
  }
  if (MERGE_BLOCKED.has(merged.error)) {
    return false;
  }
  fail(`merge_infra_failed:${merged.error}`);
}

async function runMergeCases(dest: string): Promise<EvaluatorRow[]> {
  const rows: EvaluatorRow[] = [];
  for (const row of readJsonl(dest)) {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-eval-merge-"));
    try {
      unlockCognitiveWritesForTests(stateDir);
      const catalog = createFileDataGovernanceCatalogStore({
        storePath: resolveDataGovernanceCatalogPath(stateDir),
      });
      await catalog.put(memoryRow("mem-target"));
      await catalog.put(memoryRow("mem-src"));
      await detectPair({ row, stateDir });
      rows.push({ label: row.label, applied: await applyLabeledMerge({ row, stateDir, catalog }) });
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }
  return rows;
}

async function runConflictMustDetect(
  contract: ThresholdContract,
  repoRoot: string,
): Promise<EvaluatorRow[]> {
  const dest = path.resolve(repoRoot, contract.fixtures.conflictMustDetect.path);
  const rows: EvaluatorRow[] = [];
  for (const row of readJsonl(dest)) {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-eval-cmd-"));
    try {
      unlockCognitiveWritesForTests(stateDir);
      const catalog = createFileDataGovernanceCatalogStore({
        storePath: resolveDataGovernanceCatalogPath(stateDir),
      });
      await catalog.put(memoryRow("mem-target"));
      await catalog.put(memoryRow("mem-src"));
      const detected = await detectPair({ row, stateDir });
      rows.push({ label: row.label, detected: detected.detected });
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }
  return rows;
}

async function runPromotionShadowNegative(
  contract: ThresholdContract,
  repoRoot: string,
): Promise<EvaluatorRow[]> {
  const dest = path.resolve(repoRoot, contract.fixtures.promotionShadowNegative.path);
  const rows: EvaluatorRow[] = [];
  for (const row of readJsonl(dest)) {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-eval-psn-"));
    try {
      unlockCognitiveWritesForTests(stateDir);
      const catalog = createFileDataGovernanceCatalogStore({
        storePath: resolveDataGovernanceCatalogPath(stateDir),
      });
      await catalog.put(memoryRow("mem-1"));
      const recAuth = await resolveCognitiveRecommendationAuth({
        call: await enterpriseCall(),
        owner: { kind: "user", userId: "u1" },
        stateDir,
      });
      if (!recAuth.ok) {
        fail(`recommendation_auth_failed:${recAuth.error}`);
      }
      const decided = decideShadowPromotion({
        admissionScore: row.admissionScore ?? Number.NaN,
        retrievalScore: row.retrievalScore ?? Number.NaN,
        promotionScore: row.promotionScore ?? Number.NaN,
        classification: row.classification ?? "confidential",
        lifecycleState: row.lifecycleState ?? "active",
        privacyLevel: row.privacyLevel,
        syncEligibility: row.syncEligibility,
      });
      if (!decided.ok) {
        fail(`shadow_promotion_invalid:${decided.error}`);
      }
      const recorded = await recordCognitiveRecommendation({
        recommendationId: row.id,
        candidateId: `cand-${row.id}`,
        sourceResourceIds: ["mem-1"],
        policyVersion: "shadow-promo-v1",
        admissionScore: row.admissionScore ?? 0,
        retrievalScore: row.retrievalScore ?? 0,
        promotionScore: row.promotionScore ?? 0,
        scoreAlgorithmVersion: "score-v1",
        producerModelRef: "eval-producer",
        decision: decided.decision,
        reasonCode: decided.reasonCode,
        auth: recAuth.auth,
        stateDir,
        catalog,
      });
      if (!recorded.ok) {
        fail(`recommendation_write_failed:${recorded.error}`);
      }
      rows.push({
        label: row.label,
        promoted: recorded.receipt.decision === "recommend_admit",
      });
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }
  return rows;
}

async function runRetiredRecall(
  contract: ThresholdContract,
  repoRoot: string,
): Promise<EvaluatorRow[]> {
  const dest = path.resolve(repoRoot, contract.fixtures.retiredRecallViolations.path);
  const rows: EvaluatorRow[] = [];
  for (const row of readJsonl(dest)) {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-eval-rrv-"));
    try {
      unlockCognitiveWritesForTests(stateDir);
      const catalog = createFileDataGovernanceCatalogStore({
        storePath: resolveDataGovernanceCatalogPath(stateDir),
      });
      await catalog.put(memoryRow("mem-retired"));
      const current = (await catalog.get("mem-retired"))!;
      const updated = await updateCognitiveGovernance({
        resourceId: "mem-retired",
        expectedGovernanceVersion: current.envelope.governanceVersion,
        actor: { kind: "operator", operatorId: "op-1" },
        mutationId: `mut-retired-${row.id}`,
        patch: {
          cognitiveTier: "C4",
          preservationPriority: "standard",
          retrievalPatch: {
            eligibility: "retired",
            basePriority: 0.5,
            freshnessPolicyId: "freshness-v1",
            applicabilityPolicyId: "applicability-v1",
          },
        },
        stateDir,
        catalog,
      });
      if (!updated.ok) {
        fail(`retired_setup_failed:${updated.error}`);
      }
      const recAuth = await resolveCognitiveRecommendationAuth({
        call: await enterpriseCall(),
        owner: { kind: "user", userId: "u1" },
        stateDir,
      });
      if (!recAuth.ok) {
        fail(`retired_auth_failed:${recAuth.error}`);
      }
      const decision = await decideConstrainedRetrieval({
        resourceId: "mem-retired",
        mode: "default_recall",
        retrievalScore: 0.9,
        auth: recAuth.auth,
        stateDir,
        catalog,
      });
      rows.push({
        label: row.label,
        recalledRetired: decision.outcome === "allow",
      });
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  }
  return rows;
}

export async function runPinnedCognitiveThresholds(params: {
  repoRoot: string;
  contractPath?: string;
}): Promise<EvaluateThresholdsResult> {
  const contractPath =
    params.contractPath ??
    path.join(params.repoRoot, ".kiro/specs/data-governance-v2-p3/evaluation-thresholds-p3e.json");
  try {
    const contract = loadThresholdContract(contractPath);
    const rows = {
      mergeConflictNegative: await runMergeCases(
        path.resolve(params.repoRoot, contract.fixtures.mergeConflictNegative.path),
      ),
      mergeEquivPositive: await runMergeCases(
        path.resolve(params.repoRoot, contract.fixtures.mergeEquivPositive.path),
      ),
      conflictMustDetect: await runConflictMustDetect(contract, params.repoRoot),
      promotionShadowNegative: await runPromotionShadowNegative(contract, params.repoRoot),
      retiredRecallViolations: await runRetiredRecall(contract, params.repoRoot),
    };
    return evaluateCognitiveThresholds({
      contract,
      repoRoot: params.repoRoot,
      rows,
    });
  } catch (error) {
    if (error instanceof EvaluatorRunError) {
      return { ok: false, error: `evaluator_error:${error.code}` };
    }
    throw error;
  }
}
