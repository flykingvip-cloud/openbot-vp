/**
 * Persistable / coordinator-bound discuss→task chat receipt.
 * Diagnosis alone is not enough — user and coordinator must see the same fact.
 * Formal next steps come from real activation/board entries (stages + formalClaim),
 * not from a projector that invents placeholder receipt refs or prompt-only entry names.
 */
import type { ControlledDiscussToTaskResult } from "./controlled-discuss-to-task.js";
import { formatStagesForUser } from "./discuss-to-task-stages.js";

export type DiscussToTaskChatReceiptView = {
  statusCode: string;
  userMessage: string;
  taskId: string | null;
  attempted: boolean;
  stagesSummary: string;
  internalReason?: string;
  /** Text that must be injected into the coordinator context for this turn. */
  coordinatorBindingText: string;
};

function formatFormalClaimLine(result: ControlledDiscussToTaskResult): string | null {
  const activation = result.activation;
  if (
    !activation ||
    (activation.status !== "activated" && activation.status !== "partial_success")
  ) {
    return null;
  }
  const formalClaim = activation.formalClaim;
  if (!formalClaim) {
    return null;
  }
  if (formalClaim.outcome === "claimed") {
    return `formalClaim=claimed; claimantId=${formalClaim.claimantId}; activateDispatched=false`;
  }
  if (formalClaim.outcome === "scheduled") {
    return `formalClaim=scheduled; scheduledClaimantId=${formalClaim.scheduledClaimantId}; wakeRecorded=${formalClaim.wakeRecorded}; nextEntry=${formalClaim.nextEntryPoint}; activateDispatched=false`;
  }
  if (formalClaim.outcome === "blocked") {
    return `formalClaim=blocked; reason=${formalClaim.reason}; nextEntry=${formalClaim.nextEntryPoint}; activateDispatched=false`;
  }
  return `formalClaim=unchanged; reason=${formalClaim.reason}; activateDispatched=false`;
}

export function buildDiscussToTaskChatReceipt(
  result: ControlledDiscussToTaskResult,
): DiscussToTaskChatReceiptView {
  const stagesSummary = formatStagesForUser(result.stages);
  const taskPart = result.taskId ? `taskId=${result.taskId}` : "taskId=（无）";
  const formalClaimLine = formatFormalClaimLine(result);
  const coordinatorBindingText = [
    "[正式任务入口回执 — 必须绑定，禁止另编任务或口头宣称已派工]",
    `status=${result.statusCode}`,
    taskPart,
    `attempted=${result.attempted}`,
    `stages: ${stagesSummary}`,
    `userMessage: ${result.userMessage}`,
    result.internalReason ? `internalReason=${result.internalReason}` : null,
    formalClaimLine,
    "认领须走 claimCollaborationBoardItem；计划确认后人闸不得绕过；聊天「完成」不改变 board accepted。",
    "后续工具与回复必须引用上述 taskId（若有）；不得虚构新的正式任务身份。",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    statusCode: result.statusCode,
    userMessage: result.userMessage,
    taskId: result.taskId,
    attempted: result.attempted,
    stagesSummary,
    ...(result.internalReason ? { internalReason: result.internalReason } : {}),
    coordinatorBindingText,
  };
}

/** User-visible system status line (transcript / UI). */
export function formatDiscussToTaskUserVisibleStatus(
  result: ControlledDiscussToTaskResult,
): string {
  const view = buildDiscussToTaskChatReceipt(result);
  const bits = [view.userMessage];
  if (view.taskId) {
    bits.push(`（${view.taskId}；${view.stagesSummary}）`);
  } else {
    bits.push(`（${view.stagesSummary}）`);
  }
  return bits.join(" ");
}
