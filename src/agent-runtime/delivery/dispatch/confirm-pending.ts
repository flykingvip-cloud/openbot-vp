import type { OpenBotConfig } from "../../../config/config.js";
import { logVerbose } from "../../../globals.js";
import {
  peekAwaitingDelivery,
  resolveAndTakeAwaitingDelivery,
} from "../../../task-outcome/pending-delivery.js";
import { confirmRunnerTurnDelivery } from "../../../task-outcome/runtime-from-runner.js";
import type { TaskCompletionBinding } from "../../contracts/task.js";
/** Production delivery confirm — exported so tests use this path, not a copy. */
export async function confirmPendingTurnDeliveryWithPorts(
  params: {
    cfg: OpenBotConfig;
    runId?: string;
    /** Stable ids from prepare — required when runId is omitted. */
    deliveryId?: string;
    taskId?: string;
    /** Session key used to resolve agentDir when runId is missing after restart. */
    sessionKey?: string;
    /** Aggregated required-delivery status (AND). enqueue_only alone → delivery_unknown. */
    status: "delivered" | "failed" | "delivery_unknown";
    error?: string;
  },
  ports: {
    resolvePersistRoot: (config: OpenBotConfig, sessionKey: string) => string;
    completeTask: (input: {
      sessionFile: string;
      binding: TaskCompletionBinding;
      closed: boolean;
      appendNotice: boolean;
    }) => { persisted: boolean };
    bindingCurrent: (sessionFile: string, binding: TaskCompletionBinding) => boolean;
  },
): Promise<void> {
  const runId = params.runId?.trim() || undefined;
  const deliveryId = params.deliveryId?.trim() || undefined;
  const taskId = params.taskId?.trim() || undefined;
  const sessionKey = params.sessionKey?.trim() || undefined;
  let persistRoot: string | undefined;
  if (sessionKey) {
    persistRoot = ports.resolvePersistRoot(params.cfg, sessionKey);
  }

  // R85e: persistRoot alone cannot locate a record — need runId / deliveryId / taskId.
  // askOutcome P1: observe missing locators; never guess session pending or clear.
  if (!runId && !deliveryId && !taskId) {
    logVerbose(
      [
        "event=confirm_skipped_no_locator_ids",
        "source=confirmPendingTurnDelivery",
        `hasRunId=0`,
        `hasDeliveryId=0`,
        `hasTaskId=0`,
        `hasSessionKey=${sessionKey ? 1 : 0}`,
        `persistScopeResolvable=${persistRoot ? 1 : 0}`,
        `status=${params.status}`,
      ].join(" "),
    );
    return;
  }

  const lookup = {
    ...(runId ? { runId } : {}),
    ...(deliveryId ? { deliveryId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(persistRoot ? { persistRoot } : {}),
  };
  const pending = peekAwaitingDelivery(lookup);
  if (
    !pending ||
    (runId && pending.runId !== runId) ||
    (deliveryId && pending.deliveryId !== deliveryId) ||
    (taskId && pending.taskId !== taskId)
  ) {
    return;
  }
  try {
    const confirmed = await confirmRunnerTurnDelivery(params.cfg, pending.agentId, {
      taskId: pending.taskId,
      deliveryId: pending.deliveryId,
      status: params.status,
      ...(params.error ? { failureDetail: params.error } : {}),
    });
    // Keep reconciliation identity unless persistence confirms this exact receipt.
    if (
      !confirmed ||
      confirmed.record.taskId !== pending.taskId ||
      confirmed.record.decisiveRunId !== pending.runId ||
      confirmed.record.deliveryId !== pending.deliveryId ||
      confirmed.record.delivery.status !== params.status
    ) {
      return;
    }
    if (
      params.status === "delivered" &&
      confirmed?.record.delivery.status === "delivered" &&
      confirmed.record.taskId === pending.taskId &&
      confirmed.record.decisiveRunId === pending.runId &&
      confirmed.record.deliveryId === pending.deliveryId &&
      confirmed.record.acceptance.status === "passed" &&
      pending.checkedTask
    ) {
      const completed = ports.completeTask({
        sessionFile: pending.checkedTask.sessionFile,
        binding: pending.checkedTask.binding,
        closed: true,
        appendNotice: false,
      });
      if (
        !completed.persisted &&
        ports.bindingCurrent(pending.checkedTask.sessionFile, pending.checkedTask.binding)
      ) {
        return; // Retain the durable association after transient lock failure.
      }
    }
    // A transport receipt cannot discard an unresolved task-acceptance association.
    if (
      params.status === "delivered" &&
      pending.checkedTask &&
      confirmed.record.acceptance.status !== "passed"
    ) {
      return;
    }
    // R85e: unknown is not terminal — keep durable association for later verify.
    // Only clear after delivered / failed (or explicit abandon elsewhere).
    if (params.status === "delivered" || params.status === "failed") {
      resolveAndTakeAwaitingDelivery({
        runId: pending.runId,
        deliveryId: pending.deliveryId,
        taskId: pending.taskId,
        ...(persistRoot ? { persistRoot } : {}),
      });
    }
  } catch (err) {
    logVerbose(
      `dispatch-from-config: delivery confirm failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
