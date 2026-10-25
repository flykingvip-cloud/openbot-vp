/**
 * A5 dual-center closed-loop evidence helpers (fixture / ControllableTestSite layer).
 *
 * Orchestrates evidence collection across existing A1–A4 / E3 / E5 surfaces.
 * Does not open a third center, does not enable formal execution access, and
 * does not claim enterprise external-site sessions or R5 PASS.
 */

export const SAR_A5_BROWSER_EVIDENCE_LEVEL = {
  /** ControllableTestSite / fixture-bridge control plane. Not a live CDP enterprise session. */
  fixtureTestSite: "fixture-test-site",
  /** Reserved for a logged-in enterprise external site (not claimed by A5). */
  externalSite: "external-site",
} as const;

export type SarA5BrowserEvidenceLevel =
  (typeof SAR_A5_BROWSER_EVIDENCE_LEVEL)[keyof typeof SAR_A5_BROWSER_EVIDENCE_LEVEL];

export const SAR_A5_STEPS = [
  "access",
  "validation",
  "audit_assign",
  "supply",
  "fault_trace",
] as const;

export type SarA5StepId = (typeof SAR_A5_STEPS)[number];

export type SarA5StepEvidence = {
  step: SarA5StepId;
  ok: boolean;
  /** Correlatable ids (traceId / runId / audit subject / validation record). */
  evidenceIds: Record<string, string>;
  notes: string;
};

export type SarA5LoopEvidence = {
  browserEvidenceLevel: SarA5BrowserEvidenceLevel;
  loopId: string;
  steps: SarA5StepEvidence[];
  correlatable: boolean;
  /** Explicit non-claims for reports / PR review. */
  nonClaims: string[];
};

export const SAR_A5_NON_CLAIMS = [
  "E0–E5 product-ready / overall gate PASS",
  "R5 live external-site readonly session PASS",
  "Enterprise external website access fully connected",
  "Formal execution access switch enabled",
] as const;

export function buildSarA5LoopEvidence(params: {
  loopId: string;
  browserEvidenceLevel: SarA5BrowserEvidenceLevel;
  steps: SarA5StepEvidence[];
}): SarA5LoopEvidence {
  const byStep = new Map(params.steps.map((step) => [step.step, step]));
  const ordered = SAR_A5_STEPS.map((id) => {
    const found = byStep.get(id);
    if (!found) {
      return {
        step: id,
        ok: false,
        evidenceIds: {},
        notes: "missing step evidence",
      } satisfies SarA5StepEvidence;
    }
    return found;
  });
  const correlatable =
    ordered.every((step) => step.ok) &&
    Boolean(params.loopId.trim()) &&
    ordered.some((step) => Object.keys(step.evidenceIds).length > 0);
  return {
    browserEvidenceLevel: params.browserEvidenceLevel,
    loopId: params.loopId.trim(),
    steps: ordered,
    correlatable,
    nonClaims: [...SAR_A5_NON_CLAIMS],
  };
}

/** Shared correlation key used across the five steps in one A5 loop run. */
export function sarA5LoopCorrelationKey(loopId: string): string {
  return `a5-loop:${loopId.trim()}`;
}
