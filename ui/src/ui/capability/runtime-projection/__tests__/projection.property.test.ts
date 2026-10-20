// @vitest-environment node
// Feature: enterprise-capability-usage-management
// Property 2: Runtime_Projection_Layer 健康状态映射完备性
// Property 3: Runtime_Projection_Layer 字段纯净性
// Property 8: 成功率与调用量格式化

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { RuntimeAgent, RuntimeHealth } from "../../runtime-canonical/types.ts";
import { formatExecutions, formatSuccessRate } from "../format.ts";
import {
  buildRobotCapabilityUsageView,
  projectRuntimeAgentToRobot,
  projectRuntimeHealthToEnterprise,
  projectTelemetryToBusinessMetrics,
} from "../projection.ts";
import { HEALTH_STATUSES, HEALTH_STATUS_NO_DATA } from "../types.ts";

// ─────────────────────────────────────────────────────────────────────────
// Property 2: 健康状态映射完备性
// ─────────────────────────────────────────────────────────────────────────

describe("Property 2: projectRuntimeHealthToEnterprise mapping completeness", () => {
  it("maps all 4 known RuntimeHealth values to exactly one of the 4 business texts", () => {
    const knownValues: RuntimeHealth[] = ["healthy", "degraded", "unhealthy", "unavailable"];
    for (const v of knownValues) {
      const result = projectRuntimeHealthToEnterprise(v);
      expect(HEALTH_STATUSES).toContain(result);
    }
  });

  it("returns 暂无数据 for any unknown / null / undefined input", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(null, undefined),
          fc
            .string()
            .filter((s) => !["healthy", "degraded", "unhealthy", "unavailable"].includes(s)),
        ),
        (input) => {
          expect(projectRuntimeHealthToEnterprise(input)).toBe(HEALTH_STATUS_NO_DATA);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Property 3: 字段纯净性
// ─────────────────────────────────────────────────────────────────────────

const RUNTIME_BLACKLIST_FIELDS = [
  "runtimeAgentId",
  "runtimeVersion",
  "bindingId",
  "bindingType",
  "bindingState",
  "loadStrategy",
  "routingPriority",
  "fallbackBindingId",
  "policy",
  "hotReloadable",
  "cpu",
  "memory",
  "nodeId",
  "presence",
  "templateId",
  "provider",
  "modelRouting",
  "workflowJson",
  "toolchain",
  "qps",
  "tps",
  "latency",
  "p95",
  "p99",
  "resourceUsage",
] as const;

function assertNoRuntimeFields(obj: unknown, path = "root"): void {
  if (obj === null || obj === undefined) {
    return;
  }
  if (typeof obj !== "object") {
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => assertNoRuntimeFields(item, `${path}[${i}]`));
    return;
  }
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    expect(RUNTIME_BLACKLIST_FIELDS).not.toContain(key);
    assertNoRuntimeFields((obj as Record<string, unknown>)[key], `${path}.${key}`);
  }
}

const runtimeAgentArb: fc.Arbitrary<RuntimeAgent> = fc.record({
  runtimeAgentId: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !/[<>'"]/.test(s)),
  name: fc
    .string({ minLength: 1, maxLength: 30 })
    .filter(
      (s) =>
        !/(runtime|agent|template|cpu|memory|node|presence|qps|tps|latency|p95|p99|provider|model routing|workflow json|toolchain)/i.test(
          s,
        ),
    ),
  runtimeVersion: fc.string(),
  lifecycle: fc.constantFrom("provisioning", "active", "draining", "retired") as fc.Arbitrary<
    RuntimeAgent["lifecycle"]
  >,
  health: fc.constantFrom(
    "healthy",
    "degraded",
    "unhealthy",
    "unavailable",
  ) as fc.Arbitrary<RuntimeHealth>,
  tenantCoverage: fc.array(fc.string()),
  boundCapabilityCount: fc.nat(),
  activeSessionCount: fc.nat(),
  resourceUsage: fc.record({
    cpuPercent: fc.double({ min: 0, max: 100, noNaN: true }),
    memoryPercent: fc.double({ min: 0, max: 100, noNaN: true }),
    tokenBudgetUsedPercent: fc.double({ min: 0, max: 100, noNaN: true }),
  }),
  deployedAt: fc.integer({ min: 0, max: 2_000_000_000_000 }),
  lastActiveAt: fc.integer({ min: 0, max: 2_000_000_000_000 }),
});

describe("Property 3: projection output field purity", () => {
  it("projectRuntimeAgentToRobot output contains no runtime fields", () => {
    fc.assert(
      fc.property(runtimeAgentArb, (agent) => {
        const robot = projectRuntimeAgentToRobot(agent);
        assertNoRuntimeFields(robot);
        // Allow-list check: Robot should have exactly these fields
        expect(Object.keys(robot).toSorted()).toEqual([
          "healthStatus",
          "lastActiveAt",
          "robotId",
          "robotName",
        ]);
      }),
      { numRuns: 100 },
    );
  });

  it("buildRobotCapabilityUsageView output contains no runtime fields", () => {
    fc.assert(
      fc.property(runtimeAgentArb, (agent) => {
        const view = buildRobotCapabilityUsageView({
          agent,
          bindings: [],
          telemetry: [],
          capabilityNames: new Map(),
          monthlyEmployeeCoverage: new Map(),
        });
        assertNoRuntimeFields(view);
      }),
      { numRuns: 50 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Property 8: Format invariants
// ─────────────────────────────────────────────────────────────────────────

describe("Property 8: format invariants", () => {
  it("formatSuccessRate produces ^\\d{1,3}\\.\\d%$ for valid [0,1] inputs", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (rate) => {
        const result = formatSuccessRate(rate);
        expect(result).toMatch(/^\d{1,3}\.\d%$/);
      }),
      { numRuns: 100 },
    );
  });

  it("formatSuccessRate returns 暂无数据 for invalid inputs", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(NaN),
          fc.constant(Number.POSITIVE_INFINITY),
          fc.constant(Number.NEGATIVE_INFINITY),
          fc.double({ min: -10, max: -0.001, noNaN: true }),
          fc.double({ min: 1.001, max: 10, noNaN: true }),
        ),
        (input) => {
          expect(formatSuccessRate(input)).toBe("暂无数据");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("formatExecutions produces ^[\\d,]+$ for valid non-negative integers", () => {
    fc.assert(
      fc.property(fc.nat({ max: 1_000_000_000 }), (n) => {
        const result = formatExecutions(n);
        expect(result).toMatch(/^[\d,]+$/);
      }),
      { numRuns: 100 },
    );
  });

  it("formatExecutions returns 暂无数据 for non-integer / negative / NaN", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(NaN),
          fc.constant(Number.POSITIVE_INFINITY),
          fc.double({ min: -1000, max: -1, noNaN: true }),
          fc.double({ min: 0.1, max: 0.9, noNaN: true }),
        ),
        (input) => {
          expect(formatExecutions(input)).toBe("暂无数据");
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Telemetry aggregation correctness
// ─────────────────────────────────────────────────────────────────────────

describe("projectTelemetryToBusinessMetrics aggregation", () => {
  it("returns {0, 0} for empty telemetry array", () => {
    const result = projectTelemetryToBusinessMetrics([]);
    expect(result.monthlyExecutions).toBe(0);
    expect(result.successRate).toBe(0);
  });

  it("computes weighted success rate correctly", () => {
    const result = projectTelemetryToBusinessMetrics([
      {
        runtimeAgentId: "a",
        capabilityId: null,
        calls7d: 100,
        successRate7d: 0.9,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        tokenConsumption7d: 0,
        errorCount7d: 10,
        queueDepth: 0,
        memoryPressure: 0,
        lastSampleAt: 0,
      },
      {
        runtimeAgentId: "a",
        capabilityId: null,
        calls7d: 100,
        successRate7d: 0.5,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        tokenConsumption7d: 0,
        errorCount7d: 50,
        queueDepth: 0,
        memoryPressure: 0,
        lastSampleAt: 0,
      },
    ]);
    expect(result.monthlyExecutions).toBe(200);
    expect(result.successRate).toBeCloseTo(0.7, 5);
  });
});
