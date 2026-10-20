/**
 * Lightweight push so employee-home signal cards (今日日程 / 待办事项) refresh
 * immediately after authoritative writes, instead of waiting for the 45s poll.
 *
 * Registered from gateway maintenance startup (same pattern as health broadcast).
 * Writers (schedule RPC/tool, meeting lifecycle, org tasks) call
 * `broadcastWorkbenchSignalsInvalidate` after a successful mutation.
 */

export const WORKBENCH_SIGNALS_INVALIDATE_EVENT = "workbench.signals.invalidate" as const;

export type WorkbenchSignalsInvalidateReason =
  | "schedule"
  | "meeting"
  | "task"
  | "mention"
  | "collaboration"
  | "unknown";

export type WorkbenchSignalsInvalidatePayload = {
  reason: WorkbenchSignalsInvalidateReason;
  /** Affected user ids when known (clients may ignore and just refresh). */
  userIds?: string[];
  atMs: number;
};

type BroadcastFn = (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;

let broadcastFn: BroadcastFn | null = null;

export function setWorkbenchSignalsInvalidateBroadcast(fn: BroadcastFn | null): void {
  broadcastFn = fn;
}

export function broadcastWorkbenchSignalsInvalidate(
  params: Omit<WorkbenchSignalsInvalidatePayload, "atMs"> & { atMs?: number },
): void {
  if (!broadcastFn) {
    return;
  }
  const userIds = params.userIds
    ?.map((id) => id.trim())
    .filter(Boolean)
    .filter((id, index, all) => all.indexOf(id) === index);
  const payload: WorkbenchSignalsInvalidatePayload = {
    reason: params.reason,
    atMs: params.atMs ?? Date.now(),
    ...(userIds && userIds.length > 0 ? { userIds } : {}),
  };
  broadcastFn(WORKBENCH_SIGNALS_INVALIDATE_EVENT, payload, { dropIfSlow: true });
}

/** After meeting create/submit/cancel/confirm — refresh 今日日程 / 待办事项 for the organizer. */
export function invalidateOrganizerMeetingWorkbenchSignals(organizerUserId: string): void {
  const userId = organizerUserId.trim();
  if (!userId) {
    return;
  }
  broadcastWorkbenchSignalsInvalidate({ reason: "meeting", userIds: [userId] });
}
