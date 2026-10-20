// @vitest-environment node
/**
 * Property-based tests for health status mapping.
 *
 * Covers:
 * - Property 15: manual lock override
 * - Property 16: health telemetry → business status mapping
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { EnterpriseHealthStatus } from "../../../capability/enterprise-capability/types.ts";
import {
  applyManualLockOverride,
  defaultStatusWhenNoTelemetry,
  mapTelemetryToHealthStatus,
  type HealthTelemetry,
} from "../health-mapping.ts";

const telemetryArb: fc.Arbitrary<HealthTelemetry> = fc.record({
  successRate24h: fc.integer({ min: 0, max: 100 }),
  consecutiveFailures: fc.integer({ min: 0, max: 10 }),
  hasCriticalDependencyIssue: fc.boolean(),
  hasKnownImprovablePattern: fc.boolean(),
});

const healthStatusArb: fc.Arbitrary<EnterpriseHealthStatus> = fc.constantFrom(
  "效果稳定",
  "偶尔结果不理想",
  "建议重新整理",
  "已不适合继续推广",
);

function expectedHealthStatus(telemetry: HealthTelemetry): EnterpriseHealthStatus {
  if (telemetry.hasCriticalDependencyIssue) {
    return "已不适合继续推广";
  }
  if (telemetry.successRate24h < 50) {
    return "已不适合继续推广";
  }
  if (telemetry.hasKnownImprovablePattern) {
    return "建议重新整理";
  }
  if (telemetry.successRate24h < 70) {
    return "建议重新整理";
  }
  if (telemetry.successRate24h < 95) {
    return telemetry.consecutiveFailures < 3 ? "偶尔结果不理想" : "建议重新整理";
  }
  return telemetry.consecutiveFailures === 0 ? "效果稳定" : "偶尔结果不理想";
}

describe("Property 15/16: health status mapping", () => {
  it("maps telemetry to the expected business-language status", () => {
    fc.assert(
      fc.property(telemetryArb, (telemetry) => {
        expect(mapTelemetryToHealthStatus(telemetry)).toBe(expectedHealthStatus(telemetry));
      }),
      { numRuns: 200 },
    );
  });

  it("manual lock keeps the manual status", () => {
    fc.assert(
      fc.property(
        healthStatusArb,
        healthStatusArb,
        fc.boolean(),
        (autoMapped, manualStatus, lock) => {
          const result = applyManualLockOverride(autoMapped, manualStatus, lock);
          expect(result).toBe(lock ? manualStatus : autoMapped);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("returns a stable default when there is no telemetry", () => {
    expect(defaultStatusWhenNoTelemetry()).toBe("效果稳定");
  });
});
