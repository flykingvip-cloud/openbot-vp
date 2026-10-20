/**
 * Pricing v3 — 将 Plan + EntitlementSnapshot 投影为企业向 Pricing 视图模型。
 *
 * UI 禁止写死套餐/价格/权益；本模块为唯一展示投影层。
 */

import { computeCyclePrice } from "../../billing/billing-cycle-pricing.js";
import type { BillingCycle, Plan, SeatRole } from "../../billing/types.js";
import type { EntitlementSnapshot } from "../../package-entitlement/types.js";
import { packageMatrixForSlot } from "./package-matrix.js";
import {
  presentationForPlan,
  resolveCanonicalPlanKey,
  resolvePlanCommercialSlot,
  selectPlansForPricingCatalog,
  type CanonicalPlanKey,
} from "./plan-slot-display.js";

/** 估算：每完成 1 次典型 AI 任务约消耗 Credits（仅用于「约 N 次任务」文案）。 */
export const CREDITS_PER_TASK_ESTIMATE = 3;

export function formatAnnualDiscountedMonthlyLabel(cents: number): string {
  const yuan = (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  return `¥${yuan} / 月`;
}

export type AiProfileQuota = Partial<Record<"basic" | "pro" | "elite", number>>;

/** Structured per-tier AI authorization quantities for cards + compare (not seat roles). */
export type AiProfileQuotaView = {
  /** 基础 AI 授权数；contact/custom 为 "custom"；未包含为 null */
  basic: number | "custom" | null;
  pro: number | "custom" | null;
  elite: number | "custom" | null;
};

/** Product-facing labels for viewer/creator/admin capability tiers (not membership roles). */
export const AI_CAPABILITY_TIER_LABELS = {
  basic: "基础 AI",
  pro: "专业 AI",
  elite: "高级 AI",
} as const;

export const AI_CAPABILITY_TIER_DESCRIPTIONS = {
  basic: "文字问答、总结翻译、信息整理、基础创作",
  pro: "专业写作、图片生成、深度分析、多步骤任务",
  elite: "视频生成、复杂推理、长程任务、跨工具执行",
} as const;

/**
 * AI 授权档展示（基础 / 专业 / 高级），与团队席位分列。
 * 示例：`3 个基础 AI 授权`、`8 个基础 AI + 12 个专业 AI 授权`。
 */
export function formatAiProfileAuthorizationLabel(
  quota: AiProfileQuota | undefined | null,
): string | undefined {
  if (!quota) {
    return undefined;
  }
  const basic = Math.max(0, Math.floor(quota.basic ?? 0));
  const pro = Math.max(0, Math.floor(quota.pro ?? 0));
  const elite = Math.max(0, Math.floor(quota.elite ?? 0));
  if (basic + pro + elite <= 0) {
    return undefined;
  }
  const parts: string[] = [];
  if (basic > 0) {
    parts.push(`${basic} 个${AI_CAPABILITY_TIER_LABELS.basic}`);
  }
  if (pro > 0) {
    parts.push(`${pro} 个${AI_CAPABILITY_TIER_LABELS.pro}`);
  }
  if (elite > 0) {
    parts.push(`${elite} 个${AI_CAPABILITY_TIER_LABELS.elite}`);
  }
  return `${parts.join(" + ")} 授权`;
}

/**
 * @deprecated 勿用 seatQuota 推断 AI 授权；请用 formatAiProfileAuthorizationLabel。
 * 保留兼容旧调用。
 */
export function formatSeatProfileAuthorizationLabel(
  seats: Partial<Record<SeatRole, number>> | undefined | null,
): string | undefined {
  if (!seats) {
    return undefined;
  }
  return formatAiProfileAuthorizationLabel({
    basic: seats.viewer,
    pro: seats.creator,
    elite: seats.admin,
  });
}

/** Map entitlement/matrix allowedTiers → card label (no invented seat counts). */
export function formatAiAuthorizationLabel(
  allowedTiers: readonly string[] | undefined,
): string | undefined {
  if (!allowedTiers || allowedTiers.length === 0) {
    return undefined;
  }
  const labels = allowedTiers
    .map((tier) => {
      const key = tier.trim().toLowerCase();
      if (key === "tier_a" || key === "a") {
        return "基础 AI";
      }
      if (key === "tier_b" || key === "b") {
        return "专业 AI";
      }
      if (key === "tier_c" || key === "c") {
        return "高级 AI";
      }
      return tier.trim();
    })
    .filter(Boolean);
  if (labels.length === 0) {
    return undefined;
  }
  return labels.join(" · ");
}

export type PricingCtaType = "trial" | "upgrade" | "current" | "contact";

export type PricingPlanViewModel = {
  id: string;
  planVersionId: string;
  slot: CanonicalPlanKey | "custom";
  displayName: string;
  slogan?: string;
  recommended?: boolean;
  pricing: {
    monthly: number;
    quarterly?: number;
    annual?: number;
  };
  originalPricing?: {
    monthly?: number;
  };
  cycleSavings?: {
    quarterly?: number;
    annual?: number;
  };
  badge?: string;
  targetAudience?: string;
  description?: string;
  annualDiscountedMonthlyLabel?: string;
  capabilities: string[];
  metrics: {
    seats?: number | "custom";
    aiEmployees?: number | "custom";
    concurrentRuns?: number | "custom";
    creditsMonthly?: number;
    estimatedMonthlyTasks?: number;
    workflows?: number | "custom";
    knowledgeBases?: number | "custom";
  };
  /**
   * Card-facing AI authorization summary with tier quantities
   * (e.g. 30 个基础 AI + 50 个专业 AI + 20 个高级 AI 授权).
   */
  aiAuthorizationLabel?: string;
  /** Structured AI capability quotas — UI must not parse the label string. */
  aiProfileQuota: AiProfileQuotaView;
  /** Highest model tier label from package matrix (for compare/detail; not primary card row). */
  tierLabel?: string;
  cardFields: {
    teamRange?: string;
    /** Product-only; do not surface contract SLA / support promises. */
    annualDiscountedMonthly?: string;
    /** Credits / concurrency overage policy label (runtime-enforced). */
    overagePolicy?: string;
  };
  /**
   * Compare matrix — only fields enforced by runtime gates.
   * Do NOT add SLA, support, MFA, SSO, isolation, VPC, workflows, knowledge, audit
   * until they have PlanVersion → Entitlement → RuntimeSnapshot → entry-gate closure.
   */
  compare: {
    aiEmployees: number | "custom";
    concurrentRuns: number | "custom";
    creditsMonthly?: number | "custom";
    /** Product label or the token "custom" for contact-sales tiers. */
    overagePolicy: string;
  };
  cta: {
    label: string;
    type: PricingCtaType;
  };
  contactSales: boolean;
  freeTrial: boolean;
};

export type PricingCompareRow = {
  id: string;
  label: string;
  /** Secondary explanation under the row title (e.g. AI capability scope). */
  description?: string;
  values: Record<string, string | boolean>;
};

export type PricingFaqItem = {
  question: string;
  /** Lead paragraph — plain language summary. */
  answer: string;
  /** Optional numbered / bulleted teaching points. */
  points?: string[];
  /** Optional worked examples for enterprise buyers. */
  examples?: string[];
};

export type PricingCatalogViewModel = {
  plans: PricingPlanViewModel[];
  compareRows: PricingCompareRow[];
  faq: PricingFaqItem[];
  billingHint: string;
};

export type BuildPricingViewModelsInput = {
  plans: readonly Plan[];
  entitlementByPlanVersionId: ReadonlyMap<string, EntitlementSnapshot | undefined>;
  currentPlanId?: string;
};

function totalSeats(seats: EntitlementSnapshot["maxSeats"]): number {
  return (seats.viewer ?? 0) + (seats.creator ?? 0) + (seats.admin ?? 0);
}

function deriveCapabilities(
  plan: Plan,
  _entitlement: EntitlementSnapshot | undefined,
  slot: CanonicalPlanKey | "custom",
): string[] {
  if (plan.marketingFeatures && plan.marketingFeatures.length > 0) {
    return [...plan.marketingFeatures];
  }

  const bullets: string[] = [];

  if (slot === "trial") {
    bullets.push("基础 AI 能力", "有限 AI 员工与 Credits", "体验协作流程");
    return bullets;
  }

  bullets.push("按授权等级调度可用模型", "AI 员工与并发配额", "月度 Credits 与超额策略");

  if (slot === "professional" || slot === "business") {
    bullets.push("多 Agent 协同");
  }

  if (slot === "enterprise") {
    bullets.push("企业定制交付（合同约定）");
  }

  return bullets.slice(0, 6);
}

function resolveCta(
  plan: Plan,
  slot: CanonicalPlanKey | "custom",
  currentPlanId?: string,
): PricingPlanViewModel["cta"] {
  if (plan.id === currentPlanId) {
    return { label: "当前套餐", type: "current" };
  }
  const purchaseMode = plan.commercial?.purchaseMode;
  // 卓越版 / 显式 contact_sales 才「联系销售」。旗舰版等自助档不得被 name 误伤。
  if (
    purchaseMode === "contact_sales" ||
    (slot === "enterprise" && purchaseMode !== "self_serve")
  ) {
    return { label: "联系销售团队", type: "contact" };
  }
  if (purchaseMode === "trial_auto" || slot === "trial") {
    return { label: "免费开始试用", type: "trial" };
  }
  // basePriceCents<=0 的非 trial 仍给出选择 CTA，避免旗舰价被 entitlement 抹成 0 后变成试用
  const presentation = presentationForPlan(plan);
  return { label: `选择 ${presentation.displayName}`, type: "upgrade" };
}

function metricValue(value: number | undefined, custom = false): number | "custom" | undefined {
  if (custom) {
    return "custom";
  }
  if (value == null || value <= 0) {
    return undefined;
  }
  return value;
}

const OVERAGE_POLICY_LABELS: Record<string, string> = {
  block: "超额阻断",
  credits_only: "仅 Credits 超额",
  pay_as_you_go: "按量超额",
};

function formatOveragePolicyLabel(
  entitlement: EntitlementSnapshot | undefined,
  contactSales: boolean,
): string {
  if (contactSales) {
    return "custom";
  }
  const type = entitlement?.overagePolicy?.type;
  if (!type) {
    return OVERAGE_POLICY_LABELS.block;
  }
  return OVERAGE_POLICY_LABELS[type] ?? OVERAGE_POLICY_LABELS.block;
}

function buildCompareFlags(
  slot: CanonicalPlanKey | "custom",
  entitlement: EntitlementSnapshot | undefined,
  contactSales: boolean,
): PricingPlanViewModel["compare"] {
  if (slot === "custom" || contactSales) {
    return {
      aiEmployees: metricValue(entitlement?.maxBots) ?? "custom",
      concurrentRuns: metricValue(entitlement?.maxConcurrentRuns) ?? "custom",
      creditsMonthly:
        entitlement?.monthlyCredits && entitlement.monthlyCredits > 0
          ? entitlement.monthlyCredits
          : "custom",
      overagePolicy: formatOveragePolicyLabel(entitlement, true),
    };
  }
  const matrix = packageMatrixForSlot(slot);
  const credits =
    entitlement?.monthlyCredits && entitlement.monthlyCredits > 0
      ? entitlement.monthlyCredits
      : matrix.snapshot.monthlyCredits;

  return {
    aiEmployees:
      slot === "enterprise"
        ? "custom"
        : (metricValue(entitlement?.maxBots ?? matrix.snapshot.maxBots) ?? "custom"),
    concurrentRuns:
      slot === "enterprise"
        ? "custom"
        : (metricValue(entitlement?.maxConcurrentRuns ?? matrix.snapshot.maxConcurrentRuns) ??
          "custom"),
    creditsMonthly: slot === "enterprise" ? "custom" : credits > 0 ? credits : undefined,
    overagePolicy: formatOveragePolicyLabel(entitlement, false),
  };
}

function buildPlanViewModel(
  plan: Plan,
  entitlement: EntitlementSnapshot | undefined,
  currentPlanId?: string,
): PricingPlanViewModel {
  const slotKey = resolveCanonicalPlanKey(plan.name) ?? resolvePlanCommercialSlot(plan);
  const isEnterpriseSlot = slotKey === "enterprise";
  const presentation = presentationForPlan(plan);
  const matrix = slotKey === "custom" ? null : packageMatrixForSlot(slotKey);
  // Entitlement monthlyPriceCents===0 must not zero-out a paid plan.basePriceCents
  // (?? only skips null/undefined, not 0).
  const entitlementPrice = entitlement?.monthlyPriceCents;
  const monthlyBase = Math.max(
    0,
    typeof entitlementPrice === "number" && entitlementPrice > 0
      ? entitlementPrice
      : plan.basePriceCents,
  );
  const quarterlyQuote = computeCyclePrice(monthlyBase, "quarterly");
  const annualQuote = computeCyclePrice(monthlyBase, "annual");
  // 仅卓越版 / 显式 contact_sales 走「定制报价」。旗舰版(business)必须自助标价。
  const contactSales =
    plan.commercial?.purchaseMode === "contact_sales" ||
    (isEnterpriseSlot && plan.commercial?.purchaseMode !== "self_serve");
  // 免费试用仅 trial 档；禁止「有定价的旗舰/专业」因 entitlement 缺失显示免费。
  const freeTrial =
    !contactSales &&
    (plan.commercial?.purchaseMode === "trial_auto" ||
      slotKey === "trial" ||
      (monthlyBase === 0 &&
        slotKey !== "business" &&
        slotKey !== "professional" &&
        slotKey !== "starter"));
  const recommended =
    (plan.marketingTags ?? []).includes("recommended") || slotKey === "professional";

  // 团队席位合计（与 AI 授权档分列）
  const entitlementSeats = entitlement?.maxSeats;
  const entitlementSeatTotal = entitlementSeats ? totalSeats(entitlementSeats) : 0;
  const planSeatTotal = totalSeats(plan.seatQuota);
  const seatsTotal =
    entitlementSeatTotal > 0 ? entitlementSeatTotal : planSeatTotal > 0 ? planSeatTotal : 0;
  // AI 员工 / Credits / 并发：entitlement 优先，0 时回退 plan / matrix
  const bots =
    entitlement?.maxBots && entitlement.maxBots > 0
      ? entitlement.maxBots
      : plan.botQuota > 0
        ? plan.botQuota
        : (matrix?.snapshot.maxBots ?? 0);
  const credits =
    entitlement?.monthlyCredits && entitlement.monthlyCredits > 0
      ? entitlement.monthlyCredits
      : (matrix?.snapshot.monthlyCredits ?? 0);
  const concurrent =
    entitlement?.maxConcurrentRuns && entitlement.maxConcurrentRuns > 0
      ? entitlement.maxConcurrentRuns
      : (matrix?.snapshot.maxConcurrentRuns ?? 0);
  const workflows = entitlement?.maxWorkflows ?? matrix?.snapshot.maxWorkflows;
  const knowledgeBases = entitlement?.maxKnowledgeBases ?? matrix?.snapshot.maxKnowledgeBases;
  const allowedTiers = entitlement?.allowedTiers?.length
    ? entitlement.allowedTiers
    : (matrix?.snapshot.allowedTiers ?? []);
  // AI 授权：优先锁定版本 entitlement 快照，缺失时才回退静态矩阵（兼容历史数据）。
  const matrixQuota = matrix?.aiProfileQuota;
  const entitlementQuota = entitlement?.aiProfileQuota;
  const resolvedQuotaSource =
    entitlementQuota &&
    ((entitlementQuota.basic ?? 0) > 0 ||
      (entitlementQuota.pro ?? 0) > 0 ||
      (entitlementQuota.elite ?? 0) > 0)
      ? entitlementQuota
      : matrixQuota;
  const aiProfileLabel = formatAiProfileAuthorizationLabel(resolvedQuotaSource);
  const aiAuthorizationLabel = contactSales
    ? "按需配置"
    : (aiProfileLabel ?? formatAiAuthorizationLabel(allowedTiers));
  const aiProfileQuota: AiProfileQuotaView = contactSales
    ? { basic: "custom", pro: "custom", elite: "custom" }
    : {
        basic:
          resolvedQuotaSource?.basic != null && resolvedQuotaSource.basic > 0
            ? Math.floor(resolvedQuotaSource.basic)
            : null,
        pro:
          resolvedQuotaSource?.pro != null && resolvedQuotaSource.pro > 0
            ? Math.floor(resolvedQuotaSource.pro)
            : null,
        elite:
          resolvedQuotaSource?.elite != null && resolvedQuotaSource.elite > 0
            ? Math.floor(resolvedQuotaSource.elite)
            : null,
      };
  const annualEffectiveMonthlyCents = annualQuote.effectiveMonthlyCents;
  const annualDiscountedMonthlyLabel =
    annualEffectiveMonthlyCents < monthlyBase
      ? formatAnnualDiscountedMonthlyLabel(annualEffectiveMonthlyCents)
      : matrix?.presentation.annualDiscountedMonthlyLabel;
  return {
    id: plan.id,
    planVersionId: plan.currentVersionId,
    slot: slotKey === "custom" ? "custom" : slotKey,
    displayName: matrix?.presentation.displayName ?? presentation.displayName,
    slogan: plan.slogan?.trim() || matrix?.presentation.description || presentation.description,
    recommended,
    pricing: {
      monthly: monthlyBase,
      quarterly: quarterlyQuote.effectiveMonthlyCents,
      annual: annualEffectiveMonthlyCents,
    },
    originalPricing: {
      monthly: monthlyBase,
    },
    cycleSavings: {
      quarterly: quarterlyQuote.savingsCents,
      annual: annualQuote.savingsCents,
    },
    badge: matrix?.presentation.badge ?? (recommended ? "✨ 推荐" : presentation.badge),
    targetAudience:
      plan.targetAudience?.trim() ||
      matrix?.presentation.targetAudience ||
      presentation.targetAudience,
    description: matrix?.presentation.description ?? presentation.description,
    annualDiscountedMonthlyLabel,
    capabilities: deriveCapabilities(plan, entitlement, slotKey === "custom" ? "custom" : slotKey),
    metrics: {
      // contact_sales / enterprise → UI shows 定制; paid unlimited (matrix custom) still uses
      // "custom" token but card-spec renders as 无限 when !contactSales.
      seats: contactSales ? "custom" : seatsTotal || undefined,
      aiEmployees: contactSales ? "custom" : bots || undefined,
      concurrentRuns: contactSales ? "custom" : (metricValue(concurrent) ?? undefined),
      creditsMonthly: contactSales ? undefined : credits > 0 ? credits : undefined,
      estimatedMonthlyTasks:
        credits > 0 ? Math.max(1, Math.round(credits / CREDITS_PER_TASK_ESTIMATE)) : undefined,
      workflows: contactSales
        ? "custom"
        : matrix?.compare.workflows === "custom"
          ? "custom"
          : (metricValue(workflows) ?? undefined),
      knowledgeBases: contactSales
        ? "custom"
        : matrix?.compare.knowledgeBases === "custom"
          ? "custom"
          : (metricValue(knowledgeBases) ?? undefined),
    },
    aiAuthorizationLabel,
    aiProfileQuota,
    tierLabel: matrix?.presentation.tierLabel,
    cardFields: {
      teamRange: matrix?.presentation.teamRange,
      annualDiscountedMonthly: annualDiscountedMonthlyLabel,
      overagePolicy: formatOveragePolicyLabel(entitlement, contactSales),
    },
    compare: buildCompareFlags(
      slotKey === "custom" ? "custom" : slotKey,
      entitlement,
      contactSales,
    ),
    cta: resolveCta(plan, slotKey === "custom" ? "custom" : slotKey, currentPlanId),
    contactSales,
    freeTrial,
  };
}

function formatCountWithUnit(value: number | "custom" | undefined, unit: string): string | boolean {
  if (value === "custom") {
    return "custom";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value} ${unit}`;
  }
  return "—";
}

/** Compare cell for structured AI profile quotas (not membership roles). */
function formatAiQuotaCell(value: number | "custom" | null | undefined): string | boolean {
  if (value === "custom") {
    // Explicit product copy for contact_sales / 卓越版 — not "无限".
    return "按需配置";
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return `${value} 个`;
  }
  return "—";
}

function formatCreditsCell(value: number | "custom" | undefined): string | boolean {
  if (value === "custom") {
    return "custom";
  }
  if (typeof value === "number" && value > 0) {
    return `${value.toLocaleString("zh-CN")} Credits`;
  }
  return "—";
}

/**
 * Compare rows — only runtime-enforced commercial capacity.
 * Unfulfilled display fields (SLA/support/MFA/SSO/isolation/VPC/workflows/…) stay out.
 */
function buildCompareRows(plans: PricingPlanViewModel[]): PricingCompareRow[] {
  const columns = plans.filter((p) => p.slot !== "trial");
  if (columns.length === 0) {
    return [];
  }

  const colKey = (plan: PricingPlanViewModel) => plan.slot;

  const rows: PricingCompareRow[] = [
    {
      id: "teamSeats",
      label: "团队席位",
      values: Object.fromEntries(
        columns.map((p) => [colKey(p), formatCountWithUnit(p.metrics.seats, "个")]),
      ),
    },
    {
      id: "aiEmployees",
      label: "AI 员工数",
      values: Object.fromEntries(
        columns.map((p) => [colKey(p), formatCountWithUnit(p.compare.aiEmployees, "个")]),
      ),
    },
    {
      id: "aiBasic",
      label: "基础 AI 授权",
      description: AI_CAPABILITY_TIER_DESCRIPTIONS.basic,
      values: Object.fromEntries(
        columns.map((p) => [colKey(p), formatAiQuotaCell(p.aiProfileQuota.basic)]),
      ),
    },
    {
      id: "aiPro",
      label: "专业 AI 授权",
      description: AI_CAPABILITY_TIER_DESCRIPTIONS.pro,
      values: Object.fromEntries(
        columns.map((p) => [colKey(p), formatAiQuotaCell(p.aiProfileQuota.pro)]),
      ),
    },
    {
      id: "aiElite",
      label: "高级 AI 授权",
      description: AI_CAPABILITY_TIER_DESCRIPTIONS.elite,
      values: Object.fromEntries(
        columns.map((p) => [colKey(p), formatAiQuotaCell(p.aiProfileQuota.elite)]),
      ),
    },
    {
      id: "creditsMonthly",
      label: "月度 Credits",
      values: Object.fromEntries(
        columns.map((p) => [
          colKey(p),
          formatCreditsCell(p.compare.creditsMonthly ?? p.metrics.creditsMonthly),
        ]),
      ),
    },
    {
      id: "concurrentRuns",
      label: "并发数",
      values: Object.fromEntries(
        columns.map((p) => [colKey(p), formatCountWithUnit(p.compare.concurrentRuns, "路")]),
      ),
    },
    {
      id: "overagePolicy",
      label: "超额策略",
      values: Object.fromEntries(
        columns.map((p) => {
          const v = p.compare.overagePolicy;
          if (v === "custom") {
            return [colKey(p), "custom"];
          }
          return [colKey(p), v || "—"];
        }),
      ),
    },
  ];

  return rows.filter((row) => {
    const vals = columns.map((p) => row.values[colKey(p)]);
    if (vals.every((v) => v === false)) {
      return false;
    }
    if (vals.every((v) => v === "—" || v === "" || v == null)) {
      return false;
    }
    return true;
  });
}

const DEFAULT_FAQ: PricingFaqItem[] = [
  {
    question: "费用怎么算？一张账单里有哪些部分？",
    answer:
      "企业订阅按「套餐固定月费」为主，只有超出套餐配额时才会产生加购或超额费用。可用一句话理解：",
    points: [
      "当月费用 ≈ 套餐固定月费 + 超额席位费（如有） + Credits 超额费（如有）",
      "固定月费：卡片上的标价。已包含该档的团队席位、AI 员工数、AI 授权、月度 Credits 与并发数",
      "超额席位：真人账号超过套餐席位后，按成员角色加购单价（以订阅锁定版本为准）按月计费",
      "Credits：套餐内额度含在固定费中；用尽后按锁定版本超额单价计费，或升级到更高套餐",
      "季付 / 年付：在页面顶部切换周期可查看折合月价与总价，年付通常更优惠",
      "卓越版 / 私有化：走合同与定制报价，不按自助标价自动扣费",
    ],
  },
  {
    question: "能举几个具体的算账例子吗？",
    answer:
      "下面用常见场景说明「配额内」和「加购后」分别怎么算（数字仅用于理解规则，最终以账单为准）。",
    examples: [
      "例 1 · 配额内使用：选择专业版月费 ¥999，当月席位、AI 员工、Credits 都未超出套餐 → 账单 ≈ ¥999。",
      "例 2 · 加购席位：仍选专业版 ¥999，再加 2 个团队席位；若锁定单价为 ¥10/席/月 → 账单 ≈ 999 + 2×10 = ¥1,019（尚未发生 Credits 超额）。",
      "例 3 · 旗舰固定费：月费 ¥128,000，已含 100 个团队席位、500 个 AI 员工、30 个基础 AI + 50 个专业 AI + 20 个高级 AI 授权、50 万 Credits、250 路并发；配额内使用即固定费。",
      "例 4 · 试用：试用期内免费；额度用尽需升级，计费与配额自升级后的付费套餐起算。",
    ],
  },
  {
    question: "「AI 员工数」和「AI 授权」有什么不同？",
    answer: "两者都和「团队席位（真人账号）」分开统计，不要混用。",
    points: [
      "AI 员工数：可配置的 AI 员工岗位容量",
      "AI 授权：基础 / 专业 / 高级 AI 能力授权数量，决定成员可用的模型与任务能力范围",
      "团队席位：企业真实成员账号数量",
      "企业管理权限由成员角色（membershipRole）单独设置，与 AI 能力等级无关",
    ],
  },
  {
    question: "团队席位是什么？和 AI 授权有关吗？",
    answer:
      "团队席位是企业真实成员账号总数，与 AI 授权（基础 / 专业 / 高级 AI）分列。AI 授权决定能力等级；企业管理权限由成员角色单独控制。",
    points: ["配额内：席位合计不影响固定月费结构", "超出合计席位后：按订阅锁定版本的加购单价计费"],
  },
  {
    question: "会限制具体用哪个模型吗？",
    answer:
      "一般不直接按模型名称售卖。系统按套餐锁定的 AI 授权与能力等级，在运行时闸口统一调度可用模型，并做成本与合规控制。专属部署与交付方案由合同约定，不作为自助套餐标配功能列出。",
  },
  {
    question: "升级、降级或换周期怎么生效？",
    answer: "变更以订阅锁定的套餐版本与当期账单规则为准，建议在变更前先确认席位与 AI 占用。",
    points: [
      "升级：通常可立即获得更高配额；费用按规则计入当期或下期账单",
      "降级：多在下个账期生效；若当前占用超过目标套餐上限，需先调整到限额内",
      "Credits 已消耗部分一般不退还",
    ],
  },
];

export function buildPricingViewModels(input: BuildPricingViewModelsInput): PricingPlanViewModel[] {
  const visible = selectPlansForPricingCatalog(input.plans);
  return visible.map((plan) => {
    const entitlement = input.entitlementByPlanVersionId.get(plan.currentVersionId);
    return buildPlanViewModel(plan, entitlement, input.currentPlanId);
  });
}

export function buildPricingCatalogViewModel(
  input: BuildPricingViewModelsInput,
): PricingCatalogViewModel {
  const plans = buildPricingViewModels(input);
  return {
    plans,
    compareRows: buildCompareRows(plans),
    faq: DEFAULT_FAQ,
    billingHint:
      "固定月费含席位 / AI 员工 / AI 授权 / Credits；超额与周期折扣见「常见问题 · 计费规则」。",
  };
}

export function resolveEffectiveMonthlyCents(
  plan: PricingPlanViewModel,
  cycle: BillingCycle,
): { displayCents: number; listMonthlyCents?: number; savingsCents?: number } {
  if (plan.contactSales || plan.freeTrial) {
    return { displayCents: 0 };
  }
  const monthly = plan.pricing.monthly;
  if (cycle === "monthly") {
    return { displayCents: monthly };
  }
  if (cycle === "quarterly") {
    return {
      displayCents: plan.pricing.quarterly ?? monthly,
      listMonthlyCents: monthly,
      savingsCents: plan.cycleSavings?.quarterly,
    };
  }
  return {
    displayCents: plan.pricing.annual ?? monthly,
    listMonthlyCents: monthly,
    savingsCents: plan.cycleSavings?.annual,
  };
}
