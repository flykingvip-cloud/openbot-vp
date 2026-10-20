// @vitest-environment node
// Feature: platform-agent-runtime-center, Property 4: Health Calculator monotonicity
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  calculateRuntimeHealth,
  DEFAULT_HEALTH_THRESHOLDS,
  isAtLeastAsHealthy,
  RUNTIME_HEALTH_RANK,
} from "../health-calculator.ts";
import type { RuntimeTelemetry } from "../types.ts";

/**
 * Build a non-error telemetry sample with all secondary signals nominal,
 * so the calculator's response is dominated by `successRate7d`. Used to
 * isolate the monotonicity property below from interactions with other
 * thresholds (queueDepth, memoryPressure, avgLatencyMs).
 */
function nominalTelemetry(successRate: number): RuntimeTelemetry {
  return {
    runtimeAgentId: "agent-1",
    capabilityId: null,
    calls7d: 1_000,
    successRate7d: successRate,
    avgLatencyMs: 100,
    p95LatencyMs: 300,
    tokenConsumption7d: 0,
    errorCount7d: Math.round((1 - successRate) * 1_000),
    queueDepth: 0,
    memoryPressure: 0,
    lastSampleAt: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Property 4: 单调性 — successRate 上升时健康状态不会变差
// Validates: Requirements 4.3
// ─────────────────────────────────────────────────────────────────────────

describe("Property 4: calculateRuntimeHealth monotonic in successRate7d", () => {
  it("non-decreasing health rank as successRate7d rises (with all other signals nominal)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const lower = Math.min(a, b);
          const higher = Math.max(a, b);
          const lowerHealth = calculateRuntimeHealth(nominalTelemetry(lower));
          const higherHealth = calculateRuntimeHealth(nominalTelemetry(higher));
          // Higher success rate must yield a >= healthier rank than lower.
          expect(RUNTIME_HEALTH_RANK[higherHealth]).toBeGreaterThanOrEqual(
            RUNTIME_HEALTH_RANK[lowerHealth],
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("isAtLeastAsHealthy is reflexive and consistent with the rank", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (rate) => {
        const h = calculateRuntimeHealth(nominalTelemetry(rate));
        expect(isAtLeastAsHealthy(h, h)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 阈值边界测试（与属性测试互补，锁定边界点的具体行为）
// ─────────────────────────────────────────────────────────────────────────

describe("Threshold boundary cases", () => {
  it("successRate >= healthySuccessRate with no other issues → healthy", () => {
    expect(calculateRuntimeHealth(nominalTelemetry(0.95))).toBe("healthy");
    expect(calculateRuntimeHealth(nominalTelemetry(1.0))).toBe("healthy");
  });

  it("successRate in [degradedSuccessRate, healthySuccessRate) → degraded", () => {
    expect(calculateRuntimeHealth(nominalTelemetry(0.7))).toBe("degraded");
    expect(calculateRuntimeHealth(nominalTelemetry(0.9499))).toBe("degraded");
  });

  it("successRate in [unhealthySuccessRate, degradedSuccessRate) → unhealthy", () => {
    expect(calculateRuntimeHealth(nominalTelemetry(0.5))).toBe("unhealthy");
    expect(calculateRuntimeHealth(nominalTelemetry(0.6999))).toBe("unhealthy");
  });

  it("successRate < unhealthySuccessRate → unavailable", () => {
    expect(calculateRuntimeHealth(nominalTelemetry(0.0))).toBe("unavailable");
    expect(calculateRuntimeHealth(nominalTelemetry(0.4999))).toBe("unavailable");
  });

  it("queueDepth > unavailableQueueDepth → unavailable, regardless of successRate", () => {
    const t: RuntimeTelemetry = {
      ...nominalTelemetry(1.0),
      queueDepth: DEFAULT_HEALTH_THRESHOLDS.unavailableQueueDepth + 1,
    };
    expect(calculateRuntimeHealth(t)).toBe("unavailable");
  });

  it("memoryPressure > threshold (and successRate ok) → unhealthy", () => {
    const t: RuntimeTelemetry = {
      ...nominalTelemetry(1.0),
      memoryPressure: DEFAULT_HEALTH_THRESHOLDS.unhealthyMemoryPressure + 0.05,
    };
    expect(calculateRuntimeHealth(t)).toBe("unhealthy");
  });

  it("avgLatencyMs > latencyThresholdMs (with healthy success rate) → degraded", () => {
    const t: RuntimeTelemetry = {
      ...nominalTelemetry(1.0),
      avgLatencyMs: DEFAULT_HEALTH_THRESHOLDS.latencyThresholdMs + 1,
    };
    expect(calculateRuntimeHealth(t)).toBe("degraded");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 阈值覆盖（overrides）行为
// ─────────────────────────────────────────────────────────────────────────

describe("Threshold overrides", () => {
  it("partial overrides merge with defaults", () => {
    // Tighten healthy bar to 0.99 — 0.95 should now be considered degraded.
    expect(calculateRuntimeHealth(nominalTelemetry(0.95), { healthySuccessRate: 0.99 })).toBe(
      "degraded",
    );
    // Default thresholds unchanged for the same input → still healthy.
    expect(calculateRuntimeHealth(nominalTelemetry(0.95))).toBe("healthy");
  });
});
