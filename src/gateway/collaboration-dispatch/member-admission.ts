import type { OpenBotConfig } from "../../config/types.js";
import type { ExecutionDeliverableBinding } from "../collaboration-learning/execution-deliverable-binding.js";
import { assertPersistedTaskNotStopped } from "../collaboration-learning/task-stop-entry.js";
import { resolveStoresFromGroupLocator } from "../collaboration-learning/team-resource-auth.js";
import { tryBuildChatActorExecutionDeliverableBinding } from "../collaboration-learning/try-build-chat-actor-deliverable-binding.js";
import { loadBoardClaimItem } from "./claim-contract.js";
import type { ExecutionTaskBag } from "./executor-private-todolist.js";
import { evaluateDeliveryExecGateForBoardItem } from "./plan-gate-exec.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import { recheckCurrentDispatchAuthorization } from "./task-dispatch-auth-recheck.js";

export type MemberAdmission =
  | { purpose: "discussion" }
  | { purpose: "formal_execution"; binding: ExecutionDeliverableBinding; taskBag: ExecutionTaskBag }
  | { purpose: "blocked"; reason: string };

/** Authority derives execution purpose from current claim + confirmed plan, never a role label. */
export async function resolveMemberAdmission(params: {
  authority: RuntimeAuthority;
  agentId: string;
  runId: string;
  taskId?: string | null;
  executionRequested: boolean;
  cfg?: OpenBotConfig;
}): Promise<MemberAdmission> {
  if (!params.executionRequested) {
    return { purpose: "discussion" };
  }
  const binding = await tryBuildChatActorExecutionDeliverableBinding({
    authority: params.authority,
    agentId: params.agentId,
    runId: params.runId,
    taskIdHint: params.taskId,
    cfg: params.cfg,
  });
  if (!binding) {
    return { purpose: "blocked", reason: "formal_claim_required" };
  }
  const stores = resolveStoresFromGroupLocator({
    groupLocator: params.authority.namespace.groupLocator,
    cfg: params.cfg,
  });
  if (!stores.ok) {
    return { purpose: "blocked", reason: "trusted_task_store_required" };
  }
  const task = await assertPersistedTaskNotStopped({
    groupId: binding.groupId,
    taskId: binding.taskId,
    cfg: params.cfg,
    objectStorage: stores.objectStorage,
  });
  if (!task) {
    return { purpose: "blocked", reason: "formal_task_missing" };
  }
  const auth = await recheckCurrentDispatchAuthorization({
    groupId: binding.groupId,
    taskId: binding.taskId,
    targetActorIds: [params.agentId],
    cfg: params.cfg,
    fileStore: stores.fileStore,
    objectStorage: stores.objectStorage,
  });
  if (!auth.ok) {
    return { purpose: "blocked", reason: auth.reason };
  }
  const boardItem = await loadBoardClaimItem(params.authority, {
    taskId: binding.taskId,
    itemId: binding.boardItemId,
  });
  if (!boardItem) {
    return { purpose: "blocked", reason: "formal_board_missing" };
  }
  const gate = await evaluateDeliveryExecGateForBoardItem(params.authority, {
    boardItem,
    ownerMemberId: params.agentId,
  });
  if (gate.mode !== "delivery_exec" || !gate.taskBag) {
    return { purpose: "blocked", reason: gate.reason };
  }
  return { purpose: "formal_execution", binding, taskBag: gate.taskBag };
}

/** Public speaking slots cannot grant or deny a formally admitted task turn. */
export function memberSpeakingGate(admission: MemberAdmission, speakingLimitReached: boolean) {
  if (admission.purpose === "blocked") {
    return { allowed: false, reason: admission.reason };
  }
  if (admission.purpose === "formal_execution") {
    return { allowed: true, reason: "formal_execution_admitted" };
  }
  return speakingLimitReached
    ? { allowed: false, reason: "visible_limit" }
    : { allowed: true, reason: "discussion_slot" };
}
