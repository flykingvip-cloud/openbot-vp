import { describe, expect, it } from "vitest";
import {
  DEFAULT_DATA_SPACE_DISPLAY_ROOT,
  deriveAgentSpacePreview,
  resolveWorkbenchDataSpaceSettings,
} from "./data-space.ts";

describe("resolveWorkbenchDataSpaceSettings", () => {
  it("defaults to local ~/OpenBot when config is empty", () => {
    const result = resolveWorkbenchDataSpaceSettings({});
    expect(result.mode).toBe("local");
    expect(result.displayRoot).toBe(DEFAULT_DATA_SPACE_DISPLAY_ROOT);
    expect(result.isConfigured).toBe(true);
  });

  it("treats managed mode as configured without exposing a path", () => {
    const result = resolveWorkbenchDataSpaceSettings({
      config: { data: { mode: "managed" } },
    });
    expect(result.mode).toBe("managed");
    expect(result.displayRoot).toBe("");
    expect(result.isConfigured).toBe(true);
  });

  it("reads data.root from config", () => {
    const result = resolveWorkbenchDataSpaceSettings({
      config: { data: { root: "/Users/you/OpenBot", schemaVersion: 1 } },
    });
    expect(result.displayRoot).toBe("/Users/you/OpenBot");
    expect(result.isConfigured).toBe(true);
  });

  it("prefers bootstrap display root for local mode", () => {
    const result = resolveWorkbenchDataSpaceSettings({
      bootstrapMode: "local",
      bootstrapDisplayRoot: "~/OpenBot",
    });
    expect(result.displayRoot).toBe("~/OpenBot");
  });
});

describe("deriveAgentSpacePreview", () => {
  it("builds agents/<id> under data root", () => {
    expect(deriveAgentSpacePreview("~/OpenBot", "sales")).toBe("~/OpenBot/agents/sales");
  });
});
