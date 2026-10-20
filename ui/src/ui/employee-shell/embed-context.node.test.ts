import { describe, expect, it } from "vitest";
import { resolveEmbedRenderContext } from "./embed-context.ts";

describe("resolveEmbedRenderContext", () => {
  it("marks canonical embed routes as chrome-less and resolves the surface", () => {
    const overview = resolveEmbedRenderContext("/embed/employee/overview");
    expect(overview).toEqual({ isEmbedRoute: true, surface: "overview", chromeless: true });

    const workspace = resolveEmbedRenderContext("/embed/employee/workspace?tab=tasks");
    expect(workspace.isEmbedRoute).toBe(true);
    expect(workspace.surface).toBe("workspace");
    expect(workspace.chromeless).toBe(true);
  });

  it("treats non-embed paths as full-chrome", () => {
    for (const path of ["/", "/me", "/dashboard", "/embed/employee/unknown", "/embed/employee/"]) {
      expect(resolveEmbedRenderContext(path)).toEqual({
        isEmbedRoute: false,
        surface: null,
        chromeless: false,
      });
    }
  });
});
