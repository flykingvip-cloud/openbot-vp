/**
 * Process-local user online presence (WS connection ref-count).
 *
 * Distinct from system-presence (device/instance keyed) and organization
 * agent presence.json. Keys are normalized platform emails and/or user ids so
 * collaboration member snapshots can resolve human online state.
 */

export type UserPresenceRecord = {
  connectionCount: number;
  lastActiveAtMs: number;
};

export type UserPresenceSnapshot = {
  online: boolean;
  lastActiveAtMs?: number;
};

export type UserPresenceIdentity = {
  userId?: string | null;
  userEmail?: string | null;
};

const byKey = new Map<string, UserPresenceRecord>();

function normalizeIdentity(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function collectKeys(identity: UserPresenceIdentity): string[] {
  const keys = new Set<string>();
  const userId = normalizeIdentity(identity.userId);
  const userEmail = normalizeIdentity(identity.userEmail);
  if (userId) {
    keys.add(userId);
  }
  if (userEmail) {
    keys.add(userEmail);
  }
  return [...keys];
}

function touchRecord(nowMs: number): UserPresenceRecord {
  return { connectionCount: 1, lastActiveAtMs: nowMs };
}

/** Test helper — clears all tracked users. */
export function resetUserPresenceForTests(): void {
  byKey.clear();
}

/**
 * Record an authenticated WS connect (or another live session) for a user.
 * Multiple connections for the same identity share one ref-count.
 */
export function touchUserPresenceOnline(identity: UserPresenceIdentity, nowMs = Date.now()): void {
  const keys = collectKeys(identity);
  if (keys.length === 0) {
    return;
  }
  // Prefer an existing shared record so email + userId stay aliased.
  let record: UserPresenceRecord | undefined;
  for (const key of keys) {
    const existing = byKey.get(key);
    if (existing) {
      record = existing;
      break;
    }
  }
  if (!record) {
    record = touchRecord(nowMs);
  } else {
    record.connectionCount += 1;
    record.lastActiveAtMs = nowMs;
  }
  for (const key of keys) {
    byKey.set(key, record);
  }
}

/**
 * Release one WS connection for a user. When the count hits zero the user is
 * offline but lastActiveAtMs is retained until process restart.
 */
export function releaseUserPresence(identity: UserPresenceIdentity, nowMs = Date.now()): void {
  const keys = collectKeys(identity);
  if (keys.length === 0) {
    return;
  }
  let record: UserPresenceRecord | undefined;
  for (const key of keys) {
    const existing = byKey.get(key);
    if (existing) {
      record = existing;
      break;
    }
  }
  if (!record) {
    return;
  }
  record.connectionCount = Math.max(0, record.connectionCount - 1);
  record.lastActiveAtMs = nowMs;
  for (const key of keys) {
    byKey.set(key, record);
  }
}

export function resolveUserPresence(
  identities: Array<string | null | undefined>,
): UserPresenceSnapshot {
  const keys = [
    ...new Set(
      identities
        .map((value) => normalizeIdentity(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  let best: UserPresenceRecord | undefined;
  for (const key of keys) {
    const record = byKey.get(key);
    if (!record) {
      continue;
    }
    if (
      !best ||
      record.lastActiveAtMs > best.lastActiveAtMs ||
      record.connectionCount > best.connectionCount
    ) {
      best = record;
    }
  }
  if (!best) {
    return { online: false };
  }
  return {
    online: best.connectionCount > 0,
    lastActiveAtMs: best.lastActiveAtMs,
  };
}

export function listUserPresence(): Array<{ key: string } & UserPresenceSnapshot> {
  const seen = new Set<UserPresenceRecord>();
  const out: Array<{ key: string } & UserPresenceSnapshot> = [];
  for (const [key, record] of byKey) {
    if (seen.has(record)) {
      continue;
    }
    seen.add(record);
    out.push({
      key,
      online: record.connectionCount > 0,
      lastActiveAtMs: record.lastActiveAtMs,
    });
  }
  return out.toSorted((left, right) => (right.lastActiveAtMs ?? 0) - (left.lastActiveAtMs ?? 0));
}
