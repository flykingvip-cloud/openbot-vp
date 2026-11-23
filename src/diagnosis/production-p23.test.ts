import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { describe, expect, it } from "vitest";
import { coreGatewayHandlers } from "../gateway/server-methods.js";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
import {
  DIAGNOSIS_P22_REQUIRED_ROLES,
  DIAGNOSIS_P22_SIGNATURE_KIND,
  freezeDiagnosisP22ApprovalGates,
  type DiagnosisP22HumanApprovalClaim,
} from "./production-p22.js";
import {
  DIAGNOSIS_P23_TENANT,
  DIAGNOSIS_PRODUCTION_P23_INCREMENT,
  assertDiagnosisProductionP23Closed,
  evaluateDiagnosisProductionP23,
  renderDiagnosisProductionP23Markdown,
} from "./production-p23.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";

const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const here = path.dirname(fileURLToPath(import.meta.url));

function alignedInput(
  over: Partial<DiagnosisIndependentApprovalInput> = {},
): DiagnosisIndependentApprovalInput {
  return {
    candidateSha: SHA_A,
    originMainSha: SHA_A,
    liveSha: SHA_A,
    liveSource: "container",
    releaseRecordSha: SHA_A,
    ledgerOpenShas: [SHA_A],
    provenanceTagSha: SHA_A,
    originMainIsAncestorOfCandidate: true,
    liveIsAncestorOfCandidate: true,
    originMainContainsLive: true,
    livePackRegistered: false,
    coreHandlerHasDiagnosis: false,
    readerAvailable: false,
    auditAvailable: false,
    quotaAvailable: false,
    now: Date.parse("2026-09-05T06:30:00.000Z"),
    ...over,
  };
}

function humanClaim(
  over: Partial<DiagnosisP22HumanApprovalClaim> = {},
): DiagnosisP22HumanApprovalClaim {
  const signer = "Daniel / CEO";
  return {
    kind: DIAGNOSIS_P22_SIGNATURE_KIND,
    increment: "P22",
    schemaVersion: 1,
    candidateSha: SHA_A,
    liveSha: SHA_A,
    approvalDoesNotOpenGate: true,
    acceptsClientParam: false,
    acceptsModelOutput: false,
    confirmHuman: true,
    confirmDoesNotOpenGate: true,
    confirmDoesNotStartP23: true,
    subjects: [
      ...DIAGNOSIS_P22_REQUIRED_ROLES.map((role) => ({
        subject: "role" as const,
        subjectId: role,
        signer,
        signed: true as const,
        decision: "approve" as const,
      })),
      ...freezeDiagnosisP22ApprovalGates().map((gate) => ({
        subject: "gate" as const,
        subjectId: gate.name,
        signer,
        signed: true as const,
        decision: "approve" as const,
        valueAfterApproval: false as const,
      })),
    ],
    ...over,
  };
}

describe("P23 isolated single-tenant canary", () => {
  it("is No-Go until P22 human approval is recorded", async () => {
    const report = await evaluateDiagnosisProductionP23(alignedInput());
    expect(report.isolatedCanaryReady).toBe(false);
    expect(report.p22HumanApprovalRecorded).toBe(false);
    expect(report.approvedForProductionCutover).toBe(false);
    expect(report.productionCanaryStarted).toBe(false);
    expect(report.p24Started).toBe(false);
    expect(renderDiagnosisProductionP23Markdown(report)).toContain("No-Go");
    expect(() => assertDiagnosisProductionP23Closed(report)).not.toThrow();
  });

  it("passes the isolated canary after recorded approval without opening gates", async () => {
    const report = await evaluateDiagnosisProductionP23({
      ...alignedInput(),
      humanApproval: humanClaim(),
    });
    expect(report.increment).toBe(DIAGNOSIS_PRODUCTION_P23_INCREMENT);
    expect(report.isolatedCanaryReady).toBe(true);
    expect(report.p22HumanApprovalRecorded).toBe(true);
    expect(report.canary.tenant).toBe(DIAGNOSIS_P23_TENANT);
    expect(report.canary.statusesPassed).toBe(true);
    expect(report.canary.redacted).toBe(true);
    expect(report.canary.tenantIsolationHeld).toBe(true);
    expect(report.canary.limitedTraffic.withinLimit).toBe(true);
    expect(report.productionPackPreview.outcome).toBe("reject");
    expect(report.productionPackPreview.reason).toBe("auth_missing");
    expect(report.isolatedPackPreview.outcome).toBe("candidate");
    expect(report.isolatedPackPreview.wouldRegister).toBe(false);
    expect(report.approvedForProductionCutover).toBe(false);
    expect(report.gatesOpened).toBe(false);
    expect(report.productionCanaryStarted).toBe(false);
    expect(report.livePackRegistered).toBe(false);
    expect(report.p24Started).toBe(false);
    expect(report.slo.completeness).toBe("complete");
    expect(renderDiagnosisProductionP23Markdown(report)).toContain("Production gates stay closed");
    expect(() => assertDiagnosisProductionP23Closed(report)).not.toThrow();
  });

  it("carries a recorded P22 signature when the signed candidate is an ancestor", async () => {
    const report = await evaluateDiagnosisProductionP23({
      ...alignedInput({
        candidateSha: SHA_B,
        originMainSha: SHA_B,
      }),
      humanApproval: humanClaim(),
      signedCandidateIsAncestorOfCurrent: true,
    });
    expect(report.isolatedCanaryReady).toBe(true);
    expect(report.p22HumanApprovalRecorded).toBe(true);
    expect(report.p24Started).toBe(false);
    expect(report.approvedForProductionCutover).toBe(false);
    await expect(
      evaluateDiagnosisProductionP23({
        ...alignedInput({
          candidateSha: SHA_B,
          originMainSha: SHA_B,
        }),
        humanApproval: humanClaim(),
      }),
    ).rejects.toThrow();
  });

  it("rejects a canary bound to a diverged identity", async () => {
    await expect(
      evaluateDiagnosisProductionP23({
        ...alignedInput({ liveSha: SHA_A, ledgerOpenShas: [SHA_B] }),
        humanApproval: humanClaim(),
      }),
    ).rejects.toThrow();
  });

  it("does not scan as a live enablement, pack registration, or P24 start", () => {
    const source = fs.readFileSync(path.join(here, "production-p23.ts"), "utf8");
    expect(source).not.toContain("DIAGNOSIS_REPORT_API_DEPLOYED = true");
    expect(source).not.toContain("DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED = true");
    expect(source).not.toContain("GATEWAY_METHOD_PACKS.push");
    expect(source).not.toContain("user.daibai.ask");
    expect(source).not.toContain("--fix");
    expect(source).not.toContain("releases.jsonl");
    expect(source).not.toContain("RELEASE_RECORD.md");
    expect(GATEWAY_METHOD_PACKS.find((pack) => pack.id === "diagnosis-reports")).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.query"]).toBeDefined();
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
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
