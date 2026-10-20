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
  DIAGNOSIS_UNIFIED_DEPS_INCREMENT,
  assertDiagnosisUnifiedDepsClosed,
  buildDiagnosisUnifiedDependencyRecords,
  evaluateDiagnosisUnifiedDeps,
  injectUnifiedWindowProductionDependencies,
  proveUnifiedWindowDependencyFailClosed,
  renderDiagnosisUnifiedDependenciesMarkdown,
  renderDiagnosisUnifiedDepsMarkdown,
} from "./production-unified-deps.js";
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
    now: Date.parse("2026-09-05T08:22:00.000Z"),
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

describe("P24.2 unified-window production dependencies", () => {
  it("injects reader/audit/quota/auth without live writes", async () => {
    const injection = await injectUnifiedWindowProductionDependencies();
    expect(injection.readerReady).toBe(true);
    expect(injection.auditReady).toBe(true);
    expect(injection.quotaReady).toBe(true);
    expect(injection.authReady).toBe(true);
    expect(injection.foreignTenantDropped).toBe(true);
    expect(injection.claimedTenantRejected).toBe(true);
    expect(injection.daibaiUnconnected).toBe(false);
    expect(injection.conversationUnconnected).toBe(false);
    expect(injection.remediationUnconnected).toBe(true);
    expect(injection.liveConnected).toBe(false);
    expect(injection.productionWrite).toBe(false);
    const rows = buildDiagnosisUnifiedDependencyRecords(injection);
    expect(rows).toHaveLength(7);
    expect(rows.filter((row) => row.hostInjectionReady)).toHaveLength(6);
    expect(rows.filter((row) => row.unconnectedUntilVerifyLive)).toHaveLength(1);
    expect(rows.filter((row) => row.productionWrite).map((row) => row.id)).toEqual([
      "daibai_delivery_transport",
    ]);
    expect(renderDiagnosisUnifiedDependenciesMarkdown(rows)).toContain("daibai_delivery_transport");
  });

  it("fail-closes when production backends are missing", async () => {
    const faults = await proveUnifiedWindowDependencyFailClosed();
    expect(faults.readerUnavailable).toBe(true);
    expect(faults.auditUnavailable).toBe(true);
    expect(faults.quotaUnavailable).toBe(true);
    expect(faults.passed).toBe(true);
  });

  it("stays No-Go until unified-window deploy conditions are open", async () => {
    const report = await evaluateDiagnosisUnifiedDeps(alignedInput());
    expect(report.productionDependenciesInjected).toBe(false);
    expect(report.gatesOpened).toBe(false);
    expect(report.p25Started).toBe(false);
    expect(renderDiagnosisUnifiedDepsMarkdown(report)).toContain("No-Go");
    expect(() => assertDiagnosisUnifiedDepsClosed(report)).not.toThrow();
  });

  it("marks host injection ready without opening gates or starting P25", async () => {
    const report = await evaluateDiagnosisUnifiedDeps({
      ...alignedInput(),
      humanApproval: humanClaim(),
    });
    expect(report.increment).toBe(DIAGNOSIS_UNIFIED_DEPS_INCREMENT);
    expect(report.productionDependenciesInjected).toBe(true);
    expect(report.hostInjectionReady).toBe(true);
    expect(report.unifiedDeployConditionsOpen).toBe(true);
    expect(report.enablementBlockedUntilVerifyLive).toBe(true);
    expect(report.approvedForProductionCutover).toBe(false);
    expect(report.diagnosisOnlyCutover).toBe(false);
    expect(report.gatesOpened).toBe(false);
    expect(report.liveConnected).toBe(false);
    expect(report.productionWrite).toBe(false);
    expect(report.p25Started).toBe(false);
    expect(report.p26ProductionReady).toBe(false);
    expect(renderDiagnosisUnifiedDepsMarkdown(report)).toContain("Gates stay closed");
    expect(() => assertDiagnosisUnifiedDepsClosed(report)).not.toThrow();
  });

  it("rejects a pack bound to a diverged identity", async () => {
    await expect(
      evaluateDiagnosisUnifiedDeps({
        ...alignedInput({ liveSha: SHA_A, ledgerOpenShas: [SHA_B] }),
        humanApproval: humanClaim(),
      }),
    ).rejects.toThrow();
  });

  it("does not scan as a live enablement, diagnosis-only cutover, or P25 start", () => {
    const source = fs.readFileSync(path.join(here, "production-unified-deps.ts"), "utf8");
    expect(source).not.toContain("DIAGNOSIS_DAIBAI_DELIVERY_ENABLED = true");
    expect(source).not.toContain("DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED = true");
    expect(source).not.toContain("DIAGNOSIS_REPORT_API_DEPLOYED = true");
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
