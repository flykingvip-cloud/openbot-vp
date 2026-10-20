#!/usr/bin/env node
/**
 * Offline report over the governance shadow decision log (governance closure plan v1.0
 * §8.2). Reads `CONFIG_DIR/audit/governance-shadow-decisions.jsonl` (written only when
 * `OPENBOT_GOVERNANCE_SHADOW_LOG=1`) and prints counts. Read-only.
 *
 * - `skipped` is its own bucket and never enters match/divergence denominators (ADR-5).
 * - CLI-backend records (`cli-backend-model` in `reason` or `matchedRules`) are broken out
 *   and excluded from `wouldDeny` and the rates: a CLI backend is not a catalog model the
 *   enterprise allowlist names (E16), so its "deny" is not an ordinary would-deny.
 * - D4 is reported but excluded from the divergence rate (§8.3).
 *
 * Usage:
 *   node --import tsx scripts/governance/shadow-decisions-report.ts [--file <path>] [--json]
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLI_BACKEND_MODEL_MARKER = "cli-backend-model";

export type ShadowRecord = {
  effect?: string;
  mode?: string;
  source?: string;
  reason?: string;
  matchedRules?: string[];
  tenantId?: string;
  shadow?: { divergence?: string };
};

export type ShadowReport = {
  total: number;
  malformed: number;
  skipped: number;
  legacy: number;
  allow: number;
  wouldDeny: number;
  cliBackend: { total: number; deny: number; allow: number };
  /** Non-skipped, non-CLI records: the §8.2 denominator. */
  evaluated: number;
  byClass: Record<string, number>;
  matchRate: number | null;
  divergenceRate: number | null;
  bySource: Record<string, number>;
  byTenant: Record<string, number>;
  topReasons: Array<{ reason: string; count: number }>;
};

export function isCliBackendRecord(record: ShadowRecord): boolean {
  return (
    record.reason === CLI_BACKEND_MODEL_MARKER ||
    (record.matchedRules ?? []).some(
      (rule) =>
        rule === CLI_BACKEND_MODEL_MARKER || rule.startsWith(`${CLI_BACKEND_MODEL_MARKER}:`),
    )
  );
}

/**
 * Excluded from would-deny and the rates only when the CLI backend decided the outcome:
 * the envelope marks that with `reason: "cli-backend-model"` (a filtered CLI primary).
 * A record where only a CLI fallback was filtered stays an ordinary record, just tagged.
 */
function isCliDriven(record: ShadowRecord): boolean {
  return record.reason === CLI_BACKEND_MODEL_MARKER;
}

function bump(map: Record<string, number>, key: string | undefined): void {
  const k = key?.trim() || "(none)";
  map[k] = (map[k] ?? 0) + 1;
}

export function parseShadowLog(text: string): { records: ShadowRecord[]; malformed: number } {
  const records: ShadowRecord[] = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object") {
        records.push(parsed as ShadowRecord);
      } else {
        malformed += 1;
      }
    } catch {
      malformed += 1;
    }
  }
  return { records, malformed };
}

export function summarizeShadowDecisions(records: ShadowRecord[], malformed = 0): ShadowReport {
  const report: ShadowReport = {
    total: records.length,
    malformed,
    skipped: 0,
    legacy: 0,
    allow: 0,
    wouldDeny: 0,
    cliBackend: { total: 0, deny: 0, allow: 0 },
    evaluated: 0,
    byClass: {},
    matchRate: null,
    divergenceRate: null,
    bySource: {},
    byTenant: {},
    topReasons: [],
  };
  const reasons: Record<string, number> = {};
  let match = 0;
  let divergence = 0;
  for (const record of records) {
    bump(report.bySource, record.source);
    bump(report.byTenant, record.tenantId);
    bump(reasons, record.reason);
    if (record.mode === "legacy") {
      report.legacy += 1;
    }
    if (record.effect === "skipped") {
      report.skipped += 1;
      continue;
    }
    if (isCliBackendRecord(record)) {
      report.cliBackend.total += 1;
      if (record.effect === "deny") {
        report.cliBackend.deny += 1;
      } else if (record.effect === "allow") {
        report.cliBackend.allow += 1;
      }
    }
    if (isCliDriven(record)) {
      continue;
    }
    report.evaluated += 1;
    if (record.effect === "allow") {
      report.allow += 1;
    } else if (record.effect === "deny" && record.mode === "shadow") {
      report.wouldDeny += 1;
    }
    const cls = record.shadow?.divergence;
    if (cls) {
      bump(report.byClass, cls);
      if (cls === "D0") {
        match += 1;
      } else if (cls !== "D4" && cls !== "D5") {
        divergence += 1;
      }
    }
  }
  if (report.evaluated > 0) {
    report.matchRate = match / report.evaluated;
    report.divergenceRate = divergence / report.evaluated;
  }
  report.topReasons = Object.entries(reasons)
    .map(([reason, count]) => ({ reason, count }))
    .toSorted((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, 10);
  return report;
}

function defaultLogPath(): string {
  const stateDir =
    process.env.OPENBOT_STATE_DIR?.trim() ||
    process.env.OPENCLAW_STATE_DIR?.trim() ||
    path.join(os.homedir(), ".openbot");
  return path.join(stateDir, "audit", "governance-shadow-decisions.jsonl");
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  const fileIdx = args.indexOf("--file");
  const file = fileIdx >= 0 ? args[fileIdx + 1] : defaultLogPath();
  if (!file) {
    console.error("--file requires a path");
    return 2;
  }
  if (!fs.existsSync(file)) {
    console.error(`no shadow log at ${file} (is OPENBOT_GOVERNANCE_SHADOW_LOG=1 set?)`);
    return 1;
  }
  const { records, malformed } = parseShadowLog(fs.readFileSync(file, "utf8"));
  const report = summarizeShadowDecisions(records, malformed);
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  console.log(`file: ${file}`);
  console.log(`total ${report.total} (malformed ${report.malformed})`);
  console.log(`skipped ${report.skipped} (legacy ${report.legacy})`);
  console.log(
    `evaluated ${report.evaluated}: allow ${report.allow}, would-deny ${report.wouldDeny}`,
  );
  console.log(
    `cli-backend (excluded from would-deny): ${report.cliBackend.total} (deny ${report.cliBackend.deny}, allow ${report.cliBackend.allow})`,
  );
  console.log(`match ${pct(report.matchRate)}, divergence ${pct(report.divergenceRate)}`);
  console.log(`byClass ${JSON.stringify(report.byClass)}`);
  console.log(`topReasons ${report.topReasons.map((r) => `${r.reason}=${r.count}`).join(", ")}`);
  return 0;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectRun) {
  process.exit(main(process.argv));
}
