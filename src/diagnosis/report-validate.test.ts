import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aggregateCrossTargetCases } from "./cross-target.js";
import {
  exportCompositeDiagnosisReportJson,
  validateCompositeDiagnosisReport,
} from "./report-validate.js";
import { buildCompositeDiagnosisReport, serializeCompositeDiagnosisReport } from "./report.js";
import {
  DiagnosisContractError,
  type DiagnosisRelation,
  type DiagnosticEvidence,
  type DiagnosticFinding,
  type DiagnosticTarget,
} from "./types.js";

const GENERATED_AT = "2026-09-02T17:48:00.000Z";
const TRUSTED = { tenantId: "tenant-fixture-a" };

function target(over: Partial<DiagnosticTarget> = {}): DiagnosticTarget {
  return {
    schemaVersion: 1,
    targetType: "session",
    targetId: "session-x",
    tenantId: "tenant-fixture-a",
    authority: "session_store",
    scope: { sessionKeyHash: "sha256:session-a" },
    ...over,
  };
}

function finding(over: Partial<DiagnosticFinding> = {}): DiagnosticFinding {
  return {
    schemaVersion: 1,
    findingId: "find-a",
    code: "agent_not_started",
    title: "agent_not_started",
    target: target({ targetType: "agent", targetId: "agent-a", authority: "agent_runner" }),
    status: "open",
    severity: "P2",
    primaryDomain: "agent_model",
    observationIds: ["obs-a"],
    assessmentIds: ["as-a"],
    attributionIds: ["at-a"],
    hypothesisIds: ["hy-a"],
    evidenceIds: ["ev-a"],
    confidence: { evidence: 0.9, assessment: 0.8, rootCause: 0.7, impact: 0.4 },
    fingerprint: "agent_model|agent_not_started|agent:agent-a",
    firstSeenAt: "2026-09-01T10:00:00.000Z",
    lastSeenAt: "2026-09-01T10:00:01.000Z",
    completion: "CONFIRMED",
    ...over,
  };
}

function evidence(over: Partial<DiagnosticEvidence> = {}): DiagnosticEvidence {
  return {
    schemaVersion: 1,
    evidenceId: "ev-a",
    evidenceType: "event",
    source: "agent_runner",
    authority: "agent runner / Plugin Hooks",
    authorityRecordId: "agent-run-a",
    observedAt: "2026-09-01T10:00:00.000Z",
    target: target({ targetType: "agent", targetId: "agent-a", authority: "agent_runner" }),
    summary: { agentStarted: false },
    collection: {
      method: "event_adapter",
      completeness: "complete",
      attributionResolution: "not_applicable",
    },
    privacy: { classification: "internal", redacted: true },
    ...over,
  };
}

function relation(over: Partial<DiagnosisRelation> = {}): DiagnosisRelation {
  return {
    schemaVersion: 1,
    relationId: "rel-a",
    fromId: "obs-a",
    toId: "find-a",
    relation: "causes",
    derivation: "EVIDENCE_DERIVED",
    state: "accepted",
    confidence: 0.8,
    evidenceIds: ["ev-a"],
    ...over,
  };
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DiagnosisContractError);
    expect((err as DiagnosisContractError).code).toBe(code);
    return;
  }
  throw new Error(`expected DiagnosisContractError ${code}`);
}

function validReport() {
  const diagnosis = aggregateCrossTargetCases([
    {
      runId: "run-report",
      tenantId: "tenant-fixture-a",
      sessionKeyHash: "sha256:session-a",
      targets: [target()],
      findings: [finding()],
      evidences: [evidence()],
      relations: [relation()],
      completion: "CONFIRMED",
    },
  ]);
  return buildCompositeDiagnosisReport(diagnosis, TRUSTED, { generatedAt: GENERATED_AT });
}

describe("Phase 3 increment 2 — report validation and export", () => {
  it("accepts a consistent single-tenant report", () => {
    const report = validReport();
    const validated = validateCompositeDiagnosisReport(report, TRUSTED);
    expect(validated.schemaVersion).toBe(1);
    expect(validated.tenantId).toBe("tenant-fixture-a");
    expect(validated.reportId).toContain(GENERATED_AT);
  });

  it("rejects a trusted tenant mismatch", () => {
    expectCode(
      () => validateCompositeDiagnosisReport(validReport(), { tenantId: "tenant-other" }),
      "tenant_mismatch",
    );
  });

  it("rejects mixed tenant fields on the report", () => {
    const report = validReport();
    expectCode(
      () =>
        validateCompositeDiagnosisReport(
          {
            ...report,
            findings: report.findings.map((item, index) =>
              index === 0 ? { ...item, tenantId: "tenant-other" } : item,
            ),
          },
          TRUSTED,
        ),
      "report_tenant_mismatch",
    );
  });

  it("rejects dangling finding, evidence, and relation references", () => {
    const report = validReport();
    expectCode(
      () =>
        validateCompositeDiagnosisReport(
          {
            ...report,
            cases: report.cases.map((item) => ({
              ...item,
              findingIds: [...item.findingIds, "find-missing"],
            })),
          },
          TRUSTED,
        ),
      "dangling_finding_ref",
    );
    expectCode(
      () =>
        validateCompositeDiagnosisReport(
          {
            ...report,
            cases: report.cases.map((item) => ({
              ...item,
              evidenceRefIds: [...item.evidenceRefIds, "ev-missing"],
            })),
          },
          TRUSTED,
        ),
      "dangling_evidence_ref",
    );
    expectCode(
      () =>
        validateCompositeDiagnosisReport(
          {
            ...report,
            cases: report.cases.map((item) => ({
              ...item,
              relationIds: [...item.relationIds, "rel-missing"],
            })),
          },
          TRUSTED,
        ),
      "dangling_relation_ref",
    );
  });

  it("rejects accepted MODEL_INFERRED causes", () => {
    const report = validReport();
    const inferred = {
      ...report.acceptedRootCauses[0],
      derivation: "MODEL_INFERRED" as const,
    };
    expectCode(
      () =>
        validateCompositeDiagnosisReport(
          {
            ...report,
            acceptedRootCauses: [inferred],
            graphEdges: [inferred],
          },
          TRUSTED,
        ),
      "model_inferred_not_candidate",
    );
  });

  it("rejects INCONCLUSIVE reports that drop missingEvidence", () => {
    const report = validReport();
    expectCode(
      () =>
        validateCompositeDiagnosisReport(
          {
            ...report,
            completion: "INCONCLUSIVE",
            missingEvidence: [],
          },
          TRUSTED,
        ),
      "missing_evidence_required",
    );
  });

  it("rejects payload, message, and tool result fields", () => {
    const report = validReport();
    expectCode(
      () =>
        validateCompositeDiagnosisReport(
          {
            ...report,
            evidenceRefs: report.evidenceRefs.map((item) => ({
              ...item,
              summary: { prompt: "secret", params: "token", result: "tool-output" },
            })),
          },
          TRUSTED,
        ),
      "report_payload_forbidden",
    );
    expectCode(
      () => validateCompositeDiagnosisReport({ ...report, reportMarkdown: "# RCA" }, TRUSTED),
      "report_payload_forbidden",
    );
  });

  it("rejects an unknown schemaVersion without guessing fields", () => {
    const report = validReport();
    expectCode(
      () => validateCompositeDiagnosisReport({ ...report, schemaVersion: 2 }, TRUSTED),
      "unknown_schema_version",
    );
    expectCode(
      () => validateCompositeDiagnosisReport({ ...report, schemaVersion: "1" }, TRUSTED),
      "unknown_schema_version",
    );
  });

  it("rejects malformed cases, findings, evidenceRefs, targets, and missingEvidence", () => {
    const report = validReport();
    expectCode(
      () => validateCompositeDiagnosisReport({ ...report, cases: [{}] }, TRUSTED),
      "missing_field",
    );
    expectCode(
      () => validateCompositeDiagnosisReport({ ...report, findings: [{}] }, TRUSTED),
      "missing_field",
    );
    expectCode(
      () => validateCompositeDiagnosisReport({ ...report, evidenceRefs: [{}] }, TRUSTED),
      "missing_field",
    );
    expectCode(
      () => validateCompositeDiagnosisReport({ ...report, targets: [{}] }, TRUSTED),
      "missing_field",
    );
    expectCode(
      () => validateCompositeDiagnosisReport({ ...report, missingEvidence: [{}] }, TRUSTED),
      "schema_version_required",
    );
  });

  it("rejects confidence values outside the unit interval", () => {
    const report = validReport();
    expectCode(
      () =>
        validateCompositeDiagnosisReport(
          {
            ...report,
            confidence: { ...report.confidence, meanEvidence: 1.5 },
          },
          TRUSTED,
        ),
      "invalid_range",
    );
    expectCode(
      () =>
        validateCompositeDiagnosisReport(
          {
            ...report,
            confidence: { ...report.confidence, meanImpact: -0.1 },
          },
          TRUSTED,
        ),
      "invalid_range",
    );
    expectCode(
      () =>
        validateCompositeDiagnosisReport(
          {
            ...report,
            findings: report.findings.map((item) => ({
              ...item,
              confidence: { ...item.confidence, evidence: 2 },
            })),
          },
          TRUSTED,
        ),
      "invalid_range",
    );
  });

  it("rejects graph endpoints that are not finding, evidence, or observation nodes", () => {
    const report = validReport();
    expectCode(
      () =>
        validateCompositeDiagnosisReport(
          {
            ...report,
            acceptedRootCauses: report.acceptedRootCauses.map((item) => ({
              ...item,
              fromId: "obs-ghost",
            })),
          },
          TRUSTED,
        ),
      "dangling_graph_node",
    );
  });

  it("rejects accepted or candidate causes that diverge from graphEdges content", () => {
    const report = validReport();
    expectCode(
      () =>
        validateCompositeDiagnosisReport(
          {
            ...report,
            acceptedRootCauses: report.acceptedRootCauses.map((item) => ({
              ...item,
              confidence: 0.1,
            })),
          },
          TRUSTED,
        ),
      "root_cause_graph_mismatch",
    );
  });

  it("exports byte-stable JSON and no Markdown or model summary", () => {
    const report = validReport();
    const left = exportCompositeDiagnosisReportJson(report, TRUSTED);
    const right = exportCompositeDiagnosisReportJson(structuredClone(report), TRUSTED);
    expect(left).toBe(right);
    expect(left).toBe(serializeCompositeDiagnosisReport(report));
    expect(left.startsWith("{")).toBe(true);
    expect(left).not.toContain("# ");
    expect(left).not.toContain("<html");
    expect(left).not.toContain("reportMarkdown");
    expect(left.includes("Math.random")).toBe(false);
    const body = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "report-validate.ts"),
      "utf8",
    );
    expect(body).not.toContain("appendSkillInvocationEvent");
    expect(body).not.toContain("writeConfigFile");
    expect(body).not.toContain("doctorCommand");
    expect(body).not.toContain("startChannel");
    expect(body).not.toContain("<html");
    expect(body).not.toContain("reportMarkdown");
  });
});
