/**
 * Chat sessionKey equivalence for Control UI event filtering.
 *
 * Gateway remaps builtin steward (大白管家) `main` / `agent:main` /
 * `agent:main:main` to `agent:main:employee:<userId>` for isolation. The UI
 * may still hold a nav alias until hello defaults land — those aliases may
 * expand to the **current user's** steward key only.
 *
 * Cross-user isolation (hard rule): different `employee:<owner>` keys are
 * never equivalent. Collapsing every employee steward key onto
 * `agent:main:main` previously let User B's UI accept User A's live chat
 * events when Gateway broadcast to all WebSocket clients.
 *
 * Cross-bot isolation: different agentIds never share a chat surface.
 */

import {
  canonicalizeWorkbenchChatSessionKey,
  isOrganizationAgentSessionKey,
  parseAgentSessionKey,
  toCollaborationSpaceSessionKey,
} from "../../../src/sessions/session-key-utils.ts";

export { canonicalizeWorkbenchChatSessionKey };

const EMPLOYEE_STEWARD_KEY_RE = /^agent:main:employee:([^:]+)$/i;

export type ChatSessionKeyMatchOptions = {
  /**
   * Canonical steward session for the logged-in employee
   * (`hello.snapshot.sessionDefaults.mainSessionKey`).
   * Required to equate bare `main` with that user's employee key.
   */
  ownStewardSessionKey?: string | null;
};

export function extractEmployeeStewardOwnerFromSessionKey(
  sessionKey: string | null | undefined,
): string | null {
  const raw = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!raw) {
    return null;
  }
  const match = EMPLOYEE_STEWARD_KEY_RE.exec(raw);
  const owner = match?.[1]?.trim().toLowerCase();
  return owner || null;
}

/**
 * True when `sessionKey` is an employee steward key owned by someone other than
 * the caller identified by `ownMainSessionKey` (hello `mainSessionKey`).
 * Non-employee keys (collab spaces, other bots, bare main aliases) are never foreign.
 */
export function isForeignEmployeeStewardSessionKey(
  sessionKey: string | null | undefined,
  ownMainSessionKey: string | null | undefined,
): boolean {
  const ownOwner = extractEmployeeStewardOwnerFromSessionKey(ownMainSessionKey);
  const keyOwner = extractEmployeeStewardOwnerFromSessionKey(sessionKey);
  if (!ownOwner || !keyOwner) {
    return false;
  }
  return ownOwner !== keyOwner;
}

export function isGlobalStewardSessionAlias(sessionKey: string): boolean {
  const lower = sessionKey.trim().toLowerCase();
  return (
    lower === "main" || lower === "global" || lower === "agent:main" || lower === "agent:main:main"
  );
}

export function normalizeChatSessionKeyForMatch(
  sessionKey: string,
  options?: ChatSessionKeyMatchOptions,
): string {
  const raw = sessionKey.trim();
  if (!raw) {
    return "";
  }
  const lower = raw.toLowerCase();
  const own = options?.ownStewardSessionKey?.trim().toLowerCase() ?? "";

  if (isGlobalStewardSessionAlias(raw)) {
    // Expand main aliases to the caller's own steward key when known.
    // Never invent equivalence to an arbitrary employee:* key.
    return own || "agent:main:main";
  }

  // Keep per-user employee steward keys distinct — do not collapse owners.
  return lower;
}

export function areChatSessionKeysEquivalent(
  left: string | null | undefined,
  right: string | null | undefined,
  options?: ChatSessionKeyMatchOptions,
): boolean {
  const a = typeof left === "string" ? left.trim() : "";
  const b = typeof right === "string" ? right.trim() : "";
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  // Different employee owners are never equivalent, even if one side is
  // compared via a main alias (ownStewardSessionKey gates main expansion).
  const ownerA = extractEmployeeStewardOwnerFromSessionKey(a);
  const ownerB = extractEmployeeStewardOwnerFromSessionKey(b);
  if (ownerA && ownerB && ownerA !== ownerB) {
    return false;
  }
  return (
    normalizeChatSessionKeyForMatch(a, options) === normalizeChatSessionKeyForMatch(b, options)
  );
}

/**
 * Stable id for "which bot / which collaboration space owns this key".
 * Conversation child keys collapse to their parent agent surface.
 * All steward employee keys share the steward bot surface (`agent:main`) for
 * nav — event delivery still uses {@link areChatSessionKeysEquivalent}.
 */
export function resolveChatSurfaceId(sessionKey: string | null | undefined): string {
  const raw = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!raw) {
    return "";
  }
  if (isOrganizationAgentSessionKey(raw)) {
    return canonicalizeWorkbenchChatSessionKey(raw).toLowerCase();
  }
  const spaceKey = toCollaborationSpaceSessionKey(
    raw.toLowerCase().startsWith("space:") ? raw : raw.match(/:space:([^:]+)/i)?.[1],
  );
  if (spaceKey) {
    return spaceKey;
  }
  if (isGlobalStewardSessionAlias(raw) || extractEmployeeStewardOwnerFromSessionKey(raw)) {
    return "agent:main";
  }
  const parsed = parseAgentSessionKey(raw);
  if (parsed?.agentId) {
    return `agent:${parsed.agentId}`;
  }
  return raw.toLowerCase();
}

/** True when both keys belong to the same bot or the same collaboration space. */
export function sessionKeysShareChatSurface(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = resolveChatSurfaceId(left);
  const b = resolveChatSurfaceId(right);
  if (!a || !b) {
    return false;
  }
  return a === b;
}

/**
 * Live `chat` event filter. Steward keys stay owner-strict via
 * {@link areChatSessionKeysEquivalent}. Collaboration space aliases
 * (`space:grp-…` vs `agent:bot:main:space:grp-…`) share one thread.
 */
/** URL `session=` wins; leftover `spaceId=` still binds the same `space:<id>` store. */
export function resolveWorkbenchSessionKeyFromUrlSearch(search: string, hash = ""): string | null {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const hashQuery = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(query);
  const hashParams = new URLSearchParams(hashQuery);
  const sessionRaw = (params.get("session") ?? hashParams.get("session"))?.trim() ?? "";
  const spaceIdRaw = (params.get("spaceId") ?? hashParams.get("spaceId"))?.trim() ?? "";
  const raw = sessionRaw || (spaceIdRaw ? toCollaborationSpaceSessionKey(spaceIdRaw) : "");
  if (!raw) {
    return null;
  }
  return canonicalizeWorkbenchChatSessionKey(raw);
}

export function chatEventMatchesOpenSession(
  eventSessionKey: string | null | undefined,
  openSessionKey: string | null | undefined,
  options?: ChatSessionKeyMatchOptions,
): boolean {
  if (areChatSessionKeysEquivalent(eventSessionKey, openSessionKey, options)) {
    return true;
  }
  const surface = resolveChatSurfaceId(eventSessionKey);
  if (!surface.startsWith("space:")) {
    return false;
  }
  return surface === resolveChatSurfaceId(openSessionKey);
}
