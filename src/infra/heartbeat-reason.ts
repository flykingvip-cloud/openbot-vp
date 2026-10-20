export type HeartbeatReasonKind =
  | "retry"
  | "interval"
  | "manual"
  | "exec-event"
  | "wake"
  | "cron"
  | "hook"
  | "other";

function trimReason(reason?: string): string {
  return typeof reason === "string" ? reason.trim() : "";
}

export function normalizeHeartbeatWakeReason(reason?: string): string {
  const trimmed = trimReason(reason);
  return trimmed.length > 0 ? trimmed : "requested";
}

export function resolveHeartbeatReasonKind(reason?: string): HeartbeatReasonKind {
  const trimmed = trimReason(reason);
  if (trimmed === "retry") {
    return "retry";
  }
  if (trimmed === "interval") {
    return "interval";
  }
  if (trimmed === "manual") {
    return "manual";
  }
  if (trimmed === "exec-event" || trimmed.startsWith("exec:")) {
    return "exec-event";
  }
  if (trimmed === "wake" || trimmed === "notifications-event") {
    return "wake";
  }
  if (trimmed.startsWith("cli:")) {
    return "wake";
  }
  if (trimmed.startsWith("acp:spawn:")) {
    return "wake";
  }
  if (trimmed.startsWith("cron:")) {
    return "cron";
  }
  if (trimmed.startsWith("hook:")) {
    return "hook";
  }
  return "other";
}

export function isHeartbeatEventDrivenReason(reason?: string): boolean {
  const kind = resolveHeartbeatReasonKind(reason);
  return kind === "exec-event" || kind === "cron" || kind === "wake" || kind === "hook";
}

export function isHeartbeatActionWakeReason(reason?: string): boolean {
  const kind = resolveHeartbeatReasonKind(reason);
  return kind === "manual" || kind === "exec-event" || kind === "hook";
}

export const HEARTBEAT_NO_TRIGGER_SKIP_REASON = "no-trigger";

/** Interval/retry/other ticks need a pending event or an explicit manual/event reason. */
export function shouldAdmitHeartbeatTurn(params: {
  reason?: string;
  hasPendingEvents: boolean;
}): boolean {
  if (isHeartbeatEventDrivenReason(params.reason)) {
    return true;
  }
  if (resolveHeartbeatReasonKind(params.reason) === "manual") {
    return true;
  }
  return params.hasPendingEvents;
}
