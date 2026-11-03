import { stripInboundStampForDialogue } from "../../agent-runtime/command/index.js";
export {
  stripInboundStampForDialogue,
  isProgressStatusQuery,
  formatTaskBoardProgressReply,
} from "../../agent-runtime/command/index.js";

export function formatAmendConstraintAck(prompt: string): string {
  const cleaned = stripInboundStampForDialogue(prompt).replace(/\s+/g, " ").trim();
  const short = cleaned.length > 60 ? `${cleaned.slice(0, 60)}…` : cleaned;
  return `已将补充约束注入当前执行（仅一次）：${short || "（空）"}。后台任务继续，不会因这条补充另起一轮业务执行。`;
}
