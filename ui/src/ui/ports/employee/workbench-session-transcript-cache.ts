import { canonicalizeWorkbenchChatSessionKey } from "../../../../../src/sessions/session-key-utils.ts";
import {
  parseOguiDecisionStatusLookup,
  type OguiDecisionStatusLookup,
} from "../../chat/ogui-form-view.ts";

const MAX_CACHED_SESSIONS = 24;
const MAX_PERSISTED_MESSAGES = 80;
const STORAGE_KEY = "openbot.workbench.transcript-cache.v1";

export type WorkbenchSessionTranscriptCacheEntry = {
  messages: unknown[];
  chatHistoryNextBefore: string | null;
  chatHistoryHasMore: boolean;
  chatRunId?: string | null;
  chatStream?: string | null;
  chatStreamStartedAt?: number | null;
  chatStreamSessionKey?: string | null;
  chatThinkingProgress?: unknown;
  /** Session decisionStatus slice. Absent preserves the previous value. Null clears it. */
  oguiDecisions?: OguiDecisionStatusLookup | null;
};

type PersistedCacheV1 = {
  v: 1;
  order: string[];
  entries: Record<string, WorkbenchSessionTranscriptCacheEntry>;
};

const cache = new Map<string, WorkbenchSessionTranscriptCacheEntry>();
const order: string[] = [];
let hydrated = false;

export function normalizeWorkbenchSessionCacheKey(sessionKey: string | null | undefined): string {
  const raw = sessionKey?.trim() ?? "";
  if (!raw) {
    return "";
  }
  return canonicalizeWorkbenchChatSessionKey(raw);
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof globalThis.localStorage === "undefined") {
      return null;
    }
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function cloneOguiDecisions(
  value: OguiDecisionStatusLookup | null | undefined,
): OguiDecisionStatusLookup | null {
  if (!value) {
    return null;
  }
  const copy: Record<string, OguiDecisionStatusLookup[string]> = {};
  for (const [key, status] of Object.entries(value)) {
    copy[key] = { ...status };
  }
  return copy;
}

function cloneEntry(
  entry: WorkbenchSessionTranscriptCacheEntry,
): WorkbenchSessionTranscriptCacheEntry {
  return {
    messages: entry.messages.slice(),
    chatHistoryNextBefore: entry.chatHistoryNextBefore ?? null,
    chatHistoryHasMore: entry.chatHistoryHasMore ?? false,
    chatRunId: entry.chatRunId ?? null,
    chatStream: entry.chatStream ?? null,
    chatStreamStartedAt: entry.chatStreamStartedAt ?? null,
    chatStreamSessionKey: entry.chatStreamSessionKey ?? null,
    chatThinkingProgress: entry.chatThinkingProgress ?? null,
    ...("oguiDecisions" in entry ? { oguiDecisions: cloneOguiDecisions(entry.oguiDecisions) } : {}),
  };
}

function persistToStorage(): void {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  const keys = [...order];
  const entries: Record<string, WorkbenchSessionTranscriptCacheEntry> = {};
  for (const key of keys) {
    const entry = cache.get(key);
    if (!entry) {
      continue;
    }
    entries[key] = {
      messages: entry.messages.slice(-MAX_PERSISTED_MESSAGES),
      chatHistoryNextBefore: entry.chatHistoryNextBefore ?? null,
      chatHistoryHasMore: entry.chatHistoryHasMore ?? false,
      ...("oguiDecisions" in entry
        ? { oguiDecisions: cloneOguiDecisions(entry.oguiDecisions) }
        : {}),
    };
  }
  while (keys.length > 0) {
    const payload: PersistedCacheV1 = {
      v: 1,
      order: keys,
      entries: Object.fromEntries(keys.map((key) => [key, entries[key]]).filter((row) => row[1])),
    };
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return;
    } catch {
      const dropped = keys.shift();
      if (dropped) {
        delete entries[dropped];
      }
    }
  }
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore quota/security failures; in-memory cache still serves this tab.
  }
}

function hydrateFromStorage(): void {
  if (hydrated) {
    return;
  }
  hydrated = true;
  const raw = getLocalStorage()?.getItem(STORAGE_KEY);
  if (!raw) {
    return;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedCacheV1>;
    if (parsed?.v !== 1 || !Array.isArray(parsed.order) || !parsed.entries) {
      return;
    }
    for (const key of parsed.order) {
      if (typeof key !== "string" || !key) {
        continue;
      }
      const entry = parsed.entries[key];
      if (!entry || !Array.isArray(entry.messages)) {
        continue;
      }
      const hydratedEntry: WorkbenchSessionTranscriptCacheEntry = {
        messages: entry.messages.slice(),
        chatHistoryNextBefore: entry.chatHistoryNextBefore ?? null,
        chatHistoryHasMore: Boolean(entry.chatHistoryHasMore),
      };
      if ("oguiDecisions" in entry) {
        hydratedEntry.oguiDecisions = parseOguiDecisionStatusLookup(entry.oguiDecisions) ?? null;
      }
      cache.set(key, hydratedEntry);
      order.push(key);
    }
    while (order.length > MAX_CACHED_SESSIONS) {
      const evicted = order.shift();
      if (evicted) {
        cache.delete(evicted);
      }
    }
  } catch {
    cache.clear();
    order.length = 0;
  }
}

function touch(sessionKey: string): void {
  const index = order.indexOf(sessionKey);
  if (index >= 0) {
    order.splice(index, 1);
  }
  order.push(sessionKey);
  while (order.length > MAX_CACHED_SESSIONS) {
    const evicted = order.shift();
    if (evicted) {
      cache.delete(evicted);
    }
  }
}

export function readWorkbenchSessionTranscript(
  sessionKey: string | null | undefined,
): WorkbenchSessionTranscriptCacheEntry | null {
  hydrateFromStorage();
  const key = normalizeWorkbenchSessionCacheKey(sessionKey);
  if (!key) {
    return null;
  }
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  touch(key);
  return cloneEntry(entry);
}

export function writeWorkbenchSessionTranscript(
  sessionKey: string | null | undefined,
  transcript: {
    messages: unknown[];
    chatHistoryNextBefore?: string | null;
    chatHistoryHasMore?: boolean;
    chatRunId?: string | null;
    chatStream?: string | null;
    chatStreamStartedAt?: number | null;
    chatStreamSessionKey?: string | null;
    chatThinkingProgress?: unknown;
    oguiDecisions?: OguiDecisionStatusLookup | null;
  },
  options?: { allowEmpty?: boolean },
): void {
  hydrateFromStorage();
  const key = normalizeWorkbenchSessionCacheKey(sessionKey);
  if (!key) {
    return;
  }
  const incoming = Array.isArray(transcript.messages) ? transcript.messages : [];
  const existing = cache.get(key);
  // Never replace a painted transcript with an in-flight empty snapshot.
  // Occupancy (run/stream) may still update so a background turn stays restorable.
  if (incoming.length === 0 && existing && existing.messages.length > 0 && !options?.allowEmpty) {
    cache.set(key, {
      ...existing,
      chatRunId: transcript.chatRunId ?? existing.chatRunId ?? null,
      chatStream: transcript.chatStream ?? existing.chatStream ?? null,
      chatStreamStartedAt: transcript.chatStreamStartedAt ?? existing.chatStreamStartedAt ?? null,
      chatStreamSessionKey:
        transcript.chatStreamSessionKey ?? existing.chatStreamSessionKey ?? null,
      chatThinkingProgress:
        transcript.chatThinkingProgress ?? existing.chatThinkingProgress ?? null,
      ...("oguiDecisions" in transcript
        ? { oguiDecisions: cloneOguiDecisions(transcript.oguiDecisions) }
        : {}),
    });
    touch(key);
    persistToStorage();
    return;
  }
  const next: WorkbenchSessionTranscriptCacheEntry = {
    messages: incoming.slice(),
    chatHistoryNextBefore: transcript.chatHistoryNextBefore ?? null,
    chatHistoryHasMore: transcript.chatHistoryHasMore ?? false,
    chatRunId: transcript.chatRunId ?? null,
    chatStream: transcript.chatStream ?? null,
    chatStreamStartedAt: transcript.chatStreamStartedAt ?? null,
    chatStreamSessionKey: transcript.chatStreamSessionKey ?? null,
    chatThinkingProgress: transcript.chatThinkingProgress ?? null,
  };
  if ("oguiDecisions" in transcript) {
    next.oguiDecisions = cloneOguiDecisions(transcript.oguiDecisions);
  } else if (existing && "oguiDecisions" in existing) {
    next.oguiDecisions = cloneOguiDecisions(existing.oguiDecisions);
  }
  cache.set(key, next);
  touch(key);
  persistToStorage();
}

/** Overwrite the status slice on an existing painted transcript. Does not create rows. */
export function patchWorkbenchSessionOguiDecisions(
  sessionKey: string | null | undefined,
  oguiDecisions: OguiDecisionStatusLookup | null,
): void {
  hydrateFromStorage();
  const key = normalizeWorkbenchSessionCacheKey(sessionKey);
  if (!key) {
    return;
  }
  const existing = cache.get(key);
  if (!existing) {
    return;
  }
  cache.set(key, {
    ...existing,
    oguiDecisions: cloneOguiDecisions(oguiDecisions),
  });
  touch(key);
  persistToStorage();
}

export function resetWorkbenchSessionTranscriptCacheForTests(): void {
  cache.clear();
  order.length = 0;
  hydrated = true;
  try {
    getLocalStorage()?.removeItem(STORAGE_KEY);
  } catch {
    // Tests still need a clean in-memory map even if storage is missing.
  }
}

export function reloadWorkbenchSessionTranscriptCacheFromStorageForTests(): void {
  cache.clear();
  order.length = 0;
  hydrated = false;
  hydrateFromStorage();
}
