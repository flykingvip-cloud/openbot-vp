/**
 * Persistable / coordinator-bound discuss→task chat receipt.
 * Diagnosis alone is not enough — user and coordinator must see the same fact.
 */
import type { ControlledDiscussToTaskResult } from "./controlled-discuss-to-task.js";
import { formatStagesForUser } from "./discuss-to-task-stages.js";
import {
  factsFromFormalStages,
  projectFormalResponsibilityChain,
} from "./formal-responsibility-chain.js";

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

export function buildDiscussToTaskChatReceipt(
  result: ControlledDiscussToTaskResult,
): DiscussToTaskChatReceiptView {
  const stagesSummary = formatStagesForUser(result.stages);
  const chain = projectFormalResponsibilityChain(factsFromFormalStages(result.stages));
  const taskPart = result.taskId ? `taskId=${result.taskId}` : "taskId=（无）";
  const coordinatorBindingText = [
    "[正式任务入口回执 — 必须绑定，禁止另编任务或口头宣称已派工]",
    `status=${result.statusCode}`,
    taskPart,
    `attempted=${result.attempted}`,
    `stages: ${stagesSummary}`,
    `userMessage: ${result.userMessage}`,
    result.internalReason ? `internalReason=${result.internalReason}` : null,
    `formalNext=${chain.nextEntryPoint ?? "none"}; formalDispatched=${chain.dispatched}; activateDispatched=${chain.activateDispatched}`,
    "claim→plan→policy confirm→wake 各段须有回执；@mention/催办与聊天「完成」不代替该链，也不改变验收。",
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
