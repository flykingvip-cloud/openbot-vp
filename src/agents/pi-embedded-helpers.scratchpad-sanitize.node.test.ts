import { describe, expect, it } from "vitest";
import { sanitizeUserFacingText } from "./pi-embedded-helpers/errors.js";

describe("sanitizeUserFacingText scratchpad strip", () => {
  it("strips English CoT scratchpad while keeping Chinese delivery text", () => {
    const input = [
      "The skill is outside my sandbox. Let me try exec.",
      "",
      "请点本机只读授权后继续。",
    ].join("\n");
    const out = sanitizeUserFacingText(input);
    expect(out).toContain("请点本机只读授权");
    expect(out).not.toMatch(/sandbox/i);
    expect(out).not.toMatch(/Let me/i);
  });
});
