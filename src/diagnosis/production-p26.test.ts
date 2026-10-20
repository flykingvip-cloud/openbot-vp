import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DIAGNOSIS_ADMISSION_TENANT } from "./production-admission.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import { DIAGNOSIS_PRODUCTION_SLO } from "./production-cutover.js";
import {
  DIAGNOSIS_P24_8_SIGNATURE_KIND,
  type DiagnosisP24_8HumanEnablementClaim,
} from "./production-p24.8.js";
import {
  DIAGNOSIS_P25_SIGNATURE_KIND,
  type DiagnosisP25HumanCanaryClaim,
} from "./production-p25.js";
import {
  DIAGNOSIS_P26_FROZEN_CANDIDATE_SHA,
  DIAGNOSIS_P26_FROZEN_LIVE_SHA,
  DIAGNOSIS_P26_SIGNATURE_KIND,
  assertDiagnosisProductionP26Evaluated,
  assertP26AcceptanceSource,
  evaluateDiagnosisProductionP26,
  recordDiagnosisP26HumanAcceptance,
  type DiagnosisP26HumanAcceptanceClaim,
} from "./production-p26.js";
import { DiagnosisContractError } from "./types.js";

const FROZEN = DIAGNOSIS_P26_FROZEN_CANDIDATE_SHA;
const LIVE = DIAGNOSIS_P26_FROZEN_LIVE_SHA;
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
    livePackRegistered: false,
    coreHandlerHasDiagnosis: false,
    readerAvailable: false,
    auditAvailable: false,
    quotaAvailable: false,
    now: Date.parse("2026-09-06T08:40:00.000Z"),
    ...over,
  };
}

function enablementClaim(): DiagnosisP24_8HumanEnablementClaim {
  return {
    kind: DIAGNOSIS_P24_8_SIGNATURE_KIND,
    increment: "P24.8",
    schemaVersion: 1,
    candidateSha: FROZEN,
    liveSha: LIVE,
    approvalOpensRemediationGate: true,
    acceptsClientParam: false,
    acceptsModelOutput: false,
    confirmHuman: true,
    confirmRemediationOnlyThisIncrement: true,
    confirmLiveExecutorUndeployed: true,
    confirmP25NotStarted: true,
    confirmCanaryTenant: DIAGNOSIS_ADMISSION_TENANT,
    signer: "Daniel / CEO",
    subjects: [
      {
        subject: "gate",
        subjectId: "DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED",
        signer: "Daniel / CEO",
        signed: true,
        decision: "approve",
        valueAfterApproval: true,
      },
      {
        subject: "gate",
        subjectId: "DIAGNOSIS_REPORT_API_DEPLOYED",
        signer: "Daniel / CEO",
        signed: true,
        decision: "approve",
        valueAfterApproval: true,
      },
      {
        subject: "gate",
        subjectId: "DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED",
        signer: "Daniel / CEO",
        signed: true,
        decision: "approve",
        valueAfterApproval: true,
      },
      {
        subject: "gate",
        subjectId: "DIAGNOSIS_DAIBAI_DELIVERY_ENABLED",
        signer: "Daniel / CEO",
        signed: true,
        decision: "approve",
        valueAfterApproval: true,
      },
    ],
  };
}

function canaryClaim(): DiagnosisP25HumanCanaryClaim {
  return {
    kind: DIAGNOSIS_P25_SIGNATURE_KIND,
    increment: "P25",
    schemaVersion: 1,
    candidateSha: FROZEN,
    liveSha: LIVE,
    approvalStartsIsolatedCanary: true,
    acceptsClientParam: false,
    acceptsModelOutput: false,
    confirmHuman: true,
    confirmIsolatedAllowlistedDryRunOnly: true,
    confirmLiveExecutorUndeployed: true,
    confirmNoDoctorFix: true,
    confirmNoChannelRestart: true,
    confirmP26NotStarted: true,
    confirmCanaryTenant: DIAGNOSIS_ADMISSION_TENANT,
    signer: "Daniel / CEO",
  };
}

function acceptanceClaim(
  over: Partial<DiagnosisP26HumanAcceptanceClaim> = {},
): DiagnosisP26HumanAcceptanceClaim {
  return {
    kind: DIAGNOSIS_P26_SIGNATURE_KIND,
    increment: "P26",
    schemaVersion: 1,
    candidateSha: FROZEN,
    liveSha: LIVE,
    approvalRecordsEvaluation: true,
    acceptsClientParam: false,
    acceptsModelOutput: false,
    confirmHuman: true,
    confirmEvaluationOnly: true,
    confirmProductionReady: false,
    confirmNoLiveCutover: true,
    confirmLiveExecutorUndeployed: true,
    confirmCanaryTenant: DIAGNOSIS_ADMISSION_TENANT,
    signer: "Daniel / CEO",
    ...over,
  };
}

describe("P26 closed-loop acceptance", () => {
  it("evaluates the official chain and stays No-Go for Production Ready", async () => {
    expect(DIAGNOSIS_PRODUCTION_SLO.completeness).not.toBe("complete");
    const report = await evaluateDiagnosisProductionP26({
      ...alignedInput(),
      humanEnablement: enablementClaim(),
      humanCanary: canaryClaim(),
      humanAcceptance: acceptanceClaim(),
    });
    expect(report.isolatedAcceptanceReady).toBe(true);
    expect(report.humanAcceptanceRecorded).toBe(true);
    expect(report.acceptance.probesPassed).toBe(true);
    expect(report.acceptance.chainHeld).toBe(true);
    expect(report.acceptance.roleMatrixHeld).toBe(true);
    expect(report.acceptance.crossTenantHeld).toBe(true);
    expect(report.p26Evaluated).toBe(true);
    expect(report.p26ProductionReady).toBe(false);
    expect(report.liveEqualsCandidate).toBe(true);
    expect(report.productionSloComplete).toBe(false);
    expect(report.blockers).not.toContain("live_not_equal_candidate");
    expect(report.blockers).toContain("production_slo_empty");
    expect(report.blockers).toContain("live_cutover_pending");
    expect(report.p25.p26ProductionReady).toBe(false);
    assertDiagnosisProductionP26Evaluated(report);
  });

  it("rejects ancestor reuse, client/model sources, and Production Ready claims", async () => {
    await expect(
      evaluateDiagnosisProductionP26({
        ...alignedInput({ candidateSha: OTHER, originMainSha: OTHER }),
        humanEnablement: { ...enablementClaim(), candidateSha: OTHER },
        humanCanary: { ...canaryClaim(), candidateSha: OTHER },
        humanAcceptance: acceptanceClaim({ candidateSha: OTHER }),
      }),
    ).rejects.toBeInstanceOf(DiagnosisContractError);
    expect(() => assertP26AcceptanceSource({ clientParam: true })).toThrow(DiagnosisContractError);
    expect(() => assertP26AcceptanceSource({ modelOutput: "ok" })).toThrow(DiagnosisContractError);
    const unsigned = await evaluateDiagnosisProductionP26({
      ...alignedInput(),
      humanEnablement: enablementClaim(),
      humanCanary: canaryClaim(),
    });
    expect(() =>
      recordDiagnosisP26HumanAcceptance(unsigned, acceptanceClaim({ liveSha: OTHER })),
    ).toThrow(DiagnosisContractError);
    expect(() =>
      recordDiagnosisP26HumanAcceptance(
        unsigned,
        acceptanceClaim({ confirmProductionReady: true as unknown as false }),
      ),
    ).toThrow(DiagnosisContractError);
  });

  it("does not scan as a live apply, Doctor --fix, or Production Ready declaration", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "production-p26.ts"),
      "utf8",
    );
    expect(source).toContain("Does not bind Doctor --fix");
    expect(source).toContain("p26ProductionReady: false");
    expect(source).toContain("Approval never auto-declares Production Ready");
    expect(source).not.toContain("runDoctorChecks");
    expect(source).not.toContain("doctor --fix");
    expect(source).not.toContain("restartChannel");
  });
});
