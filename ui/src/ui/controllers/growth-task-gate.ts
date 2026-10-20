/**
 * P1 C+3：chat.send 前置门控的 UI 侧处理（阻断后展示增强/先做再说）。
 */

import {
  normalizeGrowthStatus,
  type GrowthPendingTaskContextView,
  type GrowthStatusView,
} from "./agent-growth.ts";

export type GrowthGateBlockedPayload = {
  status: "growth_gate_blocked";
  runId?: string;
  growthGate?: {
    blocked?: boolean;
    agentId?: string;
    growthStatus?: unknown;
    capabilityGaps?: unknown;
    funnel?: unknown;
    recommendation?: unknown;
    taskGaps?: unknown;
  };
};

export function isGrowthGateBlockedResult(value: unknown): value is GrowthGateBlockedPayload {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  return row?.status === "growth_gate_blocked";
}

export type GrowthGateUiHost = {
  chatMessage: string;
  chatMessages: unknown[];
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatSending?: boolean;
  workbenchActiveGrowthStatus?: GrowthStatusView | null;
  workbenchGrowthPendingTask?: GrowthPendingTaskContextView | null;
  workbenchGrowthContinueBannerVisible?: boolean;
  workbenchGrowthContinueSkippedEnhance?: boolean;
  workbenchGrowthGateProceedAuthorized?: boolean;
  workbenchPrimaryModule?: string;
  workbenchRobotWorkbenchTab?: string;
  workbenchRecommendedSkillKeys?: string[] | null;
  requestUpdate?: () => void;
};

/** 从被阻断的 chat.send 结果恢复草稿并打开门控条。 */
export function applyGrowthGateBlocked(
  host: GrowthGateUiHost,
  result: GrowthGateBlockedPayload,
  draftText: string,
): void {
  const draft = draftText.trim();
  const blockedRunId = typeof result.runId === "string" ? result.runId : "";
  // 回滚本轮乐观 user 气泡与发送中状态
  host.chatMessages = host.chatMessages.filter((entry) => {
    if (!entry || typeof entry !== "object") {
      return true;
    }
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string") {
      return true;
    }
    if (blockedRunId) {
      return id !== `local-${blockedRunId}`;
    }
    return !id.startsWith("local-");
  });
  host.chatRunId = null;
  host.chatStream = null;
  host.chatStreamStartedAt = null;
  host.chatSending = false;
  if (draft) {
    host.chatMessage = draft;
  }

  const normalized = normalizeGrowthStatus(result.growthGate ?? null);
  if (normalized) {
    host.workbenchActiveGrowthStatus = normalized;
    if (normalized.pendingTaskContext) {
      host.workbenchGrowthPendingTask = normalized.pendingTaskContext;
    }
    const keys = normalized.recommendation?.target.recommendedSkillKeys;
    if (keys?.length) {
      host.workbenchRecommendedSkillKeys = keys;
    }
  } else if (draft) {
    host.workbenchGrowthPendingTask = {
      draftText: draft,
      source: "composer",
      suggestedSkillKeys: [],
      taskGaps: [],
      extractedAtMs: Date.now(),
      extractStatus: "failed_fallback",
    };
  }

  host.workbenchGrowthContinueBannerVisible = true;
  host.workbenchGrowthContinueSkippedEnhance = false;
  host.workbenchGrowthGateProceedAuthorized = false;
  host.requestUpdate?.();
}

/** 用户选择「先做再说」：授权下一次 send 带 growthGateProceed。 */
export function authorizeGrowthGateProceed(host: GrowthGateUiHost): void {
  host.workbenchGrowthGateProceedAuthorized = true;
  host.workbenchGrowthContinueBannerVisible = false;
  host.workbenchGrowthContinueSkippedEnhance = true;
  const draft =
    host.workbenchGrowthPendingTask?.draftText?.trim() ||
    host.workbenchActiveGrowthStatus?.pendingTaskContext?.draftText?.trim() ||
    host.chatMessage.trim();
  if (draft) {
    host.chatMessage = draft;
  }
  host.requestUpdate?.();
}
