import { describe, expect, it } from "vitest";
import type { PlatformPortReadModel } from "../semantic/platform-read-model.ts";
import {
  buildModelGovernanceVM,
  buildModelUsageAnalyticsVM,
  buildPlatformModelsVM,
} from "./adapter.ts";

function createReadModel(): PlatformPortReadModel {
  return {
    currentTenantId: "tenant-a",
    currentTenantLabel: "Tenant A",
    knownTenantIds: ["tenant-a"],
    tenantDirectory: [{ tenantId: "tenant-a", label: "Tenant A" }],
    enterpriseDirectory: [],
    agentDirectory: [],
    modelDirectory: [],
    gatewayCatalogModels: [
      {
        providerId: "minimax",
        modelId: "MiniMax-M2.5",
        name: "MiniMax M2.5",
        contextWindow: 200000,
      },
    ],
    taskPlanDirectory: [],
    routingPolicyDirectory: [],
    gatewayCatalogCount: 1,
    defaultModelPrimary: "deepseek/deepseek-chat",
    defaultModelFallbacks: ["minimax/MiniMax-M2.5"],
    defaultImageModelPrimary: null,
    allowlistedModelRefs: ["deepseek/deepseek-chat", "minimax/MiniMax-M2.5"],
    allowlistEntries: [
      { modelRef: "deepseek/deepseek-chat", alias: "DeepSeek" },
      { modelRef: "minimax/MiniMax-M2.5", alias: "MiniMax" },
    ],
    aliasCount: 2,
    providerHealthDirectory: [
      {
        providerId: "deepseek",
        authMode: "api-key",
        authStatus: "ok",
        authLabel: "已配置",
        modelCount: 0,
        catalogCount: 0,
        issue: "Provider 已声明但未配置任何模型",
      },
      {
        providerId: "minimax",
        authMode: "api-key",
        authStatus: "ok",
        authLabel: "已配置",
        modelCount: 0,
        catalogCount: 1,
        issue: "Provider 已声明但未配置任何模型",
      },
    ],
    agentCount: 0,
    featureMethodCount: 0,
    channelCount: 0,
    channelIds: [],
    accountCount: 0,
    connectedAccountCount: 0,
    nodeCount: 0,
    presenceCount: 0,
    runtimeHosts: [],
    sessionsCount: 4,
    totalTokens: 1000,
    totalCost: 2.5,
    missingCostEntries: 0,
    currentUsageOverview: {
      sessionCount: 0,
      totalTokens: 0,
      totalCost: 0,
      totalMessages: 0,
      errorCount: 0,
      errorRate: 0,
      avgLatencyMs: null,
      peakErrorDayLabel: null,
      topModelLabel: null,
      topAgentId: null,
      activeAgentCount: 0,
      activeChannelCount: 0,
      dailyCalls: [],
      dailyCost: [],
      updatedAt: null,
    },
    modelMode: "merge",
    configuredProviderCount: 2,
    providerIds: ["deepseek", "minimax"],
    configuredModelCount: 0,
    configuredModelIds: [],
    installedCapabilityCount: 0,
    attentionItems: [],
    currentVersion: "2026.3.9",
    latestVersion: "2026.3.9",
    hasUpdateAvailable: false,
    cronEnabled: null,
    cronNextAt: null,
    operatorUser: "ops@example.com",
    operatorRole: "super_admin",
    latestInvite: null,
  };
}

describe("platform models adapter", () => {
  it("synthesizes assets for configured routing refs missing from model directory", () => {
    const vm = buildPlatformModelsVM({
      readModel: createReadModel(),
      legacyModelsVM: null,
    });

    expect(vm.assets.emptyState).toBeUndefined();
    expect(vm.assets.models.map((model) => model.modelId)).toEqual(
      expect.arrayContaining(["deepseek/deepseek-chat", "minimax/MiniMax-M2.5"]),
    );
    expect(vm.assets.summary.totalModels).toBe(2);
    expect(vm.assets.summary.recommendationPoolSize).toBe(2);
    expect(vm.assets.filters.providers).toEqual(["deepseek", "minimax"]);
    expect(
      vm.assets.models.find((model) => model.modelId === "minimax/MiniMax-M2.5"),
    ).toMatchObject({
      displayName: "MiniMax M2.5",
      contextWindow: 200000,
      source: "referenced",
      healthBasis: "catalog_verified",
      inRecommendationPool: true,
    });
    expect(
      vm.assets.models.find((model) => model.modelId === "deepseek/deepseek-chat"),
    ).toMatchObject({
      source: "referenced",
      healthBasis: "catalog_missing",
      inRecommendationPool: true,
    });
  });

  it("does not expand gateway discovery catalog into model assets", () => {
    const readModel = createReadModel();
    readModel.defaultModelPrimary = null;
    readModel.defaultModelFallbacks = [];
    readModel.allowlistedModelRefs = [];
    readModel.allowlistEntries = [];
    readModel.aliasCount = 0;
    readModel.modelDirectory = [];
    readModel.gatewayCatalogModels = [
      {
        providerId: "deepseek",
        modelId: "deepseek-chat",
        name: "DeepSeek Chat",
        contextWindow: 128000,
      },
      {
        providerId: "minimax",
        modelId: "MiniMax-M2.5",
        name: "MiniMax M2.5",
        contextWindow: 200000,
      },
      {
        providerId: "openrouter",
        modelId: "some/huge-catalog-model",
        name: "Noise",
        contextWindow: 1,
      },
    ];
    readModel.gatewayCatalogCount = readModel.gatewayCatalogModels.length;

    const vm = buildPlatformModelsVM({
      readModel,
      legacyModelsVM: null,
    });

    // Discovery-only rows are not platform-managed assets.
    expect(vm.assets.summary.totalModels).toBe(0);
    expect(vm.assets.emptyState?.title).toContain("暂无已纳管模型资产");
    expect(vm.assets.models.find((model) => model.modelId.includes("openrouter"))).toBeUndefined();
  });

  it("keeps configured directory models even when not allowlisted", () => {
    const readModel = createReadModel();
    readModel.defaultModelPrimary = null;
    readModel.defaultModelFallbacks = [];
    readModel.allowlistedModelRefs = [];
    readModel.allowlistEntries = [];
    readModel.aliasCount = 0;
    readModel.modelDirectory = [
      {
        providerId: "minimax",
        modelId: "MiniMax-M2.5",
        name: "MiniMax M2.5",
        api: null,
        providerApi: null,
        baseUrl: null,
        auth: null,
        reasoning: null,
        input: ["text"],
        contextWindow: 200000,
        maxTokens: null,
        costTier: "medium",
        supportsTools: true,
      },
    ];
    readModel.gatewayCatalogModels = [
      {
        providerId: "openrouter",
        modelId: "noise/model",
        name: "Noise",
        contextWindow: 1,
      },
    ];
    readModel.gatewayCatalogCount = 1;

    const vm = buildPlatformModelsVM({
      readModel,
      legacyModelsVM: null,
    });

    expect(vm.assets.summary.totalModels).toBe(1);
    expect(vm.assets.models[0]).toMatchObject({
      modelId: "minimax/MiniMax-M2.5",
      source: "configured",
    });
  });

  it("prefers live probe results over catalog inference when probe data exists", () => {
    const readModel = createReadModel();
    readModel.modelProbeDirectory = [
      {
        providerId: "minimax",
        modelId: "MiniMax-M2.5",
        status: "ok",
        source: "profile",
        label: "default",
        latencyMs: 920,
        error: null,
        checkedAt: 1_713_000_000_000,
      },
    ];

    const vm = buildPlatformModelsVM({
      readModel,
      legacyModelsVM: null,
    });

    expect(
      vm.assets.models.find((model) => model.modelId === "minimax/MiniMax-M2.5"),
    ).toMatchObject({
      health: "healthy",
      healthBasis: "live_probe_ok",
      liveProbe: {
        status: "ok",
        latencyMs: 920,
      },
    });
  });

  it("does not synthesize usage metrics, task plans, or routing policies without real config", () => {
    const vm = buildPlatformModelsVM({
      readModel: createReadModel(),
      legacyModelsVM: null,
    });

    expect(vm.overview.summary.totalCalls7d).toBe(0);
    expect(vm.overview.summary.cost7d).toBe(0);
    expect(vm.overview.topUsedModels).toEqual([]);
    expect(vm.overview.topCostModels).toEqual([]);
    expect(vm.analytics.byModel).toEqual([]);
    expect(vm.analytics.byTask).toEqual([]);
    expect(vm.analytics.byPlan).toEqual([]);
    expect(vm.taskPlans.plans).toEqual([]);
    expect(vm.routing.policies).toEqual([]);
    expect(vm.routing.explanations).toEqual([]);
  });

  it("keeps duplicated routing policy configs as independent rows", () => {
    const readModel = createReadModel();
    readModel.routingPolicyDirectory = [
      {
        policyId: "policy-general-copy",
        name: "通用文本路由副本",
        sourcePolicyId: "routing-general_text",
        taskProfileId: "general_text",
        planId: "plan_general_text",
        primaryModelIds: ["deepseek/deepseek-chat"],
        fallbackModelIds: ["minimax/MiniMax-M2.5"],
        status: "draft",
        rankingMode: "balanced",
        maxCostPerRequest: null,
        maxLatencyMs: null,
        requiredCapabilities: [],
        requiredHealth: null,
        updatedAt: 1_713_000_000_000,
      },
    ];

    const vm = buildPlatformModelsVM({
      readModel,
      legacyModelsVM: null,
    });

    expect(vm.routing.policies.map((policy) => policy.policyId)).toContain("policy-general-copy");
    expect(
      vm.routing.policies.find((policy) => policy.policyId === "policy-general-copy"),
    ).toMatchObject({
      name: "通用文本路由副本",
      status: "draft",
      candidates: {
        primary: ["deepseek/deepseek-chat"],
        fallback: ["minimax/MiniMax-M2.5"],
      },
    });
  });

  it("prefers server snapshot for plans, policies, and routing explanations", () => {
    const readModel = createReadModel();
    readModel.platformModelsMode = "aor_enhanced";
    readModel.modelsManagementSnapshot = {
      mode: "aor_enhanced",
      generatedAt: "2026-06-05T00:00:00.000Z",
      taskProfiles: [
        {
          taskProfileId: "coding",
          name: "Coding Plan",
          description: "Review code",
          category: "coding",
          priorityMode: "quality",
          status: "active",
        },
      ],
      taskPlans: [
        {
          planId: "coding_plan",
          taskProfileId: "coding",
          name: "Coding Plan",
          description: "Review code",
          audience: "platform",
          primaryModelIds: ["anthropic/claude-sonnet"],
          fallbackModelIds: [],
          costTarget: "medium",
          qualityTarget: "high",
          latencyTarget: "interactive",
          status: "published",
          userSelectable: true,
          tenantOverrideAllowed: false,
          updatedAt: 1_713_000_000_000,
          aorExecution: {
            taskTypeId: "coding.review",
            selectorStrategy: "bandit",
            evaluatorMode: "workspace",
          },
        },
      ],
      routingPolicies: [
        {
          policyId: "coding_policy",
          name: "Coding Policy",
          taskProfileId: "coding",
          planId: "coding_plan",
          primaryModelIds: ["anthropic/claude-sonnet"],
          fallbackModelIds: ["openai/gpt-4.1-mini"],
          status: "active",
          rankingMode: "bandit",
          maxCostPerRequest: 0.2,
          maxLatencyMs: 3000,
          requiredCapabilities: ["coding"],
          requiredHealth: "healthy",
          scope: { tenantIds: ["tenant-a"], userSegments: [], agentIds: [] },
        },
      ],
      usageByModel: [
        {
          modelRef: "anthropic/claude-sonnet",
          providerId: "anthropic",
          modelId: "claude-sonnet",
          calls7d: 42,
          cost7d: 3.5,
          successRate: 96,
          avgLatencyMs: 820,
        },
      ],
      usageByTask: [
        {
          taskProfileId: "coding",
          name: "Coding Plan",
          calls7d: 42,
          cost7d: 3.5,
          topModelRefs: ["anthropic/claude-sonnet"],
          failureRate: 4,
        },
      ],
      usageByPlan: [
        {
          planId: "coding_plan",
          taskProfileId: "coding",
          name: "Coding Plan",
          calls7d: 42,
          cost7d: 3.5,
        },
      ],
      usageByPolicy: [
        {
          policyId: "coding_policy",
          calls7d: 42,
          quantity: 42,
          primaryHitRate: 88,
          fallbackRate: 12,
          avgLatencyMs: 820,
          avgCostPerRequest: 0.083,
        },
      ],
      aor: {
        enabled: true,
        syncStatus: "ok",
        policyBindings: [],
        routingExplanations: [
          {
            requestId: "req-1",
            taskProfileId: "coding",
            planId: "coding_plan",
            selectedModelId: "anthropic/claude-sonnet",
            matchedRules: ["bandit"],
            rejectedModels: [{ modelId: "openai/gpt-4.1-mini", reason: "lower score" }],
            fallbackChain: [],
            decisionReason: "bandit arm winner",
            evaluatorScore: 0.91,
          },
        ],
        learning: { arms: [{ arm: "anthropic/claude-sonnet", mean: 0.9, trials: 12 }] },
        optimization: { savingsProxyQty: 3, revenueShareProxyQty: 1 },
        liveCodingEvidence: [],
      },
    };
    readModel.aor = readModel.modelsManagementSnapshot.aor;

    const vm = buildPlatformModelsVM({ readModel, legacyModelsVM: null });

    expect(vm.taskPlans.plans.map((plan) => plan.planId)).toEqual(["coding_plan"]);
    expect(vm.taskPlans.plans[0]?.aorExecution?.taskTypeId).toBe("coding.review");
    expect(vm.taskPlans.plans[0]?.userSelectable).toBe(true);
    expect(vm.routing.policies[0]?.ranking.mode).toBe("bandit");
    expect(vm.routing.policies[0]?.constraints.maxCostPerRequest).toBe(0.2);
    expect(vm.routing.policies[0]?.scope.tenantIds).toEqual(["tenant-a"]);
    expect(vm.routing.policies[0]?.performance?.primaryHitRate).toBe(88);
    expect(vm.routing.explanations).toHaveLength(1);
    expect(vm.analytics.byModel[0]?.calls7d).toBe(42);
    expect(vm.analytics.byTask[0]?.calls7d).toBe(42);
    expect(vm.analytics.byPlan[0]?.calls7d).toBe(42);
    expect(vm.analytics.aor?.banditArms).toHaveLength(1);
    expect(vm.platformModelsMode).toBe("aor_enhanced");
  });

  it("prefers server snapshot assets over local read-model directory assembly", () => {
    const readModel = createReadModel();
    readModel.modelDirectory = [
      {
        providerId: "deepseek",
        modelId: "deepseek-chat",
        name: "DeepSeek Chat",
        api: "openai-completions",
        providerApi: null,
        baseUrl: null,
        auth: null,
        reasoning: false,
        input: ["text"],
        contextWindow: 64000,
        maxTokens: 8192,
        costTier: "low",
        supportsTools: true,
      },
      {
        providerId: "minimax",
        modelId: "MiniMax-M2.5",
        name: "MiniMax M2.5",
        api: "openai-completions",
        providerApi: null,
        baseUrl: null,
        auth: null,
        reasoning: false,
        input: ["text"],
        contextWindow: 200000,
        maxTokens: 8192,
        costTier: "medium",
        supportsTools: true,
      },
    ];
    readModel.modelsManagementSnapshot = {
      mode: "native",
      generatedAt: "2026-06-05T00:00:00.000Z",
      assets: [
        {
          modelRef: "anthropic/claude-sonnet",
          providerId: "anthropic",
          modelId: "claude-sonnet",
          name: "Claude Sonnet",
          allowlisted: true,
          inCatalog: true,
        },
      ],
      taskPlans: [],
      taskProfiles: [],
      routingPolicies: [],
      usageByModel: [],
      usageByTask: [],
      usageByPlan: [],
      usageByPolicy: [],
      governanceIssues: [],
    };

    const vm = buildPlatformModelsVM({ readModel, legacyModelsVM: null });

    expect(vm.assets.models.map((asset) => asset.modelId)).toEqual([
      "anthropic/claude-sonnet",
      "deepseek/deepseek-chat",
      "minimax/MiniMax-M2.5",
    ]);
    expect(vm.assets.models[0]?.displayName).toBe("Claude Sonnet");
    expect(vm.assets.models[0]?.inRecommendationPool).toBe(true);
  });

  it("treats snapshot rows with matching modelDirectory entries as configured", () => {
    const readModel = createReadModel();
    readModel.gatewayCatalogCount = 2;
    readModel.gatewayCatalogModels = [
      {
        providerId: "google",
        modelId: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        contextWindow: 1_000_000,
      },
      {
        providerId: "minimax",
        modelId: "MiniMax-M2.5",
        name: "MiniMax M2.5",
        contextWindow: 200000,
      },
    ];
    readModel.modelDirectory = [
      {
        providerId: "google",
        modelId: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        api: "google-generative-ai",
        providerApi: null,
        baseUrl: null,
        auth: null,
        reasoning: false,
        input: ["text"],
        contextWindow: 1_000_000,
        maxTokens: 8192,
        costTier: "medium",
        supportsTools: true,
      },
    ];
    readModel.modelsManagementSnapshot = {
      mode: "native",
      generatedAt: "2026-06-05T00:00:00.000Z",
      assets: [
        {
          modelRef: "google/gemini-2.5-flash",
          providerId: "google",
          modelId: "gemini-2.5-flash",
          name: "Gemini 2.5 Flash",
          allowlisted: false,
          inCatalog: false,
        },
      ],
      taskPlans: [],
      taskProfiles: [],
      routingPolicies: [],
      usageByModel: [],
      usageByTask: [],
      usageByPlan: [],
      usageByPolicy: [],
      governanceIssues: [],
    };

    const vm = buildPlatformModelsVM({ readModel, legacyModelsVM: null });
    const asset = vm.assets.models.find((entry) => entry.modelId === "google/gemini-2.5-flash");

    expect(asset?.source).toBe("configured");
    expect(asset?.health).toBe("healthy");
    expect(asset?.healthBasis).toBe("config_inferred");
  });

  it("includes modelDirectory-only rows when snapshot has not caught up yet", () => {
    const readModel = createReadModel();
    readModel.modelDirectory = [
      {
        providerId: "google",
        modelId: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        api: "google-generative-ai",
        providerApi: null,
        baseUrl: null,
        auth: null,
        reasoning: false,
        input: ["text"],
        contextWindow: 1_000_000,
        maxTokens: 8192,
        costTier: "medium",
        supportsTools: true,
      },
    ];
    readModel.modelsManagementSnapshot = {
      mode: "native",
      generatedAt: "2026-06-05T00:00:00.000Z",
      assets: [],
      taskPlans: [],
      taskProfiles: [],
      routingPolicies: [],
      usageByModel: [],
      usageByTask: [],
      usageByPlan: [],
      usageByPolicy: [],
      governanceIssues: [],
    };

    const vm = buildPlatformModelsVM({ readModel, legacyModelsVM: null });

    expect(vm.assets.models.map((asset) => asset.modelId)).toEqual(["google/gemini-2.5-flash"]);
    expect(vm.assets.models[0]?.source).toBe("configured");
  });

  it("preserves relatedPolicyIds in governance issue context", () => {
    const readModel = createReadModel();
    readModel.modelsManagementSnapshot = {
      mode: "aor_enhanced",
      generatedAt: "2026-06-05T00:00:00.000Z",
      assets: [],
      taskPlans: [],
      taskProfiles: [],
      routingPolicies: [
        {
          policyId: "coding_policy",
          name: "Coding Policy",
          taskProfileId: "coding",
          planId: "coding_plan",
          primaryModelIds: ["anthropic/claude-sonnet"],
          fallbackModelIds: [],
          status: "active",
          rankingMode: "bandit",
          maxCostPerRequest: null,
          maxLatencyMs: null,
          requiredCapabilities: [],
          requiredHealth: null,
          scope: { tenantIds: [], userSegments: [], agentIds: [] },
        },
      ],
      usageByModel: [],
      usageByTask: [],
      usageByPlan: [],
      usageByPolicy: [],
      governanceIssues: [
        {
          issueId: "issue-aor-no-bindings",
          type: "aor_no_policy_bindings",
          severity: "warning",
          title: "AOR policy binding missing",
          description: "Policy has no AOR binding.",
          relatedPolicyIds: ["coding_policy"],
        },
      ],
    };

    const vm = buildPlatformModelsVM({ readModel, legacyModelsVM: null });
    const issue = vm.governance.issues.find(
      (candidate) => candidate.issueId === "issue-aor-no-bindings",
    );

    expect(issue?.relatedPolicyIds).toEqual(["coding_policy"]);
    expect(issue?.relatedTaskProfileIds).toBeUndefined();
    expect(issue?.context.policyId).toBe("coding_policy");
    expect(issue?.targetIds).toContain("coding_policy");
  });

  it("collapses a summed latency and does not migrate a model onto itself", () => {
    const usage = buildModelUsageAnalyticsVM({
      usageByModel: [
        {
          modelId: "deepseek/deepseek-chat",
          providerId: "deepseek",
          calls7d: 1042,
          cost7d: 1.91,
          avgCostPerCall: 0.0018,
          successRate: 99,
          avgLatencyMs: 258840.1,
          fallbackRate: 0,
        },
      ],
    });
    expect(usage.summary.totalCalls7d).toBe(1042);
    expect(usage.summary.avgLatencyMs).toBeCloseTo(248.4, 1);
    expect(usage.defaultView).toBe("byModel");

    const governance = buildModelGovernanceVM({
      models: [
        {
          modelId: "deepseek-chat",
          providerId: "deepseek",
          providerName: "deepseek",
          displayName: "deepseek-chat",
          source: "configured",
          inputModalities: ["text"],
          outputModalities: ["text"],
          capabilities: [],
          costTier: "low",
          health: "healthy",
          healthBasis: "config_inferred",
          taskTags: [],
          inRecommendationPool: true,
          tenantSelectable: true,
        },
      ],
      usage: {
        byModel: [
          {
            modelId: "deepseek/deepseek-chat",
            calls7d: 1042,
            cost7d: 1.91,
            avgCostPerCall: 0.0018,
            successRate: 99,
            avgLatencyMs: 248.4,
            fallbackRate: 0,
          },
        ],
      },
    });
    const insight = governance.insights.find((item) => item.type === "model_overused");
    expect(insight?.suggestion ?? "").not.toContain("迁移到 deepseek");
  });
});
