import { describe, expect, it } from "vitest";
import { deriveInboundFeedbackSignals, hasInboundFeedbackSignal } from "./feedback-signal.js";

describe("deriveInboundFeedbackSignals", () => {
  it("returns nothing for empty text (no observation)", () => {
    expect(deriveInboundFeedbackSignals("")).toEqual({});
    expect(deriveInboundFeedbackSignals("   ")).toEqual({});
    expect(hasInboundFeedbackSignal({})).toBe(false);
  });

  it("detects human takeover (zh) and counts it as dissatisfaction", () => {
    const signals = deriveInboundFeedbackSignals("算了，我自己来吧");
    expect(signals.humanTakeover).toBe(true);
    expect(signals.sentiment).toBe("negative");
    expect(signals.matched).toBeTruthy();
  });

  it("detects human takeover (en)", () => {
    expect(deriveInboundFeedbackSignals("never mind, I'll do it").humanTakeover).toBe(true);
    expect(deriveInboundFeedbackSignals("Let me handle this").humanTakeover).toBe(true);
    expect(deriveInboundFeedbackSignals("taking over from here").humanTakeover).toBe(true);
  });

  it("does not treat delegation to the bot as takeover", () => {
    const signals = deriveInboundFeedbackSignals("你来处理一下这个文件");
    expect(signals.humanTakeover).toBe(false);
    expect(signals.sentiment).toBeUndefined();
  });

  it("detects dissatisfaction without takeover", () => {
    const signals = deriveInboundFeedbackSignals("不对，重做一遍");
    expect(signals.humanTakeover).toBe(false);
    expect(signals.sentiment).toBe("negative");
  });

  it("detects satisfaction", () => {
    expect(deriveInboundFeedbackSignals("完美，谢谢").sentiment).toBe("positive");
    expect(deriveInboundFeedbackSignals("lgtm").sentiment).toBe("positive");
  });

  it("neutral text still yields a takeover observation (real denominator)", () => {
    const signals = deriveInboundFeedbackSignals("帮我看一下这份日志");
    expect(signals.humanTakeover).toBe(false);
    expect(signals.sentiment).toBeUndefined();
    // Observation exists → contributes to the takeover denominator, not to satisfaction.
    expect(hasInboundFeedbackSignal(signals)).toBe(true);
  });

  it("prioritizes takeover over plain negativity", () => {
    const signals = deriveInboundFeedbackSignals("你搞错了，我接手");
    expect(signals.humanTakeover).toBe(true);
    expect(signals.sentiment).toBe("negative");
  });
});
