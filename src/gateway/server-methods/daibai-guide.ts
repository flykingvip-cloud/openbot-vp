/**
 * Daibai Guide — 基于实际可见能力聚合引导态（Phase 6）。
 *
 * 数据源对齐 employee-capability.profile / recommendations 的 store 层（E1），
 * 不经 handler 互调，避免鉴权/ respond 语义错配。
 */

import { normalizeAgentId } from "../../routing/session-key.js";
import type { StewardMemory } from "../../support-cases/steward-memory-store.js";
import { listStewardActions } from "./daibai-action-catalog.js";
import { resolveManageableAgentIds } from "./daibai-ownership.js";
import {
  buildEmployeeCapabilityPersonalRecommendations,
  buildEmployeeCapabilityProfile,
} from "./employee-capability.js";

export type DaibaiGuideCapabilityItem = {
  id: string;
  name: string;
  summary: string;
};

export type DaibaiGuideRecommendation = {
  capabilityId: string;
  name: string;
  reason: string;
};

export type DaibaiGuideSnapshot = {
  headline: string;
  availableNow: DaibaiGuideCapabilityItem[];
  recommendations: DaibaiGuideRecommendation[];
  nextSteps: string[];
  stewardActions: Array<{ actionId: string; title: string; kind: "read" | "write" }>;
};

function resolveGuideAgentId(agentId?: string): string {
  const manageable = resolveManageableAgentIds();
  if (agentId) {
    const normalized = normalizeAgentId(agentId);
    if (manageable.includes(normalized)) {
      return normalized;
    }
  }
  return manageable[0] ?? "main";
}

const ONBOARDING_GUIDE_MARKERS = [
  "新用户引导",
  "首次登录",
  "操作指南",
  "带我熟悉",
  "引导员",
  "入门指南",
] as const;

/** 识别首次登录/引导员类 ask，用于收敛 UI 与支持单路由。 */
export function isDaibaiOnboardingGuideMessage(message: string): boolean {
  const normalized = message.trim();
  if (!normalized) {
    return false;
  }
  return ONBOARDING_GUIDE_MARKERS.some((marker) => normalized.includes(marker));
}

/** 聚合「你现在能用什么 / 下一步可做什么」，供 ask 引导态消费。 */
export function buildStewardGuideSnapshot(params: {
  agentId?: string;
  memory?: StewardMemory | null;
  /** 首次登录引导：文案更短、更行动导向，弱化支持单/技能术语。 */
  onboarding?: boolean;
  /** 可选：由 ask 侧（持 client）异步拉取的全档推荐（personal+position+platform）。缺省则用同步 personal 档。 */
  recommendations?: DaibaiGuideRecommendation[];
}): DaibaiGuideSnapshot {
  const agentId = resolveGuideAgentId(params.agentId);
  // 对齐 spec 数据源（决策 6.1）：复用 employee-capability 的 profile/recommendations 聚合（E1 共享函数），
  // 与 `employee-capability.profile` / `recommendations` 使用同一投影与语义，而非 ad-hoc skill 列表。
  const profile = buildEmployeeCapabilityProfile(agentId);
  const installed = profile.whatItCanDo.map((capability) => ({
    id: capability.id,
    name: capability.name,
    summary:
      typeof capability.summary === "string" && capability.summary.trim()
        ? capability.summary.trim()
        : capability.name,
  }));
  const recommendations = (
    params.recommendations ??
    buildEmployeeCapabilityPersonalRecommendations(agentId).map(({ capability, reason }) => ({
      capabilityId: capability.id,
      name: capability.name,
      reason,
    }))
  ).slice(0, 5);

  const stewardActions = listStewardActions().map((action) => ({
    actionId: action.actionId,
    title: action.title,
    kind: action.kind,
  }));

  const memoryHints = params.memory?.capabilityUsageHints ?? [];
  const nextSteps: string[] = [];
  if (params.onboarding) {
    nextSteps.push("从候选名录挑选数字员工，勾选后直接创建。");
    nextSteps.push("结合你的岗位职责和日常工作事务，点击“+”直接定制数字人。");
    nextSteps.push("他们只在你授权的范围内协助，可随时调整或停用。");
  } else {
    if (installed.length === 0) {
      nextSteps.push("当前还没有安装能力，可以从推荐列表挑选一个开始。");
    } else {
      nextSteps.push(`你已安装 ${installed.length} 个能力，可以直接让我帮你查询用法或调整开关。`);
    }
    if (recommendations.length > 0) {
      nextSteps.push(`有 ${recommendations.length} 个推荐能力可以补充到当前助手。`);
    }
    nextSteps.push("遇到问题可随时让我整理成支持单，转给平台技术人员。");
    if (memoryHints.length > 0) {
      nextSteps.push(`结合你最近关注的能力：${memoryHints.slice(0, 3).join("、")}`);
    }
  }

  const headline = params.onboarding
    ? "我是大白管家，我来帮你创建专属你的数字员工团队。"
    : installed.length > 0
      ? `你现在有 ${installed.length} 个可用能力；我可以帮你查询、代办或在需要时升级平台。`
      : "我可以带你熟悉平台能力，并在授权范围内代你处理常见操作。";

  return {
    headline,
    availableNow: installed.slice(0, 8),
    recommendations,
    nextSteps,
    stewardActions,
  };
}
