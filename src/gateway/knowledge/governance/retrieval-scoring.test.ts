// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  applyGovernanceMultiplier,
  resolveVerifiedWeight,
  shouldFilterGovernanceHit,
} from "./retrieval-scoring.js";

describe("retrieval-scoring", () => {
  it("returns hybrid score unchanged when governance factors are missing", () => {
    expect(applyGovernanceMultiplier(0.82, null)).toBe(0.82);
    expect(applyGovernanceMultiplier(0.82, undefined)).toBe(0.82);
  });

  it("filters suppressed and archived chunks", () => {
    expect(
      shouldFilterGovernanceHit({
        trustScore: 1,
        freshnessScore: 1,
        governanceStatus: "suppressed",
        conflictGroupId: null,
      }),
    ).toBe(true);
    expect(
      shouldFilterGovernanceHit({
        trustScore: 1,
        freshnessScore: 1,
        governanceStatus: "archived",
        conflictGroupId: null,
      }),
    ).toBe(true);
    expect(
      resolveVerifiedWeight({
        trustScore: null,
        freshnessScore: null,
        governanceStatus: "archived",
        conflictGroupId: null,
      }),
    ).toBe(0);
    expect(
      resolveVerifiedWeight({
        trustScore: null,
        freshnessScore: null,
        governanceStatus: "suppressed",
        conflictGroupId: null,
      }),
    ).toBe(0);
    expect(
      applyGovernanceMultiplier(1, {
        trustScore: null,
        freshnessScore: null,
        governanceStatus: "suppressed",
        conflictGroupId: null,
      }),
    ).toBe(0);
  });

  it("applies trust and conflict penalties when present", () => {
    const score = applyGovernanceMultiplier(1, {
      trustScore: 0.5,
      freshnessScore: 0.8,
      governanceStatus: "pending",
      conflictGroupId: "cg-1",
    });
    expect(score).toBeCloseTo(0.28, 5);
  });
});
