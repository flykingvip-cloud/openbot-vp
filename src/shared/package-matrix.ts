import type { SeatRole } from "./seat-role.js";

export const CANONICAL_PACKAGE_KEYS = [
  "trial",
  "starter",
  "professional",
  "business",
  "enterprise",
] as const;

export type CanonicalPackageKey = (typeof CANONICAL_PACKAGE_KEYS)[number];

export type PackageGovernanceLevel = "none" | "basic" | "advanced" | "enterprise" | "financial";
export type PackageDataIsolationLevel =
  | "shared"
  | "logical_shared"
  | "logical_isolated"
  | "vpc_or_physical";
export type PackageSupportLevel =
  | "community"
  | "business_hours"
  | "sla_99_5"
  | "sla_99_9"
  | "custom";

export type SharedPackageMatrixEntry = {
  slot: CanonicalPackageKey;
  annualDiscountedMonthlyCents?: number;
  presentation: {
    displayName: string;
    targetAudience: string;
    description: string;
    badge?: string;
    priceLabel?: string;
    annualDiscountedMonthlyLabel?: string;
    ctaLabel: string;
    teamRange: string;
    workflowsLabel: string;
    knowledgeBasesLabel: string;
    tierLabel: string;
    modelsLabel: string;
    routingLabel: string;
    governanceLabel: string;
    /** @deprecated Not a fulfillment-backed commercial promise; do not surface in pricing UI. */
    slaLabel: string;
    dataIsolationLabel: string;
    /** @deprecated Not a fulfillment-backed commercial promise; do not surface in pricing UI. */
    supportLabel: string;
  };
  seatQuota: Partial<Record<SeatRole, number>>;
  /**
   * 商业 AI 授权档配额（Basic / Pro / Elite），与团队席位 seatQuota 分列。
   * 旗舰真源：30 Basic + 50 Pro + 20 Elite。
   */
  aiProfileQuota?: Partial<Record<"basic" | "pro" | "elite", number>>;
  snapshot: {
    monthlyCredits: number;
    maxBots: number;
    maxConcurrentRuns: number;
    maxWorkflows?: number;
    maxKnowledgeBases?: number;
    allowedTiers: string[];
    allowedPolicies: string[];
    allowCustomPolicy?: boolean;
    allowPrivateModels?: boolean;
    features?: {
      auditLog?: boolean;
      mfa?: boolean;
      sso?: boolean;
      vpcIsolation?: boolean;
    };
  };
  compare: {
    auditLog: boolean | "custom";
    mfa: boolean | "custom";
    sso: boolean | "custom";
    byom: boolean | "custom";
    workflows: number | "custom";
    knowledgeBases: number | "custom";
    governance: PackageGovernanceLevel | "custom";
    /** @deprecated Display-only; not projected to pricing compare. */
    support: PackageSupportLevel | "custom";
    dataIsolation: PackageDataIsolationLevel | "custom";
  };
};

export const SHARED_PACKAGE_MATRIX: Readonly<
  Record<CanonicalPackageKey, SharedPackageMatrixEntry>
> = {
  trial: {
    slot: "trial",
    presentation: {
      displayName: "试用版",
      targetAudience: "快速体验 OpenBot",
      description: "面向 1-3 人团队，验证 AI 员工协作与自动化价值。",
      priceLabel: "免费",
      ctaLabel: "免费试用",
      teamRange: "1-3 人",
      workflowsLabel: "1 条",
      knowledgeBasesLabel: "1 个",
      tierLabel: "Tier A",
      modelsLabel: "基础经济模型",
      routingLabel: "Cheapest",
      governanceLabel: "无",
      slaLabel: "",
      dataIsolationLabel: "共享环境",
      supportLabel: "",
    },
    seatQuota: { viewer: 2, creator: 1 },
    // AI 授权档数量（与旗舰同格式，档位不同）
    aiProfileQuota: { basic: 3 },
    snapshot: {
      monthlyCredits: 500,
      maxBots: 5,
      maxConcurrentRuns: 2,
      maxWorkflows: 1,
      maxKnowledgeBases: 1,
      allowedTiers: ["tier_a"],
      allowedPolicies: ["cost"],
    },
    compare: {
      auditLog: false,
      mfa: false,
      sso: false,
      byom: false,
      workflows: 1,
      knowledgeBases: 1,
      governance: "none",
      support: "community",
      dataIsolation: "shared",
    },
  },
  starter: {
    slot: "starter",
    annualDiscountedMonthlyCents: 25_500,
    presentation: {
      displayName: "基础版",
      targetAudience: "小团队 AI 协作",
      description: "面向 5-15 人团队，建立 AI 员工与知识协作基础设施。",
      priceLabel: "¥299 / 月",
      annualDiscountedMonthlyLabel: "¥255 / 月",
      ctaLabel: "开始使用",
      teamRange: "5-15 人",
      workflowsLabel: "10 条",
      knowledgeBasesLabel: "10 个",
      tierLabel: "Tier A + Tier B",
      modelsLabel: "标准模型池",
      routingLabel: "Balanced",
      governanceLabel: "基础治理",
      // SLA/support are not fulfillment-backed; blank so pricing UI never projects them.
      slaLabel: "",
      dataIsolationLabel: "逻辑共享",
      supportLabel: "",
    },
    seatQuota: { viewer: 6, creator: 3, admin: 1 },
    aiProfileQuota: { basic: 8, pro: 2 },
    snapshot: {
      monthlyCredits: 5_000,
      maxBots: 30,
      maxConcurrentRuns: 5,
      maxWorkflows: 10,
      maxKnowledgeBases: 10,
      allowedTiers: ["tier_a", "tier_b"],
      allowedPolicies: ["balanced"],
      features: {
        auditLog: true,
      },
    },
    compare: {
      auditLog: true,
      mfa: false,
      sso: false,
      byom: false,
      workflows: 10,
      knowledgeBases: 10,
      governance: "basic",
      support: "business_hours",
      dataIsolation: "logical_shared",
    },
  },
  professional: {
    slot: "professional",
    annualDiscountedMonthlyCents: 84_900,
    presentation: {
      displayName: "专业版",
      targetAudience: "企业 AI 核心生产力",
      description: "面向 15-50 人团队，承载多 Agent 协同、API 接入与治理闭环。",
      badge: "推荐",
      priceLabel: "¥999 / 月",
      annualDiscountedMonthlyLabel: "¥849 / 月",
      ctaLabel: "立即升级",
      teamRange: "15-50 人",
      workflowsLabel: "50 条",
      knowledgeBasesLabel: "50 个",
      tierLabel: "Tier B",
      modelsLabel: "全标准模型",
      routingLabel: "Balanced / Coding",
      governanceLabel: "高级治理",
      slaLabel: "",
      dataIsolationLabel: "逻辑隔离",
      supportLabel: "",
    },
    seatQuota: { viewer: 18, creator: 10, admin: 2 },
    aiProfileQuota: { basic: 20, pro: 8, elite: 2 },
    snapshot: {
      monthlyCredits: 30_000,
      maxBots: 120,
      maxConcurrentRuns: 20,
      maxWorkflows: 50,
      maxKnowledgeBases: 50,
      allowedTiers: ["tier_b"],
      allowedPolicies: ["balanced", "quality"],
      features: {
        auditLog: true,
        mfa: true,
      },
    },
    compare: {
      auditLog: true,
      mfa: true,
      sso: false,
      byom: false,
      workflows: 50,
      knowledgeBases: 50,
      governance: "advanced",
      support: "sla_99_5",
      dataIsolation: "logical_isolated",
    },
  },
  business: {
    slot: "business",
    // 年付约 15% 折扣：128000 * 0.85 = 108800 元/月折合
    annualDiscountedMonthlyCents: 10_880_000,
    presentation: {
      displayName: "旗舰版",
      targetAudience: "企业 AI 深度运营",
      description:
        "100 席位 · 500 AI 员工 · 30 基础 + 50 专业 + 20 高级 AI 授权 · 50 万 Credits · 250 路并发。",
      // 生产真源：¥128,000 / 月
      priceLabel: "¥128,000 / 月",
      annualDiscountedMonthlyLabel: "¥108,800 / 月",
      ctaLabel: "立即升级",
      teamRange: "100 席位",
      workflowsLabel: "无限",
      knowledgeBasesLabel: "无限",
      tierLabel: "Tier A + B + C",
      modelsLabel: "30 基础 AI + 50 专业 AI + 20 高级 AI",
      routingLabel: "Best Quality / Routing",
      governanceLabel: "企业级治理",
      slaLabel: "",
      dataIsolationLabel: "逻辑隔离",
      supportLabel: "",
    },
    // 团队成员席位合计 100（治理角色拆分可运营调整；展示以合计为准）
    seatQuota: { viewer: 70, creator: 25, admin: 5 },
    // AI 授权档（与团队席位分列）
    aiProfileQuota: { basic: 30, pro: 50, elite: 20 },
    snapshot: {
      monthlyCredits: 500_000,
      maxBots: 500,
      maxConcurrentRuns: 250,
      maxWorkflows: 0,
      maxKnowledgeBases: 0,
      allowedTiers: ["tier_a", "tier_b", "tier_c"],
      allowedPolicies: ["quality", "bandit"],
      allowPrivateModels: true,
      features: {
        auditLog: true,
        mfa: true,
        sso: true,
      },
    },
    compare: {
      auditLog: true,
      mfa: true,
      sso: true,
      byom: true,
      workflows: "custom",
      knowledgeBases: "custom",
      governance: "enterprise",
      support: "sla_99_9",
      dataIsolation: "logical_isolated",
    },
  },
  enterprise: {
    slot: "enterprise",
    presentation: {
      displayName: "卓越版",
      targetAudience: "集团 / 金融 / 高安全",
      description: "面向 200+ 人组织，提供客户侧私有模型与专属合规支持。应用控制面走 SaaS。",
      priceLabel: "定制报价",
      annualDiscountedMonthlyLabel: "面议",
      ctaLabel: "联系销售",
      teamRange: "200+ 人",
      workflowsLabel: "无限",
      knowledgeBasesLabel: "无限",
      tierLabel: "全 Tier",
      modelsLabel: "按需配置基础 / 专业 / 高级 AI 授权",
      routingLabel: "自定义策略",
      governanceLabel: "金融级治理",
      slaLabel: "",
      dataIsolationLabel: "VPC / 物理隔离",
      supportLabel: "",
    },
    seatQuota: {},
    // 卓越版 AI 授权数量按需，展示层用「按需配置」
    aiProfileQuota: undefined,
    snapshot: {
      monthlyCredits: 0,
      maxBots: 0,
      maxConcurrentRuns: 0,
      maxWorkflows: 0,
      maxKnowledgeBases: 0,
      allowedTiers: ["tier_a", "tier_b", "tier_c"],
      allowedPolicies: ["balanced", "quality", "bandit"],
      allowCustomPolicy: true,
      allowPrivateModels: true,
      features: {
        auditLog: true,
        mfa: true,
        sso: true,
        vpcIsolation: true,
      },
    },
    compare: {
      auditLog: "custom",
      mfa: "custom",
      sso: "custom",
      byom: "custom",
      workflows: "custom",
      knowledgeBases: "custom",
      governance: "financial",
      support: "custom",
      dataIsolation: "vpc_or_physical",
    },
  },
};

export function sharedPackageMatrixForSlot(slot: CanonicalPackageKey): SharedPackageMatrixEntry {
  return SHARED_PACKAGE_MATRIX[slot];
}
