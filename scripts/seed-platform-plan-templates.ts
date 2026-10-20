#!/usr/bin/env bun
/**
 * 种子化平台标准套餐模板（Trial / Starter / Professional / Business / Enterprise）。
 *
 * Usage:
 *   bun scripts/seed-platform-plan-templates.ts
 *   bun scripts/seed-platform-plan-templates.ts --dry-run
 *   bun scripts/seed-platform-plan-templates.ts --force   # 同名套餐已存在时仍创建
 *   bun scripts/seed-platform-plan-templates.ts --sync-profiles  # 仅同步选购画像到已有套餐
 *
 * 会先确保 Resource Catalog（Tier + 模型）已初始化，再写入套餐 store。
 *
 * Capacity 数值真源：docs/design/openbot-plan-capacity-contract-frozen-2026-06-22.md
 */

import { loadConfig } from "../src/config/config.js";
import {
  createPlan,
  listPlans,
  setPlanMarginThresholds,
  setPlanMatchingProfile,
  setPlanMarketingTags,
} from "../src/gateway/billing/plans-store.js";
import type { PlanMatchingProfile, SeatRole } from "../src/gateway/billing/types.js";
import { upsertPlanVersionModelBinding } from "../src/gateway/model-entitlement/plan-version-model-binding-store.js";
import { listConfiguredModelIds } from "../src/gateway/model-entitlement/resolve-effective-model-set.js";
import { upsertPlanEntitlementSnapshot } from "../src/gateway/package-entitlement/plan-version-entitlement-store.js";
import { PACKAGE_MATRIX } from "../src/gateway/platform/pricing/package-matrix.js";
import { listResourceModelCatalog } from "../src/gateway/resource-catalog/models-catalog-store.js";
import { resolveModelsFromTiers } from "../src/gateway/resource-catalog/resolve.js";
import { bootstrapResourceCatalogFromConfig } from "../src/gateway/resource-catalog/seed-from-config.js";
import { ensureDefaultResourceTiers } from "../src/gateway/resource-catalog/tiers-store.js";

type PlanTemplate = {
  name: string;
  tagline: string;
  basePriceCents: number;
  monthlyCredits: number;
  maxConcurrentRuns: number;
  allowedTiers: string[];
  allowedPolicies: string[];
  botQuota: number;
  seatQuota: Partial<Record<SeatRole, number>>;
  viewerSeatCents: number;
  creatorSeatCents: number;
  matchingProfile?: PlanMatchingProfile;
  targetMarginRate?: number;
  guardMarginRate?: number;
  marketingTags?: Array<"default" | "recommended">;
  /** 矩阵槽位（name 为中文时必填，如 旗舰版 → business） */
  matrixSlot?: keyof typeof PACKAGE_MATRIX;
  commercialSlot?: "trial" | "starter" | "professional" | "business" | "enterprise";
  purchaseMode?: "self_serve" | "contact_sales" | "trial_auto";
  marketingFeatures?: string[];
};

/** 与冻结 contract 表一致（2026-06-22）。 */
const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    name: "Trial",
    tagline: "免费试用",
    basePriceCents: 0,
    monthlyCredits: PACKAGE_MATRIX.trial.snapshot.monthlyCredits,
    maxConcurrentRuns: PACKAGE_MATRIX.trial.snapshot.maxConcurrentRuns,
    allowedTiers: [...PACKAGE_MATRIX.trial.snapshot.allowedTiers],
    allowedPolicies: [...PACKAGE_MATRIX.trial.snapshot.allowedPolicies],
    botQuota: PACKAGE_MATRIX.trial.snapshot.maxBots,
    seatQuota: { viewer: 2, creator: 1 },
    viewerSeatCents: 0,
    creatorSeatCents: 0,
    matchingProfile: { targetPersonas: ["team-1-5"], matchingPriority: 0 },
    targetMarginRate: 0.5,
    guardMarginRate: 0.35,
  },
  {
    name: "Starter",
    tagline: "小团队 AI 协作",
    basePriceCents: 29_900,
    monthlyCredits: PACKAGE_MATRIX.starter.snapshot.monthlyCredits,
    maxConcurrentRuns: PACKAGE_MATRIX.starter.snapshot.maxConcurrentRuns,
    allowedTiers: [...PACKAGE_MATRIX.starter.snapshot.allowedTiers],
    allowedPolicies: [...PACKAGE_MATRIX.starter.snapshot.allowedPolicies],
    botQuota: PACKAGE_MATRIX.starter.snapshot.maxBots,
    seatQuota: { viewer: 6, creator: 3, admin: 1 },
    viewerSeatCents: 1_000,
    creatorSeatCents: 3_000,
    matchingProfile: {
      targetPersonas: ["team-1-5", "readonly-heavy"],
      matchingPriority: 10,
    },
    targetMarginRate: 0.65,
    guardMarginRate: 0.5,
  },
  {
    name: "Professional",
    tagline: "企业 AI 核心生产力",
    basePriceCents: 99_900,
    monthlyCredits: PACKAGE_MATRIX.professional.snapshot.monthlyCredits,
    maxConcurrentRuns: PACKAGE_MATRIX.professional.snapshot.maxConcurrentRuns,
    allowedTiers: [...PACKAGE_MATRIX.professional.snapshot.allowedTiers],
    allowedPolicies: [...PACKAGE_MATRIX.professional.snapshot.allowedPolicies],
    botQuota: PACKAGE_MATRIX.professional.snapshot.maxBots,
    seatQuota: { viewer: 18, creator: 10, admin: 2 },
    viewerSeatCents: 1_000,
    creatorSeatCents: 3_000,
    marketingTags: ["recommended"],
    matchingProfile: {
      targetPersonas: ["team-6-20", "creator-heavy", "orchestration-heavy"],
      matchingPriority: 20,
    },
    targetMarginRate: 0.75,
    guardMarginRate: 0.6,
  },
  {
    // 展示名「旗舰版」：seed 用中文名，别名 Business 仍可映射。
    // 真源：¥128,000/月 · 100 席位 · 500 AI 员工 · 30+50+20 AI 授权 · 50 万 Credits · 250 并发。
    name: "旗舰版",
    matrixSlot: "business",
    commercialSlot: "business",
    purchaseMode: "self_serve",
    tagline: "企业 AI 深度运营",
    basePriceCents: 12_800_000,
    monthlyCredits: PACKAGE_MATRIX.business.snapshot.monthlyCredits,
    maxConcurrentRuns: PACKAGE_MATRIX.business.snapshot.maxConcurrentRuns,
    allowedTiers: [...PACKAGE_MATRIX.business.snapshot.allowedTiers],
    allowedPolicies: [...PACKAGE_MATRIX.business.snapshot.allowedPolicies],
    botQuota: PACKAGE_MATRIX.business.snapshot.maxBots,
    seatQuota: { ...PACKAGE_MATRIX.business.seatQuota },
    viewerSeatCents: 800,
    creatorSeatCents: 2_400,
    marketingFeatures: [
      "100 个团队席位",
      "500 个 AI 员工配置额度",
      "30 基础 AI + 50 专业 AI + 20 高级 AI 授权",
      "500,000 Credits / 月",
      "250 路企业并发",
    ],
    matchingProfile: {
      targetPersonas: ["team-21-100", "automation-heavy", "agent-heavy"],
      matchingPriority: 15,
    },
    targetMarginRate: 0.8,
    guardMarginRate: 0.65,
  },
  {
    name: "Enterprise",
    tagline: "集团与高安全",
    basePriceCents: 0,
    monthlyCredits: PACKAGE_MATRIX.enterprise.snapshot.monthlyCredits,
    maxConcurrentRuns: PACKAGE_MATRIX.enterprise.snapshot.maxConcurrentRuns,
    allowedTiers: [...PACKAGE_MATRIX.enterprise.snapshot.allowedTiers],
    allowedPolicies: [...PACKAGE_MATRIX.enterprise.snapshot.allowedPolicies],
    botQuota: 0,
    seatQuota: {},
    viewerSeatCents: 0,
    creatorSeatCents: 0,
    matchingProfile: {
      targetPersonas: ["team-100+"],
      matchingPriority: 5,
      beyondPlanNotes: "客户侧私有模型、专属 SLA 与合规项需联系销售定制。",
    },
    targetMarginRate: 0.7,
    guardMarginRate: 0.55,
  },
];

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const syncProfiles = process.argv.includes("--sync-profiles");
const createdBy = "seed-platform-plan-templates";

async function resolveAllowedModelIds(allowedTiers: string[]): Promise<string[]> {
  const catalog = await listResourceModelCatalog();
  const fromTiers = resolveModelsFromTiers({
    allowedTierIds: allowedTiers,
    catalog,
  }).modelIds;
  if (fromTiers.length > 0) {
    return fromTiers;
  }
  return listConfiguredModelIds(loadConfig());
}

async function applyTemplateMetadata(planId: string, template: PlanTemplate): Promise<void> {
  if (template.matchingProfile) {
    await setPlanMatchingProfile(planId, template.matchingProfile);
  }
  if (template.marketingTags?.length) {
    await setPlanMarketingTags(planId, template.marketingTags);
  }
  if (template.targetMarginRate != null || template.guardMarginRate != null) {
    await setPlanMarginThresholds(planId, {
      targetMarginRate: template.targetMarginRate,
      guardMarginRate: template.guardMarginRate,
    });
  }
}

async function syncMatchingProfilesOnly(): Promise<void> {
  const plans = await listPlans();
  let updated = 0;
  for (const template of PLAN_TEMPLATES) {
    const plan = plans.find((entry) => entry.name === template.name);
    if (!plan) {
      console.log(`[sync-skip] ${template.name} 未找到`);
      continue;
    }
    if (dryRun) {
      console.log(
        `[dry-run sync] ${template.name} personas=${template.matchingProfile?.targetPersonas?.join(",") ?? "—"}`,
      );
      updated += 1;
      continue;
    }
    await applyTemplateMetadata(plan.id, template);
    console.log(`[synced] ${template.name} (${plan.id})`);
    updated += 1;
  }
  console.log(`画像同步完成：${updated} 个模板。`);
}

async function seedTemplate(template: PlanTemplate): Promise<"created" | "skipped"> {
  const existing = (await listPlans()).some((plan) => plan.name === template.name);
  if (existing && !force) {
    console.log(`[skip] ${template.name} 已存在`);
    return "skipped";
  }
  if (existing && force) {
    console.log(`[force] ${template.name} 已存在，仍将创建新套餐`);
  }

  const allowedModelIds = await resolveAllowedModelIds(template.allowedTiers);
  const slotKey =
    template.matrixSlot ?? (template.name.toLowerCase() as keyof typeof PACKAGE_MATRIX);
  const matrix = PACKAGE_MATRIX[slotKey];
  const pricing = [
    { type: "seat" as const, key: "viewer", priceCents: template.viewerSeatCents },
    { type: "seat" as const, key: "creator", priceCents: template.creatorSeatCents },
    { type: "usage" as const, key: "ai_token", priceCents: 2 },
  ];
  const commercial =
    template.purchaseMode != null
      ? {
          purchaseMode: template.purchaseMode,
          ...(template.commercialSlot ? { slot: template.commercialSlot } : {}),
        }
      : undefined;

  if (dryRun) {
    console.log(
      `[dry-run] ${template.name} · ${template.tagline} · ¥${(template.basePriceCents / 100).toFixed(0)}/mo · credits=${template.monthlyCredits} · concurrent=${template.maxConcurrentRuns} · tiers=${template.allowedTiers.join("+")} · models=${allowedModelIds.length}`,
    );
    return "created";
  }

  const plan = await createPlan({
    name: template.name,
    billingCycle: "monthly",
    basePriceCents: template.basePriceCents,
    seatQuota: template.seatQuota,
    botQuota: template.botQuota,
    pricing,
    createdByUserId: createdBy,
    ...(commercial ? { commercial } : {}),
    slogan: template.tagline,
    targetAudience: matrix?.presentation.targetAudience,
    marketingFeatures:
      template.marketingFeatures ??
      (matrix?.presentation.description ? [matrix.presentation.description] : []),
  });

  await upsertPlanVersionModelBinding({
    planVersionId: plan.currentVersionId,
    allowedModelIds,
    allowedTiers: template.allowedTiers,
    allowedPolicies: template.allowedPolicies,
    policyId: template.allowedPolicies[0] ?? "balanced",
  });

  await upsertPlanEntitlementSnapshot({
    planVersionId: plan.currentVersionId,
    monthlyPriceCents: template.basePriceCents,
    monthlyCredits: template.monthlyCredits,
    maxSeats: template.seatQuota,
    maxBots: template.botQuota,
    maxConcurrentRuns: template.maxConcurrentRuns,
    ...(matrix?.snapshot.maxWorkflows !== undefined
      ? {
          maxWorkflows: matrix.snapshot.maxWorkflows,
        }
      : {}),
    ...(matrix?.snapshot.maxKnowledgeBases !== undefined
      ? {
          maxKnowledgeBases: matrix.snapshot.maxKnowledgeBases,
        }
      : {}),
    allowedPolicies: template.allowedPolicies,
    allowedTiers: template.allowedTiers,
    ...(matrix?.snapshot.allowCustomPolicy !== undefined
      ? {
          allowCustomPolicy: matrix.snapshot.allowCustomPolicy,
        }
      : {}),
    ...(matrix?.snapshot.allowPrivateModels !== undefined
      ? {
          allowPrivateModels: matrix.snapshot.allowPrivateModels,
        }
      : {}),
    ...(matrix?.snapshot.features
      ? {
          features: matrix.snapshot.features,
        }
      : {}),
  });

  await applyTemplateMetadata(plan.id, template);

  console.log(
    `[created] ${template.name} (${template.tagline}) id=${plan.id} credits=${template.monthlyCredits} concurrent=${template.maxConcurrentRuns} tiers=${template.allowedTiers.join("+")} models=${allowedModelIds.length}`,
  );
  return "created";
}

console.log("初始化 Resource Catalog …");
if (syncProfiles) {
  if (!dryRun) {
    await ensureDefaultResourceTiers();
  }
  await syncMatchingProfilesOnly();
  process.exit(0);
}
if (!dryRun) {
  await ensureDefaultResourceTiers();
  const catalogSeed = await bootstrapResourceCatalogFromConfig(loadConfig());
  console.log(
    `  tiers=${catalogSeed.tiers} models created=${catalogSeed.seed.created} skipped=${catalogSeed.seed.skipped}`,
  );
}

let created = 0;
let skipped = 0;
for (const template of PLAN_TEMPLATES) {
  const result = await seedTemplate(template);
  if (result === "created") {
    created += 1;
  } else {
    skipped += 1;
  }
}

console.log(`完成：${dryRun ? "dry-run" : "写入"} ${created} 个模板，跳过 ${skipped} 个。`);
