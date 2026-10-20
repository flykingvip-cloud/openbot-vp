import { describe, expect, it } from "vitest";
import {
  decideEvaluationOutcome,
  evaluationPolicyFor,
  evaluationProducerKindFromMechanism,
  isPhase1EvaluationSurface,
  type EvaluationPolicy,
  type EvaluationSignals,
} from "./evaluation-policy.js";

function policy(producer: "diagnosis-origin" | "pattern-origin"): EvaluationPolicy {
  const resolved = evaluationPolicyFor({
    surfaceId: "agent.working-dna",
    producerKind: producer,
  });
  if ("ok" in resolved) {
    throw new Error("expected phase-1 policy");
  }
  return resolved;
}

function signals(over: Partial<EvaluationSignals> = {}): EvaluationSignals {
  return {
    experimentResult: "improved",
    guardrailDegraded: false,
    authorityOk: true,
    domainVerified: true,
    externalEffectOutcome: "verified",
    recheck: "RESOLVED",
    sampleSize: 20,
    confidence: 0.95,
    rollbackDrillPassed: true,
    ...over,
  };
}

describe("evaluation policy", () => {
  it("requires diagnosis recheck only for diagnosis-origin producers", () => {
    const diagnosis = policy("diagnosis-origin");
    const pattern = policy("pattern-origin");
    expect(diagnosis.diagnosisRecheckPolicy).toBe("required");
    expect(diagnosis.requiredSignals).toContain("diagnosis_recheck");
    expect(pattern.diagnosisRecheckPolicy).toBe("unsupported");
    expect(pattern.requiredSignals).not.toContain("diagnosis_recheck");
    expect(isPhase1EvaluationSurface("capability.skill-installation")).toBe(true);
    expect(isPhase1EvaluationSurface("organization.task-routing")).toBe(false);
  });

  it("promotes non-diagnosis-origin when recheck is absent and all gates pass", () => {
    const decision = decideEvaluationOutcome(policy("pattern-origin"), signals({ recheck: null }));
    expect(decision).toEqual({ action: "promote", reasonCode: "evaluation_passed" });
  });

  it("maps diagnosis recheck outcomes without a global three-vote shortcut", () => {
    const diagnosis = policy("diagnosis-origin");
    expect(decideEvaluationOutcome(diagnosis, signals({ recheck: "STILL_OPEN" }))).toEqual({
      action: "hold",
      reasonCode: "finding_still_open",
    });
    expect(decideEvaluationOutcome(diagnosis, signals({ recheck: "REGRESSED" }))).toEqual({
      action: "rollback",
      reasonCode: "finding_regressed",
    });
    expect(decideEvaluationOutcome(diagnosis, signals({ recheck: "INCONCLUSIVE" }))).toEqual({
      action: "observe",
      reasonCode: "recheck_inconclusive",
    });
    expect(decideEvaluationOutcome(diagnosis, signals({ recheck: "BLOCKED" }))).toEqual({
      action: "block",
      reasonCode: "recheck_blocked",
    });
    expect(decideEvaluationOutcome(diagnosis, signals({ recheck: null }))).toEqual({
      action: "block",
      reasonCode: "recheck_required",
    });
  });

  it("rolls back when a guardrail degrades even if the finding resolved", () => {
    expect(
      decideEvaluationOutcome(
        policy("diagnosis-origin"),
        signals({ guardrailDegraded: true, recheck: "RESOLVED" }),
      ),
    ).toEqual({ action: "rollback", reasonCode: "guardrail_degraded" });
  });

  it("rolls back a regressed experiment even when the rollback drill is missing", () => {
    expect(
      decideEvaluationOutcome(
        policy("diagnosis-origin"),
        signals({ experimentResult: "regressed", rollbackDrillPassed: false }),
      ),
    ).toEqual({ action: "rollback", reasonCode: "experiment_regressed" });
  });

  it("rolls back a contradicted external effect even when the sample is insufficient", () => {
    expect(
      decideEvaluationOutcome(
        policy("diagnosis-origin"),
        signals({
          externalEffectOutcome: "contradicted",
          sampleSize: 3,
          confidence: null,
        }),
      ),
    ).toEqual({ action: "rollback", reasonCode: "external_effect_contradicted" });
  });

  it("rolls back a regressed finding even when the rollback drill is missing", () => {
    expect(
      decideEvaluationOutcome(
        policy("diagnosis-origin"),
        signals({ recheck: "REGRESSED", rollbackDrillPassed: false }),
      ),
    ).toEqual({ action: "rollback", reasonCode: "finding_regressed" });
  });

  it("observes an improved result when only the rollback drill is missing", () => {
    expect(
      decideEvaluationOutcome(policy("diagnosis-origin"), signals({ rollbackDrillPassed: false })),
    ).toEqual({ action: "observe", reasonCode: "rollback_drill_not_run" });
  });

  it("stays inconclusive when the sample is insufficient and no negative fact exists", () => {
    expect(
      decideEvaluationOutcome(
        policy("diagnosis-origin"),
        signals({ sampleSize: 3, confidence: null }),
      ),
    ).toEqual({ action: "observe", reasonCode: "sample_insufficient" });
  });

  it("inventories other surfaces without a promote policy", () => {
    expect(
      evaluationPolicyFor({
        surfaceId: "organization.task-routing",
        producerKind: "diagnosis-origin",
      }),
    ).toEqual({ ok: false, code: "unknown_surface" });
  });

  it("classifies diagnosis mechanisms as diagnosis-origin and leaves ingestV1 as operator-origin", () => {
    expect(evaluationProducerKindFromMechanism("diagnosis.behavior.reporting_cadence_gap")).toBe(
      "diagnosis-origin",
    );
    expect(evaluationProducerKindFromMechanism("pattern-detection")).toBe("pattern-origin");
    expect(evaluationProducerKindFromMechanism("aud:evo:dna-promote")).toBe("operator-origin");
  });
});
