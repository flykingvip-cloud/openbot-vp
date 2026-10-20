/**
 * lint.ts — Registry business-consistency linter (Requirement 1.3, 7.1; design
 * §3.9). zod validates STRUCTURE; this validates SEMANTICS that zod cannot:
 * duplicate task ids, empty owners, dangling canLandWith refs, cross-task path
 * overlaps (ownership CONFLICT risk), and active tasks with no paths.
 */

import { TERMINAL_TASK_STATES } from "./attribution.js";
import { globsOverlap, globToRegExp } from "./glob.js";
import type { Registry, SharedPath } from "./registry.js";

/**
 * Concrete-looking sample path for a glob, so one glob can be tested against
 * another with the same matcher classification uses. `**` stands in for nested
 * segments, a single `*` for one segment.
 */
function globProbe(glob: string): string {
  return glob.replaceAll("**", "__seg__/__seg__").replaceAll("*", "__seg__");
}

/**
 * Does a shared registration cover BOTH sides of an overlap?
 *
 * Covering one side resolves nothing — the other task still has no designated
 * lander — so a half-covering registration must not silence the warning.
 *
 * Uses the anchored matcher rather than `globsOverlap`'s prefix heuristic on
 * purpose: `globsOverlap("*.md", anything)` is true because the literal prefix is
 * empty, so a broad registration like `*.md` would silence genuine conflicts.
 */
function coversBothSides(shared: SharedPath[], pa: string, pb: string): boolean {
  return shared.some((entry) => {
    const regexp = globToRegExp(entry.glob);
    return regexp.test(globProbe(pa)) && regexp.test(globProbe(pb));
  });
}

/**
 * Concrete-looking sample path for a claim, so an earlier claim can be tested
 * against it with the same matcher classification uses. `**` stands in for nested
 * segments, a single `*` for one segment.
 */
function shadowProbe(claim: string): string {
  return claim.replaceAll("**", "__seg__/__seg__").replaceAll("*", "__seg__");
}

export type LintIssue = {
  severity: "error" | "warn";
  code: string;
  detail: string;
};

export function lintRegistry(registry: Registry): LintIssue[] {
  const issues: LintIssue[] = [];

  // 1. Duplicate task ids.
  const seenTaskIds = new Set<string>();
  for (const task of registry.tasks) {
    if (seenTaskIds.has(task.id)) {
      issues.push({
        severity: "error",
        code: "duplicate-task-id",
        detail: `task id "${task.id}" appears more than once`,
      });
    }
    seenTaskIds.add(task.id);

    // 2. Empty / whitespace owner.
    if (task.owner.trim() === "") {
      issues.push({
        severity: "error",
        code: "empty-owner",
        detail: `task "${task.id}" has an empty owner`,
      });
    }

    // 5. Active task with no paths (cannot attribute anything).
    if (task.state === "active" && task.paths.length === 0) {
      issues.push({
        severity: "warn",
        code: "active-task-no-paths",
        detail: `active task "${task.id}" has no paths (nothing can be attributed to it)`,
      });
    }

    // 9. A path glob that can never match anything (P2.0b).
    //
    // `globToRegExp` anchors both ends, so a declaration with no wildcard that
    // ends in `/` compiles to `^dir\/$` — and `git status` reports FILES, never
    // directories, so that regexp matches nothing, ever. The declaration looks
    // reasonable in the registry and silently claims zero files: every file the
    // task actually touches shows up as UNATTRIBUTED, which reads as "the agent
    // never signed in" rather than "the glob is wrong".
    //
    // `error`, not `warn`: unlike overlap or shadowing, this needs no human
    // judgement about who should own what. The declaration is simply broken and
    // the fix is mechanical (`dir/` -> `dir/**`). Downgrading it would bury it
    // among the overlap warnings, which is exactly how it stayed invisible.
    //
    // Terminal tasks are skipped: they release their paths anyway (see
    // TERMINAL_TASK_STATES), so a dead glob there claims nothing either way and
    // nobody is going to reopen closed work to repair it.
    if (!TERMINAL_TASK_STATES.has(task.state)) {
      for (const glob of task.paths) {
        if (!glob.includes("*") && glob.endsWith("/")) {
          issues.push({
            severity: "error",
            code: "impossible-glob",
            detail: `task "${task.id}" declares "${glob}", which can never match: git reports files, not directories, so an anchored \`${glob}\` matches nothing. Use "${glob}**".`,
          });
        }
      }
    }

    // 8. Active task with no GitHub issue. `issue` is the join key for
    // intent → code → release: without it a landed commit cannot answer "why was
    // this changed", which is the whole point of Issue Coverage
    // (engineering-governance R2.4).
    //
    // Deliberately `warn` on arrival: 35 active tasks predate the field, so
    // erroring immediately would break `loom lint --strict` for every agent
    // before their owners can backfill. Promote to `error` once coverage is 100%
    // (spec task 1.6) — same staged pattern as checks 6 and 7 above.
    //
    // Only `active` is checked, matching check 5: terminal tasks no longer claim
    // work, and `claimed`/`paused`/`blocked` may legitimately predate triage.
    if (task.state === "active" && task.issue == null) {
      issues.push({
        severity: "warn",
        code: "active-task-no-issue",
        detail: `active task "${task.id}" has no issue (code changes cannot be traced back to a requirement; set \`issue:\` or run \`loom task start --issue <n>\`)`,
      });
    }
  }

  // 3. Dangling canLandWith references (stream ids that don't exist).
  const streamIds = new Set(registry.landingStreams.map((s) => s.id));
  const seenStreamIds = new Set<string>();
  for (const stream of registry.landingStreams) {
    if (seenStreamIds.has(stream.id)) {
      issues.push({
        severity: "error",
        code: "duplicate-stream-id",
        detail: `landing stream id "${stream.id}" appears more than once`,
      });
    }
    seenStreamIds.add(stream.id);
    for (const ref of stream.canLandWith) {
      if (!streamIds.has(ref)) {
        issues.push({
          severity: "error",
          code: "dangling-can-land-with",
          detail: `stream "${stream.id}" canLandWith references unknown stream "${ref}"`,
        });
      }
    }
  }

  // 6. Same literal path claimed by more than one landing stream. Classification
  // takes the FIRST declared match (buildRulesFromRegistry + find), so a duplicate
  // claim silently hands the path to whichever stream is declared earlier, with no
  // warning anywhere. That is how test/worktree-audit.test.ts went red: SUG claims
  // scripts/worktree-audit.ts and CHANGELOG.md ahead of D, ME claims doctor.ts ahead
  // of H1D, and so on. Reported as warn, not error: 45 such claims already exist, so
  // erroring would break `loom lint --strict` for every agent before their owners
  // have decided who should keep each path.
  // Only exact string matches are reported. Nested globs (a narrow stream declared
  // before a broad one) are a legitimate specific-before-general pattern and are
  // deliberately not flagged here.
  const streamOrder = new Map(registry.landingStreams.map((stream, index) => [stream.id, index]));
  const claimants = new Map<string, string[]>();
  for (const stream of registry.landingStreams) {
    for (const claimed of stream.paths) {
      const existing = claimants.get(claimed);
      if (existing) {
        existing.push(stream.id);
      } else {
        claimants.set(claimed, [stream.id]);
      }
    }
  }
  for (const [claimed, ids] of claimants) {
    if (ids.length < 2) {
      continue;
    }
    const winner = ids.reduce((best, id) =>
      (streamOrder.get(id) ?? 0) < (streamOrder.get(best) ?? 0) ? id : best,
    );
    const losers = ids.filter((id) => id !== winner);
    issues.push({
      severity: "warn",
      code: "stream-path-duplicate",
      detail: `path "${claimed}" is claimed by ${ids.length} streams (${ids.join(", ")}); declaration order gives it to "${winner}" and silently ignores ${losers.join(", ")}`,
    });
  }

  // 7. A claim that can never win because an EARLIER stream already matches it with
  // a broader glob. Classification takes the first declared match, so a narrow claim
  // declared after a broad one is dead config: the path lands in the broad stream and
  // the narrow declaration has no effect anywhere, including on the audit gate.
  //
  // This is the mirror image of what check 6 deliberately allows. Narrow BEFORE broad
  // (specific-before-general) is legitimate and stays unflagged; broad BEFORE narrow
  // is the broken order, and that is what this reports.
  //
  // Check 6 compares byte-identical strings only, so this class stayed invisible: when
  // this was added the registry carried 9 literal duplicates against 22 glob-shadowed
  // claims, meaning the visible count understated dead claims roughly threefold. It
  // surfaced when narrowing stream B's `src/gateway/control-ui**` turned out to be
  // required after removing B's literal claim on control-ui-contract.ts — the literal
  // dedupe alone left the same path still claimed through the glob.
  //
  // Heuristic in the same spirit as globsOverlap: the claim is probed by substituting
  // its wildcards, then matched with globToRegExp. Warn, not error, for the same
  // reason as check 6 — these already exist and their owners have to decide.
  const compiled = registry.landingStreams.map((stream) => ({
    id: stream.id,
    paths: stream.paths,
    regexps: stream.paths.map(globToRegExp),
  }));
  for (let i = 0; i < compiled.length; i += 1) {
    for (const claimed of compiled[i].paths) {
      const probe = shadowProbe(claimed);
      for (let j = 0; j < i; j += 1) {
        const earlier = compiled[j];
        // Byte-identical claims are check 6's job; do not report them twice.
        if (earlier.paths.includes(claimed)) {
          break;
        }
        const index = earlier.regexps.findIndex((regexp) => regexp.test(probe));
        if (index < 0) {
          continue;
        }
        issues.push({
          severity: "warn",
          code: "stream-path-shadowed",
          detail: `stream "${compiled[i].id}" claims "${claimed}", but earlier stream "${earlier.id}" already matches it via "${earlier.paths[index]}"; the claim can never win`,
        });
        break;
      }
    }
  }

  // 4. Cross-task path overlap (potential attribution CONFLICT). Terminal-state
  // tasks are excluded: they no longer claim paths (see attribution.ts
  // TERMINAL_TASK_STATES), so they cannot produce a CONFLICT and reporting them
  // would keep the overlap noise from ever going down as work closes out.
  //
  // Overlaps on paths registered in `sharedPaths` are also excluded (P2.6): those
  // are shared BY DESIGN with a named lander, so reporting them would keep this
  // check permanently noisy over files that will never be un-shared — which is
  // how a real takeover-pending signal gets lost. What remains is exactly the
  // UNREGISTERED overlap, which is the signal worth acting on.
  const openTasks = registry.tasks.filter((task) => !TERMINAL_TASK_STATES.has(task.state));
  for (let i = 0; i < openTasks.length; i += 1) {
    for (let j = i + 1; j < openTasks.length; j += 1) {
      const a = openTasks[i];
      const b = openTasks[j];
      const overlaps = a.paths.filter((pa) =>
        b.paths.some(
          (pb) => globsOverlap(pa, pb) && !coversBothSides(registry.sharedPaths, pa, pb),
        ),
      );
      if (overlaps.length > 0) {
        issues.push({
          severity: "warn",
          code: "ownership-overlap",
          detail: `tasks "${a.id}" and "${b.id}" have overlapping paths (CONFLICT risk): ${overlaps.join(", ")}`,
        });
      }
    }
  }

  // ── sharedPaths consistency ────────────────────────────────────────────────
  const taskIds = new Set(registry.tasks.map((task) => task.id));
  const seenGlobs = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);
  for (const shared of registry.sharedPaths) {
    // A registration whose lander task does not exist names nobody, which is
    // strictly worse than an unregistered CONFLICT: it silences the warning while
    // leaving the path unowned. Hence `error`, not `warn`.
    if (!taskIds.has(shared.landerTask)) {
      issues.push({
        severity: "error",
        code: "dangling-shared-lander-task",
        detail: `sharedPath "${shared.glob}" names landerTask "${shared.landerTask}", which is not a task in this registry; the path would be silenced with no accountable lander`,
      });
    }
    // First declared match wins, so a repeated glob is dead configuration.
    if (seenGlobs.has(shared.glob)) {
      issues.push({
        severity: "warn",
        code: "duplicate-shared-glob",
        detail: `sharedPath glob "${shared.glob}" is declared more than once; first-match wins, so the later declaration has no effect`,
      });
    }
    seenGlobs.add(shared.glob);
    // A reminder, never an expiry: auto-expiring would silently revert the path to
    // permanent CONFLICT with nobody noticing.
    if (shared.reviewAfter && shared.reviewAfter <= today) {
      issues.push({
        severity: "warn",
        code: "shared-path-review-due",
        detail: `sharedPath "${shared.glob}" was due for review after ${shared.reviewAfter}; confirm it is still shared by design (the registration stays in force until changed)`,
      });
    }
  }

  return issues;
}

export function formatLint(issues: LintIssue[]): string {
  if (issues.length === 0) {
    return "Loom lint: OK (no issues).";
  }
  const lines = [`Loom lint: ${issues.length} issue(s)`];
  for (const issue of issues) {
    lines.push(`  [${issue.severity}] ${issue.code}: ${issue.detail}`);
  }
  return lines.join("\n");
}

export function hasErrors(issues: LintIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}
