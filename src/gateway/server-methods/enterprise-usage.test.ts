import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-enterprise-usage-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    meta: { lastTouchedVersion: "2026.3.9" },
    gateway: {
      auth: {
        trustedProxy: {
          userHeader: "x-forwarded-user",
          platformAuth: {
            enabled: true,
            store: path.join(tmpDir, "openbot-platform-auth.json"),
          },
        },
      },
    },
  }),
}));

const { enterpriseUsageHandlers } = await import("./enterprise-usage.js");
const {
  __agentRuntimeStoreInternals,
  getIssueAcknowledgement,
  listAgents,
  recordTelemetry,
  upsertAgent,
  upsertBinding,
} = await import("../agent-runtime-store.js");
const { registerCapability } = await import("../capability-governance-store.js");
const { savePlatformAuthStore } = await import("../platform-auth.js");

type HandlerResponse = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

function cleanStore() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

async function invoke(
  method: string,
  params: Record<string, unknown> = {},
  userEmail = "alice@example.com",
): Promise<HandlerResponse> {
  const handler = enterpriseUsageHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: HandlerResponse | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: {
      connect: {
        minProtocol: 1,
        maxProtocol: 1,
        client: {
          id: "openbot-control-ui",
          version: "2026.3.9",
          platform: "macos",
          mode: "control-ui",
        },
      } as never,
      user: userEmail,
    },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = { ok, payload, error };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

function registerFixtureCapabilities() {
  registerCapability({
    id: "urn:openclaw:skill:customer-summary@1.0.0",
    kind: "skill",
    version: "1.0.0",
    skillKey: "customer-summary",
    name: "客户沟通整理",
    description: "把客户对话整理为清晰摘要",
    descriptionZh: "把客户对话整理为清晰摘要",
    source: { kind: "personal", origin: "employee-capability:customer-summary", trustTier: "user" },
    risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
  });
  registerCapability({
    id: "urn:openclaw:skill:invoice-reader@1.0.0",
    kind: "skill",
    version: "1.0.0",
    skillKey: "invoice-reader",
    name: "发票识别",
    description: "识别发票和报销单据",
    descriptionZh: "识别发票和报销单据",
    source: { kind: "platform", origin: "openclaw-bundled", trustTier: "first-party" },
    risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
  });
}

async function prepareUsageTenants() {
  await savePlatformAuthStore(
    {
      enabled: true,
      storePath: path.join(tmpDir, "openbot-platform-auth.json"),
      sessionTtlHours: 24,
      activationTtlHours: 24,
      passwordResetTtlMinutes: 30,
      cookieName: "openbot_platform_auth",
      requireMfaForPlatformAdmins: true,
    },
    {
      version: 4,
      secret: "test-secret",
      policy: {
        defaultTrialDays: 7,
        allowedTrialDays: [7],
        defaultTrialSeatCount: 5,
        trialSeatOptions: [5],
        allowCustomTrialSeatCount: false,
        trialExpiryPolicy: "redirect_to_upgrade",
        updatedAt: "2026-05-18T00:00:00.000Z",
      },
      enterprises: {
        "tenant-a": {
          id: "tenant-a",
          name: "Tenant A",
          slug: "tenant-a",
          status: "paid",
          plan: "pro",
          createdSource: "platform-created",
          billingStatus: "paid",
          createdAt: "2026-05-18T00:00:00.000Z",
          updatedAt: "2026-05-18T00:00:00.000Z",
          seatQuota: 10,
          seatUsed: 1,
        },
        "tenant-b": {
          id: "tenant-b",
          name: "Tenant B",
          slug: "tenant-b",
          status: "paid",
          plan: "pro",
          createdSource: "platform-created",
          billingStatus: "paid",
          createdAt: "2026-05-17T00:00:00.000Z",
          updatedAt: "2026-05-17T00:00:00.000Z",
          seatQuota: 10,
          seatUsed: 1,
        },
      },
      users: {
        "user-a": {
          id: "user-a",
          email: "alice@example.com",
          normalizedEmail: "alice@example.com",
          displayName: "Alice",
          passwordHash: "x",
          passwordUpdatedAt: "2026-05-18T00:00:00.000Z",
          loginFailedCount: 0,
          status: "active",
          source: "platform-created",
          role: "operator",
          scopes: ["operator.read"],
          createdAt: "2026-05-18T00:00:00.000Z",
          updatedAt: "2026-05-18T00:00:00.000Z",
        },
      },
      sessions: {},
      memberships: {
        "membership-a": {
          id: "membership-a",
          userId: "user-a",
          enterpriseId: "tenant-a",
          membershipRole: "admin",
          createdAt: "2026-05-18T00:00:00.000Z",
          updatedAt: "2026-05-18T00:00:00.000Z",
        },
      },
      adminProvisions: {},
      employeeProvisions: {},
      activationCodes: {},
      trialApplications: {},
      leadNotifications: {},
    } as never,
  );
}

function seedRuntimeUsage(calls7d = 25, successRate7d = 0.82) {
  upsertAgent({
    runtimeAgentId: "tenant-a-runtime",
    name: "Tenant A Runtime",
    runtimeVersion: "2026.3.9",
    lifecycle: "deployed",
    health: "healthy",
    tenantCoverage: ["tenant-a"],
    boundCapabilityCount: 0,
    activeSessionCount: 2,
    resourceUsage: {
      cpuPercent: 0.12,
      memoryPercent: 0.24,
      tokenBudgetUsedPercent: 0.2,
    },
    deployedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
    lastActiveAt: Date.now(),
  });
  upsertAgent({
    runtimeAgentId: "tenant-b-runtime",
    name: "Tenant B Runtime",
    runtimeVersion: "2026.3.9",
    lifecycle: "deployed",
    health: "healthy",
    tenantCoverage: ["tenant-b"],
    boundCapabilityCount: 0,
    activeSessionCount: 4,
    resourceUsage: {
      cpuPercent: 0.9,
      memoryPercent: 0.9,
      tokenBudgetUsedPercent: 0.9,
    },
    deployedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
    lastActiveAt: Date.now(),
  });
  const binding = upsertBinding({
    runtimeAgentId: "tenant-a-runtime",
    capabilityId: "urn:openclaw:skill:invoice-reader@1.0.0",
    capabilityVersion: "1.0.0",
    bindingType: "tenant-installed",
    loadStrategy: "on-demand",
    routingPriority: 20,
    policy: { sandbox: "strict", resourceQuota: "small", hotReloadable: true },
    fallbackBindingId: null,
  });
  const agent = listAgents({
    lifecycle: null,
    health: null,
    tenantId: "tenant-a",
    searchQuery: "",
  })[0];
  if (!agent) {
    throw new Error("missing runtime agent");
  }
  recordTelemetry({
    runtimeAgentId: binding.runtimeAgentId,
    capabilityId: binding.capabilityId,
    calls7d,
    successRate7d,
    avgLatencyMs: 120,
    p95LatencyMs: 240,
    tokenConsumption7d: 1000,
    errorCount7d: Math.round(calls7d * (1 - successRate7d)),
    queueDepth: 0,
    memoryPressure: 0,
    lastSampleAt: Date.now(),
  });
  return { agent, binding };
}

describe("enterprise-usage handlers", () => {
  beforeEach(async () => {
    cleanStore();
    __agentRuntimeStoreInternals.reset();
    await prepareUsageTenants();
    registerFixtureCapabilities();
    seedRuntimeUsage();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("projects runtime bindings into robot capability views", async () => {
    const response = await invoke("enterprise-usage.list-robot-capability-views", {
      filters: { nameQuery: "", healthStatus: null, monthlyExecutionsRange: "全部" },
      sorting: { field: "monthlyExecutions", direction: "desc" },
      pagination: { page: 1, pageSize: 10 },
    });

    expect(response.ok).toBe(true);
    const payload = response.payload as {
      items: Array<{
        robotId: string;
        robotName: string;
        capabilityCount: number;
        healthStatus: string;
        topCapabilities: string[];
      }>;
      kpis: { totalRobots: number; totalMonthlyExecutions: number };
    };
    expect(payload.items.some((item) => item.robotName === "Tenant A Runtime")).toBe(true);
    expect(payload.items.some((item) => item.robotName === "Tenant B Runtime")).toBe(false);
    expect(payload.items.every((item) => item.robotId !== "tenant-b-runtime")).toBe(true);
    expect(payload.kpis.totalRobots).toBe(payload.items.length);
    expect(payload.items.find((item) => item.robotName === "Tenant A Runtime")).toMatchObject({
      capabilityCount: 1,
      healthStatus: "效果稳定",
    });
    expect(payload.items[0]?.topCapabilities).toContain("发票识别");
    expect(JSON.stringify(payload)).not.toMatch(/runtimeAgentId|bindingId|bindingType|cpu|memory/);
  });

  it("returns robot detail and analytics from the same runtime bindings", async () => {
    __agentRuntimeStoreInternals.reset();
    seedRuntimeUsage(25, 0.82);
    const list = await invoke("enterprise-usage.list-robot-capability-views", {
      filters: { nameQuery: "", healthStatus: null, monthlyExecutionsRange: "全部" },
      sorting: { field: "monthlyExecutions", direction: "desc" },
      pagination: { page: 1, pageSize: 10 },
    });
    const robotId = (list.payload as { items: Array<{ robotId: string }> }).items[0]?.robotId;
    expect(robotId).toBeTruthy();

    const detail = await invoke("enterprise-usage.get-robot-detail", { robotId });
    expect(detail.ok).toBe(true);
    expect(
      (detail.payload as { capabilities: Array<{ capabilityName: string }> }).capabilities,
    ).toContainEqual(expect.objectContaining({ capabilityName: "发票识别" }));

    const analytics = await invoke("enterprise-usage.get-analytics", { window: 30 });
    expect(analytics.ok).toBe(true);
    const analyticsPayload = analytics.payload as {
      kpis: { coveredRobots: { current: number }; averageSuccessRate: { current: number } };
      topCapabilities: Array<{ capabilityName: string; coveredRobots: number }>;
    };
    expect(analyticsPayload.kpis.coveredRobots.current).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(analytics.payload)).not.toContain("tenant-b-runtime");
    expect(analyticsPayload.kpis.averageSuccessRate.current).toBeGreaterThan(0);
    expect(analyticsPayload.topCapabilities).toContainEqual(
      expect.objectContaining({ capabilityName: "发票识别" }),
    );
    expect(
      analyticsPayload.topCapabilities.find((entry) => entry.capabilityName === "发票识别")
        ?.coveredRobots,
    ).toBeGreaterThanOrEqual(1);
  });

  it("detects governance issues using configurable business thresholds", async () => {
    __agentRuntimeStoreInternals.reset();
    seedRuntimeUsage(25, 0.82);
    const updated = await invoke("enterprise-usage.update-governance-config", {
      config: { lowEfficiency: { minExecutions: 0, maxSuccessRate: 0.99 } },
    });
    expect(updated.ok).toBe(true);

    const detected = await invoke("enterprise-usage.detect-governance", {
      config: (updated.payload as { config: unknown }).config,
    });
    expect(detected.ok).toBe(true);
    const lowEfficiency = (detected.payload as { lowEfficiency: Array<{ type: string }> })
      .lowEfficiency;
    expect(lowEfficiency).toContainEqual(expect.objectContaining({ type: "低效能力" }));

    const acknowledged = await invoke("enterprise-usage.acknowledge-governance", {
      issueId: "低效能力:urn:openclaw:skill:invoice-reader@1.0.0:tenant-a-runtime",
    });
    expect(acknowledged.payload).toEqual({ acknowledged: true });
    expect(
      getIssueAcknowledgement("低效能力:urn:openclaw:skill:invoice-reader@1.0.0:tenant-a-runtime")
        ?.reviewerId,
    ).toBe("alice@example.com");
  });

  it("returns zero robots when the caller has no authoritative tenant", async () => {
    const response = await invoke(
      "enterprise-usage.list-robot-capability-views",
      {
        filters: { nameQuery: "", healthStatus: null, monthlyExecutionsRange: "全部" },
        sorting: { field: "monthlyExecutions", direction: "desc" },
        pagination: { page: 1, pageSize: 10 },
      },
      "stranger@example.com",
    );
    expect(response.ok).toBe(true);
    const payload = response.payload as {
      items: unknown[];
      kpis: { totalRobots: number };
    };
    expect(payload.items).toEqual([]);
    expect(payload.kpis.totalRobots).toBe(0);
  });
});
