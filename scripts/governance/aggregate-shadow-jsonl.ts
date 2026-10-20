#!/usr/bin/env node
/**
 * Offline aggregate of the governance shadow decision log (closure plan §8.2 / PR-OBS-1).
 *
 * Reads `CONFIG_DIR/audit/governance-shadow-decisions.jsonl`. Read-only: it does not
 * import the gateway, does not write the log, and does not change any
 * `OPENBOT_GOVERNANCE_*` default.
 *
 * Buckets:
 * - `skipped` — `effect: "skipped"` or divergence class D5 (either side skipped).
 * - `match` — class D0.
 * - `divergence` — classes D1, D2, D3, D6. D6 (shadow threw) wins over `effect: "skipped"`:
 *   a D6 envelope is skipped because nothing was evaluated, and it still counts here.
 * - D4 (different subjects) is counted in `total` and `byClass` only. It is not a match
 *   and not a divergence (§8.3).
 *
 * Usage:
 *   node --import tsx scripts/governance/aggregate-shadow-jsonl.ts [--file <path>] [--json]
 *   node --import tsx scripts/governance/aggregate-shadow-jsonl.ts --window 2026-09-27 --json
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Classes that count as divergence. D4 is intentionally absent. D5 is skipped. */
const DIVERGENCE_CLASSES = new Set(["D1", "D2", "D3", "D6"]);

/**
 * Fallback for lines without an explicit `entry` (for example logs written before the
 * writers stamped it). Explicit `entry` on the JSONL line always wins, so a stamped
 * E11 / E12 `capability` line is not counted as E8. Unstamped model entitlement and
 * agent invocation lines cover several entries and stay `(unspecified)`.
 */
const UNAMBIGUOUS_SOURCE_ENTRY: Record<string, string> = {
  capability: "E8",
  node: "E9",
};

export type ShadowLogRecord = {
  effect?: string;
  mode?: string;
  source?: string;
  reason?: string;
  tenantId?: string;
  /**
   * Execution-entry id stamped by the writer when it knows its entry (E2, E3, E6, E8,
   * E9, E10, E11, E12). Older lines and unstamped writers have none.
   */
  entry?: string;
  ts?: string;
  shadow?: {
    divergence?: string;
    existing?: { effect?: string };
  };
};

export type RecordOutcome = "match" | "divergence" | "skipped" | "excluded-d4" | "unclassified";

export type ShadowCounts = {
  total: number;
  skipped: number;
  match: number;
  divergence: number;
};

export type ReasonCount = { reason: string; count: number };

export type ShadowAggregate = ShadowCounts & {
  malformed: number;
  /** D4 rows inside `total` that were kept out of match and divergence. */
  excludedD4: number;
  unclassified: number;
  byClass: Record<string, number>;
  topReasons: ReasonCount[];
  byReason: Record<string, ShadowCounts>;
  bySource: Record<string, ShadowCounts>;
  byTenant: Record<string, ShadowCounts>;
  byEntry: Record<string, ShadowCounts>;
};

export type ReportWindow =
  | { kind: "all" }
  | { kind: "day"; day: string }
  | { kind: "range"; sinceMs?: number; untilMs?: number; label: string };

export function resolveEntry(record: ShadowLogRecord): string {
  const explicit = record.entry?.trim();
  if (explicit) {
    return explicit;
  }
  const source = record.source?.trim();
  if (source && UNAMBIGUOUS_SOURCE_ENTRY[source]) {
    return UNAMBIGUOUS_SOURCE_ENTRY[source];
  }
  return "(unspecified)";
}

export function resolveTenant(record: ShadowLogRecord): string {
  return record.tenantId?.trim() || "(none)";
}

export function resolveSource(record: ShadowLogRecord): string {
  return record.source?.trim() || "(none)";
}

export function resolveReason(record: ShadowLogRecord): string {
  return record.reason?.trim() || "(none)";
}

/**
 * Trusts `shadow.divergence` from the envelope. D4 is excluded before any effect
 * comparison, so a deny-vs-allow on a different subject cannot become divergence.
 */
export function classifyShadowRecord(record: ShadowLogRecord): RecordOutcome {
  const effect = record.effect;
  const divergence = record.shadow?.divergence;
  // D6 envelopes carry `effect: "skipped"` (nothing was evaluated); they are still divergence.
  if (divergence === "D6") {
    return "divergence";
  }
  if (effect === "skipped" || divergence === "D5") {
    return "skipped";
  }
  if (divergence === "D4") {
    return "excluded-d4";
  }
  if (divergence === "D0") {
    return "match";
  }
  if (divergence && DIVERGENCE_CLASSES.has(divergence)) {
    return "divergence";
  }
  const existing = record.shadow?.existing?.effect;
  if (existing === "skipped") {
    return "skipped";
  }
  if (existing && effect && existing === effect) {
    return "match";
  }
  if (existing && effect && existing !== effect) {
    return "divergence";
  }
  return "unclassified";
}

export function parseShadowJsonl(text: string): { records: ShadowLogRecord[]; malformed: number } {
  const records: ShadowLogRecord[] = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        malformed += 1;
        continue;
      }
      records.push(parsed as ShadowLogRecord);
    } catch {
      malformed += 1;
    }
  }
  return { records, malformed };
}

export function filterShadowRecords(
  records: readonly ShadowLogRecord[],
  window: ReportWindow,
): ShadowLogRecord[] {
  if (window.kind === "all") {
    return [...records];
  }
  return records.filter((record) => {
    const ms = record.ts ? Date.parse(record.ts) : Number.NaN;
    if (Number.isNaN(ms)) {
      return false;
    }
    if (window.kind === "day") {
      return new Date(ms).toISOString().slice(0, 10) === window.day;
    }
    if (window.sinceMs !== undefined && ms < window.sinceMs) {
      return false;
    }
    if (window.untilMs !== undefined && ms > window.untilMs) {
      return false;
    }
    return true;
  });
}

export function describeShadowWindow(
  records: readonly ShadowLogRecord[],
  window: ReportWindow,
): string {
  if (window.kind === "day") {
    return window.day;
  }
  if (window.kind === "range") {
    return window.label;
  }
  const days = new Set<string>();
  for (const record of records) {
    if (!record.ts) {
      continue;
    }
    const ms = Date.parse(record.ts);
    if (!Number.isNaN(ms)) {
      days.add(new Date(ms).toISOString().slice(0, 10));
    }
  }
  if (days.size === 0) {
    return records.length === 0 ? "empty" : "all";
  }
  const sorted = [...days].toSorted((a, b) => a.localeCompare(b));
  const first = sorted[0] ?? "empty";
  const last = sorted[sorted.length - 1] ?? first;
  return first === last ? first : `${first}..${last}`;
}

function emptyCounts(): ShadowCounts {
  return { total: 0, skipped: 0, match: 0, divergence: 0 };
}

function addOutcome(counts: ShadowCounts, outcome: RecordOutcome): void {
  counts.total += 1;
  if (outcome === "skipped") {
    counts.skipped += 1;
  } else if (outcome === "match") {
    counts.match += 1;
  } else if (outcome === "divergence") {
    counts.divergence += 1;
  }
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function slice(map: Record<string, ShadowCounts>, key: string, outcome: RecordOutcome): void {
  const counts = map[key] ?? emptyCounts();
  addOutcome(counts, outcome);
  map[key] = counts;
}

function sortRecord<T>(map: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(map).toSorted((a, b) => a.localeCompare(b))) {
    const value = map[key];
    if (value !== undefined) {
      sorted[key] = value;
    }
  }
  return sorted;
}

export function topReasons(reasons: Record<string, number>, limit = 10): ReasonCount[] {
  return Object.entries(reasons)
    .map(([reason, count]) => ({ reason, count }))
    .toSorted((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, limit);
}

export function aggregateShadowRecords(
  records: readonly ShadowLogRecord[],
  malformed = 0,
): ShadowAggregate {
  const totals = emptyCounts();
  const byClass: Record<string, number> = {};
  const reasons: Record<string, number> = {};
  const byReason: Record<string, ShadowCounts> = {};
  const bySource: Record<string, ShadowCounts> = {};
  const byTenant: Record<string, ShadowCounts> = {};
  const byEntry: Record<string, ShadowCounts> = {};
  let excludedD4 = 0;
  let unclassified = 0;

  for (const record of records) {
    const outcome = classifyShadowRecord(record);
    addOutcome(totals, outcome);
    if (outcome === "excluded-d4") {
      excludedD4 += 1;
    } else if (outcome === "unclassified") {
      unclassified += 1;
    }
    const divergence = record.shadow?.divergence?.trim();
    if (divergence) {
      bump(byClass, divergence);
    }
    const reason = resolveReason(record);
    bump(reasons, reason);
    slice(byReason, reason, outcome);
    slice(bySource, resolveSource(record), outcome);
    slice(byTenant, resolveTenant(record), outcome);
    slice(byEntry, resolveEntry(record), outcome);
  }

  return {
    ...totals,
    malformed,
    excludedD4,
    unclassified,
    byClass: sortRecord(byClass),
    topReasons: topReasons(reasons),
    byReason: sortRecord(byReason),
    bySource: sortRecord(bySource),
    byTenant: sortRecord(byTenant),
    byEntry: sortRecord(byEntry),
  };
}

/**
 * Gateway `CONFIG_DIR`: `OPENBOT_STATE_DIR`, then legacy state env vars, then
 * `~/.openbot` (or `~/.openclaw` when only the pre-rebrand dir exists).
 */
export function resolveShadowConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const override =
    env.OPENBOT_STATE_DIR?.trim() ||
    env.OPENCLAW_STATE_DIR?.trim() ||
    env.CLAWDBOT_STATE_DIR?.trim();
  if (override) {
    return override;
  }
  const home = homedir();
  const current = path.join(home, ".openbot");
  const legacy = path.join(home, ".openclaw");
  if (fs.existsSync(current)) {
    return current;
  }
  if (fs.existsSync(legacy)) {
    return legacy;
  }
  return current;
}

export function defaultShadowLogPath(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  return path.join(
    resolveShadowConfigDir(env, homedir),
    "audit",
    "governance-shadow-decisions.jsonl",
  );
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseShadowCliArgs(argv: string[]):
  | { error: string }
  | {
      file?: string;
      json: boolean;
      window: ReportWindow;
    } {
  const args = argv.slice(2);
  let file: string | undefined;
  let json = false;
  let day: string | undefined;
  let since: string | undefined;
  let until: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--file" || arg === "--window" || arg === "--since" || arg === "--until") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        return { error: `${arg} requires a value` };
      }
      i += 1;
      if (arg === "--file") {
        file = value;
      } else if (arg === "--window") {
        day = value;
      } else if (arg === "--since") {
        since = value;
      } else {
        until = value;
      }
      continue;
    }
    return { error: `unknown argument ${arg}` };
  }
  if (day && (since || until)) {
    return { error: "--window cannot be combined with --since/--until" };
  }
  if (day && !DAY_RE.test(day)) {
    return { error: "--window must be YYYY-MM-DD (UTC)" };
  }
  let window: ReportWindow = { kind: "all" };
  if (day) {
    window = { kind: "day", day };
  } else if (since || until) {
    const sinceMs = since ? Date.parse(since) : undefined;
    const untilMs = until ? Date.parse(until) : undefined;
    if (since && (sinceMs === undefined || Number.isNaN(sinceMs))) {
      return { error: "--since must be an ISO timestamp" };
    }
    if (until && (untilMs === undefined || Number.isNaN(untilMs))) {
      return { error: "--until must be an ISO timestamp" };
    }
    const label = `${since ?? ""}..${until ?? ""}`;
    window = { kind: "range", sinceMs, untilMs, label };
  }
  return { file, json, window };
}

export function formatAggregateText(
  file: string,
  windowLabel: string,
  report: ShadowAggregate,
): string {
  const reasons = report.topReasons.map((item) => `${item.reason}=${item.count}`).join(", ");
  return [
    `file: ${file}`,
    `window: ${windowLabel}`,
    `total ${report.total} (malformed ${report.malformed})`,
    `skipped ${report.skipped}`,
    `match ${report.match}`,
    `divergence ${report.divergence}`,
    `excluded D4 ${report.excludedD4} (not counted as divergence)`,
    `byClass ${JSON.stringify(report.byClass)}`,
    `topReasons ${reasons}`,
    `byEntry ${JSON.stringify(report.byEntry)}`,
    `bySource ${JSON.stringify(report.bySource)}`,
    `byTenant ${JSON.stringify(report.byTenant)}`,
  ].join("\n");
}

export function main(argv: string[]): number {
  const parsed = parseShadowCliArgs(argv);
  if ("error" in parsed) {
    console.error(parsed.error);
    return 2;
  }
  const file = parsed.file ?? defaultShadowLogPath();
  if (!fs.existsSync(file)) {
    console.error(
      `no shadow log at ${file} (OPENBOT_GOVERNANCE_SHADOW_LOG defaults off; the sink writes nothing until it is set)`,
    );
    return 1;
  }
  const { records, malformed } = parseShadowJsonl(fs.readFileSync(file, "utf8"));
  const selected = filterShadowRecords(records, parsed.window);
  const report = aggregateShadowRecords(selected, malformed);
  const windowLabel = describeShadowWindow(selected, parsed.window);
  if (parsed.json) {
    console.log(JSON.stringify({ file, window: windowLabel, ...report }, null, 2));
    return 0;
  }
  console.log(formatAggregateText(file, windowLabel, report));
  return 0;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  process.exit(main(process.argv));
}
