/**
 * Create runtime session store entry + empty JSONL transcript header for a Conversation.
 * Transcript remains the message source of truth.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import type { OpenBotConfig } from "../config/config.js";
import { resolveSessionFilePath, resolveSessionFilePathOptions } from "../config/sessions/paths.js";
import { loadSessionStore, updateSessionStore } from "../config/sessions/store.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { toCollaborationSpaceSessionKey } from "../sessions/session-key-utils.js";
import type { ConversationSurfaceType } from "./types.js";

export function buildConversationSessionKey(params: {
  surfaceType: ConversationSurfaceType;
  agentId: string | null;
  groupId: string | null;
  conversationId: string;
}): string {
  const conv = params.conversationId.trim().toLowerCase();
  if (params.surfaceType === "COLLABORATION_GROUP" && params.groupId) {
    const groupKey = toCollaborationSpaceSessionKey(params.groupId).toLowerCase();
    return `${groupKey}:conversation:${conv}`;
  }
  const agentId = normalizeAgentId(params.agentId ?? "main");
  return `agent:${agentId}:conversation:${conv}`;
}

export async function createRuntimeSessionForConversation(params: {
  cfg: OpenBotConfig;
  agentId: string;
  sessionKey: string;
  sessionId?: string;
  label?: string;
  storePath: string;
}): Promise<{ sessionId: string; sessionKey: string; sessionFile: string }> {
  const sessionId = (params.sessionId ?? randomUUID()).trim();
  const storePath = params.storePath;
  const pathOpts = resolveSessionFilePathOptions({
    agentId: params.agentId,
    storePath,
  });
  const sessionFile = resolveSessionFilePath(sessionId, undefined, pathOpts);

  await fs.mkdir(path.dirname(sessionFile), { recursive: true });
  try {
    await fs.access(sessionFile);
  } catch {
    const header = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: sessionId,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    };
    await fs.writeFile(sessionFile, `${JSON.stringify(header)}\n`, "utf-8");
  }

  const entry: SessionEntry = {
    sessionId,
    updatedAt: Date.now(),
    sessionFile,
    label: params.label,
  };

  await updateSessionStore(storePath, (store) => {
    store[params.sessionKey] = {
      ...store[params.sessionKey],
      ...entry,
    };
  });

  return { sessionId, sessionKey: params.sessionKey, sessionFile };
}

export async function loadRuntimeSessionEntry(params: {
  storePath: string;
  sessionKey: string;
}): Promise<SessionEntry | null> {
  try {
    const store = loadSessionStore(params.storePath);
    return store[params.sessionKey] ?? null;
  } catch {
    return null;
  }
}

export function resolveAgentStorePathFromSessionsDir(sessionsDir: string): string {
  return path.join(sessionsDir, "sessions.json");
}
