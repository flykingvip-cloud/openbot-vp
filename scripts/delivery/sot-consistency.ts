// SoT (source-of-truth) consistency gate for the production LIVE row.
//
// This replaces the previous check-sot semantics, which asked whether the FROZEN
// `release/baseline-recovery-20260725` branch contained LIVE. That branch is frozen by
// policy (AGENTS.md: never branch from it, target PRs at it, or cut over from it — it is
// kept only so history stays intact). Because it can never be advanced to contain new
// cutovers, `is-ancestor(LIVE, baseline-recovery)` was permanently false and the gate was a
// permanent FALSE failure that could only be "fixed" by violating the freeze.
//
// The real invariant (AGENTS.md I2 "anchoring") is that production LIVE is anchored to the
// sole trunk through immutable artifacts: the single open `deploy/production/releases.jsonl` row
// (Path B machine SoT in this repo; see deploy/production/LEDGER.md), its
// annotated `provenance/sha-*` tag, `RELEASE_RECORD.md`, and the running artifact must all
// name the SAME commit, and that commit must be contained in `origin/main`. Immutable
// provenance tags — not an advanceable branch — are the anchor, so a lagging frozen branch
// can never be the reason this gate fails.

/** Everything the gate needs, pre-resolved so the decision is a pure function. */
export type SotConsistencyInput = {
  /**
   * LIVE commit resolved from the running artifact (build-info.commit) or from
   * `--live-sha` / `--use-release-record-live` (full 40-hex; case-insensitive), or null when
   * LIVE could not be resolved.
   */
  liveSha: string | null;
  /** Latest cutover SHA parsed from RELEASE_RECORD.md, or null when absent/unreadable. */
  releaseRecordSha: string | null;
  /** `gatewaySha` of every releases.jsonl row that omits `liveTo` (the open LIVE interval). */
  ledgerOpenShas: string[];
  /**
   * Resolve `provenance/sha-<12>` to a full commit SHA, or null when the tag is missing.
   * The 12-char prefix is the ledger/tag convention (e.g. `provenance/sha-59be50660d8e`).
   */
  resolveProvenanceTag: (sha: string) => string | null;
  /** True when `sha` is contained in the trunk (origin/main). */
  trunkContainsLive: (sha: string) => boolean;
};

export type SotConsistencyVerdict = "allow" | "block" | "unknown";

export type SotConsistencyDecision = {
  verdict: SotConsistencyVerdict;
  live: string | null;
  ledgerLive: string | null;
  reasons: string[];
  recommendation: string | null;
};

const RECOMMENDATION =
  "Reconcile the open releases.jsonl row, its provenance/sha-* tag, RELEASE_RECORD, and " +
  "origin/main so they all name the running LIVE SHA (merge the cutover to the trunk; never " +
  "advance the frozen release/baseline-recovery branch).";

function normalize(sha: string | null | undefined): string | null {
  if (!sha) {
    return null;
  }
  const trimmed = sha.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function short(sha: string): string {
  return sha.slice(0, 12);
}

function block(
  live: string | null,
  ledgerLive: string | null,
  reasons: string[],
): SotConsistencyDecision {
  return { verdict: "block", live, ledgerLive, reasons, recommendation: RECOMMENDATION };
}

/**
 * Decide whether production LIVE is anchored and consistent. Never consults the frozen
 * baseline-recovery branch, so its lag is not a failure mode.
 *
 * - `unknown` (exit 21): LIVE could not be resolved — fail closed.
 * - `block`   (exit 20): a real inconsistency (no/ambiguous open row, LIVE != ledger,
 *              RELEASE_RECORD != ledger, missing/mismatched provenance tag, or LIVE not on trunk).
 * - `allow`   (exit 0):  ledger row, provenance tag, RELEASE_RECORD, and trunk all agree.
 */
export function evaluateSotConsistency(input: SotConsistencyInput): SotConsistencyDecision {
  const live = normalize(input.liveSha);
  if (!live) {
    return {
      verdict: "unknown",
      live: null,
      ledgerLive: null,
      reasons: ["LIVE is unknown; SoT verification fails closed"],
      recommendation:
        "Resolve LIVE from the running artifact (build-info.commit) or pass --live-sha / --use-release-record-live.",
    };
  }

  const openShas = input.ledgerOpenShas
    .map((sha) => normalize(sha))
    .filter((sha): sha is string => sha !== null);

  if (openShas.length === 0) {
    return block(live, null, [
      "releases.jsonl has no open LIVE row (every row carries liveTo); the current LIVE is unrecorded",
    ]);
  }
  if (openShas.length > 1) {
    return block(live, null, [
      `releases.jsonl has ${openShas.length} open LIVE rows (${openShas
        .map(short)
        .join(", ")}); exactly one open interval is allowed`,
    ]);
  }

  const ledgerLive = openShas[0];
  const reasons: string[] = [];

  if (live !== ledgerLive) {
    reasons.push(
      `running/injected LIVE ${short(live)} != ledger open row ${short(ledgerLive)} (LIVE/ledger drift or tampered ledger)`,
    );
  }

  const recordSha = normalize(input.releaseRecordSha);
  if (recordSha && recordSha !== ledgerLive) {
    reasons.push(
      `RELEASE_RECORD latest cutover ${short(recordSha)} != ledger open row ${short(ledgerLive)}`,
    );
  }

  const tagSha = normalize(input.resolveProvenanceTag(ledgerLive));
  if (!tagSha) {
    reasons.push(
      `missing provenance tag provenance/sha-${short(ledgerLive)} for the open LIVE row`,
    );
  } else if (tagSha !== ledgerLive) {
    reasons.push(
      `provenance tag provenance/sha-${short(ledgerLive)} resolves to ${short(tagSha)} (expected ${short(ledgerLive)})`,
    );
  }

  if (!input.trunkContainsLive(ledgerLive)) {
    reasons.push(
      `LIVE ${short(ledgerLive)} is not contained in origin/main; production is running off-trunk code`,
    );
  }

  if (reasons.length > 0) {
    return block(live, ledgerLive, reasons);
  }

  return {
    verdict: "allow",
    live,
    ledgerLive,
    reasons: [
      "LIVE row, provenance tag, RELEASE_RECORD, and origin/main all name the same running LIVE SHA",
    ],
    recommendation: null,
  };
}
