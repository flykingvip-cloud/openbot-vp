import { describe, expect, it } from "vitest";
import {
  createCapabilityCenterMcpListState,
  createCapabilityCenterSkillsListState,
  createInitialAssetListState,
} from "./asset-list.ts";

describe("enterprise asset list initial state", () => {
  it("keeps the all-capabilities sidebar default on my-installed", () => {
    expect(createInitialAssetListState().sidebarEntry).toBe("my-installed");
  });

  it("loads the capability-center skills tab from the full registry, newest first", () => {
    const state = createCapabilityCenterSkillsListState();
    expect(state.sidebarEntry).toBe("all");
    expect(state.sorting).toEqual({ field: "createdAt", direction: "desc" });
    expect(state.catalog).toBe("skills");
  });

  it("loads the capability-center MCP tab from the full registry, newest first", () => {
    const state = createCapabilityCenterMcpListState();
    expect(state.sidebarEntry).toBe("all");
    expect(state.sorting).toEqual({ field: "createdAt", direction: "desc" });
    expect(state.catalog).toBe("mcp");
  });
});
