import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  aggregateCrossTargetCases,
  toEvidenceRef,
  type CrossTargetSlice,
  type EvidenceRef,
} from "./cross-target.js";
import {
  loadGoldenDiagnosticRunGraph as loadGraph,
  type GoldenDiagnosticRunGraph,
} from "./fixture-graph.js";
import { buildCompositeDiagnosisReport, serializeCompositeDiagnosisReport } from "./report.js";
import {
  DiagnosisContractError,
  type DiagnosisRelation,
  type DiagnosticAttribution,
  type DiagnosticEvidence,
  type DiagnosticFinding,
  type DiagnosticTarget,
} from "./types.js";

const GENERATED_AT = "2026-09-02T15:51:00.000Z";
const TRUSTED = { tenantId: "tenant-fixture-a" };

function sliceFromGraph(graph: GoldenDiagnosticRunGraph): CrossTargetSlice {
  const sessionKeyHash =
    graph.run.targets.find((target) => target.scope.sessionKeyHash)?.scope.sessionKeyHash ?? "";
  return {
    runId: graph.run.runId,
    tenantId: graph.run.requestedBy.tenantId,
    sessionKeyHash,
    targets: graph.run.targets,
    findings: graph.findings,
    evidences: graph.evidences,
    relations: graph.relations,
    missingEvidence: graph.run.missingEvidence,
    completion: graph.run.completion,
  };
}

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

function scopedTarget(
  tenantId: string | null,
  sessionKeyHash: string,
  over: Partial<DiagnosticTarget> = {},
): DiagnosticTarget {
  const { scope, ...rest } = over;
  return target({
    ...rest,
    tenantId: rest.tenantId ?? tenantId,
    scope: { sessionKeyHash, ...scope },
  });
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

function evidenceRef(over: Partial<EvidenceRef> = {}): EvidenceRef {
  return {
    evidenceId: "ev-ref",
    source: "channel_health",
    authority: "src/gateway/channel-health-policy.ts",
    authorityRecordId: "channel:telegram",
    targetType: "channel",
    targetId: "telegram",
    observedAt: "2026-09-01T10:00:00.000Z",
    tenantId: "tenant-fixture-a",
    sessionKeyHash: "sha256:session-a",
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

function scopedFinding(
  tenantId: string | null,
  sessionKeyHash: string,
  over: Partial<DiagnosticFinding> = {},
): DiagnosticFinding {
  const { target: targetOver, ...rest } = over;
  return finding({
    ...rest,
    target: scopedTarget(tenantId, sessionKeyHash, {
      targetType: "agent",
      targetId: "agent-a",
      authority: "agent_runner",
      ...targetOver,
    }),
  });
}

function scopedEvidence(
  tenantId: string | null,
  sessionKeyHash: string,
  over: Partial<DiagnosticEvidence> = {},
): DiagnosticEvidence {
  const { target: targetOver, ...rest } = over;
  return evidence({
    ...rest,
    target: scopedTarget(tenantId, sessionKeyHash, {
      targetType: "agent",
      targetId: "agent-a",
      authority: "agent_runner",
      ...targetOver,
    }),
  });
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

function crossComponentSlices(): CrossTargetSlice[] {
  const tenantId = "tenant-fixture-a";
  const sessionKeyHash = "sha256:session-a";
  const fingerprint = "agent_model|agent_not_started|agent:agent-a";
  return [
    {
      runId: "run-session",
      tenantId,
      sessionKeyHash,
      targets: [scopedTarget(tenantId, sessionKeyHash)],
      findings: [
        scopedFinding(tenantId, sessionKeyHash, { findingId: "find-session", fingerprint }),
      ],
      evidences: [scopedEvidence(tenantId, sessionKeyHash, { evidenceId: "ev-session" })],
      relations: [
        relation({ relationId: "rel-session", toId: "find-session", evidenceIds: ["ev-session"] }),
      ],
      completion: "CONFIRMED",
    },
    {
      runId: "run-agent",
      tenantId,
      sessionKeyHash,
      targets: [
        scopedTarget(tenantId, sessionKeyHash, {
          targetType: "agent",
          targetId: "agent-a",
          authority: "agent_runner",
        }),
      ],
      findings: [scopedFinding(tenantId, sessionKeyHash, { findingId: "find-agent", fingerprint })],
      evidences: [scopedEvidence(tenantId, sessionKeyHash, { evidenceId: "ev-agent" })],
      completion: "CONFIRMED",
    },
    {
      runId: "run-skill",
      tenantId,
      sessionKeyHash,
      targets: [
        scopedTarget(tenantId, sessionKeyHash, {
          targetType: "skill",
          targetId: "skill-lookup",
          authority: "skill_invocation",
        }),
      ],
      findings: [
        scopedFinding(tenantId, sessionKeyHash, {
          findingId: "find-skill",
          fingerprint,
          target: scopedTarget(tenantId, sessionKeyHash, {
            targetType: "skill",
            targetId: "skill-lookup",
            authority: "skill_invocation",
          }),
        }),
      ],
      evidences: [
        scopedEvidence(tenantId, sessionKeyHash, {
          evidenceId: "ev-skill",
          source: "skill_invocation",
          target: scopedTarget(tenantId, sessionKeyHash, {
            targetType: "skill",
            targetId: "skill-lookup",
            authority: "skill_invocation",
          }),
        }),
      ],
      completion: "CONFIRMED",
    },
    {
      runId: "run-tool",
      tenantId,
      sessionKeyHash,
      targets: [
        scopedTarget(tenantId, sessionKeyHash, {
          targetType: "tool",
          targetId: "tool-http",
          authority: "tool_invocation",
        }),
      ],
      findings: [
        scopedFinding(tenantId, sessionKeyHash, {
          findingId: "find-tool",
          fingerprint,
          target: scopedTarget(tenantId, sessionKeyHash, {
            targetType: "tool",
            targetId: "tool-http",
            authority: "tool_invocation",
          }),
        }),
      ],
      evidences: [
        scopedEvidence(tenantId, sessionKeyHash, {
          evidenceId: "ev-tool",
          source: "tool_runtime",
          target: scopedTarget(tenantId, sessionKeyHash, {
            targetType: "tool",
            targetId: "tool-http",
            authority: "tool_invocation",
          }),
        }),
      ],
      completion: "CONFIRMED",
    },
    {
      runId: "run-channel",
      tenantId,
      sessionKeyHash,
      targets: [
        scopedTarget(tenantId, sessionKeyHash, {
          targetType: "channel",
          targetId: "telegram",
          authority: "channel_health",
        }),
      ],
      evidenceRefs: [evidenceRef({ evidenceId: "ev-channel-ok", sessionKeyHash })],
    },
  ];
}

describe("Phase 3 increment 1 — Composite Diagnosis Report", () => {
  it("projects Session → Agent → Skill → Tool → Channel into one report", () => {
    const diagnosis = aggregateCrossTargetCases(crossComponentSlices());
    const report = buildCompositeDiagnosisReport(diagnosis, TRUSTED, { generatedAt: GENERATED_AT });
    expect(report.schemaVersion).toBe(1);
    expect(report.reportId.startsWith("cdr-")).toBe(true);
    expect(report.reportId).toContain(GENERATED_AT);
    expect(report.generatedAt).toBe(GENERATED_AT);
    expect(report.tenantId).toBe("tenant-fixture-a");
    expect(report.cases).toHaveLength(1);
    expect(report.completion).toBe("CONFIRMED");
    expect(report.impactScope).toEqual(
      expect.arrayContaining(["session", "agent", "skill", "tool", "channel"]),
    );
    expect(report.findings.map((item) => item.findingId)).toEqual([
      "find-agent",
      "find-session",
      "find-skill",
      "find-tool",
    ]);
    expect(report.evidenceRefs.map((item) => item.evidenceId)).toEqual(
      expect.arrayContaining(["ev-session", "ev-agent", "ev-skill", "ev-tool", "ev-channel-ok"]),
    );
    expect(report.acceptedRootCauses).toHaveLength(1);
    expect(report.graphEdges.length).toBeGreaterThan(0);
    expect(report.confidence.findingCount).toBe(4);
    expect(report.evidenceRefs.every((ref) => !("summary" in ref))).toBe(true);
  });

  it("keeps an INCONCLUSIVE report with missingEvidence", () => {
    const diagnosis = aggregateCrossTargetCases([
      sliceFromGraph(loadGraph("inconclusive-missing-route-evidence.json")),
    ]);
    const report = buildCompositeDiagnosisReport(diagnosis, TRUSTED, { generatedAt: GENERATED_AT });
    expect(report.completion).toBe("INCONCLUSIVE");
    expect(report.missingEvidence.some((req) => req.source === "route_resolution")).toBe(true);
    expect(report.cases[0]?.completion).toBe("INCONCLUSIVE");
  });

  it("rejects P0 without support, model-only P0, and parallel RCA", () => {
    const p0 = finding({
      severity: "P0",
      attributionIds: ["at-model"],
    });
    const diagnosis = aggregateCrossTargetCases([
      {
        runId: "run-p0",
        tenantId: "tenant-fixture-a",
        sessionKeyHash: "sha256:session-a",
        targets: [target()],
        findings: [p0],
        evidences: [evidence()],
        relations: [relation()],
        completion: "CONFIRMED",
      },
    ]);
    expectCode(
      () => buildCompositeDiagnosisReport(diagnosis, TRUSTED, { generatedAt: GENERATED_AT }),
      "p0_support_required",
    );

    const attribution: DiagnosticAttribution = {
      schemaVersion: 1,
      attributionId: "at-model",
      assessmentId: "as-a",
      suspectedTarget: target({
        targetType: "agent",
        targetId: "agent-a",
        authority: "agent_runner",
      }),
      responsibilityDomain: "agent_model",
      state: "suspected",
      basis: "model_suggestion",
    };
    expectCode(
      () =>
        buildCompositeDiagnosisReport(diagnosis, TRUSTED, {
          generatedAt: GENERATED_AT,
          p0Support: {
            relations: [
              relation({
                derivation: "MODEL_INFERRED",
                state: "candidate",
              }),
            ],
            attributions: [attribution],
          },
        }),
      "model_only_p0",
    );

    const parallelBase = aggregateCrossTargetCases([
      {
        runId: "run-ok",
        tenantId: "tenant-fixture-a",
        sessionKeyHash: "sha256:session-a",
        targets: [target()],
        findings: [finding()],
        evidences: [evidence()],
        relations: [relation()],
        completion: "CONFIRMED",
      },
    ]);
    const extraFinding = finding({ findingId: "find-b" });
    const extraCause = relation({ relationId: "rel-b", toId: "find-b", evidenceIds: ["ev-a"] });
    expectCode(
      () =>
        buildCompositeDiagnosisReport(
          {
            ...parallelBase,
            cases: parallelBase.cases.map((item) => ({
              ...item,
              findings: [...item.findings, extraFinding],
              relations: [...item.relations, extraCause],
            })),
            findings: [...parallelBase.findings, extraFinding],
            relations: [...parallelBase.relations, extraCause],
          },
          TRUSTED,
          { generatedAt: GENERATED_AT },
        ),
      "parallel_rca_forbidden",
    );
  });

  it("does not leak Evidence payloads or invent MODEL_INFERRED accepted causes", () => {
    const diagnosis = aggregateCrossTargetCases([
      {
        runId: "run-secret",
        tenantId: "tenant-fixture-a",
        sessionKeyHash: "sha256:session-a",
        targets: [target()],
        findings: [finding()],
        evidences: [
          evidence({
            summary: { prompt: "secret-body", params: "token-xyz", result: "tool-output" },
          }),
        ],
        relations: [relation()],
        completion: "CONFIRMED",
      },
    ]);
    const report = buildCompositeDiagnosisReport(diagnosis, TRUSTED, { generatedAt: GENERATED_AT });
    const json = serializeCompositeDiagnosisReport(report);
    expect(json).not.toContain("secret-body");
    expect(json).not.toContain("token-xyz");
    expect(json).not.toContain("tool-output");
    expect(json).not.toContain('"summary"');
    expect(toEvidenceRef(evidence({ summary: { prompt: "secret-body" } }))).not.toHaveProperty(
      "summary",
    );

    expectCode(
      () =>
        buildCompositeDiagnosisReport(
          {
            ...diagnosis,
            relations: [
              relation({
                derivation: "MODEL_INFERRED",
                state: "accepted",
              }),
            ],
            graph: { ...diagnosis.graph, edges: [] },
          },
          TRUSTED,
          { generatedAt: GENERATED_AT },
        ),
      "model_inferred_not_candidate",
    );

    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "report.ts"),
      "utf8",
    );
    expect(source).not.toContain("appendSkillInvocationEvent");
    expect(source).not.toContain("writeConfigFile");
    expect(source).not.toContain("doctorCommand");
    expect(source).not.toContain("startChannel");
    expect(source).not.toContain("emitDiagnosticEvent");
  });

  it("emits byte-stable JSON for the same input and generatedAt", () => {
    const diagnosis = aggregateCrossTargetCases(crossComponentSlices());
    const left = serializeCompositeDiagnosisReport(
      buildCompositeDiagnosisReport(diagnosis, TRUSTED, { generatedAt: GENERATED_AT }),
    );
    const right = serializeCompositeDiagnosisReport(
      buildCompositeDiagnosisReport(diagnosis, TRUSTED, { generatedAt: GENERATED_AT }),
    );
    expect(left).toBe(right);
    expect(left.includes("Math.random")).toBe(false);
  });

  it("rejects mixed-tenant CompositeDiagnosis instead of collapsing to null", () => {
    const diagnosis = aggregateCrossTargetCases([
      {
        runId: "run-a",
        tenantId: "tenant-a",
        sessionKeyHash: "sha256:session-a",
        targets: [scopedTarget("tenant-a", "sha256:session-a")],
        findings: [scopedFinding("tenant-a", "sha256:session-a")],
        evidences: [scopedEvidence("tenant-a", "sha256:session-a")],
        relations: [relation()],
        completion: "CONFIRMED",
      },
      {
        runId: "run-b",
        tenantId: "tenant-b",
        sessionKeyHash: "sha256:session-b",
        targets: [scopedTarget("tenant-b", "sha256:session-b")],
        findings: [
          scopedFinding("tenant-b", "sha256:session-b", {
            findingId: "find-b",
            fingerprint: "agent_model|agent_not_started|agent:agent-b",
          }),
        ],
        evidences: [scopedEvidence("tenant-b", "sha256:session-b", { evidenceId: "ev-b" })],
        relations: [relation({ relationId: "rel-b", toId: "find-b", evidenceIds: ["ev-b"] })],
        completion: "CONFIRMED",
      },
    ]);
    expectCode(
      () =>
        buildCompositeDiagnosisReport(
          diagnosis,
          { tenantId: "tenant-a" },
          { generatedAt: GENERATED_AT },
        ),
      "report_tenant_mismatch",
    );
  });

  it("rejects Case, Finding, Target, and EvidenceRef tenant mismatches", () => {
    const diagnosis = aggregateCrossTargetCases(crossComponentSlices());
    expectCode(
      () =>
        buildCompositeDiagnosisReport(
          {
            ...diagnosis,
            cases: diagnosis.cases.map((item, index) =>
              index === 0 ? { ...item, tenantId: "tenant-other" } : item,
            ),
          },
          TRUSTED,
          { generatedAt: GENERATED_AT },
        ),
      "report_tenant_mismatch",
    );
    expectCode(
      () =>
        buildCompositeDiagnosisReport(
          {
            ...diagnosis,
            findings: diagnosis.findings.map((item, index) =>
              index === 0
                ? { ...item, target: { ...item.target, tenantId: "tenant-other" } }
                : item,
            ),
          },
          TRUSTED,
          { generatedAt: GENERATED_AT },
        ),
      "report_tenant_mismatch",
    );
    expectCode(
      () =>
        buildCompositeDiagnosisReport(
          {
            ...diagnosis,
            cases: diagnosis.cases.map((item, index) =>
              index === 0
                ? {
                    ...item,
                    targets: item.targets.map((targetItem, targetIndex) =>
                      targetIndex === 0 ? { ...targetItem, tenantId: "tenant-other" } : targetItem,
                    ),
                  }
                : item,
            ),
          },
          TRUSTED,
          { generatedAt: GENERATED_AT },
        ),
      "report_tenant_mismatch",
    );
    expectCode(
      () =>
        buildCompositeDiagnosisReport(
          {
            ...diagnosis,
            evidenceRefs: diagnosis.evidenceRefs.map((item, index) =>
              index === 0 ? { ...item, tenantId: "tenant-other" } : item,
            ),
          },
          TRUSTED,
          { generatedAt: GENERATED_AT },
        ),
      "report_tenant_mismatch",
    );
  });

  it("rejects a trusted tenant that does not match the report tenant", () => {
    const diagnosis = aggregateCrossTargetCases(crossComponentSlices());
    expectCode(
      () =>
        buildCompositeDiagnosisReport(
          diagnosis,
          { tenantId: "tenant-other" },
          { generatedAt: GENERATED_AT },
        ),
      "tenant_mismatch",
    );
  });

  it("accepts a consistent single-tenant report under the trusted tenant", () => {
    const diagnosis = aggregateCrossTargetCases(crossComponentSlices());
    const report = buildCompositeDiagnosisReport(diagnosis, TRUSTED, { generatedAt: GENERATED_AT });
    expect(report.tenantId).toBe("tenant-fixture-a");
    expect(report.cases.every((item) => item.tenantId === TRUSTED.tenantId)).toBe(true);
    expect(report.findings.every((item) => item.tenantId === TRUSTED.tenantId)).toBe(true);
    expect(report.targets.every((item) => item.tenantId === TRUSTED.tenantId)).toBe(true);
    expect(report.evidenceRefs.every((item) => item.tenantId === TRUSTED.tenantId)).toBe(true);
  });
});
