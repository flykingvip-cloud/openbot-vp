// ui/src/ui/controllers/enterprise-incubation/promotion-decision.ts

import type { IncubationScore } from "./incubation-score.ts";

// --- Types ---

/** 晋升决策结果 */
export type DecisionResult = "recommend_upload" | "continue_incubation" | "not_suitable";

/** 决策提交状态 */
export type DecisionSubmitState = {
  loading: boolean;
  error: string | null;
  success: boolean;
};

/** 评分快照（与 incubation-store 中 IncubationScoreSnapshot 兼容） */
export type IncubationScoreSnapshot = {
  reuseBreath: number;
  effectStability: number;
  businessCoverage: number;
  employeeSatisfaction: number | null;
  compositeScore: number;
};

/** 晋升决策记录（与 incubation-store 中 PromotionDecisionRecord 兼容） */
export type PromotionDecisionRecord = {
  decisionId: string;
  capabilityId: string;
  decidedAt: number;
  decidedBy: string;
  result: DecisionResult;
  reason: string;
  scoreSnapshot: IncubationScoreSnapshot;
};

/** 决策结果展示信息 */
export type DecisionResultDisplay = {
  label: string;
  styleClass: string;
};

// --- Constants ---

const REASON_MIN_LENGTH = 10;
const REASON_MAX_LENGTH = 500;

// --- Validation ---

/**
 * 验证决策理由长度（10-500 字符）
 */
export function validateDecisionReason(reason: string): { valid: boolean; error?: string } {
  if (reason.length < REASON_MIN_LENGTH) {
    return { valid: false, error: `决策理由不能少于 ${REASON_MIN_LENGTH} 个字符` };
  }
  if (reason.length > REASON_MAX_LENGTH) {
    return { valid: false, error: `决策理由不能超过 ${REASON_MAX_LENGTH} 个字符` };
  }
  return { valid: true };
}

// --- State Management ---

/**
 * 创建初始决策提交状态
 */
export function createInitialDecisionSubmitState(): DecisionSubmitState {
  return {
    loading: false,
    error: null,
    success: false,
  };
}

// --- Sorting ---

/**
 * 按 decidedAt 降序排列决策历史（最新在前）
 */
export function sortDecisionHistory(
  decisions: PromotionDecisionRecord[],
): PromotionDecisionRecord[] {
  return [...decisions].toSorted((a, b) => b.decidedAt - a.decidedAt);
}

// --- Display Helpers ---

/**
 * 获取决策结果的展示信息（标签 + 样式类名）
 */
export function getDecisionResultDisplay(result: DecisionResult): DecisionResultDisplay {
  const map: Record<DecisionResult, DecisionResultDisplay> = {
    recommend_upload: { label: "推荐上报平台", styleClass: "decision-recommend" },
    continue_incubation: { label: "继续孵化", styleClass: "decision-continue" },
    not_suitable: { label: "不适合晋升", styleClass: "decision-not-suitable" },
  };
  return map[result];
}

/**
 * 从 IncubationScore 创建评分快照（用于持久化决策记录）
 */
export function createScoreSnapshot(score: IncubationScore): IncubationScoreSnapshot {
  return {
    reuseBreath: score.reuseBreath.value,
    effectStability: score.effectStability.value,
    businessCoverage: score.businessCoverage.value,
    employeeSatisfaction: score.employeeSatisfaction.available
      ? score.employeeSatisfaction.value
      : null,
    compositeScore: score.compositeScore,
  };
}
