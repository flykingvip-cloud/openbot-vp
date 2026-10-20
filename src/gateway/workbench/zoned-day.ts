/**
 * Resolve the actor-local calendar day bounds for "今日日程".
 * Uses Intl so DST / offset changes are handled without hardcoding UTC offsets.
 */

function formatDayKey(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error(`unable to format day key for timezone ${timeZone}`);
  }
  return `${year}-${month}-${day}`;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Inclusive start / exclusive end of the local calendar day containing `nowMs`
 * in `timeZone`. Falls back to UTC if the timezone label is invalid.
 */
export function resolveZonedDayBounds(
  nowMs: number,
  timeZone: string,
): { startMs: number; endMs: number; timeZone: string } {
  let tz = timeZone.trim() || "UTC";
  try {
    formatDayKey(nowMs, tz);
  } catch {
    tz = "UTC";
  }
  const dayKey = formatDayKey(nowMs, tz);
  let lo = nowMs - 48 * HOUR_MS;
  let hi = nowMs + 48 * HOUR_MS;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (formatDayKey(mid, tz) < dayKey) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const startMs = lo;
  let lo2 = startMs;
  let hi2 = startMs + 48 * HOUR_MS;
  while (lo2 < hi2) {
    const mid = Math.floor((lo2 + hi2) / 2);
    if (formatDayKey(mid, tz) <= dayKey) {
      lo2 = mid + 1;
    } else {
      hi2 = mid;
    }
  }
  return { startMs, endMs: lo2, timeZone: tz };
}

export function isWithinZonedDay(startAtMs: number, nowMs: number, timeZone: string): boolean {
  const { startMs, endMs } = resolveZonedDayBounds(nowMs, timeZone);
  return startAtMs >= startMs && startAtMs < endMs;
}
