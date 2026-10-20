/**
 * 标准套餐档位解析与 v3 对外展示文案（与 UI plan-display 别名对齐）。
 */

import type { Plan, PlanCommercialSlot } from "../../billing/types.js";

export const CANONICAL_PLAN_ORDER = [
  "trial",
  "starter",
  "professional",
  "business",
  "enterprise",
] as const;

export type CanonicalPlanKey = (typeof CANONICAL_PLAN_ORDER)[number];

const CANONICAL_PLAN_SLOTS: ReadonlyArray<{
  key: CanonicalPlanKey;
  aliases: readonly string[];
}> = [
  { key: "trial", aliases: ["trial", "free trial", "免费试用", "试用版", "体验版", "免费试用版"] },
  { key: "starter", aliases: ["starter", "team", "基础版", "基本版", "入门版"] },
  { key: "professional", aliases: ["professional", "growth", "专业版"] },
  { key: "business", aliases: ["business", "scale", "商业版", "旗舰版"] },
  { key: "enterprise", aliases: ["enterprise", "企业版", "卓越版"] },
];

export type PlanSlotPresentation = {
  key: CanonicalPlanKey;
  displayName: string;
  badge?: string;
  targetAudience: string;
  description?: string;
};

const SLOT_PRESENTATION: Record<CanonicalPlanKey, PlanSlotPresentation> = {
  trial: {
    key: "trial",
    displayName: "试用版",
    badge: "试用 14 天",
    targetAudience: "快速体验 OpenBot",
    description: "验证 AI 员工协作与自动化价值",
  },
  starter: {
    key: "starter",
    displayName: "基础版",
    badge: "适合小型团队",
    targetAudience: "适合 5-15 人团队",
    description: "小团队 AI 协作",
  },
  professional: {
    key: "professional",
    displayName: "专业版",
    badge: "推荐",
    targetAudience: "适合 15-50 人团队",
    description: "企业 AI 核心生产力",
  },
  business: {
    key: "business",
    displayName: "旗舰版",
    badge: "适合中大型组织",
    targetAudience: "100 席位 · 500 AI 员工",
    description:
      "¥128,000/月 · 30 个基础 AI + 50 个专业 AI + 20 个高级 AI 授权 · 50 万 Credits · 250 路并发",
  },
  enterprise: {
    key: "enterprise",
    displayName: "卓越版",
    badge: "企业定制",
    targetAudience: "适合 200+ 人或特殊需求",
    description: "集团 / 金融 / 私有化方案",
  },
};

function normalizePlanName(name: string): string {
  return name.trim().toLowerCase();
}

export function resolveCanonicalPlanKey(name: string): CanonicalPlanKey | null {
  const normalized = normalizePlanName(name);
  for (const slot of CANONICAL_PLAN_SLOTS) {
    if (slot.aliases.some((alias) => normalizePlanName(alias) === normalized)) {
      return slot.key;
    }
  }
  return null;
}

export function resolvePlanCommercialSlot(plan: Plan): PlanCommercialSlot | "custom" {
  const fromCommercial = plan.commercial?.slot;
  if (fromCommercial) {
    return fromCommercial;
  }
  const key = resolveCanonicalPlanKey(plan.name);
  return key ?? "custom";
}

export function presentationForPlan(plan: Plan): PlanSlotPresentation {
  const commercialKey =
    plan.commercial?.slot && plan.commercial.slot !== "custom" ? plan.commercial.slot : null;
  const key = resolveCanonicalPlanKey(plan.name) ?? commercialKey;
  if (key && key in SLOT_PRESENTATION) {
    const base = SLOT_PRESENTATION[key];
    const recommended = (plan.marketingTags ?? []).includes("recommended");
    return {
      ...base,
      displayName: base.displayName,
      targetAudience: plan.targetAudience?.trim() || base.targetAudience,
      description: plan.slogan?.trim() || base.description,
      badge: recommended ? "✨ 推荐" : base.badge,
    };
  }
  // 未知名称：展示真实 plan.name，禁止回落成「定制套餐 / enterprise」误导
  return {
    key: "professional",
    displayName: plan.name.trim() || "标准套餐",
    targetAudience: plan.targetAudience?.trim() || "按需配置组织能力",
    description: plan.slogan?.trim() || "灵活扩展 AI 员工团队",
  };
}

export function planBeatsForSlot(
  existing: Plan,
  candidate: Plan,
  slotKey: CanonicalPlanKey,
): boolean {
  const rank = (plan: Plan) => ({
    canonical: normalizePlanName(plan.name) === slotKey ? 1 : 0,
    active: plan.status === "active" ? 1 : 0,
    updatedAt: Date.parse(plan.updatedAt) || 0,
  });
  const left = rank(existing);
  const right = rank(candidate);
  if (right.canonical !== left.canonical) {
    return right.canonical > left.canonical;
  }
  if (right.active !== left.active) {
    return right.active > left.active;
  }
  return right.updatedAt > left.updatedAt;
}

/** 每个标准档位只保留一条 active 优先套餐。 */
export function selectPlansForPricingCatalog(plans: readonly Plan[]): Plan[] {
  const bySlot = new Map<CanonicalPlanKey, Plan>();
  const extras: Plan[] = [];

  for (const plan of plans) {
    if (plan.status === "archived") {
      continue;
    }
    const slotKey = resolveCanonicalPlanKey(plan.name);
    if (slotKey) {
      const existing = bySlot.get(slotKey);
      if (!existing || planBeatsForSlot(existing, plan, slotKey)) {
        bySlot.set(slotKey, plan);
      }
      continue;
    }
    extras.push(plan);
  }

  const canonical = CANONICAL_PLAN_ORDER.map((key) => bySlot.get(key)).filter(
    (plan): plan is Plan => plan != null,
  );
  extras.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return [...canonical, ...extras];
}
