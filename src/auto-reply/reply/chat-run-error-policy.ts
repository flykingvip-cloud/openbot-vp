/**
 * Chat-scoped run errors stay in the transcript.
 *
 * A top danger rail reads as "the bot crashed" even when the turn only failed
 * a tool or a runtime read. The user should see the failure as a chat message
 * and continue, or pick another approach.
 *
 * Evolution handoff (`chat-run-error-escalation.ts`) runs only when that chat
 * message cannot resolve the failure: missing keys, workspace auth, and
 * collaboration permission copy are instructions the user can act on, so they
 * do not open a candidate experience capsule.
 */

const CRASH_LIKE_RUN_FAILURE =
  /cannot read propert(?:y|ies) of |reading ['"][\w$.]+['"]|\b(?:TypeError|ReferenceError|SyntaxError)\b|is not a function\b|is not iterable\b|is not a constructor\b|\bERR_[A-Z0-9_]+\b|cannot find module|node_modules|\/dist\/|\bat\s+\S+\s+\(.*:\d+:\d+\)|Maximum call stack size exceeded|too much recursion|^chat error$/i;

const AGENT_RUN_BUSINESS_FAILURE =
  /no api key for provider|workspace_authorization_failed|workspace authorization failed|\bcatalog_projection_miss\b|\bmissing_agent_asset\b|unknown collaboration space|trusted tenant context required|failed to resolve collaboration space permissions|collaboration group write requires a resolved employee actor|you may audit your bot's activity in this group|当前模型没有可用的 API Key|工作区未授权|助手工作区目录尚未就绪|当前助手缺少可用资产绑定|当前协作空间尚未开通|需要已验证的企业成员身份|无法确认协作空间权限|无法确认你的员工身份|未加入成员不能发言|服务暂时不可用/i;

/** Failures the person can clear from the chat instruction (key, auth, permission). */
const CHAT_RESOLVABLE_RUN_FAILURE =
  /no api key for provider|unauthorized|forbidden|\bapi key\b|workspace_authorization_failed|workspace authorization failed|\bcatalog_projection_miss\b|\bmissing_agent_asset\b|unknown collaboration space|trusted tenant context required|failed to resolve collaboration space permissions|collaboration group write requires a resolved employee actor|you may audit your bot's activity in this group|当前模型没有可用的 API Key|工作区未授权|助手工作区目录尚未就绪|当前助手缺少可用资产绑定|当前协作空间尚未开通|需要已验证的企业成员身份|无法确认协作空间权限|无法确认你的员工身份|未加入成员不能发言/i;

export function isChatScopedRunFailure(errorMessage: string | null | undefined): boolean {
  const text = errorMessage?.trim() ?? "";
  if (!text) {
    return false;
  }
  return CRASH_LIKE_RUN_FAILURE.test(text) || AGENT_RUN_BUSINESS_FAILURE.test(text);
}

export function chatCanResolveRunError(errorMessage: string | null | undefined): boolean {
  const text = errorMessage?.trim() ?? "";
  if (!text) {
    return false;
  }
  return CHAT_RESOLVABLE_RUN_FAILURE.test(text);
}

/**
 * True when a chat run error should enter the evolution loop.
 * Empty and placeholder "chat error" notices carry no lesson.
 * User-resolvable copy stays in the transcript only.
 */
export function shouldEscalateChatRunError(errorMessage: string | null | undefined): boolean {
  const text = errorMessage?.trim() ?? "";
  if (!text || /^chat error$/i.test(text)) {
    return false;
  }
  return !chatCanResolveRunError(text);
}

/** Stable capsule reason. Detail keeps the raw text; this value is the dedupe key. */
export function classifyChatRunFailureReason(errorMessage: string): string {
  const text = errorMessage.trim();
  const code = text.match(/\b(ERR_[A-Z0-9_]+)\b/);
  if (code?.[1]) {
    return code[1].toLowerCase();
  }
  if (/cannot read propert/i.test(text) || /reading ['"][\w$.]+['"]/.test(text)) {
    return "undefined_property";
  }
  if (/cannot find module/i.test(text)) {
    return "missing_module";
  }
  if (/Maximum call stack size exceeded|too much recursion/i.test(text)) {
    return "stack_overflow";
  }
  if (/\/dist\/|node_modules|\bat\s+\S+\s+\(.*:\d+:\d+\)/.test(text)) {
    return "internal_error";
  }
  return "chat_run_error";
}
