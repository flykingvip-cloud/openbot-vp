// Retirement protocol: archive-then-delete, planned before anything is destroyed.
//
// The rule (I3): a ref may only be deleted when it is either provably contained in the
// baseline, or archived as an immutable tag. Containment IS the archive — a contained ref
// adds no history, so deleting it loses nothing. A diverged ref needs a real archive tag
// first.
//
// Why a planner rather than a script that just deletes: on 2026-07-27 a containment check
// built with `git log --all` matched stashes against each other, because `--all` includes
// `refs/stash`. Acting on that result would have destroyed 20 unique snapshots. The lesson is
// that the judgement, not the deletion, is the risky part — so the judgement is a pure
// function with tests, and deletion only ever consumes a reviewed plan.

import { isForwardOnly, type GitRunner } from "./forward-guard.ts";

export type RefKind = "local-branch" | "remote-branch";

export type RefCandidate = {
  name: string;
  kind: RefKind;
  /** Fully-qualified ref used for ancestry queries, e.g. `origin/foo` for a remote branch. */
  rev: string;
};

export type RetireContext = {
  /** The elected baseline. Containment is measured against this. */
  baseline: string;
  /** Branch names checked out in a worktree. Deleting these breaks another agent's checkout. */
  worktreeHeld: Set<string>;
  /** Branch names referenced by an open PR as head or base. */
  prReferenced: Set<string>;
  /** Never retire these regardless of containment (trunk, active SoT). */
  protectedNames: Set<string>;
};

export type RetireVerdict =
  /** Contained in the baseline and unblocked: delete, no archive needed. */
  | { action: "delete"; reason: string }
  /** Diverged: archive as a tag first, then delete. */
  | { action: "archive-then-delete"; reason: string; archiveTag: string }
  /** Blocked by a guard. Left alone. */
  | { action: "hold"; reason: string };

export type RetirePlanEntry = RefCandidate & { verdict: RetireVerdict };

/** `archive/<sanitised-name>-<YYYYMMDD>`; slashes become dashes so the tag stays one path segment. */
export function archiveTagName(refName: string, isoDate: string): string {
  const stamp = isoDate.slice(0, 10).replaceAll("-", "");
  const safe = refName.replaceAll("/", "-").replaceAll(/[^A-Za-z0-9._-]/g, "-");
  return `archive/${safe}-${stamp}`;
}

/**
 * Decides what to do with one ref. Pure: all repository facts arrive via `git` and `context`.
 *
 * Guard order matters. Protection and worktree/PR holds are checked BEFORE containment,
 * because "already in the baseline" is not a licence to yank a ref another agent has checked
 * out or a reviewer is looking at.
 */
export function planRef(
  candidate: RefCandidate,
  context: RetireContext,
  git: GitRunner,
  isoDate: string,
): RetirePlanEntry {
  const { name } = candidate;

  if (context.protectedNames.has(name)) {
    return { ...candidate, verdict: { action: "hold", reason: "protected ref" } };
  }
  if (candidate.kind === "local-branch" && context.worktreeHeld.has(name)) {
    return {
      ...candidate,
      verdict: { action: "hold", reason: "checked out in a worktree" },
    };
  }
  if (context.prReferenced.has(name)) {
    return {
      ...candidate,
      verdict: { action: "hold", reason: "head or base of an open pull request" },
    };
  }

  const contained = isForwardOnly(candidate.rev, context.baseline, git);
  if (contained) {
    return {
      ...candidate,
      verdict: {
        action: "delete",
        reason: `contained in ${context.baseline}; containment is the archive`,
      },
    };
  }
  return {
    ...candidate,
    verdict: {
      action: "archive-then-delete",
      reason: `carries commits absent from ${context.baseline}`,
      archiveTag: archiveTagName(name, isoDate),
    },
  };
}

export type RetirePlan = {
  entries: RetirePlanEntry[];
  counts: { delete: number; archiveThenDelete: number; hold: number };
};

export function buildRetirePlan(
  candidates: RefCandidate[],
  context: RetireContext,
  git: GitRunner,
  isoDate: string,
): RetirePlan {
  const entries = candidates.map((candidate) => planRef(candidate, context, git, isoDate));
  return {
    entries,
    counts: {
      delete: entries.filter((e) => e.verdict.action === "delete").length,
      archiveThenDelete: entries.filter((e) => e.verdict.action === "archive-then-delete").length,
      hold: entries.filter((e) => e.verdict.action === "hold").length,
    },
  };
}

/**
 * Renders the plan as the retirement ledger row set. Emitted before deletion so the record
 * exists even if the deletion step is interrupted.
 */
export function renderRetirementLedger(plan: RetirePlan, isoDate: string): string {
  const lines = [
    `# Retirement plan — ${isoDate.slice(0, 10)}`,
    "",
    `delete ${plan.counts.delete} · archive-then-delete ${plan.counts.archiveThenDelete} · hold ${plan.counts.hold}`,
    "",
    "| ref | kind | action | archive tag | reason |",
    "|---|---|---|---|---|",
  ];
  for (const entry of plan.entries) {
    const tag = entry.verdict.action === "archive-then-delete" ? entry.verdict.archiveTag : "";
    lines.push(
      `| ${entry.name} | ${entry.kind} | ${entry.verdict.action} | ${tag} | ${entry.verdict.reason} |`,
    );
  }
  return lines.join("\n") + "\n";
}
