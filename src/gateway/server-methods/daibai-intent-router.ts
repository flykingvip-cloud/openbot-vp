/**
 * Daibai Intent Router — 把用户消息分级为三种意图（纯函数）。
 *
 * 替换原 `looksLikeSupportEscalation` 的单一关键词法（升级 vs 否）为三级：
 * - self_serve：可在用户授权内只读自助直接答（知识/能力画像/计费/模型可用性查询）。
 * - assisted_action：需用户确认的代办写动作。
 * - escalate：超出授权，收敛为支持单升级平台（bug / 需求 / 无法自助）。
 *
 * D2：分级结果仅用于 chip/工具建议的轻量提示，不再驱动 canned 对话回答。
 */

import type { DaibaiIntentTier } from "../../shared/daibai-types.js";

/** 命中只读自助域的关键词 → 可直接路由到只读能力域。 */
const SELF_SERVE_KEYWORDS = [
  // 知识/查询
  "怎么用",
  "如何",
  "在哪",
  "查一下",
  "查询",
  "搜索",
  "文档",
  "说明",
  "what is",
  "how do",
  "how to",
  "where",
  "search",
  // 能力/账户/计费
  "我能用",
  "有哪些能力",
  "推荐能力",
  "能力",
  "技能",
  "额度",
  "预算",
  "用量",
  "费用",
  "模型",
  "权限",
  "quota",
  "usage",
  "budget",
  "model",
];

/** 命中升级域的关键词 → 需要平台技术支持。 */
const ESCALATE_KEYWORDS = [
  "skill",
  "需求",
  "建议",
  "bug",
  "报错",
  "故障",
  "问题",
  "崩溃",
  "无法",
  "不能用",
  "can't",
  "cannot",
  "error",
  "broken",
  "support",
  "feature request",
];

/** 命中代办写域的关键词 → 需确认的写动作。 */
const ASSISTED_ACTION_KEYWORDS = [
  "帮我",
  "帮忙",
  "代我",
  "设置",
  "安装",
  "启用",
  "关闭",
  "开启",
  "升级",
  "卸载",
  "调整",
  "install",
  "enable",
  "disable",
  "set ",
  "configure",
];

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

export type IntentClassification = {
  tier: DaibaiIntentTier;
  /** 命中的能力域提示（self_serve 时用于只读路由）。 */
  domainHint?: string;
};

function resolveSelfServeDomain(message: string): string {
  if (includesAny(message, ["额度", "预算", "用量", "费用", "budget", "usage", "quota"])) {
    return "billing";
  }
  if (includesAny(message, ["模型", "model"])) {
    return "model-access";
  }
  if (includesAny(message, ["能力", "权限", "capability", "permission"])) {
    return "capability";
  }
  return "knowledge";
}

/**
 * 对用户消息做意图分级。
 *
 * 优先级（保守，避免误把求助当自助）：
 * 1. 明确升级词（bug/报错/需求/无法）→ escalate。
 * 2. 明确代办写词（帮我安装/设置/启停）→ assisted_action。
 * 3. 只读查询词 → self_serve。
 * 4. 兜底 → escalate（宁可走人工/支持单，也不冒进代办）。
 */
export function classifyIntent(message: string): IntentClassification {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return { tier: "escalate" };
  }

  const hasEscalate = includesAny(normalized, ESCALATE_KEYWORDS);
  const hasAssisted = includesAny(normalized, ASSISTED_ACTION_KEYWORDS);
  const hasSelfServe = includesAny(normalized, SELF_SERVE_KEYWORDS);

  // 代办写优先于纯升级词（例如「帮我安装这个 skill」应走代办而非升级），
  // 但纯升级语义（bug/报错/无法）在无明确代办动词时优先升级。
  if (hasAssisted && (hasSelfServe || !hasEscalate)) {
    return { tier: "assisted_action" };
  }
  if (hasEscalate) {
    return { tier: "escalate" };
  }
  if (hasSelfServe) {
    return { tier: "self_serve", domainHint: resolveSelfServeDomain(normalized) };
  }
  if (hasAssisted) {
    return { tier: "assisted_action" };
  }
  // 一般对话由 chat agent 处理；保守分级，不默认走升级。
  return { tier: "self_serve", domainHint: "conversation" };
}
