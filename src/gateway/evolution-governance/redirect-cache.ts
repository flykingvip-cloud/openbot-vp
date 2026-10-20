/**
 * In-memory snapshot of governance redirects for hot-path routing.
 * Refreshed from state file by mtime; invalidated on write.
 */

import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import type { AgentRedirectRecord } from "./runtime-actions.js";

type Snapshot = {
  mtimeMs: number;
  redirects: Record<string, AgentRedirectRecord>;
};

let snapshot: Snapshot | null = null;
let forcedInvalid = true;

function stateFilePath(configDir: string = CONFIG_DIR): string {
  return path.join(configDir, "evolution-governance", "state.json");
}

export function invalidateGovernanceRedirectCache(): void {
  forcedInvalid = true;
  snapshot = null;
}

export function getRedirectMapSnapshot(
  configDir: string = CONFIG_DIR,
): Record<string, AgentRedirectRecord> {
  const filePath = stateFilePath(configDir);
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    snapshot = { mtimeMs: 0, redirects: {} };
    forcedInvalid = false;
    return snapshot.redirects;
  }
  if (!forcedInvalid && snapshot && snapshot.mtimeMs === mtimeMs) {
    return snapshot.redirects;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      redirects?: Record<string, AgentRedirectRecord>;
    };
    snapshot = {
      mtimeMs,
      redirects: raw.redirects && typeof raw.redirects === "object" ? raw.redirects : {},
    };
  } catch {
    snapshot = { mtimeMs, redirects: {} };
  }
  forcedInvalid = false;
  return snapshot.redirects;
}
