/**
 * Read-only async-wait recovery directory scan.
 * Finds unfinished wait records under session transcript trees.
 * Claim / enqueue / arm stay in async-wait-job-recovery.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { listAgentIds } from "../../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../../config/config.js";
import { resolveSessionTranscriptsDirForAgent } from "../../../config/sessions/paths.js";
import type { AsyncWaitJobIntent } from "./async-wait-job-store.js";
import { readAsyncWaitJobIntent } from "./async-wait-job.js";

const JOBS_DIRNAME = "async-wait-jobs";

function readIntentFile(filePath: string): AsyncWaitJobIntent | undefined {
  try {
    const row = JSON.parse(fs.readFileSync(filePath, "utf8")) as AsyncWaitJobIntent;
    if (
      row &&
      (row.version === 2 || (row as { version?: number }).version === 1) &&
      typeof row.jobId === "string" &&
      typeof row.sessionFile === "string"
    ) {
      return readAsyncWaitJobIntent(row.sessionFile, row.jobId) ?? row;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function findAsyncWaitJobsDirs(sessionsRoot: string, maxDepth = 3): string[] {
  const root = sessionsRoot.trim();
  if (!root || !fs.existsSync(root)) {
    return [];
  }
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.name === JOBS_DIRNAME) {
        out.push(full);
        continue;
      }
      if (depth < maxDepth) {
        walk(full, depth + 1);
      }
    }
  };
  walk(root, 0);
  return out;
}

export function collectRecoverableAsyncWaitIntents(cfg: OpenBotConfig): AsyncWaitJobIntent[] {
  const byKey = new Map<string, AsyncWaitJobIntent>();
  for (const agentId of listAgentIds(cfg)) {
    let sessionsRoot: string;
    try {
      sessionsRoot = resolveSessionTranscriptsDirForAgent(agentId);
    } catch {
      continue;
    }
    for (const jobsDir of findAsyncWaitJobsDirs(sessionsRoot)) {
      let names: string[];
      try {
        names = fs.readdirSync(jobsDir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith(".json")) {
          continue;
        }
        const intent = readIntentFile(path.join(jobsDir, name));
        if (!intent || intent.status === "cleared") {
          continue;
        }
        if (intent.recovery?.stage === "delivered") {
          continue;
        }
        byKey.set(`${intent.sessionFile}::${intent.jobId}`, intent);
      }
    }
  }
  return [...byKey.values()];
}
