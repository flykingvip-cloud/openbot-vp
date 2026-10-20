// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-governance-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const { governanceHandlers } = await import("./governance.js");
const { __agentRuntimeStoreInternals, recordTelemetry, upsertAgent, upsertBinding } =
  await import("../agent-runtime-store.js");
const { upsertOwnershipRecord } = await import("../ownership-store.js");
const loadConfigMock = vi.hoisted(() => vi.fn(() => ({})));

type InvokeResult = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

vi.mock("../../config/config.js", () => ({
  loadConfig: loadConfigMock,
}));

vi.mock("../../config/paths.js", () => ({
  get STATE_DIR() {
    return tmpDir;
  },
  resolveStateDir: vi.fn(() => tmpDir),
  resolveOAuthDir: vi.fn(() => path.join(tmpDir, "oauth")),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: vi.fn(() => "main"),
  resolveAgentWorkspaceDir: vi.fn(() => tmpDir),
}));

function cleanStore() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
}

async function writeManagedSpaceFile(groupId: string, filename: string, data: unknown) {
  const groupDir = path.join(tmpDir, "collaboration", "groups", encodeURIComponent(groupId));
  await fs.promises.mkdir(groupDir, { recursive: true });
  await fs.promises.writeFile(path.join(groupDir, filename), JSON.stringify(data));
}

async function invoke(
  method: string,
  params: Record<string, unknown> = {},
  options?: { omitTenant?: boolean },
): Promise<InvokeResult> {
  const handler = governanceHandlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  const requestParams = options?.omitTenant ? params : { tenantId: "tenant-a", ...params };
  let response: InvokeResult | null = null;
  await handler({
    req: { type: "req", id: "test", method, params: requestParams },
    params: requestParams,
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
      user: "owner@example.com",
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

function seedRuntime() {
  upsertAgent({
    runtimeAgentId: "sales-runtime",
    name: "Sales Runtime",
    runtimeVersion: "2026.3.9",
    lifecycle: "deployed",
    health: "healthy",
    tenantCoverage: ["tenant-a"],
    boundCapabilityCount: 0,
    activeSessionCount: 3,
    resourceUsage: {
      cpuPercent: 0.2,
      memoryPercent: 0.3,
      tokenBudgetUsedPercent: 0.25,
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
    activeSessionCount: 1,
    resourceUsage: {
      cpuPercent: 0.4,
      memoryPercent: 0.4,
      tokenBudgetUsedPercent: 0.4,
    },
    deployedAt: Date.now() - 24 * 60 * 60 * 1000,
    lastActiveAt: Date.now(),
  });
  upsertBinding({
    runtimeAgentId: "tenant-b-runtime",
    capabilityId: "urn:openbot:capability:host",
    capabilityVersion: "1.0.0",
    bindingType: "tenant-installed",
    loadStrategy: "on-demand",
    routingPriority: 10,
    policy: { sandbox: "strict", resourceQuota: "small", hotReloadable: true },
    fallbackBindingId: null,
  });
  const binding = upsertBinding({
    runtimeAgentId: "sales-runtime",
    capabilityId: "urn:openbot:capability:sales",
    capabilityVersion: "1.0.0",
    bindingType: "tenant-installed",
    loadStrategy: "on-demand",
    routingPriority: 10,
    policy: { sandbox: "strict", resourceQuota: "small", hotReloadable: true },
    fallbackBindingId: null,
  });
  recordTelemetry({
    runtimeAgentId: binding.runtimeAgentId,
    capabilityId: binding.capabilityId,
    calls7d: 90,
    successRate7d: 0.92,
    avgLatencyMs: 140,
    p95LatencyMs: 260,
    tokenConsumption7d: 28000,
    errorCount7d: 7,
    queueDepth: 0,
    memoryPressure: 0.12,
    lastSampleAt: Date.now(),
  });
  upsertOwnershipRecord({
    tenantId: "tenant-a",
    subjectKind: "agent",
    subjectId: "sales-runtime",
    positionId: "pos-sales",
    positionLabel: "Sales",
    createdByUserId: "owner@example.com",
    createdByUserLabel: "Owner",
    currentManagerUserId: "owner@example.com",
    currentManagerLabel: "Owner",
  });
  upsertOwnershipRecord({
    tenantId: "tenant-a",
    subjectKind: "group",
    subjectId: "group-revenue",
    positionId: "pos-revenue",
    positionLabel: "Revenue",
    createdByUserId: "carol@example.com",
    createdByUserLabel: "Carol White",
    currentManagerUserId: "carol@example.com",
    currentManagerLabel: "Carol White",
  });
}

describe("governance handlers", () => {
  beforeEach(() => {
    cleanStore();
    __agentRuntimeStoreInternals.reset();
    seedRuntime();
  });

  it("lists governance assets from real runtime and ownership stores", async () => {
    await writeManagedSpaceFile("group-revenue", "profile.json", {
      profile: {
        id: "group-revenue",
        groupId: "group-revenue",
        name: "Revenue Squad",
        displayName: "Revenue Squad",
        createdAtMs: 1,
        updatedAtMs: 2,
      },
    });
    await writeManagedSpaceFile("group-revenue", "members.json", {
      members: [
        {
          memberId: "human:carol",
          memberKind: "human",
          userId: "carol@example.com",
          name: "Carol White",
          governanceRole: "owner",
          status: "active",
          joinedAtMs: 1,
          updatedAtMs: 2,
        },
      ],
    });
    const response = await invoke("governance.assets.list", {
      filters: {},
      sorting: { field: "name", direction: "asc" },
      pagination: { page: 1, pageSize: 10 },
    });
    expect(response.ok).toBe(true);
    const payload = response.payload as {
      items: Array<{
        id: string;
        name: string;
        type: string;
        owner: string | null;
        memberCount?: number;
      }>;
    };
    expect(
      payload.items.some(
        (item) =>
          item.id === "sales-runtime" && item.name === "Sales Runtime" && item.owner === "Owner",
      ),
    ).toBe(true);
    expect(
      payload.items.some(
        (item) => item.id === "group-revenue" && item.type === "group" && item.memberCount === 1,
      ),
    ).toBe(true);
  });

  it("lists anomalies from derived governance issues", async () => {
    const response = await invoke("governance.anomalies.list", {
      filters: {},
      pagination: { page: 1, pageSize: 10 },
    });
    expect(response.ok).toBe(true);
    const payload = response.payload as { items: Array<{ assetId: string; status: string }> };
    expect(Array.isArray(payload.items)).toBe(true);
  });

  it("records and lists governance actions", async () => {
    const execute = await invoke("governance.actions.execute", { actionId: "action-1" });
    expect(execute.ok).toBe(true);

    const list = await invoke("governance.actions.list", {
      filters: {},
      pagination: { page: 1, pageSize: 10 },
    });
    expect(list.ok).toBe(true);
    const payload = list.payload as { items: Array<{ id: string }> };
    expect(Array.isArray(payload.items)).toBe(true);
  });

  it("returns ranking from derived governance scores", async () => {
    const response = await invoke("governance.ranking.get", { type: "bot" });
    expect(response.ok).toBe(true);
    const payload = response.payload as {
      items: Array<{ id: string; rank: number; score: number }>;
    };
    expect(payload.items.length).toBeGreaterThan(0);
    expect(payload.items[0]?.rank).toBe(1);
  });

  it("returns dashboard metrics from governance assets", async () => {
    const response = await invoke("governance.metrics.dashboard");
    expect(response.ok).toBe(true);
    const payload = response.payload as {
      summary: { totalAssets: number };
      metrics: { totalTasksToday: number };
    };
    expect(payload.summary.totalAssets).toBeGreaterThan(0);
    expect(payload.metrics.totalTasksToday).toBeGreaterThanOrEqual(0);
  });

  it("does not list another tenant's robots or fall back when tenant scope is missing", async () => {
    const scoped = await invoke("governance.assets.list", {
      filters: {},
      pagination: { page: 1, pageSize: 20 },
    });
    expect(scoped.ok).toBe(true);
    const scopedItems = (scoped.payload as { items: Array<{ id: string }> }).items;
    expect(scopedItems.some((item) => item.id === "sales-runtime")).toBe(true);
    expect(scopedItems.some((item) => item.id === "tenant-b-runtime")).toBe(false);

    const unresolved = await invoke(
      "governance.assets.list",
      { filters: {}, pagination: { page: 1, pageSize: 20 } },
      { omitTenant: true },
    );
    expect(unresolved.ok).toBe(true);
    expect((unresolved.payload as { items: unknown[] }).items).toEqual([]);
  });
});
