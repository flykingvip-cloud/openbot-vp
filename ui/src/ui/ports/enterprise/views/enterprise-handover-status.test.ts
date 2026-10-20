import { describe, expect, it } from "vitest";
import { handoverStatusLabel } from "./enterprise-handover-status.ts";

describe("handoverStatusLabel", () => {
  it("maps every handover status to its shared Chinese label", () => {
    expect(handoverStatusLabel("draft")).toBe("草稿");
    expect(handoverStatusLabel("asset_review")).toBe("资产审查中");
    expect(handoverStatusLabel("pending_approval")).toBe("待批准冻结");
    expect(handoverStatusLabel("frozen")).toBe("待绑定继任人");
    expect(handoverStatusLabel("rebound")).toBe("已完成继任绑定");
    expect(handoverStatusLabel("completed")).toBe("已完成");
  });

  it("passes unknown statuses through unchanged", () => {
    expect(handoverStatusLabel("mystery")).toBe("mystery");
  });
});
