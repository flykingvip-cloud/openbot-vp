import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { describe, expect, it } from "vitest";
import { coreGatewayHandlers } from "../gateway/server-methods.js";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
import {
  DIAGNOSIS_P21_SAMPLE_SCOPE,
  DIAGNOSIS_P21_TENANT,
  DIAGNOSIS_PRODUCTION_P21_INCREMENT,
  assertDiagnosisProductionP21Closed,
  buildDiagnosisP21DependencyRecords,
  buildDiagnosisP21SloObservations,
  evaluateDiagnosisProductionP21,
  renderDiagnosisP21DependenciesMarkdown,
  renderDiagnosisP21SloMarkdown,
  renderDiagnosisProductionP21Markdown,
  runDiagnosisP21FaultInjection,
} from "./production-p21.js";
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
    readerAvailable: false,
    auditAvailable: false,
    quotaAvailable: false,
    now: Date.parse("2026-09-05T04:40:00.000Z"),
    ...over,
  };
}

describe("P21 isolated dependency inventory", () => {
  it("records authority, schema, tenant, timeout, and fail-closed modes for all seven deps", () => {
    const rows = buildDiagnosisP21DependencyRecords(true);
    expect(rows.map((row) => row.id)).toEqual([
      "composite_report_reader",
      "audit_persist",
      "quota_store",
      "gateway_auth_membership",
      "daibai_delivery_transport",
      "conversation_state_store",
      "remediation_executor",
    ]);
    for (const row of rows) {
      expect(row.tenantBoundary).toBe("server_membership_only");
      expect(row.timeoutMs).toBeGreaterThan(0);
      expect(row.productionWrite).toBe(false);
      expect(row.verified).toBe(true);
      expect(row.unavailable.length).toBeGreaterThan(0);
      expect(row.timeout.length).toBeGreaterThan(0);
      expect(row.schemaMismatch.length).toBeGreaterThan(0);
      expect(row.tenantMismatch.length).toBeGreaterThan(0);
      expect(row.failClosed.length).toBeGreaterThan(0);
    }
    expect(renderDiagnosisP21DependenciesMarkdown(rows)).toContain("productionWrite=false");
  });
});

describe("P21 fault injection", () => {
  it("covers reader/audit/quota/auth/Da Bai/conversation/remediation fail-closed modes", async () => {
    const faults = await runDiagnosisP21FaultInjection();
    expect(faults.map((row) => row.id)).toEqual([
      "reader_unavailable",
      "reader_stale",
      "reader_schema_mismatch",
      "reader_tenant_mismatch",
      "reader_timeout",
      "audit_persist_failure",
      "quota_exhaustion",
      "quota_backend_failure",
      "auth_membership_missing",
      "auth_membership_unauthorized",
      "daibai_unavailable",
      "conversation_store_failure",
      "remediation_executor_unavailable",
    ]);
    for (const row of faults) {
      expect(row.passed).toBe(true);
      expect(row.leakedEvidencePayload).toBe(false);
      expect(row.crossTenantReport).toBe(false);
      expect(row.unauthorizedDelivery).toBe(false);
      expect(row.realRemediation).toBe(false);
      expect(row.wroteMainChain).toBe(false);
    }
  });
});

describe("P21 SLO observations", () => {
  it("keeps Ready false and health not healthy when completeness is not complete", () => {
    const incomplete = buildDiagnosisP21SloObservations(
      [{ metric: "success", latencyMs: 10 }],
      "2026-09-05T04:40:00.000Z",
    );
    expect(incomplete.slo.completeness).toBe("empty");
    expect(incomplete.observedMetrics).toEqual(["success"]);
    expect(incomplete.observations).toHaveLength(DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS.length);
  });

  it("records source, window, sample, tenant, and value for every required metric", () => {
    const complete = buildDiagnosisP21SloObservations(
      DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS.map((metric) => ({ metric, latencyMs: 8 })),
      "2026-09-05T04:40:00.000Z",
    );
    expect(complete.slo.completeness).toBe("complete");
    expect(complete.observations.map((row) => row.metric)).toEqual([
      ...DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS,
    ]);
    for (const row of complete.observations) {
      expect(row.source).toContain("isolated_preprod");
      expect(row.sampleScope).toBe(DIAGNOSIS_P21_SAMPLE_SCOPE);
      expect(row.tenantScope).toContain(DIAGNOSIS_P21_TENANT);
      expect(row.observed).toBe(8);
    }
  });
});

describe("P21 closed-loop verdict", () => {
  it("is immediate No-Go when identity diverges", async () => {
    const report = await evaluateDiagnosisProductionP21(
      alignedInput({
        liveSha: SHA_A,
        ledgerOpenShas: [SHA_B],
        releaseRecordSha: SHA_A,
        provenanceTagSha: SHA_A,
      }),
    );
    expect(report.readyForIndependentApproval).toBe(false);
    expect(report.identityAligned).toBe(false);
    expect(report.observabilityHealth).not.toBe("healthy");
    expect(report.approvedForProductionCutover).toBe(false);
    expect(() => assertDiagnosisProductionP21Closed(report)).not.toThrow();
    expect(renderDiagnosisProductionP21Markdown(report)).toContain("No-Go");
  });

  it("becomes Ready only when identity, isolated deps, faults, SLO, and preview chain all hold", async () => {
    const report = await evaluateDiagnosisProductionP21(alignedInput());
    expect(report.increment).toBe(DIAGNOSIS_PRODUCTION_P21_INCREMENT);
    expect(report.readyForIndependentApproval).toBe(true);
    expect(report.identityAligned).toBe(true);
    expect(report.dependenciesVerified).toBe(true);
    expect(report.faultsPassed).toBe(true);
    expect(report.slo.completeness).toBe("complete");
    expect(report.observabilityHealth).toBe("healthy");
    expect(report.chain.conversationState).toBe("WAITING_AUTHORIZATION");
    expect(report.chain.previewOnly).toBe(true);
    expect(report.chain.appliedToRuntime).toBe(false);
    expect(report.chain.p20_2IdentityPreflight).toBe(true);
    expect(report.approvedForProductionCutover).toBe(false);
    expect(report.gatesOpened).toBe(false);
    expect(report.trafficSwitched).toBe(false);
    expect(report.preflight.readyForIndependentApproval).toBe(true);
    expect(renderDiagnosisP21SloMarkdown(report)).toContain("isolated_preprod");
    expect(() => assertDiagnosisProductionP21Closed(report)).not.toThrow();
  });

  it("does not scan as a live enablement or ledger rewrite", () => {
    const source = fs.readFileSync(path.join(here, "production-p21.ts"), "utf8");
    expect(source).toContain("Does not open gates");
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
    expect(DIAGNOSIS_P5_CONTRACT_SIGNED).toBe(true);
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
