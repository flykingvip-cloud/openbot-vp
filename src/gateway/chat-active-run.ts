import { stripAssistantScratchpadFromText } from "../shared/text/assistant-scratchpad.js";
import type { ChatAbortControllerEntry } from "./chat-abort.js";

/**
 * Live chat occupancy for a session, independent of which WebSocket accepted
 * the original `chat.send`. Control UI reconnects discover this via
 * `chat.history` and re-attach tool events to the new connId.
 */
export type ActiveChatRunSnapshot = {
  runId: string;
  /** Buffered user-visible assistant text. Empty while the run has not streamed yet. */
  text: string;
};

export type ActiveChatRunController = Pick<
  ChatAbortControllerEntry,
  "sessionKey" | "startedAtMs"
> & {
  controller?: { signal?: { aborted?: boolean } };
};

function normalizedSessionKeys(sessionKeys: Iterable<string>): Set<string> {
  const keys = new Set<string>();
  for (const key of sessionKeys) {
    const trimmed = key.trim();
    if (trimmed) {
      keys.add(trimmed);
    }
  }
  return keys;
}

function isAborted(entry: ActiveChatRunController): boolean {
  return entry.controller?.signal?.aborted === true;
}

function listMatchingRuns(
  sessionKeys: Iterable<string>,
  chatAbortControllers: ReadonlyMap<string, ActiveChatRunController>,
): Array<[string, ActiveChatRunController]> {
  const keys = normalizedSessionKeys(sessionKeys);
  if (keys.size === 0) {
    return [];
  }
  const matches: Array<[string, ActiveChatRunController]> = [];
  for (const [runId, entry] of chatAbortControllers) {
    const sessionKey = entry.sessionKey.trim();
    if (!sessionKey || !keys.has(sessionKey) || isAborted(entry)) {
      continue;
    }
    matches.push([runId, entry]);
  }
  return matches;
}

function byNewestStart(
  left: [string, ActiveChatRunController],
  right: [string, ActiveChatRunController],
): number {
  return right[1].startedAtMs - left[1].startedAtMs;
}

/**
 * Parent collaboration runs are the client idempotency key. Child bot turns
 * use `${parent}:${agentId}` and must not become the stop-button run id.
 */
function choosePrimaryRun(
  matches: Array<[string, ActiveChatRunController]>,
): [string, ActiveChatRunController] | undefined {
  if (matches.length === 0) {
    return undefined;
  }
  const ids = new Set(matches.map(([runId]) => runId));
  const parents = matches.filter(([runId]) => {
    const prefix = `${runId}:`;
    for (const other of ids) {
      if (other !== runId && other.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  });
  const pool = parents.length > 0 ? parents : matches;
  return pool.toSorted(byNewestStart)[0];
}

function bufferedTextForRun(
  runId: string,
  matches: Array<[string, ActiveChatRunController]>,
  chatRunBuffers: ReadonlyMap<string, string> | null | undefined,
): string {
  if (!chatRunBuffers) {
    return "";
  }
  const own = chatRunBuffers.get(runId) ?? "";
  if (own.trim()) {
    return own;
  }
  const prefix = `${runId}:`;
  const children = matches
    .filter(([childId]) => childId.startsWith(prefix))
    .toSorted(byNewestStart);
  for (const [childId] of children) {
    const text = chatRunBuffers.get(childId) ?? "";
    if (text.trim()) {
      return text;
    }
  }
  return own;
}

export function listActiveSessionChatRunIds(params: {
  sessionKeys: Iterable<string>;
  chatAbortControllers: ReadonlyMap<string, ActiveChatRunController>;
}): string[] {
  return listMatchingRuns(params.sessionKeys, params.chatAbortControllers).map(([runId]) => runId);
}

export function resolveActiveSessionChatRun(params: {
  sessionKeys: Iterable<string>;
  chatAbortControllers: ReadonlyMap<string, ActiveChatRunController>;
  chatRunBuffers?: ReadonlyMap<string, string> | null;
}): ActiveChatRunSnapshot | null {
  const matches = listMatchingRuns(params.sessionKeys, params.chatAbortControllers);
  const primary = choosePrimaryRun(matches);
  if (!primary) {
    return null;
  }
  const [runId] = primary;
  return {
    runId,
    text: stripAssistantScratchpadFromText(
      bufferedTextForRun(runId, matches, params.chatRunBuffers),
    ).trim(),
  };
}
