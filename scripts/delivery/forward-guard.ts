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
