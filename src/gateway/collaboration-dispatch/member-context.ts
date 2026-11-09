import { buildCollaborationGroupInboundHistory } from "./group-inbound-history.js";
import {
  buildSameRoundContext,
  formatSameRoundContextForPrompt,
  type SameRoundReply,
} from "./same-round-context.js";

/** Conservative serialized-character ceiling; model token admission remains authoritative. */
export const COLLABORATION_MEMBER_CONTEXT_MAX_CHARS = 24_000;

export class CollaborationMemberContextBudgetError extends Error {
  constructor(readonly actualChars: number) {
    super(
      `协作上下文超过输入上限（${actualChars}/${COLLABORATION_MEMBER_CONTEXT_MAX_CHARS} 字符），本成员尚未启动；请缩小讨论范围后重试。`,
    );
    this.name = "CollaborationMemberContextBudgetError";
  }
}

/** Refresh at the Gateway dispatch boundary, not at round creation or inside the executor. */
export function readCollaborationMemberContext(params: {
  readMessages: () => unknown;
  triggeringMessageId: string;
  completedReplies: SameRoundReply[];
}) {
  const groupInboundHistory = buildCollaborationGroupInboundHistory({
    messages: params.readMessages(),
    excludeMessageId: params.triggeringMessageId,
    limit: 24,
  });
  const sameRoundContext = buildSameRoundContext(params.completedReplies);
  const actualChars =
    JSON.stringify(groupInboundHistory).length +
    (sameRoundContext ? formatSameRoundContextForPrompt(sameRoundContext).length : 0);
  // Never silently cut a qualification or instruction from the active history window.
  // No model call has started; the caller reports this as a dispatch failure.
  if (actualChars > COLLABORATION_MEMBER_CONTEXT_MAX_CHARS) {
    throw new CollaborationMemberContextBudgetError(actualChars);
  }
  return { groupInboundHistory, sameRoundContext };
}

/** Conservative UTF-8 byte upper estimate, not an exact tokenizer. Reserve 75%
 * of the selected model window for system/tools/current input/output. */
export function assertMemberContextFitsModel(params: {
  contextWindowTokens: number;
  history: unknown;
  sameRoundContext?: import("./same-round-context.js").SameRoundContext;
}): { estimatedTokens: number; budgetTokens: number } {
  if (!Number.isFinite(params.contextWindowTokens) || params.contextWindowTokens <= 0) {
    throw new Error("协作模型上下文窗口未知，本成员尚未启动");
  }
  const text =
    JSON.stringify(params.history) +
    (params.sameRoundContext ? formatSameRoundContextForPrompt(params.sameRoundContext) : "");
  const estimatedTokens = Buffer.byteLength(text, "utf8");
  const budgetTokens = Math.floor(params.contextWindowTokens / 4);
  if (estimatedTokens > budgetTokens) {
    throw new Error(
      `协作上下文超出当前模型分配预算（保守估计 ${estimatedTokens}/${budgetTokens} tokens），本成员尚未启动`,
    );
  }
  return { estimatedTokens, budgetTokens };
}
