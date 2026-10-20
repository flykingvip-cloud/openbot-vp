/**
 * 企业 AI 岗位模板（P1）— 将组织岗位映射到 SeatEntitlementProfile。
 */

import type { SeatEntitlementProfileId } from "./types.js";
import type { SeatRole } from "./types.js";

export type AiJobTemplateId = "sales_ai" | "support_ai" | "analyst_ai" | "executive_ai";

export type AiJobTemplate = {
  id: AiJobTemplateId;
  displayName: string;
  description: string;
  profileId: SeatEntitlementProfileId;
  suggestedSeatRole: SeatRole;
  suggestedBotQuota: number;
};

export const AI_JOB_TEMPLATES: Record<AiJobTemplateId, AiJobTemplate> = {
  sales_ai: {
    id: "sales_ai",
    displayName: "AI 销售岗",
    description: "面向客户触达与销售跟进，专业档 AI 能力。",
    profileId: "pro_ai",
    suggestedSeatRole: "creator",
    suggestedBotQuota: 2,
  },
  support_ai: {
    id: "support_ai",
    displayName: "AI 客服岗",
    description: "高频并发客服场景，基础档 AI 能力。",
    profileId: "basic_ai",
    suggestedSeatRole: "viewer",
    suggestedBotQuota: 1,
  },
  analyst_ai: {
    id: "analyst_ai",
    displayName: "AI 分析岗",
    description: "数据分析与报告生成，专业档 AI 能力。",
    profileId: "pro_ai",
    suggestedSeatRole: "creator",
    suggestedBotQuota: 1,
  },
  executive_ai: {
    id: "executive_ai",
    displayName: "AI 管理岗",
    description: "高级决策支持，含私有模型与高档位。",
    profileId: "premier_ai",
    suggestedSeatRole: "admin",
    suggestedBotQuota: 3,
  },
};

const TEMPLATE_IDS = new Set<string>(Object.keys(AI_JOB_TEMPLATES));

export function isAiJobTemplateId(value: string): value is AiJobTemplateId {
  return TEMPLATE_IDS.has(value);
}

export function getAiJobTemplate(templateId: string): AiJobTemplate | null {
  if (!isAiJobTemplateId(templateId)) {
    return null;
  }
  return AI_JOB_TEMPLATES[templateId];
}

const PROFILE_RANK: Record<SeatEntitlementProfileId, number> = {
  basic_ai: 1,
  pro_ai: 2,
  elite_ai: 3,
  premier_ai: 4,
};

export function isSeatEntitlementProfileUpgrade(
  from: SeatEntitlementProfileId,
  to: SeatEntitlementProfileId,
): boolean {
  return PROFILE_RANK[to] > PROFILE_RANK[from];
}

export function parseAiJobTemplateId(value: unknown): AiJobTemplateId | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return isAiJobTemplateId(raw) ? raw : null;
}
