import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  DIAGNOSIS_UNIFIED_LOCK_INCREMENT,
  DIAGNOSIS_UNIFIED_LOCK_OWNER,
  assertDiagnosisUnifiedLockClosed,
  evaluateDiagnosisUnifiedLock,
  renderDiagnosisUnifiedLockMarkdown,
} from "./production-unified-lock.js";
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
    liveSha: SHA_B,
    liveSource: "container",
    releaseRecordSha: SHA_B,
    ledgerOpenShas: [SHA_B],
    provenanceTagSha: SHA_B,
    originMainIsAncestorOfCandidate: true,
    liveIsAncestorOfCandidate: true,
    originMainContainsLive: true,
    livePackRegistered: false,
    coreHandlerHasDiagnosis: false,
    readerAvailable: false,
    auditAvailable: false,
    quotaAvailable: false,
    now: Date.parse("2026-09-05T11:30:00.000Z"),
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
    liveSha: SHA_B,
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

function passingLockOver() {
  return {
    p242PresentOnOriginMain: true,
    pr976Merged: true,
    pr976MergeSha: SHA_A,
    forwardOnly: { name: "forward_only", passed: true, exitCode: 0, detail: "LIVE ancestor" },
    deliveryAlignment: {
      name: "delivery_alignment",
      passed: true,
      exitCode: 0,
      detail: "OK with warnings",
    },
    preflight: {
      name: "production_preflight",
      passed: false,
      exitCode: 2,
      detail: "standalone fail-closed; not live health",
    },
    convergence: {
      name: "trunk_convergence",
      passed: true,
      exitCode: 0,
      detail: "identity aligned",
    },
    cutoverPlanObserved: true,
    cutoverSwapExecuted: false,
    ghcrImageAvailable: false,
  };
}

describe("P24.3 unified-window lock and verify-live", () => {
  it("stays No-Go until P24.2 is on origin/main", async () => {
    const report = await evaluateDiagnosisUnifiedLock({
      ...alignedInput(),
      humanApproval: humanClaim(),
    });
    expect(report.unifiedWindowLocked).toBe(false);
    expect(report.verifyLiveFailedStopEnablement).toBe(true);
    expect(report.gatesOpened).toBe(false);
    expect(renderDiagnosisUnifiedLockMarkdown(report)).toContain("No-Go");
    expect(() => assertDiagnosisUnifiedLockClosed(report)).not.toThrow();
  });

  it("locks the unified window without swapping LIVE or opening gates", async () => {
    const report = await evaluateDiagnosisUnifiedLock({
      ...alignedInput(),
      humanApproval: humanClaim(),
      signedCandidateIsAncestorOfCurrent: true,
      ...passingLockOver(),
    });
    expect(report.increment).toBe(DIAGNOSIS_UNIFIED_LOCK_INCREMENT);
    expect(report.unifiedWindowLocked).toBe(true);
    expect(report.candidateEqualsOriginMain).toBe(true);
    expect(report.cutoverOwner).toBe(DIAGNOSIS_UNIFIED_LOCK_OWNER);
    expect(report.diagnosisOnlyCutover).toBe(false);
    expect(report.cutoverSwapExecuted).toBe(false);
    expect(report.verifyLivePassed).toBe(false);
    expect(report.verifyLiveFailedStopEnablement).toBe(true);
    expect(report.enablementBlocked).toBe(true);
    expect(report.gatesOpened).toBe(false);
    expect(report.productionWrite).toBe(false);
    expect(report.liveConnected).toBe(false);
    expect(report.daibaiUnconnected).toBe(false);
    expect(report.conversationUnconnected).toBe(false);
    expect(report.remediationUnconnected).toBe(true);
    expect(report.livePackRegistered).toBe(false);
    expect(report.coreGatewayHasDiagnosisMethods).toBe(false);
    expect(report.p25Started).toBe(false);
    expect(report.p26ProductionReady).toBe(false);
    expect(report.diagnosisPlatformComplete).toBe(false);
    expect(report.standalonePreflightNotLiveHealth).toBe(true);
    expect(renderDiagnosisUnifiedLockMarkdown(report)).toContain("Enablement stopped");
    expect(() => assertDiagnosisUnifiedLockClosed(report)).not.toThrow();
  });

  it("keeps a P22 signature after official LIVE moves to candidate", async () => {
    const report = await evaluateDiagnosisUnifiedLock({
      ...alignedInput({
        liveSha: SHA_A,
        releaseRecordSha: SHA_A,
        ledgerOpenShas: [SHA_A],
        provenanceTagSha: SHA_A,
      }),
      humanApproval: humanClaim(),
      signedCandidateIsAncestorOfCurrent: true,
      signedLiveIsAncestorOfCurrent: true,
      ...passingLockOver(),
      verifyLive: {
        ran: true,
        passed: true,
        buildInfoMatches: true,
        healthzOk: true,
        readyzOk: true,
        gatewayUiSameIdentity: true,
        ledgerReleaseProvenanceConsistent: true,
        detail: "delivery verify-live PASS after official swap",
      },
    });
    expect(report.unifiedWindowLocked).toBe(true);
    expect(report.verifyLivePassed).toBe(true);
    expect(report.liveSha).toBe(SHA_A);
    expect(report.gatesOpened).toBe(false);
    expect(report.enablementBlocked).toBe(true);
    expect(report.diagnosisPlatformComplete).toBe(false);
  });

  it("treats verify-live pass as publication only", async () => {
    const report = await evaluateDiagnosisUnifiedLock({
      ...alignedInput(),
      humanApproval: humanClaim(),
      signedCandidateIsAncestorOfCurrent: true,
      ...passingLockOver(),
      verifyLive: {
        ran: true,
        passed: true,
        buildInfoMatches: true,
        healthzOk: true,
        readyzOk: true,
        gatewayUiSameIdentity: true,
        ledgerReleaseProvenanceConsistent: true,
        detail: "delivery verify-live PASS",
      },
    });
    expect(report.unifiedWindowLocked).toBe(true);
    expect(report.verifyLivePassed).toBe(true);
    expect(report.verifyLiveFailedStopEnablement).toBe(false);
    expect(report.gatesOpened).toBe(false);
    expect(report.enablementBlocked).toBe(true);
    expect(report.diagnosisPlatformComplete).toBe(false);
    expect(renderDiagnosisUnifiedLockMarkdown(report)).toContain("verify-live PASS");
    expect(() => assertDiagnosisUnifiedLockClosed(report)).not.toThrow();
  });

  it("refuses a diagnosis-owned live swap", async () => {
    await expect(
      evaluateDiagnosisUnifiedLock({
        ...alignedInput(),
        humanApproval: humanClaim(),
        cutoverSwapExecuted: true,
      }),
    ).rejects.toThrow(/must not execute the live container swap/);
  });

  it("does not scan as a live enablement, diagnosis-only cutover, or P25 start", () => {
    const source = fs.readFileSync(path.join(here, "production-unified-lock.ts"), "utf8");
    expect(source).not.toContain("DIAGNOSIS_DAIBAI_DELIVERY_ENABLED = true");
    expect(source).not.toContain("DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED = true");
    expect(source).not.toContain("DIAGNOSIS_REPORT_API_DEPLOYED = true");
    expect(source).not.toContain("GATEWAY_METHOD_PACKS.push");
    expect(source).not.toContain("user.daibai.ask");
    expect(source).not.toContain("--fix");
    expect(source).not.toContain("podman stop");
    expect(source).not.toContain("podman rename");
    expect(GATEWAY_METHOD_PACKS.find((pack) => pack.id === "diagnosis-reports")).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.query"]).toBeDefined();
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
  });
});
