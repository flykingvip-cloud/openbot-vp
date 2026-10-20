import {
  canonicalizeWorkbenchChatSessionKey,
  isCronSessionKey,
  isSubagentSessionKey,
  parseAgentSessionKey,
} from "../../../../../src/sessions/session-key-utils.ts";
import { sessionKeysShareChatSurface } from "../../chat-session-key-match.ts";
import { isGroupScopedSessionKey } from "../../collaboration/resolve-group-scope.ts";
import {
  normalizeWorkbenchSessionCacheKey,
  readWorkbenchSessionTranscript,
  writeWorkbenchSessionTranscript,
} from "./workbench-session-transcript-cache.ts";

const PREFETCH_PAGE_LIMIT = 50;
const MAX_PREFETCH_SESSIONS = 8;
const LEGACY_CHAT_HISTORY_INVALID_RE = /invalid chat\.history params/i;
const LEGACY_CHAT_HISTORY_INCLUDE_TOOLS_RE = /unexpected property ['"]includetools['"]/i;

export type WorkbenchTranscriptPrefetchSession = {
  key: string;
  updatedAt?: number | null;
};

export type WorkbenchTranscriptPrefetchClient = {
  request: (method: string, params?: unknown) => Promise<unknown>;
};

type ChatHistoryResponse = {
  messages?: unknown[];
  nextBefore?: string | null;
  hasMore?: boolean;
};

let prefetchGeneration = 0;
let legacyChatHistoryIncludeToolsUnsupported = false;

export function cancelWorkbenchTranscriptPrefetch(): void {
  prefetchGeneration += 1;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return typeof err === "string" ? err : "";
}

function isLegacyChatHistoryIncludeToolsUnsupportedError(err: unknown): boolean {
  const message = toErrorMessage(err);
  return (
    LEGACY_CHAT_HISTORY_INVALID_RE.test(message) &&
    LEGACY_CHAT_HISTORY_INCLUDE_TOOLS_RE.test(message)
  );
}

export function isWorkbenchNavPrefetchKey(sessionKey: string | null | undefined): boolean {
  const key = sessionKey?.trim() ?? "";
  if (!key || isCronSessionKey(key) || isSubagentSessionKey(key)) {
    return false;
  }
  if (isGroupScopedSessionKey(key)) {
    return true;
  }
  if (key.toLowerCase() === "main") {
    return true;
  }
  const parsed = parseAgentSessionKey(key);
  return parsed?.rest.toLowerCase() === "main";
}

export function listWorkbenchTranscriptPrefetchKeys(
  sessions: WorkbenchTranscriptPrefetchSession[],
  currentSessionKey: string,
): string[] {
  const ranked = sessions
    .filter((row) => isWorkbenchNavPrefetchKey(row.key))
    .filter((row) => !sessionKeysShareChatSurface(row.key, currentSessionKey))
    .toSorted((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of ranked) {
    const normalized = normalizeWorkbenchSessionCacheKey(row.key);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    if (readWorkbenchSessionTranscript(row.key)) {
      seen.add(normalized);
      continue;
    }
    seen.add(normalized);
    keys.push(canonicalizeWorkbenchChatSessionKey(row.key));
    if (keys.length >= MAX_PREFETCH_SESSIONS) {
      break;
    }
  }
  return keys;
}

async function requestPrefetchHistory(
  client: WorkbenchTranscriptPrefetchClient,
  sessionKey: string,
): Promise<ChatHistoryResponse> {
  const baseParams: Record<string, unknown> = {
    sessionKey,
    limit: PREFETCH_PAGE_LIMIT,
  };
  const primaryParams = legacyChatHistoryIncludeToolsUnsupported
    ? baseParams
    : { ...baseParams, includeTools: false };
  try {
    return (await client.request("chat.history", primaryParams)) as ChatHistoryResponse;
  } catch (err) {
    if (
      !legacyChatHistoryIncludeToolsUnsupported &&
      isLegacyChatHistoryIncludeToolsUnsupportedError(err)
    ) {
      legacyChatHistoryIncludeToolsUnsupported = true;
      return (await client.request("chat.history", baseParams)) as ChatHistoryResponse;
    }
    throw err;
  }
}

export async function prefetchWorkbenchSessionTranscripts(params: {
  client: WorkbenchTranscriptPrefetchClient | null | undefined;
  connected: boolean;
  sessions: WorkbenchTranscriptPrefetchSession[];
  currentSessionKey: string;
}): Promise<void> {
  if (!params.connected || typeof params.client?.request !== "function") {
    return;
  }
  const generation = prefetchGeneration;
  const keys = listWorkbenchTranscriptPrefetchKeys(params.sessions, params.currentSessionKey);
  for (const sessionKey of keys) {
    if (generation !== prefetchGeneration) {
      return;
    }
    try {
      const res = await requestPrefetchHistory(params.client, sessionKey);
      if (generation !== prefetchGeneration) {
        return;
      }
      const messages = Array.isArray(res.messages) ? res.messages : [];
      writeWorkbenchSessionTranscript(sessionKey, {
        messages,
        chatHistoryNextBefore:
          typeof res.nextBefore === "string" && res.nextBefore.trim() ? res.nextBefore : null,
        chatHistoryHasMore: Boolean(res.hasMore),
      });
    } catch {
      // Prefetch is best-effort occupancy; a failed neighbor must not stall the open thread.
    }
  }
}
