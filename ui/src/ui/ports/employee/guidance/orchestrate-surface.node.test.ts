/**
 * P3.1 / P3.2 unit coverage for orchestrated surface helpers.
 */
import { describe, expect, it } from "vitest";
import {
  guidanceScopeAckKey,
  pickOrchestratedPrimary,
  resolveCompetingSurfaceVisibility,
  shouldShowOrchestratedPrimaryCta,
  type UiGuidanceSnapshot,
} from "./orchestrate-surface.ts";

function snap(
  partial: Partial<UiGuidanceSnapshot> & Pick<UiGuidanceSnapshot, "scope" | "entityId">,
): UiGuidanceSnapshot {
  return {
    scenario: "test",
    confidence: "high",
    currentStage: "birth",
    nextAction: {
      kind: "start_work",
      label: "开始",
      reason: "r",
      canSkip: true,
      risk: "low",
    },
    optionalActions: [],
    blockers: [],
    degrade: "none",
    source: "test",
    generatedAt: 1,
    ...partial,
  };
}

describe("orchestrate-surface P3", () => {
  it("scopes ack keys so user/robot/team never collide", () => {
    expect(guidanceScopeAckKey("user", "same")).toBe("user::same");
    expect(guidanceScopeAckKey("robot", "same")).toBe("robot::same");
    expect(guidanceScopeAckKey("team", "same")).toBe("team::same");
  });

  it("hides primary when acknowledged or deferred", () => {
    const robot = snap({ scope: "robot", entityId: "bot-1" });
    const key = guidanceScopeAckKey("robot", "bot-1");
    expect(shouldShowOrchestratedPrimaryCta(robot)).toBe(true);
    expect(shouldShowOrchestratedPrimaryCta(robot, { acknowledgedKeys: new Set([key]) })).toBe(
      false,
    );
    expect(
      shouldShowOrchestratedPrimaryCta(robot, {
        deferredUntilMsByKey: new Map([[key, Date.now() + 60_000]]),
        nowMs: Date.now(),
      }),
    ).toBe(false);
  });

  it("picks at most one primary with robot > user > team", () => {
    const primary = pickOrchestratedPrimary([
      snap({ scope: "team", entityId: "g1", generatedAt: 99 }),
      snap({ scope: "user", entityId: "u1", generatedAt: 50 }),
      snap({ scope: "robot", entityId: "b1", generatedAt: 10 }),
    ]);
    expect(primary?.scope).toBe("robot");
    expect(primary?.entityId).toBe("b1");
  });

  it("demotes steward and team stale from primary when robot wins", () => {
    const visibility = resolveCompetingSurfaceVisibility({
      primary: snap({ scope: "robot", entityId: "b1" }),
      showGrowthPrelude: true,
      showDaibaiOnboarding: true,
      hasStewardSuggestion: true,
      hasTeamStaleMission: true,
    });
    expect(visibility.growthPreludeVisible).toBe(true);
    expect(visibility.daibaiOnboardingVisible).toBe(false);
    expect(visibility.stewardSuggestionAsPrimary).toBe(false);
    expect(visibility.teamStaleMissionAsPrimary).toBe(false);
  });
});
