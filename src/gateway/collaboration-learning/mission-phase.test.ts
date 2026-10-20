import { describe, expect, it } from "vitest";
import {
  COLLABORATION_WORK_MISSION_TEXT,
  isOnboardingIntroductionMission,
  suggestWorkMissionAfterOnboarding,
} from "./mission-phase.js";

describe("mission phase helpers", () => {
  it("detects onboarding introduction missions", () => {
    expect(isOnboardingIntroductionMission("先互相认识，建立协作上下文")).toBe(true);
    expect(isOnboardingIntroductionMission(COLLABORATION_WORK_MISSION_TEXT)).toBe(false);
  });

  it("suggests work mission after onboarding", () => {
    expect(suggestWorkMissionAfterOnboarding()).toBe(COLLABORATION_WORK_MISSION_TEXT);
  });
});
