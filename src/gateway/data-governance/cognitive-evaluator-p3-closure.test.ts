import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "../tenant-context.js";
import { resetCatalogStoreSingletonsForTests } from "./catalog-store.js";
import * as conflictDetect from "./cognitive-conflict-detect.js";
import { runPinnedCognitiveThresholds } from "./cognitive-evaluator-run.js";
import { evaluateCognitiveThresholds, loadThresholdContract } from "./cognitive-evaluator.js";
import type { RetrievalPolicyEvaluator } from "./cognitive-retrieval-policy.js";
import * as shadowPromotion from "./cognitive-shadow-promotion.js";
import * as dataGovernanceBarrel from "./index.js";

const resolveTenantContextMock = vi.hoisted(() =>
  vi.fn(async (): Promise<TenantContext | null> => null),
);
const resolveAuthoritativeMembershipMock = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{ tenantId: string | null; userId: string | null }> => ({
      tenantId: null,
      userId: null,
    }),
  ),
);
const getRetrievalPolicyEvaluatorMock = vi.hoisted(() =>
  vi.fn((): RetrievalPolicyEvaluator | undefined => undefined),
);

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

vi.mock("./cognitive-retrieval-policy.js", () => ({
  getRetrievalPolicyEvaluator: getRetrievalPolicyEvaluatorMock,
}));

afterEach(() => {
  resetCatalogStoreSingletonsForTests();
  getRetrievalPolicyEvaluatorMock.mockReset();
  getRetrievalPolicyEvaluatorMock.mockReturnValue(undefined);
  resolveTenantContextMock.mockReset();
  resolveTenantContextMock.mockResolvedValue({
    tenantId: "t1",
    userId: "u1",
    domain: "enterprise",
  });
  resolveAuthoritativeMembershipMock.mockReset();
  resolveAuthoritativeMembershipMock.mockResolvedValue({ tenantId: null, userId: null });
  vi.restoreAllMocks();
});

function runnerSource(): string {
  return fs.readFileSync(path.join(import.meta.dirname, "cognitive-evaluator-run.ts"), "utf8");
}

describe("P3 pinned-fixture threshold run", () => {
  it("keeps the evaluator runner and production decision entries off the public barrel", () => {
    expect("runPinnedCognitiveThresholds" in dataGovernanceBarrel).toBe(false);
    expect("shadowPromotionAllows" in dataGovernanceBarrel).toBe(false);
    expect("decideShadowPromotion" in dataGovernanceBarrel).toBe(false);
    expect("detectAndRecordCognitiveConflict" in dataGovernanceBarrel).toBe(false);
  });

  it("refuses evaluator-side answer planting and unused positive pins", () => {
    const src = runnerSource();
    expect(src).not.toMatch(/recordOpenConflictEdge/);
    expect(src).not.toMatch(/shadowPromotionAllows/);
    expect(src).not.toMatch(/promotionScore\s*\?\? 0\)\s*>=\s*0\.8/);
    expect(src).toMatch(/detectAndRecordCognitiveConflict/);
    expect(src).toMatch(/decideShadowPromotion/);
    expect(src).toMatch(/mergeEquivPositive/);
  });

  it("fail-closes when labeled positives were never executed or all rejected", () => {
    const repoRoot = process.cwd();
    const contract = loadThresholdContract(
      path.join(repoRoot, ".kiro/specs/data-governance-v2-p3/evaluation-thresholds-p3e.json"),
    );
    const baseRows = {
      mergeConflictNegative: Array.from({ length: 50 }, () => ({
        label: "must_not_merge",
        applied: false,
      })),
      conflictMustDetect: Array.from({ length: 50 }, () => ({
        label: "must_detect",
        detected: true,
      })),
      promotionShadowNegative: Array.from({ length: 50 }, () => ({
        label: "must_not_promote",
        promoted: false,
      })),
      retiredRecallViolations: [{ label: "retired", recalledRetired: false }],
    };
    expect(evaluateCognitiveThresholds({ contract, repoRoot, rows: baseRows })).toEqual({
      ok: false,
      error: "positive_merge_not_executed",
    });
    expect(
      evaluateCognitiveThresholds({
        contract,
        repoRoot,
        rows: {
          ...baseRows,
          mergeEquivPositive: Array.from({ length: 50 }, () => ({
            label: "should_merge",
            applied: false,
          })),
        },
      }),
    ).toEqual({ ok: false, error: "positive_merge_all_rejected" });
    expect(
      evaluateCognitiveThresholds({
        contract,
        repoRoot,
        rows: {
          ...baseRows,
          mergeConflictNegative: [
            { label: "must_not_merge", applied: false, error: "auth_failed" },
          ],
          mergeEquivPositive: [{ label: "should_merge", applied: true }],
        },
      }),
    ).toEqual({ ok: false, error: "evaluator_error" });
  });

  it("does not count auth or write setup failure as a correct negative", async () => {
    resolveTenantContextMock.mockResolvedValue(null);
    const result = await runPinnedCognitiveThresholds({ repoRoot: process.cwd() });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/^evaluator_error:/);
    }
  });

  it("fails when the production shadow decision is forced to admit negatives", async () => {
    const spy = vi.spyOn(shadowPromotion, "decideShadowPromotion").mockReturnValue({
      ok: true,
      decision: "recommend_admit",
      reasonCode: "forced_admit",
    });
    const result = await runPinnedCognitiveThresholds({ repoRoot: process.cwd() });
    expect(spy).toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "threshold_exceeded" });
  });

  it("fails when production detect is stubbed to never classify a conflict", async () => {
    const spy = vi
      .spyOn(conflictDetect, "detectAndRecordCognitiveConflict")
      .mockResolvedValue({ ok: true, detected: false });
    const result = await runPinnedCognitiveThresholds({ repoRoot: process.cwd() });
    expect(spy).toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "threshold_exceeded" });
  });

  it("passes the pinned contract after executing labeled semantic fixtures", async () => {
    resolveTenantContextMock.mockResolvedValue({
      tenantId: "t1",
      userId: "u1",
      domain: "enterprise",
    });
    const repoRoot = process.cwd();
    const contract = loadThresholdContract(
      path.join(repoRoot, ".kiro/specs/data-governance-v2-p3/evaluation-thresholds-p3e.json"),
    );
    expect(contract.fixturePinStatus).toBe("pinned");
    for (const fixture of Object.values(contract.fixtures)) {
      expect(fixture.pinStatus).toBe("pinned");
      expect(fixture.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(fixture.sha256).not.toMatch(/^0+$/);
    }
    const result = await runPinnedCognitiveThresholds({ repoRoot });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.metrics.falseMergeRate.value).toBe(0);
      expect(result.metrics.missedConflictRate.value).toBe(0);
      expect(result.metrics.falsePromotionRate.value).toBe(0);
      expect(result.metrics.retiredInDefaultRecallMax.value).toBe(0);
    }
  });
});
