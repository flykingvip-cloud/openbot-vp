export type GitResult = {
  code: number;
  stdout: string;
  stderr?: string;
};

export type GitRunner = (args: string[]) => GitResult;

export type RegressionReport = {
  deleted: string[];
  reverted: string[];
};

export type GuardDecision = {
  verdict: "allow" | "block";
  forwardOnly: boolean;
  liveKnown: boolean;
  regressions: RegressionReport;
  reasons: string[];
  intentionalRevert?: { approved: true; reason: string };
};

export function isForwardOnly(live: string, candidate: string, git: GitRunner): boolean {
  return git(["merge-base", "--is-ancestor", live, candidate]).code === 0;
}

/** True when `git cat-file -t <sha>` succeeds (object present in the current object store). */
export function objectExists(sha: string, git: GitRunner): boolean {
  return git(["cat-file", "-t", sha]).code === 0;
}

/** True when `git rev-parse --is-shallow-repository` reports true. */
export function isShallowRepository(git: GitRunner): boolean {
  const result = git(["rev-parse", "--is-shallow-repository"]);
  return result.code === 0 && result.stdout.trim() === "true";
}

/**
 * Immediate parents of `sha` that are declared by the commit but missing as objects.
 * Empty array means parents are present (or the commit is a root). Null means the tip
 * itself could not be listed (treat as incomplete).
 */
export function missingImmediateParents(sha: string, git: GitRunner): string[] | null {
  const listed = git(["rev-list", "--parents", "-n", "1", sha]);
  if (listed.code !== 0) {
    return null;
  }
  const parts = listed.stdout.trim().split(/\s+/).filter(Boolean);
  // parts[0] is the tip; the rest are parents
  const parents = parts.slice(1);
  return parents.filter((parent) => !objectExists(parent, git));
}

export type AncestryClass =
  | { kind: "forward" }
  | { kind: "missing-object"; missing: string[] }
  | { kind: "incomplete-graph"; reason: string }
  | { kind: "regression" };

/**
 * Classify whether `prior` is still contained in `current` under the *current* object graph.
 * Missing tips and shallow/parent truncation must not be labeled as proven regression.
 */
export function classifyAncestry(prior: string, current: string, git: GitRunner): AncestryClass {
  const missing: string[] = [];
  if (!objectExists(prior, git)) {
    missing.push(prior);
  }
  if (!objectExists(current, git)) {
    missing.push(current);
  }
  if (missing.length > 0) {
    return { kind: "missing-object", missing };
  }

  const ancestorProbe = git(["merge-base", "--is-ancestor", prior, current]);
  if (ancestorProbe.code === 0) {
    return { kind: "forward" };
  }
  // Git uses 128 for fatal (e.g. mid-object issues); never call that a proven regression.
  if (ancestorProbe.code !== 0 && ancestorProbe.code !== 1) {
    return {
      kind: "incomplete-graph",
      reason: `merge-base --is-ancestor exited ${ancestorProbe.code} under the current object graph`,
    };
  }

  const priorParents = missingImmediateParents(prior, git);
  const currentParents = missingImmediateParents(current, git);
  if (priorParents === null || currentParents === null) {
    return {
      kind: "incomplete-graph",
      reason: "could not list immediate parents under the current object graph",
    };
  }
  if (priorParents.length > 0 || currentParents.length > 0) {
    const samples = [...priorParents, ...currentParents].slice(0, 3).map((s) => s.slice(0, 12));
    return {
      kind: "incomplete-graph",
      reason: `immediate parent object(s) missing (${samples.join(", ")}) under the current object graph`,
    };
  }

  const shallow = isShallowRepository(git);
  if (shallow) {
    const mergeBase = git(["merge-base", prior, current]);
    if (mergeBase.code !== 0) {
      return {
        kind: "incomplete-graph",
        reason:
          "shallow repository and empty/failed merge-base; truncation not ruled out under the current object graph",
      };
    }
  }

  return { kind: "regression" };
}

function uniqueSortedPaths(output: string): string[] {
  return [
    ...new Set(
      output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ].toSorted();
}

export function detectRegressedPaths(
  live: string,
  candidate: string,
  options: { protectedGlobs: string[]; git: GitRunner },
): RegressionReport {
  const pathspecs = options.protectedGlobs.map((glob) => `:(glob)${glob}`);
  const result = options.git([
    "diff",
    "--name-only",
    "--diff-filter=D",
    live,
    candidate,
    "--",
    ...pathspecs,
  ]);

  return {
    deleted: result.code === 0 ? uniqueSortedPaths(result.stdout) : [],
    reverted: [],
  };
}

export function decideDelivery(input: {
  live: string | null;
  candidate: string;
  protectedGlobs: string[];
  git: GitRunner;
  allowUnknownLive?: boolean;
  intentionalRevert?: string;
}): GuardDecision {
  const intentionalReason = input.intentionalRevert?.trim();
  if (input.live === null) {
    const allowed = input.allowUnknownLive === true || Boolean(intentionalReason);
    return {
      verdict: allowed ? "allow" : "block",
      forwardOnly: false,
      liveKnown: false,
      regressions: { deleted: [], reverted: [] },
      reasons: allowed
        ? [
            input.allowUnknownLive
              ? "LIVE is unknown and explicitly allowed"
              : "intentional revert approved",
          ]
        : ["LIVE is unknown; delivery verification fails closed"],
      ...(intentionalReason
        ? { intentionalRevert: { approved: true as const, reason: intentionalReason } }
        : {}),
    };
  }

  const forwardOnly = isForwardOnly(input.live, input.candidate, input.git);
  const regressions = forwardOnly
    ? { deleted: [], reverted: [] }
    : detectRegressedPaths(input.live, input.candidate, {
        protectedGlobs: input.protectedGlobs,
        git: input.git,
      });
  const allowed = forwardOnly || Boolean(intentionalReason);
  const reasons = forwardOnly
    ? ["candidate contains LIVE history"]
    : [
        "candidate does not contain LIVE history (behind or diverged)",
        ...(regressions.deleted.length > 0
          ? [`candidate deletes protected paths: ${regressions.deleted.join(", ")}`]
          : []),
      ];

  if (intentionalReason) {
    reasons.push("intentional revert approved");
  }

  return {
    verdict: allowed ? "allow" : "block",
    forwardOnly,
    liveKnown: true,
    regressions,
    reasons,
    ...(intentionalReason
      ? { intentionalRevert: { approved: true as const, reason: intentionalReason } }
      : {}),
  };
}
