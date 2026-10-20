/**
 * Persists "暂不处理" dismissals for system asset-suggestion prompts so the
 * organize-draft flow does not keep auto-surfacing for the same context/session.
 */

const STORAGE_KEY = "openbot.asset-incubation.suggestion-dismiss.v1";
/** Default snooze: 24 hours */
export const ASSET_SUGGESTION_DISMISS_TTL_MS = 24 * 60 * 60 * 1000;

type DismissRecord = {
  key: string;
  dismissedAt: number;
  expiresAt: number;
};

function canUseStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function loadRecords(now = Date.now()): DismissRecord[] {
  if (!canUseStorage()) {
    return [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }
      const record = entry as Record<string, unknown>;
      const key = typeof record.key === "string" ? record.key.trim() : "";
      const dismissedAt =
        typeof record.dismissedAt === "number" && Number.isFinite(record.dismissedAt)
          ? record.dismissedAt
          : 0;
      const expiresAt =
        typeof record.expiresAt === "number" && Number.isFinite(record.expiresAt)
          ? record.expiresAt
          : dismissedAt + ASSET_SUGGESTION_DISMISS_TTL_MS;
      if (!key || expiresAt <= now) {
        return [];
      }
      return [{ key, dismissedAt, expiresAt } satisfies DismissRecord];
    });
  } catch {
    return [];
  }
}

function saveRecords(records: DismissRecord[]): void {
  if (!canUseStorage()) {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-200)));
  } catch {
    // best-effort
  }
}

function normalizeDismissKey(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Build stable keys used to suppress auto asset-organize for a context/session. */
export function buildAssetSuggestionDismissKeys(params: {
  contextId?: string | null;
  sessionKey?: string | null;
}): string[] {
  const keys = new Set<string>();
  const contextId = normalizeDismissKey(params.contextId);
  const sessionKey = normalizeDismissKey(params.sessionKey);
  if (contextId) {
    keys.add(`context:${contextId}`);
  }
  if (sessionKey) {
    keys.add(`session:${sessionKey}`);
  }
  return [...keys];
}

export function dismissAssetSuggestion(params: {
  contextId?: string | null;
  sessionKey?: string | null;
  ttlMs?: number;
  now?: number;
}): void {
  const now = params.now ?? Date.now();
  const ttlMs =
    typeof params.ttlMs === "number" && Number.isFinite(params.ttlMs) && params.ttlMs > 0
      ? params.ttlMs
      : ASSET_SUGGESTION_DISMISS_TTL_MS;
  const keys = buildAssetSuggestionDismissKeys(params);
  if (keys.length === 0) {
    return;
  }
  const expiresAt = now + ttlMs;
  const existing = loadRecords(now).filter((entry) => !keys.includes(entry.key));
  for (const key of keys) {
    existing.push({ key, dismissedAt: now, expiresAt });
  }
  saveRecords(existing);
}

export function isAssetSuggestionDismissed(params: {
  contextId?: string | null;
  sessionKey?: string | null;
  now?: number;
}): boolean {
  const now = params.now ?? Date.now();
  const keys = buildAssetSuggestionDismissKeys(params);
  if (keys.length === 0) {
    return false;
  }
  const dismissed = new Set(loadRecords(now).map((entry) => entry.key));
  return keys.some((key) => dismissed.has(key));
}

export function clearAssetSuggestionDismissalsForTests(): void {
  if (!canUseStorage()) {
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
}
