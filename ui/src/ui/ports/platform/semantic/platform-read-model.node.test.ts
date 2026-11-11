import { describe, expect, it } from "vitest";
import { buildPlatformPortReadModel } from "./platform-read-model.ts";

describe("platform read model", () => {
  it("derives tenant, account, usage, and model summaries from shared state", () => {
    const model = buildPlatformPortReadModel(
      {
        hello: {
          auth: {
            tenantId: "tenant-a",
            provider: "trusted-proxy",
            user: "ops@example.com",
            role: "operator",
          },
          features: { methods: ["status", "cron.run", "agents.update"] },
          server: { version: "1.2.3" },
        },
        platformAuthState: {
          tenantName: "Acme",
          latestInvite: { code: "INVITE-1", expiresAt: "2026-05-01", tenantId: "tenant-b" },
          platformEnterprises: [
            {
              id: "tenant-a",
              name: "Acme",
              status: "paid",
              plan: "enterprise",
              billingStatus: "active",
              createdSource: "platform-created",
              seatQuota: 20,
              seatUsed: 8,
              seatsRemaining: 12,
              contributionSummary: {
                submittedAssetPackages: 12,
                approvedAssets: 9,
                incubationCandidates: 4,
                platformCandidates: 2,
                crossTenantReuseCount: 7,
                publishedSharedAssets: 3,
                updatedAt: 1_710_000_000_000,
              },
            },
          ],
        },
        bootstrapAuthSession: null,
        settings: {
          recentEnterpriseTenantIds: ["tenant-c", "tenant-a"],
        },
        agentsList: {
          defaultId: "main",
          agents: [{ id: "main" }, { id: "sales" }],
        },
        channelsSnapshot: {
          channelMeta: [{ id: "slack", label: "Slack", detailLabel: "Slack" }],
          channelOrder: ["slack"],
          channelAccounts: {
            slack: [
              { accountId: "acct-1", connected: true },
              { accountId: "acct-2", running: false },
            ],
          },
        },
        presenceEntries: [{ host: "node-a" }, { host: "node-b" }],
        runtimeAgents: [],
        runtimeBindings: [],
        runtimeTelemetry: [],
        runtimeGovernanceIssues: [],
        runtimeKpi: null,
        sessionsResult: { count: 7 },
        usageResult: {
          totals: {
            totalTokens: 1234,
            totalCost: 4.56,
            missingCostEntries: 2,
          },
        },
        updateAvailable: {
          currentVersion: "1.2.3",
          latestVersion: "1.3.0",
        },
        cronStatus: {
          enabled: true,
          nextWakeAtMs: 123456,
        },
      } as never,
      {
        models: {
          mode: "balanced",
          providers: {
            openai: {
              baseUrl: "https://api.openai.example/v1",
              apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
              auth: "api-key",
              api: "openai-responses",
              models: [
                "gpt-5.2",
                {
                  id: "gpt-5.4",
                  name: "GPT 5.4",
                  input: ["text", "image"],
                  reasoning: true,
                  contextWindow: 256000,
                  maxTokens: 32000,
                  cost: { input: 0.001, output: 0.004, cacheRead: 0, cacheWrite: 0 },
                  compat: { supportsTools: true },
                },
              ],
            },
          },
        },
        agents: {
          defaults: {
            model: {
              primary: "openai/gpt-5.4",
              fallbacks: ["anthropic/claude-sonnet-4.5"],
            },
            imageModel: "openai/gpt-image-1",
            models: {
              "openai/gpt-5.4": { alias: "GPT-5" },
              "anthropic/claude-sonnet-4.5": {},
            },
          },
        },
      },
    );

    expect(model.currentTenantLabel).toBe("Acme");
    expect(model.knownTenantIds).toEqual(["tenant-a", "tenant-c", "tenant-b"]);
    expect(model.tenantDirectory).toEqual([
      { tenantId: "tenant-a", label: "Acme" },
      { tenantId: "tenant-c", label: "tenant-c" },
      { tenantId: "tenant-b", label: "tenant-b" },
    ]);
    expect(model.channelIds).toEqual(["slack"]);
    expect(model.runtimeHosts).toEqual(["node-a", "node-b"]);
    expect(model.accountCount).toBe(2);
    expect(model.connectedAccountCount).toBe(1);
    expect(model.totalTokens).toBe(1234);
    expect(model.configuredProviderCount).toBe(1);
    expect(model.providerIds).toEqual(["openai"]);
    expect(model.shellSnapshotReady).toBe(true);
    expect(model.configuredModelCount).toBe(2);
    expect(model.configuredModelIds).toEqual(["gpt-5.2", "gpt-5.4"]);
    expect(model.modelDirectory[1]).toMatchObject({
      providerId: "openai",
      modelId: "gpt-5.4",
      name: "GPT 5.4",
      api: "openai-responses",
      baseUrl: "https://api.openai.example/v1",
      auth: "api-key",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 256000,
      maxTokens: 32000,
      costTier: "medium",
      supportsTools: true,
    });
    expect(model.providerHealthDirectory).toEqual([
      expect.objectContaining({
        providerId: "openai",
        authMode: "api-key",
        authStatus: "ok",
        authLabel: "env:OPENAI_API_KEY",
        modelCount: 2,
      }),
    ]);
    expect(model.defaultModelPrimary).toBe("openai/gpt-5.4");
    expect(model.defaultModelFallbacks).toEqual(["anthropic/claude-sonnet-4.5"]);
    expect(model.defaultImageModelPrimary).toBe("openai/gpt-image-1");
    expect(model.allowlistEntries).toEqual([
      { modelRef: "anthropic/claude-sonnet-4.5", alias: null },
      { modelRef: "openai/gpt-5.4", alias: "GPT-5" },
    ]);
    expect(model.installedCapabilityCount).toBe(2);
    expect(model.hasUpdateAvailable).toBe(true);
    expect(model.attentionItems[0]).toContain("Runtime update available");
    expect(model.enterpriseDirectory[0]?.contributionSummary).toEqual({
      submittedAssetPackages: 12,
      approvedAssets: 9,
      incubationCandidates: 4,
      platformCandidates: 2,
      crossTenantReuseCount: 7,
      publishedSharedAssets: 3,
      updatedAt: 1_710_000_000_000,
    });
    expect(model.runtimeAgents).toEqual([]);
    expect(model.runtimeBindings).toEqual([]);
    expect(model.runtimeTelemetry).toEqual([]);
    expect(model.runtimeGovernanceIssues).toEqual([]);
    expect(model.runtimeKpi).toBeUndefined();
  });

  it("keeps the shell pending until sessions, usage, or channels arrive", () => {
    const model = buildPlatformPortReadModel(
      {
        hello: null,
        platformAuthState: null,
        bootstrapAuthSession: null,
        settings: {},
        agentsList: null,
        channelsSnapshot: null,
        presenceEntries: [],
        sessionsResult: null,
        usageResult: null,
      } as never,
      null,
    );
    expect(model.shellSnapshotReady).toBe(false);
    expect(model.sessionsCount).toBe(0);
    expect(model.channelCount).toBe(0);
  });

  it("projects only server-confirmed tenantGrant values onto the enterprise directory", () => {
    const model = buildPlatformPortReadModel(
      {
        hello: { auth: { tenantId: "tenant-a", provider: "trusted-proxy", user: "ops" } },
        platformAuthState: {
          platformEnterprises: [
            {
              id: "tenant-granted",
              name: "已授权企业",
              tenantGrant: "granted",
              status: "paid",
              plan: "enterprise",
              billingStatus: "active",
              createdSource: "platform-created",
              seatQuota: 1,
              seatUsed: 0,
              seatsRemaining: 1,
            },
            {
              id: "tenant-none",
              name: "无授权企业",
              tenantGrant: "none",
              status: "paid",
              plan: "enterprise",
              billingStatus: "active",
              createdSource: "platform-created",
              seatQuota: 1,
              seatUsed: 0,
              seatsRemaining: 1,
            },
            {
              id: "tenant-unknown",
              name: "未确认企业",
              tenantGrant: "unknown",
              status: "trial",
              plan: "trial",
              billingStatus: "ok",
              createdSource: "self-service",
              seatQuota: 1,
              seatUsed: 0,
              seatsRemaining: 1,
            },
            {
              id: "tenant-omitted",
              name: "未返回授权企业",
              status: "paid",
              plan: "enterprise",
              billingStatus: "active",
              createdSource: "platform-created",
              seatQuota: 1,
              seatUsed: 0,
              seatsRemaining: 1,
            },
            {
              id: "tenant-paid-status",
              name: "仅有付费状态",
              tenantGrant: "paid",
              status: "paid",
              plan: "enterprise",
              billingStatus: "active",
              createdSource: "platform-created",
              seatQuota: 1,
              seatUsed: 0,
              seatsRemaining: 1,
            },
          ],
        },
        bootstrapAuthSession: null,
        settings: {},
        agentsList: null,
        channelsSnapshot: null,
        presenceEntries: [],
        sessionsResult: null,
        usageResult: null,
      } as never,
      null,
    );
    const byId = Object.fromEntries(
      model.enterpriseDirectory.map((entry) => [entry.tenantId, entry.tenantGrant]),
    );
    expect(byId).toEqual({
      "tenant-granted": "granted",
      "tenant-none": "none",
      "tenant-unknown": "unknown",
      "tenant-omitted": "unknown",
      "tenant-paid-status": "unknown",
    });
  });
});
