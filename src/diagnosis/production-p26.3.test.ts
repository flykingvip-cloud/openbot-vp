import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import { DIAGNOSIS_PRODUCTION_SLO } from "./production-cutover.js";
import { DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA } from "./production-p26.2.js";
import {
  DIAGNOSIS_P26_3_CUTOVER_OWNER,
  DIAGNOSIS_P26_3_FROZEN_CANDIDATE_SHA,
  DIAGNOSIS_P26_3_FROZEN_LIVE_SHA,
  DIAGNOSIS_P26_3_MERGED_PRS,
  DIAGNOSIS_P26_3_NEXT_OFFICIAL_STEP,
  DIAGNOSIS_P26_3_SIGNATURE_KIND,
  DIAGNOSIS_P26_3_TENANT,
  assertDiagnosisProductionP26_3Evaluated,
  assertP26_3HoldSource,
  evaluateDiagnosisProductionP26_3,
  recordDiagnosisP26_3HumanHold,
  type DiagnosisP26_3HumanHoldClaim,
} from "./production-p26.3.js";
import { DiagnosisContractError } from "./types.js";

const FROZEN = DIAGNOSIS_P26_3_FROZEN_CANDIDATE_SHA;
const LIVE = DIAGNOSIS_P26_3_FROZEN_LIVE_SHA;
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
    now: Date.parse("2026-09-06T12:00:00.000Z"),
    ghcrImageAvailable: false,
    dockerReleaseStatus: "in_progress",
    ...over,
  };
}

function holdClaim(over: Partial<DiagnosisP26_3HumanHoldClaim> = {}): DiagnosisP26_3HumanHoldClaim {
  return {
    kind: DIAGNOSIS_P26_3_SIGNATURE_KIND,
    increment: "P26.3",
    schemaVersion: 1,
    candidateSha: FROZEN,
    liveSha: LIVE,
    approvalRecordsEvaluation: true,
    acceptsClientParam: false,
    acceptsModelOutput: false,
    confirmHuman: true,
    confirmCutoverHoldOnly: true,
    confirmHistoricalP26_2Invalidated: true,
    confirmAncestorImageNotCandidate: true,
    confirmNoFurtherDiagnosisResignUntilCutover: true,
    confirmEvaluationOnly: true,
    confirmProductionReady: false,
    confirmNoLiveCutover: true,
    confirmDeliveryOwnsCutover: true,
    confirmLiveExecutorUndeployed: true,
    confirmGhcrNotAssumed: true,
    confirmCanaryTenant: DIAGNOSIS_P26_3_TENANT,
    signer: "Daniel / CEO",
    ...over,
  };
}

describe("P26.3 unified-window cutover hold", () => {
  it("holds after #993, forbids the 040e714c image, and stays No-Go", async () => {
    expect(DIAGNOSIS_PRODUCTION_SLO.completeness).not.toBe("complete");
    expect(DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA).not.toBe(FROZEN);
    const report = await evaluateDiagnosisProductionP26_3({
      ...alignedInput(),
      humanHold: holdClaim(),
    });
    expect(report.isolatedHoldReady).toBe(true);
    expect(report.humanHoldRecorded).toBe(true);
    expect(report.acceptance.probesPassed).toBe(true);
    expect(report.forwardOnly).toBe(true);
    expect(report.ghcrImageAvailable).toBe(false);
    expect(report.deliveryMayStage).toBe(false);
    expect(report.ancestorImageSha).toBe(DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA);
    expect(report.ancestorImageForbiddenAsCandidate).toBe(true);
    expect(report.furtherDiagnosisResignBlocked).toBe(true);
    expect(report.nextOfficialStep).toBe(DIAGNOSIS_P26_3_NEXT_OFFICIAL_STEP);
    expect(report.mergedPrs).toEqual(DIAGNOSIS_P26_3_MERGED_PRS);
    expect(report.cutoverOwner).toBe(DIAGNOSIS_P26_3_CUTOVER_OWNER);
    expect(report.p26ProductionReady).toBe(false);
    expect(report.blockers).toContain("ancestor_image_not_candidate");
    expect(report.blockers).toContain("further_diagnosis_resign_blocked");
    expect(report.blockers).toContain("ghcr_image_unproven");
    assertDiagnosisProductionP26_3Evaluated(report);
  });

  it("rejects ancestor image reuse, assumed GHCR, client/model sources, and Production Ready", async () => {
    await expect(
      evaluateDiagnosisProductionP26_3(
        alignedInput({
          candidateSha: DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA,
          originMainSha: DIAGNOSIS_P26_2_FROZEN_CANDIDATE_SHA,
        }),
      ),
    ).rejects.toBeInstanceOf(DiagnosisContractError);
    const stale = await evaluateDiagnosisProductionP26_3(
      alignedInput({ candidateSha: OTHER, originMainSha: OTHER }),
    );
    expect(stale.isolatedHoldReady).toBe(false);
    const staged = await evaluateDiagnosisProductionP26_3(
      alignedInput({ ghcrImageAvailable: true, dockerReleaseStatus: "success" }),
    );
    expect(staged.deliveryMayStage).toBe(true);
    expect(staged.isolatedHoldReady).toBe(false);
    expect(() => assertP26_3HoldSource({ clientParam: true })).toThrow(DiagnosisContractError);
    expect(() => assertP26_3HoldSource({ modelOutput: "ok" })).toThrow(DiagnosisContractError);
    const unsigned = await evaluateDiagnosisProductionP26_3(alignedInput());
    expect(() => recordDiagnosisP26_3HumanHold(unsigned, holdClaim({ liveSha: OTHER }))).toThrow(
      DiagnosisContractError,
    );
    expect(() =>
      recordDiagnosisP26_3HumanHold(
        unsigned,
        holdClaim({ confirmProductionReady: true as unknown as false }),
      ),
    ).toThrow(DiagnosisContractError);
  });

  it("does not scan as a live apply, Doctor --fix, or Production Ready declaration", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "production-p26.3.ts"),
      "utf8",
    );
    expect(source).toContain("Does not bind Doctor --fix");
    expect(source).toContain("p26ProductionReady: false");
    expect(source).toContain("Delivery owns cutover");
    expect(source).not.toContain("runDoctorChecks");
    expect(source).not.toContain("doctor --fix");
    expect(source).not.toContain("restartChannel");
  });
});
