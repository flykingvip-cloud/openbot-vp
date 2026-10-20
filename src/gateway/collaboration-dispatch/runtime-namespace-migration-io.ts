/** P0.0a migration — small filesystem helpers (see runtime-namespace-migration.ts). */
import fs from "node:fs/promises";
import path from "node:path";
import type {
  FileAction,
  GroupReport,
  GroupStatus,
  NonTerminalRound,
} from "./runtime-namespace-migration-types.js";

export const MIGRATED_TO_FILENAME = "MIGRATED_TO.json";
export const LEDGER_FACT = "ledger/collaboration.jsonl";
const TERMINAL_ROUND_STATES = new Set(["ROUND_COMPLETE", "ROUND_ABORTED"]);

export async function readMaybe(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function listDir(dir: string, kind: "file" | "dir"): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => (kind === "file" ? e.isFile() : e.isDirectory()) && !e.name.startsWith("."))
    .map((e) => e.name)
    .toSorted();
}

export function isRoundFactFile(name: string): boolean {
  if (name.endsWith(".lock") || name.endsWith(".tmp") || name.includes(".migrating-")) {
    return false;
  }
  return name.endsWith(".json") || name.endsWith(".events.jsonl") || name.endsWith(".txn");
}

export function decodeGroupDirName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** Three-way rule shared by forward and reverse copies. */
export function decideCopy(srcSha: string, destSha: string | null, baseline?: string): FileAction {
  if (destSha === null) {
    return "copy";
  }
  if (destSha === srcSha) {
    return "unchanged";
  }
  if (baseline && destSha === baseline) {
    return "overwrite";
  }
  if (baseline && srcSha === baseline) {
    return "dest_newer";
  }
  return "conflict";
}

export async function listNonTerminalRounds(roundsDir: string) {
  const out: NonTerminalRound[] = [];
  for (const name of await listDir(roundsDir, "file")) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const roundId = name.replace(/\.json$/, "");
    try {
      const raw = await fs.readFile(path.join(roundsDir, name), "utf8");
      const round = JSON.parse(raw) as { roundId?: string; state?: string };
      if (!TERMINAL_ROUND_STATES.has(round.state ?? "")) {
        out.push({
          roundId: round.roundId ?? roundId,
          state: round.state ?? "unknown",
          file: name,
        });
      }
    } catch {
      out.push({ roundId, state: "unreadable", file: name });
    }
  }
  return out;
}

export async function listRetained(legacyGroupDir: string): Promise<string[]> {
  const skip = new Set(["runtime", "ledger", "collaboration-ledger.jsonl", MIGRATED_TO_FILENAME]);
  const top = await fs.readdir(legacyGroupDir, { withFileTypes: true }).catch(() => []);
  const runtime = await fs
    .readdir(path.join(legacyGroupDir, "runtime"), { withFileTypes: true })
    .catch(() => []);
  return [
    ...top.filter((e) => !skip.has(e.name)).map((e) => `${e.name}${e.isDirectory() ? "/" : ""}`),
    ...runtime
      .filter((e) => e.name !== "rounds" && e.name !== "ledger" && e.name !== "migration")
      .map((e) => `runtime/${e.name}${e.isDirectory() ? "/" : ""}`),
  ].toSorted();
}

export function summarize(groups: GroupReport[]): Record<string, number> {
  const files = groups.flatMap((g) => g.files);
  const count = (status: GroupStatus) => groups.filter((g) => g.status === status).length;
  return {
    groups: groups.length,
    planned: count("planned"),
    migrated: count("migrated"),
    unchanged: count("unchanged"),
    quarantined: count("quarantined"),
    skippedNoRuntimeFacts: count("skipped_no_runtime_facts"),
    failed: count("failed"),
    ownerDefaultTenant001: groups.filter((g) => g.tenant.reason === "owner-default-tenant-001")
      .length,
    files: files.length,
    verified: files.filter((f) => f.verified === true).length,
    verifyFailures: files.filter((f) => f.verified === false).length,
    conflicts: files.filter((f) => f.action === "conflict").length,
    ledgerMerges: files.filter(
      (f) => f.fact === LEDGER_FACT && (f.from.length > 1 || f.action === "merge"),
    ).length,
    duplicatesDropped: files.reduce((n, f) => n + (f.duplicatesDropped ?? 0), 0),
    nonTerminalRounds: groups.reduce((n, g) => n + g.nonTerminalRounds.length, 0),
  };
}
