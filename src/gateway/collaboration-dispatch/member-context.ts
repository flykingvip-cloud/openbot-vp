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
