import fs from "node:fs";
import path from "node:path";
import {
  decideWake,
  type FocusDecision,
  type FocusSnapshot,
} from "../agent-runtime/policy/index.js";
import { loadSessionStore, resolveSessionFilePath } from "../config/sessions.js";
import { readLastUserMessageAtMsFromTranscript } from "../cron/isolated-agent/main-session-focus.js";
import { resolveHeartbeatReasonKind } from "./heartbeat-reason.js";

/**
 * Heartbeat main-session gate (EA-B5).
 *
 * Heartbeat is a Wake Trigger, not a second scheduler.
 * It never mints ConversationTask identity. Occupied FOCUS skips the LLM turn.
 */

export const HEARTBEAT_FOCUS_SKIP_REASON = "focus-occupied";
export const HEARTBEAT_IDENTITY_SKIP_REASON = "reject-identity-create";

const TRANSCRIPT_TAIL_BYTES = 256_000;

export type HeartbeatMainSessionDecision =
  | { run: true; kind: "idle_patrol" | "event_wake"; incomingTaskId?: string }
  | {
      run: false;
      kind: "skip_occupied" | "park" | "reject_park_full" | "reject_identity_create";
      skipReason: typeof HEARTBEAT_FOCUS_SKIP_REASON | typeof HEARTBEAT_IDENTITY_SKIP_REASON;
      decision?: FocusDecision;
    };

/**
 * Event-driven heartbeat may carry a wake key. Patrol has none.
 * Wake keys are not ConversationTask ids.
 */
export function resolveHeartbeatWakeKey(reason?: string): string | undefined {
  const kind = resolveHeartbeatReasonKind(reason);
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (kind === "cron" && trimmed.startsWith("cron:")) {
    return trimmed;
  }
  if (kind === "exec-event") {
    return "exec-event";
  }
  if (kind === "wake") {
    return trimmed || "wake";
  }
  if (kind === "hook" && trimmed.startsWith("hook:")) {
    return trimmed;
  }
  return undefined;
}

export function decideHeartbeatMainSessionRun(params: {
  snapshot: FocusSnapshot;
  reason?: string;
  incomingCreatesIdentity?: boolean;
}): HeartbeatMainSessionDecision {
  const incomingTaskId = resolveHeartbeatWakeKey(params.reason);
  const occupied = Boolean(params.snapshot.focusTaskId?.trim());

  if (params.incomingCreatesIdentity) {
    return {
      run: false,
      kind: "reject_identity_create",
      skipReason: HEARTBEAT_IDENTITY_SKIP_REASON,
      decision: decideWake({
        trigger: "heartbeat",
        snapshot: params.snapshot,
        incomingCreatesIdentity: true,
        incomingTaskId: incomingTaskId || "heartbeat-new",
      }),
    };
  }

  if (!incomingTaskId) {
    if (occupied) {
      return {
        run: false,
        kind: "skip_occupied",
        skipReason: HEARTBEAT_FOCUS_SKIP_REASON,
      };
    }
    return { run: true, kind: "idle_patrol" };
  }

  const decision = decideWake({
    trigger: "heartbeat",
    snapshot: params.snapshot,
    incomingTaskId,
  });

  if (decision.action === "acquire_focus") {
    return { run: true, kind: "event_wake", incomingTaskId };
  }
  if (decision.action === "reject_identity_create") {
    return {
      run: false,
      kind: "reject_identity_create",
      skipReason: HEARTBEAT_IDENTITY_SKIP_REASON,
      decision,
    };
  }
  if (decision.action === "reject_park_full") {
    return {
      run: false,
      kind: "reject_park_full",
      skipReason: HEARTBEAT_FOCUS_SKIP_REASON,
      decision,
    };
  }
  return {
    run: false,
    kind: "park",
    skipReason: HEARTBEAT_FOCUS_SKIP_REASON,
    decision,
  };
}

/** Event-driven wakes notify; idle patrol stays silent. */
export function shouldNotifyHeartbeatWakeOnMainSession(
  decision: HeartbeatMainSessionDecision,
): boolean {
  return !decision.run && (decision.kind === "park" || decision.kind === "reject_park_full");
}

export function readHeartbeatSessionFile(params: {
  storePath: string;
  sessionKey: string;
  agentId?: string;
}): string | undefined {
  try {
    const store = loadSessionStore(params.storePath);
    const entry = store[params.sessionKey];
    if (!entry?.sessionId) {
      return undefined;
    }
    const transcriptPath = resolveSessionFilePath(entry.sessionId, entry, {
      agentId: params.agentId,
      sessionsDir: path.dirname(params.storePath),
    });
    return transcriptPath && fs.existsSync(transcriptPath) ? transcriptPath : undefined;
  } catch {
    return undefined;
  }
}

export function readLastUserAtMsForHeartbeatSession(params: {
  storePath: string;
  sessionKey: string;
  agentId?: string;
}): number | undefined {
  try {
    const transcriptPath = readHeartbeatSessionFile(params);
    if (!transcriptPath) {
      return undefined;
    }
    const stat = fs.statSync(transcriptPath);
    const start = Math.max(0, stat.size - TRANSCRIPT_TAIL_BYTES);
    const buf = Buffer.alloc(stat.size - start);
    const fd = fs.openSync(transcriptPath, "r");
    try {
      fs.readSync(fd, buf, 0, buf.length, start);
    } finally {
      fs.closeSync(fd);
    }
    return readLastUserMessageAtMsFromTranscript(buf.toString("utf8"));
  } catch {
    return undefined;
  }
}
