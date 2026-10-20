import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import { DIAGNOSIS_PRODUCTION_SLO } from "./production-cutover.js";
import { DIAGNOSIS_P26_1_FROZEN_CANDIDATE_SHA } from "./production-p26.1.js";
import {
  DIAGNOSIS_P26_2_CUTOVER_OWNER,
  DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA,
  DIAGNOSIS_P26_2_FROZEN_LIVE_SHA,
  DIAGNOSIS_P26_2_MERGED_PRS,
  DIAGNOSIS_P26_2_SIGNATURE_KIND,
  DIAGNOSIS_P26_2_TENANT,
  assertDiagnosisProductionP26_2Evaluated,
  assertP26_2ReadinessSource,
  evaluateDiagnosisProductionP26_2,
  recordDiagnosisP26_2HumanReadiness,
  type DiagnosisP26_2HumanReadinessClaim,
} from "./production-p26.2.js";
import { DiagnosisContractError } from "./types.js";

const FROZEN = DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA;
const LIVE = DIAGNOSIS_P26_2_FROZEN_LIVE_SHA;
const OTHER = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function alignedInput(
  over: Partial<DiagnosisIndependentApprovalInput> & {
    ghcrImageAvailable?: boolean;
    dockerReleaseStatus?: "in_progress" | "success" | "failure" | "unknown";
  } = {},
): DiagnosisIndependentApprovalInput & {
  ghcrImageAvailable?: boolean;
  dockerReleaseStatus?: "in_progress" | "success" | "failure" | "unknown";
} {
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
    now: Date.parse("2026-09-06T11:10:00.000Z"),
    ghcrImageAvailable: false,
    dockerReleaseStatus: "in_progress",
    ...over,
  };
}

function readinessClaim(
  over: Partial<DiagnosisP26_2HumanReadinessClaim> = {},
): DiagnosisP26_2HumanReadinessClaim {
  return {
    kind: DIAGNOSIS_P26_2_SIGNATURE_KIND,
    increment: "P26.2",
    schemaVersion: 1,
    candidateSha: FROZEN,
    liveSha: LIVE,
    approvalRecordsEvaluation: true,
    acceptsClientParam: false,
    acceptsModelOutput: false,
    confirmHuman: true,
    confirmCutoverReadinessOnly: true,
    confirmHistoricalP26_1Invalidated: true,
    confirmEvaluationOnly: true,
    confirmProductionReady: false,
    confirmNoLiveCutover: true,
    confirmDeliveryOwnsCutover: true,
    confirmLiveExecutorUndeployed: true,
    confirmGhcrNotAssumed: true,
    confirmCanaryTenant: DIAGNOSIS_P26_2_TENANT,
    signer: "Daniel / CEO",
    ...over,
  };
}

describe("P26.2 unified-window cutover readiness", () => {
  it("records I1-allow + GHCR-unproven after #992 and stays No-Go", async () => {
    // Historical snapshot update against current origin/main. No-Go unchanged.
    // The frozen 040e714c window is not current tip 643dcd6a4f. The allowlisted
    // remediation executor now resolves, so isolatedReadinessReady stays false.
    // GHCR remains unproven. This is not a production cutover.
    expect(DIAGNOSIS_PRODUCTION_SLO.completeness).not.toBe("complete");
    expect(DIAGNOSIS_P26_1_FROZEN_CANDIDATE_SHA).not.toBe(FROZEN);
    const report = await evaluateDiagnosisProductionP26_2(alignedInput());
    expect(report.isolatedReadinessReady).toBe(false);
    expect(report.humanReadinessRecorded).toBe(false);
    expect(report.acceptance.probesPassed).toBe(true);
    expect(report.forwardOnly).toBe(true);
    expect(report.ghcrImageAvailable).toBe(false);
    expect(report.dockerReleaseStatus).toBe("in_progress");
    expect(report.deliveryMayStage).toBe(false);
    expect(report.cutoverSwapExecuted).toBe(false);
    expect(report.historicalP26_1Invalidated).toBe(true);
    expect(report.mergedPrs).toEqual(DIAGNOSIS_P26_2_MERGED_PRS);
    expect(report.cutoverOwner).toBe(DIAGNOSIS_P26_2_CUTOVER_OWNER);
    expect(report.p26ProductionReady).toBe(false);
    expect(report.blockers).toContain("live_not_equal_candidate");
    expect(report.blockers).toContain("ghcr_image_unproven");
    expect(report.blockers).toContain("historical_p26_1_invalidated");
    expect(() => assertDiagnosisProductionP26_2Evaluated(report)).toThrow(DiagnosisContractError);
  });

  it("rejects ancestor reuse, assumed GHCR, client/model sources, and Production Ready", async () => {
    const stale = await evaluateDiagnosisProductionP26_2(
      alignedInput({ candidateSha: OTHER, originMainSha: OTHER }),
    );
    expect(stale.isolatedReadinessReady).toBe(false);
    expect(stale.exactIdentityMatch).toBe(false);
    const staged = await evaluateDiagnosisProductionP26_2(
      alignedInput({ ghcrImageAvailable: true, dockerReleaseStatus: "success" }),
    );
    expect(staged.deliveryMayStage).toBe(true);
    expect(staged.isolatedReadinessReady).toBe(false);
    expect(() => assertP26_2ReadinessSource({ clientParam: true })).toThrow(DiagnosisContractError);
    expect(() => assertP26_2ReadinessSource({ modelOutput: "ok" })).toThrow(DiagnosisContractError);
    const unsigned = await evaluateDiagnosisProductionP26_2(alignedInput());
    expect(() =>
      recordDiagnosisP26_2HumanReadiness(unsigned, readinessClaim({ liveSha: OTHER })),
    ).toThrow(DiagnosisContractError);
    expect(() =>
      recordDiagnosisP26_2HumanReadiness(
        unsigned,
        readinessClaim({ confirmProductionReady: true as unknown as false }),
      ),
    ).toThrow(DiagnosisContractError);
    await expect(
      evaluateDiagnosisProductionP26_2({
        ...alignedInput({ candidateSha: OTHER, originMainSha: OTHER }),
        humanReadiness: readinessClaim({ candidateSha: OTHER }),
      }),
    ).rejects.toBeInstanceOf(DiagnosisContractError);
  });

  it("does not scan as a live apply, Doctor --fix, or Production Ready declaration", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "production-p26.2.ts"),
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
    expect(DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA).not.toBe(
      "643dcd6a4f765b7a23da93f3f78821ad2e934929",
    );
  });
});
