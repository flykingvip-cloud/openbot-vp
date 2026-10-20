import { describe, expect, it } from "vitest";
import {
  classifyOptionalSupplementReply,
  extractOptionalSupplementTitle,
} from "./optional-supplement.js";

describe("optional supplement classifier", () => {
  it("detects optional supplement offers", () => {
    expect(
      classifyOptionalSupplementReply(
        "如需我补充市场投放角度或竞品对比，随时喊我，我可以协助整理一版要点。",
      ),
    ).toBe(true);
  });

  it("ignores short or non-supplement replies", () => {
    expect(classifyOptionalSupplementReply("收到")).toBe(false);
    expect(classifyOptionalSupplementReply("我会按决策执行并交付文档。")).toBe(false);
  });

  it("extracts title from first line", () => {
    expect(extractOptionalSupplementTitle("如需补充渠道策略\n细节见上。", "市场助手")).toBe(
      "如需补充渠道策略",
    );
  });
});
