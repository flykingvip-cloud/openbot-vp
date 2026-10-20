import { readFileSync } from "node:fs";
import type { ToolRisk } from "./contracts.js";
import { catalogPath, combinationsPath } from "./paths.js";
import { assertValidToolDefinition } from "./validate.js";

export interface ToolDefinition {
  id: string;
  priority: "P0" | "P1" | "P2";
  purpose: string;
  operations: string[];
  risk: ToolRisk;
  sideEffects: boolean;
  dryRun: boolean | string;
  idempotency: string;
  verification: string[];
}

export interface ToolCatalog {
  version: string;
  tools: ToolDefinition[];
}

export interface ToolCombination {
  id: string;
  purpose: string;
  tools: string[];
  requiredControls: string[];
}

export interface ToolCombinationsFile {
  version: string;
  combinations: ToolCombination[];
}

export interface ResolvedCombination {
  combination: ToolCombination;
  tools: ToolDefinition[];
}

function loadJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * Loads the toolkit catalog + combinations, validates each tool definition
 * against `schemas/tool-definition.schema.json`, and resolves allowed tools
 * by combination id.
 */
export class ToolRegistry {
  private readonly catalog: ToolCatalog;
  private readonly combinations: Map<string, ToolCombination>;
  private readonly toolsById: Map<string, ToolDefinition>;

  constructor(options?: {
    catalog?: ToolCatalog;
    combinations?: ToolCombinationsFile;
    validate?: boolean;
  }) {
    const validate = options?.validate !== false;
    this.catalog = options?.catalog ?? loadJsonFile<ToolCatalog>(catalogPath());
    const combos = options?.combinations ?? loadJsonFile<ToolCombinationsFile>(combinationsPath());

    this.toolsById = new Map();
    for (const tool of this.catalog.tools) {
      if (validate) {
        assertValidToolDefinition(tool);
      }
      if (this.toolsById.has(tool.id)) {
        throw new Error(`Duplicate tool id in catalog: ${tool.id}`);
      }
      this.toolsById.set(tool.id, tool);
    }

    this.combinations = new Map();
    for (const combination of combos.combinations) {
      if (this.combinations.has(combination.id)) {
        throw new Error(`Duplicate combination id: ${combination.id}`);
      }
      for (const toolId of combination.tools) {
        if (!this.toolsById.has(toolId)) {
          throw new Error(`Combination ${combination.id} references unknown tool: ${toolId}`);
        }
      }
      this.combinations.set(combination.id, combination);
    }
  }

  /** Factory that loads packaged JSON assets and validates them. */
  static fromPackageAssets(): ToolRegistry {
    return new ToolRegistry();
  }

  listTools(): ToolDefinition[] {
    return [...this.toolsById.values()];
  }

  getTool(toolId: string): ToolDefinition | undefined {
    return this.toolsById.get(toolId);
  }

  listCombinations(): ToolCombination[] {
    return [...this.combinations.values()];
  }

  getCombination(combinationId: string): ToolCombination | undefined {
    return this.combinations.get(combinationId);
  }

  /**
   * Resolve the set of allowed catalog tools for a combination id.
   * Throws if the combination is unknown.
   */
  resolve(combinationId: string): ResolvedCombination {
    const combination = this.combinations.get(combinationId);
    if (!combination) {
      throw new Error(`Unknown tool combination: ${combinationId}`);
    }
    const tools = combination.tools.map((id) => {
      const tool = this.toolsById.get(id);
      if (!tool) {
        throw new Error(`Combination ${combinationId} references unknown tool: ${id}`);
      }
      return tool;
    });
    return { combination, tools };
  }

  /** Convenience: allowed tool ids for a combination. */
  resolveAllowedToolIds(combinationId: string): string[] {
    return this.resolve(combinationId).tools.map((t) => t.id);
  }

  catalogVersion(): string {
    return this.catalog.version;
  }
}
