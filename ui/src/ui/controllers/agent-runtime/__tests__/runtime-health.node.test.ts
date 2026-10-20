// @vitest-environment node
// Feature: platform-agent-runtime-center, Task 19/20/21: Health controller
import { describe, expect, it, vi } from "vitest";
import type {
  AgentRuntimeGateway,
  GetHealthSummaryResponse,
  ListTelemetryResponse,
} from "../../../capability/agent-runtime/index.ts";
import type {
  RuntimeAgent,
  RuntimeCapabilityBinding,
} from "../../../capability/runtime-canonical/index.ts";
import {
  createInitialHealthState,
  diffAgentHealth,
  diffBindingHealth,
  loadSummary,
  loadTimeline,
  setHealthWindow,
  type HealthEvent,
} from "../runtime-health.ts";

function makeAgent(overrides: Partial<RuntimeAgent> = {}): RuntimeAgent {
  return {
    runtimeAgentId: "a-1",
    name: "A",
    runtimeVersion: "1.0",
    lifecycle: "deployed",
    health: "healthy",
    tenantCoverage: [],
    boundCapabilityCount: 0,
    activeSessionCount: 0,
    resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
    deployedAt: 0,
    lastActiveAt: 0,
    ...overrides,
  };
}

function makeBinding(overrides: Partial<RuntimeCapabilityBinding> = {}): RuntimeCapabilityBinding {
  return {
    bindingId: "b-1",
    runtimeAgentId: "a-1",
    capabilityId: "c-1",
    capabilityVersion: "1.0",
    bindingType: "tenant-installed",
    routingPriority: 0,
    loadStrategy: "lazy",
    bindingState: "active",
    healthStatus: "healthy",
    invocationMetrics: {
      calls7d: 0,
      successRate7d: 1,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      errorCount7d: 0,
      tokenConsumption7d: 0,
    },
    policy: { sandbox: "x", resourceQuota: "y", hotReloadable: true },
    fallbackBindingId: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("loadSummary", () => {
  it("populates summary from gateway", async () => {
    const summary: GetHealthSummaryResponse = {
      agentCountByHealth: { healthy: 1, degraded: 0, unhealthy: 0, unavailable: 0 },
      bindingCountByHealth: { healthy: 1, degraded: 0, unhealthy: 0, unavailable: 0 },
      unhealthyAgents: [],
      unhealthyBindings: [],
    };
    const gateway = {
      getHealthSummary: vi.fn(async () => summary),
    } as unknown as AgentRuntimeGateway;
    const s = createInitialHealthState();
    s.gateway = gateway;
    await loadSummary(s);
    expect(s.summary).toBe(summary);
  });
});

describe("loadTimeline", () => {
  it("sorts samples ascending by lastSampleAt", async () => {
    const resp: ListTelemetryResponse = {
      samples: [
        { ...makeBindingTel(), lastSampleAt: 300 },
        { ...makeBindingTel(), lastSampleAt: 100 },
        { ...makeBindingTel(), lastSampleAt: 200 },
      ],
    };
    const gateway = {
      listTelemetry: vi.fn(async () => resp),
    } as unknown as AgentRuntimeGateway;
    const s = createInitialHealthState();
    s.gateway = gateway;
    await loadTimeline(s);
    expect(s.telemetry.map((t) => t.lastSampleAt)).toEqual([100, 200, 300]);
  });

  function makeBindingTel() {
    return {
      runtimeAgentId: "a",
      capabilityId: null,
      calls7d: 0,
      successRate7d: 1,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      tokenConsumption7d: 0,
      errorCount7d: 0,
      queueDepth: 0,
      memoryPressure: 0,
      lastSampleAt: 0,
    };
  }
});

describe("setHealthWindow", () => {
  it("updates window for next loadTimeline call", () => {
    const s = createInitialHealthState();
    setHealthWindow(s, "7d");
    expect(s.window).toBe("7d");
  });
});

describe("diffAgentHealth", () => {
  it("emits HealthEvent on health change and invokes listener", () => {
    const s = createInitialHealthState();
    const events: HealthEvent[] = [];
    s.onHealthEventEmitted = (e) => events.push(e);
    const prev = [makeAgent({ health: "healthy" })];
    const next = [makeAgent({ health: "degraded" })];
    const diffs = diffAgentHealth(s, prev, next);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.fromHealth).toBe("healthy");
    expect(diffs[0]?.toHealth).toBe("degraded");
    expect(diffs[0]?.isDegradation).toBe(true);
    expect(events).toHaveLength(1);
  });

  it("skips unchanged agents", () => {
    const s = createInitialHealthState();
    const prev = [makeAgent({ health: "healthy" })];
    const next = [makeAgent({ health: "healthy" })];
    expect(diffAgentHealth(s, prev, next)).toEqual([]);
  });

  it("recovery (degraded → healthy) marks isDegradation=false", () => {
    const s = createInitialHealthState();
    const diffs = diffAgentHealth(
      s,
      [makeAgent({ health: "degraded" })],
      [makeAgent({ health: "healthy" })],
    );
    expect(diffs[0]?.isDegradation).toBe(false);
  });
});

describe("diffBindingHealth", () => {
  it("emits HealthEvent for binding-level changes", () => {
    const s = createInitialHealthState();
    const diffs = diffBindingHealth(
      s,
      [makeBinding({ healthStatus: "healthy" })],
      [makeBinding({ healthStatus: "unhealthy" })],
    );
    expect(diffs).toHaveLength(1);
    if (diffs[0]?.subject.kind === "binding") {
      expect(diffs[0].subject.bindingId).toBe("b-1");
    }
  });
});

describe("recentEvents cap", () => {
  it("caps recentEvents at 100", () => {
    const s = createInitialHealthState();
    for (let i = 0; i < 200; i += 1) {
      const before = makeAgent({ health: "healthy" });
      const after = makeAgent({ health: "degraded" });
      diffAgentHealth(s, [before], [after]);
      // Reset state so each iteration produces a "change"
      diffAgentHealth(s, [after], [before]);
    }
    expect(s.recentEvents.length).toBe(100);
  });
});
