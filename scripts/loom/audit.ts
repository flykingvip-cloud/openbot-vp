/**
 * audit.ts — landing audit core, reading rules from the Registry.
 *
 * Replaces the hardcoded `AuditRule[]` in `scripts/worktree-audit.ts` with rules
 * DERIVED from the Registry (each task → one landing stream). Classification is
 * "first match wins" in task order, identical to the legacy `classify()`.
 *
 * Landing decisions use ONLY `task.paths` (HARD signal); `task.intent` is never
 * consulted (Requirement 4.5 / 9.2, Architecture Rule #1). Risky-mix detection
 * (findRiskyMix) and output modes land in tasks 3.2/3.3.
 */

import { globToRegExp, type StatusEntry, statusKind, type StatusKind } from "./glob.js";
import type { LandingPolicy, LandingStream, Registry } from "./registry.js";

export type DerivedRule = {
  streamId: string;
  landingPolicy: LandingPolicy;
  /** Other stream ids this stream may land alongside (bidirectional intersection). */
  canLandWith: string[];
  regexps: RegExp[];
};

export type ClassifiedEntry = StatusEntry & {
  kind: StatusKind;
  /** The first landing stream whose paths match, or null when unmatched. */
  rule: DerivedRule | null;
};

/** Derive one landing rule per landing stream from the Registry. */
export function deriveRules(registry: Registry): DerivedRule[] {
  return registry.landingStreams.map((stream: LandingStream) => ({
    streamId: stream.id,
    landingPolicy: stream.landingPolicy,
    canLandWith: stream.canLandWith,
    regexps: stream.paths.map(globToRegExp),
  }));
}

function firstMatch(rules: DerivedRule[], path: string): DerivedRule | null {
  return rules.find((rule) => rule.regexps.some((re) => re.test(path))) ?? null;
}

/** Classify each dirty entry to its first matching landing rule (or null). */
export function classify(rules: DerivedRule[], entries: StatusEntry[]): ClassifiedEntry[] {
  return entries.map((entry) => ({
    ...entry,
    kind: statusKind(entry.xy),
    rule: firstMatch(rules, entry.path),
  }));
}

/** Convenience: derive rules from the registry and classify in one step. */
export function classifyWithRegistry(
  registry: Registry,
  entries: StatusEntry[],
): ClassifiedEntry[] {
  return classify(deriveRules(registry), entries);
}

/** Entries that matched no rule (need an explicit disposition before landing). */
export function unmatchedEntries(classified: ClassifiedEntry[]): ClassifiedEntry[] {
  return classified.filter((entry) => entry.rule === null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Risky-mix detection (generalized port of legacy worktree-audit findRiskyMix)
//
// Legacy rule, restated in policy terms (Path = HARD signal only):
// - `parallel` streams (legacy guardrails group "D") may accompany one primary.
// - among non-parallel ("primary") streams:
//     * exactly one primary, and it is NOT `manual`         → OK
//     * exactly one primary, and it IS `manual`             → risky (must land alone)
//     * >= 2 primaries, all mutually `canLandWith`-linked   → OK (explicit link)
//     * otherwise                                           → risky
// This reproduces legacy behavior where a single non-CLEAN primary (+ guardrails)
// is fine, a lone CLEAN/manual stream must not mix, and multiple primaries are
// blocked unless explicitly linked.
// ─────────────────────────────────────────────────────────────────────────────

export type RiskyMix = {
  message: string;
  streams: Array<{ streamId: string; landingPolicy: LandingPolicy }>;
};

const RISKY_MIX_MESSAGE =
  "Staged changes span multiple landing streams. Land one primary stream at a time; " +
  "parallel streams may accompany one primary, but mixed primaries are blocked.";

/** Distinct landing streams (by stream id) present among classified entries. */
function distinctStreams(classified: ClassifiedEntry[]): DerivedRule[] {
  const byId = new Map<string, DerivedRule>();
  for (const entry of classified) {
    if (entry.rule) {
      byId.set(entry.rule.streamId, entry.rule);
    }
  }
  return [...byId.values()];
}

/** True iff every pair of streams declares each other in `canLandWith` (bidirectional). */
function allPairwiseCanLandWith(streams: DerivedRule[]): boolean {
  for (const a of streams) {
    for (const b of streams) {
      if (a.streamId === b.streamId) {
        continue;
      }
      if (!a.canLandWith.includes(b.streamId) || !b.canLandWith.includes(a.streamId)) {
        return false;
      }
    }
  }
  return true;
}

function riskyMixOf(streams: DerivedRule[]): RiskyMix {
  return {
    message: RISKY_MIX_MESSAGE,
    streams: streams.map((s) => ({ streamId: s.streamId, landingPolicy: s.landingPolicy })),
  };
}

/** Detect a risky landing-stream mix, or null when staging is safe. */
export function findRiskyMix(classified: ClassifiedEntry[]): RiskyMix | null {
  const active = distinctStreams(classified);
  if (active.length <= 1) {
    return null;
  }
  const primaries = active.filter((stream) => stream.landingPolicy !== "parallel");
  if (primaries.length === 0) {
    return null; // only parallel streams
  }
  if (primaries.length === 1) {
    return primaries[0].landingPolicy === "manual" ? riskyMixOf(active) : null;
  }
  if (allPairwiseCanLandWith(primaries)) {
    return null; // explicitly linked primaries
  }
  return riskyMixOf(active);
}

// ─────────────────────────────────────────────────────────────────────────────
// Output shaping (pure functions; flag wiring lives in the CLI / wrapper)
// ─────────────────────────────────────────────────────────────────────────────

export type RuleBucket = {
  streamId: string | null; // null = unmatched
  landingPolicy: LandingPolicy | null;
  entries: ClassifiedEntry[];
  kinds: Record<string, number>;
};

/** Group classified entries by their owning rule (or "unmatched"), with kind counts. */
export function summarizeByRule(classified: ClassifiedEntry[]): RuleBucket[] {
  const buckets = new Map<string, RuleBucket>();
  for (const entry of classified) {
    const key = entry.rule?.streamId ?? "\u0000unmatched";
    const bucket = buckets.get(key) ?? {
      streamId: entry.rule?.streamId ?? null,
      landingPolicy: entry.rule?.landingPolicy ?? null,
      entries: [],
      kinds: {},
    };
    bucket.entries.push(entry);
    bucket.kinds[entry.kind] = (bucket.kinds[entry.kind] ?? 0) + 1;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].toSorted((a, b) => b.entries.length - a.entries.length);
}

const KIND_ORDER: StatusKind[] = ["modified", "added", "deleted", "renamed", "untracked"];

/** Bucket entries by status kind in a stable order. */
export function groupByKind(entries: ClassifiedEntry[]): Record<StatusKind, ClassifiedEntry[]> {
  const buckets: Record<StatusKind, ClassifiedEntry[]> = {
    modified: [],
    added: [],
    deleted: [],
    renamed: [],
    untracked: [],
  };
  for (const entry of entries) {
    buckets[entry.kind].push(entry);
  }
  return buckets;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Produce a dry-run staging plan (git add commands), matching legacy stage-plan. */
export function buildStagePlan(entries: ClassifiedEntry[]): string[] {
  const buckets = groupByKind(entries);
  const stageWithAdd = [
    ...buckets.modified,
    ...buckets.added,
    ...buckets.untracked,
    ...buckets.renamed,
  ];
  const stageWithUpdate = buckets.deleted;
  const lines: string[] = [];
  if (stageWithAdd.length > 0) {
    lines.push(`git add -- ${stageWithAdd.map((e) => shellQuote(e.path)).join(" ")}`);
  }
  if (stageWithUpdate.length > 0) {
    lines.push(`git add -u -- ${stageWithUpdate.map((e) => shellQuote(e.path)).join(" ")}`);
  }
  return lines;
}

export type AuditReport = {
  total: number;
  unmatched: number;
  riskyMix: RiskyMix | null;
  groups: Array<{
    streamId: string | null;
    landingPolicy: LandingPolicy | null;
    count: number;
    kinds: Record<string, number>;
    paths: string[];
  }>;
};

/** Build a structured audit report (basis for `--json` and human output). */
export function buildAuditReport(classified: ClassifiedEntry[]): AuditReport {
  const grouped = summarizeByRule(classified);
  return {
    total: classified.length,
    unmatched: unmatchedEntries(classified).length,
    riskyMix: findRiskyMix(classified),
    groups: grouped.map((bucket) => ({
      streamId: bucket.streamId,
      landingPolicy: bucket.landingPolicy,
      count: bucket.entries.length,
      kinds: bucket.kinds,
      paths: bucket.entries.map((entry) => entry.path),
    })),
  };
}

export { KIND_ORDER };
