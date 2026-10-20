import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";

export type KnowledgeCompatWarningStatCode =
  | "implicit_personal_inbox"
  | "source_bind_visibility_ignored";

export type KnowledgeCompatWarningStats = {
  implicit_personal_inbox: number;
  source_bind_visibility_ignored: number;
  lastUpdatedAtMs: number;
};

type StatsStore = {
  counts: Partial<Record<KnowledgeCompatWarningStatCode, number>>;
  lastUpdatedAtMs: number;
};

const DEFAULT_STATS_FILE = path.join(CONFIG_DIR, "knowledge", "compat-warning-stats.json");

function readStore(storePath: string = DEFAULT_STATS_FILE): StatsStore {
  try {
    if (!fs.existsSync(storePath)) {
      return { counts: {}, lastUpdatedAtMs: 0 };
    }
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { counts: {}, lastUpdatedAtMs: 0 };
    }
    const record = parsed as Record<string, unknown>;
    const counts =
      typeof record.counts === "object" && record.counts !== null && !Array.isArray(record.counts)
        ? (record.counts as Partial<Record<KnowledgeCompatWarningStatCode, number>>)
        : {};
    return {
      counts,
      lastUpdatedAtMs: typeof record.lastUpdatedAtMs === "number" ? record.lastUpdatedAtMs : 0,
    };
  } catch {
    return { counts: {}, lastUpdatedAtMs: 0 };
  }
}

function writeStore(store: StatsStore, storePath: string = DEFAULT_STATS_FILE): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function readKnowledgeCompatWarningStats(
  storePath: string = DEFAULT_STATS_FILE,
): KnowledgeCompatWarningStats {
  const store = readStore(storePath);
  return {
    implicit_personal_inbox: store.counts.implicit_personal_inbox ?? 0,
    source_bind_visibility_ignored: store.counts.source_bind_visibility_ignored ?? 0,
    lastUpdatedAtMs: store.lastUpdatedAtMs,
  };
}

export function recordKnowledgeCompatWarning(
  code: KnowledgeCompatWarningStatCode,
  storePath: string = DEFAULT_STATS_FILE,
): KnowledgeCompatWarningStats {
  const store = readStore(storePath);
  const nextCount = (store.counts[code] ?? 0) + 1;
  const next: StatsStore = {
    counts: { ...store.counts, [code]: nextCount },
    lastUpdatedAtMs: Date.now(),
  };
  writeStore(next, storePath);
  return readKnowledgeCompatWarningStats(storePath);
}

export function resetKnowledgeCompatWarningStatsForTests(
  storePath: string = DEFAULT_STATS_FILE,
): void {
  if (fs.existsSync(storePath)) {
    fs.rmSync(storePath, { force: true });
  }
}
