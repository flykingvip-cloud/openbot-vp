import { describe, expect, it } from "vitest";
import { hasErrors, lintRegistry } from "../../loom/lint.js";
import type { Registry } from "../../loom/registry.js";

// Build a raw registry object (bypassing zod) so we can exercise semantic lint
// checks that structural validation would otherwise reject (e.g. duplicate ids).
function raw(reg: Partial<Registry>): Registry {
  return { version: 1, tasks: [], landingStreams: [], sharedPaths: [], ...reg } as Registry;
}

function task(id: string, owner: string, paths: string[], state = "active", issue?: number) {
  return {
    id,
    owner,
    issue,
    intent: [],
    paths,
    state,
    sessions: [],
    metadata: {},
  } as Registry["tasks"][number];
}

describe("loom/lint", () => {
  it("returns no issues for a clean registry", () => {
    // A "clean" active task now requires an issue binding (R2.4), so the fixtures
    // carry issue numbers; see the active-task-no-issue block below.
    const issues = lintRegistry(
      raw({
        tasks: [
          task("a", "kiro", ["src/a/**"], "active", 1),
          task("b", "kiro", ["src/b/**"], "active", 2),
        ],
        landingStreams: [
          { id: "S", paths: ["src/**"], landingPolicy: "serial", canLandWith: [], metadata: {} },
        ],
      }),
    );
    expect(issues).toEqual([]);
  });

  it("flags duplicate task ids as an error", () => {
    const issues = lintRegistry(
      raw({ tasks: [task("dup", "k", ["a/**"]), task("dup", "k", ["b/**"])] }),
    );
    expect(issues.some((i) => i.code === "duplicate-task-id" && i.severity === "error")).toBe(true);
    expect(hasErrors(issues)).toBe(true);
  });

  it("flags an empty owner as an error", () => {
    const issues = lintRegistry(raw({ tasks: [task("a", "  ", ["a/**"])] }));
    expect(issues.some((i) => i.code === "empty-owner")).toBe(true);
  });

  it("flags dangling canLandWith references", () => {
    const issues = lintRegistry(
      raw({
        landingStreams: [
          {
            id: "A",
            paths: ["a/**"],
            landingPolicy: "serial",
            canLandWith: ["GHOST"],
            metadata: {},
          },
        ],
      }),
    );
    expect(issues.some((i) => i.code === "dangling-can-land-with")).toBe(true);
  });

  it("warns on cross-task path overlap (CONFLICT risk)", () => {
    const issues = lintRegistry(
      raw({ tasks: [task("a", "k", ["src/shared/**"]), task("b", "k", ["src/shared/**"])] }),
    );
    expect(issues.some((i) => i.code === "ownership-overlap" && i.severity === "warn")).toBe(true);
  });

  it("warns on an active task with no paths", () => {
    const issues = lintRegistry(raw({ tasks: [task("a", "k", [])] }));
    expect(issues.some((i) => i.code === "active-task-no-paths")).toBe(true);
  });

  // R2.4: `issue` is the intent → code → release join key. Staged as a warning
  // while the 35 pre-existing active tasks are backfilled (spec task 1.5/1.6).
  describe("active-task-no-issue", () => {
    it("warns on an active task with no issue and points at the fix", () => {
      const issues = lintRegistry(raw({ tasks: [task("a", "k", ["src/a/**"])] }));
      const found = issues.find((i) => i.code === "active-task-no-issue");
      expect(found?.severity).toBe("warn");
      expect(found?.detail).toContain('"a"');
      expect(found?.detail).toContain("loom task start --issue");
    });

    it("stays quiet once the task carries an issue", () => {
      const issues = lintRegistry(raw({ tasks: [task("a", "k", ["src/a/**"], "active", 234)] }));
      expect(issues.some((i) => i.code === "active-task-no-issue")).toBe(false);
    });

    it("does not flag terminal or pre-triage states", () => {
      for (const state of ["landed", "abandoned", "claimed", "paused", "blocked"] as const) {
        const issues = lintRegistry(raw({ tasks: [task("a", "k", ["src/a/**"], state)] }));
        expect(issues.some((i) => i.code === "active-task-no-issue")).toBe(false);
      }
    });

    it("keeps lint --strict passable during the backfill window", () => {
      const issues = lintRegistry(raw({ tasks: [task("a", "k", ["src/a/**"])] }));
      expect(hasErrors(issues)).toBe(false);
    });

    it("is not satisfied by an issue smuggled through metadata", () => {
      // metadata is `.passthrough()`, so this parses — but it is not the join key.
      const smuggled = {
        ...task("a", "k", ["src/a/**"]),
        metadata: { issue: 234 },
      } as Registry["tasks"][number];
      const issues = lintRegistry(raw({ tasks: [smuggled] }));
      expect(issues.some((i) => i.code === "active-task-no-issue")).toBe(true);
    });
  });

  it("stops reporting overlap once one side reaches a terminal state", () => {
    // A closed task no longer claims paths, so the overlap it used to cause is
    // gone; keeping the warning would mean the noise never drops as work closes.
    for (const terminal of ["landed", "abandoned"] as const) {
      const issues = lintRegistry(
        raw({
          tasks: [
            task("live", "k", ["src/shared/**"]),
            task("closed", "k", ["src/shared/**"], terminal),
          ],
        }),
      );
      expect(issues.some((i) => i.code === "ownership-overlap")).toBe(false);
    }
  });

  it("still reports overlap between two open tasks in non-terminal states", () => {
    const issues = lintRegistry(
      raw({
        tasks: [
          task("a", "k", ["src/shared/**"], "paused"),
          task("b", "k", ["src/shared/**"], "blocked"),
        ],
      }),
    );
    expect(issues.some((i) => i.code === "ownership-overlap")).toBe(true);
  });

  // Regression: classification takes the first declared stream match, so a path
  // claimed twice is silently handed to whichever stream is declared earlier.
  // That is how test/worktree-audit.test.ts went red (SUG claims
  // scripts/worktree-audit.ts ahead of D) with nothing reporting it.
  it("flags a path claimed by two landing streams and names the winner", () => {
    const issues = lintRegistry(
      raw({
        landingStreams: [
          {
            id: "FIRST",
            paths: ["scripts/shared.ts"],
            landingPolicy: "serial",
            canLandWith: [],
            metadata: {},
          },
          {
            id: "SECOND",
            paths: ["scripts/shared.ts"],
            landingPolicy: "serial",
            canLandWith: [],
            metadata: {},
          },
        ],
      }),
    );
    const dup = issues.find((i) => i.code === "stream-path-duplicate");
    expect(dup?.severity).toBe("warn");
    expect(dup?.detail).toContain("scripts/shared.ts");
    expect(dup?.detail).toContain('gives it to "FIRST"');
    expect(dup?.detail).toContain("SECOND");
  });

  it("names every claimant when three streams claim the same path", () => {
    const stream = (id: string) => ({
      id,
      paths: ["src/hot.ts"],
      landingPolicy: "serial" as const,
      canLandWith: [],
      metadata: {},
    });
    const issues = lintRegistry(raw({ landingStreams: [stream("A"), stream("B"), stream("C")] }));
    const dup = issues.find((i) => i.code === "stream-path-duplicate");
    expect(dup?.detail).toContain("claimed by 3 streams");
    expect(dup?.detail).toContain('gives it to "A"');
    expect(dup?.detail).toContain("B, C");
  });

  it("keeps duplicate stream claims a warning so lint --strict does not break", () => {
    const issues = lintRegistry(
      raw({
        landingStreams: [
          {
            id: "A",
            paths: ["x.ts"],
            landingPolicy: "serial",
            canLandWith: [],
            metadata: {},
          },
          {
            id: "B",
            paths: ["x.ts"],
            landingPolicy: "serial",
            canLandWith: [],
            metadata: {},
          },
        ],
      }),
    );
    expect(hasErrors(issues)).toBe(false);
  });

  it("does not flag nested globs, which are a legitimate specific-before-general order", () => {
    const issues = lintRegistry(
      raw({
        landingStreams: [
          {
            id: "NARROW",
            paths: ["src/gateway/knowledge/**"],
            landingPolicy: "serial",
            canLandWith: [],
            metadata: {},
          },
          {
            id: "BROAD",
            paths: ["src/gateway/**"],
            landingPolicy: "serial",
            canLandWith: [],
            metadata: {},
          },
        ],
      }),
    );
    expect(issues.some((i) => i.code === "stream-path-duplicate")).toBe(false);
  });

  it("flags a narrow claim declared after a broad one, which can never win", () => {
    const issues = lintRegistry(
      raw({
        landingStreams: [
          {
            id: "BROAD",
            paths: ["src/gateway/**"],
            landingPolicy: "serial",
            canLandWith: [],
            metadata: {},
          },
          {
            id: "NARROW",
            paths: ["src/gateway/knowledge/**"],
            landingPolicy: "serial",
            canLandWith: [],
            metadata: {},
          },
        ],
      }),
    );
    const shadowed = issues.find((i) => i.code === "stream-path-shadowed");
    expect(shadowed?.severity).toBe("warn");
    expect(shadowed?.detail).toContain('stream "NARROW"');
    expect(shadowed?.detail).toContain("src/gateway/knowledge/**");
    expect(shadowed?.detail).toContain('earlier stream "BROAD"');
    expect(shadowed?.detail).toContain("src/gateway/**");
  });

  it("leaves narrow-before-broad alone, so the legitimate order stays quiet", () => {
    const issues = lintRegistry(
      raw({
        landingStreams: [
          {
            id: "NARROW",
            paths: ["src/gateway/knowledge/**"],
            landingPolicy: "serial",
            canLandWith: [],
            metadata: {},
          },
          {
            id: "BROAD",
            paths: ["src/gateway/**"],
            landingPolicy: "serial",
            canLandWith: [],
            metadata: {},
          },
        ],
      }),
    );
    expect(issues.some((i) => i.code === "stream-path-shadowed")).toBe(false);
  });

  it("flags a literal path swallowed by an earlier glob", () => {
    const issues = lintRegistry(
      raw({
        landingStreams: [
          {
            id: "CFG",
            paths: ["src/config/**"],
            landingPolicy: "serial",
            canLandWith: [],
            metadata: {},
          },
          {
            id: "FEATURE",
            paths: ["src/config/types.gateway.ts"],
            landingPolicy: "serial",
            canLandWith: [],
            metadata: {},
          },
        ],
      }),
    );
    const shadowed = issues.find((i) => i.code === "stream-path-shadowed");
    expect(shadowed?.detail).toContain('stream "FEATURE"');
    expect(shadowed?.detail).toContain("src/config/types.gateway.ts");
    expect(shadowed?.detail).toContain('via "src/config/**"');
  });

  it("does not double-report a byte-identical claim already covered by the duplicate check", () => {
    const issues = lintRegistry(
      raw({
        landingStreams: [
          {
            id: "FIRST",
            paths: ["src/shared.ts"],
            landingPolicy: "serial",
            canLandWith: [],
            metadata: {},
          },
          {
            id: "SECOND",
            paths: ["src/shared.ts"],
            landingPolicy: "serial",
            canLandWith: [],
            metadata: {},
          },
        ],
      }),
    );
    expect(issues.some((i) => i.code === "stream-path-duplicate")).toBe(true);
    expect(issues.some((i) => i.code === "stream-path-shadowed")).toBe(false);
  });
});

// P2.6 — `ownership-overlap` must report only UNREGISTERED overlaps. A file shared
// by design (AGENTS.md, package.json, i18n locales) would otherwise warn forever,
// and permanent noise is how a real takeover-pending signal gets lost.
describe("loom/lint — ownership-overlap vs sharedPaths (P2.6)", () => {
  const twoClaimants = [
    task("a", "kiro-a", ["AGENTS.md", "src/a/**"]),
    task("b", "kiro-b", ["AGENTS.md", "src/b/**"]),
    task("lander-task", "kiro-loom", ["docs/**"]),
  ];

  it("still warns when the overlapping path is not registered", () => {
    const issues = lintRegistry(raw({ tasks: twoClaimants }));
    const overlap = issues.find((i) => i.code === "ownership-overlap");
    expect(overlap?.detail).toContain("AGENTS.md");
  });

  it("goes silent once the overlapping path is registered as shared", () => {
    const issues = lintRegistry(
      raw({
        tasks: twoClaimants,
        sharedPaths: [{ glob: "AGENTS.md", landerTask: "lander-task" }],
      }),
    );
    expect(issues.some((i) => i.code === "ownership-overlap")).toBe(false);
  });

  it("keeps reporting the overlaps that are NOT registered", () => {
    const issues = lintRegistry(
      raw({
        tasks: [
          task("a", "kiro-a", ["AGENTS.md", "src/hot.ts"]),
          task("b", "kiro-b", ["AGENTS.md", "src/hot.ts"]),
          task("lander-task", "kiro-loom", ["docs/**"]),
        ],
        sharedPaths: [{ glob: "AGENTS.md", landerTask: "lander-task" }],
      }),
    );
    const overlap = issues.find((i) => i.code === "ownership-overlap");
    expect(overlap?.detail).toContain("src/hot.ts");
    expect(overlap?.detail).not.toContain("AGENTS.md");
  });

  it("silences a glob overlap when a covering glob is registered", () => {
    const issues = lintRegistry(
      raw({
        tasks: [
          task("a", "kiro-a", ["ui/src/i18n/locales/en.ts"]),
          task("b", "kiro-b", ["ui/src/i18n/**"]),
          task("i18n-task", "kiro-i18n", ["docs/**"]),
        ],
        sharedPaths: [{ glob: "ui/src/i18n/**", landerTask: "i18n-task" }],
      }),
    );
    expect(issues.some((i) => i.code === "ownership-overlap")).toBe(false);
  });

  // The registration must cover BOTH sides. Covering only one leaves the overlap
  // unresolved, so it stays reported.
  it("does not silence an overlap the registration only half-covers", () => {
    const issues = lintRegistry(
      raw({
        tasks: [
          task("a", "kiro-a", ["src/**"]),
          task("b", "kiro-b", ["src/auth/**"]),
          task("docs-task", "kiro-docs", ["docs/**"]),
        ],
        sharedPaths: [{ glob: "docs/**", landerTask: "docs-task" }],
      }),
    );
    expect(issues.some((i) => i.code === "ownership-overlap")).toBe(true);
  });

  it("stays a warning, so lint --strict behavior is unchanged", () => {
    const issues = lintRegistry(
      raw({
        tasks: twoClaimants,
        sharedPaths: [{ glob: "AGENTS.md", landerTask: "lander-task" }],
      }),
    );
    expect(hasErrors(issues)).toBe(false);
  });
});

// P2.0b — a declaration with no wildcard ending in `/` compiles to `^dir\/$`,
// and `git status` reports files, never directories, so it matches nothing. The
// task's real files then read as UNATTRIBUTED, i.e. "nobody signed in" rather
// than "the glob is broken".
describe("loom/lint — impossible-glob (P2.0b)", () => {
  it("errors on a wildcard-free directory declaration and names the fix", () => {
    const issues = lintRegistry(raw({ tasks: [task("a", "kiro-a", ["src/gateway/knowledge/"])] }));
    const found = issues.find((i) => i.code === "impossible-glob");
    expect(found?.severity).toBe("error");
    expect(found?.detail).toContain('"a"');
    expect(found?.detail).toContain("src/gateway/knowledge/");
    expect(found?.detail).toContain('"src/gateway/knowledge/**"');
    expect(hasErrors(issues)).toBe(true);
  });

  it("accepts the same directory once it carries a wildcard", () => {
    const issues = lintRegistry(
      raw({ tasks: [task("a", "kiro-a", ["src/gateway/knowledge/**"])] }),
    );
    expect(issues.some((i) => i.code === "impossible-glob")).toBe(false);
  });

  it("accepts an exact file path", () => {
    const issues = lintRegistry(raw({ tasks: [task("a", "kiro-a", ["src/gateway/x.ts"])] }));
    expect(issues.some((i) => i.code === "impossible-glob")).toBe(false);
  });

  it("accepts a trailing-slash path that already has a wildcard elsewhere", () => {
    // `ui/src/ui/controllers/*/` is odd but not provably dead, so it is left alone.
    const issues = lintRegistry(raw({ tasks: [task("a", "kiro-a", ["ui/src/*/views/"])] }));
    expect(issues.some((i) => i.code === "impossible-glob")).toBe(false);
  });

  it("reports every broken declaration on a task, not just the first", () => {
    const issues = lintRegistry(
      raw({ tasks: [task("a", "kiro-a", ["src/a/", "src/b/", "ok/**"])] }),
    );
    expect(issues.filter((i) => i.code === "impossible-glob")).toHaveLength(2);
  });

  // Terminal tasks release their paths anyway, so a dead glob there claims
  // nothing either way; erroring would just be noise nobody can act on.
  it("skips terminal-state tasks", () => {
    for (const state of ["landed", "abandoned"] as const) {
      const issues = lintRegistry(raw({ tasks: [task("a", "kiro-a", ["src/a/"], state)] }));
      expect(issues.some((i) => i.code === "impossible-glob")).toBe(false);
    }
  });

  it("still reports pre-triage states, where the work is not finished", () => {
    for (const state of ["claimed", "paused", "blocked", "ready"] as const) {
      const issues = lintRegistry(raw({ tasks: [task("a", "kiro-a", ["src/a/"], state)] }));
      expect(issues.some((i) => i.code === "impossible-glob")).toBe(true);
    }
  });
});

describe("loom/lint — sharedPaths consistency", () => {
  const shared = (glob: string, landerTask: string, extra: Record<string, string> = {}) => ({
    glob,
    landerTask,
    ...extra,
  });

  it("errors when landerTask names a task that does not exist", () => {
    const issues = lintRegistry(
      raw({
        tasks: [task("a", "kiro", ["AGENTS.md"])],
        sharedPaths: [shared("AGENTS.md", "ghost:nobody")],
      }),
    );
    const issue = issues.find((i) => i.code === "dangling-shared-lander-task");
    // error, not warn: the registration silences the overlap warning while naming
    // nobody, which is strictly worse than leaving the CONFLICT visible.
    expect(issue?.severity).toBe("error");
    expect(issue?.detail).toContain("ghost:nobody");
    expect(hasErrors(issues)).toBe(true);
  });

  it("accepts a landerTask that resolves to a real task", () => {
    const issues = lintRegistry(
      raw({
        tasks: [task("a", "kiro", ["AGENTS.md"])],
        sharedPaths: [shared("AGENTS.md", "a")],
      }),
    );
    expect(issues.some((i) => i.code === "dangling-shared-lander-task")).toBe(false);
  });

  it("warns on a duplicate glob, because only the first declaration takes effect", () => {
    const issues = lintRegistry(
      raw({
        tasks: [task("a", "kiro", ["AGENTS.md"])],
        sharedPaths: [shared("AGENTS.md", "a"), shared("AGENTS.md", "a")],
      }),
    );
    const issue = issues.find((i) => i.code === "duplicate-shared-glob");
    expect(issue?.severity).toBe("warn");
  });

  it("warns once review is due, and leaves the registration in force", () => {
    const issues = lintRegistry(
      raw({
        tasks: [task("a", "kiro", ["AGENTS.md"])],
        sharedPaths: [shared("AGENTS.md", "a", { reviewAfter: "2000-01-01" })],
      }),
    );
    const issue = issues.find((i) => i.code === "shared-path-review-due");
    // warn, never an error or an auto-expiry: expiring would silently revert the
    // path to a permanent CONFLICT with nobody noticing.
    expect(issue?.severity).toBe("warn");
    expect(hasErrors(issues)).toBe(false);
  });

  it("stays quiet when the review date is still in the future", () => {
    const issues = lintRegistry(
      raw({
        tasks: [task("a", "kiro", ["AGENTS.md"])],
        sharedPaths: [shared("AGENTS.md", "a", { reviewAfter: "2999-12-31" })],
      }),
    );
    expect(issues.some((i) => i.code === "shared-path-review-due")).toBe(false);
  });
});

describe("loom/lint — ownership-overlap vs sharedPaths", () => {
  const overlapping = (sharedPaths: Registry["sharedPaths"]) =>
    lintRegistry(
      raw({
        tasks: [task("a", "kiro", ["docs/**"]), task("b", "cursor", ["docs/channels/**"])],
        sharedPaths,
      }),
    ).filter((i) => i.code === "ownership-overlap");

  it("silences the overlap only when a registration covers both sides", () => {
    expect(overlapping([{ glob: "docs/**", landerTask: "a" }])).toEqual([]);
  });

  it("keeps warning when the registration covers just one side", () => {
    // Covering one side resolves nothing: task `a` still has no designated lander
    // for the overlapping region.
    expect(overlapping([{ glob: "docs/channels/**", landerTask: "b" }])).toHaveLength(1);
  });

  it("keeps warning when nothing is registered", () => {
    expect(overlapping([])).toHaveLength(1);
  });

  it("is not silenced by a broad glob that only overlaps heuristically", () => {
    // `globsOverlap("*.md", "docs/**")` is true (empty literal prefix), so using it
    // to decide coverage would let one loose registration mute every real overlap.
    // Coverage is decided with the anchored matcher instead.
    expect(overlapping([{ glob: "*.md", landerTask: "a" }])).toHaveLength(1);
  });
});
