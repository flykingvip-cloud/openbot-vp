/**
 * The only completion-claim judge for user-visible sends.
 * Callers must use this result. They must not keep a private keyword list.
 */

export const FIXED_PROGRESS_TEMPLATE = "正在处理，结果尚未对外公布。";

export type CompletionSendOutcome =
  | "progress_allowed"
  | "completion_blocked"
  | "completion_allowed";

export type CompletionDecisionCode =
  | "completion_claim_blocked_pending_validation"
  | "progress_message_allowed"
  | "delivery_receipt_verified";

export type CompletionJudgement = {
  outcome: CompletionSendOutcome;
  decisionCode: CompletionDecisionCode;
  visibleText: string;
};

const CLAIM_PATTERNS: readonly RegExp[] = [
  /已完成|完成了|交付完成|任务完成|处理完毕|已处理完毕|可以交付了|可以交付/,
  /已生成/,
  /已经?[^,，。\n]{0,8}(完成|做完|处理完|生成好|发出去|发送完|搞定|弄好|办好)/u,
  /(完成|做完|发出去|搞定|弄好|办好|处理完)(了|啦)/u,
  /\b(?:done|completed|finished)\b/iu,
];

export function isFixedProgressTemplate(text: string): boolean {
  return text.trim() === FIXED_PROGRESS_TEMPLATE;
}

/** True when the text claims completion. The fixed progress template never matches. */
export function textHasCompletionClaim(text: string): boolean {
  if (isFixedProgressTemplate(text)) {
    return false;
  }
  return CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

export function judgeCompletionSend(params: {
  text: string;
  validatorsRequired: boolean;
  allowedToDeliver: boolean;
}): CompletionJudgement {
  const claim = textHasCompletionClaim(params.text);
  if (!params.validatorsRequired) {
    return {
      outcome: claim ? "completion_allowed" : "progress_allowed",
      decisionCode: "progress_message_allowed",
      visibleText: params.text,
    };
  }
  if (claim && params.allowedToDeliver) {
    return {
      outcome: "completion_allowed",
      decisionCode: "delivery_receipt_verified",
      visibleText: params.text,
    };
  }
  if (claim) {
    return {
      outcome: "completion_blocked",
      decisionCode: "completion_claim_blocked_pending_validation",
      visibleText: FIXED_PROGRESS_TEMPLATE,
    };
  }
  return {
    outcome: "progress_allowed",
    decisionCode: "progress_message_allowed",
    visibleText: params.text,
  };
}
