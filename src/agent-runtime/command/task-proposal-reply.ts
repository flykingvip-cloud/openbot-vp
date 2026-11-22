import type { InteractionModelDecision } from "../contracts/interaction.js";

export type TaskProposalMutationResult =
  | { kind: "applied"; text: string }
  | { kind: "unconfirmed"; text: string }
  | { kind: "rejected"; reason: string };

/** The host outcome alone acknowledges mutations; model answers never imply success. */
export function formatTaskProposalReply(
  decision: Extract<InteractionModelDecision, { kind: "task_change" | "task_control" }>,
  result: TaskProposalMutationResult,
): string {
  if (result.kind === "applied") {
    // Status is a board observation, never a model-authored execution claim.
    if (decision.kind === "task_control" && decision.action === "status") {
      return result.text;
    }
    return [decision.answer, result.text].filter(Boolean).join("\n\n");
  }
  // Applied-but-not-effective facts come only from the host. A model answer
  // must not be presented as proof that the new revision is already running.
  if (result.kind === "unconfirmed") {
    return result.text;
  }
  if (result.reason === "task_mutation_unconfirmed") {
    return "暂时无法确认任务操作是否已写入；没有自动重试，请先核对任务状态。";
  }
  return result.reason === "resume_requires_live_recheck"
    ? "恢复需要重新校验授权和停止状态，请使用任务板的恢复操作。"
    : "任务状态已变化或变更未获准，本次未修改；请确认当前任务后重试。";
}
