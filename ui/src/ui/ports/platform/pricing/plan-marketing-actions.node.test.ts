import { describe, expect, it, vi } from "vitest";
import {
  buildMatchingProfileFromFormData,
  buildNextMarketingTags,
  requestSetMarketingTags,
  requestSetMatchingProfile,
} from "./plan-marketing-actions.ts";

describe("plan-marketing-actions", () => {
  it("adds and removes marketing tags deterministically", () => {
    expect(buildNextMarketingTags([], "recommended", true)).toEqual(["recommended"]);
    expect(buildNextMarketingTags(["default", "recommended"], "recommended", false)).toEqual([
      "default",
    ]);
  });

  it("parses matching profile from form data", () => {
    const formData = new FormData();
    formData.set("targetPersonas", "team-10, creator-heavy");
    formData.set("matchingPriority", "12");
    formData.set("inPlanFlexibilityNotes", "支持团队内扩容");
    formData.set("beyondPlanNotes", "超过边界请联系销售");

    expect(buildMatchingProfileFromFormData(formData)).toEqual({
      targetPersonas: ["team-10", "creator-heavy"],
      matchingPriority: 12,
      inPlanFlexibilityNotes: "支持团队内扩容",
      beyondPlanNotes: "超过边界请联系销售",
    });
  });

  it("wraps marketing tag and matching profile gateway requests", async () => {
    const gateway = {
      setMarketingTags: vi.fn(async (payload) => payload),
      setMatchingProfile: vi.fn(async (payload) => payload),
    };

    await requestSetMarketingTags({
      gateway: gateway as never,
      planId: "plan-1",
      marketingTags: ["default"],
    });
    expect(gateway.setMarketingTags).toHaveBeenCalledWith({
      planId: "plan-1",
      marketingTags: ["default"],
    });

    await requestSetMatchingProfile({
      gateway: gateway as never,
      planId: "plan-1",
      matchingProfile: { targetPersonas: ["team-10"] },
    });
    expect(gateway.setMatchingProfile).toHaveBeenCalledWith({
      planId: "plan-1",
      matchingProfile: { targetPersonas: ["team-10"] },
    });
  });
});
