import { describe, expect, it } from "vitest";
import {
  computeContributionFromSessionShare,
  computeContributionScoreV2,
} from "./collaboration-group-read-model.ts";

describe("collaboration group contribution v2", () => {
  it("keeps v1 session share", () => {
    expect(computeContributionFromSessionShare(2, 10)).toBe(20);
    expect(computeContributionFromSessionShare(0, 0)).toBeNull();
  });

  it("computes weighted contributionScore", () => {
    const now = Date.parse("2026-08-02T00:00:00.000Z");
    const score = computeContributionScoreV2({
      sessionShare: 40,
      lastActiveAt: now - 2 * 24 * 60 * 60 * 1000,
      governanceRole: "owner",
      now,
    });
    // 0.5*40 + 0.3*100 + 0.2*100 = 20 + 30 + 20 = 70
    expect(score).toBe(70);
  });

  it("boosts coordinator when no governance role", () => {
    const now = Date.parse("2026-08-02T00:00:00.000Z");
    const member = computeContributionScoreV2({
      sessionShare: 0,
      lastActiveAt: now,
      governanceRole: null,
      isCoordinator: false,
      now,
    });
    const coordinator = computeContributionScoreV2({
      sessionShare: 0,
      lastActiveAt: now,
      governanceRole: null,
      isCoordinator: true,
      now,
    });
    expect(coordinator).toBeGreaterThan(member ?? 0);
  });
});
