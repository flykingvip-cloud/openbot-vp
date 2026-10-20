import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { createProbeInvalidReport, createScopeDeniedReport } from "./health-report.js";
import {
  assertHealthReportHasNoPathLeak,
  HealthReportProbeInvalidSchema,
  HealthReportScopeDeniedSchema,
  isValidHealthReport,
} from "./health-report.schema.js";

describe("HealthReport union schema (AC-O0-1)", () => {
  it("accepts the minimal scope.denied envelope", () => {
    const report = createScopeDeniedReport("forbidden", "2026-08-18T00:00:00.000Z");
    expect(Value.Check(HealthReportScopeDeniedSchema, report)).toBe(true);
    expect(isValidHealthReport(report)).toBe(true);
    expect(assertHealthReportHasNoPathLeak(report)).toBeUndefined();
  });

  it("rejects scope.denied payloads that leak agents or runtime", () => {
    expect(
      Value.Check(HealthReportScopeDeniedSchema, {
        schema: "memory-health-report/v2",
        status: "denied",
        reasonCode: "scope.denied",
        reason: "forbidden",
        probeUtc: "2026-08-18T00:00:00.000Z",
        agents: [],
      }),
    ).toBe(false);
  });

  it("accepts probe.invalid without agents/runtime", () => {
    const report = createProbeInvalidReport({
      meta: {
        schema: "memory-health-report/v2",
        instanceSha: "a",
        probeModuleSha: "b",
        probeModuleVersion: "0.0.0-test",
        probeUtc: "2026-08-18T00:00:00.000Z",
      },
      callerScope: "platform",
      reason: "mutated",
      probeIntegrity: {
        preSnapshotHash: "1",
        postSnapshotHash: "2",
        mutationsDetected: true,
      },
    });
    expect(Value.Check(HealthReportProbeInvalidSchema, report)).toBe(true);
    expect(isValidHealthReport(report)).toBe(true);
  });

  it("rejects probe.invalid that includes agents", () => {
    expect(
      Value.Check(HealthReportProbeInvalidSchema, {
        schema: "memory-health-report/v2",
        instanceSha: "a",
        probeModuleSha: "b",
        probeModuleVersion: "0.0.0-test",
        probeUtc: "2026-08-18T00:00:00.000Z",
        reportKind: "ops",
        status: "invalid",
        reasonCode: "probe.invalid",
        reason: "mutated",
        callerScope: "platform",
        agents: [{ agentId: "x" }],
      }),
    ).toBe(false);
  });
});
