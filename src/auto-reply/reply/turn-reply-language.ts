import {
  buildCollaborationGroupInboundHistory,
  type CollaborationInboundHistoryEntry,
} from "../../gateway/collaboration-dispatch/group-inbound-history.js";
import {
  formatCollaborationReplyLanguageInstruction,
  formatTurnProcessPlaceholder,
  resolveCollaborationReplyLanguage,
  sanitizeCollaborationVisibleReply,
  type CollaborationReplyLanguage,
} from "../../gateway/collaboration-dispatch/reply-language.js";

export { formatTurnProcessPlaceholder };

export type TurnReplyLanguageContext = {
  userMessage: string;
  sessionMessages?: unknown[];
  historyLimit?: number;
};

export function buildTurnInboundHistory(
  sessionMessages: unknown[] | undefined,
  limit?: number,
): CollaborationInboundHistoryEntry[] {
  if (!sessionMessages || sessionMessages.length === 0) {
    return [];
  }
  return buildCollaborationGroupInboundHistory({
    messages: sessionMessages,
    limit,
  });
}

/** Resolve per-turn reply language for single-chat and non-collaboration paths. */
export function resolveTurnReplyLanguage(
  params: TurnReplyLanguageContext,
): CollaborationReplyLanguage | null {
  return resolveCollaborationReplyLanguage({
    userMessage: params.userMessage,
    inboundHistory: buildTurnInboundHistory(params.sessionMessages, params.historyLimit),
  });
}

export function buildTurnReplyLanguageInstruction(
  language: CollaborationReplyLanguage | null,
): string {
  return [
    formatCollaborationReplyLanguageInstruction(language),
    "对用户可见的回复保持简短，通常不超过三句，把结论、依据和下一步写进句子里。不要列提纲，也不要写出「结论」「依据」「下一步」「给回复」这些字样。用户已经说清任务时直接给成果，不要写过程。",
    "已生成文件时，信封外只留一句，正文放进 <<DELIVERABLE>>。",
    // 上面的"直接给成果、不要写过程"只适用于工具真的取到内容的情况。工具报错时
    // 模型仍然照此输出成果，就会按文件名/标题编出一份看似合理的结果（例如 pdf 工具
    // 三次失败后仍给出"两句话总结"）。失败必须盖过简洁要求。
    "工具返回 status=error 或没取到内容时：如实说出哪一步失败、失败原因，不得用文件名、标题或常识把结果补全，也不要输出 <<DELIVERABLE>>。",
    "用户说「这份」「上面的」「重新生成」「重新同步」时，目标是本会话上一份已声明成果，不要请用户再上传。",
  ].join("\n");
}

export function sanitizeTurnVisibleReply(params: {
  text: string;
  expectedLanguage: CollaborationReplyLanguage | null;
}): ReturnType<typeof sanitizeCollaborationVisibleReply> {
  return sanitizeCollaborationVisibleReply(params);
}
