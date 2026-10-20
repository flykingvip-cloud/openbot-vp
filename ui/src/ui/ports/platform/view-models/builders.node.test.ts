import { describe, expect, it } from "vitest";
import { normalizeSkillReport } from "../../../capability/capability-governance/normalizer.ts";
import type {
  CapabilityGovernanceSnapshot,
  CapabilityProposal,
  CapabilityProposalStatus,
} from "../../../capability/capability-governance/types.ts";
import type { RuntimeCapabilityBinding } from "../../../capability/runtime-canonical/index.ts";
import type { SkillStatusReport } from "../../../types.ts";
import type { PlatformPortReadModel } from "../semantic/platform-read-model.ts";
import { buildPlatformPageViewModels } from "./builders.ts";

function reviewProposal(
  proposalId: string,
  status: CapabilityProposalStatus,
  name: string,
): CapabilityProposal {
  return {
    proposalId,
    submittedAt: "2026-05-10T00:00:00.000Z",
    submittedBy: "personal",
    status,
    manifest: {
      id: `urn:openclaw:skill:${proposalId}@1.0.0`,
      kind: "skill",
      version: "1.0.0",
      skillKey: proposalId,
      name,
      description: name,
      source: { kind: "personal", origin: "agents-skills-personal", trustTier: "user" },
      interface: { inputs: [], outputs: [] },
      contracts: { sideEffects: ["read_only"], idempotent: true, requiresConfirmation: false },
      behavior: { costModel: "free" },
      requirements: { bins: [], env: [], configPaths: [], operatingSystems: [] },
      install: [],
      risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
    },
    findings: [],
  };
}

function createReadModel(): PlatformPortReadModel {
  return {
    currentTenantId: "tenant-a",
    currentTenantLabel: "Tenant A",
    knownTenantIds: ["tenant-a"],
    tenantDirectory: [{ tenantId: "tenant-a", label: "Tenant A" }],
    enterpriseDirectory: [],
    agentDirectory: [],
    modelDirectory: [
      {
        providerId: "openai",
        modelId: "gpt-5.4",
        name: "GPT 5.4",
        api: "openai-responses",
        providerApi: "openai-responses",
        baseUrl: "https://api.openai.example/v1",
        auth: "api-key",
        reasoning: true,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 8192,
        costTier: "medium",
        supportsTools: true,
      },
    ],
    gatewayCatalogModels: [
      {
        providerId: "openai",
        modelId: "gpt-5.4",
        name: "GPT 5.4",
        contextWindow: 128000,
      },
      {
        providerId: "anthropic",
        modelId: "claude-sonnet-4.5",
        name: "Claude Sonnet 4.5",
        contextWindow: 200000,
      },
    ],
    taskPlanDirectory: [],
    routingPolicyDirectory: [],
    gatewayCatalogCount: 2,
    defaultModelPrimary: "openai/gpt-5.4",
    defaultModelFallbacks: ["anthropic/claude-sonnet-4.5"],
    defaultImageModelPrimary: "openai/gpt-image-1",
    allowlistedModelRefs: ["openai/gpt-5.4", "anthropic/claude-sonnet-4.5"],
    allowlistEntries: [
      { modelRef: "openai/gpt-5.4", alias: "GPT-5" },
      { modelRef: "anthropic/claude-sonnet-4.5", alias: null },
    ],
    aliasCount: 1,
    providerHealthDirectory: [
      {
        providerId: "openai",
        authMode: "api-key",
        authStatus: "ok",
        authLabel: "env:OPENAI_API_KEY",
        modelCount: 1,
        catalogCount: 1,
        issue: "配置与目录状态正常",
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
    sessionsCount: 0,
    totalTokens: 0,
    totalCost: 0,
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
    configuredProviderCount: 1,
    providerIds: ["openai"],
    configuredModelCount: 1,
    configuredModelIds: ["gpt-5.4"],
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
    runtimeAgents: [],
    runtimeBindings: [],
    runtimeTelemetry: [],
    runtimeGovernanceIssues: [],
    runtimeKpi: undefined,
  };
}

function makeRuntimeBinding(
  overrides: Partial<RuntimeCapabilityBinding> = {},
): RuntimeCapabilityBinding {
  return {
    bindingId: "binding-1",
    runtimeAgentId: "agent-1",
    capabilityId: "urn:openclaw:skill:github@0.0.0",
    capabilityVersion: "0.0.0",
    bindingType: "tenant-installed",
    routingPriority: 10,
    loadStrategy: "lazy",
    bindingState: "active",
    healthStatus: "healthy",
    invocationMetrics: {
      calls7d: 120,
      successRate7d: 0.95,
      avgLatencyMs: 450,
      p95LatencyMs: 900,
      errorCount7d: 6,
      tokenConsumption7d: 12000,
    },
    policy: {
      sandbox: "strict",
      resourceQuota: "small",
      hotReloadable: true,
    },
    fallbackBindingId: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe("platform page view models", () => {
  it("builds model routing and catalog management state", () => {
    const viewModels = buildPlatformPageViewModels({
      basePath: "/platform",
      readModel: createReadModel(),
      channelsProps: {} as never,
      authPanelProps: {
        state: {
          canManagePlatform: true,
          availableModes: ["platform-enterprise-create"],
        },
      } as never,
      skillsProps: null,
      instancesProps: null,
      configDirty: true,
      configSaving: false,
    });

    expect(viewModels.models.routingPrimary).toBe("openai/gpt-5.4");
    expect(viewModels.models.routingFallbacks).toEqual(["anthropic/claude-sonnet-4.5"]);
    expect(viewModels.models.routingImagePrimary).toBe("openai/gpt-image-1");
    expect(viewModels.models.gatewayCatalogEntries).toEqual([
      expect.objectContaining({
        providerId: "openai",
        modelId: "gpt-5.4",
        inPool: true,
      }),
      expect.objectContaining({
        providerId: "anthropic",
        modelId: "claude-sonnet-4.5",
        inPool: false,
      }),
    ]);
    expect(viewModels.models.routingCandidates).toEqual([
      "anthropic/claude-sonnet-4.5",
      "openai/gpt-5.4",
      "openai/gpt-image-1",
    ]);
    expect(viewModels.models.allowlistItems).toEqual([
      "openai/gpt-5.4",
      "anthropic/claude-sonnet-4.5",
    ]);
    expect(viewModels.models.allowlistEntries).toEqual([
      { modelRef: "openai/gpt-5.4", alias: "GPT-5" },
      { modelRef: "anthropic/claude-sonnet-4.5", alias: null },
    ]);
    expect(viewModels.models.aliasCount).toBe(1);
    expect(viewModels.models.providerHealthEntries).toEqual([
      expect.objectContaining({
        providerId: "openai",
        authStatus: "ok",
        authLabel: "env:OPENAI_API_KEY",
      }),
    ]);
  });
});

describe("capabilities governance view-model", () => {
  const FIXED_NOW = () => "2026-05-10T00:00:00.000Z";

  function makeSkillReport(
    overrides: Partial<SkillStatusReport["skills"][number]> = {},
  ): SkillStatusReport {
    return {
      workspaceDir: "/tmp/workspace",
      managedSkillsDir: "/tmp/managed",
      skills: [
        {
          name: "github",
          description: "GitHub operations via gh",
          source: "openclaw-bundled",
          filePath: "~/.openclaw/skills/github/SKILL.md",
          baseDir: "~/.openclaw/skills",
          skillKey: "github",
          bundled: true,
          always: false,
          disabled: false,
          blockedByAllowlist: false,
          eligible: true,
          requirements: { bins: ["gh"], env: [], config: [], os: [] },
          missing: { bins: [], env: [], config: [], os: [] },
          configChecks: [],
          install: [{ id: "brew", kind: "brew", label: "Install GitHub CLI (brew)", bins: ["gh"] }],
          ...overrides,
        },
      ],
    };
  }

  it("populates registry, proposals, summary, and active items from the snapshot", () => {
    const snapshot = normalizeSkillReport(
      {
        workspaceDir: "/tmp/workspace",
        managedSkillsDir: "/tmp/managed",
        skills: [
          // first-party → registry / active
          {
            name: "github",
            description: "GitHub operations via gh",
            source: "openclaw-bundled",
            filePath: "~/.openclaw/skills/github/SKILL.md",
            baseDir: "~/.openclaw/skills",
            skillKey: "github",
            bundled: true,
            always: false,
            disabled: false,
            blockedByAllowlist: false,
            eligible: true,
            requirements: { bins: ["gh"], env: [], config: [], os: [] },
            missing: { bins: [], env: [], config: [], os: [] },
            configChecks: [],
            install: [],
          },
          // third-party upload → proposal with findings
          {
            name: "openclaw-payment",
            description: "Suspicious payment skill",
            source: "upload:attacker-zip",
            filePath: "/tmp/attacker.zip",
            baseDir: "/tmp",
            skillKey: "openclaw-payment",
            bundled: false,
            always: false,
            disabled: false,
            blockedByAllowlist: false,
            eligible: true,
            requirements: { bins: ["payments-cli"], env: ["PAYMENTS_API_KEY"], config: [], os: [] },
            missing: { bins: [], env: ["PAYMENTS_API_KEY"], config: [], os: [] },
            configChecks: [],
            install: [],
          },
        ],
      },
      { now: FIXED_NOW },
    );

    const viewModels = buildPlatformPageViewModels({
      basePath: "/platform",
      readModel: createReadModel(),
      channelsProps: {} as never,
      authPanelProps: {
        state: { canManagePlatform: true, availableModes: ["platform-enterprise-create"] },
      } as never,
      skillsProps: null,
      instancesProps: null,
      configDirty: false,
      configSaving: false,
      capabilityGovernanceSnapshot: snapshot,
    });

    const cap = viewModels.capabilities;
    // Registry entries reflect bundled skill as active.
    expect(cap.registeredItems).toHaveLength(1);
    expect(cap.registeredItems[0].lifecycleState).toBe("active");
    expect(cap.registeredItems[0].trustTier).toBe("first-party");

    // Third-party upload lands in the discovery pool.
    expect(cap.discoveredItems).toHaveLength(1);
    expect(cap.discoveredItems[0].status).toBe("under_review");
    expect(cap.discoveredItems[0].trustTier).toBe("third-party");
    expect(cap.discoveredItems[0].findingCount).toBeGreaterThan(0);
    expect(cap.discoveredCounts.total).toBe(1);
    expect(cap.discoveredCounts.withFindings).toBe(1);

    // Summary uses `ok` tone once a registry entry exists, not `setup`/`warn`.
    const healthStat = cap.summary.find((s) => s.label === "部署健康");
    expect(healthStat?.tone).toBe("ok");

    // Snapshot is passed through for downstream consumers.
    expect(cap.snapshot).toBe(snapshot);
  });

  it("keeps approved proposals out of the pending review list", () => {
    const snapshot: CapabilityGovernanceSnapshot = {
      proposals: [
        reviewProposal("proposal:pending", "proposed", "Pending Skill"),
        reviewProposal("proposal:approved", "approved", "WorkBuddy"),
        reviewProposal("proposal:rejected", "rejected", "Rejected Skill"),
      ],
      registry: [],
      metrics: [],
    };
    const viewModels = buildPlatformPageViewModels({
      basePath: "/platform",
      readModel: createReadModel(),
      channelsProps: {} as never,
      authPanelProps: null,
      skillsProps: null,
      instancesProps: null,
      configDirty: false,
      configSaving: false,
      capabilityGovernanceSnapshot: snapshot,
    });

    expect(viewModels.capabilities.discoveredItems.map((item) => item.title)).toEqual([
      "Pending Skill",
    ]);
    expect(viewModels.capabilities.discoveredItems[0]?.status).toBe("proposed");
    expect(viewModels.capabilities.discoveredCounts.proposed).toBe(1);
    expect(viewModels.capabilities.discoveredCounts.total).toBe(3);
    expect(viewModels.capabilities.discoveredCounts.rejected).toBe(1);
  });

  it("flags summary as `setup` when no providers and no registry are configured", () => {
    const emptyReadModel = createReadModel();
    emptyReadModel.configuredProviderCount = 0;

    const viewModels = buildPlatformPageViewModels({
      basePath: "/platform",
      readModel: emptyReadModel,
      channelsProps: {} as never,
      authPanelProps: null,
      skillsProps: null,
      instancesProps: null,
      configDirty: false,
      configSaving: false,
      capabilityGovernanceSnapshot: { proposals: [], registry: [], metrics: [] },
    });

    const healthStat = viewModels.capabilities.summary.find((s) => s.label === "部署健康");
    expect(healthStat?.tone).toBe("setup");
    expect(healthStat?.value).toBe("待配置");
  });

  it("produces a setup checklist anchored to platform entry points", () => {
    const viewModels = buildPlatformPageViewModels({
      basePath: "/platform",
      readModel: createReadModel(),
      channelsProps: {} as never,
      authPanelProps: null,
      skillsProps: null,
      instancesProps: null,
      configDirty: false,
      configSaving: false,
      capabilityGovernanceSnapshot: { proposals: [], registry: [], metrics: [] },
    });

    const checklist = viewModels.capabilities.setupChecklist;
    expect(checklist.map((c) => c.title)).toEqual([
      "管理能力目录",
      "配置模型提供方",
      "配置通道分发",
    ]);
    // Meta reflects provider config presence (seed read model has 1 provider, 0 channels).
    expect(checklist[1].meta).toBe("已配置");
    expect(checklist[2].meta).toBe("待补齐");
    // Prevents the bug where makeSkillReport is unused-warn flagged.
    expect(makeSkillReport().skills[0].skillKey).toBe("github");
  });

  it("prefers runtime binding usage and tenant coverage over pseudo/demo values", () => {
    const skillsReport = {
      workspaceDir: "/tmp/workspace",
      managedSkillsDir: "/tmp/managed",
      skills: [
        {
          name: "github",
          description: "GitHub operations via gh",
          source: "openclaw-bundled",
          filePath: "~/.openclaw/skills/github/SKILL.md",
          baseDir: "~/.openclaw/skills",
          skillKey: "github",
          bundled: true,
          always: false,
          disabled: false,
          blockedByAllowlist: false,
          eligible: true,
          requirements: { bins: ["gh"], env: [], config: [], os: [] },
          missing: { bins: [], env: [], config: [], os: [] },
          configChecks: [],
          install: [],
        },
      ],
    } satisfies SkillStatusReport;
    const snapshot = normalizeSkillReport(skillsReport, { now: FIXED_NOW });

    const readModel = createReadModel();
    readModel.knownTenantIds = ["tenant-a", "tenant-b"];
    readModel.enterpriseDirectory = [
      {
        tenantId: "tenant-a",
        label: "Tenant A",
        status: "paid",
        plan: "pro",
        billingStatus: "active",
        createdSource: "platform-created",
        seatQuota: 10,
        seatUsed: 5,
        seatsRemaining: 5,
      },
      {
        tenantId: "tenant-b",
        label: "Tenant B",
        status: "trial",
        plan: "trial",
        billingStatus: "trialing",
        createdSource: "self-service",
        seatQuota: 3,
        seatUsed: 1,
        seatsRemaining: 2,
      },
    ];
    readModel.runtimeAgents = [
      {
        runtimeAgentId: "agent-1",
        name: "Agent One",
        runtimeVersion: "1.0.0",
        lifecycle: "deployed",
        health: "healthy",
        tenantCoverage: ["tenant-a"],
        boundCapabilityCount: 1,
        activeSessionCount: 2,
        resourceUsage: {
          cpuPercent: 10,
          memoryPercent: 20,
          tokenBudgetUsedPercent: 5,
        },
        deployedAt: 1,
        lastActiveAt: 2,
      },
    ];
    readModel.runtimeBindings = [makeRuntimeBinding()];

    const viewModels = buildPlatformPageViewModels({
      basePath: "/platform",
      readModel,
      channelsProps: {} as never,
      authPanelProps: null,
      skillsProps: {
        loading: false,
        report: skillsReport,
        error: null,
        canManage: true,
        readOnlyReason: null,
        filter: "",
        edits: {},
        busyKey: null,
        messages: {},
        onFilterChange: () => {},
        onRefresh: () => {},
        onToggle: () => {},
        onEdit: () => {},
        onSaveKey: () => {},
        onInstall: () => {},
      } as never,
      instancesProps: null,
      configDirty: false,
      configSaving: false,
      capabilityGovernanceSnapshot: snapshot,
    });

    const githubItem = viewModels.capabilities.catalogItems.find((item) => item.title === "github");
    expect(githubItem).toBeDefined();
    expect(githubItem?.calls7d).toBe(120);
    expect(githubItem?.calls7dLabel).toBe("120");
    expect(githubItem?.failureRateLabel).toBe("5.0%");

    const distributionRowA = viewModels.capabilities.distributionRows.find(
      (row) => row.tenantId === "tenant-a",
    );
    const distributionRowB = viewModels.capabilities.distributionRows.find(
      (row) => row.tenantId === "tenant-b",
    );
    expect(distributionRowA?.enabledCount).toBe(1);
    expect(distributionRowB?.enabledCount).toBe(0);

    const codeCategory = viewModels.capabilities.categories.find((entry) => entry.id === "code");
    expect(codeCategory?.highlight).toBe("github");
  });

  it("does not synthesize provider-backed fake catalog entries when no capability sources exist", () => {
    const readModel = createReadModel();
    readModel.providerIds = ["openai", "anthropic"];
    readModel.configuredProviderCount = 2;

    const viewModels = buildPlatformPageViewModels({
      basePath: "/platform",
      readModel,
      channelsProps: {} as never,
      authPanelProps: null,
      skillsProps: null,
      instancesProps: null,
      configDirty: false,
      configSaving: false,
      capabilityGovernanceSnapshot: { proposals: [], registry: [], metrics: [] },
    });

    expect(viewModels.capabilities.catalogItems).toEqual([]);
    expect(viewModels.capabilities.categories).toEqual([]);
    expect(viewModels.capabilities.installedItems).toEqual([]);
  });

  it("tolerates registry manifests that omit install when skills report missing bins", () => {
    // Production BlRSQkzV crashed here: entry.manifest.install.length when install
    // was undefined, aborting the whole platform shell render.
    const skillsReport = makeSkillReport({
      missing: { bins: ["gh"], env: [], config: [], os: [] },
      install: undefined as unknown as [],
    });
    const snapshot = normalizeSkillReport(skillsReport, { now: FIXED_NOW });
    // Simulate a persisted/gateway snapshot that dropped install entirely.
    const brokenSnapshot = {
      ...snapshot,
      registry: snapshot.registry.map((entry) => ({
        ...entry,
        manifest: {
          ...entry.manifest,
          install: undefined as unknown as typeof entry.manifest.install,
        },
      })),
    };

    expect(() =>
      buildPlatformPageViewModels({
        basePath: "/platform",
        readModel: createReadModel(),
        channelsProps: {} as never,
        authPanelProps: null,
        skillsProps: {
          loading: false,
          report: skillsReport,
          error: null,
          canManage: true,
          readOnlyReason: null,
          filter: "",
          edits: {},
          busyKey: null,
          messages: {},
          onFilterChange: () => {},
          onRefresh: () => {},
          onToggle: () => {},
          onEdit: () => {},
          onSaveKey: () => {},
          onInstall: () => {},
        } as never,
        instancesProps: null,
        configDirty: false,
        configSaving: false,
        capabilityGovernanceSnapshot: brokenSnapshot,
      }),
    ).not.toThrow();

    const viewModels = buildPlatformPageViewModels({
      basePath: "/platform",
      readModel: createReadModel(),
      channelsProps: {} as never,
      authPanelProps: null,
      skillsProps: {
        loading: false,
        report: skillsReport,
        error: null,
        canManage: true,
        readOnlyReason: null,
        filter: "",
        edits: {},
        busyKey: null,
        messages: {},
        onFilterChange: () => {},
        onRefresh: () => {},
        onToggle: () => {},
        onEdit: () => {},
        onSaveKey: () => {},
        onInstall: () => {},
      } as never,
      instancesProps: null,
      configDirty: false,
      configSaving: false,
      capabilityGovernanceSnapshot: brokenSnapshot,
    });

    expect(viewModels.capabilities.healthItems.some((item) => item.kind === "missing-bin")).toBe(
      true,
    );
    expect(
      viewModels.capabilities.healthItems.find((item) => item.kind === "missing-bin")?.meta,
    ).toBe("需手动安装");
  });
});
