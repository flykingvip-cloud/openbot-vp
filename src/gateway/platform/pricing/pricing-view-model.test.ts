import { describe, expect, it } from "vitest";
import type { Plan } from "../../billing/types.js";
import type { EntitlementSnapshot } from "../../package-entitlement/types.js";
import {
  buildPricingCatalogViewModel,
  buildPricingViewModels,
  CREDITS_PER_TASK_ESTIMATE,
  formatAiProfileAuthorizationLabel,
  resolveEffectiveMonthlyCents,
} from "./pricing-view-model.js";

function makePlan(overrides: Partial<Plan> & Pick<Plan, "id" | "name">): Plan {
  const now = "2026-06-22T00:00:00.000Z";
  return {
    billingCycle: "monthly",
    basePriceCents: 99_900,
    currentVersionId: `${overrides.id}-v1`,
    seatQuota: { viewer: 10, creator: 5, admin: 1 },
    botQuota: 30,
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeEntitlement(
  plan: Plan,
  overrides: Partial<EntitlementSnapshot> = {},
): EntitlementSnapshot {
  return {
    planVersionId: plan.currentVersionId,
    monthlyPriceCents: plan.basePriceCents,
    monthlyCredits: 30_000,
    maxSeats: plan.seatQuota,
    maxBots: plan.botQuota,
    maxConcurrentRuns: 40,
    allowedPolicies: ["balanced", "quality"],
    allowedTiers: ["tier_a", "tier_b"],
    overagePolicy: { type: "block", allowBurstConcurrency: false },
    features: { auditLog: true },
    updatedAt: plan.updatedAt,
    ...overrides,
  };
}

describe("buildPricingViewModels", () => {
  it("maps Professional slot with the new enterprise workforce language", () => {
    const growth = makePlan({
      id: "plan-growth",
      name: "Professional",
      basePriceCents: 99_900,
      marketingTags: ["recommended"],
      botQuota: 120,
      seatQuota: { viewer: 18, creator: 10, admin: 2 },
    });
    const entitlement = makeEntitlement(growth, {
      maxBots: 120,
      maxConcurrentRuns: 20,
      maxWorkflows: 50,
      maxKnowledgeBases: 50,
      allowedPolicies: ["balanced", "quality"],
      allowedTiers: ["tier_b"],
      features: { auditLog: true, mfa: true },
    });
    const [vm] = buildPricingViewModels({
      plans: [growth],
      entitlementByPlanVersionId: new Map([[growth.currentVersionId, entitlement]]),
    });

    expect(vm.displayName).toBe("专业版");
    expect(vm.recommended).toBe(true);
    expect(vm.metrics.aiEmployees).toBe(120);
    expect(vm.metrics.seats).toBe(30);
    expect(vm.metrics.concurrentRuns).toBe(20);
    expect(vm.metrics.workflows).toBe(50);
    expect(vm.metrics.knowledgeBases).toBe(50);
    expect(vm.cardFields.overagePolicy).toBeTruthy();
    expect(vm.cardFields).not.toHaveProperty("sla");
    expect(vm.cardFields).not.toHaveProperty("governance");
    expect(vm.annualDiscountedMonthlyLabel).toBe("¥849.15 / 月");
    expect(vm.pricing.annual).toBe(84_915);
    expect(vm.metrics.estimatedMonthlyTasks).toBe(Math.round(30_000 / CREDITS_PER_TASK_ESTIMATE));
    expect(vm.capabilities.some((c) => c.includes("Credits") || c.includes("授权"))).toBe(true);
    expect(vm.capabilities.some((c) => c.toLowerCase().includes("tier"))).toBe(false);
    expect(vm.capabilities.join(" ")).not.toMatch(/SLA|工作日支持|99\.5%/);
    expect(vm.cta.type).toBe("upgrade");
  });

  it("uses marketingFeatures when configured on plan", () => {
    const team = makePlan({
      id: "plan-team",
      name: "Starter",
      basePriceCents: 29_900,
      marketingFeatures: ["✓ 企业知识库", "✓ 多部门协作"],
    });
    const [vm] = buildPricingViewModels({
      plans: [team],
      entitlementByPlanVersionId: new Map([[team.currentVersionId, makeEntitlement(team)]]),
    });
    expect(vm.capabilities).toEqual(["✓ 企业知识库", "✓ 多部门协作"]);
  });

  it("marks enterprise as contact sales without numeric price emphasis", () => {
    const enterprise = makePlan({
      id: "plan-ent",
      name: "Enterprise",
      basePriceCents: 0,
      commercial: { slot: "enterprise", purchaseMode: "contact_sales" },
    });
    const [vm] = buildPricingViewModels({
      plans: [enterprise],
      entitlementByPlanVersionId: new Map([[enterprise.currentVersionId, undefined]]),
    });
    expect(vm.contactSales).toBe(true);
    expect(vm.cta.type).toBe("contact");
    expect(vm.metrics.aiEmployees).toBe("custom");
    expect(vm.contactSales).toBe(true);
    expect(
      vm.cardFields.overagePolicy === "custom" || vm.cardFields.overagePolicy === "按需配置",
    ).toBe(true);
    // Unfulfillable isolation/SLA promises are not projected onto cards.
    expect(vm.cardFields).not.toHaveProperty("dataIsolation");
    expect(vm.cardFields).not.toHaveProperty("sla");
  });

  it("projects 旗舰版 production capacity: price, seats, bots, AI profiles, credits, concurrency", () => {
    const flagship = makePlan({
      id: "plan-flag",
      name: "旗舰版",
      basePriceCents: 12_800_000,
      botQuota: 500,
      seatQuota: { viewer: 70, creator: 25, admin: 5 },
      commercial: { slot: "business", purchaseMode: "self_serve" },
    });
    // Empty entitlement forces matrix/plan fallbacks for capacity truth.
    const zeroEnt = makeEntitlement(flagship, {
      monthlyPriceCents: 0,
      maxBots: 0,
      monthlyCredits: 0,
      maxConcurrentRuns: 0,
      maxSeats: {},
    });
    const [vm] = buildPricingViewModels({
      plans: [flagship],
      entitlementByPlanVersionId: new Map([[flagship.currentVersionId, zeroEnt]]),
    });
    expect(vm.slot).toBe("business");
    expect(vm.contactSales).toBe(false);
    expect(vm.freeTrial).toBe(false);
    expect(vm.pricing.monthly).toBe(12_800_000);
    expect(vm.cta.type).toBe("upgrade");
    expect(vm.metrics.seats).toBe(100);
    expect(vm.metrics.aiEmployees).toBe(500);
    expect(vm.metrics.creditsMonthly).toBe(500_000);
    expect(vm.metrics.concurrentRuns).toBe(250);
    expect(vm.aiAuthorizationLabel).toBe("30 个基础 AI + 50 个专业 AI + 20 个高级 AI 授权");
    expect(vm.aiProfileQuota).toEqual({ basic: 30, pro: 50, elite: 20 });
  });

  it("projects per-tier AI authorization quantities aligned with flagship format", () => {
    const trial = makePlan({
      id: "t",
      name: "Trial",
      basePriceCents: 0,
      commercial: { slot: "trial", purchaseMode: "trial_auto" },
    });
    const starter = makePlan({
      id: "s",
      name: "Starter",
      basePriceCents: 29_900,
      commercial: { slot: "starter", purchaseMode: "self_serve" },
    });
    const pro = makePlan({
      id: "p",
      name: "Professional",
      basePriceCents: 99_900,
      commercial: { slot: "professional", purchaseMode: "self_serve" },
    });
    const enterprise = makePlan({
      id: "e",
      name: "Enterprise",
      basePriceCents: 0,
      commercial: { slot: "enterprise", purchaseMode: "contact_sales" },
    });
    const vms = buildPricingViewModels({
      plans: [trial, starter, pro, enterprise],
      entitlementByPlanVersionId: new Map([
        [trial.currentVersionId, makeEntitlement(trial, { monthlyCredits: 500 })],
        [starter.currentVersionId, makeEntitlement(starter)],
        [pro.currentVersionId, makeEntitlement(pro)],
        [enterprise.currentVersionId, undefined],
      ]),
    });
    const bySlot = Object.fromEntries(vms.map((v) => [v.slot, v]));
    expect(bySlot.trial?.aiAuthorizationLabel).toBe("3 个基础 AI 授权");
    expect(bySlot.starter?.aiAuthorizationLabel).toBe("8 个基础 AI + 2 个专业 AI 授权");
    expect(bySlot.professional?.aiAuthorizationLabel).toBe(
      "20 个基础 AI + 8 个专业 AI + 2 个高级 AI 授权",
    );
    expect(bySlot.enterprise?.aiAuthorizationLabel).toBe("按需配置");
    expect(bySlot.trial?.aiProfileQuota).toEqual({ basic: 3, pro: null, elite: null });
    expect(bySlot.starter?.aiProfileQuota).toEqual({ basic: 8, pro: 2, elite: null });
    expect(bySlot.professional?.aiProfileQuota).toEqual({ basic: 20, pro: 8, elite: 2 });
    expect(bySlot.enterprise?.aiProfileQuota).toEqual({
      basic: "custom",
      pro: "custom",
      elite: "custom",
    });
  });

  it("puts billing rules into catalog FAQ (not on plan cards)", () => {
    const starter = makePlan({ id: "s1", name: "Starter", basePriceCents: 29_900 });
    const catalog = buildPricingCatalogViewModel({
      plans: [starter],
      entitlementByPlanVersionId: new Map([[starter.currentVersionId, makeEntitlement(starter)]]),
    });
    expect(catalog.plans[0]).not.toHaveProperty("billingRules");
    expect(catalog.plans[0]).not.toHaveProperty("footNote");
    const billingFaq = catalog.faq.find((f) => f.question.includes("费用"));
    expect(billingFaq?.answer).toBeTruthy();
    expect(billingFaq?.points?.some((p) => p.includes("固定月费"))).toBe(true);
    expect(catalog.faq.some((f) => (f.examples?.length ?? 0) > 0)).toBe(true);
    // No SLA / support promises on cards
    expect(JSON.stringify(catalog.plans[0]?.cardFields ?? {})).not.toMatch(
      /工作日支持|99\.5%|99\.9%|SLA/,
    );
  });

  it("formatAiProfileAuthorizationLabel joins only positive tiers with 个/授权", () => {
    expect(formatAiProfileAuthorizationLabel({ basic: 3 })).toBe("3 个基础 AI 授权");
    expect(formatAiProfileAuthorizationLabel({ basic: 8, pro: 2 })).toBe(
      "8 个基础 AI + 2 个专业 AI 授权",
    );
    expect(formatAiProfileAuthorizationLabel({ basic: 0, pro: 0, elite: 0 })).toBeUndefined();
  });

  it("derives annual discounted monthly from live monthly base (15% off)", () => {
    const growth = makePlan({ id: "p", name: "Growth", basePriceCents: 99_900 });
    const [vm] = buildPricingViewModels({
      plans: [growth],
      entitlementByPlanVersionId: new Map([[growth.currentVersionId, makeEntitlement(growth)]]),
    });
    const annual = resolveEffectiveMonthlyCents(vm, "annual");
    expect(annual.displayCents).toBe(84_915);
    expect(annual.listMonthlyCents).toBe(99_900);
    expect(annual.savingsCents).toBe(99_900 * 12 - Math.round(99_900 * 12 * 0.85));
  });

  it("keeps annual below monthly for starter-scale pricing", () => {
    const starter = makePlan({ id: "s", name: "Starter", basePriceCents: 19_900 });
    const [vm] = buildPricingViewModels({
      plans: [starter],
      entitlementByPlanVersionId: new Map([[starter.currentVersionId, makeEntitlement(starter)]]),
    });
    expect(vm.pricing.annual).toBeLessThan(vm.pricing.monthly);
    expect(vm.annualDiscountedMonthlyLabel).toBe("¥169.15 / 月");
  });
});

describe("buildPricingCatalogViewModel", () => {
  it("dedupes canonical slots and builds compare matrix", () => {
    const starter = makePlan({ id: "s1", name: "Starter", basePriceCents: 29_900, botQuota: 5 });
    const growth = makePlan({
      id: "g1",
      name: "Professional",
      basePriceCents: 99_900,
      botQuota: 30,
      marketingTags: ["recommended"],
    });
    const catalog = buildPricingCatalogViewModel({
      plans: [starter, growth],
      entitlementByPlanVersionId: new Map([
        [starter.currentVersionId, makeEntitlement(starter, { maxBots: 5, maxConcurrentRuns: 10 })],
        [growth.currentVersionId, makeEntitlement(growth)],
      ]),
    });
    expect(catalog.plans).toHaveLength(2);
    expect(catalog.compareRows.length).toBeGreaterThan(0);
    expect(catalog.faq.length).toBeGreaterThanOrEqual(4);
  });

  it("compare matrix only lists runtime-enforced capacity (no SLA/support promises)", () => {
    const pro = makePlan({
      id: "g1",
      name: "Professional",
      basePriceCents: 99_900,
      marketingTags: ["recommended"],
    });
    const catalog = buildPricingCatalogViewModel({
      plans: [pro],
      entitlementByPlanVersionId: new Map([
        [
          pro.currentVersionId,
          makeEntitlement(pro, {
            maxBots: 120,
            maxConcurrentRuns: 20,
            maxWorkflows: 50,
            maxKnowledgeBases: 10,
            monthlyCredits: 30_000,
            features: { auditLog: true, mfa: true },
          }),
        ],
      ]),
    });
    const byId = Object.fromEntries(catalog.compareRows.map((r) => [r.id, r]));
    expect(byId.aiEmployees?.values.professional).toMatch(/120\s*个/);
    expect(byId.concurrentRuns?.values.professional).toMatch(/20\s*路/);
    expect(byId.creditsMonthly?.values.professional).toMatch(/Credits/);
    expect(byId.overagePolicy?.values.professional).toBeTruthy();
    expect(byId.aiBasic?.label).toBe("基础 AI 授权");
    expect(byId.aiBasic?.description).toContain("文字问答");
    expect(byId.aiPro?.description).toContain("图片生成");
    expect(byId.aiElite?.description).toContain("视频生成");
    // Unfulfilled promises must not appear
    expect(byId.workflows).toBeUndefined();
    expect(byId.mfa).toBeUndefined();
    expect(byId.support).toBeUndefined();
    expect(byId.sla).toBeUndefined();
    expect(byId.governance).toBeUndefined();
    expect(byId.vpc).toBeUndefined();
    expect(byId.byom).toBeUndefined();
    const raw = JSON.stringify(catalog.compareRows);
    expect(raw).not.toMatch(/工作日支持|99\.5%|99\.9%|SLA|logical_shared|business_hours|sla_99_/);
    expect(raw).not.toMatch(/\bviewer\b|\bcreator\b|\badmin\b/i);
  });

  it("does not expose internal seat-role names or unfulfillable SLA/support copy", () => {
    const starter = makePlan({ id: "s1", name: "Starter", basePriceCents: 29_900 });
    const catalog = buildPricingCatalogViewModel({
      plans: [starter],
      entitlementByPlanVersionId: new Map([[starter.currentVersionId, makeEntitlement(starter)]]),
    });
    const blob = JSON.stringify(catalog);
    expect(blob).not.toMatch(/只读席位|创作席位|管理席位|默认 AI 授权|AI 员工配置额度/);
    expect(blob).not.toMatch(/\bViewer\b|\bCreator\b|\bAdmin\b/);
    expect(blob).not.toMatch(/工作日支持|99\.5%|99\.9%|可用性承诺/);
    expect(catalog.plans[0]?.aiAuthorizationLabel).toContain("基础 AI");
  });

  it("prefers entitlement aiProfileQuota over static package matrix", () => {
    const pro = makePlan({
      id: "g1",
      name: "Professional",
      basePriceCents: 99_900,
      marketingTags: ["recommended"],
    });
    // Matrix professional defaults to 20/8/2; entitlement freezes different values.
    const entitlement = makeEntitlement(pro, {
      aiProfileQuota: { basic: 11, pro: 7, elite: 3 },
    });
    const [vm] = buildPricingViewModels({
      plans: [pro],
      entitlementByPlanVersionId: new Map([[pro.currentVersionId, entitlement]]),
    });
    expect(vm.aiProfileQuota).toEqual({ basic: 11, pro: 7, elite: 3 });
    expect(vm.aiAuthorizationLabel).toBe("11 个基础 AI + 7 个专业 AI + 3 个高级 AI 授权");
  });
});
