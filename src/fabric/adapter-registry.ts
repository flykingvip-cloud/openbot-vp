/**
 * adapter-registry.ts — declarative tool adapter registry (R8).
 *
 * Maps a `ToolRequest.tool.name` to an executable command via a registered
 * `ToolAdapter`. Registration is schema-validated and de-duplicated by id; a
 * tool name resolves to at most one adapter (last registration wins for that
 * name, with built-ins seeded first). The Execution Plane (task 5.2) uses
 * `resolve` to bind a node to its command.
 *
 * Built-in default adapters bridge the existing OpenBot tool surface
 * (`exec`/`process`/`apply_patch` + the `/tools/invoke` ToolInvoker). A generic
 * repo-agnostic `shell`/`git` adapter (task 5.3) validates the ecosystem entry.
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.5.
 */

import { parseContract, ToolAdapter } from "./contract.js";

/** Built-in adapters that bridge Fabric tool names to the existing TOL surface. */
export const BUILTIN_ADAPTERS: ToolAdapter[] = [
  {
    id: "builtin.exec",
    match: { toolNames: ["exec"] },
    execute: { command: "exec" },
    capabilities: { fs: true, network: true, streaming: true },
  },
  {
    id: "builtin.process",
    match: { toolNames: ["process"] },
    execute: { command: "process" },
    capabilities: { fs: true, network: true, streaming: true },
  },
  {
    id: "builtin.apply_patch",
    match: { toolNames: ["apply_patch"] },
    execute: { command: "apply_patch" },
    capabilities: { fs: true, network: false, streaming: false },
  },
  {
    id: "builtin.tools_invoke",
    // Core + plugin tools routed through the public /tools/invoke ToolInvoker.
    match: { toolNames: ["tools.invoke"] },
    execute: { command: "tools.invoke" },
    capabilities: { fs: false, network: true, streaming: false },
  },
];

export class AdapterRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterRegistryError";
  }
}

/** A registry of tool adapters with id de-dup and tool-name resolution. */
export class AdapterRegistry {
  private readonly byId = new Map<string, ToolAdapter>();
  private readonly byToolName = new Map<string, ToolAdapter>();

  constructor(seed: ToolAdapter[] = BUILTIN_ADAPTERS) {
    for (const adapter of seed) {
      this.register(adapter);
    }
  }

  /** Register (schema-validated). Throws on duplicate id. */
  register(raw: unknown): ToolAdapter {
    const adapter = parseContract(ToolAdapter, raw, "ToolAdapter");
    if (this.byId.has(adapter.id)) {
      throw new AdapterRegistryError(`Duplicate adapter id: "${adapter.id}"`);
    }
    this.byId.set(adapter.id, adapter);
    for (const name of adapter.match.toolNames) {
      this.byToolName.set(name, adapter);
    }
    return adapter;
  }

  /** Resolve the adapter bound to a tool name, or null when none matches. */
  resolve(toolName: string): ToolAdapter | null {
    return this.byToolName.get(toolName) ?? null;
  }

  /** All registered adapters (insertion order by id). */
  list(): ToolAdapter[] {
    return [...this.byId.values()];
  }
}
