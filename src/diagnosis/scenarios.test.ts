import { describe, expect, it } from "vitest";
import {
  loadGoldenDiagnosticRunGraph as loadFixture,
  type GoldenDiagnosticRunGraph,
} from "./fixture-graph.js";
import {
  DiagnosisContractError,
  FORBIDDEN_RUNTIME_MUTATION_OPS,
  FORBIDDEN_UI_FIELD_KEYS,
  assertNoRuntimeFactMutation,
  validateConfidenceVector,
  validateDiagnosticAssessment,
  validateDiagnosticAttribution,
  validateDiagnosticCase,
  validateDiagnosticEvidence,
  validateDiagnosticFinding,
  validateDiagnosticHypothesis,
  validateDiagnosticObservation,
  validateDiagnosticRun,
  validateDiagnosticVerification,
  validateDiagnosisRelation,
} from "./types.js";
import type { DiagnosisRelation, TrustedTenantContext } from "./types.js";

const TRUSTED: TrustedTenantContext = { tenantId: "tenant-fixture-a" };
const CONFIRMED_SKILL_ATTRIBUTION = "identity_tool_name";
const WEAK_SKILL_ATTRIBUTIONS = ["unique_owner", "prompt_named_use", "none"] as const;

const FIXTURE_FILES = {
  agentNotStarted: "agent-not-started.json",
  skillNotTriggered: "skill-not-triggered.json",
  skillTriggeredToolTimeout: "skill-triggered-tool-timeout.json",
  toolTimeoutUserRetry: "tool-timeout-user-retry.json",
  skillAttributionUncertain: "skill-attribution-uncertain.json",
  missingRouteEvidence: "inconclusive-missing-route-evidence.json",
} as const;

function loadAllFixtures(): Record<keyof typeof FIXTURE_FILES, GoldenDiagnosticRunGraph> {
  return {
    agentNotStarted: loadFixture(FIXTURE_FILES.agentNotStarted),
    skillNotTriggered: loadFixture(FIXTURE_FILES.skillNotTriggered),
    skillTriggeredToolTimeout: loadFixture(FIXTURE_FILES.skillTriggeredToolTimeout),
    toolTimeoutUserRetry: loadFixture(FIXTURE_FILES.toolTimeoutUserRetry),
    skillAttributionUncertain: loadFixture(FIXTURE_FILES.skillAttributionUncertain),
    missingRouteEvidence: loadFixture(FIXTURE_FILES.missingRouteEvidence),
  };
}

function validateGraph(graph: GoldenDiagnosticRunGraph): void {
  validateDiagnosticRun(graph.run, TRUSTED);
  for (const evidence of graph.evidences) {
    validateDiagnosticEvidence(evidence, TRUSTED);
  }
  for (const observation of graph.observations) {
    validateDiagnosticObservation(observation, TRUSTED);
  }
  for (const assessment of graph.assessments) {
    validateDiagnosticAssessment(assessment);
  }
  for (const attribution of graph.attributions) {
    validateDiagnosticAttribution(attribution, TRUSTED);
  }
  for (const hypothesis of graph.hypotheses) {
    validateDiagnosticHypothesis(hypothesis);
  }
  for (const finding of graph.findings) {
    validateDiagnosticFinding(finding, TRUSTED, {
      relations: graph.relations,
      attributions: graph.attributions,
    });
  }
  for (const relation of graph.relations) {
    validateDiagnosisRelation(relation);
  }
  validateDiagnosticCase(graph.case, TRUSTED);
  if (graph.verification) {
    validateDiagnosticVerification(graph.verification);
  }
}

function expectContractError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DiagnosisContractError);
    expect((err as DiagnosisContractError).code).toBe(code);
    return;
  }
  throw new Error(`expected DiagnosisContractError ${code}`);
}

function walkRecords(value: unknown, visit: (record: Record<string, unknown>) => void): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walkRecords(item, visit);
    }
    return;
  }
  const record = value as Record<string, unknown>;
  visit(record);
  for (const nested of Object.values(record)) {
    walkRecords(nested, visit);
  }
}

describe("Phase 1 vertical-slice scenario contract", () => {
  const fixtures = loadAllFixtures();

  it("loads every golden graph through Diagnosis Protocol validators", () => {
    for (const graph of Object.values(fixtures)) {
      expect(graph.schemaVersion).toBe(1);
      expect(graph.graphKind).toBe("DiagnosticRunGraph");
      expect(() => validateGraph(graph)).not.toThrow();
    }
  });

  it("returns INCONCLUSIVE when Route Evidence is missing", () => {
    const graph = fixtures.missingRouteEvidence;
    const run = validateDiagnosticRun(graph.run, TRUSTED);
    expect(run.status).toBe("completed");
    expect(run.completion).toBe("INCONCLUSIVE");
    expect(
      run.missingEvidence.some((req) => req.source === "route_resolution" && req.required),
    ).toBe(true);
    expect(graph.findings).toHaveLength(0);
    expect(
      graph.relations.filter(
        (relation) => relation.relation === "causes" && relation.state === "accepted",
      ),
    ).toHaveLength(0);
    expect(graph.hypotheses.every((hypothesis) => hypothesis.state === "unknown")).toBe(true);
    expect(graph.hypotheses.every((hypothesis) => hypothesis.confidence.rootCause === 0)).toBe(
      true,
    );
    expect(graph.verification).toBeNull();
    expect(graph.evidences.every((evidence) => evidence.source !== "route_resolution")).toBe(true);
  });

  it("rejects MODEL_INFERRED causes that are accepted", () => {
    const bad: DiagnosisRelation = {
      schemaVersion: 1,
      relationId: "rel-bad-model-causes",
      fromId: "obs-fixture-6-message-received",
      toId: "hyp-fixture-6-not-routed",
      relation: "causes",
      derivation: "MODEL_INFERRED",
      state: "accepted",
      confidence: 0.8,
      evidenceIds: ["ev-fixture-6-session-meta"],
    };
    expectContractError(() => validateDiagnosisRelation(bad), "model_inferred_not_candidate");
    expectContractError(
      () =>
        validateDiagnosisRelation({
          ...bad,
          state: "rejected",
        }),
      "model_inferred_not_candidate",
    );
    expect(
      validateDiagnosisRelation({
        ...bad,
        state: "candidate",
      }).state,
    ).toBe("candidate");
  });

  it("requires each Finding to reference existing Evidence", () => {
    for (const graph of Object.values(fixtures)) {
      const evidenceIds = new Set(graph.evidences.map((evidence) => evidence.evidenceId));
      for (const finding of graph.findings) {
        const validated = validateDiagnosticFinding(finding, TRUSTED);
        expect(validated.evidenceIds.length).toBeGreaterThanOrEqual(1);
        expect(validated.evidenceIds.every((id) => evidenceIds.has(id))).toBe(true);
      }
    }
  });

  it("keeps confidence fields independent", () => {
    const graph = fixtures.agentNotStarted;
    expect(graph.run.targets[0]?.targetId).toBe("session-fixture-1");
    const finding = graph.findings[0];
    expect(finding).toBeDefined();
    const confidence = validateConfidenceVector(finding?.confidence);
    expect(confidence.evidence).not.toBe(confidence.rootCause);
    const routed = graph.hypotheses.find((hypothesis) => hypothesis.code === "agent_not_routed");
    expect(routed?.state).toBe("unknown");
    expect(routed?.confidence.impact).toBeDefined();
    expect(confidence.assessment).not.toBe(confidence.impact);
    const mutated = validateConfidenceVector({
      ...confidence,
      evidence: 0.11,
    });
    expect(mutated.evidence).toBe(0.11);
    expect(mutated.assessment).toBe(confidence.assessment);
    expect(mutated.rootCause).toBe(confidence.rootCause);
    expect(mutated.impact).toBe(confidence.impact);
  });

  it("rejects an expired locator unless completeness is source_expired", () => {
    const evidence = fixtures.missingRouteEvidence.evidences[0];
    expect(evidence).toBeDefined();
    const now = new Date("2026-09-02T00:00:00.000Z");
    for (const completeness of ["complete", "partial", "unknown"] as const) {
      expectContractError(
        () =>
          validateDiagnosticEvidence(
            {
              ...evidence,
              payloadRef: {
                store: "session_store",
                recordId: "expired-locator-fixture",
                expiresAt: "2026-08-01T00:00:00.000Z",
              },
              collection: { ...evidence?.collection, completeness },
            },
            TRUSTED,
            { now },
          ),
        "source_expired",
      );
    }
    expect(
      validateDiagnosticEvidence(
        {
          ...evidence,
          payloadRef: {
            store: "session_store",
            recordId: "expired-locator-fixture",
            expiresAt: "2026-08-01T00:00:00.000Z",
          },
          collection: { ...evidence?.collection, completeness: "source_expired" },
        },
        TRUSTED,
        { now },
      ).collection.completeness,
    ).toBe("source_expired");
  });

  it("forbids diagnosis from writing runtime facts", () => {
    for (const graph of Object.values(fixtures)) {
      expect(graph.run.mutationPolicy).toBe("READ_ONLY");
    }
    for (const op of FORBIDDEN_RUNTIME_MUTATION_OPS) {
      expectContractError(() => assertNoRuntimeFactMutation(op), "runtime_fact_mutation");
    }
    expect(() => assertNoRuntimeFactMutation("index")).not.toThrow();
    expect(() => assertNoRuntimeFactMutation("reference")).not.toThrow();
  });

  it("has no UI or NLP dependency in the scenario contract", () => {
    expect(FORBIDDEN_UI_FIELD_KEYS).toEqual(["uiText", "reportMarkdown", "locale"]);
    for (const graph of Object.values(fixtures)) {
      walkRecords(graph, (record) => {
        for (const key of FORBIDDEN_UI_FIELD_KEYS) {
          expect(key in record).toBe(false);
        }
        expect(record.nlpIntent).toBeUndefined();
        expect(record.promptTemplate).toBeUndefined();
        expect(record.naturalLanguageQuery).toBeUndefined();
        expect(record.uiRoute).toBeUndefined();
      });
    }
    expectContractError(
      () =>
        validateDiagnosticRun(
          {
            ...fixtures.agentNotStarted.run,
            uiText: "should not exist",
          },
          TRUSTED,
        ),
      "ui_field_forbidden",
    );
  });

  it("merges tool timeout, agent failure, and user retry into one Case", () => {
    const graph = fixtures.toolTimeoutUserRetry;
    validateGraph(graph);
    expect(graph.run.caseId).toBe(graph.case.caseId);
    expect(graph.case.caseId).toBe("case-fixture-4");
    expect(graph.case.findingIds).toEqual(["find-fixture-4-tool-timeout-user-retry"]);
    expect(graph.findings).toHaveLength(1);
    expect(graph.findings[0]?.code).toBe("tool_timeout_user_retry");
    const predicates = new Set(graph.observations.map((observation) => observation.predicate));
    expect(predicates.has("tool.timeout")).toBe(true);
    expect(predicates.has("agent.run.failed")).toBe(true);
    expect(predicates.has("session.user_retry")).toBe(true);
    expect(graph.case.mergedObservationPredicates).toEqual([
      "tool.timeout",
      "agent.run.failed",
      "session.user_retry",
    ]);
    const kinds = graph.relations.map((relation) => relation.relation);
    expect(kinds).toContain("contributes_to");
    expect(kinds).toContain("correlated_with");
    expect(graph.verification?.expectedOutcome.user_retry_rate).toBe(0.1);
    expect(graph.verification?.expectedOutcome.tool_timeout_rate).toBe(0.2);
    expect(graph.verification?.measuredOutcome?.user_retry_rate).toBe(0.08);
    expect(graph.verification?.measuredOutcome?.tool_timeout_rate).toBe(0.12);
    expect(graph.verification?.verdict).toBe("improved");
    expect(kinds.filter((kind) => kind === "causes")).toHaveLength(1);
    expect(
      graph.relations.filter(
        (relation) => relation.relation === "causes" && relation.state === "accepted",
      ),
    ).toHaveLength(1);
  });

  it("does not treat unique_owner or prompt_named_use as confirmed skill identity", () => {
    const graph = fixtures.skillAttributionUncertain;
    validateGraph(graph);
    expect(graph.run.completion).toBe("PROBABLE");
    const resolutions = graph.observations
      .filter((observation) => observation.predicate === "skill.attributionResolution")
      .map((observation) => observation.value);
    expect(resolutions).toContain("unique_owner");
    expect(resolutions).toContain("prompt_named_use");
    expect(resolutions).not.toContain(CONFIRMED_SKILL_ATTRIBUTION);
    for (const attribution of graph.attributions) {
      expect(attribution.state).not.toBe("confirmed");
      expect(attribution.basis).not.toBe("runtime_identity");
    }
    expect(graph.attributions.some((attribution) => attribution.basis === "ownership_map")).toBe(
      true,
    );
    expect(graph.attributions.some((attribution) => attribution.basis === "model_suggestion")).toBe(
      true,
    );
    expect(graph.hypotheses.every((hypothesis) => hypothesis.state !== "confirmed")).toBe(true);
    for (const evidence of graph.evidences) {
      const resolution = evidence.collection.attributionResolution;
      expect(resolution).toBeDefined();
      expect(
        WEAK_SKILL_ATTRIBUTIONS.includes(resolution as (typeof WEAK_SKILL_ATTRIBUTIONS)[number]),
      ).toBe(true);
    }
  });
});
