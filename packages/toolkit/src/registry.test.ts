import { describe, expect, it } from "vitest";
import { ToolRegistry } from "./registry.js";
import { validateToolDefinition } from "./validate.js";

const EXPECTED_TOOL_IDS = [
  "workspace",
  "shell",
  "web",
  "mcp-connectors",
  "approval",
  "receipt",
  "browser",
  "computer-use",
  "office-artifacts",
  "automation",
  "visualization",
  "task-coordination",
] as const;

const EXPECTED_COMBO_IDS = [
  "minimum-tool-kernel",
  "office-workbench",
  "automation-operations",
  "interactive-application-control",
] as const;

describe("ToolRegistry catalog", () => {
  it("loads and validates all 12 catalog tools against tool-definition schema", () => {
    const registry = ToolRegistry.fromPackageAssets();
    const tools = registry.listTools();
    expect(tools).toHaveLength(12);
    expect(tools.map((t) => t.id).sort()).toEqual([...EXPECTED_TOOL_IDS].sort());

    for (const tool of tools) {
      const result = validateToolDefinition(tool);
      expect(result.ok, `${tool.id}: ${result.errors}`).toBe(true);
    }
  });

  it("resolves all 4 combinations", () => {
    const registry = ToolRegistry.fromPackageAssets();
    expect(
      registry
        .listCombinations()
        .map((c) => c.id)
        .sort(),
    ).toEqual([...EXPECTED_COMBO_IDS].sort());

    for (const id of EXPECTED_COMBO_IDS) {
      const resolved = registry.resolve(id);
      expect(resolved.combination.id).toBe(id);
      expect(resolved.tools.length).toBeGreaterThan(0);
      expect(resolved.tools.every((t) => resolved.combination.tools.includes(t.id))).toBe(true);
    }
  });

  it("resolves minimum-tool-kernel to the P0 kernel tools", () => {
    const registry = ToolRegistry.fromPackageAssets();
    const ids = registry.resolveAllowedToolIds("minimum-tool-kernel");
    expect(ids).toEqual(["workspace", "shell", "web", "mcp-connectors", "approval", "receipt"]);

    const { combination, tools } = registry.resolve("minimum-tool-kernel");
    expect(combination.requiredControls).toContain("execution-receipt");
    expect(tools.every((t) => t.priority === "P0")).toBe(true);
  });

  it("throws for unknown combination ids", () => {
    const registry = ToolRegistry.fromPackageAssets();
    expect(() => registry.resolve("not-a-combo")).toThrow(/Unknown tool combination/);
  });
});
