import { describe, expect, it } from "vitest";
import {
  assertFindingNotModelOnlyP0,
  assertNoRuntimeFactMutation,
  canonicalTargetIdentity,
  DIAGNOSIS_COMPLETIONS,
  DIAGNOSIS_SCHEMA_VERSION,
  DiagnosisContractError,
  FORBIDDEN_UI_FIELD_KEYS,
  validateConfidenceVector,
  validateDiagnoserResult,
  validateDiagnosisPlan,
  validateDiagnosisPlanStep,
  validateDiagnosisRelation,
  EVIDENCE_SOURCE_IDS,
  validateDiagnosticEvidence,
  validateDiagnosticFinding,
  validateDiagnosticObservation,
  validateDiagnosticRecommendation,
  validateDiagnosticRun,
  validateDiagnosticTarget,
  validateEvidenceRequirement,
} from "./types.js";
import type {
  ConfidenceVector,
  DiagnosisPlanStep,
  DiagnosisRelation,
  DiagnosticAttribution,
  DiagnosticEvidence,
  DiagnosticFinding,
  DiagnosticObservation,
  DiagnosticRun,
  DiagnosticTarget,
  EvidenceRequirement,
  TrustedTenantContext,
} from "./types.js";

const trusted: TrustedTenantContext = { tenantId: "tenant-a" };

function validTarget(over: Partial<DiagnosticTarget> = {}): DiagnosticTarget {
  return {
    schemaVersion: 1,
    targetType: "session",
    targetId: "sess-1",
    tenantId: "tenant-a",
    authority: "src/sessions/transcript-events.ts",
    scope: { sessionKeyHash: "abc" },
    ...over,
  };
}

function validEvidenceReq(over: Partial<EvidenceRequirement> = {}): EvidenceRequirement {
  return {
    schemaVersion: 1,
    evidenceType: "event",
    source: "skill_invocation",
    targetType: "skill",
    fields: ["outcome"],
    sensitivity: "internal",
    cost: "low",
    required: true,
    ...over,
  };
}

function validRun(over: Partial<DiagnosticRun> = {}): DiagnosticRun {
  return {
    schemaVersion: 1,
    runId: "diag-run-1",
    diagnosedAgentRunId: null,
    mode: "QUICK",
    targets: [validTarget()],
    requestedBy: {
      schemaVersion: 1,
      principalId: "user-1",
      kind: "user",
      tenantId: "tenant-a",
    },
    mutationPolicy: "READ_ONLY",
    budget: { timeoutMs: 5_000, maxDiagnosers: 3, modelCalls: 0 },
    status: "completed",
    missingEvidence: [],
    startedAt: "2026-09-02T00:00:00.000Z",
    completedAt: "2026-09-02T00:00:01.000Z",
    ...over,
  };
}

function validEvidence(over: Partial<DiagnosticEvidence> = {}): DiagnosticEvidence {
  return {
    schemaVersion: 1,
    evidenceId: "ev-1",
    evidenceType: "event",
    source: "session_store",
    authority: "src/sessions/transcript-events.ts",
    authorityRecordId: "rec-1",
    observedAt: "2026-09-02T00:00:00.000Z",
    target: validTarget(),
    summary: { received: true },
    collection: {
      method: "event_adapter",
      completeness: "complete",
      attributionResolution: "not_applicable",
    },
    privacy: { classification: "internal", redacted: true },
    ...over,
  };
}

function validFinding(over: Partial<DiagnosticFinding> = {}): DiagnosticFinding {
  return {
    schemaVersion: 1,
    findingId: "f-1",
    code: "session_unrouted",
    title: "session_unrouted",
    target: validTarget(),
    status: "open",
    severity: "P2",
    primaryDomain: "agent_model",
    observationIds: ["obs-1"],
    assessmentIds: ["as-1"],
    attributionIds: ["at-1"],
    hypothesisIds: ["hy-1"],
    evidenceIds: ["ev-1"],
    confidence: { evidence: 0.9, assessment: 0.8, rootCause: 0.4, impact: 0.2 },
    fingerprint: "fp-1",
    firstSeenAt: "2026-09-02T00:00:00.000Z",
    lastSeenAt: "2026-09-02T00:00:00.000Z",
    completion: "CONFIRMED",
    ...over,
  };
}

function expectCode(fn: () => unknown, code: string): DiagnosisContractError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DiagnosisContractError);
    expect((err as DiagnosisContractError).code).toBe(code);
    return err as DiagnosisContractError;
  }
  throw new Error(`expected DiagnosisContractError ${code}`);
}

describe("Diagnosis Protocol v1", () => {
  describe("schemaVersion", () => {
    it("requires schemaVersion on Target", () => {
      const raw = { ...validTarget() } as Record<string, unknown>;
      delete raw.schemaVersion;
      expectCode(() => validateDiagnosticTarget(raw, trusted), "schema_version_required");
    });

    it("rejects schemaVersion other than 1", () => {
      expectCode(
        () => validateDiagnosticTarget({ ...validTarget(), schemaVersion: 2 }, trusted),
        "schema_version_invalid",
      );
    });

    it("accepts literal 1", () => {
      expect(validateDiagnosticTarget(validTarget(), trusted).schemaVersion).toBe(
        DIAGNOSIS_SCHEMA_VERSION,
      );
    });
  });

  describe("DiagnosticTarget", () => {
    it("rejects missing required identity fields", () => {
      expectCode(() => validateDiagnosticTarget({ schemaVersion: 1 }, trusted), "missing_field");
      expectCode(
        () =>
          validateDiagnosticTarget(
            { ...validTarget(), targetType: undefined } as unknown as DiagnosticTarget,
            trusted,
          ),
        "missing_field",
      );
      const noAuthority = { ...validTarget() } as Record<string, unknown>;
      delete noAuthority.authority;
      expectCode(() => validateDiagnosticTarget(noAuthority, trusted), "missing_field");
      const noScope = { ...validTarget() } as Record<string, unknown>;
      delete noScope.scope;
      expectCode(() => validateDiagnosticTarget(noScope, trusted), "invalid_type");
    });

    it("rejects version=latest", () => {
      expectCode(
        () => validateDiagnosticTarget({ ...validTarget(), version: "latest" }, trusted),
        "invalid_version",
      );
    });

    it("rejects client tenant that does not match trusted context", () => {
      expectCode(
        () => validateDiagnosticTarget({ ...validTarget(), tenantId: "other-tenant" }, trusted),
        "tenant_mismatch",
      );
    });

    it("accepts matching null tenant", () => {
      const local: TrustedTenantContext = { tenantId: null };
      const target = validateDiagnosticTarget({ ...validTarget(), tenantId: null }, local);
      expect(target.tenantId).toBeNull();
    });

    it("canonical identity is targetId + targetType + authority + tenantId", () => {
      const a = validTarget({ targetId: "x", targetType: "skill" });
      const b = validTarget({ targetId: "x", targetType: "tool" });
      const withCapability: DiagnosticTarget = { ...a, capability: "execute" };
      expect(canonicalTargetIdentity(a)).not.toBe(canonicalTargetIdentity(b));
      expect(canonicalTargetIdentity(a)).toBe(canonicalTargetIdentity(withCapability));
    });
  });

  describe("DiagnosticRun", () => {
    it("keeps diagnosis runId distinct from diagnosedAgentRunId", () => {
      expectCode(
        () =>
          validateDiagnosticRun(
            validRun({
              runId: "same-id",
              diagnosedAgentRunId: "same-id",
              targets: [validTarget({ targetType: "run", targetId: "same-id" })],
            }),
            trusted,
          ),
        "run_id_collision",
      );
    });

    it("requires diagnosedAgentRunId when a target is a run", () => {
      expectCode(
        () =>
          validateDiagnosticRun(
            validRun({
              diagnosedAgentRunId: null,
              targets: [validTarget({ targetType: "run", targetId: "agent-run-9" })],
            }),
            trusted,
          ),
        "missing_field",
      );
    });

    it("status=completed does not imply a root cause", () => {
      const run = validateDiagnosticRun(validRun({ status: "completed" }), trusted);
      expect(run.status).toBe("completed");
      expect(run.completion).toBeUndefined();
    });

    it("validates INCONCLUSIVE, BLOCKED, and TIMED_OUT completions", () => {
      expect(DIAGNOSIS_COMPLETIONS).toEqual([
        "CONFIRMED",
        "PROBABLE",
        "INCONCLUSIVE",
        "BLOCKED",
        "TIMED_OUT",
      ]);
      expectCode(
        () =>
          validateDiagnosticRun(
            validRun({ completion: "INCONCLUSIVE", missingEvidence: [] }),
            trusted,
          ),
        "missing_evidence_required",
      );
      const inconclusive = validateDiagnosticRun(
        validRun({
          completion: "INCONCLUSIVE",
          missingEvidence: [validEvidenceReq({ source: "route_resolution" })],
        }),
        trusted,
      );
      expect(inconclusive.completion).toBe("INCONCLUSIVE");

      expectCode(
        () => validateDiagnosticRun(validRun({ completion: "BLOCKED" }), trusted),
        "missing_field",
      );
      const blocked = validateDiagnosticRun(
        validRun({ completion: "BLOCKED", blockReason: "permission_denied" }),
        trusted,
      );
      expect(blocked.blockReason).toBe("permission_denied");

      expectCode(
        () => validateDiagnosticRun(validRun({ completion: "TIMED_OUT" }), trusted),
        "invalid_type",
      );
      const timedOut = validateDiagnosticRun(
        validRun({
          completion: "TIMED_OUT",
          budgetSnapshot: {
            timeoutMs: 5_000,
            maxDiagnosers: 3,
            modelCalls: 0,
            elapsedMs: 5_001,
            diagnosersUsed: 2,
            modelCallsUsed: 0,
          },
        }),
        trusted,
      );
      expect(timedOut.completion).toBe("TIMED_OUT");
      expect(timedOut.budgetSnapshot?.elapsedMs).toBe(5_001);
    });
  });

  describe("DiagnosticEvidence", () => {
    it("rejects missing authority / authorityRecordId", () => {
      const noAuthority = { ...validEvidence() } as Record<string, unknown>;
      delete noAuthority.authority;
      expectCode(() => validateDiagnosticEvidence(noAuthority, trusted), "missing_field");
      const noRecord = { ...validEvidence() } as Record<string, unknown>;
      delete noRecord.authorityRecordId;
      expectCode(() => validateDiagnosticEvidence(noRecord, trusted), "missing_field");
    });

    it("requires an explicit attributionResolution on every Evidence", () => {
      expectCode(
        () =>
          validateDiagnosticEvidence(
            {
              ...validEvidence(),
              source: "skill_invocation",
              collection: { method: "event_adapter", completeness: "partial" },
            } as Record<string, unknown>,
            trusted,
          ),
        "missing_field",
      );
      expectCode(
        () =>
          validateDiagnosticEvidence(
            validEvidence({
              source: "skill_invocation",
              collection: {
                method: "query",
                completeness: "partial",
                attributionResolution: "not_applicable",
              },
            }),
            trusted,
          ),
        "attribution_resolution_required",
      );
      expectCode(
        () =>
          validateDiagnosticEvidence(
            validEvidence({
              source: "session_store",
              collection: {
                method: "query",
                completeness: "complete",
                attributionResolution: "unknown",
              },
            }),
            trusted,
          ),
        "attribution_resolution_invalid",
      );
      const skill = validateDiagnosticEvidence(
        validEvidence({
          source: "skill_invocation",
          collection: {
            method: "query",
            completeness: "partial",
            attributionResolution: "identity_tool_name",
          },
        }),
        trusted,
      );
      expect(skill.collection.attributionResolution).toBe("identity_tool_name");
      expect(
        validateDiagnosticEvidence(validEvidence(), trusted).collection.attributionResolution,
      ).toBe("not_applicable");
    });

    it("rejects kebab-case Evidence Source ids", () => {
      expect(EVIDENCE_SOURCE_IDS.every((id) => !id.includes("-"))).toBe(true);
      expectCode(
        () =>
          validateDiagnosticEvidence({ ...validEvidence(), source: "skill-invocation" }, trusted),
        "invalid_literal",
      );
      expectCode(
        () =>
          validateEvidenceRequirement({
            ...validEvidenceReq(),
            source: "route-resolution",
          }),
        "invalid_literal",
      );
    });

    it("requires completeness=source_expired after locator expiry", () => {
      const now = new Date("2026-09-02T12:00:00.000Z");
      const expiredRef = {
        store: "session-jsonl",
        recordId: "row-1",
        expiresAt: "2026-09-01T00:00:00.000Z",
      };
      for (const completeness of ["complete", "partial", "unknown"] as const) {
        expectCode(
          () =>
            validateDiagnosticEvidence(
              validEvidence({
                payloadRef: expiredRef,
                collection: {
                  method: "query",
                  completeness,
                  attributionResolution: "not_applicable",
                },
              }),
              trusted,
              { now },
            ),
          "source_expired",
        );
      }
      const expired = validateDiagnosticEvidence(
        validEvidence({
          payloadRef: expiredRef,
          collection: {
            method: "query",
            completeness: "source_expired",
            attributionResolution: "not_applicable",
          },
        }),
        trusted,
        { now },
      );
      expect(expired.collection.completeness).toBe("source_expired");
    });
  });

  describe("confidence fields", () => {
    it("stores evidence, assessment, rootCause, and impact independently", () => {
      const confidence = validateConfidenceVector({
        evidence: 0.99,
        assessment: 0.5,
        rootCause: 0.21,
        impact: 0.1,
      });
      const mutated: ConfidenceVector = { ...confidence, evidence: 0.01 };
      expect(confidence.evidence).toBe(0.99);
      expect(mutated.assessment).toBe(0.5);
      expect(mutated.rootCause).toBe(0.21);
      expect(mutated.impact).toBe(0.1);
      expect(mutated.evidence).not.toBe(confidence.evidence);
    });

    it("requires impact on every ConfidenceVector", () => {
      expectCode(
        () =>
          validateConfidenceVector({
            evidence: 0.9,
            assessment: 0.8,
            rootCause: 0.4,
          }),
        "missing_field",
      );
    });
  });

  describe("DiagnosisRelation", () => {
    const base: DiagnosisRelation = {
      schemaVersion: 1,
      relationId: "rel-1",
      fromId: "a",
      toId: "b",
      relation: "causes",
      derivation: "MODEL_INFERRED",
      state: "candidate",
      confidence: 0.4,
      evidenceIds: [],
    };

    it("allows MODEL_INFERRED + causes only as candidate", () => {
      expect(validateDiagnosisRelation(base).state).toBe("candidate");
      expectCode(
        () => validateDiagnosisRelation({ ...base, state: "accepted" }),
        "model_inferred_not_candidate",
      );
    });

    it("accepts causes only for evidence/rule/human derivation", () => {
      expect(
        validateDiagnosisRelation({
          ...base,
          derivation: "EVIDENCE_DERIVED",
          state: "accepted",
          evidenceIds: ["ev-1"],
        }).state,
      ).toBe("accepted");
      expect(
        validateDiagnosisRelation({
          ...base,
          derivation: "RULE_DERIVED",
          state: "accepted",
          ruleId: "rule.causes.v1",
          ruleVersion: "1",
        }).state,
      ).toBe("accepted");
      expect(
        validateDiagnosisRelation({
          ...base,
          derivation: "HUMAN_CONFIRMED",
          state: "accepted",
          confirmationRef: "audit:human-confirm-1",
        }).state,
      ).toBe("accepted");
    });

    it("rejects accepted causes that lack an auditable evidence or rule/human citation", () => {
      expectCode(
        () =>
          validateDiagnosisRelation({
            ...base,
            derivation: "EVIDENCE_DERIVED",
            state: "accepted",
            evidenceIds: [],
          }),
        "accepted_causes_evidence_required",
      );
      expectCode(
        () =>
          validateDiagnosisRelation({
            ...base,
            derivation: "RULE_DERIVED",
            state: "accepted",
            evidenceIds: [],
          }),
        "accepted_causes_rule_audit_required",
      );
      expectCode(
        () =>
          validateDiagnosisRelation({
            ...base,
            derivation: "HUMAN_CONFIRMED",
            state: "accepted",
            evidenceIds: [],
          }),
        "accepted_causes_confirmation_required",
      );
    });
  });

  describe("Finding / Observation evidence gates", () => {
    it("requires evidenceIds for CONFIRMED findings", () => {
      expectCode(
        () => validateDiagnosticFinding({ ...validFinding(), evidenceIds: [] }, trusted),
        "evidence_required",
      );
    });

    it("allows empty evidenceIds for INCONCLUSIVE when missingEvidence is present", () => {
      const finding = validateDiagnosticFinding(
        {
          ...validFinding(),
          completion: "INCONCLUSIVE",
          evidenceIds: [],
          missingEvidence: [validEvidenceReq({ source: "route_resolution" })],
        },
        trusted,
      );
      expect(finding.completion).toBe("INCONCLUSIVE");
    });

    it("requires Observation.evidenceIds length >= 1", () => {
      const observation: DiagnosticObservation = {
        schemaVersion: 1,
        observationId: "obs-1",
        target: validTarget(),
        predicate: "skill.started",
        value: false,
        evidenceIds: [],
        observedAt: "2026-09-02T00:00:00.000Z",
      };
      expectCode(() => validateDiagnosticObservation(observation, trusted), "evidence_required");
    });

    it("rejects validateDiagnosticFinding(raw, trusted) for model-only P0 without support", () => {
      const finding = validFinding({ severity: "P0" });
      expectCode(() => validateDiagnosticFinding(finding, trusted), "p0_support_required");
      expectCode(
        () => validateDiagnosticFinding(finding, trusted, { relations: [] }),
        "p0_support_required",
      );
      expectCode(
        () => validateDiagnosticFinding(finding, trusted, { attributions: [] }),
        "p0_support_required",
      );
      expectCode(
        () => validateDiagnosticFinding(finding, trusted, { relations: [], attributions: [] }),
        "model_only_p0",
      );
    });

    it("rejects P0 produced solely by MODEL_INFERRED / model_suggestion", () => {
      const finding = validFinding({
        severity: "P0",
        attributionIds: ["at-model"],
      });
      const attribution: DiagnosticAttribution = {
        schemaVersion: 1,
        attributionId: "at-model",
        assessmentId: "as-1",
        suspectedTarget: validTarget({ targetType: "skill", targetId: "skill-router" }),
        responsibilityDomain: "skill_tool",
        state: "suspected",
        basis: "model_suggestion",
      };
      const relation: DiagnosisRelation = {
        schemaVersion: 1,
        relationId: "rel-p0",
        fromId: finding.findingId,
        toId: "hy-1",
        relation: "causes",
        derivation: "MODEL_INFERRED",
        state: "candidate",
        confidence: 0.7,
        evidenceIds: ["ev-1"],
      };
      expectCode(
        () =>
          assertFindingNotModelOnlyP0({
            finding,
            attributions: [attribution],
            relations: [relation],
          }),
        "model_only_p0",
      );
      expect(() =>
        assertFindingNotModelOnlyP0({
          finding,
          attributions: [{ ...attribution, basis: "runtime_identity" }],
          relations: [relation],
        }),
      ).not.toThrow();
      expectCode(() => validateDiagnosticFinding(finding, trusted), "p0_support_required");
      expectCode(() => validateDiagnosticFinding(finding, trusted, {}), "p0_support_required");
      expectCode(
        () =>
          validateDiagnosticFinding(finding, trusted, {
            relations: [relation],
            attributions: [attribution],
          }),
        "model_only_p0",
      );
      expectCode(
        () =>
          validateDiagnoserResult(
            {
              schemaVersion: 1,
              observations: [],
              assessments: [],
              attributions: [attribution],
              hypotheses: [],
              findingDrafts: [finding],
              relationCandidates: [relation],
              nextEvidenceRequests: [],
            },
            trusted,
          ),
        "model_only_p0",
      );
      expectCode(
        () =>
          validateDiagnoserResult(
            {
              schemaVersion: 1,
              observations: [],
              assessments: [],
              attributions: [],
              hypotheses: [],
              findingDrafts: [finding],
              relationCandidates: [],
              nextEvidenceRequests: [],
            },
            trusted,
          ),
        "model_only_p0",
      );
      expectCode(
        () =>
          validateDiagnosticRecommendation(
            {
              schemaVersion: 1,
              recommendationId: "rec-1",
              findingId: finding.findingId,
              code: "suggest_inspect",
              executorCapability: "none",
              mutationPolicy: "SUGGEST",
            },
            finding,
          ),
        "p0_support_required",
      );
      expectCode(
        () =>
          validateDiagnosticRecommendation(
            {
              schemaVersion: 1,
              recommendationId: "rec-1",
              findingId: finding.findingId,
              code: "suggest_inspect",
              executorCapability: "none",
              mutationPolicy: "SUGGEST",
            },
            finding,
            { relations: [relation], attributions: [attribution] },
          ),
        "model_only_p0",
      );
    });

    it("rejects P0 propped up by accepted causes with empty evidenceIds", () => {
      const finding = validFinding({ severity: "P0" });
      const emptyEvidenceCause: DiagnosisRelation = {
        schemaVersion: 1,
        relationId: "rel-empty-evidence",
        fromId: finding.findingId,
        toId: "hy-1",
        relation: "causes",
        derivation: "EVIDENCE_DERIVED",
        state: "accepted",
        confidence: 0.9,
        evidenceIds: [],
      };
      expectCode(
        () => validateDiagnosisRelation(emptyEvidenceCause),
        "accepted_causes_evidence_required",
      );
      expectCode(
        () =>
          validateDiagnosticFinding(finding, trusted, {
            relations: [emptyEvidenceCause],
            attributions: [
              {
                schemaVersion: 1,
                attributionId: "at-model",
                assessmentId: "as-1",
                suspectedTarget: validTarget({ targetType: "skill", targetId: "skill-router" }),
                responsibilityDomain: "skill_tool",
                state: "suspected",
                basis: "model_suggestion",
              },
            ],
          }),
        "model_only_p0",
      );
    });
  });

  describe("runtime fact mutation", () => {
    it("rejects write-back of original runtime facts", () => {
      for (const op of [
        "update_session",
        "update_skill_invocation",
        "update_transcript",
        "update_otel",
        "doctor_fix",
        "restart_gateway",
        "replay_tool",
      ] as const) {
        expectCode(() => assertNoRuntimeFactMutation(op), "runtime_fact_mutation");
      }
      expect(() => assertNoRuntimeFactMutation("index")).not.toThrow();
      expect(() => assertNoRuntimeFactMutation("snapshot_summary")).not.toThrow();
      expect(() => assertNoRuntimeFactMutation("content_hash")).not.toThrow();
      expect(() => assertNoRuntimeFactMutation("reference")).not.toThrow();
    });
  });

  describe("no UI / NLP protocol fields", () => {
    it("rejects uiText, reportMarkdown, and locale on a representative Finding", () => {
      expect(FORBIDDEN_UI_FIELD_KEYS).toEqual(["uiText", "reportMarkdown", "locale"]);
      const finding = validFinding();
      expect("uiText" in finding).toBe(false);
      expect("reportMarkdown" in finding).toBe(false);
      expect("locale" in finding).toBe(false);
      expectCode(
        () => validateDiagnosticFinding({ ...finding, uiText: "hello" }, trusted),
        "ui_field_forbidden",
      );
      expectCode(
        () => validateDiagnosticFinding({ ...finding, reportMarkdown: "# report" }, trusted),
        "ui_field_forbidden",
      );
      expectCode(
        () => validateDiagnosticFinding({ ...finding, locale: "zh-CN" }, trusted),
        "ui_field_forbidden",
      );
    });
  });

  describe("Planner / Diagnoser contract", () => {
    it("lets a plan step request a Diagnoser and/or an Evidence Source", () => {
      const diagnoserOnly = validateDiagnosisPlanStep({
        schemaVersion: 1,
        stepId: "s1",
        hypothesisIds: ["hy-1"],
        diagnoserId: "skill-runtime",
        evidenceRequests: [validEvidenceReq()],
        expectedInformationGain: "high",
        stopWhen: ["root_cause_confirmed"],
      });
      expect(diagnoserOnly.diagnoserId).toBe("skill-runtime");

      const sourceOnly: DiagnosisPlanStep = validateDiagnosisPlanStep({
        schemaVersion: 1,
        stepId: "s2",
        hypothesisIds: ["hy-1"],
        evidenceSourceId: "route_resolution",
        evidenceRequests: [validEvidenceReq({ source: "route_resolution", targetType: "session" })],
        expectedInformationGain: "high",
        stopWhen: ["route_known"],
      });
      expect(sourceOnly.evidenceSourceId).toBe("route_resolution");

      const both = validateDiagnosisPlan({
        schemaVersion: 1,
        planId: "plan-1",
        runId: "diag-run-1",
        mode: "QUICK",
        steps: [
          {
            schemaVersion: 1,
            stepId: "s3",
            hypothesisIds: [],
            diagnoserId: "trace-interaction",
            evidenceSourceId: "skill_invocation",
            evidenceRequests: [validEvidenceReq()],
            expectedInformationGain: "medium",
            stopWhen: [],
          },
        ],
      });
      expect(both.steps[0]?.diagnoserId).toBe("trace-interaction");
      expect(both.steps[0]?.evidenceSourceId).toBe("skill_invocation");

      expectCode(
        () =>
          validateDiagnosisPlanStep({
            schemaVersion: 1,
            stepId: "s-empty",
            hypothesisIds: [],
            evidenceRequests: [],
            expectedInformationGain: "low",
            stopWhen: [],
          }),
        "plan_step_request_required",
      );
    });

    it("rejects DiagnoserResult mutation / execute fields", () => {
      expectCode(
        () =>
          validateDiagnoserResult(
            {
              schemaVersion: 1,
              observations: [],
              assessments: [],
              attributions: [],
              hypotheses: [],
              findingDrafts: [],
              relationCandidates: [],
              nextEvidenceRequests: [],
              remediationExecute: true,
            },
            trusted,
          ),
        "diagnoser_mutation_forbidden",
      );
    });
  });

  describe("EvidenceRequirement", () => {
    it("round-trips a valid requirement", () => {
      expect(validateEvidenceRequirement(validEvidenceReq()).source).toBe("skill_invocation");
    });
  });
});
