import type { SkillHealthStatus } from "./skill-models.ts";

export type RepairSuggestion = {
  id: string;
  message: string;
  priority: "high" | "medium" | "low";
  category: "input" | "usage" | "context" | "general";
};

export type SkillHealthRepairState = {
  suggestionsBySkillId: Record<string, RepairSuggestion[]>;
  loading: boolean;
};

/**
 * Technical terms that MUST NOT appear in any suggestion message.
 * Suggestions use employee-friendly Chinese language only.
 */
const FORBIDDEN_TERMS = ["error", "exception", "stack", "trace", "API", "endpoint"];

type PatternRule = {
  patterns: string[];
  message: string;
  priority: RepairSuggestion["priority"];
  category: RepairSuggestion["category"];
};

const PATTERN_RULES: PatternRule[] = [
  {
    patterns: ["timeout", "超时"],
    message: "建议简化输入内容或拆分为更小的任务",
    priority: "medium",
    category: "input",
  },
  {
    patterns: ["format", "格式"],
    message: "建议检查输入格式是否符合要求",
    priority: "medium",
    category: "input",
  },
  {
    patterns: ["not found", "未找到"],
    message: "建议确认相关数据源是否可用",
    priority: "high",
    category: "context",
  },
  {
    patterns: ["permission", "权限"],
    message: "建议联系管理员确认权限设置",
    priority: "high",
    category: "general",
  },
  {
    patterns: ["context", "上下文"],
    message: "建议调整使用场景，确保提供足够的背景信息",
    priority: "medium",
    category: "context",
  },
];

const DEFAULT_SUGGESTION: Pick<PatternRule, "message" | "priority" | "category"> = {
  message: "建议检查最近的使用方式是否有变化",
  priority: "low",
  category: "usage",
};

/**
 * Returns true only for "warning" or "broken" status.
 * Used to determine whether the repair suggestions section should be visible.
 */
export function shouldShowRepairSuggestions(healthStatus: SkillHealthStatus): boolean {
  return healthStatus === "warning" || healthStatus === "broken";
}

/**
 * Sanitizes a raw suggestion value, ensuring it contains no forbidden technical terms
 * and returns a valid RepairSuggestion or null if invalid.
 */
export function normalizeRepairSuggestion(value: unknown): RepairSuggestion | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const message = typeof record.message === "string" ? record.message.trim() : "";
  const priority = record.priority;
  const category = record.category;

  if (!id || !message) {
    return null;
  }

  // Validate priority
  if (priority !== "high" && priority !== "medium" && priority !== "low") {
    return null;
  }

  // Validate category
  if (
    category !== "input" &&
    category !== "usage" &&
    category !== "context" &&
    category !== "general"
  ) {
    return null;
  }

  // Strip any forbidden technical terms from the message
  let sanitizedMessage = message;
  for (const term of FORBIDDEN_TERMS) {
    const regex = new RegExp(term, "gi");
    sanitizedMessage = sanitizedMessage.replace(regex, "").trim();
  }

  // If message becomes empty after sanitization, return null
  if (!sanitizedMessage) {
    return null;
  }

  return { id, message: sanitizedMessage, priority, category };
}

/**
 * Pure function that maps failure reasons to employee-friendly repair suggestions.
 * Returns empty array when status is "healthy".
 *
 * Mapping rules (failure reason patterns → suggestions):
 * - Contains "timeout" or "超时" → "建议简化输入内容或拆分为更小的任务"
 * - Contains "format" or "格式" → "建议检查输入格式是否符合要求"
 * - Contains "not found" or "未找到" → "建议确认相关数据源是否可用"
 * - Contains "permission" or "权限" → "建议联系管理员确认权限设置"
 * - Contains "context" or "上下文" → "建议调整使用场景，确保提供足够的背景信息"
 * - Default (no match) → "建议检查最近的使用方式是否有变化"
 */
export function generateRepairSuggestions(
  healthStatus: SkillHealthStatus,
  failureReasons: string[],
): RepairSuggestion[] {
  if (!shouldShowRepairSuggestions(healthStatus)) {
    return [];
  }

  if (failureReasons.length === 0) {
    return [
      {
        id: "default-0",
        message: DEFAULT_SUGGESTION.message,
        priority: DEFAULT_SUGGESTION.priority,
        category: DEFAULT_SUGGESTION.category,
      },
    ];
  }

  const suggestions: RepairSuggestion[] = [];
  const usedMessages = new Set<string>();

  for (let i = 0; i < failureReasons.length; i++) {
    const reason = failureReasons[i].toLocaleLowerCase();
    let matched = false;

    for (const rule of PATTERN_RULES) {
      if (rule.patterns.some((pattern) => reason.includes(pattern))) {
        if (!usedMessages.has(rule.message)) {
          usedMessages.add(rule.message);
          suggestions.push({
            id: `repair-${i}`,
            message: rule.message,
            priority: rule.priority,
            category: rule.category,
          });
        }
        matched = true;
        break;
      }
    }

    if (!matched && !usedMessages.has(DEFAULT_SUGGESTION.message)) {
      usedMessages.add(DEFAULT_SUGGESTION.message);
      suggestions.push({
        id: `repair-${i}`,
        message: DEFAULT_SUGGESTION.message,
        priority: DEFAULT_SUGGESTION.priority,
        category: DEFAULT_SUGGESTION.category,
      });
    }
  }

  // Sort by priority: high > medium > low
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2));

  return suggestions;
}
