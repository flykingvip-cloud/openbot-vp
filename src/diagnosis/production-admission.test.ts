import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { coreGatewayHandlers } from "../gateway/server-methods.js";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import {
  DIAGNOSIS_ADMISSION_TENANT,
  DIAGNOSIS_PRODUCTION_ADMISSION_INCREMENT,
  assertDiagnosisProductionAdmissionClosed,
  buildDiagnosisRehearsalSlo,
  evaluateDiagnosisLedgerAlignment,
  evaluateDiagnosisProductionAdmission,
  proveDiagnosisAdmissionFailClosed,
  renderDiagnosisProductionAdmissionMarkdown,
  runDiagnosisGovernedChainRehearsal,
  runDiagnosisReadonlyApiRehearsal,
} from "./production-admission.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
import {
  DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS,
  DIAGNOSIS_P5_CONTRACT_SIGNED,
} from "./production-preflight.js";
import type { DiagnosisProductionPreflightInput } from "./production-preflight.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";

const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
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
    now: Date.parse("2026-09-03T07:00:00.000Z"),
    ...over,
  };
}

describe("P13 ledger alignment", () => {
  it("keeps No-Go when RELEASE_RECORD or provenance diverge and never mutates the ledger", () => {
    const current = evaluateDiagnosisLedgerAlignment({
      liveSha: "6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96",
      ledgerOpenShas: ["6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96"],
      releaseRecordSha: "37cc40e51f468404baf3077307e347f32f636cb1",
      provenanceTagSha: null,
    });
    expect(current.aligned).toBe(false);
    expect(current.ledgerMutated).toBe(false);
    expect(current.provenanceMinted).toBe(false);
    expect(current.blockers.join(" ")).toMatch(/RELEASE_RECORD/);
    expect(current.blockers.join(" ")).toMatch(/provenance/);
    expect(
      evaluateDiagnosisLedgerAlignment({
        liveSha: SHA_A,
        ledgerOpenShas: [SHA_A],
        releaseRecordSha: SHA_A,
        provenanceTagSha: SHA_A,
      }).aligned,
    ).toBe(true);
    expect(
      evaluateDiagnosisLedgerAlignment({
        liveSha: SHA_A,
        ledgerOpenShas: [SHA_B],
        releaseRecordSha: SHA_A,
        provenanceTagSha: SHA_A,
      }).blockers.join(" "),
    ).toMatch(/do not rewrite the ledger/);
  });
});

describe("P13 pre-production dependency and SLO rehearsal", () => {
  it("fail-closes timeout, unavailable backends, and tenant mismatch", async () => {
    const faults = await proveDiagnosisAdmissionFailClosed();
    expect(faults.timeoutFailClosed).toBe(true);
    expect(faults.unavailableFailClosed).toBe(true);
    expect(faults.tenantMismatch).toBe(true);
  });

  it("runs a single-tenant read-only query/get rehearsal without live packs", async () => {
    const result = await runDiagnosisReadonlyApiRehearsal();
    expect(result.api.queryStatus).toBe(200);
    expect(result.api.getStatus).toBe(200);
    expect(result.api.unauthorizedStatus).toBe(401);
    expect(result.api.tenantIsolationHeld).toBe(true);
    expect(result.api.redacted).toBe(true);
    expect(result.api.auditRecorded).toBe(true);
    expect(result.api.quotaExhausted).toBe(true);
    expect(result.api.schemaRejected).toBe(true);
    expect(result.api.staleRejected).toBe(true);
    expect(GATEWAY_METHOD_PACKS.find((pack) => pack.id === "diagnosis-reports")).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.query"]).toBeDefined();
  });

  it("requires complete SLO observations before readiness can pass", () => {
    const incomplete = buildDiagnosisRehearsalSlo([{ metric: "success", latencyMs: 10 }]);
    expect(incomplete.slo.completeness).toBe("empty");
    expect(incomplete.observedMetrics).toEqual(["success"]);
    const complete = buildDiagnosisRehearsalSlo(
      DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS.map((metric) => ({ metric, latencyMs: 8 })),
    );
    expect(complete.slo.completeness).toBe("complete");
    expect(complete.observedMetrics).toEqual([...DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS]);
  });
});

describe("P13 governed chain and admission verdict", () => {
  it("walks Signal → delivery → WAITING_AUTHORIZATION → delegation → report → preview", async () => {
    const chain = await runDiagnosisGovernedChainRehearsal();
    expect(chain.signalId).toContain("sig:p13");
    expect(chain.deliveryId).toContain("dlv:");
    expect(chain.conversationState).toBe("WAITING_AUTHORIZATION");
    expect(chain.grantId).toBeTruthy();
    expect(chain.reportId).toBeTruthy();
    expect(chain.proposalId).toBeTruthy();
    expect(chain.remediationId).toBeTruthy();
    expect(chain.previewOnly).toBe(true);
    expect(chain.appliedToRuntime).toBe(false);
  });

  it("stays No-Go on the current identities even after rehearsal injection", async () => {
    const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const originMainSha = execFileSync("git", ["rev-parse", "origin/main"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    const report = await evaluateDiagnosisProductionAdmission({
      candidateSha,
      originMainSha,
      liveSha: "6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96",
      releaseRecordSha: "37cc40e51f468404baf3077307e347f32f636cb1",
      ledgerOpenShas: ["6d9ea1f2d5da2ae46ddfd18ecae12b07692a2a96"],
      provenanceTagSha: null,
      originMainIsAncestorOfCandidate: true,
      liveIsAncestorOfCandidate: true,
      originMainContainsLive: true,
      livePackRegistered: false,
      coreHandlerHasDiagnosis: false,
      readerAvailable: false,
      auditAvailable: false,
      quotaAvailable: false,
    });
    expect(DIAGNOSIS_PRODUCTION_ADMISSION_INCREMENT).toBe("P13");
    expect(DIAGNOSIS_P5_CONTRACT_SIGNED).toBe(true);
    expect(report.readyForIndependentApproval).toBe(false);
    expect(report.approvedForProductionCutover).toBe(false);
    expect(report.gatesOpened).toBe(false);
    expect(report.slo.completeness).toBe("complete");
    expect(report.api.queryStatus).toBe(200);
    expect(report.alignment.aligned).toBe(false);
    expect(report.preflight.identities.liveSha).not.toBe(
      report.preflight.identities.releaseRecordSha,
    );
    expect(candidateSha.length).toBe(40);
    expect(originMainSha.length).toBe(40);
    expect(() => assertDiagnosisProductionAdmissionClosed(report)).not.toThrow();
    expect(renderDiagnosisProductionAdmissionMarkdown(report)).toContain("No-Go");
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
    expect(DIAGNOSIS_ADMISSION_TENANT).toBe("tenant-fixture-a");
  });

  it("can become Ready for independent approval only in a fully aligned synthetic pack, without cutting over", async () => {
    const report = await evaluateDiagnosisProductionAdmission(alignedInput());
    expect(report.readyForIndependentApproval).toBe(true);
    expect(report.approvedForProductionCutover).toBe(false);
    expect(report.gatesOpened).toBe(false);
    expect(report.trafficSwitched).toBe(false);
    expect(report.alignment.aligned).toBe(true);
  });

  it("does not scan as a live enablement or ledger rewrite", () => {
    const source = fs.readFileSync(path.join(here, "production-admission.ts"), "utf8");
    expect(source).toContain("Does not open gates");
    expect(source).not.toContain("DIAGNOSIS_REPORT_API_DEPLOYED = true");
    expect(source).not.toContain("GATEWAY_METHOD_PACKS.push");
    expect(source).not.toContain("user.daibai.ask");
    expect(source).not.toContain("--fix");
    expect(source).not.toContain("releases.jsonl");
    expect(source).not.toContain("RELEASE_RECORD.md");
  });
});
