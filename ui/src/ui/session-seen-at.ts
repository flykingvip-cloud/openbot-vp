import {
  canonicalizeWorkbenchChatSessionKey,
  toCollaborationSpaceSessionKey,
} from "../../../src/sessions/session-key-utils.ts";
import {
  extractEmployeeStewardOwnerFromSessionKey,
  isGlobalStewardSessionAlias,
} from "./chat-session-key-match.ts";

/**
 * Keys that must share one unread cursor for the same chat surface.
 *
 * Gateway remaps 大白管家 to `agent:main:employee:<id>` while the UI often
 * persists `sessionSeenAt` under `main` / `agent:main:main`. Collaboration
 * clicks persist `space:<id>` while `sessions.list` rows stay on
 * `agent:…:space:<id>`. Exact-key lookup then resurrects badges after refresh.
 */
export function sessionSeenAliasKeys(sessionKey: string): string[] {
  const raw = sessionKey.trim();
  if (!raw) {
    return [];
  }
  const aliases = new Set<string>([raw]);
  const canonical = canonicalizeWorkbenchChatSessionKey(raw);
  if (canonical) {
    aliases.add(canonical);
  }
  if (isGlobalStewardSessionAlias(raw) || extractEmployeeStewardOwnerFromSessionKey(raw)) {
    aliases.add("main");
    aliases.add("agent:main");
    aliases.add("agent:main:main");
  }
  const spaceId = raw.toLowerCase().startsWith("space:")
    ? raw.slice("space:".length)
    : raw.match(/:space:([^:]+)/i)?.[1];
  const spaceKey = toCollaborationSpaceSessionKey(spaceId);
  if (spaceKey) {
    aliases.add(spaceKey);
  }
  return [...aliases];
}

export function resolveSessionSeenAtMs(
  sessionSeenAt: Record<string, number>,
  sessionKey: string,
): number {
  let seenAt = 0;
  for (const key of sessionSeenAliasKeys(sessionKey)) {
    const value = sessionSeenAt[key];
    if (typeof value === "number" && Number.isFinite(value) && value > seenAt) {
      seenAt = value;
    }
  }
  return seenAt;
}

export function bumpSessionSeenAt(
  sessionSeenAt: Record<string, number>,
  sessionKey: string,
  seenAt: number,
): Record<string, number> {
  const key = sessionKey.trim();
  if (!key || !Number.isFinite(seenAt)) {
    return sessionSeenAt;
  }
  let mutated = false;
  const next: Record<string, number> = { ...sessionSeenAt };
  for (const alias of sessionSeenAliasKeys(key)) {
    if ((next[alias] ?? 0) >= seenAt) {
      continue;
    }
    next[alias] = seenAt;
    mutated = true;
  }
  return mutated ? next : sessionSeenAt;
}

export function bumpSessionSeenAtMany(
  sessionSeenAt: Record<string, number>,
  sessionKeys: readonly string[],
  seenAt: number,
): Record<string, number> {
  let next = sessionSeenAt;
  for (const key of sessionKeys) {
    if (typeof key !== "string" || !key.trim()) {
      continue;
    }
    next = bumpSessionSeenAt(next, key, seenAt);
  }
  return next;
}
