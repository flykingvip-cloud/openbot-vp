import { hashTextSync } from "../../utils/sync-hash.ts";

const EDIT_PATTERN_STORAGE_KEY = "openbot.asset-incubation.edit-patterns.v1";
const MIN_REPEAT_FOR_EVIDENCE = 3;

export type EditPatternRecord = {
  transformId: string;
  repeatCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
};

function hashPart(value: string): string {
  return hashTextSync(value, 10);
}

function isNoiseTransform(before: string, after: string): boolean {
  if (!before || !after || before === after) {
    return true;
  }
  if (before.toLowerCase() === after.toLowerCase()) {
    return true;
  }
  if (Math.abs(before.length - after.length) <= 1) {
    return true;
  }
  return false;
}

/** Stable edit transform signature — ignores capitalization-only churn. */
export function deriveEditTransformSignature(before: string, after: string): string | null {
  const left = before.trim();
  const right = after.trim();
  if (isNoiseTransform(left, right)) {
    return null;
  }
  return `${hashPart(left.slice(0, 80))}->${hashPart(right.slice(0, 80))}`;
}

function canUseStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function loadEditPatterns(): EditPatternRecord[] {
  if (!canUseStorage()) {
    return [];
  }
  try {
    const raw = localStorage.getItem(EDIT_PATTERN_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const record = entry as Record<string, unknown>;
      const transformId = typeof record.transformId === "string" ? record.transformId.trim() : "";
      if (!transformId) {
        return [];
      }
      return [
        {
          transformId,
          repeatCount: typeof record.repeatCount === "number" ? Math.max(1, record.repeatCount) : 1,
          firstSeenAt: typeof record.firstSeenAt === "number" ? record.firstSeenAt : Date.now(),
          lastSeenAt: typeof record.lastSeenAt === "number" ? record.lastSeenAt : Date.now(),
        } satisfies EditPatternRecord,
      ];
    });
  } catch {
    return [];
  }
}

function saveEditPatterns(records: EditPatternRecord[]): void {
  if (!canUseStorage()) {
    return;
  }
  try {
    localStorage.setItem(EDIT_PATTERN_STORAGE_KEY, JSON.stringify(records.slice(-200)));
  } catch {
    // best-effort
  }
}

export function recordLocalEditPattern(
  transformId: string,
  occurredAt = Date.now(),
): EditPatternRecord {
  const normalized = transformId.trim();
  const existing = loadEditPatterns();
  const idx = existing.findIndex((entry) => entry.transformId === normalized);
  if (idx >= 0) {
    const updated: EditPatternRecord = {
      ...existing[idx],
      repeatCount: existing[idx].repeatCount + 1,
      lastSeenAt: occurredAt,
    };
    existing[idx] = updated;
    saveEditPatterns(existing);
    return updated;
  }
  const created: EditPatternRecord = {
    transformId: normalized,
    repeatCount: 1,
    firstSeenAt: occurredAt,
    lastSeenAt: occurredAt,
  };
  saveEditPatterns([...existing, created]);
  return created;
}

export function maxStableEditPatternCount(): number {
  return loadEditPatterns().reduce(
    (max, entry) =>
      Math.max(max, entry.repeatCount >= MIN_REPEAT_FOR_EVIDENCE ? entry.repeatCount : 0),
    0,
  );
}

export function clearEditPatternsForTests(): void {
  if (!canUseStorage()) {
    return;
  }
  localStorage.removeItem(EDIT_PATTERN_STORAGE_KEY);
}

export { MIN_REPEAT_FOR_EVIDENCE };
