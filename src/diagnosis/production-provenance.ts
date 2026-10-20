/**
 * Provenance identity for diagnosis admission.
 * Compare the annotated tag's peeled commit with LIVE.
 * Never compare the annotated tag-object SHA with LIVE.
 * This module does not mint tags.
 */

const SHA40 = /^[0-9a-f]{40}$/i;

export type DiagnosisProvenanceTagResolution = {
  tagName: string | null;
  tagObjectSha: string | null;
  peeledCommitSha: string | null;
};

export type DiagnosisProvenanceGit = {
  git: (args: readonly string[]) => string;
  gitOk: (args: readonly string[]) => boolean;
};

function normalizeSha(sha: string | null | undefined): string | null {
  if (!sha) {
    return null;
  }
  const trimmed = sha.trim().toLowerCase();
  return SHA40.test(trimmed) ? trimmed : null;
}

export function provenanceTagNameForSha(liveOrLedgerSha: string | null): string | null {
  const sha = normalizeSha(liveOrLedgerSha);
  return sha ? `provenance/sha-${sha.slice(0, 12)}` : null;
}

/**
 * Resolve `provenance/sha-<12>` and peel `^{commit}`.
 * `peeledCommitSha` is the only SHA that may be compared with LIVE.
 */
export function resolvePeeledProvenanceTag(
  liveOrLedgerSha: string | null,
  runner: DiagnosisProvenanceGit,
): DiagnosisProvenanceTagResolution {
  const tagName = provenanceTagNameForSha(liveOrLedgerSha);
  if (!tagName) {
    return { tagName: null, tagObjectSha: null, peeledCommitSha: null };
  }
  for (const ref of [`refs/tags/${tagName}`, tagName]) {
    if (!runner.gitOk(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])) {
      continue;
    }
    const peeledCommitSha = normalizeSha(runner.git(["rev-parse", "--verify", `${ref}^{commit}`]));
    const tagObjectSha = runner.gitOk(["rev-parse", "--verify", "--quiet", ref])
      ? normalizeSha(runner.git(["rev-parse", "--verify", ref]))
      : null;
    return {
      tagName,
      tagObjectSha,
      peeledCommitSha,
    };
  }
  return { tagName, tagObjectSha: null, peeledCommitSha: null };
}

export function provenanceShaForLiveCompare(
  resolution: DiagnosisProvenanceTagResolution,
): string | null {
  return resolution.peeledCommitSha;
}

export function provenancePeeledTargetMatchesLive(input: {
  liveSha: string | null;
  peeledCommitSha: string | null;
}): boolean {
  const liveSha = normalizeSha(input.liveSha);
  const peeledCommitSha = normalizeSha(input.peeledCommitSha);
  return Boolean(liveSha && peeledCommitSha && liveSha === peeledCommitSha);
}
