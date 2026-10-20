/**
 * Floor Runtime v2.1 §5.7 / §6.2–6.3 — daily floor-shadow report.
 *
 * Read-only. Groups legacy baseline metrics by qualityClassifierVersion.
 * Episodes with Need = ∅ are excluded from Coverage denominators.
 *
 *   bun scripts/collab-floor-shadow-report.ts --input <ns>/shadow/floor-shadow.jsonl --dry-run
 *   bun scripts/collab-floor-shadow-report.ts --input fixture.jsonl --date 2026-10-07 --dry-run
 *   bun scripts/collab-floor-shadow-report.ts --input fixture.jsonl --exclude-round-ids ids.csv --dry-run
 *
 * `--exclude-round-ids FILE` drops rows whose `roundId` appears in FILE
 * (CSV with a `roundId` column, or one id per line). Use `default` to load
 * the bundled Floor P3 probe list under
 * the bundled `DEFAULT_FLOOR_P3_EXCLUDE_ROUND_IDS` list (Floor P3 signoff union).
 *
 * Does not write the sink or any production config. `--dry-run` is the
 * supported invocation; omitting it still only prints JSON to stdout.
 */
import fs from "node:fs/promises";
import path from "node:path";

export type FloorShadowReportGroup = {
  qualityClassifierVersion: string;
  episodes: number;
  coverageEpisodes: number;
  eligibilityCoverage: number | null;
  responseCoverage: number | null;
  usefulCoverage: number | null;
  waste: number | null;
  ttfu: { p50: number | null; p95: number | null; samples: number };
  humanInterruptRate: number | null;
};

export type FloorShadowDailyReport = {
  dryRun: boolean;
  date: string | null;
  input: string;
  skippedLines: number;
  excludedByRoundId: number;
  excludeRoundIdsPath: string | null;
  groups: FloorShadowReportGroup[];
};

type ShadowLine = {
  at?: unknown;
  qualityClassifierVersion?: unknown;
  roundId?: unknown;
  need?: { agentIds?: unknown };
  admittedAgentIds?: unknown;
  respondedAgentIds?: unknown;
  usefulAgentIds?: unknown;
  completeCallCount?: unknown;
  wasteCallCount?: unknown;
  humanInterrupted?: unknown;
  ttfuMs?: unknown;
  kind?: unknown;
  schemaVersion?: unknown;
};

/** Fields the report actually aggregates. `agentIds` is `string[]`, not `unknown`. */
type FloorShadowMetricRow = {
  at: number;
  qualityClassifierVersion: string;
  roundId: string | null;
  need: { agentIds: string[] };
  admittedAgentIds: string[];
  respondedAgentIds: string[];
  usefulAgentIds: string[];
  completeCallCount: number;
  wasteCallCount: number;
  humanInterrupted: boolean;
  ttfuMs?: number;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index] ?? null;
}

function intersectCount(left: readonly string[], right: readonly string[]): number {
  const allow = new Set(right);
  const seen = new Set<string>();
  let count = 0;
  for (const id of left) {
    if (allow.has(id) && !seen.has(id)) {
      seen.add(id);
      count += 1;
    }
  }
  return count;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

export function parseFloorShadowLine(line: string): FloorShadowMetricRow | null {
  try {
    const parsed = JSON.parse(line) as ShadowLine;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (parsed.kind !== "floor_shadow" || parsed.schemaVersion !== 1) {
      return null;
    }
    if (typeof parsed.qualityClassifierVersion !== "string" || !parsed.qualityClassifierVersion) {
      return null;
    }
    if (!parsed.need || !isStringArray(parsed.need.agentIds)) {
      return null;
    }
    if (
      !isStringArray(parsed.admittedAgentIds) ||
      !isStringArray(parsed.respondedAgentIds) ||
      !isStringArray(parsed.usefulAgentIds)
    ) {
      return null;
    }
    if (
      typeof parsed.completeCallCount !== "number" ||
      typeof parsed.wasteCallCount !== "number" ||
      typeof parsed.humanInterrupted !== "boolean" ||
      typeof parsed.at !== "number"
    ) {
      return null;
    }
    const ttfuMs =
      typeof parsed.ttfuMs === "number" && Number.isFinite(parsed.ttfuMs)
        ? parsed.ttfuMs
        : undefined;
    const roundId =
      typeof parsed.roundId === "string" && parsed.roundId.trim() ? parsed.roundId.trim() : null;
    return {
      at: parsed.at,
      qualityClassifierVersion: parsed.qualityClassifierVersion,
      roundId,
      need: { agentIds: parsed.need.agentIds },
      admittedAgentIds: parsed.admittedAgentIds,
      respondedAgentIds: parsed.respondedAgentIds,
      usefulAgentIds: parsed.usefulAgentIds,
      completeCallCount: parsed.completeCallCount,
      wasteCallCount: parsed.wasteCallCount,
      humanInterrupted: parsed.humanInterrupted,
      ...(ttfuMs === undefined ? {} : { ttfuMs }),
    };
  } catch {
    return null;
  }
}

export function buildFloorShadowDailyReport(params: {
  records: readonly FloorShadowMetricRow[];
  skippedLines: number;
  date: string | null;
  input: string;
  dryRun: boolean;
  excludeRoundIds?: ReadonlySet<string>;
  excludeRoundIdsPath?: string | null;
}): FloorShadowDailyReport {
  const exclude = params.excludeRoundIds ?? new Set<string>();
  let excludedByRoundId = 0;
  const dated = params.records.filter((record) => {
    if (!params.date) {
      return true;
    }
    return typeof record.at === "number" && utcDay(record.at) === params.date;
  });
  const selected = dated.filter((record) => {
    if (record.roundId && exclude.has(record.roundId)) {
      excludedByRoundId += 1;
      return false;
    }
    return true;
  });
  const versions = [
    ...new Set(selected.map((record) => String(record.qualityClassifierVersion))),
  ].toSorted();
  const groups = versions.map((version) => {
    const rows = selected.filter((record) => record.qualityClassifierVersion === version);
    let needCount = 0;
    let needAdmitted = 0;
    let needResponded = 0;
    let needUseful = 0;
    let calls = 0;
    let waste = 0;
    let interrupted = 0;
    const ttfu: number[] = [];
    let coverageEpisodes = 0;
    for (const row of rows) {
      const need = row.need.agentIds;
      const admitted = row.admittedAgentIds;
      const responded = row.respondedAgentIds;
      const useful = row.usefulAgentIds;
      if (need.length > 0) {
        coverageEpisodes += 1;
        needCount += need.length;
        needAdmitted += intersectCount(need, admitted);
        needResponded += intersectCount(need, responded);
        needUseful += intersectCount(need, useful);
      }
      calls += row.completeCallCount;
      waste += row.wasteCallCount;
      if (row.humanInterrupted) {
        interrupted += 1;
      }
      if (typeof row.ttfuMs === "number" && Number.isFinite(row.ttfuMs)) {
        ttfu.push(row.ttfuMs);
      }
    }
    const ttfuSorted = ttfu.toSorted((left, right) => left - right);
    return {
      qualityClassifierVersion: version,
      episodes: rows.length,
      coverageEpisodes,
      eligibilityCoverage: ratio(needAdmitted, needCount),
      responseCoverage: ratio(needResponded, needCount),
      usefulCoverage: ratio(needUseful, needCount),
      waste: ratio(waste, calls),
      ttfu: {
        p50: percentile(ttfuSorted, 50),
        p95: percentile(ttfuSorted, 95),
        samples: ttfuSorted.length,
      },
      humanInterruptRate: ratio(interrupted, rows.length),
    };
  });
  return {
    dryRun: params.dryRun,
    date: params.date,
    input: params.input,
    skippedLines: params.skippedLines,
    excludedByRoundId,
    excludeRoundIdsPath: params.excludeRoundIdsPath ?? null,
    groups,
  };
}

export async function readFloorShadowReportInput(filePath: string): Promise<{
  records: FloorShadowMetricRow[];
  skippedLines: number;
}> {
  const raw = await fs.readFile(filePath, "utf8");
  const records: FloorShadowMetricRow[] = [];
  let skippedLines = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const parsed = parseFloorShadowLine(line);
    if (!parsed) {
      skippedLines += 1;
      continue;
    }
    records.push(parsed);
  }
  return { records, skippedLines };
}

/** Bundled Floor P3 probe roundIds (C14 keep+exclude union). */
export const DEFAULT_FLOOR_P3_EXCLUDE_ROUND_IDS: readonly string[] = [
  "01fc63f219d949d590f8debec3b31594",
  "0b70e6945b5d4e6d9eb00ca807267a5f",
  "115892d6897345a4ab9f7c91f188f9f4",
  "1583aae52b2a4283882d294f41125e4c",
  "184eac023935444995629c2d60f23047",
  "1f8d6157c5084c629dec2964f10bc0a3",
  "23429f7825d74eb5adac85396f6b4e50",
  "251dfa921ec14f329b43228649390f3c",
  "36b4734ee1b4476e90b60b3e6b58b4f2",
  "38f94f4ee2cf45a88e602f75a926ec1a",
  "4276c2ca91b646c1a166dba3504ba94a",
  "43214a8cc43147768a73174881f73e2d",
  "43a1f5a8c7064242bc991baf550abdf2",
  "4c1f74d570e74c03a2440b1edb009def",
  "4d27b718bac64b07afea1645153dba79",
  "4fd6668d9f094172889cfeacdb3b1fe8",
  "532f0c9b54c74bf98aa7a337bab50705",
  "55e6375232cf40be95c2176087f2ed45",
  "57d1a188a9a54a36a92e7e3054428345",
  "5923375b26f34081b6ae30688fc98e08",
  "5d08b365b8d04b2fac98fe92acbd2084",
  "6970e5a4083d458aa2ca10d8f22e0129",
  "6d8b4b00a53846749e71eadc0b46f430",
  "7008a82f9d39468dabb99347b94dc56f",
  "784d5e66abd345b4a8af9a7a62b32ab4",
  "78b108de3ed94d72b3695c289ec3a801",
  "79f786564a58453595bc7009cb239cb5",
  "7a8b7057c69e4b02b3f1914f13de1644",
  "7bcefc1923c648c7b87160a34ddda44a",
  "7d9ee13c179e4bca8599fd0fd853010a",
  "81ff0a0d081c41dcb4db45b4296cb6d2",
  "820166d2536d4cf8a317a4cc2dc4e776",
  "89a4f9f2b30c44f4834fac735476600a",
  "955c836567c44aefb48a0df958998e64",
  "9d5230d631654d6b92a9f1d3916bacb2",
  "b7cfb54b56024ff99185462180144efc",
  "b7d35389d75c4f8589bcd2aaa1366630",
  "bb1ac10910dc473098cb69c1254903e9",
  "bb1dac158bf94faabdbdaef79770433f",
  "bb2bea81338246f986ced117017c155e",
  "befbfe680be74e55ae19c76278c0bdde",
  "c1e877277ea3495ead880226ab5b8d44",
  "c616bc9078e149afb1b174df586ab37e",
  "c722486369744112a2d0c2c7284bec27",
  "cd2882f0be464f7ab4c07e473cc4e6f5",
  "d2a6a9c376634cd897d6cd6561322bef",
  "d96866687d6240e18f2a43a76169b5a5",
  "daacf858042e46be9cc0a0a39ded0a9b",
  "e3db4705755b496a8eea8842c7cb76c8",
  "ee16242d038644499eef38d5652abdc0",
  "efda57bb2aa94796b6c4c8173e667418",
  "f4ac78c9b88d400fb3a617fc6763c24a",
  "f75caf605a4946c9a2657f7f8e1d023b",
];

export function defaultFloorP3ExcludeRoundIds(): Set<string> {
  return new Set(DEFAULT_FLOOR_P3_EXCLUDE_ROUND_IDS);
}

export async function loadExcludeRoundIds(filePath: string): Promise<Set<string>> {
  const raw = await fs.readFile(filePath, "utf8");
  const ids = new Set<string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const first = trimmed.split(",")[0]?.trim() ?? "";
    if (!first || first.toLowerCase() === "roundid") {
      continue;
    }
    ids.add(first);
  }
  return ids;
}

export function parseFloorShadowReportArgs(argv: readonly string[]): {
  input: string | null;
  date: string | null;
  dryRun: boolean;
  excludeRoundIds: string | null;
} {
  let input: string | null = null;
  let date: string | null = null;
  let dryRun = false;
  let excludeRoundIds: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--input") {
      input = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--date") {
      date = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--exclude-round-ids") {
      excludeRoundIds = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return { input, date, dryRun, excludeRoundIds };
}

export async function runFloorShadowReport(params: {
  input: string;
  date: string | null;
  dryRun: boolean;
  excludeRoundIds?: string | null;
}): Promise<FloorShadowDailyReport> {
  if (params.date && !/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
    throw new Error("--date must be YYYY-MM-DD");
  }
  const filePath = path.resolve(params.input);
  const loaded = await readFloorShadowReportInput(filePath);
  let excludePath: string | null = null;
  let excludeSet: Set<string> | undefined;
  if (params.excludeRoundIds) {
    if (params.excludeRoundIds === "default") {
      excludePath = "default";
      excludeSet = defaultFloorP3ExcludeRoundIds();
    } else {
      excludePath = path.resolve(params.excludeRoundIds);
      excludeSet = await loadExcludeRoundIds(excludePath);
    }
  }
  return buildFloorShadowDailyReport({
    ...loaded,
    date: params.date,
    input: filePath,
    dryRun: params.dryRun,
    excludeRoundIds: excludeSet,
    excludeRoundIdsPath: excludePath,
  });
}

export function floorShadowReportUsage(): string {
  return "Usage: bun scripts/collab-floor-shadow-report.ts --input <floor-shadow.jsonl> [--date YYYY-MM-DD] [--exclude-round-ids FILE|default] [--dry-run]";
}

async function main(): Promise<void> {
  const args = parseFloorShadowReportArgs(process.argv.slice(2));
  if (!args.input) {
    console.error(floorShadowReportUsage());
    process.exitCode = 2;
    return;
  }
  const report = await runFloorShadowReport({
    input: args.input,
    date: args.date,
    dryRun: args.dryRun,
    excludeRoundIds: args.excludeRoundIds,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("collab-floor-shadow-report.ts") && !process.env.VITEST) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
