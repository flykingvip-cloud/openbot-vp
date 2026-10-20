import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-incubation-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const { incubationHandlers } = await import("./incubation.js");
const { registerCapability } = await import("../capability-governance-store.js");
const { __agentRuntimeStoreInternals } = await import("../agent-runtime-store.js");

type HandlerResponse = {
  ok: boolean;
  payload?: unknown;
  error?: unknown;
};

function cleanStore(): void {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  __agentRuntimeStoreInternals.reset();
}

function registerFixtureCapability(): void {
  registerCapability({
    id: "cap-incubate",
    kind: "skill",
    version: "1.0.0",
    skillKey: "sales-retro",
    name: "销售复盘助手",
    description: "帮助销售团队复盘客户进展和下一步动作",
    source: { kind: "personal", origin: "employee-capability:sales-retro", trustTier: "user" },
    risk: { level: "low", network: false, filesystem: false, subprocess: false, secrets: false },
  });
  __agentRuntimeStoreInternals.seed({
    agents: {
      "agent-sales": {
        runtimeAgentId: "agent-sales",
        name: "销售助手",
        runtimeVersion: "1.0.0",
        lifecycle: "deployed",
        health: "healthy",
        tenantCoverage: ["tenant-a"],
        boundCapabilityCount: 1,
        activeSessionCount: 2,
        resourceUsage: { cpuPercent: 12, memoryPercent: 22, tokenBudgetUsedPercent: 18 },
        deployedAt: Date.now(),
        lastActiveAt: Date.now(),
      },
    },
    bindings: {
      "binding-sales": {
        bindingId: "binding-sales",
        runtimeAgentId: "agent-sales",
        capabilityId: "cap-incubate",
        capabilityVersion: "1.0.0",
        bindingType: "tenant-installed",
        routingPriority: 50,
        loadStrategy: "eager",
        bindingState: "active",
        healthStatus: "healthy",
        invocationMetrics: {
          calls7d: 52,
          successRate7d: 0.93,
          avgLatencyMs: 320,
          p95LatencyMs: 780,
          errorCount7d: 1,
          tokenConsumption7d: 1800,
        },
        policy: { sandbox: "strict", resourceQuota: "small", hotReloadable: true },
        fallbackBindingId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
  });
}

async function invoke(
  method: string,
  params: Record<string, unknown> = {},
): Promise<HandlerResponse> {
  const handler = incubationHandlers[method];
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
      user: "admin@example.com",
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

describe("incubation handlers", () => {
  beforeEach(() => {
    cleanStore();
    registerFixtureCapability();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("computes an incubation score for a capability", async () => {
    const res = await invoke("incubation.score", { capabilityId: "cap-incubate" });
    expect(res.ok).toBe(true);
    const score = (res.payload as { score: { compositeScore: number } }).score;
    expect(score.compositeScore).toBeGreaterThan(0);
  });

  it("keeps the reuse gate: one robot never enters the candidate pool", async () => {
    const pool = await invoke("incubation.candidate-pool");
    expect(pool.ok).toBe(true);
    expect((pool.payload as { candidates: unknown[] }).candidates).toEqual([]);
    expect((pool.payload as { stats: { totalCandidates: number } }).stats.totalCandidates).toBe(0);
  });

  it("lists a capability only after reuse data crosses the incubation bar", async () => {
    const { __agentRuntimeStoreInternals } = await import("../agent-runtime-store.js");
    __agentRuntimeStoreInternals.seed({
      agents: {
        "agent-sales": {
          runtimeAgentId: "agent-sales",
          name: "销售助手",
          runtimeVersion: "1.0.0",
          lifecycle: "deployed",
          health: "healthy",
          tenantCoverage: ["tenant-a"],
          boundCapabilityCount: 1,
          activeSessionCount: 2,
          resourceUsage: { cpuPercent: 12, memoryPercent: 22, tokenBudgetUsedPercent: 18 },
          deployedAt: Date.now(),
          lastActiveAt: Date.now(),
        },
        "agent-sales-b": {
          runtimeAgentId: "agent-sales-b",
          name: "销售助手B",
          runtimeVersion: "1.0.0",
          lifecycle: "deployed",
          health: "healthy",
          tenantCoverage: ["tenant-a"],
          boundCapabilityCount: 1,
          activeSessionCount: 1,
          resourceUsage: { cpuPercent: 8, memoryPercent: 18, tokenBudgetUsedPercent: 10 },
          deployedAt: Date.now(),
          lastActiveAt: Date.now(),
        },
      },
      bindings: {
        "binding-sales": {
          bindingId: "binding-sales",
          runtimeAgentId: "agent-sales",
          capabilityId: "cap-incubate",
          capabilityVersion: "1.0.0",
          bindingType: "tenant-installed",
          routingPriority: 50,
          loadStrategy: "eager",
          bindingState: "active",
          healthStatus: "healthy",
          invocationMetrics: {
            calls7d: 52,
            successRate7d: 0.93,
            avgLatencyMs: 320,
            p95LatencyMs: 780,
            errorCount7d: 1,
            tokenConsumption7d: 1800,
          },
          policy: { sandbox: "strict", resourceQuota: "small", hotReloadable: true },
          fallbackBindingId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        "binding-sales-b": {
          bindingId: "binding-sales-b",
          runtimeAgentId: "agent-sales-b",
          capabilityId: "cap-incubate",
          capabilityVersion: "1.0.0",
          bindingType: "tenant-installed",
          routingPriority: 50,
          loadStrategy: "eager",
          bindingState: "active",
          healthStatus: "healthy",
          invocationMetrics: {
            calls7d: 40,
            successRate7d: 0.9,
            avgLatencyMs: 300,
            p95LatencyMs: 700,
            errorCount7d: 1,
            tokenConsumption7d: 900,
          },
          policy: { sandbox: "strict", resourceQuota: "small", hotReloadable: true },
          fallbackBindingId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    });
    const pool = await invoke("incubation.candidate-pool");
    expect(pool.ok).toBe(true);
    const items = (
      pool.payload as { candidates: Array<{ capabilityId: string; maturity: string }> }
    ).candidates;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ capabilityId: "cap-incubate", maturity: "企业认证" });
    expect((pool.payload as { stats: { newThisMonth: number } }).stats.newThisMonth).toBe(1);
  });

  it("records a promotion decision and rejects too-short reasons", async () => {
    const decided = await invoke("incubation.decide", {
      capabilityId: "cap-incubate",
      result: "recommend_upload",
      reason: "跨部门稳定复用，建议上报平台标准化推广。",
      decidedBy: "admin@example.com",
    });
    expect(decided.ok).toBe(true);
    expect((decided.payload as { succeeded: boolean }).succeeded).toBe(true);

    const tooShort = await invoke("incubation.decide", {
      capabilityId: "cap-incubate",
      result: "recommend_upload",
      reason: "太短",
    });
    expect(tooShort.ok).toBe(false);
  });
});
