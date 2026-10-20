import { describe, expect, it } from "vitest";
import {
  deriveUserProfileDelta,
  detectPreferredTimezone,
  detectReplyLanguage,
  detectUserPreferenceDirectives,
  evaluateUserProfileEffect,
  countRecurringDirectiveFriction,
} from "./derive.js";
import { renderUserProfileInstructions } from "./render.js";
import { applyUserProfileDelta, DEFAULT_USER_PROFILE, sameUserProfileDelta } from "./types.js";

describe("detectUserPreferenceDirectives", () => {
  it("detects concise zh/en directives", () => {
    expect(detectUserPreferenceDirectives("请简洁点")).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "concise" })]),
    );
    expect(detectUserPreferenceDirectives("keep it concise")).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "concise" })]),
    );
  });

  it("detects reply language directives", () => {
    expect(detectUserPreferenceDirectives("reply in English please")).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "reply_english" })]),
    );
  });
});

describe("deriveUserProfileDelta", () => {
  it("returns empty delta for neutral input", () => {
    expect(
      deriveUserProfileDelta(DEFAULT_USER_PROFILE, {
        directives: [],
        replyLanguage: null,
      }),
    ).toEqual({});
  });

  it("maps concise directive to output format + verbosity", () => {
    const delta = deriveUserProfileDelta(DEFAULT_USER_PROFILE, {
      directives: detectUserPreferenceDirectives("简洁点"),
    });
    expect(delta.preferredOutputFormat).toBe("concise");
    expect(delta.verbosity).toBe("terse");
  });

  it("maps explicit english directive immediately", () => {
    const delta = deriveUserProfileDelta(DEFAULT_USER_PROFILE, {
      directives: detectUserPreferenceDirectives("reply in English"),
    });
    expect(delta.preferredReplyLanguage).toBe("en");
  });
});

describe("renderUserProfileInstructions", () => {
  it("returns empty for neutral defaults", () => {
    expect(renderUserProfileInstructions(DEFAULT_USER_PROFILE)).toBe("");
  });

  it("renders concise + english preferences", () => {
    const text = renderUserProfileInstructions({
      ...DEFAULT_USER_PROFILE,
      preferredOutputFormat: "concise",
      verbosity: "terse",
      preferredReplyLanguage: "en",
    });
    expect(text).toContain("Apply this user's learned preferences");
    expect(text).toContain("concise");
    expect(text).toContain("English");
  });
});

describe("evaluateUserProfileEffect", () => {
  it("treats lower friction as improved", () => {
    expect(evaluateUserProfileEffect(3, 1).status).toBe("improved");
  });

  it("treats higher friction as regressed", () => {
    expect(evaluateUserProfileEffect(0, 2).status).toBe("regressed");
  });

  it("returns inconclusive within min delta", () => {
    expect(evaluateUserProfileEffect(1, 1).status).toBe("inconclusive");
  });
});

describe("sameUserProfileDelta + friction", () => {
  it("compares profile field deltas", () => {
    expect(sameUserProfileDelta({ verbosity: "terse" }, { verbosity: "terse" })).toBe(true);
    expect(sameUserProfileDelta({ verbosity: "terse" }, { verbosity: "verbose" })).toBe(false);
  });

  it("counts recurring directive friction", () => {
    const friction = countRecurringDirectiveFriction(
      { preferredOutputFormat: "concise", verbosity: "terse" },
      detectUserPreferenceDirectives("还是简洁点"),
    );
    expect(friction).toBeGreaterThan(0);
  });
});

describe("detectReplyLanguage", () => {
  it("detects zh-heavy text", () => {
    expect(detectReplyLanguage("你好，请帮我总结一下今天的会议要点")).toBe("zh");
  });

  it("detects short pure-Chinese utterances", () => {
    expect(detectReplyLanguage("为何暂停了")).toBe("zh");
  });
});

describe("deriveUserProfileDelta language observations", () => {
  it("applies reply language on first detected observation", () => {
    const delta = deriveUserProfileDelta(DEFAULT_USER_PROFILE, {
      replyLanguage: "zh",
    });
    expect(delta.preferredReplyLanguage).toBe("zh");
  });
});

describe("detectPreferredTimezone", () => {
  it("detects Beijing time hints", () => {
    expect(detectPreferredTimezone("以后提醒请用北京时间")).toBe("Asia/Shanghai");
  });

  it("detects explicit IANA zones", () => {
    expect(detectPreferredTimezone("My timezone is America/Chicago")).toBe("America/Chicago");
  });
});

describe("deriveUserProfileDelta timezone", () => {
  it("applies timezone on first observation", () => {
    const delta = deriveUserProfileDelta(DEFAULT_USER_PROFILE, {
      preferredTimezone: "Asia/Shanghai",
    });
    expect(delta.preferredTimezone).toBe("Asia/Shanghai");
  });
});

describe("applyUserProfileDelta", () => {
  it("merges observations and fields", () => {
    const next = applyUserProfileDelta(DEFAULT_USER_PROFILE, {
      verbosity: "terse",
      observations: { verbosity: 1 },
    });
    expect(next.verbosity).toBe("terse");
    expect(next.observations.verbosity).toBe(1);
  });
});
