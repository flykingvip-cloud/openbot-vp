/**
 * Shared → operator session heal.
 *
 * Authenticated gateway turns run under operator ALS, so session stores resolve
 * to `$STATE_DIR/operators/<id>/agents/<agentId>/sessions/sessions.json`.
 * Marketplace bot sessions are often still only in the unscoped store
 * `$STATE_DIR/agents/<agentId>/sessions/sessions.json`. When the operator store
 * misses a key that the shared store has, copy that entry (and a transcript
 * that stays inside the shared sessions dir) into the operator store.
 *
 * The shared read is allowlisted to that unscoped path. `operators/<other>/`
 * is never opened.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  assertSessionStorePathReadable,
  resolveActiveOperatorId,
} from "../config/operator-state-scope.js";
import {
  isInsideSharedAgentSessionsDir,
  isValidSessionId,
  resolveSharedAgentSessionsDir,
  resolveSharedSessionStorePath,
} from "../config/sessions/paths.js";
import {
  loadSharedCanonicalSessionStore,
  resolveSessionStoreEntry,
  updateSessionStore,
} from "../config/sessions/store.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { DEFAULT_AGENT_ID, normalizeAgentId } from "../routing/session-key.js";
import { parseAgentSessionKey } from "../sessions/session-key-utils.js";
import { loadSessionEntry } from "./session-utils.js";

const log = createSubsystemLogger("gateway/session-heal");

export type OperatorSessionHealOwnership = {
  ownerTenantId?: string;
  ownerUserId?: string;
  ownerBotId?: string;
};

function isGroupPublicSessionKey(sessionKey: string): boolean {
  return sessionKey.trim().toLowerCase().startsWith("space:");
}

function agentIdFromSessionStorePath(storePath: string | undefined): string | undefined {
  const trimmed = storePath?.trim();
  if (!trimmed) {
    return undefined;
  }
  const parts = path.resolve(trimmed).split(path.sep);
  const sessionsIdx = parts.lastIndexOf("sessions");
  if (sessionsIdx < 2 || parts[sessionsIdx - 2] !== "agents") {
    return undefined;
  }
  const agentId = parts[sessionsIdx - 1]?.trim();
  return agentId || undefined;
}

export function resolveSharedHealAgentId(sessionKey: string, storePath?: string): string {
  const parsed = parseAgentSessionKey(sessionKey);
  if (parsed?.agentId) {
    return normalizeAgentId(parsed.agentId);
  }
  const fromPath = agentIdFromSessionStorePath(storePath);
  if (fromPath) {
    return normalizeAgentId(fromPath);
  }
  return DEFAULT_AGENT_ID;
}

export function sharedCanonicalStoreHasSessionKey(sessionKey: string, storePath?: string): boolean {
  try {
    const agentId = resolveSharedHealAgentId(sessionKey, storePath);
    const store = loadSharedCanonicalSessionStore(agentId);
    const resolved = resolveSessionStoreEntry({ store, sessionKey });
    return Boolean(resolved.existing?.sessionId && isValidSessionId(resolved.existing.sessionId));
  } catch {
    return false;
  }
}

/** Operator-visible miss detail: which store was checked, and whether shared has the key. */
export function formatClientSessionNotFoundDetail(params: {
  sessionKey: string;
  storePath?: string;
}): string {
  const storePath = params.storePath?.trim() || "(unset)";
  const sharedHasKey = sharedCanonicalStoreHasSessionKey(params.sessionKey, storePath);
  return `session not found (storePath=${storePath}, sharedHasKey=${sharedHasKey})`;
}

async function resolveSafeSharedTranscript(params: {
  agentId: string;
  sessionId: string;
  sessionFile?: string;
}): Promise<string | undefined> {
  const sessionsDir = resolveSharedAgentSessionsDir(params.agentId);
  const candidates: string[] = [];
  const explicit = params.sessionFile?.trim();
  if (explicit) {
    candidates.push(path.isAbsolute(explicit) ? explicit : path.resolve(sessionsDir, explicit));
  }
  candidates.push(path.join(sessionsDir, `${params.sessionId}.jsonl`));
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    let real: string;
    try {
      const st = await fs.stat(resolved);
      if (!st.isFile() || st.size <= 0) {
        continue;
      }
      real = await fs.realpath(resolved);
    } catch {
      continue;
    }
    if (!isInsideSharedAgentSessionsDir(real, params.agentId)) {
      continue;
    }
    return real;
  }
  return undefined;
}

/**
 * Copy a missing operator-store key from the shared canonical store.
 * No-op when operator scope is off, the key already exists, or shared has no
 * safe entry. Never reads another operator's store.
 */
export async function healOperatorSessionEntryFromSharedStore(params: {
  sessionKey: string;
  resolveAgentStorePath: (agentId: string) => string;
  ownership?: OperatorSessionHealOwnership;
}): Promise<void> {
  if (isGroupPublicSessionKey(params.sessionKey)) {
    return;
  }
  if (!resolveActiveOperatorId()) {
    return;
  }
  const operatorLoaded = loadSessionEntry(params.sessionKey, {
    resolveAgentStorePath: params.resolveAgentStorePath,
  });
  if (operatorLoaded.entry?.sessionId) {
    return;
  }
  const agentId = resolveSharedHealAgentId(
    operatorLoaded.canonicalKey || params.sessionKey,
    operatorLoaded.storePath,
  );
  const operatorStorePath = operatorLoaded.storePath;
  const sharedStorePath = resolveSharedSessionStorePath(agentId);
  if (path.resolve(operatorStorePath) === path.resolve(sharedStorePath)) {
    return;
  }
  // Write target must stay inside the active operator root.
  assertSessionStorePathReadable(operatorStorePath);

  const sharedStore = loadSharedCanonicalSessionStore(agentId);
  const sharedResolved = resolveSessionStoreEntry({
    store: sharedStore,
    sessionKey: operatorLoaded.canonicalKey || params.sessionKey,
  });
  const sharedEntry = sharedResolved.existing;
  if (!sharedEntry?.sessionId || !isValidSessionId(sharedEntry.sessionId)) {
    return;
  }

  const operatorSessionsDir = path.dirname(operatorStorePath);
  const destFile = path.join(operatorSessionsDir, `${sharedEntry.sessionId}.jsonl`);
  assertSessionStorePathReadable(destFile);

  const safeSource = await resolveSafeSharedTranscript({
    agentId,
    sessionId: sharedEntry.sessionId,
    sessionFile: sharedEntry.sessionFile,
  });
  await fs.mkdir(operatorSessionsDir, { recursive: true });
  if (safeSource && path.resolve(safeSource) !== path.resolve(destFile)) {
    await fs.copyFile(safeSource, destFile);
  }

  const canonicalKey =
    sharedResolved.normalizedKey || operatorLoaded.canonicalKey || params.sessionKey;
  const ownership = params.ownership ?? {};
  await updateSessionStore(operatorStorePath, (store) => {
    const current = resolveSessionStoreEntry({ store, sessionKey: canonicalKey });
    if (current.existing?.sessionId) {
      return;
    }
    // SessionEntry does not declare owner* fields. Persist them the same way
    // session-store-migrate does: spread onto the entry, then cast. The
    // fields survive JSON store writes.
    store[current.normalizedKey || canonicalKey] = {
      ...sharedEntry,
      sessionFile: destFile,
      updatedAt: Math.max(
        typeof sharedEntry.updatedAt === "number" ? sharedEntry.updatedAt : 0,
        Date.now(),
      ),
      ...(ownership.ownerTenantId ? { ownerTenantId: ownership.ownerTenantId } : {}),
      ...(ownership.ownerUserId ? { ownerUserId: ownership.ownerUserId } : {}),
      ...(ownership.ownerBotId ? { ownerBotId: ownership.ownerBotId } : {}),
    } as typeof sharedEntry;
  });
  log.info(
    `healed operator session from shared store agent=${agentId} key=${canonicalKey} copiedTranscript=${Boolean(safeSource)}`,
  );
}
