// Helpers for resolving media-cleanup TTL from gateway config.
// Extracted from server.impl.ts to keep the composition root focused on
// orchestration rather than tiny numeric clamps.

const MAX_MEDIA_TTL_HOURS = 24 * 7;

/**
 * Convert a `media.ttlHours` value into a finite millisecond duration.
 *
 * Values are clamped to `[1, MAX_MEDIA_TTL_HOURS]`. Throws when the
 * resulting product is not a safe integer (defensive guard against
 * extreme/NaN inputs that could survive the clamp).
 */
export function resolveMediaCleanupTtlMs(ttlHoursRaw: number): number {
  const ttlHours = Math.min(Math.max(ttlHoursRaw, 1), MAX_MEDIA_TTL_HOURS);
  const ttlMs = ttlHours * 60 * 60_000;
  if (!Number.isFinite(ttlMs) || !Number.isSafeInteger(ttlMs)) {
    throw new Error(`Invalid media.ttlHours: ${String(ttlHoursRaw)}`);
  }
  return ttlMs;
}

export { MAX_MEDIA_TTL_HOURS };
