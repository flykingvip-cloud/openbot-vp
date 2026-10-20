import { describe, expect, it } from "vitest";
import { auditFiles, canWriteBaselineOnto, type TreeReader } from "./file-forward-guard.ts";
import { buildPayload, changedPaths, createGitTreeReader } from "./file-guard-cli.ts";
import type { GitResult, GitRunner } from "./forward-guard.ts";

function stubGit(responses: Record<string, GitResult>): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = (args) => {
    calls.push(args);
    return responses[args.join(" ")] ?? { code: 1, stdout: "", stderr: "not stubbed" };
  };
  return { git, calls };
}

function ok(stdout: string): GitResult {
  return { code: 0, stdout };
}

describe("changedPaths", () => {
  it("keeps only source files and drops declaration files", () => {
    const { git } = stubGit({
      "diff --name-only live cand -- src ui/src scripts": ok(
        "src/a.ts\nsrc/b.d.ts\ndocs/x.md\nui/src/c.tsx\n",
      ),
    });
    expect(changedPaths("live", "cand", git)).toEqual(["src/a.ts", "ui/src/c.tsx"]);
  });

  it("returns nothing when git fails rather than throwing", () => {
    const { git } = stubGit({});
    expect(changedPaths("live", "cand", git)).toEqual([]);
  });
});

describe("createGitTreeReader", () => {
  it("reads a blob and caches it so a moved-export scan does not re-shell", () => {
    const { git, calls } = stubGit({ "show ref:src/a.ts": ok("export const a = 1;\n") });
    const reader = createGitTreeReader("ref", git);
    expect(reader.read("src/a.ts")).toBe("export const a = 1;\n");
    expect(reader.read("src/a.ts")).toBe("export const a = 1;\n");
    expect(calls.filter((args) => args[0] === "show")).toHaveLength(1);
  });

  it("caches a missing blob as null instead of retrying it", () => {
    const { git, calls } = stubGit({});
    const reader = createGitTreeReader("ref", git);
    expect(reader.read("src/gone.ts")).toBeNull();
    expect(reader.read("src/gone.ts")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("strips the ref prefix git grep puts on every path", () => {
    const { git } = stubGit({
      "grep -l -w -e Foo ref -- src ui/src scripts": ok("ref:src/a.ts\nref:src/b.ts\n"),
    });
    expect(createGitTreeReader("ref", git).grep?.("Foo")).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("treats a grep miss as an empty result, not a failure", () => {
    const { git } = stubGit({});
    expect(createGitTreeReader("ref", git).grep?.("Absent")).toEqual([]);
  });
});

function tree(files: Record<string, string>): TreeReader {
  return { read: (path) => files[path] ?? null, list: () => Object.keys(files) };
}

describe("buildPayload", () => {
  const baselineTree = tree({ "src/a.ts": "export const keep = 1;\nexport const drop = 2;\n" });
  const candidateTree = tree({ "src/a.ts": "export const keep = 1;\n" });

  it("blocks and names only the exports with nowhere else to go", () => {
    const summary = auditFiles(["src/a.ts"], baselineTree, candidateTree);
    const payload = buildPayload({
      baseline: "live",
      candidate: "cand",
      summary,
      repairs: [],
    });
    expect(payload.verdict).toBe("block");
    expect(payload.regressions).toEqual([
      { path: "src/a.ts", verdict: "regression", lost: ["drop"], starReexportWarning: [] },
    ]);
  });

  it("allows when nothing deployed was dropped", () => {
    const summary = auditFiles(["src/a.ts"], baselineTree, baselineTree);
    const payload = buildPayload({ baseline: "live", candidate: "cand", summary, repairs: [] });
    expect(payload.verdict).toBe("allow");
    expect(payload.regressions).toEqual([]);
  });

  it("lists files whose export surface could not be fully enumerated", () => {
    const summary = auditFiles(
      ["src/barrel.ts"],
      tree({ "src/barrel.ts": `export * from "./x.ts";\nexport const a = 1;\n` }),
      tree({
        "src/barrel.ts": `export * from "./x.ts";\nexport const a = 1;\nexport const b = 2;\n`,
      }),
    );
    const payload = buildPayload({ baseline: "live", candidate: "cand", summary, repairs: [] });
    expect(payload.incompleteSurfaces).toEqual(["src/barrel.ts"]);
  });

  it("carries the repair feasibility so a blocked file says what it would take", () => {
    const summary = auditFiles(["src/a.ts"], baselineTree, candidateTree);
    const repairs = [canWriteBaselineOnto("src/a.ts", baselineTree, candidateTree)];
    const payload = buildPayload({ baseline: "live", candidate: "cand", summary, repairs });
    expect(payload.repairs).toEqual([{ path: "src/a.ts", feasible: true, unresolved: [] }]);
  });
});
