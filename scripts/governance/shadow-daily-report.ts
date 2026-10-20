#!/usr/bin/env node
/**
 * Daily shadow report (closure plan §8.5 / PR-OBS-1).
 *
 * Emits one row per entry + source inside the window. Each row carries:
 * window, entry, source, total, skipped, match, divergence, byClass, topReasons, byTenant.
 *
 * D4 is visible in `byClass` and `total` and is not included in `divergence`.
 * Read-only. Does not enable `OPENBOT_GOVERNANCE_SHADOW_LOG` or any `*_MODE`.
 *
 * Usage:
 *   node --import tsx scripts/governance/shadow-daily-report.ts [--file <path>] [--json]
 *   node --import tsx scripts/governance/shadow-daily-report.ts --window 2026-09-27 --json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateShadowRecords,
  defaultShadowLogPath,
  describeShadowWindow,
  filterShadowRecords,
  parseShadowCliArgs,
  parseShadowJsonl,
  resolveEntry,
  resolveSource,
  type ReasonCount,
  type ReportWindow,
  type ShadowCounts,
  type ShadowLogRecord,
} from "./aggregate-shadow-jsonl.js";

export type ShadowDailyRow = {
  window: string;
  entry: string;
  source: string;
  total: number;
  skipped: number;
  match: number;
  divergence: number;
  byClass: Record<string, number>;
  topReasons: ReasonCount[];
  byTenant: Record<string, ShadowCounts>;
};

export type ShadowDailyReport = {
  window: string;
  malformed: number;
  rows: ShadowDailyRow[];
};

export function buildShadowDailyReport(
  records: readonly ShadowLogRecord[],
  window: ReportWindow,
  malformed = 0,
): ShadowDailyReport {
  const selected = filterShadowRecords(records, window);
  const windowLabel = describeShadowWindow(selected, window);
  const groups = new Map<string, ShadowLogRecord[]>();
  for (const record of selected) {
    const key = `${resolveEntry(record)}\0${resolveSource(record)}`;
    const group = groups.get(key);
    if (group) {
      group.push(record);
    } else {
      groups.set(key, [record]);
    }
  }

  const rows: ShadowDailyRow[] = [...groups.entries()]
    .map(([key, group]) => {
      const [entry, source] = key.split("\0");
      const summary = aggregateShadowRecords(group);
      return {
        window: windowLabel,
        entry: entry ?? "(unspecified)",
        source: source ?? "(none)",
        total: summary.total,
        skipped: summary.skipped,
        match: summary.match,
        divergence: summary.divergence,
        byClass: summary.byClass,
        topReasons: summary.topReasons,
        byTenant: summary.byTenant,
      };
    })
    .toSorted((a, b) => a.entry.localeCompare(b.entry) || a.source.localeCompare(b.source));

  return { window: windowLabel, malformed, rows };
}

export function formatDailyText(file: string, report: ShadowDailyReport): string {
  const lines = [
    `file: ${file}`,
    `window: ${report.window}`,
    `malformed ${report.malformed}`,
    `rows ${report.rows.length}`,
  ];
  for (const row of report.rows) {
    lines.push(
      "",
      `window ${row.window}`,
      `entry ${row.entry}`,
      `source ${row.source}`,
      `total ${row.total}`,
      `skipped ${row.skipped}`,
      `match ${row.match}`,
      `divergence ${row.divergence}`,
      `byClass ${JSON.stringify(row.byClass)}`,
      `topReasons ${row.topReasons.map((item) => `${item.reason}=${item.count}`).join(", ")}`,
      `byTenant ${JSON.stringify(row.byTenant)}`,
    );
  }
  return lines.join("\n");
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
  const report = buildShadowDailyReport(records, parsed.window, malformed);
  if (parsed.json) {
    console.log(JSON.stringify({ file, ...report }, null, 2));
    return 0;
  }
  console.log(formatDailyText(file, report));
  return 0;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  process.exit(main(process.argv));
}
