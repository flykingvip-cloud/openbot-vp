/**
 * Best-effort: attach a complete wake_dispatch executionDeliverableBinding onto
 * a WakeRoundDispatchRequest before Mode B / deliverable submit.
 *
 * Prefer callers that already built a binding (post-plan-confirm). When missing
 * but the request carries durable task+board+op+attempt+agent, rebuild from the
 * confirmed execution bag. Never mint UUIDs; never invent a binding from OS
 * currentTaskId alone. Incomplete inputs leave the request unchanged.
 */
import type { OpenBotConfig } from "../../config/types.js";
import { loadBoardClaimItem } from "../collaboration-dispatch/claim-contract.js";
import {
  buildExecutionTaskBag,
  loadLatestOwnerTodolistForBoardItem,
} from "../collaboration-dispatch/executor-private-todolist.js";
import type { RuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import type { WakeRoundDispatchRequest } from "../collaboration-dispatch/wake-round-dispatch.js";
import {
  buildExecutionDeliverableBinding,
  normalizeExecutionDeliverableBinding,
  runIdFromWakeOpAttempt,
} from "./execution-deliverable-binding.js";

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export async function attachWakeExecutionDeliverableBinding(params: {
  request: WakeRoundDispatchRequest;
  authority: RuntimeAuthority;
  cfg?: OpenBotConfig;
}): Promise<WakeRoundDispatchRequest> {
  const request = params.request;
  const existing = normalizeExecutionDeliverableBinding(
    request.executionDeliverableBinding ?? null,
  );
  if (existing) {
    return existing === request.executionDeliverableBinding
      ? request
      : { ...request, executionDeliverableBinding: existing };
  }

  const groupId = compact(request.groupId);
  const taskId = compact(request.taskId);
  const boardItemId = compact(request.itemId);
  const agentId = compact(request.toAgentIds?.[0]);
  const opKey = compact(request.wakeOpKey) || compact(request.opKey);
  const attemptId = compact(request.wakeExecutionAttemptId);
  if (!groupId || !taskId || !boardItemId || !agentId || !opKey || !attemptId) {
    return request;
  }

  try {
    const board = await loadBoardClaimItem(params.authority, {
      taskId,
      itemId: boardItemId,
    });
    if (!board) {
      return request;
    }
    const todolist = await loadLatestOwnerTodolistForBoardItem(params.authority, {
      taskId,
      boardItemId,
      ownerMemberId: agentId,
    });
    if (!todolist || todolist.status !== "confirmed") {
      return request;
    }
    const bag = buildExecutionTaskBag({ boardItem: board, todolist });
    const step = bag.todolistCurrentStep;
    if (!bag.planGate.confirmed || !step) {
      return request;
    }
    const stepId = compact(step.stepId);
    if (!stepId) {
      return request;
    }
    const runId = runIdFromWakeOpAttempt({ opKey, attemptId });
    const binding = buildExecutionDeliverableBinding({
      tenantId: request.tenantId ?? params.authority.tenantId ?? null,
      groupId,
      taskId,
      boardItemId,
      todolistId: compact(step.todolistId) || compact(todolist.todolistId),
      planVersion: step.version,
      stepId,
      runId,
      attemptId,
      opKey,
      agentId,
      source: "wake_dispatch",
    });
    if (!binding) {
      return request;
    }
    const todolistIdForPlan = compact(binding.todolistId);
    const planVersionForPlan =
      typeof binding.planVersion === "number" && Number.isFinite(binding.planVersion)
        ? binding.planVersion
        : step.version;
    return {
      ...request,
      executionDeliverableBinding: binding,
      ...(request.planConfirmBinding || !todolistIdForPlan
        ? {}
        : {
            planConfirmBinding: {
              todolistId: todolistIdForPlan,
              confirmedVersion: planVersionForPlan,
              stepId: binding.stepId,
            },
          }),
    };
  } catch {
    return request;
  }
}
