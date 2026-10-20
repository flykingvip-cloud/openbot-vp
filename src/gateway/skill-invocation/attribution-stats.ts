/**
 * Lightweight counters for skill attribution outcomes (ops observability).
 * Not a substitute for event log; process-local + best-effort disk snapshot.
 */

import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";

export type AttributionResolutionKey =
  | "selectedSkillId"
  | "tool_args"
  | "identity_tool_name"
  | "unique_owner"
  | "prompt_named_use"
  | "none"
  | "unknown";

export type AttributionStatsSnapshot = {
  updatedAt: string;
  counts: Record<AttributionResolutionKey, number>;
  totalAttributed: number;
  totalUnattributed: number;
};

const EMPTY_COUNTS: Record<AttributionResolutionKey, number> = {
  selectedSkillId: 0,
  tool_args: 0,
  identity_tool_name: 0,
  unique_owner: 0,
  prompt_named_use: 0,
  none: 0,
  unknown: 0,
};

let memory: Record<AttributionResolutionKey, number> = { ...EMPTY_COUNTS };

function statsPath(configDir: string = CONFIG_DIR): string {
  return path.join(configDir, "skill-invocation-events", "attribution-stats.json");
}

export function recordAttributionOutcome(
  resolution: string | null | undefined,
  options?: { configDir?: string },
): void {
  const key = normalizeKey(resolution);
  memory[key] = (memory[key] ?? 0) + 1;
  // Persist occasionally (every 10th event) to limit I/O.
  const total = Object.values(memory).reduce((a, b) => a + b, 0);
  if (total % 10 === 0) {
    persistAttributionStats(options?.configDir);
  }
}

export function readAttributionStats(configDir: string = CONFIG_DIR): AttributionStatsSnapshot {
  loadIfEmpty(configDir);
  const counts = { ...EMPTY_COUNTS, ...memory };
  const totalUnattributed = counts.none;
  const totalAttributed = Object.entries(counts)
    .filter(([k]) => k !== "none" && k !== "unknown")
    .reduce((sum, [, n]) => sum + n, 0);
  return {
    updatedAt: new Date().toISOString(),
    counts,
    totalAttributed,
    totalUnattributed,
  };
}

export function resetAttributionStatsForTests(): void {
  memory = { ...EMPTY_COUNTS };
}

function normalizeKey(resolution: string | null | undefined): AttributionResolutionKey {
  if (!resolution) {
    return "none";
  }
  if (resolution in EMPTY_COUNTS) {
    return resolution as AttributionResolutionKey;
  }
  return "unknown";
}

function loadIfEmpty(configDir: string): void {
  if (Object.values(memory).some((n) => n > 0)) {
    return;
  }
  try {
    const filePath = statsPath(configDir);
    if (!fs.existsSync(filePath)) {
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as AttributionStatsSnapshot;
    if (parsed?.counts) {
      memory = { ...EMPTY_COUNTS, ...parsed.counts };
    }
  } catch {
    // ignore
  }
}

function persistAttributionStats(configDir: string = CONFIG_DIR): void {
  try {
    const filePath = statsPath(configDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const snap = readAttributionStats(configDir);
    fs.writeFileSync(filePath, `${JSON.stringify(snap, null, 2)}\n`, "utf-8");
  } catch {
    // best-effort
  }
}
