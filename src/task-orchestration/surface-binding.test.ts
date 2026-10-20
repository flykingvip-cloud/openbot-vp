import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BROWSER_TOOL_BINDINGS,
  DORMANT_GRAYSCALE_SURFACES,
  NODE_EXEC_TOOL_BINDINGS,
  NODE_FS_READ_TOOL_BINDINGS,
  WEB_READ_TOOL_BINDINGS,
  bindSurfaceTools,
  isDormantGrayscaleSurface,
} from "./surface-binding.js";
import { ORCHESTRATION_LIVE_INVOKE, type ExecutionSurface } from "./types.js";

const BINDING_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "surface-binding.ts"),
  "utf8",
);

describe("dormant grayscale allowlist", () => {
  it("declares web_read, browser, and node surfaces in this slice", () => {
    expect(DORMANT_GRAYSCALE_SURFACES).toEqual([
      "web_read",
      "browser",
      "node_fs_read",
      "node_exec",
    ]);
    expect(isDormantGrayscaleSurface("web_read")).toBe(true);
    expect(isDormantGrayscaleSurface("browser")).toBe(true);
    expect(isDormantGrayscaleSurface("node_fs_read")).toBe(true);
    expect(isDormantGrayscaleSurface("node_exec")).toBe(true);
    const notThisSlice: readonly ExecutionSurface[] = [
      "memory",
      "skill",
      "connector",
      "outbound_message",
      "external_write",
      "broadcast",
    ];
    for (const surface of notThisSlice) {
      expect(isDormantGrayscaleSurface(surface)).toBe(false);
      expect(bindSurfaceTools(surface)).toEqual([]);
    }
  });
});

describe("web_read symbol binding", () => {
  it("binds web_read to createWebSearchTool / createWebFetchTool by name only", () => {
    const bindings = bindSurfaceTools("web_read");
    expect(bindings).toEqual(WEB_READ_TOOL_BINDINGS);
    expect(bindings.map((b) => b.factorySymbol)).toEqual([
      "createWebSearchTool",
      "createWebFetchTool",
    ]);
    expect(bindings.map((b) => b.toolName)).toEqual(["web_search", "web_fetch"]);
    expect(bindings.map((b) => b.source)).toEqual([
      "src/agents/tools/web-search.ts",
      "src/agents/tools/web-fetch.ts",
    ]);
    for (const binding of bindings) {
      expect(binding.execute).toBe(false);
      expect(binding.surface).toBe("web_read");
    }
  });
});

describe("browser symbol binding", () => {
  it("binds browser to createBrowserTool by name only", () => {
    const bindings = bindSurfaceTools("browser");
    expect(bindings).toEqual(BROWSER_TOOL_BINDINGS);
    expect(bindings.map((b) => b.factorySymbol)).toEqual(["createBrowserTool"]);
    expect(bindings.map((b) => b.toolName)).toEqual(["browser"]);
    expect(bindings.map((b) => b.source)).toEqual(["src/agents/tools/browser-tool.ts"]);
    for (const binding of bindings) {
      expect(binding.execute).toBe(false);
      expect(binding.surface).toBe("browser");
    }
  });
});

describe("node surface symbol binding", () => {
  it("binds node_fs_read to createNodesTool / listNodes / system.run by name only", () => {
    const bindings = bindSurfaceTools("node_fs_read");
    expect(bindings).toEqual(NODE_FS_READ_TOOL_BINDINGS);
    expect(bindings.map((b) => b.factorySymbol)).toEqual([
      "createNodesTool",
      "listNodes",
      "system.run",
    ]);
    expect(bindings.map((b) => b.toolName)).toEqual(["nodes", "listNodes", "system.run"]);
    expect(bindings.map((b) => b.source)).toEqual([
      "src/agents/tools/nodes-tool.ts",
      "src/agents/tools/nodes-utils.ts",
      "src/agents/tools/nodes-tool.ts",
    ]);
    for (const binding of bindings) {
      expect(binding.execute).toBe(false);
      expect(binding.surface).toBe("node_fs_read");
    }
  });

  it("binds node_exec to the same symbols by name only", () => {
    const bindings = bindSurfaceTools("node_exec");
    expect(bindings).toEqual(NODE_EXEC_TOOL_BINDINGS);
    expect(bindings.map((b) => b.factorySymbol)).toEqual([
      "createNodesTool",
      "listNodes",
      "system.run",
    ]);
    for (const binding of bindings) {
      expect(binding.execute).toBe(false);
      expect(binding.surface).toBe("node_exec");
    }
  });

  it("does not import or call web / browser / node factory symbols", () => {
    expect(BINDING_SOURCE).not.toMatch(/from ["'].*web-search/);
    expect(BINDING_SOURCE).not.toMatch(/from ["'].*web-fetch/);
    expect(BINDING_SOURCE).not.toMatch(/from ["'].*web-tools/);
    expect(BINDING_SOURCE).not.toMatch(/from ["'].*browser-tool/);
    expect(BINDING_SOURCE).not.toMatch(/from ["'].*nodes-tool/);
    expect(BINDING_SOURCE).not.toMatch(/from ["'].*nodes-utils/);
    expect(BINDING_SOURCE).not.toMatch(/from ["'].*sessions-spawn/);
    expect(BINDING_SOURCE).not.toMatch(/createWebSearchTool\s*\(/);
    expect(BINDING_SOURCE).not.toMatch(/createWebFetchTool\s*\(/);
    expect(BINDING_SOURCE).not.toMatch(/createBrowserTool\s*\(/);
    expect(BINDING_SOURCE).not.toMatch(/createNodesTool\s*\(/);
    expect(BINDING_SOURCE).not.toMatch(/listNodes\s*\(/);
    expect(BINDING_SOURCE).not.toMatch(/createSessionsSpawnTool\s*\(/);
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
  });
});
