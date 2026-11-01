// Machine-readable production release ledger parser.
//
// The live append-only file is deploy/production/releases.jsonl in this repository
// (Path B machine SoT). This module parses that text; append via pnpm delivery:cutover:record.
//
// Why this exists: `deploy/production/RELEASE_RECORD.md` lives inside the branch it
// describes, so it forks per lineage. On 2026-07-27 two divergent copies existed that
// differed by 1123 insertions / 219 deletions, and an agent reading the stale copy
// concluded the wrong commit was live. Merge-back of the running commit also failed
// with a conflict on that same file.
//
// Design: release identity lives in annotated `provenance/sha-*` tags, which are global
// refs and cannot fork by branching. This ledger is an append-only index over those
// anchors. If the ledger ever forks, it is reconstructible from the tags plus the
// running container; the tags are the source of truth, not this file.
//
// Schema: rows without `schemaVersion` (or with `schemaVersion: 1`) are v1 and keep
// their original fields. `schemaVersion: 2` rows identify the running artifact by
// `artifactDigest` + recorded build-info SHAs, not by parsing `imageTag`.

import { classifyAncestry, type GitRunner } from "./forward-guard.ts";

export const ARTIFACT_KINDS = ["image", "dist-overlay"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

/** One production cutover. `uiSha` differs from `gatewaySha` only for scoped-UI overlays. */
export type ReleaseRow = {
  /** Absent or 1 = historical v1 row; 2 = v2 artifact identity. */
  schemaVersion?: 1 | 2;
  /** Monotonic sequence number. Gaps are allowed (pre-ledger history), repeats are not. */
  seq: number;
  /** Commit whose build produced the gateway dist. This is what `build-info.commit` reports. */
  gatewaySha: string;
  /** Commit whose build produced the Control UI dist. Equal to `gatewaySha` for full-dist. */
  uiSha: string;
  /**
   * Image tag as it exists on the host, e.g. `rc-amd64-provenance-87d46f34ac-user-guidance`.
   * Required on v1. Optional on v2 (v2 identity is `artifactId` / `artifactDigest`).
   */
  imageTag?: string;
  /** Annotated tag anchoring the release, e.g. `provenance/sha-87d46f34ac17`. Required on v2. */
  tag?: string;
  imageDigest?: string;
  liveFrom: string;
  /** Omit only on the single current LIVE row. */
  liveTo?: string;
  executor?: string;
  /** How the observation was made, e.g. "container build-info". Absent means asserted, not observed. */
  evidence?: string;
  /**
   * Reason a known regression on this row is accepted as history. The ledger must stay
   * truthful about what shipped, so a recorded regression cannot simply be edited away, but
   * it also must not pin CI red forever. Mirrors the guard's `--intentional-revert` escape
   * hatch: explicit, reasoned, and downgraded to a warning rather than silenced.
   */
  regressionAcknowledged?: string;
  notes?: string;
  /**
   * true = the writer observed the running container (verify-live PASS).
   * false = explicit unverified backfill (reason lives in notes).
   * Absent on historical rows (seq 45 and older) is not an audit ERROR.
   */
  liveVerified?: boolean;
  /** v2: how the artifact was produced (full-dist, gateway-dist-keep-ui, …). */
  buildMode?: string;
  /** v2: image recreate vs dist overlay on an unchanged base image. */
  artifactKind?: ArtifactKind;
  /** v2: image tag or overlay id. Not parsed for a commit prefix. */
  artifactId?: string;
  /** v2: sha256 digest of the running artifact. */
  artifactDigest?: string;
  /** v2 dist-overlay only: unchanged base image tag. */
  baseImageTag?: string;
  /** v2 dist-overlay only: unchanged base image digest. */
  baseImageDigest?: string;
};

export type LedgerParseResult = {
  rows: ReleaseRow[];
  errors: { line: number; message: string }[];
};

export function isV2Row(row: ReleaseRow): boolean {
  return row.schemaVersion === 2;
}

export function isSha256Digest(value: string | undefined): boolean {
  return typeof value === "string" && SHA256_DIGEST_RE.test(value);
}

function schemaVersionOf(value: unknown): 1 | 2 | null {
  if (value === undefined) {
    return 1;
  }
  if (value === 1) {
    return 1;
  }
  if (value === 2) {
    return 2;
  }
  return null;
}

function missingKeys(row: Partial<ReleaseRow>, keys: readonly (keyof ReleaseRow)[]): string[] {
  return keys.filter((key) => {
    const value = row[key];
    return value === undefined || value === "";
  });
}

function parseV1Row(row: Partial<ReleaseRow>): { row?: ReleaseRow; error?: string } {
  const missing = missingKeys(row, ["seq", "gatewaySha", "uiSha", "imageTag", "liveFrom"]);
  if (missing.length > 0) {
    return { error: `missing required fields: ${missing.join(", ")}` };
  }
  return { row: row as ReleaseRow };
}

function parseV2Row(row: Partial<ReleaseRow>): { row?: ReleaseRow; error?: string } {
  const missing = missingKeys(row, [
    "seq",
    "gatewaySha",
    "uiSha",
    "buildMode",
    "artifactKind",
    "artifactId",
    "artifactDigest",
    "tag",
    "liveFrom",
    "evidence",
    "executor",
  ]);
  if (missing.length > 0) {
    return { error: `missing required v2 fields: ${missing.join(", ")}` };
  }
  if (row.artifactKind !== "image" && row.artifactKind !== "dist-overlay") {
    return { error: `artifactKind must be image or dist-overlay` };
  }
  if (!isSha256Digest(row.artifactDigest)) {
    return { error: `artifactDigest must be sha256:<64-hex>` };
  }
  if (row.artifactKind === "dist-overlay") {
    const overlayMissing = missingKeys(row, ["baseImageTag", "baseImageDigest"]);
    if (overlayMissing.length > 0) {
      return { error: `dist-overlay missing ${overlayMissing.join(", ")}` };
    }
    if (!isSha256Digest(row.baseImageDigest)) {
      return { error: `baseImageDigest must be sha256:<64-hex>` };
    }
  }
  return { row: { ...row, schemaVersion: 2 } as ReleaseRow };
}

/** Parses JSONL, reporting per-line failures instead of throwing on the first bad row. */
export function parseLedger(text: string): LedgerParseResult {
  const rows: ReleaseRow[] = [];
  const errors: { line: number; message: string }[] = [];
  const lines = text.split("\n");
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("//")) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      errors.push({ line: index + 1, message: `invalid JSON: ${(error as Error).message}` });
      continue;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      errors.push({ line: index + 1, message: "row must be a JSON object" });
      continue;
    }
    const row = parsed as Partial<ReleaseRow>;
    const version = schemaVersionOf(row.schemaVersion);
    if (version === null) {
      errors.push({ line: index + 1, message: "schemaVersion must be 1 or 2" });
      continue;
    }
    const result = version === 2 ? parseV2Row(row) : parseV1Row(row);
    if (result.error) {
      errors.push({ line: index + 1, message: result.error });
      continue;
    }
    if (result.row) {
      rows.push(result.row);
    }
  }
  return { rows, errors };
}

/** True when the UI and gateway halves came from different commits. */
export function isOverlay(row: ReleaseRow): boolean {
  return row.gatewaySha !== row.uiSha;
}

/**
 * The set of commits a release put in front of users. An overlay ships two, and the next
 * release must contain BOTH — checking only the gateway half is what let the 2026-07-27
 * overlay silently drop the commit that was live 30 minutes earlier.
 */
export function shippedShas(row: ReleaseRow): string[] {
  return isOverlay(row) ? [row.gatewaySha, row.uiSha] : [row.gatewaySha];
}

export type LedgerFinding = {
  severity: "error" | "warning";
  seq: number;
  code:
    | "duplicate-seq"
    | "out-of-order"
    | "regression"
    | "missing-object"
    | "incomplete-graph"
    | "overlay-debt"
    | "identity-mismatch"
    | "missing-tag"
    | "unobserved"
    | "timeline-gap"
    | "open-interval"
    | "unverified-live";
  message: string;
};

export type LedgerAudit = {
  ok: boolean;
  findings: LedgerFinding[];
};

/**
 * Extracts the commit prefix an image tag claims, e.g.
 * `rc-amd64-provenance-87d46f34ac-user-guidance` -> `87d46f34ac`.
 * Returns null when the tag carries no provenance sha (pre-provenance `v<N>` era).
 * v1 identity only — v2 rows must not use this.
 */
export function shaFromImageTag(imageTag: string): string | null {
  const match = /provenance-([0-9a-f]{10,40})/.exec(imageTag);
  return match?.[1] ?? null;
}

/** Rough human duration for timeline-gap messages; precision beyond minutes is noise. */
function formatGap(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 120) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) {
    return `${minutes}m`;
  }
  return `${(minutes / 60).toFixed(1)}h`;
}

/**
 * The LIVE timeline must have no holes: every instant between one row's `liveFrom` and
 * the next row's `liveFrom` must be claimed by exactly one row. A hole is the signature
 * of an unledgered artifact running in production (the 2026-08-23 `47d6934c34` window,
 * recorded only in seq 40/41 notes). Warnings, not errors: history stays green, but the
 * debt is visible on every audit.
 */
function auditTimeline(ordered: ReleaseRow[], findings: LedgerFinding[]): void {
  for (const [index, row] of ordered.entries()) {
    const previous = ordered[index - 1];
    if (previous === undefined) {
      continue;
    }
    if (previous.liveTo === undefined) {
      findings.push({
        severity: "warning",
        seq: previous.seq,
        code: "timeline-gap",
        message: `no liveTo but release ${row.seq} follows; close the span at cutover time`,
      });
      continue;
    }
    const prevTo = Date.parse(previous.liveTo);
    const nextFrom = Date.parse(row.liveFrom);
    if (Number.isNaN(prevTo) || Number.isNaN(nextFrom)) {
      findings.push({
        severity: "warning",
        seq: row.seq,
        code: "timeline-gap",
        message: `unparseable liveTo/liveFrom between releases ${previous.seq} and ${row.seq}`,
      });
      continue;
    }
    if (nextFrom > prevTo) {
      findings.push({
        severity: "warning",
        seq: row.seq,
        code: "timeline-gap",
        message: `LIVE timeline hole of ${formatGap(nextFrom - prevTo)} between releases ${previous.seq} and ${row.seq}; no row claims that window`,
      });
    } else if (nextFrom < prevTo) {
      findings.push({
        severity: "warning",
        seq: row.seq,
        code: "timeline-gap",
        message: `LIVE spans overlap by ${formatGap(prevTo - nextFrom)} between releases ${previous.seq} and ${row.seq}`,
      });
    }
  }
}

/**
 * At most one row may omit `liveTo` (the current LIVE interval). Dual-open is how
 * two artifacts both claimed to be production.
 */
function auditOpenIntervals(rows: ReleaseRow[], findings: LedgerFinding[]): void {
  const open = rows.filter((row) => row.liveTo === undefined);
  if (open.length <= 1) {
    return;
  }
  findings.push({
    severity: "error",
    seq: open[1]?.seq ?? -1,
    code: "open-interval",
    message: `${open.length} rows omit liveTo (seq ${open.map((row) => row.seq).join(", ")}); at most one open interval (the current LIVE row) is allowed`,
  });
}

/**
 * Warn (never error) when the single open LIVE v2 row is not independently
 * container-verified. Historical rows that omit `liveVerified` stay audit-clean.
 */
function auditLiveVerified(rows: ReleaseRow[], findings: LedgerFinding[]): void {
  const open = rows.filter((row) => row.liveTo === undefined);
  if (open.length !== 1) {
    return;
  }
  const live = open[0];
  if (live === undefined || !isV2Row(live) || live.liveVerified === true) {
    return;
  }
  findings.push({
    severity: "warning",
    seq: live.seq,
    code: "unverified-live",
    message:
      live.liveVerified === false
        ? "current LIVE v2 row is an unverified backfill (liveVerified=false); writer did not observe the running container"
        : "current LIVE v2 row has no liveVerified=true; writer did not observe the running container",
  });
}

/**
 * v1: identity is the provenance prefix embedded in `imageTag`.
 * v2: identity is `artifactDigest` plus the build-info SHAs already on the row.
 *     Never parse `imageTag` — overlays keep the base image name there.
 */
function auditIdentity(row: ReleaseRow, findings: LedgerFinding[]): void {
  if (isV2Row(row)) {
    if (!isSha256Digest(row.artifactDigest)) {
      findings.push({
        severity: "error",
        seq: row.seq,
        code: "identity-mismatch",
        message: `v2 identity requires artifactDigest sha256:<64-hex> (not shaFromImageTag)`,
      });
    }
    return;
  }
  const claimed = shaFromImageTag(row.imageTag ?? "");
  if (claimed !== null && !row.uiSha.startsWith(claimed) && !row.gatewaySha.startsWith(claimed)) {
    findings.push({
      severity: "error",
      seq: row.seq,
      code: "identity-mismatch",
      message: `image tag claims ${claimed} but the row ships ${shippedShas(row).join(" + ")}`,
    });
  }
}

/** Rank non-forward ancestry classes: unknowns before proven regression. */
function preferNonForwardAncestry(
  current: ReturnType<typeof classifyAncestry> | null,
  next: ReturnType<typeof classifyAncestry>,
): ReturnType<typeof classifyAncestry> {
  if (current === null || current.kind === "forward") {
    return next;
  }
  const rank = (kind: string): number => {
    switch (kind) {
      case "missing-object":
        return 0;
      case "incomplete-graph":
        return 1;
      case "regression":
        return 2;
      default:
        return 3;
    }
  };
  return rank(next.kind) < rank(current.kind) ? next : current;
}

/**
 * Audits the ledger. `git` is injected so this is testable without a real repo, and so the
 * ancestry rule reuses `classifyAncestry` (object-complete then forward-only) rather than reimplementing it.
 */
export function auditLedger(rows: ReleaseRow[], git: GitRunner): LedgerAudit {
  const findings: LedgerFinding[] = [];
  const seen = new Set<number>();
  const ordered = [...rows].toSorted((a, b) => a.seq - b.seq);

  for (const row of rows) {
    if (seen.has(row.seq)) {
      findings.push({
        severity: "error",
        seq: row.seq,
        code: "duplicate-seq",
        message: `seq ${row.seq} appears more than once`,
      });
    }
    seen.add(row.seq);
  }

  if (rows.some((row, index) => index > 0 && row.seq <= (rows[index - 1]?.seq ?? -1))) {
    findings.push({
      severity: "warning",
      seq: -1,
      code: "out-of-order",
      message: "rows are not stored in ascending seq order; append-only writes keep them sorted",
    });
  }

  auditOpenIntervals(rows, findings);
  auditLiveVerified(rows, findings);
  auditTimeline(ordered, findings);

  for (const [index, row] of ordered.entries()) {
    auditIdentity(row, findings);

    if (isOverlay(row)) {
      findings.push({
        severity: "warning",
        seq: row.seq,
        code: "overlay-debt",
        message: `scoped-UI overlay: gateway ${row.gatewaySha.slice(0, 12)} + UI ${row.uiSha.slice(0, 12)}; owes a full-dist rebase`,
      });
    }

    if (row.tag === undefined) {
      findings.push({
        severity: "warning",
        seq: row.seq,
        code: "missing-tag",
        message: "no provenance tag anchors this release, so its identity is not immutable",
      });
    }

    if (row.evidence === undefined) {
      findings.push({
        severity: "warning",
        seq: row.seq,
        code: "unobserved",
        message: "no evidence field: the row is asserted, not observed from a running artifact",
      });
    }

    const previous = ordered[index - 1];
    if (previous === undefined) {
      continue;
    }
    for (const priorSha of shippedShas(previous)) {
      // Prefer any current tip that still contains prior (forward). Otherwise aggregate
      // gateway/UI candidates: unknown (missing-object / incomplete-graph) outranks
      // regression so a later unknown cannot be discarded after an early regression.
      const currentShas = shippedShas(row);
      let classified: ReturnType<typeof classifyAncestry> | null = null;
      for (const sha of currentShas) {
        const result = classifyAncestry(priorSha, sha, git);
        if (result.kind === "forward") {
          classified = result;
          break;
        }
        classified = preferNonForwardAncestry(classified, result);
      }
      if (classified === null || classified.kind === "forward") {
        continue;
      }

      if (classified.kind === "missing-object") {
        const tips = classified.missing.map((s) => s.slice(0, 12)).join(", ");
        findings.push({
          severity: "error",
          seq: row.seq,
          code: "missing-object",
          message: `cannot adjudicate whether ${priorSha.slice(0, 12)} (release ${previous.seq}) is still live: missing object(s) ${tips} under the current object graph`,
        });
        continue;
      }

      if (classified.kind === "incomplete-graph") {
        findings.push({
          severity: "error",
          seq: row.seq,
          code: "incomplete-graph",
          message: `cannot prove ancestry for ${priorSha.slice(0, 12)} from release ${previous.seq}: ${classified.reason}`,
        });
        continue;
      }

      const acknowledged = row.regressionAcknowledged?.trim();
      findings.push({
        severity: acknowledged ? "warning" : "error",
        seq: row.seq,
        code: "regression",
        message: acknowledged
          ? `drops ${priorSha.slice(0, 12)} which release ${previous.seq} had live (acknowledged: ${acknowledged})`
          : `drops ${priorSha.slice(0, 12)} which release ${previous.seq} had live`,
      });
    }
  }

  return { ok: !findings.some((finding) => finding.severity === "error"), findings };
}

/** Close `liveTo` on one existing object. Used by the atomic writer so a v1 row stays v1. */
export function closeLiveInterval(row: ReleaseRow, liveTo: string): ReleaseRow {
  return { ...row, liveTo };
}
