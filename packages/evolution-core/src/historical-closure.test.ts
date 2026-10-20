import { describe, expect, it } from "vitest";
import {
  evaluateCapsuleObservationEligibility,
  projectCapsuleObservationView,
} from "./capsule-eligibility.js";
import {
  HISTORICAL_CAPSULE_CLOSURE_DISPOSITION,
  historicalCapsuleClosureIsRecoverable,
  mayClaimFullHistoryEvolutionClosure,
} from "./historical-closure.js";

describe("historical Capsule closure disposition", () => {
  it("records full-history closure as an accepted permanent exclusion", () => {
    expect(HISTORICAL_CAPSULE_CLOSURE_DISPOSITION.completionStatus).toBe("not_achieved");
    expect(HISTORICAL_CAPSULE_CLOSURE_DISPOSITION.disposition).toBe("accepted_permanent_exclusion");
    expect(HISTORICAL_CAPSULE_CLOSURE_DISPOSITION.reasonCode).toBe(
      "legacy_missing_failure_cluster",
    );
    expect(HISTORICAL_CAPSULE_CLOSURE_DISPOSITION.recoverable).toBe(false);
    expect(historicalCapsuleClosureIsRecoverable()).toBe(false);
    expect(mayClaimFullHistoryEvolutionClosure()).toBe(false);
    expect(HISTORICAL_CAPSULE_CLOSURE_DISPOSITION.blocksEligibleDataRelease).toBe(false);
    expect(HISTORICAL_CAPSULE_CLOSURE_DISPOSITION.blocksFullHistoryClosureClaim).toBe(true);
  });

  it("forbids migrate, infer, and backfill remediations", () => {
    expect(HISTORICAL_CAPSULE_CLOSURE_DISPOSITION.forbiddenRemediations).toEqual([
      "migrate",
      "infer",
      "backfill",
      "rewrite_unavailable_to_eligible",
    ]);
  });

  it("keeps a missing failureClusterRef unavailable instead of 0% recurrence", () => {
    const eligibility = evaluateCapsuleObservationEligibility({});
    expect(eligibility).toEqual({
      eligible: false,
      reason: HISTORICAL_CAPSULE_CLOSURE_DISPOSITION.reasonCode,
    });
    const view = projectCapsuleObservationView({
      eligibility,
      nativeRecurrenceRate: 0,
    });
    expect(view.availability).toBe("unavailable");
    expect(view.label).toContain("observation unavailable");
    expect(view.recurrenceRate).toBeNull();
    expect(view.recurrenceRate).not.toBe(0);
  });
});
