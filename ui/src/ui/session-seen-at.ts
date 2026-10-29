import {
  canonicalizeWorkbenchChatSessionKey,
  toCollaborationSpaceSessionKey,
} from "../../../src/sessions/session-key-utils.ts";
import {
  extractEmployeeStewardOwnerFromSessionKey,
  isGlobalStewardSessionAlias,
} from "./chat-session-key-match.ts";

/**
 * Alias scope for unread cursors. Mirrors chat-session-key-match:
 * bare `main` may expand to the **current** employee's steward key only.
 */
export type SessionSeenAliasOptions = {
  /**
   * Canonical steward session for the logged-in employee
   * (`hello.snapshot.sessionDefaults.mainSessionKey`).
   */
  ownStewardSessionKey?: string | null;
};

function addKey(aliases: Set<string>, key: string | null | undefined) {
  const raw = typeof key === "string" ? key.trim() : "";
  if (!raw) {
    return;
  }
  aliases.add(raw);
  const canonical = canonicalizeWorkbenchChatSessionKey(raw);
  if (canonical) {
    aliases.add(canonical);
  }
}

/**
 * Keys that must share one unread cursor for the same chat surface.
 *
 * Gateway remaps 大白管家 to `agent:main:employee:<id>` while the UI often
 * persists `sessionSeenAt` under `main` / `agent:main:main`. Collaboration
 * clicks persist `space:<id>` while `sessions.list` rows stay on
 * `agent:…:space:<id>`. Exact-key lookup then resurrects badges after refresh.
 *
 * Identity scope (hard rule):
 * - Different `employee:<owner>` keys never share a cursor.
 * - Shared `main` / `agent:main` / `agent:main:main` link **only** to
 *   {@link SessionSeenAliasOptions.ownStewardSessionKey} (current trusted user).
 * - An employee steward key never reads/writes shared `main` unless that
 *   employee **is** the trusted current user (via the main→own expansion above).
 *   Otherwise u1's read — or a prior account's leftover `main` cursor — would
 *   wipe u2's unread after an account switch.
 */
export function sessionSeenAliasKeys(
  sessionKey: string,
  options?: SessionSeenAliasOptions,
): string[] {
  const raw = sessionKey.trim();
  if (!raw) {
    return [];
  }
  const aliases = new Set<string>();
  addKey(aliases, raw);

  const own = options?.ownStewardSessionKey?.trim() || "";
  const ownOwner = extractEmployeeStewardOwnerFromSessionKey(own);
  const keyOwner = extractEmployeeStewardOwnerFromSessionKey(raw);

  if (isGlobalStewardSessionAlias(raw)) {
    aliases.add("main");
    aliases.add("agent:main");
    aliases.add("agent:main:main");
    // Expand public main only onto the trusted current employee's steward key.
    if (own) {
      addKey(aliases, own);
    }
  } else if (keyOwner) {
    // Same-employee mirrors only — never bridge a (possibly foreign) employee
    // key onto shared main. Cross-user wipe + account-switch inheritance both
    // came from that over-wide link.
    if (own && ownOwner && ownOwner === keyOwner) {
      addKey(aliases, own);
    }
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
  options?: SessionSeenAliasOptions,
): number {
  let seenAt = 0;
  for (const key of sessionSeenAliasKeys(sessionKey, options)) {
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
  options?: SessionSeenAliasOptions,
): Record<string, number> {
  const key = sessionKey.trim();
  if (!key || !Number.isFinite(seenAt)) {
    return sessionSeenAt;
  }
  let mutated = false;
  const next: Record<string, number> = { ...sessionSeenAt };
  for (const alias of sessionSeenAliasKeys(key, options)) {
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
  options?: SessionSeenAliasOptions,
): Record<string, number> {
  let next = sessionSeenAt;
  for (const key of sessionKeys) {
    if (typeof key !== "string" || !key.trim()) {
      continue;
    }
    next = bumpSessionSeenAt(next, key, seenAt, options);
  }
  return next;
}

/**
 * Drop shared steward aliases and foreign employee steward cursors so an
 * account switch cannot inherit the previous user's read state via bare `main`.
 * Call when the trusted own steward identity becomes known / changes.
 */
export function scrubSessionSeenAtForOwnSteward(
  sessionSeenAt: Record<string, number>,
  ownStewardSessionKey: string | null | undefined,
): Record<string, number> {
  const own = ownStewardSessionKey?.trim() || "";
  const ownOwner = extractEmployeeStewardOwnerFromSessionKey(own);
  if (!ownOwner) {
    return sessionSeenAt;
  }
  let mutated = false;
  const next: Record<string, number> = {};
  for (const [key, value] of Object.entries(sessionSeenAt)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    if (isGlobalStewardSessionAlias(key)) {
      // Shared main is ambiguous across accounts — drop; own employee key remains.
      mutated = true;
      continue;
    }
    const keyOwner = extractEmployeeStewardOwnerFromSessionKey(key);
    if (keyOwner && keyOwner !== ownOwner) {
      mutated = true;
      continue;
    }
    next[key] = value;
  }
  return mutated ? next : sessionSeenAt;
}
