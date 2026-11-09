import type { ExplicitTaskControl } from "../contracts/task-control.js";
import { stripInboundStamp } from "./input-stamp.js";

/** Fixed syntax only; no inferred new work, task switching or side effects. */
export function parseExplicitTaskControl(text: string): ExplicitTaskControl | undefined {
  const incoming = stripInboundStamp(text);
  if (!incoming || incoming.startsWith("/")) {
    return undefined;
  }
  if (/^(?:暂停(?:当前(?:任务)?)?|先暂停)[。.!！]?$/u.test(incoming)) {
    return { scope: "current", action: "pause" };
  }
  if (/^(?:取消当前(?:任务)?|取消任务)[。.!！]?$/u.test(incoming)) {
    return { scope: "current", action: "cancel" };
  }
  const resume = incoming.match(/^(?:继续挂起|CONTINUE)\s+(\S+)/iu);
  if (resume) {
    return { scope: "parked", action: "resume", taskId: resume[1] };
  }
  const pause = incoming.match(/^暂停挂起\s+(\S+)/u);
  if (pause) {
    return { scope: "parked", action: "pause", taskId: pause[1] };
  }
  const cancel = incoming.match(/^(?:取消挂起|关闭挂起|CLOSE)\s+(\S+)/iu);
  return cancel ? { scope: "parked", action: "cancel", taskId: cancel[1] } : undefined;
}

/**
 * Live in-flight abort predicate. Not classifyTurnRelation and not a board write.
 * Gateway and turn-relation consume this through the policy public entry.
 */
export function shouldTaskParkAbortInFlight(cutContext: boolean, abortInFlight?: boolean): boolean {
  return cutContext || abortInFlight === true;
}

export const WAKE_REASONS = [
  "user_message",
  "user_task_update",
  "cron",
  "heartbeat",
  "external_event",
  "approval_resolved",
  "retry",
  "resume",
] as const;

export type WakeReason = (typeof WAKE_REASONS)[number];

export const HEARTBEAT_FORBIDDEN_ACTIONS = [
  "create_identity",
  "write_completion",
  "replan",
] as const;

export type HeartbeatForbiddenAction = (typeof HEARTBEAT_FORBIDDEN_ACTIONS)[number];

export function isHeartbeatActionAllowed(action: string): boolean {
  return !(HEARTBEAT_FORBIDDEN_ACTIONS as readonly string[]).includes(action);
}

export type WakeEligibility =
  | {
      eligible: false;
      decision:
        | { action: "reject_identity_create"; trigger: WakeReason }
        | { action: "ignore_heartbeat" };
    }
  | { eligible: true; incomingTaskId: string };

const IDENTITY_CREATE_TRIGGERS = new Set<WakeReason>(["cron", "heartbeat"]);

/**
 * Wake eligibility only. Park/switch choices stay in decideWake.
 * Claim and board writes stay in state. Heartbeat cannot create, replan, or complete a task.
 */
export function evaluateWakeEligibility(params: {
  trigger: WakeReason;
  incomingTaskId?: string;
  incomingCreatesIdentity?: boolean;
}): WakeEligibility {
  if (params.incomingCreatesIdentity && IDENTITY_CREATE_TRIGGERS.has(params.trigger)) {
    return {
      eligible: false,
      decision: { action: "reject_identity_create", trigger: params.trigger },
    };
  }
  const incomingTaskId = params.incomingTaskId?.trim() ?? "";
  if (!incomingTaskId) {
    return params.trigger === "heartbeat"
      ? { eligible: false, decision: { action: "ignore_heartbeat" } }
      : {
          eligible: false,
          decision: { action: "reject_identity_create", trigger: params.trigger },
        };
  }
  return { eligible: true, incomingTaskId };
}
