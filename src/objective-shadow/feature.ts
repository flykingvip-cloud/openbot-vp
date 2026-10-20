/**
 * Phase 2 Objective Resolver shadow gates. Default OFF. Env only — no UI / config default.
 * Independent from Phase 1b Cron L2 prompt and OPENBOT_CONVERSATION_TASK_ORCH_SHADOW.
 *
 * HMAC must survive process restart via env or an operator-controlled key file.
 * Key-file fallback is fail-closed unless lstat is a regular file, not a
 * symlink, mode & 0o077 === 0, and owner is the current process user.
 * The key must never be written to the repo, JSONL, window state, or reports.
 */

import { lstatSync, readFileSync } from "node:fs";

export const OBJECTIVE_SHADOW_FLAG_ENV = "OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW";
export const OBJECTIVE_SHADOW_HMAC_KEY_ENV = "OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY";
export const OBJECTIVE_SHADOW_HMAC_KEY_FILE_ENV =
  "OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW_HMAC_KEY_FILE";

function envFlagOn(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "1" || value === "true";
}

export function isObjectiveShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return envFlagOn(env[OBJECTIVE_SHADOW_FLAG_ENV]);
}

export type HmacKeyFileStat = {
  isFile(): boolean;
  isSymbolicLink(): boolean;
  mode: number;
  uid: number;
};

/** Fail-closed before any key bytes are read. */
export function isTrustedHmacKeyFileStat(stat: HmacKeyFileStat, uid: number | undefined): boolean {
  if (typeof uid !== "number") {
    return false;
  }
  if (stat.isSymbolicLink()) {
    return false;
  }
  if (!stat.isFile()) {
    return false;
  }
  if ((stat.mode & 0o077) !== 0) {
    return false;
  }
  return stat.uid === uid;
}

function readKeyFromFile(filePath: string | undefined): string | null {
  const path = filePath?.trim() ?? "";
  if (!path) {
    return null;
  }
  try {
    const stat = lstatSync(path);
    if (!isTrustedHmacKeyFileStat(stat, process.getuid?.())) {
      return null;
    }
    const key = readFileSync(path, "utf8").trim();
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export function readObjectiveShadowHmacKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env[OBJECTIVE_SHADOW_HMAC_KEY_ENV];
  if (typeof raw === "string") {
    const key = raw.trim();
    if (key.length > 0) {
      return key;
    }
  }
  return readKeyFromFile(env[OBJECTIVE_SHADOW_HMAC_KEY_FILE_ENV]);
}

/** Flag ON is not enough to persist; missing HMAC key is fail-closed (plan §2.3 / §3.2). */
export function isObjectiveShadowWritable(env: NodeJS.ProcessEnv = process.env): boolean {
  return isObjectiveShadowEnabled(env) && readObjectiveShadowHmacKey(env) !== null;
}
