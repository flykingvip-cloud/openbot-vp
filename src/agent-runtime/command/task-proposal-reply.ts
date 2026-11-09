import type { InteractionModelDecision } from "../contracts/interaction.js";

/** The host outcome alone acknowledges mutations; model answers never imply success. */
export function formatTaskProposalReply(
  decision: Extract<InteractionModelDecision, { kind: "task_change" | "task_control" }>,
  result: { kind: "applied"; text: string } | { kind: "rejected"; reason: string },
): string {
  if (result.kind === "applied") {
    return [decision.answer, result.text].filter(Boolean).join("\n\n");
  }
  return result.reason === "resume_requires_live_recheck"
    ? "恢复需要重新校验授权和停止状态，请使用任务板的恢复操作。"
    : "任务状态已变化或变更未获准，本次未修改；请确认当前任务后重试。";
}
