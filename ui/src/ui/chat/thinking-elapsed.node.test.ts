import { describe, expect, it } from "vitest";
import {
  formatThinkingElapsed,
  isLiveThinkingClockActive,
  thinkingElapsedMs,
} from "./thinking-elapsed.ts";

describe("thinking-elapsed", () => {
  it("formats Codex-style elapsed labels", () => {
    expect(formatThinkingElapsed(0)).toBe("0s");
    expect(formatThinkingElapsed(12_000)).toBe("12s");
    expect(formatThinkingElapsed(170_000)).toBe("2m50s");
    expect(formatThinkingElapsed(3_600_000 + 120_000)).toBe("1h02m");
  });

  it("formats Chinese elapsed labels for zh locales", () => {
    expect(formatThinkingElapsed(0, "zh-CN")).toBe("0秒");
    expect(formatThinkingElapsed(12_000, "zh-CN")).toBe("12秒");
    expect(formatThinkingElapsed(170_000, "zh-CN")).toBe("2分50秒");
    expect(formatThinkingElapsed(120_000, "zh-TW")).toBe("2分");
    expect(formatThinkingElapsed(3_600_000 + 120_000, "zh-CN")).toBe("1小时2分");
  });

  it("computes elapsed from stream start", () => {
    expect(thinkingElapsedMs(100, 170_100)).toBe(170_000);
    expect(thinkingElapsedMs(null, 1)).toBeNull();
    expect(thinkingElapsedMs(-1, 1)).toBeNull();
  });

  it("runs only while sending and before delivery text arrives", () => {
    expect(isLiveThinkingClockActive({ sending: true, streamStartedAt: 1, stream: "" })).toBe(true);
    expect(isLiveThinkingClockActive({ sending: true, streamStartedAt: 1, stream: "hello" })).toBe(
      false,
    );
    expect(isLiveThinkingClockActive({ sending: false, streamStartedAt: 1, stream: "" })).toBe(
      false,
    );
  });
});
