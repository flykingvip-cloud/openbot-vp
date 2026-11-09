import {
  decideWake,
  type FocusDecision,
  type FocusSnapshot,
} from "../../agent-runtime/policy/index.js";
import { cronWakeIncomingTaskId } from "../wake-identity.js";

/** User activity inside this window occupies the personal FOCUS slot. */
export const MAIN_SESSION_FOCUS_IDLE_MS = 4 * 60 * 60 * 1000;

export const LIVE_SESSION_FOCUS_ID = "session-live";

export function focusSnapshotFromLastUserActivity(params: {
  lastUserAtMs?: number;
  nowMs: number;
  idleAfterMs?: number;
}): FocusSnapshot {
  const idleAfterMs = params.idleAfterMs ?? MAIN_SESSION_FOCUS_IDLE_MS;
  const lastUserAtMs = params.lastUserAtMs;
  if (
    typeof lastUserAtMs === "number" &&
    Number.isFinite(lastUserAtMs) &&
    params.nowMs - lastUserAtMs <= idleAfterMs
  ) {
    return { focusTaskId: LIVE_SESSION_FOCUS_ID, parkedTaskIds: [] };
  }
  return { parkedTaskIds: [] };
}

export function decideCronMainSessionSurface(params: {
  jobId: string;
  conversationTaskId?: string;
  snapshot: FocusSnapshot;
}): FocusDecision {
  return decideWake({
    trigger: "cron",
    snapshot: params.snapshot,
    incomingTaskId: cronWakeIncomingTaskId({
      id: params.jobId,
      conversationTaskId: params.conversationTaskId,
    }),
  });
}

/** Isolated cron may still run; only full-result inject is gated. */
export function shouldInjectCronResultIntoMainSession(decision: FocusDecision): boolean {
  return decision.action === "acquire_focus";
}

/** FOCUS occupied: notify the user, do not punch the full result into the live turn. */
export function shouldNotifyCronWakeOnMainSession(decision: FocusDecision): boolean {
  return decision.action === "park" || decision.action === "reject_park_full";
}

export function readLastUserMessageAtMsFromTranscript(text: string): number | undefined {
  let lastUserAtMs: number | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        timestamp?: unknown;
        message?: { role?: unknown; timestamp?: unknown };
      };
      const role = parsed.message?.role ?? (parsed as { role?: unknown }).role;
      if (role !== "user") {
        continue;
      }
      const raw = parsed.message?.timestamp ?? parsed.timestamp;
      const ms =
        typeof raw === "number" ? raw : typeof raw === "string" ? Date.parse(raw) : Number.NaN;
      if (Number.isFinite(ms)) {
        lastUserAtMs = ms;
      }
    } catch {
      // Ignore malformed transcript lines.
    }
  }
  return lastUserAtMs;
}
