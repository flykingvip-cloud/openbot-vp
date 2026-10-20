import { sessionKeysShareChatSurface } from "../chat-session-key-match.ts";

/**
 * Never paint another surface's transcript under the current header.
 * Header / send / identity already key off the selected team; history must
 * match that surface or stay empty.
 */
export function resolveWorkbenchVisibleChatMessages<T>(params: {
  selectedKey?: string | null;
  sessionKey?: string | null;
  messages: T[];
}): T[] {
  const selected = params.selectedKey?.trim() ?? "";
  const sessionKey = params.sessionKey?.trim() ?? "";
  if (selected && sessionKey && !sessionKeysShareChatSurface(selected, sessionKey)) {
    return [];
  }
  return params.messages;
}

/** Identity / stream chrome follow the header when sessionKey is stale. */
export function resolveWorkbenchChatSessionKey(params: {
  selectedKey?: string | null;
  sessionKey?: string | null;
}): string {
  const selected = params.selectedKey?.trim() ?? "";
  const sessionKey = params.sessionKey?.trim() ?? "";
  if (selected && sessionKey && !sessionKeysShareChatSurface(selected, sessionKey)) {
    return selected;
  }
  return sessionKey || selected;
}
