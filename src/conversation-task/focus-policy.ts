/**
 * Focus / Parked scheduling policy (EA-B2, EA-B4, EA-B5).
 *
 * Pure functions only. Does not write ConversationTask, Ledger, chat.send, or Cron.
 * FOCUS/PARKED are execution slots, not a task cardinality cap.
 */

export const MAX_FOCUS_SLOTS = 1;
export const MAX_PARKED_SLOTS = 3;

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

const IDENTITY_CREATE_TRIGGERS = new Set<WakeReason>(["cron", "heartbeat"]);

export function isHeartbeatActionAllowed(action: string): boolean {
  return !(HEARTBEAT_FORBIDDEN_ACTIONS as readonly string[]).includes(action);
}

export function formatDroppedParkedTaskSentence(params: {
  droppedTaskId?: string;
  droppedTitle?: string;
  droppedPaths?: readonly string[];
}): string {
  const name = params.droppedTitle?.trim() || params.droppedTaskId?.trim() || "";
  if (!name) {
    return "";
  }
  const paths = (params.droppedPaths ?? []).map((item) => item.trim()).filter(Boolean);
  // C6 / §3.6: capacity overflow → searchable archive + notify (not silent drop).
  if (paths.length === 0) {
    return `已归档最早挂起的「${name}」（可追溯）。`;
  }
  return `已归档最早挂起的「${name}」（可追溯），文件仍在 ${paths.join("、")}。`;
}

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

export function decideWake(params: {
  trigger: WakeReason;
  snapshot: FocusSnapshot;
  incomingTaskId?: string;
  /** Wake trigger tried to mint a new ConversationTask. Always rejected for cron/heartbeat. */
  incomingCreatesIdentity?: boolean;
}): FocusDecision {
  if (params.incomingCreatesIdentity && IDENTITY_CREATE_TRIGGERS.has(params.trigger)) {
    return { action: "reject_identity_create", trigger: params.trigger };
  }

  const incomingTaskId = params.incomingTaskId?.trim() ?? "";
  if (!incomingTaskId) {
    return params.trigger === "heartbeat"
      ? { action: "ignore_heartbeat" }
      : { action: "reject_identity_create", trigger: params.trigger };
  }

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
