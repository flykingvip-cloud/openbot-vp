import path from "node:path";
import { describe, expect, it } from "vitest";
import { clampExecWorkdirToWorkspaceRoot } from "./bash-tools.shared.js";

describe("clampExecWorkdirToWorkspaceRoot", () => {
  it("keeps workdir inside the workspace root", () => {
    const root = path.resolve("/tmp/collab-group-a");
    const inside = path.join(root, "subdir");
    expect(clampExecWorkdirToWorkspaceRoot({ workdir: inside, workspaceRoot: root })).toEqual({
      workdir: inside,
      clamped: false,
    });
  });

  it("clamps model workdir outside the collaboration workspace root", () => {
    const root = path.resolve("/tmp/collab-group-a");
    const outside = path.resolve("/tmp/agents/main/workspace");
    expect(clampExecWorkdirToWorkspaceRoot({ workdir: outside, workspaceRoot: root })).toEqual({
      workdir: root,
      clamped: true,
    });
  });
});
