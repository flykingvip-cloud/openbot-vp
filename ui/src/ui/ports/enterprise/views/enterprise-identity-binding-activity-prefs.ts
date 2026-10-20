const STORAGE_PREFIX = "openbot.enterprise.identity-binding-activity-seen";

export function bindingActivitySeenStorageKey(tenantId: string): string {
  return `${STORAGE_PREFIX}.${tenantId.trim()}`;
}

export function readBindingActivitySeenAt(tenantId: string | null | undefined): string | null {
  const normalized = tenantId?.trim();
  if (!normalized || typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(bindingActivitySeenStorageKey(normalized));
}

export function writeBindingActivitySeenAt(
  tenantId: string | null | undefined,
  seenAt = new Date().toISOString(),
): string | null {
  const normalized = tenantId?.trim();
  if (!normalized || typeof window === "undefined") {
    return null;
  }
  window.localStorage.setItem(bindingActivitySeenStorageKey(normalized), seenAt);
  return seenAt;
}

export function countUnreadBindingActivity(
  activity: ReadonlyArray<{ createdAt: string }>,
  seenAt: string | null | undefined,
): number {
  const cursor = seenAt?.trim();
  if (!cursor) {
    return activity.length;
  }
  return activity.filter((entry) => entry.createdAt > cursor).length;
}

export function isBindingActivityUnread(
  createdAt: string,
  seenAt: string | null | undefined,
): boolean {
  const cursor = seenAt?.trim();
  if (!cursor) {
    return true;
  }
  return createdAt > cursor;
}
