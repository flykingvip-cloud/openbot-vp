/**
 * Live elapsed clock for the thinking / reading indicator.
 * English keeps Codex-style "2m50s"; Chinese UI uses 2分50秒.
 * Templates only re-render on state changes, so the host ticks `nowMs`
 * once per second while a turn is in flight.
 */

export function usesChineseThinkingClock(locale?: string | null): boolean {
  return (locale ?? "").toLowerCase().startsWith("zh");
}

export function formatThinkingElapsed(ms: number, locale?: string | null): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (usesChineseThinkingClock(locale)) {
    if (hours > 0) {
      return minutes > 0 ? `${hours}小时${minutes}分` : `${hours}小时`;
    }
    if (minutes > 0) {
      return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分`;
    }
    return `${seconds}秒`;
  }
  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

export function thinkingElapsedMs(
  startedAt: number | null | undefined,
  nowMs: number,
): number | null {
  if (startedAt == null || !Number.isFinite(startedAt) || startedAt <= 0) {
    return null;
  }
  if (!Number.isFinite(nowMs)) {
    return null;
  }
  return Math.max(0, nowMs - startedAt);
}

export function isLiveThinkingClockActive(input: {
  sending: boolean;
  streamStartedAt: number | null;
  stream: string | null;
}): boolean {
  if (!input.sending || input.streamStartedAt == null) {
    return false;
  }
  const deliveryStarted = typeof input.stream === "string" && input.stream.trim().length > 0;
  return !deliveryStarted;
}
