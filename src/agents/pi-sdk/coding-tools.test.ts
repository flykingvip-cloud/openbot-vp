import { describe, expect, it } from "vitest";
import { createWorkspaceCodingTools, createWorkspaceReadTool } from "./coding-tools.js";

describe("workspace coding tool factories", () => {
  it("throws when the workspace root is empty", () => {
    expect(() => createWorkspaceCodingTools("")).toThrow(/non-empty workspace root/);
    expect(() => createWorkspaceCodingTools("   ")).toThrow(/non-empty workspace root/);
    expect(() => createWorkspaceReadTool("")).toThrow(/non-empty workspace root/);
  });
});
