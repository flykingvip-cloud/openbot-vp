import { parsePersonalCronTaskMetaRecord } from "../cron/personal-task-meta.js";
import type { BlockingReason, ProgressView } from "./types.js";
import { listHumanGates } from "./view-copy.js";

export type HumanGatePendingItem = {
  id: string;
  taskId: string;
  title: string;
  reason: Extract<BlockingReason, "blocked_user" | "blocked_authorization">;
  goal: string;
  sessionKey?: string;
  updatedAtMs: number;
  ackRequired: true;
};

export type HumanGateNotification = {
  taskId: string;
  question: string;
  reason: "blocked_user";
};

export function isCronProgressQuiet(job: { description?: string }): boolean {
  return parsePersonalCronTaskMetaRecord(job.description)?.notify?.inApp === false;
}

/**
 * Pending-tasks is a pull surface (user opened home). Quiet still lists the gate.
 * Execution steps never become items.
 */
export function toHumanGatePendingItem(
  view: ProgressView,
  options?: { sessionKey?: string },
): HumanGatePendingItem | null {
  const gate = listHumanGates(view)[0];
  if (!gate || (gate.reason !== "blocked_user" && gate.reason !== "blocked_authorization")) {
    return null;
  }
  const sessionKey = options?.sessionKey?.trim();
  return {
    id: `ledger-gate:${view.taskId}`,
    taskId: view.taskId,
    title: gate.question,
    reason: gate.reason,
    goal: view.goal,
    ...(sessionKey ? { sessionKey } : {}),
    updatedAtMs: view.lastMeaningfulChangeAtMs,
    ackRequired: true,
  };
}

/** Only non-quiet blocked_user may notify. Authorization stays on the todos card. */
export function shouldNotifyHumanGate(view: ProgressView): boolean {
  return view.emitNotification && view.blockingGate?.reason === "blocked_user";
}
