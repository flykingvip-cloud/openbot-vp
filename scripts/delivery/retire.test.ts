import { describe, expect, it } from "vitest";
import type { GitRunner } from "./forward-guard.ts";
import {
  archiveTagName,
  buildRetirePlan,
  planRef,
  renderRetirementLedger,
  type RefCandidate,
  type RetireContext,
} from "./retire.ts";

const DATE = "2026-07-27T12:00:00Z";

/** `containedIn[baseline]` lists refs the baseline contains. */
function ancestryRunner(containedIn: Record<string, string[]>): GitRunner {
  return (args) => {
    if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
      const [, , ref, baseline] = args;
      const contained = containedIn[baseline ?? ""] ?? [];
      return { code: contained.includes(ref ?? "") ? 0 : 1, stdout: "" };
    }
    return { code: 1, stdout: "" };
  };
}

function context(overrides: Partial<RetireContext> = {}): RetireContext {
  return {
    baseline: "origin/main",
    worktreeHeld: new Set(),
    prReferenced: new Set(),
    protectedNames: new Set(["main"]),
    ...overrides,
  };
}

const contained: RefCandidate = { name: "feat/done", kind: "local-branch", rev: "feat/done" };
const diverged: RefCandidate = { name: "feat/wip", kind: "local-branch", rev: "feat/wip" };

describe("archiveTagName", () => {
  it("flattens slashes and stamps the date", () => {
    expect(archiveTagName("cursor/im-soft-bridge", DATE)).toBe(
      "archive/cursor-im-soft-bridge-20260727",
    );
  });

  it("strips characters that are not safe in a ref name", () => {
    expect(archiveTagName("wip/foo bar~1", DATE)).toBe("archive/wip-foo-bar-1-20260727");
  });
});

describe("planRef", () => {
  const git = ancestryRunner({ "origin/main": ["feat/done"] });

  it("deletes a contained ref without an archive, because containment is the archive", () => {
    const entry = planRef(contained, context(), git, DATE);
    expect(entry.verdict.action).toBe("delete");
  });

  it("requires an archive tag for a diverged ref", () => {
    const entry = planRef(diverged, context(), git, DATE);
    expect(entry.verdict.action).toBe("archive-then-delete");
    if (entry.verdict.action === "archive-then-delete") {
      expect(entry.verdict.archiveTag).toBe("archive/feat-wip-20260727");
    }
  });

  it("holds a protected ref", () => {
    const entry = planRef(
      { name: "main", kind: "local-branch", rev: "main" },
      context(),
      git,
      DATE,
    );
    expect(entry.verdict.action).toBe("hold");
  });

  // Guard order: containment is not a licence to yank a ref someone has checked out.
  // The 2026-07-27 pass found 5 contained branches held by worktrees and 1 by a PR; deleting
  // them would have broken other agents' checkouts even though nothing would be lost from git.
  it("holds a contained ref that a worktree has checked out", () => {
    const entry = planRef(contained, context({ worktreeHeld: new Set(["feat/done"]) }), git, DATE);
    expect(entry.verdict.action).toBe("hold");
    expect(entry.verdict.reason).toContain("worktree");
  });

  it("holds a contained ref referenced by an open pull request", () => {
    const entry = planRef(contained, context({ prReferenced: new Set(["feat/done"]) }), git, DATE);
    expect(entry.verdict.action).toBe("hold");
    expect(entry.verdict.reason).toContain("pull request");
  });

  it("does not apply the worktree guard to remote branches", () => {
    const remote: RefCandidate = {
      name: "feat/done",
      kind: "remote-branch",
      rev: "feat/done",
    };
    const entry = planRef(remote, context({ worktreeHeld: new Set(["feat/done"]) }), git, DATE);
    expect(entry.verdict.action).toBe("delete");
  });
});

describe("buildRetirePlan", () => {
  it("counts each action", () => {
    const git = ancestryRunner({ "origin/main": ["feat/done"] });
    const plan = buildRetirePlan(
      [contained, diverged, { name: "main", kind: "local-branch", rev: "main" }],
      context(),
      git,
      DATE,
    );
    expect(plan.counts).toEqual({ delete: 1, archiveThenDelete: 1, hold: 1 });
  });
});

describe("renderRetirementLedger", () => {
  it("emits a row per ref with the archive tag for archived ones", () => {
    const git = ancestryRunner({ "origin/main": ["feat/done"] });
    const plan = buildRetirePlan([contained, diverged], context(), git, DATE);
    const rendered = renderRetirementLedger(plan, DATE);
    expect(rendered).toContain("| feat/done | local-branch | delete |");
    expect(rendered).toContain("archive/feat-wip-20260727");
    expect(rendered).toContain("delete 1 · archive-then-delete 1 · hold 0");
  });
});
