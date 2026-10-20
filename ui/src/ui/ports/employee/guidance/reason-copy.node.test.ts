import { describe, expect, it } from "vitest";
import { resolveGuidanceReasonCopy } from "./reason-copy.ts";

describe("resolveGuidanceReasonCopy", () => {
  it("hides steward onboarding keys so the muted bubble stays the only copy", () => {
    expect(resolveGuidanceReasonCopy("guidance.recommend.steward_onboarding")).toBe("");
    expect(resolveGuidanceReasonCopy("guidance.recommendation.steward_onboarding")).toBe("");
    expect(resolveGuidanceReasonCopy("guidance.none")).toBe("");
  });

  it("never renders a dotted machine key", () => {
    expect(resolveGuidanceReasonCopy("growth.recommend.start_work")).toBe("");
    expect(resolveGuidanceReasonCopy("frontstage.workbench.cards.cronMinutes")).toBe("");
  });

  it("keeps human sentences and maps team stale copy", () => {
    expect(resolveGuidanceReasonCopy("这条群使命已经有一段时间没有推进了。")).toBe(
      "这条群使命已经有一段时间没有推进了。",
    );
    expect(resolveGuidanceReasonCopy("guidance.recommend.team_stale_mission")).toMatch(
      /使命|mission/i,
    );
  });
});
