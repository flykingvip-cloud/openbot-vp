import { describe, expect, it } from "vitest";
import {
  buildReplyUserTimezonePrompt,
  resolveReplyUserTimezone,
  WEBCHAT_DEFAULT_TIMEZONE,
} from "./resolve-reply-user-timezone.js";

describe("resolveReplyUserTimezone", () => {
  it("prefers profile timezone", () => {
    expect(
      resolveReplyUserTimezone({
        cfg: {},
        profile: { preferredTimezone: "America/Chicago" },
        isWebchat: true,
      }),
    ).toBe("America/Chicago");
  });

  it("defaults webchat to Asia/Shanghai when host is UTC", () => {
    expect(
      resolveReplyUserTimezone({
        cfg: {},
        isWebchat: true,
      }),
    ).toBe(WEBCHAT_DEFAULT_TIMEZONE);
  });
});

describe("buildReplyUserTimezonePrompt", () => {
  it("includes timezone and scheduling guidance", () => {
    const prompt = buildReplyUserTimezonePrompt({
      cfg: {},
      profile: { preferredTimezone: "Asia/Shanghai" },
      isWebchat: true,
    });
    expect(prompt).toContain("Asia/Shanghai");
    expect(prompt).toContain("scheduling");
  });
});
