import { afterEach, describe, expect, it } from "vitest";
import { isEvolutionEnabled, listEvolutionFlags } from "./index.js";

describe("isEvolutionEnabled", () => {
  afterEach(() => {
    delete process.env.OPENBOT_EVOLUTION_UNIFIED_LIFECYCLE;
    delete process.env.OPENCLAW_EVOLUTION_UNIFIED_LIFECYCLE;
    delete process.env.OPENBOT_EVOLUTION_SOME_NEW_FLAG;
  });

  it('treats retired "unified-lifecycle" as the remaining trunk path', () => {
    expect(isEvolutionEnabled("unified-lifecycle")).toBe(true);
  });

  it("returns false for unknown flags", () => {
    expect(isEvolutionEnabled("nonexistent-flag")).toBe(false);
  });

  it("does not honor OPENBOT_EVOLUTION_UNIFIED_LIFECYCLE as a kill switch", () => {
    process.env.OPENBOT_EVOLUTION_UNIFIED_LIFECYCLE = "0";
    expect(isEvolutionEnabled("unified-lifecycle")).toBe(true);
  });

  it("ignores OPENBOT_EVOLUTION_UNIFIED_LIFECYCLE=1 as well", () => {
    process.env.OPENBOT_EVOLUTION_UNIFIED_LIFECYCLE = "1";
    expect(isEvolutionEnabled("unified-lifecycle")).toBe(true);
  });

  it("does not honor the legacy OPENCLAW_ prefix as a kill switch", () => {
    process.env.OPENCLAW_EVOLUTION_UNIFIED_LIFECYCLE = "0";
    expect(isEvolutionEnabled("unified-lifecycle")).toBe(true);
  });

  it("still honors env overrides for live (non-retired) flags", () => {
    process.env.OPENBOT_EVOLUTION_SOME_NEW_FLAG = "1";
    expect(isEvolutionEnabled("some-new-flag")).toBe(true);
    process.env.OPENBOT_EVOLUTION_SOME_NEW_FLAG = "0";
    expect(isEvolutionEnabled("some-new-flag")).toBe(false);
  });
});

describe("listEvolutionFlags", () => {
  afterEach(() => {
    delete process.env.OPENBOT_EVOLUTION_UNIFIED_LIFECYCLE;
  });

  it("does not advertise retired unified-lifecycle as a live flag", () => {
    const flags = listEvolutionFlags();
    expect(flags).not.toHaveProperty("unified-lifecycle");
  });

  it("is unaffected by OPENBOT_EVOLUTION_UNIFIED_LIFECYCLE", () => {
    process.env.OPENBOT_EVOLUTION_UNIFIED_LIFECYCLE = "0";
    const flags = listEvolutionFlags();
    expect(flags).not.toHaveProperty("unified-lifecycle");
  });
});
