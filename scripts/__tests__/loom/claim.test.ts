import { describe, expect, it } from "vitest";
import { claimTaskId, findUnattributedPaths, groupByDir } from "../../loom/claim.js";
import { applyRegister } from "../../loom/register.js";
import { type Registry, emptyRegistry, validateRegistry } from "../../loom/registry.js";

function registry(tasks: Array<{ id: string; owner: string; paths: string[] }>): Registry {
  return validateRegistry({
    version: 1,
    tasks: tasks.map((t) => ({ ...t, sessions: [] })),
    landingStreams: [],
  });
}

describe("loom/claim — findUnattributedPaths", () => {
  it("returns files no task claims", () => {
    const reg = registry([{ id: "t", owner: "kiro", paths: ["src/auth/**"] }]);
    const un = findUnattributedPaths(reg, ["src/auth/a.ts", "docs/x.md", "src/ui/b.ts"]);
    expect(un).toEqual(["docs/x.md", "src/ui/b.ts"]);
  });

  it("returns all files when registry is empty", () => {
    expect(findUnattributedPaths(emptyRegistry(), ["a.ts", "b.ts"])).toEqual(["a.ts", "b.ts"]);
  });
});

describe("loom/claim — groupByDir", () => {
  it("groups by parent dir (root → '.')", () => {
    const g = groupByDir(["src/a/x.ts", "src/a/y.ts", "README.md"]);
    expect(g.get("src/a")).toEqual(["src/a/x.ts", "src/a/y.ts"]);
    expect(g.get(".")).toEqual(["README.md"]);
  });
});

describe("loom/claim — sign-in via applyRegister (claim semantics)", () => {
  it("claiming files makes them attributed to the agent's catch-all task", () => {
    const owner = "kiro-x";
    const taskId = claimTaskId(owner);
    expect(taskId).toBe("agent:kiro-x");
    const files = ["src/new/a.ts", "src/new/b.ts"];
    const reg = applyRegister(emptyRegistry(), { taskId, owner, paths: files });
    // after claim, those files are no longer unattributed
    expect(findUnattributedPaths(reg, files)).toEqual([]);
    expect(reg.tasks[0].owner).toBe(owner);
  });
});
