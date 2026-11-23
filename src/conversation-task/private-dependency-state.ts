import type { SessionTaskBoard } from "../agent-runtime/contracts/task.js";
import { resolveDependencyBlock } from "../agent-runtime/policy/index.js";
import { revalidateContinueTicket } from "../agent-runtime/state/continuation-ticket.js";
import type { PrivateDependency } from "./private-dependency-store.js";
export function isDependencyParentCurrent(
  row: PrivateDependency,
  board: SessionTaskBoard,
): boolean {
  return (
    revalidateContinueTicket({
      board,
      taskId: row.parent.taskId,
      focusRevision: row.parent.focusRevision,
    }).ok && board.current?.executionAttempt === row.parent.executionAttempt
  );
}
export function isDependencyWakeCurrent(row: PrivateDependency, board: SessionTaskBoard): boolean {
  return (
    revalidateContinueTicket({
      board,
      taskId: row.parent.taskId,
      focusRevision: row.parent.focusRevision,
    }).ok && board.current?.executionAttempt === row.wakeRunId
  );
}
export function settleDependency(
  row: PrivateDependency,
  state: "completed" | "partial" | "failed" | "timed_out",
  reason?: "permission" | "payment" | "missing_user_fact",
): PrivateDependency {
  if (row.wakeState !== "none" || !["dispatching", "waiting"].includes(row.state)) {
    return row;
  }
  const resolution =
    state === "completed"
      ? undefined
      : resolveDependencyBlock({
          reason:
            reason ??
            (state === "timed_out" ? "timeout" : state === "partial" ? "partial" : "child_failed"),
          // Host-owned original-scope review; never accept model-authorized alternatives.
          fallbacks: [
            { id: "parent_review", authorized: true, reversible: true, attempted: false },
          ],
          retryCount: 0,
          maxRetries: 1,
        });
  return {
    ...row,
    state,
    resolution,
    reason,
    wakeState: resolution?.kind === "needs_user" ? "needs_user" : "pending",
  };
}

export function dependencyActivityFacts(
  rows: readonly PrivateDependency[],
  sessionKey: string,
  taskId: string,
  attempt?: string,
) {
  const current = rows.filter(
    (r) =>
      r.parent.sessionKey === sessionKey &&
      r.parent.taskId === taskId &&
      (r.parent.executionAttempt === attempt || r.wakeRunId === attempt) &&
      r.wakeState !== "invalidated",
  );
  if (!current.length) {
    return null;
  }
  const waitingCount = current.filter(
    (r) => ["dispatching", "waiting"].includes(r.state) && r.wakeState === "none",
  ).length;
  const future = current
    .filter((r) => r.wakeState === "sending")
    .map((r) => r.wakeLeaseUntilMs ?? 0);
  return {
    taskId,
    waitingCount,
    needsUser: current.some((r) => r.wakeState === "needs_user"),
    ...(future.length ? { nextWakeAtMs: Math.max(...future) } : {}),
  };
}
