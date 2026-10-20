import { describe, expect, it } from "vitest";
import {
  deriveIncubationDecision,
  deriveLevelFromEvidence,
  isL4WithoutAdoption,
  meetsL4Adoption,
  shouldShowSystemSuggestCta,
  shouldShowWeakHint,
} from "./scorer.ts";
import { createEmptyEvidence, DEFAULT_INCUBATION_THRESHOLDS } from "./types.ts";

describe("asset incubation scorer", () => {
  const prdSession = {
    hasStructuredOutput: true,
    hasArtifact: true,
    hasWorkflowLanguage: false,
    hasTemplateOrReportLanguage: true,
  };

  it("maps single PRD-like session to L2, not L3", () => {
    const decision = deriveIncubationDecision({
      sessionInput: prdSession,
      contextId: "artifact-prd-1",
    });
    expect(decision.level).toBe("L2");
    expect(shouldShowSystemSuggestCta(decision)).toBe(false);
    expect(decision.evidence.recurrenceCount).toBe(0);
  });

  it("keeps L2 when recurrence is 2", () => {
    const decision = deriveIncubationDecision({
      sessionInput: prdSession,
      evidence: { recurrenceCount: 2 },
    });
    expect(decision.level).toBe("L2");
  });

  it("promotes to L3 when recurrence reaches 3", () => {
    const decision = deriveIncubationDecision({
      sessionInput: prdSession,
      evidence: { recurrenceCount: 3 },
    });
    expect(decision.level).toBe("L3");
    expect(shouldShowSystemSuggestCta(decision)).toBe(true);
    expect(decision.reason).toContain("重复 3 次");
  });

  it("promotes to L3 via user-initiated save count", () => {
    const decision = deriveIncubationDecision({
      sessionInput: prdSession,
      evidence: { userInitiatedSaveCount: 2 },
    });
    expect(decision.level).toBe("L3");
  });

  it("promotes to L3 via externalization count", () => {
    const decision = deriveIncubationDecision({
      sessionInput: prdSession,
      evidence: { externalizationCount: 2 },
    });
    expect(decision.level).toBe("L3");
  });

  it("promotes to L3 via review engine stable cluster", () => {
    const decision = deriveIncubationDecision({
      sessionInput: prdSession,
      evidence: { reviewEngineStableCluster: true },
      source: "review-engine",
    });
    expect(decision.level).toBe("L3");
    expect(decision.source).toBe("review-engine");
  });

  it("does not promote L4 without adoption even at high stability", () => {
    const evidence = createEmptyEvidence();
    evidence.sessionQuality = 0.9;
    evidence.recurrenceCount = 10;
    expect(deriveLevelFromEvidence(evidence)).toBe("L3");
    expect(isL4WithoutAdoption(evidence)).toBe(true);
  });

  it("promotes to L4 only with adoption evidence on L3 base", () => {
    const decision = deriveIncubationDecision({
      sessionInput: prdSession,
      evidence: {
        recurrenceCount: 5,
        adoption: {
          distinctMemberCount: 3,
          sharedToGroup: false,
          adminRecommended: false,
          enterpriseSubmitted: false,
        },
      },
    });
    expect(decision.level).toBe("L4");
    expect(meetsL4Adoption(decision.evidence.adoption)).toBe(true);
  });

  it("promotes to L4 via sharedToGroup without member count", () => {
    const decision = deriveIncubationDecision({
      sessionInput: prdSession,
      evidence: {
        recurrenceCount: 3,
        adoption: {
          distinctMemberCount: 0,
          sharedToGroup: true,
          adminRecommended: false,
          enterpriseSubmitted: false,
        },
      },
    });
    expect(decision.level).toBe("L4");
  });

  it("classifies weak structured output as L1", () => {
    const decision = deriveIncubationDecision({
      sessionInput: {
        hasStructuredOutput: true,
        hasArtifact: false,
        hasWorkflowLanguage: false,
        hasTemplateOrReportLanguage: false,
      },
    });
    expect(decision.level).toBe("L1");
    expect(shouldShowWeakHint(decision)).toBe(false);
    expect(shouldShowSystemSuggestCta(decision)).toBe(false);
  });

  it("shows weak hint for L2", () => {
    const decision = deriveIncubationDecision({ sessionInput: prdSession });
    expect(shouldShowWeakHint(decision)).toBe(true);
  });

  it("preserves evidence in decision for explainability", () => {
    const decision = deriveIncubationDecision({
      sessionInput: prdSession,
      evidence: { recurrenceCount: 3, externalizationCount: 1 },
    });
    expect(decision.evidence.recurrenceCount).toBe(3);
    expect(decision.signalTrace.length).toBeGreaterThan(0);
    expect(decision.signalTrace.some((entry) => entry.kind === "recurrence")).toBe(true);
  });

  it("respects custom thresholds for L3 recurrence", () => {
    const thresholds = {
      ...DEFAULT_INCUBATION_THRESHOLDS,
      recurrenceForL3: 5,
    };
    const atFour = deriveIncubationDecision({
      sessionInput: prdSession,
      evidence: { recurrenceCount: 4 },
      thresholds,
    });
    expect(atFour.level).toBe("L2");

    const atFive = deriveIncubationDecision({
      sessionInput: prdSession,
      evidence: { recurrenceCount: 5 },
      thresholds,
    });
    expect(atFive.level).toBe("L3");
  });
});
