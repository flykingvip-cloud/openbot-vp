import { describe, expect, it } from "vitest";
import {
  STEWARD_REQUIRED_SKILLS,
  ensureStewardRequiredSkills,
  shouldForceStewardRequiredSkills,
} from "./required-skills.js";

describe("ensureStewardRequiredSkills", () => {
  it("leaves an open filter (undefined) unchanged", () => {
    expect(ensureStewardRequiredSkills(undefined)).toBeUndefined();
  });

  it("injects required skills into an empty whitelist", () => {
    expect(ensureStewardRequiredSkills([])).toEqual([...STEWARD_REQUIRED_SKILLS]);
  });

  it("merges required skills into an existing whitelist without duplicates", () => {
    const out = ensureStewardRequiredSkills(["weather", "user-guidance-protocol"]);
    expect(out).toContain("weather");
    expect(out).toContain("user-guidance-protocol");
    expect(out?.filter((name) => name === "user-guidance-protocol")).toHaveLength(1);
  });

  it("includes user-guidance-protocol as a steward required skill", () => {
    expect(STEWARD_REQUIRED_SKILLS).toContain("user-guidance-protocol");
  });

  it("includes execution-discipline as a steward required skill", () => {
    expect(STEWARD_REQUIRED_SKILLS).toContain("execution-discipline");
  });

  it("includes openbot-docs as a steward required skill", () => {
    expect(STEWARD_REQUIRED_SKILLS).toContain("openbot-docs");
  });

  it("includes external API source configuration as a steward required skill", () => {
    expect(STEWARD_REQUIRED_SKILLS).toContain("configure-external-api-source");
  });

  it("restores the required skill after a channel∩agent intersection drops it", () => {
    // Mirrors get-reply mergeSkillFilters: channel ∩ agent can strip steward skills.
    const channel = ["weather", "slack"];
    const agent = new Set(["weather", "user-guidance-protocol"]);
    const intersection = channel.filter((name) => agent.has(name));
    expect(intersection).toEqual(["weather"]);
    expect(ensureStewardRequiredSkills(intersection)).toEqual(
      expect.arrayContaining([
        "configure-external-api-source",
        "weather",
        "user-guidance-protocol",
      ]),
    );
  });
});

describe("shouldForceStewardRequiredSkills", () => {
  it("forces only on act (ui_nav maps to act ceiling today)", () => {
    expect(shouldForceStewardRequiredSkills("act")).toBe(true);
    expect(shouldForceStewardRequiredSkills("chat")).toBe(false);
    expect(shouldForceStewardRequiredSkills("retrieve")).toBe(false);
    expect(shouldForceStewardRequiredSkills(undefined)).toBe(false);
  });
});
