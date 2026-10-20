import { describe, expect, it } from "vitest";
import {
  canApproveApplication,
  canHold,
  canMarkVerified,
  canPromote,
  evaluateExperiment,
} from "./decisions.js";
import { workingDnaMetricSet } from "./metrics.js";
import type { MetricContract } from "./types.js";

const metrics = workingDnaMetricSet();

function sample(
  contract: MetricContract,
  baseline: number,
  treatment: number,
): { contract: MetricContract; baseline: number; treatment: number } {
  return { contract, baseline, treatment };
}

function guardrails(overrides: Record<string, { baseline: number; treatment: number }> = {}) {
  return metrics.guardrails.map((contract) => {
    const over = overrides[contract.metricId];
    return sample(contract, over?.baseline ?? 0, over?.treatment ?? 0);
  });
}

describe("experiment accept gate", () => {
  it("returns inconclusive when the sample is too small", () => {
    const decision = evaluateExperiment({
      primary: sample(metrics.primary, 0.7, 0.8),
      guardrails: guardrails(),
      sampleSize: 3,
      minimumSampleSize: 20,
      confidence: null,
      requiredConfidence: 0.9,
      baselineContaminated: false,
      modelVersionChanged: false,
      rollbackDrill: "passed",
      assessmentMode: "deterministic-fixture",
    });
    expect(decision.result).toBe("inconclusive");
    expect(decision.reasons).toContain("sample_size_insufficient");
  });

  it("returns inconclusive when the baseline is contaminated or the model changed", () => {
    const contaminated = evaluateExperiment({
      primary: sample(metrics.primary, 0.7, 0.8),
      guardrails: guardrails(),
      sampleSize: 40,
      minimumSampleSize: 20,
      confidence: null,
      requiredConfidence: 0.9,
      baselineContaminated: true,
      modelVersionChanged: false,
      rollbackDrill: "passed",
      assessmentMode: "deterministic-fixture",
    });
    expect(contaminated.result).toBe("inconclusive");
    const modelChanged = evaluateExperiment({
      primary: sample(metrics.primary, 0.7, 0.8),
      guardrails: guardrails(),
      sampleSize: 40,
      minimumSampleSize: 20,
      confidence: null,
      requiredConfidence: 0.9,
      baselineContaminated: false,
      modelVersionChanged: true,
      rollbackDrill: "passed",
      assessmentMode: "deterministic-fixture",
    });
    expect(modelChanged.result).toBe("inconclusive");
  });

  it("rejects critical guardrail regression even when the primary improved", () => {
    const decision = evaluateExperiment({
      primary: sample(metrics.primary, 0.7, 0.85),
      guardrails: guardrails({
        security_violations: { baseline: 0, treatment: 1 },
      }),
      sampleSize: 40,
      minimumSampleSize: 20,
      confidence: null,
      requiredConfidence: 0.9,
      baselineContaminated: false,
      modelVersionChanged: false,
      rollbackDrill: "passed",
      assessmentMode: "deterministic-fixture",
    });
    expect(decision.result).toBe("regressed");
    expect(decision.reasons[0]).toMatch(/critical_guardrail:security_violations/);
  });

  it("accepts improved when primary, guardrails, sample, confidence, and rollback drill pass", () => {
    const decision = evaluateExperiment({
      primary: sample(metrics.primary, 0.7, 0.74),
      guardrails: guardrails(),
      sampleSize: 40,
      minimumSampleSize: 20,
      confidence: null,
      requiredConfidence: 0.9,
      baselineContaminated: false,
      modelVersionChanged: false,
      rollbackDrill: "passed",
      assessmentMode: "deterministic-fixture",
    });
    expect(decision.result).toBe("improved");
    expect(decision.primaryEffect).toBeCloseTo(0.04);
  });

  it("does not treat a linked receipt as VERIFIED", () => {
    expect(
      canMarkVerified({
        outcome: "inconclusive",
        sampleSize: 40,
        minimumSampleSize: 20,
      }).ok,
    ).toBe(false);
    const frozen = {
      status: "frozen" as const,
      primaryPresent: true,
      missingCriticalGuardrails: [] as string[],
    };
    expect(canApproveApplication({ result: "pending" }).ok).toBe(false);
    expect(canApproveApplication({ result: "pending" }, undefined, "canary").ok).toBe(false);
    expect(
      canApproveApplication(
        { result: "pending", baselineCapture: frozen, candidateValidated: true },
        undefined,
        "canary",
      ).ok,
    ).toBe(true);
    expect(
      canApproveApplication(
        { result: "inconclusive", baselineCapture: frozen, candidateValidated: true },
        undefined,
        "canary",
      ).ok,
    ).toBe(true);
    expect(
      canApproveApplication(
        { result: "regressed", baselineCapture: frozen, candidateValidated: true },
        undefined,
        "canary",
      ).ok,
    ).toBe(false);
    expect(canApproveApplication({ result: "inconclusive" }, undefined, "shadow").ok).toBe(true);
    expect(canApproveApplication({ result: "improved" }).ok).toBe(true);
    expect(canPromote({ status: "ACTIVE", verificationId: "ver:1", riskLevel: "medium" }).ok).toBe(
      false,
    );
    expect(
      canPromote({ status: "VERIFIED", verificationId: "ver:1", riskLevel: "medium" }).ok,
    ).toBe(true);
    expect(
      canPromote({ status: "VERIFIED", verificationId: "ver:1", riskLevel: "critical" }).ok,
    ).toBe(false);
    expect(canHold({ status: "EXPERIMENTING", experimentId: "exp:1" }).ok).toBe(true);
    expect(canHold({ status: "CANARY", experimentId: "exp:1" }).ok).toBe(false);
  });
});
