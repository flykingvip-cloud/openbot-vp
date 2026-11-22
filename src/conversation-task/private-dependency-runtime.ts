/** Persistent private delegation waits. Events are observations, not completion claims. */
import { timingSafeEqual } from "node:crypto";
import { sessionTaskState } from "../agent-runtime/state/index.js";
import { callGateway } from "../gateway/call.js";
import { conversationSeatAgentIds } from "../gateway/conversation-seat-grants.js";
import {
  loadSessionEntryForClient,
  toGatewayClientFromSessionHint,
} from "../gateway/tenant-context.js";
import { onAgentEvent, type AgentEventPayload } from "../infra/agent-events.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  isDependencyParentCurrent,
  isDependencyWakeCurrent,
  settleDependency,
} from "./private-dependency-state.js";
import {
  listPrivateDependencies,
  readPrivateDependency,
  updatePrivateDependency,
  type PrivateDependency,
} from "./private-dependency-store.js";

export function dependencyCapabilityMatches(row: PrivateDependency, value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{64}$/.test(value) &&
    /^[a-f0-9]{64}$/.test(row.capability) &&
    timingSafeEqual(Buffer.from(value, "hex"), Buffer.from(row.capability, "hex"))
  );
}
export async function authorizePrivateDependency(row: PrivateDependency): Promise<boolean> {
  const ids = await conversationSeatAgentIds(row.tenantId, row.ownerId);
  if (!ids.includes(row.child.agentId)) {
    return false;
  }
  const client = toGatewayClientFromSessionHint({
    platformUserId: row.ownerId,
    sessionDomain: "employee",
    sessionTenantId: row.tenantId,
  });
  const parent = await loadSessionEntryForClient(row.parent.sessionKey, client);
  return parent.entry?.sessionFile === row.parent.sessionFile;
}
async function childCompleted(row: PrivateDependency): Promise<boolean> {
  const client = toGatewayClientFromSessionHint({
    platformUserId: row.ownerId,
    sessionDomain: "employee",
    sessionTenantId: row.tenantId,
  });
  const loaded = await loadSessionEntryForClient(row.child.sessionKey, client);
  const file = loaded.entry?.sessionFile;
  if (!file) {
    return false;
  }
  const child = sessionTaskState.read(file).current;
  return Boolean(
    child &&
    child.executionAttempt === row.child.runId &&
    !child.unfinished &&
    child.deliverableChecked === true,
  );
}
export type PrivateDependencyPorts = {
  authorize: (row: PrivateDependency) => Promise<boolean>;
  childCompleted: (row: PrivateDependency) => Promise<boolean>;
  parentBusy: (row: PrivateDependency) => boolean;
  wakeRunning: (row: PrivateDependency) => boolean;
  wake: (row: PrivateDependency) => Promise<void>;
};
const defaultPorts: PrivateDependencyPorts = {
  authorize: authorizePrivateDependency,
  childCompleted,
  parentBusy: () => false,
  wakeRunning: () => false,
  wake: async (row) => {
    await callGateway({
      method: "chat.send",
      params: {
        sessionKey: row.parent.sessionKey,
        idempotencyKey: row.wakeRunId,
        dependencyResumeId: row.id,
        dependencyResumeCapability: row.capability,
        message:
          row.state === "completed"
            ? "内部依赖回件已通过子任务交付检查。请在原任务范围内审阅回件并继续原验收，不把子任务完成等同父任务完成。"
            : "内部依赖未形成经核验的完整交付。请在原授权范围内审阅已有回件并自行完成可逆步骤；不得扩大权限或对外发送。若确需用户事实或授权，记录明确待办。",
        deliver: false,
      },
      timeoutMs: 15_000,
    });
  },
};
let inFlight = false;
/** Lease makes a crashed consumer retryable; fixed wake ID prevents duplicate admissions. */
export async function tickPrivateDependencies(
  options: { nowMs?: number; root?: string; ports?: Partial<PrivateDependencyPorts> } = {},
): Promise<void> {
  if (inFlight) {
    return;
  }
  inFlight = true;
  const now = options.nowMs ?? Date.now();
  const ports = { ...defaultPorts, ...options.ports };
  try {
    for (const saved of listPrivateDependencies(options.root)
      .filter((r) => !["invalidated", "needs_user"].includes(r.wakeState))
      .slice(0, 200)) {
      let row = readPrivateDependency(saved.id, options.root)!;
      if (["invalidated", "needs_user"].includes(row.wakeState)) {
        continue;
      }
      const board = sessionTaskState.read(row.parent.sessionFile);
      const ownWake = isDependencyWakeCurrent(row, board);
      if (ownWake && ports.wakeRunning(row)) {
        await updatePrivateDependency(
          row.id,
          (r) => ({ ...r, wakeState: "accepted" }),
          options.root,
        );
        continue;
      }
      if (row.wakeState === "accepted" && ownWake) {
        await updatePrivateDependency(
          row.id,
          (r) => ({
            ...r,
            wakeState: "needs_user",
            reason: "parent_review_interrupted",
            resolution: { kind: "needs_user", reason: "retry_budget_exhausted" },
          }),
          options.root,
        );
        continue;
      }
      if (!ownWake && !isDependencyParentCurrent(row, board)) {
        await updatePrivateDependency(
          row.id,
          (r) => ({ ...r, wakeState: "invalidated", reason: "parent_changed" }),
          options.root,
        );
        continue;
      }
      if (!(await ports.authorize(row))) {
        await updatePrivateDependency(
          row.id,
          (r) => ({
            ...settleDependency(r, "failed", "permission"),
            wakeState: "needs_user",
            reason: "permission",
          }),
          options.root,
        );
        continue;
      }
      if (["dispatching", "waiting"].includes(row.state)) {
        if (await ports.childCompleted(row)) {
          row = (await updatePrivateDependency(
            row.id,
            (r) => settleDependency(r, "completed"),
            options.root,
          ))!;
        } else if (now >= row.deadlineAtMs) {
          row = (await updatePrivateDependency(
            row.id,
            (r) => settleDependency(r, "timed_out"),
            options.root,
          ))!;
        }
      }
      if (
        row.wakeState !== "pending" &&
        !(row.wakeState === "sending" && (row.wakeLeaseUntilMs ?? 0) <= now)
      ) {
        continue;
      }
      if (ports.parentBusy(row)) {
        continue;
      }
      let claimed = false;
      const lease = await updatePrivateDependency(
        row.id,
        (r) => {
          if (
            r.wakeState !== "pending" &&
            !(r.wakeState === "sending" && (r.wakeLeaseUntilMs ?? 0) <= now)
          ) {
            return r;
          }
          if ((r.wakeAttempts ?? 0) >= 2) {
            return { ...r, wakeState: "needs_user", reason: "wake_failed" };
          }
          claimed = true;
          return {
            ...r,
            wakeState: "sending",
            wakeLeaseUntilMs: now + 30_000,
            wakeAttempts: (r.wakeAttempts ?? 0) + 1,
          };
        },
        options.root,
      );
      if (!claimed || !lease) {
        continue;
      }
      // Recheck after durable lease; an owner stop between checks still wins in chat.send.
      const liveBoard = sessionTaskState.read(lease.parent.sessionFile);
      if (
        !isDependencyParentCurrent(lease, liveBoard) &&
        !isDependencyWakeCurrent(lease, liveBoard)
      ) {
        continue;
      }
      try {
        await ports.wake(lease);
      } catch {
        /* Keep lease pending until retry; never claim a failed enqueue was executed. */
      }
    }
  } finally {
    inFlight = false;
  }
}
export async function observePrivateDependencyEvent(
  event: AgentEventPayload,
  options: { root?: string; ports?: Partial<PrivateDependencyPorts> } = {},
): Promise<void> {
  if (event.stream !== "lifecycle" || !["end", "error"].includes(String(event.data.phase))) {
    return;
  }
  const ports = { ...defaultPorts, ...options.ports };
  for (const row of listPrivateDependencies(options.root)) {
    if (
      row.wakeRunId === event.runId &&
      (!event.sessionKey || event.sessionKey === row.parent.sessionKey)
    ) {
      const board = sessionTaskState.read(row.parent.sessionFile);
      if (isDependencyWakeCurrent(row, board) && board.current?.unfinished) {
        await updatePrivateDependency(
          row.id,
          (r) => ({
            ...r,
            wakeState: "needs_user",
            reason: "parent_review_exhausted",
            resolution: { kind: "needs_user", reason: "retry_budget_exhausted" },
          }),
          options.root,
        );
      }
      continue;
    }
    if (
      row.child.runId !== event.runId ||
      (event.sessionKey && event.sessionKey !== row.child.sessionKey)
    ) {
      continue;
    }
    if (!(await ports.authorize(row))) {
      continue;
    }
    const completed = event.data.phase === "end" && (await ports.childCompleted(row));
    await updatePrivateDependency(
      row.id,
      (r) => {
        if ((r.eventSeq ?? -1) >= event.seq) {
          return r;
        }
        return {
          ...settleDependency(
            r,
            completed ? "completed" : event.data.phase === "error" ? "failed" : "partial",
          ),
          eventSeq: event.seq,
        };
      },
      options.root,
    );
  }
}
const dependencyLog = createSubsystemLogger("private-dependency");
let eventUnsubscribe: (() => void) | undefined;
export function startPrivateDependencyEvents(): void {
  if (!eventUnsubscribe) {
    eventUnsubscribe = onAgentEvent((event) => {
      void observePrivateDependencyEvent(event).catch(() =>
        dependencyLog.warn("dependency_event_observation_failed", { runId: event.runId }),
      );
    });
  }
}
