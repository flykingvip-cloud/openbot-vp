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
import { assertGraphRelation, buildDiagnosisGraph } from "./graph.js";
import { computeMergeKey } from "./merge.js";
import {
  DiagnosisContractError,
  type DiagnosisRelation,
  type DiagnosticEvidence,
  type DiagnosticFinding,
  type DiagnosticTarget,
} from "./types.js";

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

describe("Phase 2 increment 4.4 — cross-target Case + Graph", () => {
  it("aggregates Session → Agent → Skill → Tool into one Case by mergeKey", () => {
    const graph = loadGraph("skill-triggered-tool-timeout.json");
    const composite = aggregateCrossTargetCases([sliceFromGraph(graph)]);
    expect(composite.cases).toHaveLength(1);
    const types = new Set(composite.cases[0]?.targets.map((item) => item.targetType));
    expect(types.has("session")).toBe(true);
    expect(types.has("tool") || types.has("skill") || types.has("run") || types.has("agent")).toBe(
      true,
    );
    expect(composite.evidenceRefs.every((ref) => !("summary" in ref))).toBe(true);
    expect(composite.graph.edges.length).toBeGreaterThan(0);
    expect(composite.cases[0]?.completion).toBe("CONFIRMED");
  });

  it("attaches Channel / Runtime / Doctor evidence refs to the same session Case", () => {
    const graph = loadGraph("agent-not-started.json");
    const sessionKeyHash = "sha256:fixture-session-key-a0000000000000000000000000000001";
    const composite = aggregateCrossTargetCases([
      sliceFromGraph(graph),
      {
        runId: "diag-run-channel",
        tenantId: "tenant-fixture-a",
        sessionKeyHash,
        targets: [
          target({ targetType: "channel", targetId: "telegram", authority: "channel_health" }),
        ],
        evidenceRefs: [
          evidenceRef({
            evidenceId: "ev-channel-1",
            sessionKeyHash,
          }),
        ],
        relations: [
          relation({
            relationId: "rel-channel-corr",
            fromId: "ev-channel-1",
            toId: graph.findings[0]?.findingId ?? "find-a",
            relation: "correlated_with",
            derivation: "EVIDENCE_DERIVED",
            evidenceIds: ["ev-channel-1"],
          }),
        ],
      },
      {
        runId: "diag-run-runtime",
        tenantId: "tenant-fixture-a",
        sessionKeyHash,
        targets: [
          target({
            targetType: "agent",
            targetId: "agent-fixture-main",
            authority: "agent_runtime_health",
          }),
        ],
        evidenceRefs: [
          evidenceRef({
            evidenceId: "ev-runtime-1",
            source: "agent_runtime_health",
            authority: "src/gateway/agent-runtime-health.ts",
            authorityRecordId: "l1:agent-fixture-main",
            targetType: "agent",
            targetId: "agent-fixture-main",
            sessionKeyHash,
          }),
        ],
      },
      {
        runId: "diag-run-doctor",
        tenantId: "tenant-fixture-a",
        sessionKeyHash,
        targets: [
          target({ targetType: "gateway", targetId: "gateway", authority: "doctor_check" }),
        ],
        evidenceRefs: [
          evidenceRef({
            evidenceId: "ev-doctor-1",
            source: "doctor_check",
            authority: "src/diagnosis/doctor-check-contract.ts",
            authorityRecordId: "doctor-check:gateway-mode",
            targetType: "gateway",
            targetId: "gateway",
            sessionKeyHash: null,
          }),
        ],
      },
    ]);
    expect(composite.cases).toHaveLength(1);
    const sources = composite.cases[0]?.evidenceRefs.map((ref) => ref.source) ?? [];
    expect(sources).toContain("channel_health");
    expect(sources).toContain("agent_runtime_health");
    expect(sources).toContain("doctor_check");
    expect(composite.cases[0]?.impactScope).toEqual(
      expect.arrayContaining(["session", "agent", "channel", "gateway"]),
    );
  });

  it("merges the same mergeKey and isolates tenant / session / fingerprint", () => {
    const left = scopedFinding("tenant-a", "sha256:session-a");
    const sameKey = scopedFinding("tenant-a", "sha256:session-a", {
      findingId: "find-b",
      evidenceIds: ["ev-b"],
    });
    const otherTenant = scopedFinding("tenant-b", "sha256:session-a", {
      findingId: "find-c",
      fingerprint: left.fingerprint,
    });
    const otherSession = scopedFinding("tenant-a", "sha256:session-other", {
      findingId: "find-d",
      fingerprint: left.fingerprint,
    });
    const otherFp = scopedFinding("tenant-a", "sha256:session-a", {
      findingId: "find-e",
      fingerprint: "skill_tool|skill_not_triggered|skill:lookup",
    });
    const composite = aggregateCrossTargetCases([
      {
        runId: "run-1",
        tenantId: "tenant-a",
        sessionKeyHash: "sha256:session-a",
        targets: [scopedTarget("tenant-a", "sha256:session-a")],
        findings: [left],
        evidences: [scopedEvidence("tenant-a", "sha256:session-a")],
        relations: [relation()],
        completion: "CONFIRMED",
      },
      {
        runId: "run-2",
        tenantId: "tenant-a",
        sessionKeyHash: "sha256:session-a",
        targets: [scopedTarget("tenant-a", "sha256:session-a")],
        findings: [sameKey],
        evidences: [scopedEvidence("tenant-a", "sha256:session-a", { evidenceId: "ev-b" })],
        completion: "CONFIRMED",
      },
      {
        runId: "run-3",
        tenantId: "tenant-b",
        sessionKeyHash: "sha256:session-a",
        targets: [scopedTarget("tenant-b", "sha256:session-a")],
        findings: [otherTenant],
        evidences: [scopedEvidence("tenant-b", "sha256:session-a", { evidenceId: "ev-c" })],
        relations: [relation({ relationId: "rel-c", toId: "find-c", evidenceIds: ["ev-c"] })],
        completion: "CONFIRMED",
      },
      {
        runId: "run-4",
        tenantId: "tenant-a",
        sessionKeyHash: "sha256:session-other",
        targets: [scopedTarget("tenant-a", "sha256:session-other")],
        findings: [otherSession],
        evidences: [scopedEvidence("tenant-a", "sha256:session-other", { evidenceId: "ev-d" })],
        relations: [relation({ relationId: "rel-d", toId: "find-d", evidenceIds: ["ev-d"] })],
        completion: "CONFIRMED",
      },
      {
        runId: "run-5",
        tenantId: "tenant-a",
        sessionKeyHash: "sha256:session-a",
        targets: [scopedTarget("tenant-a", "sha256:session-a")],
        findings: [otherFp],
        evidences: [scopedEvidence("tenant-a", "sha256:session-a", { evidenceId: "ev-e" })],
        relations: [relation({ relationId: "rel-e", toId: "find-e", evidenceIds: ["ev-e"] })],
        completion: "CONFIRMED",
      },
    ]);
    expect(composite.cases).toHaveLength(4);
    const same = composite.cases.find(
      (item) =>
        item.mergeKey ===
        computeMergeKey({
          tenantId: "tenant-a",
          sessionKeyHash: "sha256:session-a",
          fingerprint: left.fingerprint,
        }),
    );
    expect(same?.findings.map((item) => item.findingId).toSorted()).toEqual(["find-a", "find-b"]);
    expect(same?.diagnosticRunIds).toEqual(["run-1", "run-2"]);
  });

  it("rejects MODEL_INFERRED accepted causes and unaudited accepted causes", () => {
    expectCode(
      () =>
        assertGraphRelation(
          relation({
            derivation: "MODEL_INFERRED",
            state: "accepted",
          }),
        ),
      "model_inferred_not_candidate",
    );
    expectCode(
      () =>
        assertGraphRelation(
          relation({
            derivation: "EVIDENCE_DERIVED",
            state: "accepted",
            evidenceIds: [],
          }),
        ),
      "accepted_causes_evidence_required",
    );
    expectCode(
      () =>
        assertGraphRelation(
          relation({
            derivation: "RULE_DERIVED",
            state: "accepted",
            evidenceIds: [],
          }),
        ),
      "accepted_causes_rule_audit_required",
    );
    expectCode(
      () =>
        assertGraphRelation(
          relation({
            derivation: "HUMAN_CONFIRMED",
            state: "accepted",
            evidenceIds: [],
          }),
        ),
      "accepted_causes_confirmation_required",
    );
    expectCode(
      () =>
        assertGraphRelation(
          relation({
            ruleId: "temporal_order",
            derivation: "RULE_DERIVED",
            ruleVersion: "v1",
          }),
        ),
      "temporal_causes_forbidden",
    );
  });

  it("keeps a missing route_resolution Case INCONCLUSIVE with missingEvidence", () => {
    const graph = loadGraph("inconclusive-missing-route-evidence.json");
    const composite = aggregateCrossTargetCases([sliceFromGraph(graph)]);
    expect(composite.cases).toHaveLength(1);
    expect(composite.cases[0]?.completion).toBe("INCONCLUSIVE");
    expect(
      composite.cases[0]?.missingEvidence.some((req) => req.source === "route_resolution"),
    ).toBe(true);
    expect(composite.missingEvidence.some((req) => req.source === "route_resolution")).toBe(true);
  });

  it("keeps scene 4 as one primary Finding and refuses parallel RCA", () => {
    const graph = loadGraph("tool-timeout-user-retry.json");
    const composite = aggregateCrossTargetCases([sliceFromGraph(graph)]);
    expect(composite.cases).toHaveLength(1);
    expect(composite.cases[0]?.findings.filter((item) => item.status === "open")).toHaveLength(1);
    expect(
      composite.relations.filter((item) => item.relation === "causes" && item.state === "accepted"),
    ).toHaveLength(1);

    const scene4Session = "sha256:fixture-session-key-a0000000000000000000000000000004";
    const extra = scopedFinding("tenant-fixture-a", scene4Session, {
      findingId: "find-parallel",
      fingerprint: graph.findings[0]?.fingerprint,
    });
    expectCode(
      () =>
        aggregateCrossTargetCases([
          sliceFromGraph(graph),
          {
            runId: "run-parallel",
            tenantId: "tenant-fixture-a",
            sessionKeyHash: scene4Session,
            targets: graph.run.targets,
            findings: [extra],
            evidences: [
              scopedEvidence("tenant-fixture-a", scene4Session, { evidenceId: "ev-parallel" }),
            ],
            relations: [
              relation({
                relationId: "rel-parallel",
                toId: "find-parallel",
                evidenceIds: ["ev-parallel"],
              }),
            ],
            completion: "CONFIRMED",
          },
        ]),
      "parallel_rca_forbidden",
    );
  });

  it("does not copy runtime fact payloads and never imports repair writers", () => {
    const ref = toEvidenceRef(
      evidence({
        summary: { prompt: "secret", token: "abc" },
      }),
    );
    expect(ref).not.toHaveProperty("summary");
    expect(JSON.stringify(ref)).not.toContain("secret");
    expect(ref.tenantId).toBe("tenant-fixture-a");
    expect(ref.sessionKeyHash).toBe("sha256:session-a");
    const gatewayRef = toEvidenceRef(
      evidence({
        evidenceId: "ev-gateway",
        source: "doctor_check",
        target: target({
          targetType: "gateway",
          targetId: "gateway",
          authority: "doctor_check",
          scope: { agentId: "agent-a" },
        }),
      }),
    );
    expect(gatewayRef.tenantId).toBe("tenant-fixture-a");
    expect(gatewayRef.sessionKeyHash).toBeNull();

    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "cross-target.ts"),
      "utf8",
    );
    const graphSource = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "graph.ts"),
      "utf8",
    );
    for (const body of [source, graphSource]) {
      expect(body).not.toContain("appendSkillInvocationEvent");
      expect(body).not.toContain("writeConfigFile");
      expect(body).not.toContain("doctorCommand");
      expect(body).not.toContain("startChannel");
      expect(body).not.toContain("emitDiagnosticEvent");
    }
  });

  it("allows MODEL_INFERRED only as a candidate on the Graph", () => {
    const graph = buildDiagnosisGraph({
      findings: [finding()],
      evidenceIds: ["ev-a"],
      relations: [
        relation({
          derivation: "MODEL_INFERRED",
          state: "candidate",
        }),
      ],
    });
    expect(graph.edges[0]?.state).toBe("candidate");
  });

  it("rejects a target whose tenantId does not match the slice", () => {
    expectCode(
      () =>
        aggregateCrossTargetCases([
          {
            runId: "run-tenant-mismatch",
            tenantId: "tenant-fixture-a",
            sessionKeyHash: "sha256:session-a",
            targets: [target({ tenantId: "tenant-other" })],
            findings: [finding()],
            evidences: [evidence()],
          },
        ]),
      "tenant_mismatch",
    );
  });

  it("rejects a Finding whose tenantId does not match the slice", () => {
    expectCode(
      () =>
        aggregateCrossTargetCases([
          {
            runId: "run-finding-tenant",
            tenantId: "tenant-fixture-a",
            sessionKeyHash: "sha256:session-a",
            targets: [target()],
            findings: [
              scopedFinding("tenant-other", "sha256:session-a", { findingId: "find-wrong-tenant" }),
            ],
            evidences: [evidence()],
          },
        ]),
      "finding_tenant_mismatch",
    );
  });

  it("rejects Evidence whose tenantId does not match the slice", () => {
    expectCode(
      () =>
        aggregateCrossTargetCases([
          {
            runId: "run-evidence-tenant",
            tenantId: "tenant-fixture-a",
            sessionKeyHash: "sha256:session-a",
            targets: [target()],
            findings: [finding()],
            evidences: [
              scopedEvidence("tenant-other", "sha256:session-a", { evidenceId: "ev-wrong" }),
            ],
          },
        ]),
      "evidence_tenant_mismatch",
    );
  });

  it("rejects session / Finding / Evidence sessionKeyHash that does not match the slice", () => {
    expectCode(
      () =>
        aggregateCrossTargetCases([
          {
            runId: "run-session-mismatch",
            tenantId: "tenant-fixture-a",
            sessionKeyHash: "sha256:session-a",
            targets: [target({ scope: { sessionKeyHash: "sha256:session-other" } })],
            findings: [finding()],
            evidences: [evidence()],
          },
        ]),
      "session_key_mismatch",
    );
    expectCode(
      () =>
        aggregateCrossTargetCases([
          {
            runId: "run-finding-session",
            tenantId: "tenant-fixture-a",
            sessionKeyHash: "sha256:session-a",
            targets: [target()],
            findings: [scopedFinding("tenant-fixture-a", "sha256:session-other")],
            evidences: [evidence()],
          },
        ]),
      "session_key_mismatch",
    );
    expectCode(
      () =>
        aggregateCrossTargetCases([
          {
            runId: "run-evidence-session",
            tenantId: "tenant-fixture-a",
            sessionKeyHash: "sha256:session-a",
            targets: [target()],
            findings: [finding()],
            evidences: [scopedEvidence("tenant-fixture-a", "sha256:session-other")],
          },
        ]),
      "session_key_mismatch",
    );
  });

  it("aggregates consistent Session → Agent → Skill → Tool → Channel slices", () => {
    const tenantId = "tenant-fixture-a";
    const sessionKeyHash = "sha256:session-a";
    const fingerprint = "agent_model|agent_not_started|agent:agent-a";
    const composite = aggregateCrossTargetCases([
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
          relation({
            relationId: "rel-session",
            toId: "find-session",
            evidenceIds: ["ev-session"],
          }),
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
        findings: [
          scopedFinding(tenantId, sessionKeyHash, { findingId: "find-agent", fingerprint }),
        ],
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
        evidenceRefs: [
          evidenceRef({
            evidenceId: "ev-channel-ok",
            sessionKeyHash,
          }),
        ],
      },
    ]);
    expect(composite.cases).toHaveLength(1);
    expect(composite.cases[0]?.findings.map((item) => item.findingId).toSorted()).toEqual([
      "find-agent",
      "find-session",
      "find-skill",
      "find-tool",
    ]);
    expect(composite.cases[0]?.impactScope).toEqual(
      expect.arrayContaining(["session", "agent", "skill", "tool", "channel"]),
    );
    expect(composite.evidenceRefs.map((ref) => ref.evidenceId)).toEqual(
      expect.arrayContaining(["ev-session", "ev-agent", "ev-skill", "ev-tool", "ev-channel-ok"]),
    );
    expect(composite.cases[0]?.completion).toBe("CONFIRMED");
  });

  it("rejects an evidenceRef whose tenantId does not match the slice", () => {
    expectCode(
      () =>
        aggregateCrossTargetCases([
          {
            runId: "run-ref-tenant",
            tenantId: "tenant-fixture-a",
            sessionKeyHash: "sha256:session-a",
            targets: [target()],
            findings: [finding()],
            evidenceRefs: [evidenceRef({ tenantId: "tenant-other" })],
          },
        ]),
      "evidence_ref_tenant_mismatch",
    );
  });

  it("rejects an evidenceRef whose sessionKeyHash does not match the slice", () => {
    expectCode(
      () =>
        aggregateCrossTargetCases([
          {
            runId: "run-ref-session",
            tenantId: "tenant-fixture-a",
            sessionKeyHash: "sha256:session-a",
            targets: [target()],
            findings: [finding()],
            evidenceRefs: [evidenceRef({ sessionKeyHash: "sha256:session-other" })],
          },
        ]),
      "evidence_ref_session_mismatch",
    );
  });

  it("rejects an evidenceRef that omits tenant identity", () => {
    const { tenantId: _omit, ...missingTenant } = evidenceRef();
    expectCode(
      () =>
        aggregateCrossTargetCases([
          {
            runId: "run-ref-identity",
            tenantId: "tenant-fixture-a",
            sessionKeyHash: "sha256:session-a",
            targets: [target()],
            findings: [finding()],
            evidenceRefs: [missingTenant as EvidenceRef],
          },
        ]),
      "evidence_ref_identity_required",
    );
    const { sessionKeyHash: _omitHash, ...missingSession } = evidenceRef();
    expectCode(
      () =>
        aggregateCrossTargetCases([
          {
            runId: "run-ref-session-identity",
            tenantId: "tenant-fixture-a",
            sessionKeyHash: "sha256:session-a",
            targets: [target()],
            findings: [finding()],
            evidenceRefs: [missingSession as EvidenceRef],
          },
        ]),
      "evidence_ref_identity_required",
    );
  });

  it("aggregates Channel / Runtime / Doctor evidenceRefs with explicit identity", () => {
    const tenantId = "tenant-fixture-a";
    const sessionKeyHash = "sha256:session-a";
    const composite = aggregateCrossTargetCases([
      {
        runId: "run-primary",
        tenantId,
        sessionKeyHash,
        targets: [target()],
        findings: [finding()],
        evidences: [evidence()],
        relations: [relation()],
        completion: "CONFIRMED",
      },
      {
        runId: "run-channel-ref",
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
      {
        runId: "run-runtime-ref",
        tenantId,
        sessionKeyHash,
        targets: [
          scopedTarget(tenantId, sessionKeyHash, {
            targetType: "agent",
            targetId: "agent-a",
            authority: "agent_runtime_health",
          }),
        ],
        evidenceRefs: [
          evidenceRef({
            evidenceId: "ev-runtime-ok",
            source: "agent_runtime_health",
            authority: "src/gateway/agent-runtime-health.ts",
            authorityRecordId: "l1:agent-a",
            targetType: "agent",
            targetId: "agent-a",
            sessionKeyHash,
          }),
        ],
      },
      {
        runId: "run-doctor-ref",
        tenantId,
        sessionKeyHash,
        targets: [
          scopedTarget(tenantId, sessionKeyHash, {
            targetType: "gateway",
            targetId: "gateway",
            authority: "doctor_check",
          }),
        ],
        evidenceRefs: [
          evidenceRef({
            evidenceId: "ev-doctor-ok",
            source: "doctor_check",
            authority: "src/diagnosis/doctor-check-contract.ts",
            authorityRecordId: "doctor-check:gateway-mode",
            targetType: "gateway",
            targetId: "gateway",
            sessionKeyHash: null,
          }),
        ],
      },
      {
        runId: "run-host-ref",
        tenantId,
        sessionKeyHash,
        targets: [
          scopedTarget(tenantId, sessionKeyHash, {
            targetType: "host",
            targetId: "host-a",
            authority: "doctor_check",
          }),
        ],
        evidenceRefs: [
          evidenceRef({
            evidenceId: "ev-host-ok",
            source: "doctor_check",
            authority: "src/diagnosis/doctor-check-contract.ts",
            authorityRecordId: "doctor-check:host",
            targetType: "host",
            targetId: "host-a",
            sessionKeyHash: null,
          }),
        ],
      },
    ]);
    expect(composite.cases).toHaveLength(1);
    const refs = composite.cases[0]?.evidenceRefs ?? [];
    expect(refs.map((item) => item.evidenceId)).toEqual(
      expect.arrayContaining(["ev-channel-ok", "ev-runtime-ok", "ev-doctor-ok", "ev-host-ok"]),
    );
    expect(refs.find((item) => item.evidenceId === "ev-doctor-ok")?.sessionKeyHash).toBeNull();
    expect(refs.find((item) => item.evidenceId === "ev-host-ok")?.tenantId).toBe(tenantId);
    expect(refs.every((item) => item.tenantId === tenantId)).toBe(true);
  });

  it("rejects channel evidenceRef with null sessionKeyHash", () => {
    expectCode(
      () =>
        aggregateCrossTargetCases([
          {
            runId: "run-channel-null",
            tenantId: "tenant-fixture-a",
            sessionKeyHash: "sha256:session-a",
            targets: [target()],
            findings: [finding()],
            evidenceRefs: [evidenceRef({ sessionKeyHash: null })],
          },
        ]),
      "evidence_ref_session_identity_required",
    );
  });

  it("rejects agent runtime evidenceRef with null sessionKeyHash", () => {
    expectCode(
      () =>
        aggregateCrossTargetCases([
          {
            runId: "run-runtime-null",
            tenantId: "tenant-fixture-a",
            sessionKeyHash: "sha256:session-a",
            targets: [target()],
            findings: [finding()],
            evidenceRefs: [
              evidenceRef({
                source: "agent_runtime_health",
                targetType: "agent",
                targetId: "agent-a",
                sessionKeyHash: null,
              }),
            ],
          },
        ]),
      "evidence_ref_session_identity_required",
    );
  });

  it("allows gateway evidenceRef with explicit null sessionKeyHash", () => {
    const composite = aggregateCrossTargetCases([
      {
        runId: "run-gateway-null",
        tenantId: "tenant-fixture-a",
        sessionKeyHash: "sha256:session-a",
        targets: [target()],
        findings: [finding()],
        evidences: [evidence()],
        evidenceRefs: [
          evidenceRef({
            evidenceId: "ev-gateway-null",
            source: "doctor_check",
            targetType: "gateway",
            targetId: "gateway",
            sessionKeyHash: null,
          }),
        ],
        completion: "CONFIRMED",
      },
    ]);
    expect(composite.cases).toHaveLength(1);
    expect(
      composite.cases[0]?.evidenceRefs.some((item) => item.evidenceId === "ev-gateway-null"),
    ).toBe(true);
  });

  it("allows host evidenceRef with explicit null sessionKeyHash", () => {
    const composite = aggregateCrossTargetCases([
      {
        runId: "run-host-null",
        tenantId: "tenant-fixture-a",
        sessionKeyHash: "sha256:session-a",
        targets: [target()],
        findings: [finding()],
        evidences: [evidence()],
        evidenceRefs: [
          evidenceRef({
            evidenceId: "ev-host-null",
            source: "doctor_check",
            targetType: "host",
            targetId: "host-a",
            sessionKeyHash: null,
          }),
        ],
        completion: "CONFIRMED",
      },
    ]);
    expect(composite.cases).toHaveLength(1);
    expect(
      composite.cases[0]?.evidenceRefs.some((item) => item.evidenceId === "ev-host-null"),
    ).toBe(true);
  });
});
