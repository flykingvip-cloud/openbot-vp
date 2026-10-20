import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { coreGatewayHandlers } from "../gateway/server-methods.js";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
import type { DiagnosisProductionPreflightInput } from "./production-preflight.js";
import {
  DIAGNOSIS_TRUNK_CONVERGENCE_INCREMENT,
  assertDiagnosisTrunkConvergenceClosed,
  buildDiagnosisIdentityEvidence,
  buildDiagnosisProvenanceRemintPlan,
  evaluateDiagnosisTrunkConvergence,
  renderDiagnosisTrunkConvergenceMarkdown,
} from "./production-trunk-convergence.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";

const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
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
    now: Date.parse("2026-09-03T09:00:00.000Z"),
    ...over,
  };
}

describe("P15 identity evidence and remint plan", () => {
  it("separates ledger, RELEASE_RECORD, and provenance consistency and refuses old candidates", () => {
    const current = buildDiagnosisIdentityEvidence({
      ...alignedInput({
        candidateSha: LIVE,
        originMainSha: RECORD,
        liveSha: LIVE,
        ledgerOpenShas: [LIVE],
        releaseRecordSha: RECORD,
        provenanceTagSha: null,
      }),
      liveSource: "container",
      provenancePublishedAtCutover: false,
    });
    expect(current.consistency.candidateEqualsOriginMain).toBe(false);
    expect(current.consistency.liveEqualsLedger).toBe(true);
    expect(current.consistency.liveEqualsReleaseRecord).toBe(false);
    expect(current.consistency.liveEqualsProvenance).toBe(false);
    expect(current.evidence.find((row) => row.id === "candidate")?.blocker).toMatch(
      /refuse old candidate/,
    );
    expect(current.evidence.find((row) => row.id === "live")?.provable).toBe(true);
    const remint = buildDiagnosisProvenanceRemintPlan({
      liveSha: LIVE,
      provenanceTagSha: null,
      provenancePublishedAtCutover: false,
    });
    expect(remint.action).toBe("do_not_mint");
    expect(remint.published).toBe(false);
    expect(remint.proposedTag).toBe("provenance/sha-6d9ea1f2d5da");
    expect(remint.reason).toMatch(/fabricate publication/);
    const alreadyIdentifies = buildDiagnosisProvenanceRemintPlan({
      liveSha: SHA_A,
      provenanceTagSha: SHA_A,
      provenancePublishedAtCutover: false,
    });
    expect(alreadyIdentifies.action).toBe("do_not_mint");
    expect(alreadyIdentifies.published).toBe(false);
    expect(alreadyIdentifies.reason).toMatch(/peeled target already identifies LIVE/);
  });
});

describe("P15 trunk convergence rehearsal", () => {
  it("stays No-Go before trunk equality and re-verifies P14 preview limits", async () => {
    const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const originMainSha = execFileSync("git", ["rev-parse", "origin/main"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const report = await evaluateDiagnosisTrunkConvergence({
      candidateSha,
      originMainSha,
      liveSha: LIVE,
      liveSource: "container",
      liveObservedAt: "2026-09-03T01:37:57.887Z",
      releaseRecordSha: RECORD,
      releaseRecordObservedAt: "2026-09-02T09:50:59Z",
      ledgerOpenShas: [LIVE],
      ledgerObservedAt: "2026-09-03T02:52:10Z",
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
    expect(DIAGNOSIS_TRUNK_CONVERGENCE_INCREMENT).toBe("P15");
    expect(candidateSha.length).toBe(40);
    expect(originMainSha.length).toBe(40);
    expect(report.readyForIndependentApproval).toBe(false);
    expect(report.consistency.liveEqualsReleaseRecord).toBe(false);
    expect(report.consistency.liveEqualsProvenance).toBe(false);
    expect(report.trunk.liveIsAncestorOfCandidate).toBe(true);
    expect(report.trunk.liveIsAncestorOfOriginMain).toBe(true);
    expect(report.consistency.liveEqualsLedger).toBe(true);
    expect(report.approval.gates.every((gate) => !gate.value)).toBe(true);
    expect(report.approval.admission.slo.completeness).toBe("complete");
    expect(report.approval.admission.chain.previewOnly).toBe(true);
    expect(report.approval.admission.chain.appliedToRuntime).toBe(false);
    expect(report.approval.admission.chain.conversationState).toBe("WAITING_AUTHORIZATION");
    expect(GATEWAY_METHOD_PACKS.find((pack) => pack.id === "diagnosis-reports")).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.query"]).toBeDefined();
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
    expect(() => assertDiagnosisTrunkConvergenceClosed(report)).not.toThrow();
    expect(renderDiagnosisTrunkConvergenceMarkdown(report)).toContain("No-Go");
  });

  it("can become Ready only when candidate equals origin/main and identities are proven, without opening gates", async () => {
    const report = await evaluateDiagnosisTrunkConvergence({
      ...alignedInput(),
      liveSource: "container",
      liveObservedAt: "2026-09-03T09:00:00.000Z",
      provenancePublishedAtCutover: true,
    });
    expect(report.readyForIndependentApproval).toBe(true);
    expect(report.consistency.candidateEqualsOriginMain).toBe(true);
    expect(report.approvedForProductionCutover).toBe(false);
    expect(report.gatesOpened).toBe(false);
    expect(report.remintPlan.published).toBe(false);
  });

  it("stays No-Go after trunk merge when RELEASE_RECORD and provenance still lag", async () => {
    const originMainSha = execFileSync("git", ["rev-parse", "origin/main"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const report = await evaluateDiagnosisTrunkConvergence({
      candidateSha: originMainSha,
      originMainSha,
      liveSha: LIVE,
      liveSource: "container",
      liveObservedAt: "2026-09-03T01:37:57.887Z",
      releaseRecordSha: RECORD,
      releaseRecordObservedAt: "2026-09-02T09:50:59Z",
      ledgerOpenShas: [LIVE],
      ledgerObservedAt: "2026-09-03T02:52:10Z",
      provenanceTagSha: null,
      provenancePublishedAtCutover: false,
      pullRequestUrl: "https://github.com/gmood2008/openbot/pull/922",
      originMainIsAncestorOfCandidate: true,
      liveIsAncestorOfCandidate: true,
      originMainContainsLive: true,
      livePackRegistered: false,
      coreHandlerHasDiagnosis: false,
      readerAvailable: false,
      auditAvailable: false,
      quotaAvailable: false,
    });
    expect(report.trunk.candidateEqualsOriginMain).toBe(true);
    expect(report.consistency.liveEqualsLedger).toBe(true);
    expect(report.consistency.liveEqualsReleaseRecord).toBe(false);
    expect(report.consistency.liveEqualsProvenance).toBe(false);
    expect(report.readyForIndependentApproval).toBe(false);
    expect(report.gatesOpened).toBe(false);
    expect(report.remintPlan.action).toBe("do_not_mint");
    expect(report.remintPlan.published).toBe(false);
  });

  it("stays No-Go when identity is proven but production reader/audit/quota are still fail-closed", async () => {
    const report = await evaluateDiagnosisTrunkConvergence({
      ...alignedInput({
        readerAvailable: false,
        auditAvailable: false,
        quotaAvailable: false,
      }),
      liveSource: "container",
      liveObservedAt: "2026-09-03T09:00:00.000Z",
      provenancePublishedAtCutover: true,
    });
    expect(report.consistency.liveEqualsProvenance).toBe(true);
    expect(report.readyForIndependentApproval).toBe(false);
    expect(report.approvedForProductionCutover).toBe(false);
    expect(report.gatesOpened).toBe(false);
    expect(report.remintPlan.published).toBe(false);
  });

  it("does not scan as a live enablement or provenance publication", () => {
    const source = fs.readFileSync(path.join(here, "production-trunk-convergence.ts"), "utf8");
    expect(source).toContain("without publishing tags");
    expect(source).not.toContain("DIAGNOSIS_REPORT_API_DEPLOYED = true");
    expect(source).not.toContain("GATEWAY_METHOD_PACKS.push");
    expect(source).not.toContain("user.daibai.ask");
    expect(source).not.toContain("--fix");
    expect(source).not.toContain("releases.jsonl");
    expect(source).not.toContain("RELEASE_RECORD.md");
  });
});
