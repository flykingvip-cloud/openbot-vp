#!/usr/bin/env bun
/**
 * 将已有「旗舰版 / Business」套餐对齐到生产真源容量，并激活新 PlanVersion。
 *
 * 真源：
 *   ¥128,000/月
 *   100 团队席位
 *   500 AI 员工配置额度
 *   30 基础 AI + 50 专业 AI + 20 高级 AI 授权（展示用 matrix.aiProfileQuota）
 *   500,000 Credits
 *   250 路企业并发
 *
 * Usage:
 *   bun scripts/sync-flagship-plan-capacity.ts
 *   bun scripts/sync-flagship-plan-capacity.ts --dry-run
 */

import {
  activatePlanVersion,
  createPlanVersion,
  listPlans,
  updatePlan,
} from "../src/gateway/billing/plans-store.js";
import { upsertPlanEntitlementSnapshot } from "../src/gateway/package-entitlement/plan-version-entitlement-store.js";
import { PACKAGE_MATRIX } from "../src/gateway/platform/pricing/package-matrix.js";

const dryRun = process.argv.includes("--dry-run");
const FLAGSHIP_NAMES = new Set(["旗舰版", "business", "Business", "商业版"]);

const TARGET = {
  basePriceCents: 12_800_000,
  seatQuota: { ...PACKAGE_MATRIX.business.seatQuota },
  botQuota: PACKAGE_MATRIX.business.snapshot.maxBots,
  monthlyCredits: PACKAGE_MATRIX.business.snapshot.monthlyCredits,
  maxConcurrentRuns: PACKAGE_MATRIX.business.snapshot.maxConcurrentRuns,
  allowedTiers: [...PACKAGE_MATRIX.business.snapshot.allowedTiers],
  allowedPolicies: [...PACKAGE_MATRIX.business.snapshot.allowedPolicies],
  commercial: { slot: "business" as const, purchaseMode: "self_serve" as const },
  slogan: PACKAGE_MATRIX.business.presentation.description,
  targetAudience: PACKAGE_MATRIX.business.presentation.targetAudience,
  marketingFeatures: [
    "100 个团队席位",
    "500 个 AI 员工配置额度",
    "30 基础 AI + 50 专业 AI + 20 高级 AI 授权",
    "500,000 Credits / 月",
    "250 路企业并发",
  ],
};

async function main(): Promise<void> {
  const plans = await listPlans();
  const matches = plans.filter((p) => p.status === "active" && FLAGSHIP_NAMES.has(p.name.trim()));
  if (matches.length === 0) {
    console.error("未找到 active 旗舰版/Business 套餐。请先 seed 或在平台创建。");
    process.exit(1);
  }

  for (const plan of matches) {
    console.log(`→ ${plan.name} (${plan.id}) base=${plan.basePriceCents} bots=${plan.botQuota}`);
    if (dryRun) {
      console.log(
        `  [dry-run] would set price=¥${TARGET.basePriceCents / 100}, seats=${JSON.stringify(TARGET.seatQuota)}, bots=${TARGET.botQuota}, credits=${TARGET.monthlyCredits}, concurrent=${TARGET.maxConcurrentRuns}`,
      );
      continue;
    }

    // updatePlan 会顺带建 draft 版本；我们再用 createPlanVersion 写完整 pricing 并激活。
    const updated = await updatePlan({
      planId: plan.id,
      basePriceCents: TARGET.basePriceCents,
      seatQuota: TARGET.seatQuota,
      botQuota: TARGET.botQuota,
      commercial: TARGET.commercial,
      slogan: TARGET.slogan,
      targetAudience: TARGET.targetAudience,
      marketingFeatures: TARGET.marketingFeatures,
      createdByUserId: "sync-flagship-plan-capacity",
      pricing: [
        { type: "seat", key: "viewer", priceCents: 800 },
        { type: "seat", key: "creator", priceCents: 2_400 },
        { type: "usage", key: "ai_token", priceCents: 2 },
      ],
    });
    const version = updated?.version;
    if (!version) {
      // fallback path
      const created = await createPlanVersion({
        planId: plan.id,
        pricing: [
          { type: "seat", key: "viewer", priceCents: 800 },
          { type: "seat", key: "creator", priceCents: 2_400 },
          { type: "usage", key: "ai_token", priceCents: 2 },
        ],
        basePriceCents: TARGET.basePriceCents,
        seatQuota: TARGET.seatQuota,
        botQuota: TARGET.botQuota,
        createdByUserId: "sync-flagship-plan-capacity",
        commercial: TARGET.commercial,
      });
      if (!created) {
        console.error(`  failed to create version for ${plan.id}`);
        continue;
      }
      await upsertPlanEntitlementSnapshot({
        planVersionId: created.id,
        monthlyPriceCents: TARGET.basePriceCents,
        monthlyCredits: TARGET.monthlyCredits,
        maxSeats: TARGET.seatQuota,
        maxBots: TARGET.botQuota,
        maxConcurrentRuns: TARGET.maxConcurrentRuns,
        maxWorkflows: PACKAGE_MATRIX.business.snapshot.maxWorkflows ?? 0,
        maxKnowledgeBases: PACKAGE_MATRIX.business.snapshot.maxKnowledgeBases ?? 0,
        allowedPolicies: TARGET.allowedPolicies,
        allowedTiers: TARGET.allowedTiers,
        allowPrivateModels: PACKAGE_MATRIX.business.snapshot.allowPrivateModels,
        features: PACKAGE_MATRIX.business.snapshot.features,
      });
      await activatePlanVersion({
        versionId: created.id,
        requestId: `sync-flagship-${plan.id}-${created.version}`,
        changedByUserId: "sync-flagship-plan-capacity",
      });
      console.log(`  [ok] activated ${created.id} v${created.version}`);
      continue;
    }

    await upsertPlanEntitlementSnapshot({
      planVersionId: version.id,
      monthlyPriceCents: TARGET.basePriceCents,
      monthlyCredits: TARGET.monthlyCredits,
      maxSeats: TARGET.seatQuota,
      maxBots: TARGET.botQuota,
      maxConcurrentRuns: TARGET.maxConcurrentRuns,
      maxWorkflows: PACKAGE_MATRIX.business.snapshot.maxWorkflows ?? 0,
      maxKnowledgeBases: PACKAGE_MATRIX.business.snapshot.maxKnowledgeBases ?? 0,
      allowedPolicies: TARGET.allowedPolicies,
      allowedTiers: TARGET.allowedTiers,
      allowPrivateModels: PACKAGE_MATRIX.business.snapshot.allowPrivateModels,
      features: PACKAGE_MATRIX.business.snapshot.features,
    });

    await activatePlanVersion({
      versionId: version.id,
      requestId: `sync-flagship-${plan.id}-${version.version}`,
      changedByUserId: "sync-flagship-plan-capacity",
    });

    console.log(
      `  [ok] activated ${version.id} v${version.version} · ¥${TARGET.basePriceCents / 100}/mo · seats=100 · bots=500 · credits=500k · concurrent=250`,
    );
  }
}

await main();
