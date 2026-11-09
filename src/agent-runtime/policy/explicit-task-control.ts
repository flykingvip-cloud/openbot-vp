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
 * Wake eligibility only. {@link decideWake} chooses park/switch.
 * Hosts perform the claim, board write, and wake. Heartbeat cannot create, replan, or complete a task.
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

/**
 * Execution-slot cap for FOCUS/PARKED scheduling.
 * Not the session task board cardinality (`MAX_PARKED_TASKS`), even when both are 3.
 */
export const MAX_FOCUS_SLOTS = 1;
export const MAX_PARKED_SLOTS = 3;

export type FocusSnapshot = {
  focusTaskId?: string;
  /** Oldest first. */
  parkedTaskIds: readonly string[];
  /** Oldest-first titles aligned with parkedTaskIds when known. */
  parkedTitles?: readonly string[];
  /** Oldest-first workspace paths aligned with parkedTaskIds when known. */
  parkedWorkspacePaths?: readonly (readonly string[])[];
};

export type FocusDecision =
  | { action: "acquire_focus"; taskId: string }
  | {
      action: "park";
      taskId: string;
      parkedCount: number;
      /** Oldest parked id removed so the cap stays at 3. */
      droppedTaskId?: string;
      droppedTitle?: string;
      droppedPaths?: string[];
    }
  | { action: "reject_park_full"; taskId: string; parkedCount: number }
  | {
      action: "park_current_and_switch";
      currentFocusId: string;
      incomingTaskId: string;
      parkedCount: number;
      /** Oldest parked id dropped to keep the cap at 3. Index 0 of parkedTaskIds is oldest. */
      droppedTaskId?: string;
    }
  | { action: "reject_identity_create"; trigger: WakeReason }
  | { action: "ignore_heartbeat" };

const AUTO_PARK_TRIGGERS = new Set<WakeReason>([
  "cron",
  "heartbeat",
  "external_event",
  "approval_resolved",
]);

function parkIncomingDroppingOldest(
  snapshot: FocusSnapshot,
  incomingTaskId: string,
): FocusDecision {
  const parked = [...snapshot.parkedTaskIds];
  if (parked.includes(incomingTaskId)) {
    return { action: "park", taskId: incomingTaskId, parkedCount: parked.length };
  }
  let droppedTaskId: string | undefined;
  let droppedTitle: string | undefined;
  let droppedPaths: string[] | undefined;
  if (parked.length >= MAX_PARKED_SLOTS) {
    droppedTaskId = parked.shift();
    const title = snapshot.parkedTitles?.[0]?.trim();
    if (title) {
      droppedTitle = title;
    }
    const paths = (snapshot.parkedWorkspacePaths?.[0] ?? [])
      .map((item) => item.trim())
      .filter(Boolean);
    if (paths.length > 0) {
      droppedPaths = paths;
    }
  }
  return {
    action: "park",
    taskId: incomingTaskId,
    parkedCount: Math.min(parked.length + 1, MAX_PARKED_SLOTS),
    ...(droppedTaskId ? { droppedTaskId } : {}),
    ...(droppedTitle ? { droppedTitle } : {}),
    ...(droppedPaths ? { droppedPaths } : {}),
  };
}

function parkCurrentAndSwitch(snapshot: FocusSnapshot, incomingTaskId: string): FocusDecision {
  const focusTaskId = snapshot.focusTaskId?.trim() ?? "";
  const parked = [...snapshot.parkedTaskIds];
  let droppedTaskId: string | undefined;
  if (focusTaskId && !parked.includes(focusTaskId)) {
    parked.push(focusTaskId);
  }
  while (parked.length > MAX_PARKED_SLOTS) {
    droppedTaskId = parked.shift();
  }
  return {
    action: "park_current_and_switch",
    currentFocusId: focusTaskId,
    incomingTaskId,
    parkedCount: parked.length,
    ...(droppedTaskId ? { droppedTaskId } : {}),
  };
}

/** Pure park/switch selection. Does not claim, write a board, or wake a host. */
export function decideWake(params: {
  trigger: WakeReason;
  snapshot: FocusSnapshot;
  incomingTaskId?: string;
  /** Wake trigger tried to mint a new ConversationTask. Always rejected for cron/heartbeat. */
  incomingCreatesIdentity?: boolean;
}): FocusDecision {
  const eligibility = evaluateWakeEligibility(params);
  if (!eligibility.eligible) {
    return eligibility.decision;
  }
  const incomingTaskId = eligibility.incomingTaskId;
  const focusTaskId = params.snapshot.focusTaskId?.trim() ?? "";
  if (!focusTaskId || focusTaskId === incomingTaskId) {
    return { action: "acquire_focus", taskId: incomingTaskId };
  }
  if (
    params.trigger === "user_message" ||
    params.trigger === "user_task_update" ||
    params.trigger === "resume"
  ) {
    return parkCurrentAndSwitch(params.snapshot, incomingTaskId);
  }
  if (AUTO_PARK_TRIGGERS.has(params.trigger) || params.trigger === "retry") {
    return parkIncomingDroppingOldest(params.snapshot, incomingTaskId);
  }
  return parkCurrentAndSwitch(params.snapshot, incomingTaskId);
}
