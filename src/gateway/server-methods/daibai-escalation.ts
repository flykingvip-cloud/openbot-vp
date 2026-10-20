/**
 * Daibai Escalation — 升级上下文自动采集 + 失败收敛草稿（Phase 7）。
 */

import {
  SUPPORT_CASE_CATEGORY_VALUES,
  type DaibaiEscalationDraft,
  type SupportCaseCategory,
} from "../../shared/daibai-types.js";
import type { StewardMemory } from "../../support-cases/steward-memory-store.js";
import { isDaibaiOnboardingGuideMessage } from "./daibai-guide.js";

function inferSupportCategory(message: string): SupportCaseCategory {
  const normalized = message.trim().toLowerCase();
  if (normalized.includes("bug") || normalized.includes("报错") || normalized.includes("error")) {
    return "bug_report";
  }
  if (normalized.includes("skill") || normalized.includes("技能")) {
    return "skill_authoring";
  }
  if (
    normalized.includes("需求") ||
    normalized.includes("建议") ||
    normalized.includes("feature")
  ) {
    return "feature_request";
  }
  if (normalized.includes("怎么用") || normalized.includes("如何使用")) {
    return "usage_question";
  }
  return "unknown";
}

export type BuildEscalationDraftParams = {
  message: string;
  sessionKey?: string;
  memory?: StewardMemory | null;
  errorEvidence?: string[];
  category?: SupportCaseCategory;
  /** 代办/只读失败时的补充说明。 */
  failureReason?: string;
  /** 蓝图上下文（若调用方在蓝图相关流程中触发升级则传入）。 */
  blueprintSummary?: { blueprintId?: string; version?: string; status?: string };
};

/** 构建升级草稿，自动填充 SupportCaseContextBundle 字段。 */
export function buildEscalationDraft(params: BuildEscalationDraftParams): DaibaiEscalationDraft {
  const recentIntents = params.memory?.lastIntents?.slice(-3) ?? [];
  // Defense-in-depth: never surface internal/system-injected prompts (e.g. the onboarding
  // 引导话术) as a user-facing "近期问题", and dedupe repeated entries from historical
  // memory pollution before joining.
  const recentPlanSummary =
    Array.from(
      new Set(
        recentIntents
          .map((entry) => entry.summary?.trim())
          .filter((summary): summary is string => Boolean(summary))
          .filter((summary) => !isDaibaiOnboardingGuideMessage(summary)),
      ),
    ).join("；") || undefined;
  const recentTopics = params.memory?.recentResolvedTopics?.slice(-2).join("；") || undefined;
  const executionHints = params.memory?.capabilityUsageHints?.slice(-3).join("、");
  const onboardingStep = params.memory?.preferences?.onboardingStep?.trim();

  const errorEvidence = [...(params.errorEvidence ?? [])];
  if (params.failureReason?.trim()) {
    errorEvidence.push(params.failureReason.trim());
  }

  const category =
    params.category && SUPPORT_CASE_CATEGORY_VALUES.includes(params.category)
      ? params.category
      : inferSupportCategory(params.message);

  // blueprintSummary：优先取调用方显式传入；否则从记忆偏好中读取（若有蓝图上下文）。
  // 一期记忆默认不采集蓝图，故无显式传入时通常省略（不臆造）。
  const memoryBlueprintId = params.memory?.preferences?.blueprintId?.trim();
  const blueprintSummary =
    params.blueprintSummary ?? (memoryBlueprintId ? { blueprintId: memoryBlueprintId } : undefined);

  return {
    category,
    contextBundle: {
      userMessage: params.message,
      sourceSessionKey: params.sessionKey,
      onboardingSummary: onboardingStep
        ? { currentStep: onboardingStep, hasExperiencedValue: true }
        : undefined,
      recentPlanSummary: recentPlanSummary || recentTopics,
      recentExecutionSummary: executionHints || undefined,
      blueprintSummary,
      errorEvidence: errorEvidence.length > 0 ? errorEvidence : undefined,
    },
  };
}
