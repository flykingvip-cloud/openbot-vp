import { describe, expect, it } from "vitest";
import { coreGatewayHandlers } from "../gateway/server-methods.js";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import { DIAGNOSIS_ADMISSION_TENANT } from "./production-admission.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import {
  DIAGNOSIS_CANARY_POLICY,
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
import { isApprovedEnablementPrefixOpen } from "./production-enablement-sequence.js";
import {
  DIAGNOSIS_P24_7_FROZEN_CANDIDATE_SHA,
  DIAGNOSIS_P24_7_FROZEN_LIVE_SHA,
  DIAGNOSIS_P24_7_SIGNATURE_KIND,
  assertP24_7EnablementSource,
  evaluateDiagnosisProductionP24_7,
  recordDiagnosisP24_7HumanEnablement,
  type DiagnosisP24_7HumanEnablementClaim,
} from "./production-p24.7.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import { DiagnosisContractError } from "./types.js";

const FROZEN = DIAGNOSIS_P24_7_FROZEN_CANDIDATE_SHA;
const LIVE = DIAGNOSIS_P24_7_FROZEN_LIVE_SHA;
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
    now: Date.parse("2026-09-06T06:30:00.000Z"),
    ...over,
  };
}

function enablementClaim(
  over: Partial<DiagnosisP24_7HumanEnablementClaim> = {},
): DiagnosisP24_7HumanEnablementClaim {
  return {
    kind: DIAGNOSIS_P24_7_SIGNATURE_KIND,
    increment: "P24.7",
    schemaVersion: 1,
    candidateSha: FROZEN,
    liveSha: LIVE,
    approvalOpensReportApiGate: true,
    acceptsClientParam: false,
    acceptsModelOutput: false,
    confirmHuman: true,
    confirmReportApiOnlyThisIncrement: true,
    confirmCanaryTenant: DIAGNOSIS_ADMISSION_TENANT,
    signer: "Daniel / CEO",
    subjects: [
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
      {
        subject: "gate",
        subjectId: "DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED",
        signer: "Daniel / CEO",
        signed: true,
        decision: "approve",
        valueAfterApproval: false,
      },
    ],
    ...over,
  };
}

describe("P24.7 report API enablement pack", () => {
  it("historically opened report API; later increments may add remediation", () => {
    expect(isApprovedEnablementPrefixOpen()).toBe(false);
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
    expect(DIAGNOSIS_CANARY_POLICY.firstStage).toBe("internal_single_tenant");
    expect(GATEWAY_METHOD_PACKS.find((pack) => pack.id === "diagnosis-reports")).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.query"]).toBeDefined();
  });

  it("records Daniel/CEO enablement only on an exact candidate and LIVE match", () => {
    const report = evaluateDiagnosisProductionP24_7({
      ...alignedInput(),
      humanEnablement: enablementClaim(),
    });
    expect(report.exactIdentityMatch).toBe(true);
    expect(report.humanEnablementRecorded).toBe(true);
    expect(report.reportApiEnabled).toBe(true);
    expect(report.prefixOpen).toBe(false);
    expect(report.nextStep).toBe("remediationExecution");
    expect(report.p25Started).toBe(false);
  });

  it("rejects ancestor reuse and client/model approval sources", () => {
    expect(() =>
      evaluateDiagnosisProductionP24_7({
        ...alignedInput({ candidateSha: OTHER, originMainSha: OTHER }),
        humanEnablement: enablementClaim({ candidateSha: OTHER }),
      }),
    ).toThrow(DiagnosisContractError);
    expect(() => assertP24_7EnablementSource({ clientParam: true })).toThrow(
      DiagnosisContractError,
    );
    expect(() => assertP24_7EnablementSource({ modelOutput: "ok" })).toThrow(
      DiagnosisContractError,
    );
    const unsigned = evaluateDiagnosisProductionP24_7(alignedInput());
    expect(() =>
      recordDiagnosisP24_7HumanEnablement(unsigned, enablementClaim({ liveSha: OTHER })),
    ).toThrow(DiagnosisContractError);
    expect(() =>
      recordDiagnosisP24_7HumanEnablement(
        unsigned,
        enablementClaim({
          subjects: enablementClaim().subjects.map((row) =>
            row.subjectId === "DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED"
              ? { ...row, valueAfterApproval: true }
              : row,
          ),
        }),
      ),
    ).toThrow(DiagnosisContractError);
  });
});
