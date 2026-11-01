/**
 * Chat completion phrases are not an acceptance form.
 * Real acceptance goes through submitBoardItemForReview →
 * returnBoardItemSubmission → acceptBoardItemSubmission (permissions,
 * submission version, linked deliverable, criteria). This module only
 * names the bare chat phrase refuse used at the accept entry.
 */

export const CHAT_COMPLETION_IS_NOT_ACCEPTANCE = "chat_completion_is_not_acceptance";

const BARE_CHAT_COMPLETION =
  /^(?:完成|已完成|闭环完成|任务完成|任务已完成|本轮完成|本轮已完成|done|completed)[\s。.!！…]*$/iu;

/** True when the text is only a chat completion claim, not an audit rationale. */
export function isBareChatCompletionPhrase(value: string | null | undefined): boolean {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return false;
  }
  return BARE_CHAT_COMPLETION.test(text);
}
