// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSubscription } from "../billing/subscriptions-store.js";
import { getEnterpriseModelEntitlement } from "../model-entitlement/enterprise-model-entitlement-store.js";
import { upsertPlanVersionModelBinding } from "../model-entitlement/plan-version-model-binding-store.js";
import { upsertResourceModelCatalogEntry } from "../resource-catalog/models-catalog-store.js";
import { ensureDefaultResourceTiers } from "../resource-catalog/tiers-store.js";
import { resolvePlatformPlanModels } from "./plan-model-projection.js";

let dir: string;
let subscriptionsStorePath: string;
let planBindingStorePath: string;
let entitlementStorePath: string;
let modelCatalogStorePath: string;
let tiersStorePath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "plan-model-projection-"));
  subscriptionsStorePath = path.join(dir, "subs.json");
  planBindingStorePath = path.join(dir, "binding.json");
  entitlementStorePath = path.join(dir, "entitlement.json");
  modelCatalogStorePath = path.join(dir, "catalog.json");
  tiersStorePath = path.join(dir, "tiers.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function opts(tenantId: string, reconcile = false) {
  return {
    tenantId,
    reconcile,
    subscriptionsStorePath,
    planBindingStorePath,
    entitlementStorePath,
    modelCatalogStorePath,
    tiersStorePath,
  };
}

async function seedTierCatalog() {
  await ensureDefaultResourceTiers(tiersStorePath);
  await upsertResourceModelCatalogEntry(
    {
      modelId: "api-proxy-gpt/gpt-5.2",
      displayName: "GPT 5.2",
      tier: "tier_a",
      enabled: true,
      capabilities: ["coding", "reasoning"],
      contextWindow: 200_000,
      inputCostPer1MCents: 250,
      outputCostPer1MCents: 1000,
    },
    modelCatalogStorePath,
  );
  await upsertResourceModelCatalogEntry(
    {
      modelId: "api-proxy-claude/sonnet",
      displayName: "Claude Sonnet",
      tier: "tier_b",
      enabled: true,
      inputCostPer1MCents: 300,
      outputCostPer1MCents: 1500,
    },
    modelCatalogStorePath,
  );
}

describe("resolvePlatformPlanModels — 平台套餐可调用模型", () => {
  it("无 active 订阅 → no_subscription，且不写盘", async () => {
    const res = await resolvePlatformPlanModels(opts("t-none", true));
    expect(res.state).toBe("no_subscription");
    expect(res.models).toEqual([]);
    expect(res.modelIds).toEqual([]);
    expect(res.reconciled).toBe(false);
    expect(await getEnterpriseModelEntitlement("t-none", entitlementStorePath)).toBeNull();
  });

  it("有订阅但版本无绑定 → no_plan_binding", async () => {
    await createSubscription(
      { enterpriseId: "t-nb", planId: "plan-a", planVersionId: "pv-missing" },
      subscriptionsStorePath,
    );
    const res = await resolvePlatformPlanModels(opts("t-nb"));
    expect(res.state).toBe("no_plan_binding");
    expect(res.planVersionId).toBe("pv-missing");
    expect(res.models).toEqual([]);
  });

  it("Tier 绑定 → 从资源目录补齐 Tier/能力/单价，并带上套餐额度与预算", async () => {
    await seedTierCatalog();
    await createSubscription(
      { enterpriseId: "t-ok", planId: "plan-a", planVersionId: "pv-1" },
      subscriptionsStorePath,
    );
    await upsertPlanVersionModelBinding(
      {
        planVersionId: "pv-1",
        allowedModelIds: [],
        allowedTiers: ["tier_a"],
        modelQuota: { "api-proxy-gpt/gpt-5.2": { maxRequests: 500 } },
        modelBudgets: { "api-proxy-gpt/gpt-5.2": { spendCapCents: 20_000 } },
      },
      planBindingStorePath,
    );

    const res = await resolvePlatformPlanModels(opts("t-ok"));
    expect(res.state).toBe("ok");
    expect(res.allowlistSource).toBe("tier");
    expect(res.allowedTiers).toEqual(["tier_a"]);
    expect(res.modelIds).toEqual(["api-proxy-gpt/gpt-5.2"]);

    const entry = res.models[0];
    expect(entry.displayName).toBe("GPT 5.2");
    expect(entry.tier).toBe("tier_a");
    expect(entry.tierName).toBeTruthy();
    expect(entry.capabilities).toContain("coding");
    expect(entry.contextWindow).toBe(200_000);
    expect(entry.inputCostPer1MCents).toBe(250);
    expect(entry.outputCostPer1MCents).toBe(1000);
    expect(entry.quota?.maxRequests).toBe(500);
    expect(entry.budget?.spendCapCents).toBe(20_000);
    expect(entry.catalogMissing).toBe(false);
  });

  it("绑定引用了目录里不存在的模型 → 标记 catalogMissing，不静默丢弃", async () => {
    await createSubscription(
      { enterpriseId: "t-dangling", planId: "plan-a", planVersionId: "pv-legacy" },
      subscriptionsStorePath,
    );
    await upsertPlanVersionModelBinding(
      { planVersionId: "pv-legacy", allowedModelIds: ["ghost-provider/ghost-model"] },
      planBindingStorePath,
    );

    const res = await resolvePlatformPlanModels(opts("t-dangling"));
    expect(res.state).toBe("ok");
    expect(res.allowlistSource).toBe("models");
    expect(res.models).toHaveLength(1);
    expect(res.models[0]?.catalogMissing).toBe(true);
    expect(res.models[0]?.enabled).toBe(false);
    expect(res.models[0]?.provider).toBe("ghost-provider");
  });

  it("Tier 绑定解析出空集合 → binding_empty（区别于「无绑定」）", async () => {
    await ensureDefaultResourceTiers(tiersStorePath);
    await createSubscription(
      { enterpriseId: "t-empty", planId: "plan-a", planVersionId: "pv-empty" },
      subscriptionsStorePath,
    );
    await upsertPlanVersionModelBinding(
      { planVersionId: "pv-empty", allowedModelIds: [], allowedTiers: ["tier_c"] },
      planBindingStorePath,
    );

    const res = await resolvePlatformPlanModels(opts("t-empty"));
    expect(res.state).toBe("binding_empty");
    expect(res.models).toEqual([]);
  });

  it("entitlement 缺失时报 stale；reconcile=true 回填后不再 stale", async () => {
    await seedTierCatalog();
    await createSubscription(
      { enterpriseId: "t-heal", planId: "plan-a", planVersionId: "pv-heal" },
      subscriptionsStorePath,
    );
    await upsertPlanVersionModelBinding(
      { planVersionId: "pv-heal", allowedModelIds: [], allowedTiers: ["tier_a", "tier_b"] },
      planBindingStorePath,
    );

    const readOnly = await resolvePlatformPlanModels(opts("t-heal"));
    expect(readOnly.entitlementStale).toBe(true);
    expect(readOnly.reconciled).toBe(false);
    expect(await getEnterpriseModelEntitlement("t-heal", entitlementStorePath)).toBeNull();

    const healed = await resolvePlatformPlanModels(opts("t-heal", true));
    expect(healed.reconciled).toBe(true);
    expect(healed.entitlementStale).toBe(false);
    expect(healed.entitlementModelIds.toSorted()).toEqual(
      ["api-proxy-claude/sonnet", "api-proxy-gpt/gpt-5.2"].toSorted(),
    );

    const persisted = await getEnterpriseModelEntitlement("t-heal", entitlementStorePath);
    expect(persisted?.allowedModelIds.toSorted()).toEqual(
      ["api-proxy-claude/sonnet", "api-proxy-gpt/gpt-5.2"].toSorted(),
    );
  });

  it("平台改绑定后旧 entitlement 过期 → reconcile 重新对齐", async () => {
    await seedTierCatalog();
    await createSubscription(
      { enterpriseId: "t-drift", planId: "plan-a", planVersionId: "pv-drift" },
      subscriptionsStorePath,
    );
    await upsertPlanVersionModelBinding(
      { planVersionId: "pv-drift", allowedModelIds: [], allowedTiers: ["tier_a"] },
      planBindingStorePath,
    );
    await resolvePlatformPlanModels(opts("t-drift", true));

    // 平台把 Tier B 也放进套餐，但没有触发 subscription.changed 事件。
    await upsertPlanVersionModelBinding(
      { planVersionId: "pv-drift", allowedModelIds: [], allowedTiers: ["tier_a", "tier_b"] },
      planBindingStorePath,
    );

    const stale = await resolvePlatformPlanModels(opts("t-drift"));
    expect(stale.entitlementStale).toBe(true);
    expect(stale.modelIds).toHaveLength(2);
    expect(stale.entitlementModelIds).toHaveLength(1);

    const healed = await resolvePlatformPlanModels(opts("t-drift", true));
    expect(healed.entitlementStale).toBe(false);
    expect(healed.entitlementModelIds).toHaveLength(2);
  });

  it("活动订阅失去模型绑定时，会清空过期 entitlement", async () => {
    const { upsertEnterpriseModelEntitlement } =
      await import("../model-entitlement/enterprise-model-entitlement-store.js");
    await createSubscription(
      { enterpriseId: "t-no-binding-stale", planId: "plan-a", planVersionId: "pv-no-binding" },
      subscriptionsStorePath,
    );
    await upsertEnterpriseModelEntitlement(
      {
        tenantId: "t-no-binding-stale",
        allowedModelIds: ["api-proxy-gpt/gpt-5.2"],
        planVersionId: "pv-no-binding",
      },
      entitlementStorePath,
    );

    const healed = await resolvePlatformPlanModels(opts("t-no-binding-stale", true));
    expect(healed.state).toBe("no_plan_binding");
    expect(healed.reconciled).toBe(true);
    expect(healed.entitlementStale).toBe(false);
    expect(healed.entitlementModelIds).toEqual([]);
    expect(
      (await getEnterpriseModelEntitlement("t-no-binding-stale", entitlementStorePath))
        ?.allowedModelIds,
    ).toEqual([]);
  });

  it("模型集合未变但套餐版本变化时，也会刷新 entitlement 元数据", async () => {
    const { upsertEnterpriseModelEntitlement } =
      await import("../model-entitlement/enterprise-model-entitlement-store.js");
    await seedTierCatalog();
    await createSubscription(
      { enterpriseId: "t-version-drift", planId: "plan-a", planVersionId: "pv-current" },
      subscriptionsStorePath,
    );
    await upsertPlanVersionModelBinding(
      { planVersionId: "pv-current", allowedModelIds: [], allowedTiers: ["tier_a"] },
      planBindingStorePath,
    );
    await upsertEnterpriseModelEntitlement(
      {
        tenantId: "t-version-drift",
        allowedModelIds: ["api-proxy-gpt/gpt-5.2"],
        planVersionId: "pv-previous",
      },
      entitlementStorePath,
    );

    const stale = await resolvePlatformPlanModels(opts("t-version-drift"));
    expect(stale.entitlementStale).toBe(true);

    const healed = await resolvePlatformPlanModels(opts("t-version-drift", true));
    expect(healed.reconciled).toBe(true);
    expect(healed.entitlementStale).toBe(false);
    expect(
      (await getEnterpriseModelEntitlement("t-version-drift", entitlementStorePath))?.planVersionId,
    ).toBe("pv-current");
  });
});
