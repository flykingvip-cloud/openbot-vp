import type { Plan } from "../../../capability/cost-budget-billing/index.ts";

export const CANONICAL_PLAN_ORDER = [
  "trial",
  "starter",
  "professional",
  "business",
  "enterprise",
] as const;

export type CanonicalPlanKey = (typeof CANONICAL_PLAN_ORDER)[number];

/**
 * 标准五档及其历史/中英文别名；同档只展示一条（英文标准名优先，见 `planBeatsForSlot`）。
 * 命名锚点为英文（Trial/Starter/Professional/Business/Enterprise），中文为辅；
 * 别名同时收录历史中文名（入门版/旗舰版/卓越版 等）以便存量数据去重。
 */
export const CANONICAL_PLAN_SLOTS: ReadonlyArray<{
  key: CanonicalPlanKey;
  aliases: readonly string[];
}> = [
  { key: "trial", aliases: ["trial", "free trial", "免费试用", "试用版", "体验版"] },
  { key: "starter", aliases: ["starter", "基础版", "基本版", "入门版"] },
  { key: "professional", aliases: ["professional", "专业版"] },
  { key: "business", aliases: ["business", "商业版", "旗舰版"] },
  { key: "enterprise", aliases: ["enterprise", "企业版", "卓越版"] },
];

export function normalizePlanName(name: string): string {
  return name.trim().toLowerCase();
}

export function resolvePlanSlot(name: string): CanonicalPlanKey | null {
  const normalized = normalizePlanName(name);
  for (const slot of CANONICAL_PLAN_SLOTS) {
    if (slot.aliases.some((alias) => normalizePlanName(alias) === normalized)) {
      return slot.key;
    }
  }
  return null;
}

function planBeatsForSlot(existing: Plan, candidate: Plan, slotKey: CanonicalPlanKey): boolean {
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

/** 每个标准档位只保留一条；归档且无档位的套餐不展示。 */
export function plansForDisplay(plans: readonly Plan[]): Plan[] {
  return summarizePlansForDisplay(plans).visible;
}

export function summarizePlansForDisplay(plans: readonly Plan[]): {
  visible: Plan[];
  hiddenCount: number;
} {
  const bySlot = new Map<CanonicalPlanKey, Plan>();
  const extras: Plan[] = [];

  for (const plan of plans) {
    const slotKey = resolvePlanSlot(plan.name);
    if (slotKey) {
      const existing = bySlot.get(slotKey);
      if (!existing || planBeatsForSlot(existing, plan, slotKey)) {
        bySlot.set(slotKey, plan);
      }
      continue;
    }
    if (plan.status === "archived") {
      continue;
    }
    extras.push(plan);
  }

  const canonical = CANONICAL_PLAN_ORDER.map((key) => bySlot.get(key)).filter(
    (plan): plan is Plan => plan != null,
  );
  extras.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const visible = [...canonical, ...extras];
  const visibleIds = new Set(visible.map((plan) => plan.id));
  const hiddenCount = plans.filter((plan) => !visibleIds.has(plan.id)).length;
  return { visible, hiddenCount };
}
