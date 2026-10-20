import type { PlatformSurfaceProps } from "../shared/surface.ts";

export const PLANS_CATALOG_PATH = "/platform/pricing";

export function planDetailPath(planId: string, tab?: string): string {
  const base = `/platform/pricing/${encodeURIComponent(planId)}`;
  if (tab && tab !== "overview") {
    return `${base}?mode=edit&tab=${encodeURIComponent(tab)}`;
  }
  return base;
}

export function mockPricingCatalog(planId = "plan-1") {
  return {
    billingHint: "按团队席位、AI 员工与企业治理能力计费。",
    faq: [],
    compareRows: [],
    plans: [
      {
        id: planId,
        planVersionId: "pv-active",
        slot: "professional",
        displayName: "Growth",
        pricing: { monthly: 49_900, annual: 42_415 },
        originalPricing: { monthly: 49_900 },
        cycleSavings: { annual: 89_820 },
        annualDiscountedMonthlyLabel: "¥424.15 / 月",
        capabilities: ["标准模型", "团队知识库", "审计日志与回溯"],
        metrics: {
          seats: 10,
          aiEmployees: 5,
          concurrentRuns: 10,
          workflows: 10,
          knowledgeBases: 10,
        },
        cardFields: {
          governance: "基础治理",
          sla: "工作日支持",
          dataIsolation: "逻辑共享",
        },
        compare: {
          aiEmployees: 5,
          concurrentRuns: 10,
          workflows: 10,
          knowledgeBases: 10,
          auditLog: true,
          mfa: false,
          sso: false,
          governance: "basic",
          vpc: false,
          byom: false,
          support: "business_hours",
          dataIsolation: "logical_shared",
          sla: "工作日支持",
        },
        cta: { label: "选择 Growth 版", type: "upgrade" },
        contactSales: false,
        freeTrial: false,
      },
    ],
  };
}

export function overviewFor(plan: unknown, versions: unknown[]) {
  const normalizedVersions = versions.map((version) => {
    const raw = version as Record<string, unknown>;
    if (typeof raw.versionId === "string") {
      return raw;
    }
    return {
      versionId: raw.id,
      version: raw.version,
      status: raw.status,
      snapshot: raw.snapshot,
      ...(raw.binding ? { binding: raw.binding } : {}),
      ...(raw.entitlementSnapshot ? { entitlementSnapshot: raw.entitlementSnapshot } : {}),
      bindingState: raw.bindingState ?? "valid",
      activationReady: raw.activationReady ?? true,
      activationBlockers: raw.activationBlockers ?? [],
    };
  });
  return {
    catalog: ["api-proxy-deepseek/deepseek-chat", "ollama/llama3.2"],
    plans: [{ plan, versions: normalizedVersions }],
    pricingCatalog: mockPricingCatalog((plan as { id?: string }).id ?? "plan-1"),
  };
}

export const CATALOG_OVERVIEW_FIXTURE = {
  tiers: [
    {
      id: "tier_a",
      code: "A",
      name: "Tier A",
      description: "",
      sortOrder: 0,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "tier_b",
      code: "B",
      name: "Tier B",
      description: "",
      sortOrder: 1,
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  models: [
    {
      modelId: "openai/gpt-4o",
      provider: "openai",
      displayName: "GPT-4o",
      tier: "tier_a",
      enabled: true,
      inputCostPer1MCents: 0,
      outputCostPer1MCents: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      modelId: "openai/gpt-4o-mini",
      provider: "openai",
      displayName: "GPT-4o mini",
      tier: "tier_b",
      enabled: true,
      inputCostPer1MCents: 0,
      outputCostPer1MCents: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  creditWeights: [
    { tier: "tier_a", creditCost: 1, updatedAt: "2026-01-01T00:00:00.000Z" },
    { tier: "tier_b", creditCost: 5, updatedAt: "2026-01-01T00:00:00.000Z" },
  ],
  missingFromCatalog: [],
  tierUsageWindow: {
    startTime: "2026-06-01T00:00:00.000Z",
    endTime: "2026-07-01T00:00:00.000Z",
  },
  tierUsageStats: [
    { tierId: "tier_a", taskCount: 128392, failureRate: 0.8, avgLatencyMs: 4200 },
    { tierId: "tier_b", taskCount: 45210, failureRate: 1.2, avgLatencyMs: 5100 },
  ],
  failoverRules: [],
};

export const POLICY_LIST_FIXTURE = {
  policies: [
    {
      id: "balanced",
      name: "Balanced",
      description: "",
      selectorStrategy: "balanced",
      status: "active",
      builtin: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "cost",
      name: "Cost",
      description: "",
      selectorStrategy: "cheapest",
      status: "active",
      builtin: true,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

export function commercialSummaryFixture(
  plans: Array<{ id: string; basePriceCents?: number }>,
  overrides?: Partial<Record<string, { activeSubscriptions: number; mrrCents: number }>>,
) {
  let totalSubs = 0;
  let totalMrr = 0;
  const plansOut = Object.fromEntries(
    plans.map((plan) => {
      const metrics = overrides?.[plan.id];
      const activeSubscriptions = metrics?.activeSubscriptions ?? 0;
      const mrrCents = metrics?.mrrCents ?? 0;
      totalSubs += activeSubscriptions;
      totalMrr += mrrCents;
      return [
        plan.id,
        {
          planId: plan.id,
          activeSubscriptions,
          mrrCents,
          versions: {},
        },
      ];
    }),
  );
  return {
    totals: { activeSubscriptions: totalSubs, mrrCents: totalMrr },
    plans: plansOut,
  };
}

export function withTrendFields(summary: ReturnType<typeof commercialSummaryFixture>) {
  return {
    ...summary,
    totals: {
      ...summary.totals,
      previousActiveSubscriptions: summary.totals.activeSubscriptions,
      previousMrrCents: summary.totals.mrrCents,
      subsTrendDelta: 0,
      mrrTrendDelta: 0,
    },
    recentActivity: [],
  };
}

export function handleCatalogPolicyRpc(
  method: string,
  plans: Array<{ id: string }> = [],
  params?: Record<string, unknown>,
): unknown {
  if (method === "platform-resource-catalog.resolve-tiers") {
    const tierIds = Array.isArray(params?.tierIds)
      ? params.tierIds.filter((value): value is string => typeof value === "string")
      : [];
    const enabled = CATALOG_OVERVIEW_FIXTURE.models.filter(
      (model) => model.enabled && tierIds.includes(model.tier),
    );
    const byTier = Object.fromEntries(
      tierIds.map((tierId) => [
        tierId,
        enabled.filter((model) => model.tier === tierId).map((model) => model.modelId),
      ]),
    );
    return {
      pool: {
        tierIds,
        modelIds: enabled.map((model) => model.modelId),
        byTier,
      },
    };
  }
  if (method === "platform-resource-catalog.tiers.upsert") {
    const id = typeof params?.id === "string" ? params.id : "";
    const existing = CATALOG_OVERVIEW_FIXTURE.tiers.find((tier) => tier.id === id);
    return {
      tier: {
        ...(existing ?? CATALOG_OVERVIEW_FIXTURE.tiers[0]),
        id,
        code: typeof params?.code === "string" ? params.code : (existing?.code ?? "A"),
        name: typeof params?.name === "string" ? params.name : (existing?.name ?? "Tier"),
        description: typeof params?.description === "string" ? params.description : "",
        updatedAt: "2026-06-23T00:00:00.000Z",
      },
    };
  }
  if (method === "platform-resource-catalog.models.upsert") {
    const modelId = typeof params?.modelId === "string" ? params.modelId : "";
    const existing = CATALOG_OVERVIEW_FIXTURE.models.find((model) => model.modelId === modelId);
    return {
      model: {
        ...(existing ?? CATALOG_OVERVIEW_FIXTURE.models[0]),
        modelId,
        tier: typeof params?.tier === "string" ? params.tier : (existing?.tier ?? "tier_a"),
        enabled:
          typeof params?.enabled === "boolean" ? params.enabled : (existing?.enabled ?? true),
        updatedAt: "2026-06-23T00:00:00.000Z",
      },
    };
  }
  if (method === "platform-resource-catalog.failover-rules.upsert") {
    const tier = typeof params?.tier === "string" ? params.tier : "";
    return {
      failoverRule: {
        tier,
        enabled: Boolean(params?.enabled),
        failureRateThreshold:
          typeof params?.failureRateThreshold === "number" ? params.failureRateThreshold : 0.1,
        minSampleSize: typeof params?.minSampleSize === "number" ? params.minSampleSize : 20,
        maxConsecutiveFailures:
          typeof params?.maxConsecutiveFailures === "number" ? params.maxConsecutiveFailures : 3,
        latencyThresholdMs:
          typeof params?.latencyThresholdMs === "number" ? params.latencyThresholdMs : 0,
        cooldownSeconds: typeof params?.cooldownSeconds === "number" ? params.cooldownSeconds : 60,
        mode:
          params?.mode === "fallback_tier" || params?.mode === "next_in_pool"
            ? params.mode
            : "disabled",
        fallbackTierId: typeof params?.fallbackTierId === "string" ? params.fallbackTierId : null,
        fallbackModelId: null,
        updatedAt: "2026-06-23T00:00:00.000Z",
      },
    };
  }
  if (method === "platform-resource-catalog.overview") {
    return CATALOG_OVERVIEW_FIXTURE;
  }
  if (method === "platform-policy.list") {
    return POLICY_LIST_FIXTURE;
  }
  if (method === "platform-cost-version.overview") {
    return {
      versions: [
        {
          id: "cv-active",
          version: 1,
          status: "active",
          modelCosts: {
            "openai/gpt-4o": {
              modelId: "openai/gpt-4o",
              tier: "tier_a",
              inputCostPer1MCents: 100,
              outputCostPer1MCents: 200,
            },
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          activatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      activeVersion: {
        id: "cv-active",
        version: 1,
        status: "active",
        modelCosts: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        activatedAt: "2026-01-02T00:00:00.000Z",
      },
    };
  }
  if (method === "platform-economics.overview") {
    return {
      startTime: "2026-06-01T00:00:00.000Z",
      endTime: "2026-07-01T00:00:00.000Z",
      previousStartTime: "2026-05-01T00:00:00.000Z",
      previousEndTime: "2026-06-01T00:00:00.000Z",
      activeCostVersionId: "cv-active",
      summary: {
        taskCount: 12,
        creditsCharged: 48,
        providerCostCents: 3500,
        tenantRevenueCents: 5000,
        marginCents: 1500,
      },
      previousSummary: {
        taskCount: 8,
        creditsCharged: 30,
        providerCostCents: 2800,
        tenantRevenueCents: 4200,
        marginCents: 1400,
      },
      marginTrendDelta: 1500 / 5000 - 1400 / 4200,
      byEnterprise: {
        "ent-1": {
          taskCount: 12,
          creditsCharged: 48,
          providerCostCents: 3500,
          tenantRevenueCents: 5000,
          marginCents: 1500,
        },
      },
      byPlan: {
        [PLAN_FIXTURE.id]: {
          taskCount: 12,
          creditsCharged: 48,
          providerCostCents: 3500,
          tenantRevenueCents: 5000,
          marginCents: 1500,
        },
      },
      previousByPlan: {
        [PLAN_FIXTURE.id]: {
          taskCount: 8,
          creditsCharged: 30,
          providerCostCents: 3000,
          tenantRevenueCents: 4200,
          marginCents: 1200,
        },
      },
      enterprisePlans: {
        "ent-1": { planId: PLAN_FIXTURE.id, planName: PLAN_FIXTURE.name },
      },
      projectionContext: {
        benchmark: { inputTokens: 1500, outputTokens: 500 },
        benchmarkSource: "default",
        benchmarkSampleCount: 0,
        creditWeights: [{ tier: "tier_a", creditCost: 1 }],
        tierCosts: {
          tier_a: {
            modelId: "openai/gpt-4o",
            inputCostPer1MCents: 100,
            outputCostPer1MCents: 200,
            creditCost: 1,
            providerCostPerTaskCents: 50,
            providerCostPerCreditCents: 50,
          },
        },
        tierObservedMix: {},
        selectorMixProfiles: {
          balanced: { tier_a: 1 },
          cheapest: { tier_a: 1 },
          best_quality: { tier_a: 1 },
          bandit: { tier_a: 1 },
        },
      },
    };
  }
  if (method === "consumption-forecast.platform-overview") {
    return {
      cycleStart: "2026-06-01T00:00:00.000Z",
      cycleEnd: "2026-07-01T00:00:00.000Z",
      computedAt: "2026-06-11T00:00:00.000Z",
      enterpriseCount: 1,
      summary: {
        concurrencyHigh: 0,
        creditsCritical: 1,
        marginHigh: 0,
        anyAlert: 1,
      },
      atRiskEnterprises: [
        {
          enterpriseId: "ent-1",
          planId: PLAN_FIXTURE.id,
          alerts: ["credits"],
          maxRisk: "medium",
          concurrencyRisk: "none",
          creditsEtaDays: 5,
          marginWarning: "none",
          forecastCostCents: 9000,
        },
      ],
    };
  }
  if (method === "platform-economics.ledger") {
    return {
      entries: [
        {
          id: "ledger-1",
          enterpriseId: "ent-1",
          taskId: "task-1",
          modelId: "openai/gpt-4o",
          tier: "tier_a",
          policyId: "balanced",
          creditsCharged: 4,
          providerCostCents: 100,
          tenantRevenueCents: 200,
          planId: PLAN_FIXTURE.id,
          occurredAt: "2026-06-15T10:00:00.000Z",
        },
      ],
      total: 1,
    };
  }
  if (method === "platform-subscriptions.summary") {
    return withTrendFields(commercialSummaryFixture(plans));
  }
  return undefined;
}

export function handlePlanBundleAuxRpc(method: string): unknown {
  if (method === "platform-plan-bundle.consistency") {
    return { issues: [] };
  }
  return undefined;
}

export const PLAN_FIXTURE = {
  id: "plan-1",
  name: "Growth",
  billingCycle: "monthly",
  basePriceCents: 0,
  currentVersionId: "pv-active",
  seatQuota: {},
  botQuota: 100,
  status: "active",
  createdAt: "2026-03-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
};

export function versionFixture(over: Record<string, unknown> = {}) {
  return {
    id: "pv-active",
    planId: "plan-1",
    version: 1,
    status: "active",
    snapshot: {
      basePriceCents: 0,
      seatQuota: {},
      botQuota: 100,
      pricing: [
        {
          id: "pp-1",
          planId: "plan-1",
          planVersionId: "pv-active",
          type: "seat",
          key: "viewer",
          priceCents: 1000,
        },
      ],
    },
    createdAt: "2026-03-01T00:00:00.000Z",
    createdByUserId: "admin",
    ...over,
  };
}

export function mockClient(plans: unknown[]) {
  return {
    request: async (method: string, params?: Record<string, unknown>) => {
      const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
      if (catalogPolicy !== undefined) {
        return catalogPolicy;
      }
      const bundleAux = handlePlanBundleAuxRpc(method);
      if (bundleAux !== undefined) {
        return bundleAux;
      }
      if (method === "platform-plan-bundle.overview") {
        return {
          catalog: ["api-proxy-deepseek/deepseek-chat", "ollama/llama3.2"],
          plans: plans.map((plan) => ({ plan, versions: [] })),
          pricingCatalog:
            plans.length > 0
              ? mockPricingCatalog((plans[0] as { id?: string }).id ?? "plan-1")
              : { billingHint: "", faq: [], compareRows: [], plans: [] },
        };
      }
      if (method === "platform-subscriptions.summary") {
        return withTrendFields(
          commercialSummaryFixture(
            plans.map((plan) => {
              const row = plan as { id: string; basePriceCents?: number };
              return { id: row.id, basePriceCents: row.basePriceCents };
            }),
          ),
        );
      }
      if (method === "platform-plan-bundle.create") {
        return {
          plan: PLAN_FIXTURE,
          version: versionFixture({ id: "pv-active", version: 1, status: "active" }),
          binding: {
            planVersionId: "pv-active",
            allowedModelIds: [],
            updatedAt: "2026-03-01T00:00:00.000Z",
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    },
    connected: true,
  } as never;
}

export function mockClientWithVersions(versions: unknown[], diff?: unknown) {
  return {
    request: async (method: string, params?: Record<string, unknown>) => {
      const catalogPolicy = handleCatalogPolicyRpc(method, [{ id: PLAN_FIXTURE.id }], params);
      if (catalogPolicy !== undefined) {
        return catalogPolicy;
      }
      const bundleAux = handlePlanBundleAuxRpc(method);
      if (bundleAux !== undefined) {
        return bundleAux;
      }
      if (method === "platform-plan-bundle.overview") {
        return overviewFor(PLAN_FIXTURE, versions);
      }
      if (method === "platform-plan-bundle.diff") {
        return {
          diff: diff ?? { fromVersionId: "pv-active", toVersionId: "pv-draft", entries: [] },
        };
      }
      if (method === "platform-plan-bundle.consistency") {
        return { issues: [] };
      }
      if (method === "platform-plan-bundle.preview-allocation") {
        return {
          preview: {
            planVersionId: "pv-active",
            allowedTiers: ["tier_a"],
            entitledModelCount: 1,
            roleProfiles: [],
            guide: { summary: "ok", steps: [] },
          },
        };
      }
      if (method === "platform-plan-bundle.activate") {
        return {
          planVersion: versionFixture({ id: "pv-draft", version: 2, status: "active" }),
          binding: {
            planVersionId: "pv-draft",
            allowedModelIds: ["ollama/llama3.2", "api-proxy-deepseek/deepseek-chat"],
            updatedAt: "2026-03-01T00:00:00.000Z",
          },
        };
      }
      if (method === "platform-plan-bundle.deprecate") {
        return {
          planVersion: versionFixture({ id: "pv-active", version: 1, status: "deprecated" }),
          binding: {
            planVersionId: "pv-active",
            allowedModelIds: ["ollama/llama3.2"],
            updatedAt: "2026-03-01T00:00:00.000Z",
          },
        };
      }
      if (method === "platform-plan-bundle.update") {
        return {
          plan: PLAN_FIXTURE,
          version: versionFixture({ id: "pv-active", version: 1, status: "active" }),
          binding: {
            planVersionId: "pv-active",
            allowedModelIds: ["ollama/llama3.2"],
            updatedAt: "2026-03-01T00:00:00.000Z",
          },
        };
      }
      throw new Error(`unexpected method ${method}`);
    },
    connected: true,
  } as never;
}

export function baseProps(client: PlatformSurfaceProps["client"]): PlatformSurfaceProps {
  return {
    tab: "platformPricing",
    basePath: "",
    client,
    readModel: {} as never,
    channelsProps: {} as never,
    actions: {} as never,
  };
}
