import type { CollaborationPolicyV1, TimeoutTaskType } from "./policy.js";

const PLACEHOLDER_SIGNALS = [
  "我先看看",
  "我看看",
  "稍等",
  "等我一下",
  "收到",
  "好的我先",
  "先看一下",
  "已认领",
  "已记录",
  "processing",
  "let me look",
  "i'll check",
];

const ACK_SIGNAL_LIMIT = 80;

const CHITCHAT_GREETING_RE =
  /^(?:(?:大家|各位|全体)[，,\s]*)?(你好|您好|嗨|大家好|各位好|全体好|hi|hello|hey|在吗|在不在|早上好|下午好|晚上好|中午好|谢谢|感谢|thanks|thx|ok|好的|嗯+|哈+)[!！?？。.\s~～👋🙏]*$/iu;

const CHITCHAT_TASK_VERB_RE =
  /分析|研究|调研|统计|报表|数据|查询|检索|帮忙|请帮|写入|发布|执行|方案|计划|报告|对比|评估|总结|查一下|帮我/u;

/**
 * Narrow collaboration chitchat detector — not inbound-depth. Used only to pick
 * shorter round budgets and skip supplement/wrap for greetings like 「你好」.
 */
export function isCollaborationChitchat(message: string | undefined): boolean {
  const text = message?.trim() ?? "";
  if (!text) {
    return false;
  }
  const compact = text.replace(/\s+/g, "");
  if (CHITCHAT_TASK_VERB_RE.test(compact)) {
    return false;
  }
  if (/研究|调研|资料|论文/.test(compact)) {
    return false;
  }
  if (/数据|统计|报表/.test(compact)) {
    return false;
  }
  if (compact.length > 16) {
    return false;
  }
  if (CHITCHAT_GREETING_RE.test(compact)) {
    return true;
  }
  return compact.length <= 4;
}

const AVAILABILITY_CHECK_RE =
  /^(?:你们|大家|各位|现在|还是|是不是|到底|都|还|全部|全体|请问|问一下)*(?:有人(?:在)?吗|在吗|在不在|不能接任务|能接任务|还能接任务|可以接任务|接得了任务)(?:吗|么|呢|啊|呀|吧)*$/u;

/**
 * The whole utterance is a greeting or "can you take work" check.
 * A shorter real task that merely contains those words is not.
 */
export function isCollaborationAvailabilityCheck(message: string | undefined): boolean {
  const compact = message?.replace(/\s+/g, "").trim() ?? "";
  if (!compact || compact.length > 40) {
    return false;
  }
  if (CHITCHAT_TASK_VERB_RE.test(compact)) {
    return false;
  }
  const body = compact.replace(/[!！?？。.~～👋🙏，,、]+$/u, "");
  return AVAILABILITY_CHECK_RE.test(body);
}

export function isCollaborationSocialCheck(message: string | undefined): boolean {
  return isCollaborationChitchat(message) || isCollaborationAvailabilityCheck(message);
}

/** Spoken stand-in when a must-answer speaker returns NO_REPLY. Not a second round. */
export const COLLABORATION_SOCIAL_FALLBACK_REPLY = "我在。有任务可以直接说。";

export function collaborationSocialSilenceFallback(params: {
  message?: string;
  contributionRole?: string;
  dispatchRole?: string;
}): string | null {
  const mustSpeak =
    isCollaborationSocialCheck(params.message) &&
    (params.contributionRole === "lead" ||
      params.dispatchRole === "primary" ||
      params.dispatchRole === "fallback" ||
      params.dispatchRole === "explicit_member");
  return mustSpeak ? COLLABORATION_SOCIAL_FALLBACK_REPLY : null;
}

export function resolveTimeoutTaskType(params: {
  responseMode?: string;
  inboundDepth?: "chat" | "retrieve" | "act";
  message?: string;
}): TimeoutTaskType {
  if (params.inboundDepth === "act") {
    return "execution";
  }
  if (params.inboundDepth === "retrieve") {
    return "knowledge";
  }
  const text = params.message?.replace(/\s+/g, "") ?? "";
  if (/研究|调研|资料|论文/.test(text)) {
    return "research";
  }
  if (/数据|统计|报表/.test(text)) {
    return "data";
  }
  if (isCollaborationSocialCheck(params.message)) {
    return "chitchat";
  }
  if (params.responseMode === "single_owner") {
    return "knowledge";
  }
  if (params.responseMode === "decision_to_executor") {
    return "decision";
  }
  if (params.responseMode === "lead_plus_supplement" && isCollaborationChitchat(params.message)) {
    return "chitchat";
  }
  if (params.responseMode === "lead_plus_supplement") {
    return "analysis";
  }
  return "unknown";
}

const TIMEOUT_FLOORS: Record<TimeoutTaskType, number> = {
  chitchat: 5_000,
  chat: 5_000,
  knowledge: 5_000,
  analysis: 5_000,
  research: 30_000,
  data: 30_000,
  decision: 5_000,
  execution: 60_000,
  unknown: 5_000,
};

export function resolvePrimaryDeadlineMs(params: {
  policy: CollaborationPolicyV1;
  taskType: TimeoutTaskType;
  inboundDepth?: "chat" | "retrieve" | "act";
  startedAtMs: number;
}) {
  let base = params.policy.fallback.timeoutPolicy.byTaskType[params.taskType];
  if (params.inboundDepth === "act") {
    base = Math.max(base, params.policy.fallback.timeoutPolicy.byTaskType.execution);
  }
  if (params.inboundDepth === "retrieve") {
    base = Math.max(base, params.policy.fallback.timeoutPolicy.byTaskType.knowledge);
  }
  base = Math.max(base, TIMEOUT_FLOORS[params.taskType]);
  return params.startedAtMs + base;
}

const ROOM_CLAIM_SIGNALS = ["已认领", "已记录"];

export function classifyPlaceholderReply(text: string) {
  const normalized = text.replace(/\s+/g, "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized.length > ACK_SIGNAL_LIMIT) {
    return false;
  }
  const hasRoomClaim = ROOM_CLAIM_SIGNALS.some((signal) => normalized.includes(signal));
  if (hasRoomClaim) {
    return true;
  }
  const compactSignals = PLACEHOLDER_SIGNALS.map((signal) =>
    signal.replace(/\s+/g, "").toLowerCase(),
  );
  const hasAckSignal = compactSignals.some((signal) => normalized.includes(signal));
  if (!hasAckSignal) {
    return false;
  }
  let leftover = normalized;
  for (const signal of compactSignals) {
    leftover = leftover.replaceAll(signal, "");
  }
  leftover = leftover.replace(/[，。,.!！?？:：；;、~～]+/g, "");
  return leftover.length < 8;
}

const INSUFFICIENT_INFO_RE =
  /信息不足[：:]\s*缺|信息不足[：:]\s*缺少|insufficient\s+info(?:rmation)?\s*[:：]/iu;

const CONCLUSION_SIGNAL_RE =
  /(?:^|[\n。；;])\s*(?:结论|建议|推荐|下一步|可选方案|选项|因此|综上|总结|下一步行动|next\s+steps?|recommend(?:ation)?|conclusion|option(?:s)?)\b|信息不足|(?:^|\n)\s*(?:[-*]\s+)?.{0,40}(?:建议|推荐|结论)|(?:^|\n)\s*[1-9][0-9]?[.、．)]\s*\S/imu;

export type PrimaryCompletionOptions = {
  /** When true, "信息不足：缺…" style counts as a complete primary reply. */
  mentionBotMustRespond?: boolean;
  /** Debate rounds: any non-placeholder visible body completes. No 结论/下一步 required. */
  acceptVisibleBody?: boolean;
};

export type PrimaryCompletion = {
  responseStatus: "complete" | "placeholder";
  /**
   * Structural quality signal (结论 / 建议 / 下一步 / 信息不足 …). Gates whether the
   * supplement window opens; it does NOT decide whether the primary succeeded.
   */
  hasConclusion: boolean;
  /** The primary produced a real, user-visible, non-placeholder reply. */
  visibleReply: boolean;
  source: "heuristic";
};

/**
 * Structural completion for non-chitchat primaries: length alone is not enough.
 * Require conclusion / recommendation / next-steps / options / or explicit 信息不足.
 */
export function hasStructuralPrimaryConclusion(
  text: string,
  options?: PrimaryCompletionOptions,
): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (INSUFFICIENT_INFO_RE.test(trimmed)) {
    return true;
  }
  if (options?.mentionBotMustRespond && /信息不足/.test(trimmed)) {
    return true;
  }
  return CONCLUSION_SIGNAL_RE.test(trimmed);
}

/**
 * True when the primary posted a real visible reply: non-empty and not an ack /
 * room-claim placeholder (「我先看看」「收到」「已认领」…). Tool / execution results
 * such as 「命令已执行，退出码 0」 are real replies even without 结论 keywords.
 */
export function isRealVisiblePrimaryReply(text: string | undefined): boolean {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) {
    return false;
  }
  return !classifyPlaceholderReply(trimmed);
}

/**
 * Separates "did the primary answer at all" (responseStatus / visibleReply) from
 * "does the answer carry a structural conclusion" (hasConclusion).
 *
 * A real visible reply is always `complete`, so the round never treats it like a
 * timeout (no PRIMARY_TIMEOUT, no fallback re-run that double-posts, no fatal abort).
 */
export function classifyPrimaryCompletion(
  text: string,
  taskType?: TimeoutTaskType,
  options?: PrimaryCompletionOptions,
): PrimaryCompletion {
  if (!isRealVisiblePrimaryReply(text)) {
    return {
      responseStatus: "placeholder",
      hasConclusion: false,
      visibleReply: false,
      source: "heuristic",
    };
  }
  const trimmed = text.trim();
  if (taskType === "chitchat" || taskType === "chat" || options?.acceptVisibleBody) {
    return {
      responseStatus: "complete",
      hasConclusion: true,
      visibleReply: true,
      source: "heuristic",
    };
  }
  return {
    responseStatus: "complete",
    hasConclusion: hasStructuralPrimaryConclusion(trimmed, options),
    visibleReply: true,
    source: "heuristic",
  };
}
