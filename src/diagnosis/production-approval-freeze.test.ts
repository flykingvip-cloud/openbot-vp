import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { coreGatewayHandlers } from "../gateway/server-methods.js";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import {
  DIAGNOSIS_INDEPENDENT_APPROVAL_DOES_NOT_OPEN_GATES,
  DIAGNOSIS_INDEPENDENT_APPROVAL_INCREMENT,
  assertDiagnosisIndependentApprovalClosed,
  evaluateDiagnosisIndependentApproval,
  evaluateDiagnosisLedgerRepair,
  freezeDiagnosisApprovalGates,
  renderDiagnosisIndependentApprovalMarkdown,
} from "./production-approval-freeze.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
import { DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS } from "./production-preflight.js";
import type { DiagnosisProductionPreflightInput } from "./production-preflight.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";

const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const LIVE = "6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96";
const RECORD = "37cc40e51f468404baf3077307e347f32f636cb1";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

function alignedInput(
  over: Partial<DiagnosisProductionPreflightInput> = {},
): DiagnosisProductionPreflightInput {
  return {
    candidateSha: SHA_A,
    originMainSha: SHA_A,
    liveSha: SHA_A,
    releaseRecordSha: SHA_A,
    ledgerOpenShas: [SHA_A],
    provenanceTagSha: SHA_A,
    originMainIsAncestorOfCandidate: true,
    liveIsAncestorOfCandidate: true,
    originMainContainsLive: true,
    livePackRegistered: false,
    coreHandlerHasDiagnosis: false,
    readerAvailable: true,
    auditAvailable: true,
    quotaAvailable: true,
    p5ContractSigned: true,
    now: Date.parse("2026-09-03T08:00:00.000Z"),
    ...over,
  };
}

describe("P14 ledger repair decisions", () => {
  it("keeps the open ledger row when it already matches proven LIVE and does not mint provenance", () => {
    const current = evaluateDiagnosisLedgerRepair({
      liveSha: LIVE,
      liveSource: "container",
      ledgerOpenShas: [LIVE],
      releaseRecordSha: RECORD,
      provenanceTagSha: null,
      provenancePublishedAtCutover: false,
    });
    expect(current.ledgerAction).toBe("keep");
    expect(current.releaseRecordAction).toBe("defer_to_delivery_owner");
    expect(current.provenanceAction).toBe("do_not_mint");
    expect(current.ledgerMutated).toBe(false);
    expect(current.releaseRecordMutated).toBe(false);
    expect(current.provenanceMinted).toBe(false);
    expect(current.aligned).toBe(false);
    expect(current.evidenceGaps.join(" ")).toMatch(/fabricate publication/);
    expect(
      evaluateDiagnosisLedgerRepair({
        liveSha: SHA_A,
        liveSource: "container",
        ledgerOpenShas: [SHA_B],
        releaseRecordSha: SHA_A,
        provenanceTagSha: SHA_A,
      }).ledgerAction,
    ).toBe("blocked");
  });
});

describe("P14 independent approval freeze", () => {
  it("stays No-Go on current identities and freezes role/gate materials without opening gates", async () => {
    const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const originMainSha = execFileSync("git", ["rev-parse", "origin/main"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const report = await evaluateDiagnosisIndependentApproval({
      candidateSha,
      originMainSha,
      liveSha: LIVE,
      liveSource: "container",
      releaseRecordSha: RECORD,
      ledgerOpenShas: [LIVE],
      provenanceTagSha: null,
      provenancePublishedAtCutover: false,
      originMainIsAncestorOfCandidate: true,
      liveIsAncestorOfCandidate: true,
      originMainContainsLive: true,
      livePackRegistered: false,
      coreHandlerHasDiagnosis: false,
      readerAvailable: false,
      auditAvailable: false,
      quotaAvailable: false,
    });
    expect(DIAGNOSIS_INDEPENDENT_APPROVAL_INCREMENT).toBe("P14");
    expect(DIAGNOSIS_INDEPENDENT_APPROVAL_DOES_NOT_OPEN_GATES).toBe(true);
    expect(report.readyForIndependentApproval).toBe(false);
    expect(report.approvedForProductionCutover).toBe(false);
    expect(report.gatesOpened).toBe(false);
    expect(report.repair.liveSource).toBe("container");
    expect(report.admission.slo.completeness).toBe("complete");
    expect(report.observedMetrics).toEqual([...DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS]);
    expect(report.observabilityHealth).toBe("not_ready");
    expect(report.roleApprovals.map((row) => row.role)).toEqual([
      "platform_security",
      "enterprise_admin",
      "employee",
      "delivery_ledger_owner",
    ]);
    expect(report.gates).toHaveLength(4);
    expect(report.gates.every((gate) => !gate.value && gate.approvalDoesNotOpenGate)).toBe(true);
    expect(report.injection.clientEnableForbidden).toBe(true);
    expect(report.repair.aligned).toBe(false);
    expect(candidateSha.length).toBe(40);
    expect(originMainSha.length).toBe(40);
    expect(() => assertDiagnosisIndependentApprovalClosed(report)).not.toThrow();
    expect(renderDiagnosisIndependentApprovalMarkdown(report)).toContain("No-Go");
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
    expect(GATEWAY_METHOD_PACKS.find((pack) => pack.id === "diagnosis-reports")).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.query"]).toBeDefined();
  });

  it("can become Ready only when identities align, without treating approval as enablement", async () => {
    const report = await evaluateDiagnosisIndependentApproval({
      ...alignedInput(),
      liveSource: "container",
      provenancePublishedAtCutover: true,
    });
    expect(report.readyForIndependentApproval).toBe(true);
    expect(report.repair.aligned).toBe(true);
    expect(report.approvedForProductionCutover).toBe(false);
    expect(report.gatesOpened).toBe(false);
    expect(report.trafficSwitched).toBe(false);
    expect(report.approvalDoesNotOpenGate).toBe(true);
    expect(freezeDiagnosisApprovalGates().every((gate) => !gate.value)).toBe(true);
  });

  it("does not scan as a live enablement or identity rewrite", () => {
    const source = fs.readFileSync(path.join(here, "production-approval-freeze.ts"), "utf8");
    expect(source).toContain("Approval never auto-enables a gate");
    expect(source).not.toContain("DIAGNOSIS_REPORT_API_DEPLOYED = true");
    expect(source).not.toContain("GATEWAY_METHOD_PACKS.push");
    expect(source).not.toContain("user.daibai.ask");
    expect(source).not.toContain("--fix");
    expect(source).not.toContain("releases.jsonl");
    expect(source).not.toContain("RELEASE_RECORD.md");
  });
});
