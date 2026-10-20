/**
 * Desktop Session Runtime — owns the canonical state machine, stall timers,
 * and reconnect policy. Recovery is session-level: never location.reload().
 */

import { shouldEmitStreamAttachedRum } from "./desktop-session-perf.ts";
import {
  computeRumTimings,
  createDesktopRumBuffer,
  formatDesktopRumSummary,
  hashUserId,
  rollupDesktopRumTimings,
  type DesktopRumBuffer,
  type DesktopRumEventName,
  type DesktopRumFields,
  type DesktopRumTimingRollup,
} from "./desktop-session-rum.ts";
import {
  connectingStageOf,
  createDesktopSessionSnapshot,
  reduceDesktopSession,
  type ConnectingStage,
  type DesktopSessionEvent,
  type DesktopSessionSnapshot,
  type ReconnectReason,
} from "./desktop-session-state.ts";

export type DesktopSessionRuntimeOptions = {
  sessionId: string;
  userId?: string;
  desktopId?: string;
  agentId?: string;
  /** ms without frame_tick before STALL_SUSPECTED */
  stallSuspectMs?: number;
  /** extra ms (after suspect) before STALL_CONFIRMED */
  stallConfirmMs?: number;
  /** max reconnect attempts before FAILED */
  maxReconnectAttempts?: number;
  now?: () => number;
  rum?: DesktopRumBuffer;
  onChange?: (snapshot: DesktopSessionSnapshot) => void;
  /**
   * Session-level reconnect hook. Must NOT call location.reload().
   * reason: network | stream | credential
   */
  onReconnect?: (reason: ReconnectReason, attempt: number) => void | Promise<void>;
};

export type DesktopSessionRuntime = {
  readonly snapshot: DesktopSessionSnapshot;
  readonly stage: ConnectingStage;
  readonly rum: DesktopRumBuffer;
  dispatch: (event: DesktopSessionEvent) => DesktopSessionSnapshot;
  /** Notify that a stream endpoint (streamUrl) is available — STREAM_ATTACHED only. */
  noteStreamEndpoint: () => void;
  noteFirstFrame: () => void;
  noteFrameTick: () => void;
  noteInteractiveReady: () => void;
  noteOpen: () => void;
  notePreviewRequested: () => void;
  noteConnectFailed: () => void;
  noteAuthExpired: () => void;
  noteSessionLost: () => void;
  noteNetworkDegraded: () => void;
  noteEnd: () => void;
  noteYield: () => void;
  /** Begin reconnect without reload. */
  startReconnect: (reason: ReconnectReason) => void;
  /** Build base RUM fields (sanitized). */
  rumFields: (extra?: Partial<DesktopRumFields>) => DesktopRumFields;
  /** M3 accept-friendly TTFP/TTI/TTS rollup (no tokens/URLs). */
  rumRollup: () => DesktopRumTimingRollup;
  rumSummary: () => string;
  dispose: () => void;
};

const DEFAULT_STALL_SUSPECT_MS = 4_000;
const DEFAULT_STALL_CONFIRM_MS = 4_000;
const DEFAULT_MAX_RECONNECT = 3;

export function createDesktopSessionRuntime(
  options: DesktopSessionRuntimeOptions,
): DesktopSessionRuntime {
  const nowFn = options.now ?? Date.now;
  const stallSuspectMs = options.stallSuspectMs ?? DEFAULT_STALL_SUSPECT_MS;
  const stallConfirmMs = options.stallConfirmMs ?? DEFAULT_STALL_CONFIRM_MS;
  const maxReconnect = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT;
  const rum = options.rum ?? createDesktopRumBuffer();

  let snapshot = createDesktopSessionSnapshot(nowFn());
  let lastFrameAt: number | null = null;
  let suspectTimer: ReturnType<typeof setTimeout> | null = null;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let disposed = false;

  const baseIds = {
    sessionId: options.sessionId || "session",
    userIdHash: hashUserId(options.userId ?? ""),
    desktopId: options.desktopId || "desktop",
    agentId: options.agentId || "agent",
  };

  function emit(name: DesktopRumEventName, extra?: Partial<DesktopRumFields>) {
    const timings = computeRumTimings({
      openedAt: snapshot.openedAt,
      firstFrameAt: snapshot.firstFrameAt,
      interactiveAt: snapshot.interactiveAt,
      stableStreamAt: snapshot.stableStreamAt,
    });
    rum.emit(name, {
      ...baseIds,
      connectionAttempt: snapshot.connectionAttempt,
      phase: snapshot.phase,
      ...timings,
      ...extra,
    });
  }

  function clearStallTimers() {
    if (suspectTimer) {
      clearTimeout(suspectTimer);
      suspectTimer = null;
    }
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
  }

  function beginReconnect(reason: ReconnectReason) {
    if (reconnectAttempts >= maxReconnect) {
      apply({ type: "RECONNECT_FAILED" });
      emit("reconnect_failed", { reconnectReason: reason });
      clearStallTimers();
      return;
    }
    reconnectAttempts += 1;
    apply({ type: "RECONNECT", reason });
    clearStallTimers();
    emit("reconnect_start", { reconnectReason: reason });
    // Iron rule: session recovery — never reload the Control UI page.
    if (typeof options.onReconnect === "function") {
      void Promise.resolve(options.onReconnect(reason, reconnectAttempts)).catch(() => {
        apply({ type: "RECONNECT_FAILED" });
        emit("reconnect_failed", { reconnectReason: reason });
      });
    }
  }

  function armStallWatch() {
    clearStallTimers();
    if (
      snapshot.phase !== "FIRST_FRAME" &&
      snapshot.phase !== "INTERACTIVE" &&
      snapshot.phase !== "STREAM_ATTACHED"
    ) {
      return;
    }
    suspectTimer = setTimeout(() => {
      suspectTimer = null;
      if (disposed) {
        return;
      }
      apply({ type: "STALL_SUSPECTED" });
      emit("stall_suspected");
      confirmTimer = setTimeout(() => {
        confirmTimer = null;
        if (disposed) {
          return;
        }
        apply({ type: "STALL_CONFIRMED" });
        emit("stall_confirmed");
        // Blocking fix: confirmed stall auto-starts session reconnect (no reload).
        beginReconnect("stream");
      }, stallConfirmMs);
    }, stallSuspectMs);
  }

  function apply(event: DesktopSessionEvent): DesktopSessionSnapshot {
    if (disposed && event.type !== "RESET") {
      return snapshot;
    }
    const prev = snapshot;
    snapshot = reduceDesktopSession(prev, event, nowFn());
    if (snapshot !== prev) {
      options.onChange?.(snapshot);
    }
    return snapshot;
  }

  const api: DesktopSessionRuntime = {
    get snapshot() {
      return snapshot;
    },
    get stage() {
      return connectingStageOf(snapshot);
    },
    get rum() {
      return rum;
    },
    dispatch(event) {
      return apply(event);
    },
    noteOpen() {
      apply({ type: "OPEN" });
      reconnectAttempts = 0;
      emit("desktop_open");
    },
    notePreviewRequested() {
      apply({ type: "PREVIEW_REQUESTED" });
      emit("preview_open");
    },
    noteStreamEndpoint() {
      const prevPhase = snapshot.phase;
      apply({ type: "STREAM_ENDPOINT" });
      // M3: dedupe attach work when already STREAM_ATTACHED / FIRST_FRAME / INTERACTIVE.
      if (!shouldEmitStreamAttachedRum(prevPhase)) {
        return;
      }
      emit("stream_attached");
      // Waiting for first frame — arm stall once attached so a silent iframe is detected.
      lastFrameAt = null;
      armStallWatch();
    },
    noteFirstFrame() {
      const wasReconnecting =
        snapshot.phase === "RECONNECTING" || snapshot.stall === "RECONNECTING";
      apply({ type: "FIRST_FRAME" });
      lastFrameAt = nowFn();
      clearStallTimers();
      emit("first_frame");
      if (wasReconnecting) {
        emit("reconnect_success", {
          reconnectReason: snapshot.reconnectReason ?? undefined,
        });
        reconnectAttempts = 0;
      }
      armStallWatch();
    },
    noteFrameTick() {
      lastFrameAt = nowFn();
      if (snapshot.stall === "SUSPECTED" || snapshot.phase === "STREAM_STALLED") {
        apply({ type: "FIRST_FRAME" });
      }
      clearStallTimers();
      if (snapshot.phase === "FIRST_FRAME" || snapshot.phase === "INTERACTIVE") {
        armStallWatch();
      }
    },
    noteInteractiveReady() {
      apply({ type: "INTERACTIVE_READY" });
      if (snapshot.phase === "INTERACTIVE") {
        emit("interactive");
      }
      armStallWatch();
    },
    noteConnectFailed() {
      apply({ type: "CONNECT_FAILED" });
      clearStallTimers();
    },
    noteAuthExpired() {
      apply({ type: "AUTH_EXPIRED" });
      clearStallTimers();
      emit("auth_ready", { phase: "AUTH_EXPIRED" });
      // Stay on AUTH_EXPIRED so Control UI can show credential CTA.
      // Reconnect with reason "credential" runs when CTA / startReconnect fires.
    },
    noteSessionLost() {
      apply({ type: "SESSION_LOST" });
      clearStallTimers();
    },
    noteNetworkDegraded() {
      apply({ type: "NETWORK_DEGRADED" });
    },
    noteEnd() {
      apply({ type: "END" });
      clearStallTimers();
      emit("session_end");
    },
    noteYield() {
      apply({ type: "YIELD" });
      clearStallTimers();
      emit("session_end", { phase: "YIELDED" });
    },
    startReconnect(reason) {
      beginReconnect(reason);
    },
    rumFields(extra) {
      const timings = computeRumTimings({
        openedAt: snapshot.openedAt,
        firstFrameAt: snapshot.firstFrameAt,
        interactiveAt: snapshot.interactiveAt,
        stableStreamAt: snapshot.stableStreamAt,
      });
      return {
        ...baseIds,
        connectionAttempt: snapshot.connectionAttempt,
        phase: snapshot.phase,
        ...timings,
        ...extra,
      };
    },
    rumRollup() {
      return rollupDesktopRumTimings(rum.events);
    },
    rumSummary() {
      return formatDesktopRumSummary(rollupDesktopRumTimings(rum.events));
    },
    dispose() {
      disposed = true;
      clearStallTimers();
    },
  };

  // Expose lastFrameAt for tests via weak ref pattern — keep unused var honest.
  void lastFrameAt;

  return api;
}

/** Guard used by binders / tests: reconnect must never touch location.reload. */
export function assertNoLocationReload(reconnectImpl: () => void): void {
  const g = globalThis as { location?: { reload?: () => void } };
  const loc = g.location;
  if (!loc || typeof loc.reload !== "function") {
    reconnectImpl();
    return;
  }
  const original = loc.reload.bind(loc);
  let called = false;
  loc.reload = () => {
    called = true;
  };
  try {
    reconnectImpl();
  } finally {
    loc.reload = original;
  }
  if (called) {
    throw new Error("desktop session reconnect must not call location.reload()");
  }
}
