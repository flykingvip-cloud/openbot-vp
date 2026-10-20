/**
 * Minimal Desktop Session RUM (ROADMAP v3 M1b).
 * Sanitize: never emit tokens or full URLs.
 */

export type DesktopRumEventName =
  | "desktop_open"
  | "auth_ready"
  | "preview_open"
  | "stream_attached"
  | "first_frame"
  | "interactive"
  | "stall_suspected"
  | "stall_confirmed"
  | "reconnect_start"
  | "reconnect_success"
  | "reconnect_failed"
  | "session_end";

export type DesktopRumReconnectReason = "network" | "stream" | "credential";

export type DesktopRumFields = {
  sessionId: string;
  /** Stable hash of the platform user id — never the raw id if it looks like email/token. */
  userIdHash: string;
  desktopId: string;
  agentId: string;
  connectionAttempt: number;
  /** Optional timing deltas (ms) relative to desktop_open. */
  ttfpMs?: number;
  ttiMs?: number;
  ttsMs?: number;
  reconnectReason?: DesktopRumReconnectReason;
  phase?: string;
};

export type DesktopRumEvent = {
  name: DesktopRumEventName;
  ts: number;
  fields: DesktopRumFields;
};

export type DesktopRumSink = (event: DesktopRumEvent) => void;

const TOKENISH = /(?:token|access_token|refresh_token|password|grant|authorization)=[^&\s#]+/gi;
const FULL_URL = /https?:\/\/[^\s"'<>]+/gi;

/** Strip secrets and absolute URLs from any string field before emit. */
export function sanitizeRumValue(value: string): string {
  return value
    .replace(TOKENISH, (m) => {
      const eq = m.indexOf("=");
      return eq >= 0 ? `${m.slice(0, eq)}=REDACTED` : "REDACTED";
    })
    .replace(FULL_URL, "[url]")
    .replace(/[a-f0-9]{32,}/gi, (m) => (m.length >= 32 ? "[hash]" : m));
}

export function hashUserId(userId: string): string {
  const raw = userId.trim();
  if (!raw) {
    return "anon";
  }
  // FNV-1a 32-bit — stable, non-reversible enough for RUM grouping.
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `u${(h >>> 0).toString(16).padStart(8, "0")}`;
}

function sanitizeFields(fields: DesktopRumFields): DesktopRumFields {
  return {
    sessionId: sanitizeRumValue(fields.sessionId).slice(0, 128),
    userIdHash: sanitizeRumValue(fields.userIdHash).slice(0, 64),
    desktopId: sanitizeRumValue(fields.desktopId).slice(0, 128),
    agentId: sanitizeRumValue(fields.agentId).slice(0, 128),
    connectionAttempt: Math.max(0, Math.floor(fields.connectionAttempt)),
    ...(fields.ttfpMs != null && Number.isFinite(fields.ttfpMs)
      ? { ttfpMs: Math.max(0, Math.round(fields.ttfpMs)) }
      : {}),
    ...(fields.ttiMs != null && Number.isFinite(fields.ttiMs)
      ? { ttiMs: Math.max(0, Math.round(fields.ttiMs)) }
      : {}),
    ...(fields.ttsMs != null && Number.isFinite(fields.ttsMs)
      ? { ttsMs: Math.max(0, Math.round(fields.ttsMs)) }
      : {}),
    ...(fields.reconnectReason ? { reconnectReason: fields.reconnectReason } : {}),
    ...(fields.phase ? { phase: sanitizeRumValue(fields.phase).slice(0, 64) } : {}),
  };
}

/** Assert sanitized payload never carries token= or absolute http(s) URLs. */
export function rumEventIsSafe(event: DesktopRumEvent): boolean {
  const blob = JSON.stringify(event);
  if (/https?:\/\//i.test(blob)) {
    return false;
  }
  if (/(?:^|[^a-z])token=/i.test(blob)) {
    return false;
  }
  if (/password=/i.test(blob)) {
    return false;
  }
  return true;
}

export type DesktopRumBuffer = {
  readonly events: readonly DesktopRumEvent[];
  emit: (name: DesktopRumEventName, fields: DesktopRumFields, ts?: number) => DesktopRumEvent;
  clear: () => void;
  setSink: (sink: DesktopRumSink | null) => void;
};

export function createDesktopRumBuffer(opts?: {
  sink?: DesktopRumSink | null;
  maxEvents?: number;
}): DesktopRumBuffer {
  const maxEvents = opts?.maxEvents ?? 200;
  const events: DesktopRumEvent[] = [];
  let sink: DesktopRumSink | null = opts?.sink ?? null;

  return {
    get events() {
      return events;
    },
    emit(name, fields, ts = Date.now()) {
      const event: DesktopRumEvent = {
        name,
        ts,
        fields: sanitizeFields(fields),
      };
      if (!rumEventIsSafe(event)) {
        // Drop unsafe payloads rather than leak.
        return event;
      }
      events.push(event);
      if (events.length > maxEvents) {
        events.splice(0, events.length - maxEvents);
      }
      sink?.(event);
      return event;
    },
    clear() {
      events.length = 0;
    },
    setSink(next) {
      sink = next;
    },
  };
}

export type TimingMarks = {
  openedAt: number | null;
  firstFrameAt: number | null;
  interactiveAt: number | null;
  stableStreamAt: number | null;
};

export function computeRumTimings(marks: TimingMarks): {
  ttfpMs?: number;
  ttiMs?: number;
  ttsMs?: number;
} {
  const out: { ttfpMs?: number; ttiMs?: number; ttsMs?: number } = {};
  if (marks.openedAt != null && marks.firstFrameAt != null) {
    out.ttfpMs = Math.max(0, marks.firstFrameAt - marks.openedAt);
  }
  if (marks.openedAt != null && marks.interactiveAt != null) {
    out.ttiMs = Math.max(0, marks.interactiveAt - marks.openedAt);
  }
  if (marks.openedAt != null && marks.stableStreamAt != null) {
    out.ttsMs = Math.max(0, marks.stableStreamAt - marks.openedAt);
  }
  return out;
}

/** Accept / debug rollup — never includes tokens or URLs. */
export type DesktopRumPercentilePair = {
  p50: number | null;
  p95: number | null;
  count: number;
};

export type DesktopRumTimingRollup = {
  sampleEventCount: number;
  sessionOpenCount: number;
  ttfpMs: DesktopRumPercentilePair;
  ttiMs: DesktopRumPercentilePair;
  ttsMs: DesktopRumPercentilePair;
  /** Share of first_frame samples with ttfpMs ≤ 5000. */
  firstFrameWithin5sRate: number | null;
  reconnectSuccessCount: number;
  reconnectFailedCount: number;
  reconnectSuccessRate: number | null;
  /** Share of desktop_open sessions that later recorded ttsMs. */
  stableStreamSuccessRate: number | null;
};

/** Percentile on an already ascending numeric array. p in (0, 100]. */
export function percentileSorted(sortedAsc: readonly number[], p: number): number | null {
  if (!sortedAsc.length || !Number.isFinite(p) || p <= 0 || p > 100) {
    return null;
  }
  if (sortedAsc.length === 1) {
    return sortedAsc[0];
  }
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) {
    return sortedAsc[lo];
  }
  const w = rank - lo;
  return sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w;
}

function percentilePair(values: number[]): DesktopRumPercentilePair {
  const sorted = [...values].filter((n) => Number.isFinite(n) && n >= 0).toSorted((a, b) => a - b);
  return {
    p50: percentileSorted(sorted, 50),
    p95: percentileSorted(sorted, 95),
    count: sorted.length,
  };
}

function rate(numer: number, denom: number): number | null {
  if (denom <= 0) {
    return null;
  }
  return Math.round((numer / denom) * 1000) / 1000;
}

/**
 * Roll up TTFP/TTI/TTS P50/P95 (+ reconnect / 5s first-frame rates) from RUM events.
 * Safe for accept bots / debug panels — never carries tokens or URLs.
 */
export function rollupDesktopRumTimings(
  events: readonly DesktopRumEvent[],
): DesktopRumTimingRollup {
  const ttfpBySession = new Map<string, number>();
  const ttiBySession = new Map<string, number>();
  const ttsBySession = new Map<string, number>();
  let sessionOpenCount = 0;
  let reconnectSuccessCount = 0;
  let reconnectFailedCount = 0;

  for (const event of events) {
    const sid = event.fields.sessionId;
    if (event.name === "desktop_open") {
      sessionOpenCount += 1;
    }
    if (event.name === "reconnect_success") {
      reconnectSuccessCount += 1;
    }
    if (event.name === "reconnect_failed") {
      reconnectFailedCount += 1;
    }
    if (
      event.fields.ttfpMs != null &&
      Number.isFinite(event.fields.ttfpMs) &&
      !ttfpBySession.has(sid)
    ) {
      ttfpBySession.set(sid, event.fields.ttfpMs);
    }
    if (
      event.fields.ttiMs != null &&
      Number.isFinite(event.fields.ttiMs) &&
      !ttiBySession.has(sid)
    ) {
      ttiBySession.set(sid, event.fields.ttiMs);
    }
    if (
      event.fields.ttsMs != null &&
      Number.isFinite(event.fields.ttsMs) &&
      !ttsBySession.has(sid)
    ) {
      ttsBySession.set(sid, event.fields.ttsMs);
    }
  }

  const ttfp = [...ttfpBySession.values()];
  const tti = [...ttiBySession.values()];
  const tts = [...ttsBySession.values()];
  const reconnectAttempts = reconnectSuccessCount + reconnectFailedCount;

  return {
    sampleEventCount: events.length,
    sessionOpenCount,
    ttfpMs: percentilePair(ttfp),
    ttiMs: percentilePair(tti),
    ttsMs: percentilePair(tts),
    firstFrameWithin5sRate: rate(ttfp.filter((n) => n <= 5000).length, ttfp.length),
    reconnectSuccessCount,
    reconnectFailedCount,
    reconnectSuccessRate: rate(reconnectSuccessCount, reconnectAttempts),
    stableStreamSuccessRate: rate(ttsBySession.size, sessionOpenCount),
  };
}

function fmtMs(n: number | null): string {
  return n == null ? "n/a" : `${Math.round(n)}ms`;
}

function fmtRate(n: number | null): string {
  return n == null ? "n/a" : `${Math.round(n * 100)}%`;
}

/** One-line accept-friendly summary (no tokens / URLs). */
export function formatDesktopRumSummary(rollup: DesktopRumTimingRollup): string {
  return [
    `sessions=${rollup.sessionOpenCount}`,
    `TTFP p50=${fmtMs(rollup.ttfpMs.p50)} p95=${fmtMs(rollup.ttfpMs.p95)} n=${rollup.ttfpMs.count}`,
    `TTI p50=${fmtMs(rollup.ttiMs.p50)} p95=${fmtMs(rollup.ttiMs.p95)} n=${rollup.ttiMs.count}`,
    `TTS p50=${fmtMs(rollup.ttsMs.p50)} p95=${fmtMs(rollup.ttsMs.p95)} n=${rollup.ttsMs.count}`,
    `ff<=5s=${fmtRate(rollup.firstFrameWithin5sRate)}`,
    `reconnectOk=${fmtRate(rollup.reconnectSuccessRate)} (${rollup.reconnectSuccessCount}/${rollup.reconnectSuccessCount + rollup.reconnectFailedCount})`,
    `stable=${fmtRate(rollup.stableStreamSuccessRate)}`,
  ].join(" | ");
}
