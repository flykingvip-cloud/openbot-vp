import { describe, expect, it } from "vitest";
import {
  BUILTIN_STEWARD_AGENT_ID,
  BUILTIN_STEWARD_NAME,
  isBuiltinStewardAgent,
  withEmployeeUniversalStewardAgentIds,
} from "./identity.js";

describe("isBuiltinStewardAgent", () => {
  it("matches the canonical steward agent id", () => {
    expect(isBuiltinStewardAgent(BUILTIN_STEWARD_AGENT_ID)).toBe(true);
    expect(isBuiltinStewardAgent("main")).toBe(true);
  });

  it("tolerates casing and surrounding whitespace", () => {
    expect(isBuiltinStewardAgent("  MAIN  ")).toBe(true);
    expect(isBuiltinStewardAgent("Main")).toBe(true);
  });

  it("rejects other agent ids", () => {
    expect(isBuiltinStewardAgent("agent-sales")).toBe(false);
    expect(isBuiltinStewardAgent("steward")).toBe(false);
    expect(isBuiltinStewardAgent("main-2")).toBe(false);
  });

  it("rejects empty / nullish values", () => {
    expect(isBuiltinStewardAgent("")).toBe(false);
    expect(isBuiltinStewardAgent("   ")).toBe(false);
    expect(isBuiltinStewardAgent(null)).toBe(false);
    expect(isBuiltinStewardAgent(undefined)).toBe(false);
  });

  it("exposes the steward display name constant", () => {
    expect(BUILTIN_STEWARD_NAME).toBe("大白管家");
  });
});

describe("withEmployeeUniversalStewardAgentIds", () => {
  it("appends the builtin steward when missing", () => {
    expect(withEmployeeUniversalStewardAgentIds(["market"])).toEqual(["market", "main"]);
  });

  it("is idempotent when steward is already present", () => {
    expect(withEmployeeUniversalStewardAgentIds(["main", "market"])).toEqual(["main", "market"]);
  });

  it("ensures steward for empty seat agent lists", () => {
    expect(withEmployeeUniversalStewardAgentIds([])).toEqual([BUILTIN_STEWARD_AGENT_ID]);
  });
});
