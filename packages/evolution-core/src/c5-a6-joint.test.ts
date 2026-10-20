import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertDiagnosisRecheckResult,
  type DiagnosisRecheckOutcome,
  type DiagnosisRecheckResult,
} from "./diagnosis-recheck.js";
import {
  decideEvaluationOutcome,
  evaluationPolicyFor,
  type EvaluationPolicy,
  type EvaluationSignals,
} from "./evaluation-policy.js";

const verificationRef = {
  schemaVersion: 1 as const,
  proposalId: "prop-c5",
  experimentId: "exp-c5",
  applicationId: "app-c5",
  verificationId: "ver-c5",
};

function recheckFact(outcome: DiagnosisRecheckOutcome): DiagnosisRecheckResult {
  return assertDiagnosisRecheckResult({
    outcome,
    findingRefs: ["finding:c5"],
    target: { domain: "agent", agentId: "bot-c5" },
    verificationRef,
    observedEvidenceRefs: ["evidence:c5"],
    reasonCode: `recheck_${outcome.toLowerCase()}`,
  });
}

function policy(): EvaluationPolicy {
  const resolved = evaluationPolicyFor({
    surfaceId: "agent.working-dna",
    producerKind: "diagnosis-origin",
  });
  if ("ok" in resolved) {
    throw new Error("expected a phase-1 diagnosis policy");
  }
  return resolved;
}

function signals(recheck: DiagnosisRecheckOutcome | null): EvaluationSignals {
  return {
    experimentResult: "improved",
    guardrailDegraded: false,
    authorityOk: true,
    domainVerified: true,
    externalEffectOutcome: "verified",
    recheck,
    sampleSize: 20,
    confidence: 0.95,
    rollbackDrillPassed: true,
  };
}

describe("C5 A6 joint evaluation", () => {
  it("uses A recheck facts only as B EvaluationPolicy input and does not Apply", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const policySource = readFileSync(join(here, "evaluation-policy.ts"), "utf8");
    const factSource = readFileSync(join(here, "diagnosis-recheck.ts"), "utf8");
    expect(policySource).not.toContain("adapter.apply");
    expect(policySource).not.toContain("Adapter.apply");
    expect(factSource).not.toContain("adapter.apply");
    const diagnosis = policy();
    expect(decideEvaluationOutcome(diagnosis, signals(recheckFact("RESOLVED").outcome))).toEqual({
      action: "promote",
      reasonCode: "evaluation_passed",
    });
    expect(decideEvaluationOutcome(diagnosis, signals(recheckFact("STILL_OPEN").outcome))).toEqual({
      action: "hold",
      reasonCode: "finding_still_open",
    });
    expect(decideEvaluationOutcome(diagnosis, signals(recheckFact("REGRESSED").outcome))).toEqual({
      action: "rollback",
      reasonCode: "finding_regressed",
    });
    expect(
      decideEvaluationOutcome(diagnosis, signals(recheckFact("INCONCLUSIVE").outcome)),
    ).toEqual({ action: "observe", reasonCode: "recheck_inconclusive" });
    expect(decideEvaluationOutcome(diagnosis, signals(recheckFact("BLOCKED").outcome))).toEqual({
      action: "block",
      reasonCode: "recheck_blocked",
    });
  });
});
