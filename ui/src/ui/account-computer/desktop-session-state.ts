/**
 * Canonical Desktop Session state machine (ROADMAP v3 M1b).
 *
 * Iron rule: a streamUrl (or equivalent stream endpoint) may advance the
 * session to STREAM_ATTACHED only — never FIRST_FRAME or INTERACTIVE.
 * First frame requires a client pixel/frame signal; Interactive requires
 * the input channel to be ready.
 */

export type DesktopSessionPhase =
  | "IDLE"
  | "OPENING"
  | "CONNECTING"
  | "STREAM_ATTACHED"
  | "FIRST_FRAME"
  | "INTERACTIVE"
  | "CONNECT_FAILED"
  | "STREAM_STALLED"
  | "AUTH_EXPIRED"
  | "SESSION_LOST"
  | "NETWORK_DEGRADED"
  | "RECONNECTING"
  | "ENDED"
  | "YIELDED";

/** Stall sub-path layered on top of FIRST_FRAME / INTERACTIVE / STREAM_STALLED. */
export type StallPhase =
  | "NONE"
  | "SUSPECTED"
  | "CONFIRMED"
  | "RECONNECTING"
  | "RECOVERED"
  | "FAILED";

export type ReconnectReason = "network" | "stream" | "credential";

export type DesktopSessionEvent =
  | { type: "OPEN" }
  | { type: "PREVIEW_REQUESTED" }
  | { type: "STREAM_ENDPOINT" } // streamUrl / endpoint ready — STREAM_ATTACHED only
  | { type: "FIRST_FRAME" }
  | { type: "INTERACTIVE_READY" }
  | { type: "CONNECT_FAILED" }
  | { type: "AUTH_EXPIRED" }
  | { type: "SESSION_LOST" }
  | { type: "NETWORK_DEGRADED" }
  | { type: "STALL_SUSPECTED" }
  | { type: "STALL_CONFIRMED" }
  | { type: "RECONNECT"; reason: ReconnectReason }
  | { type: "RECOVERED" } // new frame after reconnect
  | { type: "RECONNECT_FAILED" }
  | { type: "END" }
  | { type: "YIELD" }
  | { type: "RESET" };

export type DesktopSessionSnapshot = {
  phase: DesktopSessionPhase;
  stall: StallPhase;
  reconnectReason: ReconnectReason | null;
  /** Lifecycle attempt counter (open / reconnect). */
  connectionAttempt: number;
  /** Wall-clock marks for TTFP / TTI / TTS (ms since epoch); null until hit. */
  openedAt: number | null;
  streamAttachedAt: number | null;
  firstFrameAt: number | null;
  interactiveAt: number | null;
  stableStreamAt: number | null;
};

export function createDesktopSessionSnapshot(now: number = Date.now()): DesktopSessionSnapshot {
  void now;
  return {
    phase: "IDLE",
    stall: "NONE",
    reconnectReason: null,
    connectionAttempt: 0,
    openedAt: null,
    streamAttachedAt: null,
    firstFrameAt: null,
    interactiveAt: null,
    stableStreamAt: null,
  };
}

const TERMINAL: ReadonlySet<DesktopSessionPhase> = new Set(["ENDED", "YIELDED"]);

/** Phases where a fresh frame means Interactive/FirstFrame recovery. */
const LIVE_OR_STALL: ReadonlySet<DesktopSessionPhase> = new Set([
  "STREAM_ATTACHED",
  "FIRST_FRAME",
  "INTERACTIVE",
  "STREAM_STALLED",
  "NETWORK_DEGRADED",
  "RECONNECTING",
]);

/**
 * Pure transition. Never treats STREAM_ENDPOINT as FIRST_FRAME / INTERACTIVE.
 */
export function reduceDesktopSession(
  prev: DesktopSessionSnapshot,
  event: DesktopSessionEvent,
  now: number = Date.now(),
): DesktopSessionSnapshot {
  if (event.type === "RESET") {
    return createDesktopSessionSnapshot(now);
  }

  // RESET already returned above; a second comparison is not a reachable guard.
  if (TERMINAL.has(prev.phase) && event.type !== "OPEN") {
    return prev;
  }

  switch (event.type) {
    case "OPEN": {
      return {
        ...createDesktopSessionSnapshot(now),
        phase: "OPENING",
        connectionAttempt: prev.phase === "IDLE" ? 1 : prev.connectionAttempt + 1,
        openedAt: now,
      };
    }
    case "PREVIEW_REQUESTED": {
      if (prev.phase === "IDLE") {
        return {
          ...prev,
          phase: "CONNECTING",
          connectionAttempt: Math.max(1, prev.connectionAttempt),
          openedAt: prev.openedAt ?? now,
        };
      }
      if (prev.phase === "OPENING") {
        return { ...prev, phase: "CONNECTING" };
      }
      return prev;
    }
    case "STREAM_ENDPOINT": {
      // Iron rule: stream endpoint ⇒ STREAM_ATTACHED only.
      if (
        prev.phase === "OPENING" ||
        prev.phase === "CONNECTING" ||
        prev.phase === "CONNECT_FAILED" ||
        prev.phase === "RECONNECTING" ||
        prev.phase === "AUTH_EXPIRED" ||
        prev.phase === "SESSION_LOST" ||
        prev.phase === "NETWORK_DEGRADED" ||
        prev.phase === "STREAM_STALLED"
      ) {
        const recovering = prev.phase === "RECONNECTING" || prev.stall === "RECONNECTING";
        return {
          ...prev,
          phase: "STREAM_ATTACHED",
          stall: recovering ? "NONE" : prev.stall === "SUSPECTED" ? "NONE" : prev.stall,
          reconnectReason: recovering ? null : prev.reconnectReason,
          streamAttachedAt: prev.streamAttachedAt ?? now,
          // Explicitly do NOT set firstFrameAt / interactiveAt here.
        };
      }
      // Already past STREAM_ATTACHED — keep phase; never promote on streamUrl alone.
      if (
        prev.phase === "STREAM_ATTACHED" ||
        prev.phase === "FIRST_FRAME" ||
        prev.phase === "INTERACTIVE"
      ) {
        return {
          ...prev,
          streamAttachedAt: prev.streamAttachedAt ?? now,
        };
      }
      return prev;
    }
    case "FIRST_FRAME": {
      // M3: accept first_frame even if it races ahead of stream_connected
      // (CONNECTING/OPENING). Still never promotes on streamUrl alone.
      if (
        prev.phase === "STREAM_ATTACHED" ||
        prev.phase === "CONNECTING" ||
        prev.phase === "OPENING" ||
        prev.phase === "RECONNECTING" ||
        prev.phase === "STREAM_STALLED" ||
        prev.phase === "NETWORK_DEGRADED"
      ) {
        const recovered =
          prev.phase === "RECONNECTING" ||
          prev.stall === "RECONNECTING" ||
          prev.stall === "CONFIRMED" ||
          prev.stall === "SUSPECTED";
        return {
          ...prev,
          phase: "FIRST_FRAME",
          stall: recovered ? "RECOVERED" : "NONE",
          reconnectReason: null,
          firstFrameAt: prev.firstFrameAt ?? now,
          streamAttachedAt: prev.streamAttachedAt ?? now,
          stableStreamAt: prev.stableStreamAt ?? (recovered ? now : null),
        };
      }
      if (prev.phase === "FIRST_FRAME" || prev.phase === "INTERACTIVE") {
        // Fresh frame while live — clear stall suspicion / mark recovered.
        if (
          prev.stall === "SUSPECTED" ||
          prev.stall === "CONFIRMED" ||
          prev.stall === "RECONNECTING"
        ) {
          return {
            ...prev,
            stall: "RECOVERED",
            reconnectReason: null,
            stableStreamAt: prev.stableStreamAt ?? now,
          };
        }
        return {
          ...prev,
          stall: prev.stall === "RECOVERED" ? "NONE" : prev.stall,
          stableStreamAt: prev.stableStreamAt ?? now,
        };
      }
      return prev;
    }
    case "INTERACTIVE_READY": {
      if (prev.phase === "FIRST_FRAME" || prev.phase === "STREAM_ATTACHED") {
        // Allow INTERACTIVE only after we have seen a frame when coming from
        // STREAM_ATTACHED with firstFrameAt already set; otherwise require FIRST_FRAME.
        if (prev.phase === "STREAM_ATTACHED" && prev.firstFrameAt == null) {
          return prev;
        }
        return {
          ...prev,
          phase: "INTERACTIVE",
          stall: prev.stall === "RECOVERED" ? "NONE" : prev.stall === "NONE" ? "NONE" : "NONE",
          interactiveAt: prev.interactiveAt ?? now,
          firstFrameAt: prev.firstFrameAt ?? now,
          stableStreamAt: prev.stableStreamAt ?? now,
        };
      }
      if (prev.phase === "INTERACTIVE") {
        return prev;
      }
      if (
        prev.phase === "RECONNECTING" ||
        prev.phase === "STREAM_STALLED" ||
        prev.phase === "NETWORK_DEGRADED"
      ) {
        if (prev.firstFrameAt == null) {
          return prev;
        }
        return {
          ...prev,
          phase: "INTERACTIVE",
          stall: "RECOVERED",
          reconnectReason: null,
          interactiveAt: prev.interactiveAt ?? now,
          stableStreamAt: prev.stableStreamAt ?? now,
        };
      }
      return prev;
    }
    case "CONNECT_FAILED": {
      if (
        prev.phase === "OPENING" ||
        prev.phase === "CONNECTING" ||
        prev.phase === "RECONNECTING"
      ) {
        return {
          ...prev,
          phase: "CONNECT_FAILED",
          stall: prev.phase === "RECONNECTING" ? "FAILED" : prev.stall,
        };
      }
      return prev;
    }
    case "AUTH_EXPIRED": {
      if (!TERMINAL.has(prev.phase) && prev.phase !== "IDLE") {
        return { ...prev, phase: "AUTH_EXPIRED", stall: "NONE" };
      }
      return prev;
    }
    case "SESSION_LOST": {
      if (!TERMINAL.has(prev.phase) && prev.phase !== "IDLE") {
        return { ...prev, phase: "SESSION_LOST", stall: "FAILED" };
      }
      return prev;
    }
    case "NETWORK_DEGRADED": {
      if (LIVE_OR_STALL.has(prev.phase)) {
        return { ...prev, phase: "NETWORK_DEGRADED" };
      }
      return prev;
    }
    case "STALL_SUSPECTED": {
      if (prev.phase === "FIRST_FRAME" || prev.phase === "INTERACTIVE") {
        return {
          ...prev,
          phase: "STREAM_STALLED",
          stall: "SUSPECTED",
        };
      }
      if (prev.phase === "STREAM_STALLED" && prev.stall === "NONE") {
        return { ...prev, stall: "SUSPECTED" };
      }
      return prev;
    }
    case "STALL_CONFIRMED": {
      if (
        (prev.phase === "STREAM_STALLED" ||
          prev.phase === "FIRST_FRAME" ||
          prev.phase === "INTERACTIVE" ||
          prev.phase === "NETWORK_DEGRADED") &&
        (prev.stall === "SUSPECTED" || prev.stall === "NONE")
      ) {
        return {
          ...prev,
          phase: "STREAM_STALLED",
          stall: "CONFIRMED",
        };
      }
      return prev;
    }
    case "RECONNECT": {
      if (
        prev.phase === "STREAM_STALLED" ||
        prev.phase === "CONNECT_FAILED" ||
        prev.phase === "AUTH_EXPIRED" ||
        prev.phase === "SESSION_LOST" ||
        prev.phase === "NETWORK_DEGRADED" ||
        prev.phase === "FIRST_FRAME" ||
        prev.phase === "INTERACTIVE" ||
        prev.phase === "STREAM_ATTACHED"
      ) {
        return {
          ...prev,
          phase: "RECONNECTING",
          stall: "RECONNECTING",
          reconnectReason: event.reason,
          connectionAttempt: prev.connectionAttempt + 1,
          // Keep timing marks; new frame will refresh stableStreamAt.
        };
      }
      return prev;
    }
    case "RECOVERED": {
      if (prev.phase === "RECONNECTING" || prev.phase === "STREAM_STALLED") {
        const nextPhase: DesktopSessionPhase =
          prev.interactiveAt != null
            ? "INTERACTIVE"
            : prev.firstFrameAt != null
              ? "FIRST_FRAME"
              : "STREAM_ATTACHED";
        return {
          ...prev,
          phase: nextPhase,
          stall: "RECOVERED",
          reconnectReason: null,
          stableStreamAt: now,
        };
      }
      return prev;
    }
    case "RECONNECT_FAILED": {
      if (prev.phase === "RECONNECTING") {
        return {
          ...prev,
          phase: "CONNECT_FAILED",
          stall: "FAILED",
        };
      }
      return prev;
    }
    case "END": {
      return {
        ...prev,
        phase: "ENDED",
        stall: "NONE",
        reconnectReason: null,
      };
    }
    case "YIELD": {
      if (
        prev.phase === "INTERACTIVE" ||
        prev.phase === "FIRST_FRAME" ||
        prev.phase === "STREAM_ATTACHED"
      ) {
        return { ...prev, phase: "YIELDED", stall: "NONE" };
      }
      return prev;
    }
    default: {
      return prev;
    }
  }
}

/** UI connecting stage derived from phase (multi-stage copy). */
export type ConnectingStage =
  | "idle"
  | "opening"
  | "connecting"
  | "waiting_picture"
  | "attached"
  | "live"
  | "stalled"
  | "reconnecting"
  | "failed"
  | "ended"
  | "yielded"
  | "auth"
  | "lost"
  | "degraded";

export function connectingStageOf(snapshot: DesktopSessionSnapshot): ConnectingStage {
  switch (snapshot.phase) {
    case "IDLE":
      return "idle";
    case "OPENING":
      return "opening";
    case "CONNECTING":
      return "connecting";
    case "STREAM_ATTACHED":
      return "waiting_picture";
    case "FIRST_FRAME":
      return "attached";
    case "INTERACTIVE":
      return "live";
    case "STREAM_STALLED":
      return snapshot.stall === "RECONNECTING" ? "reconnecting" : "stalled";
    case "RECONNECTING":
      return "reconnecting";
    case "CONNECT_FAILED":
      return "failed";
    case "AUTH_EXPIRED":
      return "auth";
    case "SESSION_LOST":
      return "lost";
    case "NETWORK_DEGRADED":
      return "degraded";
    case "ENDED":
      return "ended";
    case "YIELDED":
      return "yielded";
    default:
      return "idle";
  }
}

/** True when streamUrl must not be treated as interactive-ready. */
export function streamUrlMeansAttachedOnly(): true {
  return true;
}
