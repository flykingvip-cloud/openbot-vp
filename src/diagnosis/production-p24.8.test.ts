import { describe, expect, it } from "vitest";
import { coreGatewayHandlers } from "../gateway/server-methods.js";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import { DIAGNOSIS_ADMISSION_TENANT } from "./production-admission.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import {
  DIAGNOSIS_CANARY_POLICY,
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
  resolveProductionRemediationExecutor,
} from "./production-cutover.js";
import {
  isApprovedEnablementPrefixOpen,
  nextEnablementStep,
} from "./production-enablement-sequence.js";
import {
  DIAGNOSIS_P24_8_FROZEN_CANDIDATE_SHA,
  DIAGNOSIS_P24_8_FROZEN_LIVE_SHA,
  DIAGNOSIS_P24_8_SIGNATURE_KIND,
  assertP24_8EnablementSource,
  evaluateDiagnosisProductionP24_8,
  recordDiagnosisP24_8HumanEnablement,
  type DiagnosisP24_8HumanEnablementClaim,
} from "./production-p24.8.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import { DiagnosisContractError } from "./types.js";

const FROZEN = DIAGNOSIS_P24_8_FROZEN_CANDIDATE_SHA;
const LIVE = DIAGNOSIS_P24_8_FROZEN_LIVE_SHA;
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
    now: Date.parse("2026-09-06T07:50:00.000Z"),
    ...over,
  };
}

function enablementClaim(
  over: Partial<DiagnosisP24_8HumanEnablementClaim> = {},
): DiagnosisP24_8HumanEnablementClaim {
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
    ...over,
  };
}

describe("P24.8 remediation enablement pack", () => {
  it("opens read-only report path; Da Bai open (Path B), remediation stay fail-closed", () => {
    expect(isApprovedEnablementPrefixOpen()).toBe(false);
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(nextEnablementStep()).toBe("remediationExecution");
    expect(DIAGNOSIS_CANARY_POLICY.firstStage).toBe("internal_single_tenant");
    expect(GATEWAY_METHOD_PACKS.find((pack) => pack.id === "diagnosis-reports")).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.query"]).toBeDefined();
    expect(
      resolveProductionRemediationExecutor().execute({
        actionType: "read_only_check",
        target: {
          schemaVersion: 1,
          targetType: "session",
          targetId: "session-a",
          tenantId: "tenant-fixture-a",
          authority: "session_store",
          scope: {},
        },
        remediationId: "rem-p24-8-gate-closed",
      }).ok,
    ).toBe(false);
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
        remediationId: "rem-p24-8-gate-closed-allowlisted",
      }).ok,
    ).toBe(false);
  });

  it("records Daniel/CEO enablement only on an exact candidate and LIVE match", () => {
    const report = evaluateDiagnosisProductionP24_8({
      ...alignedInput({ livePackRegistered: false }),
      humanEnablement: enablementClaim(),
    });
    expect(report.exactIdentityMatch).toBe(true);
    expect(report.humanEnablementRecorded).toBe(true);
    expect(report.remediationEnabled).toBe(false);
    expect(report.liveExecutorUndeployed).toBe(true);
    expect(report.prefixOpen).toBe(false);
    expect(report.nextStep).toBe("remediationExecution");
    expect(report.p25Started).toBe(false);
  });

  it("rejects ancestor reuse and client/model approval sources", () => {
    expect(() =>
      evaluateDiagnosisProductionP24_8({
        ...alignedInput({ candidateSha: OTHER, originMainSha: OTHER }),
        humanEnablement: enablementClaim({ candidateSha: OTHER }),
      }),
    ).toThrow(DiagnosisContractError);
    expect(() => assertP24_8EnablementSource({ clientParam: true })).toThrow(
      DiagnosisContractError,
    );
    expect(() => assertP24_8EnablementSource({ modelOutput: "ok" })).toThrow(
      DiagnosisContractError,
    );
    const unsigned = evaluateDiagnosisProductionP24_8(alignedInput());
    expect(() =>
      recordDiagnosisP24_8HumanEnablement(unsigned, enablementClaim({ liveSha: OTHER })),
    ).toThrow(DiagnosisContractError);
    expect(() =>
      recordDiagnosisP24_8HumanEnablement(
        unsigned,
        enablementClaim({
          subjects: enablementClaim().subjects.map((row) =>
            row.subjectId === "DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED"
              ? { ...row, valueAfterApproval: false as unknown as true }
              : row,
          ),
        }),
      ),
    ).toThrow(DiagnosisContractError);
  });
});
