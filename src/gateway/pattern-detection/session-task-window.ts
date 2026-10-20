/**
 * Soft multi-turn task boundary for ordinary sessions (no collab/cron task id).
 * Same session + same structure within a time window folds to one independence key.
 * Does NOT use sessionKey alone (would collapse entire long sessions).
 */

import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";

const DEFAULT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const STORE_FILE = "session-task-windows.json";

type WindowEntry = {
  taskId: string;
  lastSeenAt: number;
  structureKey: string;
};

type WindowStore = Record<string, WindowEntry>; // key = agentId|sessionKey|structureKey

function storePath(configDir: string = CONFIG_DIR): string {
  return path.join(configDir, "pattern-detection", STORE_FILE);
}

function loadStore(configDir: string = CONFIG_DIR): WindowStore {
  try {
    const filePath = storePath(configDir);
    if (!fs.existsSync(filePath)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as WindowStore;
  } catch {
    return {};
  }
}

function saveStore(store: WindowStore, configDir: string = CONFIG_DIR): void {
  try {
    const filePath = storePath(configDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Prune stale entries (> 24h).
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const next: WindowStore = {};
    for (const [k, v] of Object.entries(store)) {
      if (v.lastSeenAt >= cutoff) {
        next[k] = v;
      }
    }
    fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  } catch {
    // best-effort
  }
}

function windowMs(): number {
  const fromEnv = Number(process.env.OPENBOT_PATTERN_SESSION_TASK_WINDOW_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.floor(fromEnv);
  }
  return DEFAULT_WINDOW_MS;
}

/**
 * Return a stable task id for multi-turn same-structure work in one session.
 * Only applies when no stronger task id exists (caller should check first).
 */
export function resolveSessionStructureTaskId(params: {
  agentId: string;
  sessionKey: string | null | undefined;
  structureKey: string;
  runId: string;
  nowMs?: number;
  configDir?: string;
}): string | null {
  const sessionKey = params.sessionKey?.trim();
  const agentId = params.agentId.trim();
  const structureKey = params.structureKey.trim();
  if (!sessionKey || !agentId || !structureKey) {
    return null;
  }
  // Never treat session alone as task — require structure co-key.
  const mapKey = `${agentId}|${sessionKey}|${structureKey}`;
  const now = params.nowMs ?? Date.now();
  const store = loadStore(params.configDir);
  const existing = store[mapKey];
  if (existing && now - existing.lastSeenAt <= windowMs()) {
    existing.lastSeenAt = now;
    store[mapKey] = existing;
    saveStore(store, params.configDir);
    return existing.taskId;
  }
  const taskId = `sess-struct:${agentId}:${hashShort(`${sessionKey}|${structureKey}`)}`;
  store[mapKey] = { taskId, lastSeenAt: now, structureKey };
  saveStore(store, params.configDir);
  return taskId;
}

function hashShort(value: string): string {
  // FNV-1a 32-bit — no crypto import needed for short stable id.
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function resetSessionTaskWindowsForTests(configDir?: string): void {
  try {
    const filePath = storePath(configDir);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  } catch {
    // ignore
  }
}
