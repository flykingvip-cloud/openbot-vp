/**
 * Orchestration Plane — dormant grayscale (P4.5d/e/f).
 *
 * Observation / scoring only. Binds `web_read`, `browser`, `node_fs_read`,
 * and `node_exec` to existing tool factories **by symbol name**. This file
 * must not import or call createWebSearchTool / createWebFetchTool /
 * createBrowserTool / createNodesTool / listNodes / system.run /
 * sessions_spawn.
 *
 * Not a production enable: ORCH_* flags and ORCHESTRATION_LIVE_INVOKE stay
 * unchanged. nodeEnabled / browserEnabled are gates on the test/route input
 * only — env defaults stay OFF.
 */

import type { ExecutionSurface } from "./types.js";

/** Surfaces eligible for shadow observation in this slice. */
export const DORMANT_GRAYSCALE_SURFACES = [
  "web_read",
  "browser",
  "node_fs_read",
  "node_exec",
] as const;

export type DormantGrayscaleSurface = (typeof DORMANT_GRAYSCALE_SURFACES)[number];

export const WEB_READ_FACTORY_SYMBOLS = ["createWebSearchTool", "createWebFetchTool"] as const;

export type WebReadFactorySymbol = (typeof WEB_READ_FACTORY_SYMBOLS)[number];

export const WEB_READ_TOOL_NAMES = ["web_search", "web_fetch"] as const;

export type WebReadToolName = (typeof WEB_READ_TOOL_NAMES)[number];

export const BROWSER_FACTORY_SYMBOLS = ["createBrowserTool"] as const;

export type BrowserFactorySymbol = (typeof BROWSER_FACTORY_SYMBOLS)[number];

export const BROWSER_TOOL_NAMES = ["browser"] as const;

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];

export const NODE_FACTORY_SYMBOLS = ["createNodesTool", "listNodes"] as const;

export type NodeFactorySymbol = (typeof NODE_FACTORY_SYMBOLS)[number];

export const NODE_COMMAND_SYMBOLS = ["system.run"] as const;

export type NodeCommandSymbol = (typeof NODE_COMMAND_SYMBOLS)[number];

export const NODE_TOOL_NAMES = ["nodes", "listNodes", "system.run"] as const;

export type NodeToolName = (typeof NODE_TOOL_NAMES)[number];

/**
 * Typed name-only binding. `execute` is a literal false so a later invoke PR
 * cannot silently treat this as a live handle.
 */
export type SurfaceToolBinding = {
  surface: DormantGrayscaleSurface;
  factorySymbol:
    | WebReadFactorySymbol
    | BrowserFactorySymbol
    | NodeFactorySymbol
    | NodeCommandSymbol;
  toolName: WebReadToolName | BrowserToolName | NodeToolName;
  /** Repo-root relative source of the factory. Observation only. */
  source:
    | "src/agents/tools/web-search.ts"
    | "src/agents/tools/web-fetch.ts"
    | "src/agents/tools/browser-tool.ts"
    | "src/agents/tools/nodes-tool.ts"
    | "src/agents/tools/nodes-utils.ts";
  readonly execute: false;
};

export const WEB_READ_TOOL_BINDINGS: readonly SurfaceToolBinding[] = [
  {
    surface: "web_read",
    factorySymbol: "createWebSearchTool",
    toolName: "web_search",
    source: "src/agents/tools/web-search.ts",
    execute: false,
  },
  {
    surface: "web_read",
    factorySymbol: "createWebFetchTool",
    toolName: "web_fetch",
    source: "src/agents/tools/web-fetch.ts",
    execute: false,
  },
];

export const BROWSER_TOOL_BINDINGS: readonly SurfaceToolBinding[] = [
  {
    surface: "browser",
    factorySymbol: "createBrowserTool",
    toolName: "browser",
    source: "src/agents/tools/browser-tool.ts",
    execute: false,
  },
];

const NODE_SHARED_BINDINGS = [
  {
    factorySymbol: "createNodesTool",
    toolName: "nodes",
    source: "src/agents/tools/nodes-tool.ts",
    execute: false,
  },
  {
    factorySymbol: "listNodes",
    toolName: "listNodes",
    source: "src/agents/tools/nodes-utils.ts",
    execute: false,
  },
  {
    factorySymbol: "system.run",
    toolName: "system.run",
    source: "src/agents/tools/nodes-tool.ts",
    execute: false,
  },
] as const;

export const NODE_FS_READ_TOOL_BINDINGS: readonly SurfaceToolBinding[] = NODE_SHARED_BINDINGS.map(
  (binding) => ({ ...binding, surface: "node_fs_read" as const }),
);

export const NODE_EXEC_TOOL_BINDINGS: readonly SurfaceToolBinding[] = NODE_SHARED_BINDINGS.map(
  (binding) => ({ ...binding, surface: "node_exec" as const }),
);

export function isDormantGrayscaleSurface(
  surface: ExecutionSurface | undefined,
): surface is DormantGrayscaleSurface {
  return (
    surface === "web_read" ||
    surface === "browser" ||
    surface === "node_fs_read" ||
    surface === "node_exec"
  );
}

/**
 * Return typed symbol bindings for a selected surface.
 * Non-grayscale surfaces return empty.
 */
export function bindSurfaceTools(
  surface: ExecutionSurface | undefined,
): readonly SurfaceToolBinding[] {
  if (surface === "web_read") {
    return WEB_READ_TOOL_BINDINGS;
  }
  if (surface === "browser") {
    return BROWSER_TOOL_BINDINGS;
  }
  if (surface === "node_fs_read") {
    return NODE_FS_READ_TOOL_BINDINGS;
  }
  if (surface === "node_exec") {
    return NODE_EXEC_TOOL_BINDINGS;
  }
  return [];
}
