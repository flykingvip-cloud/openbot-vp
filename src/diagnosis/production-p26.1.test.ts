import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import { DIAGNOSIS_PRODUCTION_SLO } from "./production-cutover.js";
import {
  DIAGNOSIS_P26_1_CUTOVER_OWNER,
  DIAGNOSIS_P26_1_FROZEN_CANDIDATE_SHA,
  DIAGNOSIS_P26_1_FROZEN_LIVE_SHA,
  DIAGNOSIS_P26_1_MERGED_PRS,
  DIAGNOSIS_P26_1_SIGNATURE_KIND,
  DIAGNOSIS_P26_1_TENANT,
  assertDiagnosisProductionP26_1Evaluated,
  assertP26_1ReevalSource,
  evaluateDiagnosisProductionP26_1,
  recordDiagnosisP26_1HumanReeval,
  type DiagnosisP26_1HumanReevalClaim,
} from "./production-p26.1.js";
import { DIAGNOSIS_P26_FROZEN_CANDIDATE_SHA } from "./production-p26.js";
import { DiagnosisContractError } from "./types.js";

const FROZEN = DIAGNOSIS_P26_1_FROZEN_CANDIDATE_SHA;
const LIVE = DIAGNOSIS_P26_1_FROZEN_LIVE_SHA;
const OTHER = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function alignedInput(
  over: Partial<DiagnosisIndependentApprovalInput> = {},
): DiagnosisIndependentApprovalInput {
  return {
    candidateSha: FROZEN,
    originMainSha: FROZEN,
    liveSha: LIVE,
    liveSource: "container",
    releaseRecordSha: LIVE,
    ledgerOpenShas: [LIVE],
    provenanceTagSha: LIVE,
    originMainIsAncestorOfCandidate: true,
    liveIsAncestorOfCandidate: true,
    originMainContainsLive: true,
    livePackRegistered: true,
    coreHandlerHasDiagnosis: false,
    readerAvailable: false,
    auditAvailable: false,
    quotaAvailable: false,
    now: Date.parse("2026-09-06T10:40:00.000Z"),
    ...over,
  };
}

function reevalClaim(
  over: Partial<DiagnosisP26_1HumanReevalClaim> = {},
): DiagnosisP26_1HumanReevalClaim {
  return {
    kind: DIAGNOSIS_P26_1_SIGNATURE_KIND,
    increment: "P26.1",
    schemaVersion: 1,
    candidateSha: FROZEN,
    liveSha: LIVE,
    approvalRecordsEvaluation: true,
    acceptsClientParam: false,
    acceptsModelOutput: false,
    confirmHuman: true,
    confirmPostMergeReeval: true,
    confirmHistoricalP26Invalidated: true,
    confirmEvaluationOnly: true,
    confirmProductionReady: false,
    confirmNoLiveCutover: true,
    confirmDeliveryOwnsCutover: true,
    confirmLiveExecutorUndeployed: true,
    confirmCanaryTenant: DIAGNOSIS_P26_1_TENANT,
    signer: "Daniel / CEO",
    ...over,
  };
}

describe("P26.1 post-merge re-evaluation", () => {
  it("re-runs the isolated chain after #988/#989/#990 and stays No-Go", async () => {
    // Historical snapshot update against current origin/main. No-Go unchanged.
    // The frozen 7d75c0bb window is not current tip 643dcd6a4f. The allowlisted
    // remediation executor now resolves, so isolatedReevalReady stays false.
    // That is fail-closed, not a Production Ready grant.
    expect(DIAGNOSIS_PRODUCTION_SLO.completeness).not.toBe("complete");
    expect(DIAGNOSIS_P26_FROZEN_CANDIDATE_SHA).not.toBe(FROZEN);
    const report = await evaluateDiagnosisProductionP26_1(alignedInput());
    expect(report.isolatedReevalReady).toBe(false);
    expect(report.humanReevalRecorded).toBe(false);
    expect(report.acceptance.probesPassed).toBe(true);
    expect(report.acceptance.chainHeld).toBe(true);
    expect(report.historicalP26Invalidated).toBe(true);
    expect(report.historicalP26RequiresResign).toBe(true);
    expect(report.mergedPrs).toEqual(DIAGNOSIS_P26_1_MERGED_PRS);
    expect(report.cutoverOwner).toBe(DIAGNOSIS_P26_1_CUTOVER_OWNER);
    expect(report.diagnosisOnlyCutover).toBe(false);
    expect(report.p26Evaluated).toBe(true);
    expect(report.p26ProductionReady).toBe(false);
    expect(report.liveEqualsCandidate).toBe(false);
    expect(report.productionSloComplete).toBe(false);
    expect(report.blockers).toContain("live_not_equal_candidate");
    expect(report.blockers).toContain("production_slo_empty");
    expect(report.blockers).toContain("historical_p26_invalidated");
    expect(report.blockers).toContain("live_cutover_pending");
    expect(() => assertDiagnosisProductionP26_1Evaluated(report)).toThrow(DiagnosisContractError);
  });

  it("rejects ancestor reuse, client/model sources, and Production Ready claims", async () => {
    const stale = await evaluateDiagnosisProductionP26_1(
      alignedInput({ candidateSha: OTHER, originMainSha: OTHER }),
    );
    expect(stale.isolatedReevalReady).toBe(false);
    expect(stale.exactIdentityMatch).toBe(false);
    expect(() => assertP26_1ReevalSource({ clientParam: true })).toThrow(DiagnosisContractError);
    expect(() => assertP26_1ReevalSource({ modelOutput: "ok" })).toThrow(DiagnosisContractError);
    const unsigned = await evaluateDiagnosisProductionP26_1(alignedInput());
    expect(() =>
      recordDiagnosisP26_1HumanReeval(unsigned, reevalClaim({ liveSha: OTHER })),
    ).toThrow(DiagnosisContractError);
    expect(() =>
      recordDiagnosisP26_1HumanReeval(
        unsigned,
        reevalClaim({ confirmProductionReady: true as unknown as false }),
      ),
    ).toThrow(DiagnosisContractError);
    await expect(
      evaluateDiagnosisProductionP26_1({
        ...alignedInput({ candidateSha: OTHER, originMainSha: OTHER }),
        humanReeval: reevalClaim({ candidateSha: OTHER }),
      }),
    ).rejects.toBeInstanceOf(DiagnosisContractError);
  });

  it("does not scan as a live apply, Doctor --fix, or Production Ready declaration", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "production-p26.1.ts"),
      "utf8",
    );
    expect(source).toContain("Does not bind Doctor --fix");
    expect(source).toContain("p26ProductionReady: false");
    expect(source).toContain("Delivery owns cutover");
    expect(source).toContain("Historical snapshot");
    expect(source).not.toContain("runDoctorChecks");
    expect(source).not.toContain("doctor --fix");
    expect(source).not.toContain("restartChannel");
    // Historical snapshot vs current origin/main at A4 close. No-Go unchanged.
    expect(DIAGNOSIS_P26_1_FROZEN_CANDIDATE_SHA).not.toBe(
      "643dcd6a4f765b7a23da93f3f78821ad2e934929",
    );
  });
});
