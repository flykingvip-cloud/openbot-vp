/**
 * Desktop Session Performance (ROADMAP v3 M3).
 *
 * Phase3 = Measurement + Optimization using M1b RUM.
 * Not DPR. Not reload-as-recovery. Iron rule unchanged:
 * streamUrl ≠ FIRST_FRAME ≠ INTERACTIVE.
 */

import {
  formatDesktopRumSummary,
  rollupDesktopRumTimings,
  type DesktopRumBuffer,
  type DesktopRumTimingRollup,
} from "./desktop-session-rum.ts";
import type { DesktopSessionPhase } from "./desktop-session-state.ts";

/** Loom landing stream id for this slice. */
export const DESKTOP_SESSION_PERF_LANDING = "DESKTOP_SESSION_PERF_M3" as const;

/**
 * When the session is already healthy INTERACTIVE, prefer status / no-op over
 * another browser.preview "open" (avoids token churn + iframe remount).
 * Anomaly / reconnect phases must NOT skip.
 */
export function shouldSkipHealthyInteractivePreviewOpen(
  phase: DesktopSessionPhase | null | undefined,
): boolean {
  return phase === "INTERACTIVE";
}

/**
 * Anomaly / reconnect phases must mint a fresh streamUrl (one-shot token).
 * grantLive → status short-circuit must not block credential rotation.
 */
export function shouldForcePreviewTokenRotate(
  phase: DesktopSessionPhase | null | undefined,
): boolean {
  return (
    phase === "AUTH_EXPIRED" ||
    phase === "RECONNECTING" ||
    phase === "STREAM_STALLED" ||
    phase === "NETWORK_DEGRADED" ||
    phase === "CONNECT_FAILED" ||
    phase === "SESSION_LOST"
  );
}

/**
 * Deduplicate stream_attached RUM / stall re-arm when endpoint is reported again
 * while already attached or live. Still emit when recovering (RECONNECTING / anomaly).
 */
export function shouldEmitStreamAttachedRum(prevPhase: DesktopSessionPhase): boolean {
  return (
    prevPhase !== "STREAM_ATTACHED" && prevPhase !== "FIRST_FRAME" && prevPhase !== "INTERACTIVE"
  );
}

/** Phases where a first_frame observation may advance without waiting for stream_connected. */
export function canObserveFirstFrameFromPhase(phase: DesktopSessionPhase): boolean {
  return (
    phase === "STREAM_ATTACHED" ||
    phase === "CONNECTING" ||
    phase === "OPENING" ||
    phase === "RECONNECTING" ||
    phase === "STREAM_STALLED" ||
    phase === "NETWORK_DEGRADED" ||
    phase === "FIRST_FRAME" ||
    phase === "INTERACTIVE"
  );
}

/** Build accept-friendly RUM rollup from a live buffer. */
export function summarizeDesktopSessionRum(rum: DesktopRumBuffer): {
  rollup: DesktopRumTimingRollup;
  summary: string;
} {
  const rollup = rollupDesktopRumTimings(rum.events);
  return { rollup, summary: formatDesktopRumSummary(rollup) };
}
