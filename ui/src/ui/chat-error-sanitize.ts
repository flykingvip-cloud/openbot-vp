/**
 * 用户可见聊天错误净化（P2）。
 *
 * 回复流水线的内部异常（如陈旧网关的 `ERR_MODULE_NOT_FOUND`、`dist/*` chunk 路径、
 * node_modules 路径、堆栈帧、绝对文件路径）会被 `broadcastChatError({ errorMessage: String(err) })`
 * 原样透传到前端。运行失败进对话记录，不进顶部红色横幅（见
 * `chat/run-failure-transcript.ts`）。把这些内部实现细节
 * 直接暴露给最终用户既不友好也有信息泄露风险。
 *
 * 本函数把「明显是内部/技术性」的错误替换为一句通用可读提示，原始详情仅写入 console 供调试；
 * 对用户本就可读的业务错误（如「未授权」「已达上限」）则原样保留。
 */

const INTERNAL_ERROR_PATTERNS: RegExp[] = [
  /ERR_[A-Z_]+/, // node 错误码，如 ERR_MODULE_NOT_FOUND
  /\b(?:TypeError|ReferenceError|RangeError|SyntaxError):|Cannot read (?:properties|property) of|is not a function/i,
  /cannot find module/i,
  /\/dist\//, // 构建产物 chunk 路径
  /node_modules/,
  /\bat\s+\S+\s+\(.*:\d+:\d+\)/, // 堆栈帧
  /(?:\/(?:Users|home|var|opt|private|tmp)\/)[^\s]+/, // 绝对文件系统路径
  /\.[mc]?[jt]s\b/, // 源文件/构建文件名泄漏（.js/.mjs/.cjs/.ts）
];

/** 通用兜底提示。与仓库内其他内联中文提示风格一致（例：render-actions 的「尚未连接到 Gateway。」）。 */
export const GENERIC_CHAT_ERROR_MESSAGE = "服务暂时不可用，请稍后重试。";
export const MISSING_MODEL_API_KEY_MESSAGE =
  "当前模型没有可用的 API Key，无法生成回复。请在系统设置中为该模型配置密钥后重试。";
export const WORKSPACE_AUTHORIZATION_FAILED_MESSAGE =
  "工作区未授权，当前企业环境不会回退到旧工作区。请从左侧重新选择助手后再试。";
export const CATALOG_PROJECTION_MISS_MESSAGE =
  "助手工作区目录尚未就绪，请稍后重试或联系管理员完成工作区开通。";
export const MISSING_AGENT_ASSET_MESSAGE =
  "当前助手缺少可用资产绑定，请从左侧重新选择助手或联系管理员。";
export const UNKNOWN_COLLABORATION_SPACE_MESSAGE =
  "当前协作空间尚未开通或不可写入。请重新选择小组，或联系管理员完成空间开通。";
export const TRUSTED_TENANT_CONTEXT_REQUIRED_MESSAGE = "需要已验证的企业成员身份才能继续。";
export const COLLABORATION_PERMISSIONS_UNAVAILABLE_MESSAGE = "无法确认协作空间权限，请稍后重试。";
export const COLLABORATION_ACTOR_REQUIRED_MESSAGE = "无法确认你的员工身份，暂不能在该小组发言。";
export const COLLABORATION_NON_MEMBER_WRITE_DENIED_MESSAGE =
  "你可以旁观该小组中自己机器人的动态，但未加入成员不能发言。";
/** Calm line when cloud-PC control times out while the desktop picture is up. */
export const CLOUD_PC_CONTROL_STARTING_BANNER =
  "云电脑还在启动，画面可以先看。这一轮先看屏幕就好。";
/** Protocol/JSON decision failed. The raw SyntaxError stays in logs only. */
export const PROTOCOL_DECISION_FAILED_MESSAGE =
  "这一轮没能形成可执行的决定，没有开始任务。请换一种说法再试。";
export const TRANSCRIPT_IDENTITY_MISMATCH_MESSAGE = "当前身份和企业会话不一致，没有写入对话记录。";

const PROTOCOL_DECISION_FAILED =
  /SyntaxError:|is not valid JSON|Invalid interaction (?:decision|reply|answer|target|task decision|acceptance checks)|Interaction did not return a final decision|Interaction target is not bound/i;

const FAIL_CLOSED_CHAT_ERRORS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /workspace_authorization_failed|workspace authorization failed/i,
    message: WORKSPACE_AUTHORIZATION_FAILED_MESSAGE,
  },
  {
    pattern: /\bcatalog_projection_miss\b/i,
    message: CATALOG_PROJECTION_MISS_MESSAGE,
  },
  {
    pattern: /\bmissing_agent_asset\b/i,
    message: MISSING_AGENT_ASSET_MESSAGE,
  },
  {
    pattern: /unknown collaboration space/i,
    message: UNKNOWN_COLLABORATION_SPACE_MESSAGE,
  },
  {
    pattern: /trusted tenant context required/i,
    message: TRUSTED_TENANT_CONTEXT_REQUIRED_MESSAGE,
  },
  {
    pattern: /failed to resolve collaboration space permissions/i,
    message: COLLABORATION_PERMISSIONS_UNAVAILABLE_MESSAGE,
  },
  {
    pattern: /collaboration group write requires a resolved employee actor/i,
    message: COLLABORATION_ACTOR_REQUIRED_MESSAGE,
  },
  {
    pattern: /you may audit your bot's activity in this group/i,
    message: COLLABORATION_NON_MEMBER_WRITE_DENIED_MESSAGE,
  },
  {
    pattern: /enterprise or user identity does not match this session/i,
    message: TRANSCRIPT_IDENTITY_MISMATCH_MESSAGE,
  },
];

export function isInternalChatError(raw: string): boolean {
  return INTERNAL_ERROR_PATTERNS.some((re) => re.test(raw));
}

/**
 * 净化用户可见错误文案：内部/技术性错误 → 通用提示（原始详情写入 console）；其余原样返回。
 * 传入空值时原样返回（保持 `null`/`undefined` 语义，供上游 `?` 合并）。
 */
export function sanitizeUserFacingChatError<T extends string | null | undefined>(
  raw: T,
): T | string {
  if (!raw) {
    return raw;
  }
  const text = String(raw);
  if (/\binsufficient[_ ]balance(?:_error)?\b/i.test(text)) {
    return "模型服务余额不足，本轮未能生成回复。请联系管理员恢复模型额度后再试。";
  }
  if (
    text.includes("云电脑还在启动") ||
    (/browser control service/i.test(text) && /timed out after \d+ms/i.test(text))
  ) {
    return CLOUD_PC_CONTROL_STARTING_BANNER;
  }
  if (/no api key for provider/i.test(text)) {
    return MISSING_MODEL_API_KEY_MESSAGE;
  }
  const failClosed = FAIL_CLOSED_CHAT_ERRORS.find((entry) => entry.pattern.test(text));
  if (failClosed) {
    return failClosed.message;
  }
  if (PROTOCOL_DECISION_FAILED.test(text)) {
    if (typeof console !== "undefined") {
      console.error("[chat] protocol decision failed (sanitized for UI):", text);
    }
    return PROTOCOL_DECISION_FAILED_MESSAGE;
  }
  if (isInternalChatError(text)) {
    if (typeof console !== "undefined") {
      console.error("[chat] internal error (sanitized for UI):", text);
    }
    return GENERIC_CHAT_ERROR_MESSAGE;
  }
  return raw;
}
