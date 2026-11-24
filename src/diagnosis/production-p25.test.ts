import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { describe, expect, it } from "vitest";
import { DIAGNOSIS_ADMISSION_TENANT } from "./production-admission.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import { resolveProductionRemediationExecutor } from "./production-cutover.js";
import {
  DIAGNOSIS_P24_8_SIGNATURE_KIND,
  type DiagnosisP24_8HumanEnablementClaim,
} from "./production-p24.8.js";
import {
  DIAGNOSIS_P25_FROZEN_CANDIDATE_SHA,
  DIAGNOSIS_P25_FROZEN_LIVE_SHA,
  DIAGNOSIS_P25_SIGNATURE_KIND,
  assertDiagnosisProductionP25Ready,
  assertP25CanarySource,
  evaluateDiagnosisProductionP25,
  recordDiagnosisP25HumanCanary,
  resolveIsolatedP25RemediationExecutor,
  type DiagnosisP25HumanCanaryClaim,
} from "./production-p25.js";
import { DiagnosisContractError } from "./types.js";

const FROZEN = DIAGNOSIS_P25_FROZEN_CANDIDATE_SHA;
const LIVE = DIAGNOSIS_P25_FROZEN_LIVE_SHA;
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
    now: Date.parse("2026-09-06T08:20:00.000Z"),
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

function canaryClaim(
  over: Partial<DiagnosisP25HumanCanaryClaim> = {},
): DiagnosisP25HumanCanaryClaim {
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
    ...over,
  };
}

describe("P25 isolated governed remediation canary", () => {
  it("runs preview/execute/verify only with an allowlisted dry-run executor", () => {
    expect(() => resolveIsolatedP25RemediationExecutor()).toThrow(DiagnosisContractError);
    expect(
      resolveProductionRemediationExecutor({ allowlisted: true }).execute({
        actionType: "read_only_check",
        target: {
          schemaVersion: 1,
          targetType: "session",
          targetId: "session-a",
          tenantId: "tenant-fixture-a",
          authority: "session_store",
          scope: {},
        },
        remediationId: "rem-p25-gate-closed",
      }).ok,
    ).toBe(false);
    const report = evaluateDiagnosisProductionP25({
      ...alignedInput(),
      humanEnablement: enablementClaim(),
      humanCanary: canaryClaim(),
    });
    expect(report.isolatedCanaryReady).toBe(true);
    expect(report.humanCanaryRecorded).toBe(true);
    expect(report.canary.probesPassed).toBe(true);
    expect(report.canary.previewExecuteVerifyHeld).toBe(true);
    expect(report.canary.highRiskRequiresApproval).toBe(true);
    expect(report.canary.blockedRuntimeActionsHeld).toBe(true);
    expect(report.canary.failureKeepsAppliedFalse).toBe(true);
    expect(report.canary.appliedToRuntime).toBe(false);
    expect(report.canary.doctorFixBound).toBe(false);
    expect(report.liveExecutorUndeployed).toBe(true);
    expect(report.p25Started).toBe(true);
    expect(report.p26ProductionReady).toBe(false);
    expect(report.p24_8.p25Started).toBe(false);
    assertDiagnosisProductionP25Ready(report);
  });

  it("rejects ancestor reuse and client/model approval sources", () => {
    expect(() =>
      evaluateDiagnosisProductionP25({
        ...alignedInput({ candidateSha: OTHER, originMainSha: OTHER }),
        humanEnablement: { ...enablementClaim(), candidateSha: OTHER },
        humanCanary: canaryClaim({ candidateSha: OTHER }),
      }),
    ).toThrow(DiagnosisContractError);
    expect(() => assertP25CanarySource({ clientParam: true })).toThrow(DiagnosisContractError);
    expect(() => assertP25CanarySource({ modelOutput: "ok" })).toThrow(DiagnosisContractError);
    const unsigned = evaluateDiagnosisProductionP25({
      ...alignedInput(),
      humanEnablement: enablementClaim(),
    });
    expect(() => recordDiagnosisP25HumanCanary(unsigned, canaryClaim({ liveSha: OTHER }))).toThrow(
      DiagnosisContractError,
    );
  });

  it("does not scan as a live apply, Doctor --fix, or P26 start", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "production-p25.ts"),
      "utf8",
    );
    expect(source).toContain("Does not bind Doctor --fix");
    expect(source).toContain("p26ProductionReady: false");
    expect(source).not.toContain("runDoctorChecks");
    expect(source).not.toContain("doctor --fix");
    expect(source).not.toContain("restartChannel");
    expect(source).not.toContain("writeConfigFile");
    expect(source).not.toContain("applyGovernanceRuntimeAction");
  });
});

// These historical cutover / functional rehearsals explicitly opt into writes
// against injected local ports. Default-closed behavior is covered separately
// in write-policy.test.ts; this is not production enablement.
vi.mock("./write-policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./write-policy.js")>();
  return {
    ...actual,
    DIAGNOSIS_WRITE_POLICY: {
      selfEvolutionConfirm: true,
      conversationDelivery: true,
      daibaiDelivery: true,
    },
  };
});
