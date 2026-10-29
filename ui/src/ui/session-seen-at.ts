import {
  canonicalizeWorkbenchChatSessionKey,
  isCollaborationGroupChatSessionKey,
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
  /**
   * Optional trusted tenant id. When present, collaboration-space cursors are
   * partitioned by tenant+user so two tenants that reuse a local groupId string
   * cannot inherit each other's seenAt in the same browser profile.
   */
  tenantId?: string | null;
};

/** Flat-map prefix for identity-scoped collaboration-space cursors. */
const SEEN_PARTITION_PREFIX = "seen:";

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
 * Trusted identity partition for unscoped keys such as `space:<id>`.
 * Returns null when the own steward is unknown (cannot safely scope).
 */
export function resolveSessionSeenPartitionId(options?: SessionSeenAliasOptions): string | null {
  const own = options?.ownStewardSessionKey?.trim() || "";
  const owner = extractEmployeeStewardOwnerFromSessionKey(own);
  if (!owner) {
    return null;
  }
  const tenant = options?.tenantId?.trim() || "";
  return tenant ? `t:${tenant}|u:${owner}` : `u:${owner}`;
}

export function partitionSessionSeenKey(partitionId: string, sessionKey: string): string {
  return `${SEEN_PARTITION_PREFIX}${partitionId}:${sessionKey}`;
}

function isPartitionedSessionSeenKey(key: string): boolean {
  return key.startsWith(SEEN_PARTITION_PREFIX);
}

/** Extract `space:<id>` (or null) from a bare / mirror / already-partitioned key. */
function collaborationSpaceCursorKey(sessionKey: string): string | null {
  const raw = sessionKey.trim();
  if (!raw) {
    return null;
  }
  // Strip our partition wrapper if present: seen:<partition>:space:<id>
  let candidate = raw;
  if (isPartitionedSessionSeenKey(raw)) {
    const body = raw.slice(SEEN_PARTITION_PREFIX.length);
    const spaceIdx = body.toLowerCase().indexOf(":space:");
    if (spaceIdx >= 0) {
      candidate = body.slice(spaceIdx + 1); // "space:<id>"
    } else if (body.toLowerCase().includes("space:")) {
      const at = body.toLowerCase().indexOf("space:");
      candidate = body.slice(at);
    } else {
      return null;
    }
  }
  if (!isCollaborationGroupChatSessionKey(candidate)) {
    return null;
  }
  const spaceId = candidate.toLowerCase().startsWith("space:")
    ? candidate.slice("space:".length)
    : candidate.match(/:space:([^:]+)/i)?.[1];
  return toCollaborationSpaceSessionKey(spaceId) || null;
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
 * - Collaboration `space:<id>` cursors are written/read under an identity
 *   partition (`seen:<user|tenant+user>:space:<id>`) whenever the trusted own
 *   steward is known, so account switch / cross-tenant reuse cannot inherit.
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
  const spaceCursor = collaborationSpaceCursorKey(raw);
  const partitionId = resolveSessionSeenPartitionId(options);

  // Space keys are identity-scoped when we know the trusted user. Do not also
  // add the bare `space:<id>` alias in that case — that is the cross-user leak.
  if (spaceCursor && partitionId) {
    aliases.add(partitionSessionSeenKey(partitionId, spaceCursor));
    return [...aliases];
  }

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

  if (spaceCursor) {
    // Trusted identity unknown — legacy unpartitioned write/read (tests +
    // pre-hello). Scrub drops these as soon as an own steward is known.
    aliases.add(spaceCursor);
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
 * Drop shared steward aliases, foreign employee steward cursors, and every
 * previous-identity unpartitioned (or foreign-partition) collaboration-space
 * cursor so an account switch cannot inherit the previous user's read state.
 * Call when the trusted own steward identity becomes known / changes.
 */
export function scrubSessionSeenAtForOwnSteward(
  sessionSeenAt: Record<string, number>,
  ownStewardSessionKey: string | null | undefined,
  options?: { tenantId?: string | null },
): Record<string, number> {
  const own = ownStewardSessionKey?.trim() || "";
  const ownOwner = extractEmployeeStewardOwnerFromSessionKey(own);
  if (!ownOwner) {
    return sessionSeenAt;
  }
  const partitionId = resolveSessionSeenPartitionId({
    ownStewardSessionKey: own,
    tenantId: options?.tenantId,
  });
  const ownPartitionPrefix = partitionId ? `${SEEN_PARTITION_PREFIX}${partitionId}:` : null;

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
    // Unpartitioned space cursors (and foreign partitions) are previous-identity
    // leftovers in the same browser settings key — never keep them for the new
    // trusted user/tenant.
    if (isPartitionedSessionSeenKey(key)) {
      if (!ownPartitionPrefix || !key.startsWith(ownPartitionPrefix)) {
        mutated = true;
        continue;
      }
      next[key] = value;
      continue;
    }
    if (collaborationSpaceCursorKey(key)) {
      mutated = true;
      continue;
    }
    next[key] = value;
  }
  return mutated ? next : sessionSeenAt;
}
