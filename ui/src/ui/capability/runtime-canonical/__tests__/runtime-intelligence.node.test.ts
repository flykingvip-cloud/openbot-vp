// @vitest-environment node
// Feature: platform-agent-runtime-center, Tasks 31-34: Runtime Intelligence stubs
import { describe, expect, it } from "vitest";
import {
  isRoutable,
  planCanaryRollout,
  planHotReload,
  selectBindingForRequest,
  selectMeshTarget,
} from "../runtime-intelligence.ts";
import type { RuntimeCapabilityBinding } from "../types.ts";

function makeBinding(overrides: Partial<RuntimeCapabilityBinding> = {}): RuntimeCapabilityBinding {
  return {
    bindingId: "b-1",
    runtimeAgentId: "agent-1",
    capabilityId: "cap-1",
    capabilityVersion: "1.0.0",
    bindingType: "tenant-installed",
    routingPriority: 50,
    loadStrategy: "lazy",
    bindingState: "active",
    healthStatus: "healthy",
    invocationMetrics: {
      calls7d: 100,
      successRate7d: 1,
      avgLatencyMs: 200,
      p95LatencyMs: 400,
      errorCount7d: 0,
      tokenConsumption7d: 0,
    },
    policy: { sandbox: "strict", resourceQuota: "small", hotReloadable: true },
    configurationState: "not-required",
    governanceState: "none",
    fallbackBindingId: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("Task 31: selectBindingForRequest", () => {
  it("returns the highest-priority active binding", () => {
    const bindings = [
      makeBinding({ bindingId: "b-1", routingPriority: 10 }),
      makeBinding({ bindingId: "b-2", routingPriority: 80 }),
      makeBinding({ bindingId: "b-3", routingPriority: 50 }),
    ];
    const got = selectBindingForRequest(
      {
        runtimeAgentId: "agent-1",
        capabilityId: "cap-1",
        requireHealthy: false,
        maxLatencyMs: null,
      },
      bindings,
    );
    expect(got?.bindingId).toBe("b-2");
  });

  it("requires healthy when requested", () => {
    const bindings = [
      makeBinding({ bindingId: "b-1", routingPriority: 80, healthStatus: "unhealthy" }),
      makeBinding({ bindingId: "b-2", routingPriority: 50, healthStatus: "healthy" }),
    ];
    const got = selectBindingForRequest(
      {
        runtimeAgentId: "agent-1",
        capabilityId: "cap-1",
        requireHealthy: true,
        maxLatencyMs: null,
      },
      bindings,
    );
    expect(got?.bindingId).toBe("b-2");
  });

  it("respects maxLatencyMs filter", () => {
    const bindings = [
      makeBinding({
        bindingId: "b-1",
        routingPriority: 80,
        invocationMetrics: { ...makeBinding().invocationMetrics, avgLatencyMs: 6_000 },
      }),
      makeBinding({
        bindingId: "b-2",
        routingPriority: 50,
        invocationMetrics: { ...makeBinding().invocationMetrics, avgLatencyMs: 200 },
      }),
    ];
    const got = selectBindingForRequest(
      {
        runtimeAgentId: "agent-1",
        capabilityId: "cap-1",
        requireHealthy: false,
        maxLatencyMs: 1_000,
      },
      bindings,
    );
    expect(got?.bindingId).toBe("b-2");
  });

  it("ignores disabled bindings", () => {
    const bindings = [
      makeBinding({ bindingId: "b-1", routingPriority: 99, bindingState: "disabled" }),
      makeBinding({ bindingId: "b-2", routingPriority: 10 }),
    ];
    const got = selectBindingForRequest(
      {
        runtimeAgentId: "agent-1",
        capabilityId: "cap-1",
        requireHealthy: false,
        maxLatencyMs: null,
      },
      bindings,
    );
    expect(got?.bindingId).toBe("b-2");
  });

  it("returns null when no candidate matches", () => {
    const bindings = [makeBinding({ bindingState: "disabled" })];
    const got = selectBindingForRequest(
      {
        runtimeAgentId: "agent-1",
        capabilityId: "cap-1",
        requireHealthy: false,
        maxLatencyMs: null,
      },
      bindings,
    );
    expect(got).toBeNull();
  });
});

describe("Task 32: planHotReload", () => {
  it("returns needs-restart for non-hot-reloadable bindings", () => {
    const b = makeBinding({ policy: { sandbox: "x", resourceQuota: "y", hotReloadable: false } });
    const plan = planHotReload(b);
    expect(plan.kind).toBe("needs-restart");
  });

  it("returns graceful for hot-reloadable bindings (Phase 3 NO-OP default)", () => {
    const b = makeBinding();
    const plan = planHotReload(b);
    expect(plan.kind).toBe("graceful");
    expect(plan.estimatedDrainMs).toBeGreaterThan(0);
  });
});

describe("Task 33: planCanaryRollout", () => {
  it("returns single-stage GA plan (Phase 3 NO-OP default)", () => {
    const plan = planCanaryRollout("cap-1", "1.0.0", "1.1.0");
    expect(plan.stages).toHaveLength(1);
    expect(plan.stages[0]?.stage).toBe("ga");
    expect(plan.stages[0]?.coverageRatio).toBe(1);
  });
});

describe("Task 34: selectMeshTarget", () => {
  it("returns null (Phase 3 NO-OP default)", () => {
    const got = selectMeshTarget(
      { runtimeAgentId: "a", capabilityId: "c", requireHealthy: false, maxLatencyMs: null },
      [],
    );
    expect(got).toBeNull();
  });
});

describe("isRoutable", () => {
  it("treats disabled as not routable, others as routable", () => {
    expect(isRoutable("active")).toBe(true);
    expect(isRoutable("warming")).toBe(true);
    expect(isRoutable("degraded")).toBe(true);
    expect(isRoutable("disabled")).toBe(false);
  });
});
