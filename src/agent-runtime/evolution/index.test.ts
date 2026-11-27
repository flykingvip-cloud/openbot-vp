import { afterEach, describe, expect, it } from "vitest";
import { isEvolutionEnabled, listEvolutionFlags } from "./index.js";

describe("isEvolutionEnabled", () => {
  afterEach(() => {
    delete process.env.OPENBOT_EVOLUTION_UNIFIED_LIFECYCLE;
    delete process.env.OPENCLAW_EVOLUTION_UNIFIED_LIFECYCLE;
    delete process.env.OPENBOT_EVOLUTION_SOME_NEW_FLAG;
  });

  it('defaults "unified-lifecycle" to true', () => {
    expect(isEvolutionEnabled("unified-lifecycle")).toBe(true);
  });

  it("returns false for unknown flags", () => {
    expect(isEvolutionEnabled("nonexistent-flag")).toBe(false);
  });

  it("env override can disable a default-on flag", () => {
    process.env.OPENBOT_EVOLUTION_UNIFIED_LIFECYCLE = "0";
    expect(isEvolutionEnabled("unified-lifecycle")).toBe(false);
  });

  it("env override can enable a flag", () => {
    process.env.OPENBOT_EVOLUTION_UNIFIED_LIFECYCLE = "1";
    expect(isEvolutionEnabled("unified-lifecycle")).toBe(true);
  });

  it("legacy OPENCLAW_ prefix is honored", () => {
    process.env.OPENCLAW_EVOLUTION_UNIFIED_LIFECYCLE = "0";
    expect(isEvolutionEnabled("unified-lifecycle")).toBe(false);
  });

  it("OPENBOT_ takes precedence over OPENCLAW_", () => {
    process.env.OPENBOT_EVOLUTION_UNIFIED_LIFECYCLE = "1";
    process.env.OPENCLAW_EVOLUTION_UNIFIED_LIFECYCLE = "0";
    expect(isEvolutionEnabled("unified-lifecycle")).toBe(true);
  });
});

describe("listEvolutionFlags", () => {
  afterEach(() => {
    delete process.env.OPENBOT_EVOLUTION_UNIFIED_LIFECYCLE;
  });

  it("returns all known flags with resolved values", () => {
    const flags = listEvolutionFlags();
    expect(flags).toHaveProperty("unified-lifecycle", true);
  });

  it("reflects env overrides", () => {
    process.env.OPENBOT_EVOLUTION_UNIFIED_LIFECYCLE = "0";
    const flags = listEvolutionFlags();
    expect(flags["unified-lifecycle"]).toBe(false);
  });
});
