import { describe, expect, it } from "vitest";
import { buildStewardSystemPreamble } from "./behavior-rules.js";
import { BUILTIN_STEWARD_EMOJI, BUILTIN_STEWARD_NAME } from "./identity.js";

describe("buildStewardSystemPreamble", () => {
  it("includes steward display identity and direct-reply guidance", () => {
    const preamble = buildStewardSystemPreamble();
    expect(preamble).toContain(BUILTIN_STEWARD_NAME);
    expect(preamble).toContain(BUILTIN_STEWARD_EMOJI);
    expect(preamble).toContain("正面");
    expect(preamble).toContain("不要默认介绍");
    expect(preamble).toContain("user-guidance-protocol");
    expect(preamble).toContain("guidance_event");
    expect(preamble).toContain("skill_asset_save");
    expect(preamble).toContain("schedule.entry.add");
  });

  it("includes capability-boundary self-reflection guidance", () => {
    const preamble = buildStewardSystemPreamble();
    expect(preamble).toContain("能力边界");
    expect(preamble).toContain("[[capability_gap:skill|tool|perception:简述]]");
  });
});
