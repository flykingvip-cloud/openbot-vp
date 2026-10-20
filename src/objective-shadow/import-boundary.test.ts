import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_WRITE_SYMBOLS } from "./write-guard.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));

const FORBIDDEN_IMPORT_NEEDLES = [
  ...FORBIDDEN_WRITE_SYMBOLS,
  "objective-coordination",
  "ActiveLeasePointer",
  "completeConversationTaskLedgerOnReply",
  "progress-ledger",
  "conversation-task/store",
  "collaboration-dispatch/round-runtime",
];

const READ_ONLY_STORE_FILES = new Set(["read-existing-objectives.ts"]);
const READ_ONLY_CRON_META_FILES = new Set(["cron-objective.ts"]);

function productionSources(): string[] {
  return fs
    .readdirSync(DIR)
    .filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "write-guard.ts",
    )
    .map((name) => path.join(DIR, name));
}

function importLines(text: string): string[] {
  return text.split("\n").filter((line) => /^\s*import\b/.test(line));
}

describe("objective-shadow import boundary", () => {
  it("does not import forbidden write or coordination symbols", () => {
    const hits: string[] = [];
    for (const file of productionSources()) {
      const imported = importLines(fs.readFileSync(file, "utf8")).join("\n");
      for (const needle of FORBIDDEN_IMPORT_NEEDLES) {
        if (
          needle === "conversation-task/store" &&
          READ_ONLY_STORE_FILES.has(path.basename(file))
        ) {
          continue;
        }
        if (imported.includes(needle)) {
          hits.push(`${path.basename(file)}:${needle}`);
        }
      }
      if (
        imported.includes("cron/personal-task-meta") &&
        !READ_ONLY_CRON_META_FILES.has(path.basename(file))
      ) {
        hits.push(`${path.basename(file)}:cron/personal-task-meta`);
      }
      if (READ_ONLY_STORE_FILES.has(path.basename(file))) {
        const text = fs.readFileSync(file, "utf8");
        for (const write of ["createTaskIfAbsent", "transitionTask", "createCandidateIfAbsent"]) {
          if (new RegExp(`\\b${write}\\s*\\(`).test(text)) {
            hits.push(`${path.basename(file)}:${write}`);
          }
        }
        if (/\bresolveDataRoot\s*\(\s*\)/.test(text)) {
          hits.push(`${path.basename(file)}:resolveDataRoot()`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
