import { describe, expect, it } from "vitest";
import type { ObservationRun } from "./model.ts";
import {
  censusTenantGrants,
  exactRunMatches,
  formatGrantCensus,
  formatHeartbeat,
  formatLinkCoverage,
  formatTenantCoverage,
  tenantGrantNote,
} from "./platform-overview.ts";

const run = (overrides: Partial<ObservationRun> & Pick<ObservationRun, "id">): ObservationRun => ({
  label: "example",
  scope: "personal",
  tenantId: "tenant-a",
  tenantLabel: "A",
  clientRunId: null,
  sourceRunId: null,
  admittedWorkId: null,
  scenarioTaskRef: null,
  outcomeRevision: null,
  toolState: "completed",
  outcomeState: "unavailable",
  latencyMs: null,
  attributedCost: null,
  stages: [],
  reasons: [],
  eventCount: 0,
  sample: false,
  ...overrides,
});

describe("formatLinkCoverage", () => {
  it("stays unknown when the denominator is missing or zero, and never prints 0%", () => {
    expect(formatLinkCoverage(null).value).toBe("未知");
    expect(formatLinkCoverage({ fullyLinkedCount: 0, attemptedCount: 0 }).value).toBe("未知");
    expect(formatLinkCoverage({ fullyLinkedCount: 1, attemptedCount: 0 }).value).toBe("未知");
    expect(formatLinkCoverage({ fullyLinkedCount: 0 }).value).toBe("未知");
    expect(formatLinkCoverage({ fullyLinkedCount: 0, attemptedCount: 0 }).value).not.toContain("0%");
  });

  it("formats a confirmed numerator and positive denominator", () => {
    expect(formatLinkCoverage({ fullyLinkedCount: 1, attemptedCount: 5 }).value).toBe("1/5 · 20%");
  });
});

describe("formatHeartbeat", () => {
  it("stays unknown when expected or observed samples are not supplied", () => {
    expect(formatHeartbeat(null).value).toBe("未知");
    expect(formatHeartbeat({ expectedSamples: null, observedSamples: 1 }).value).toBe("未知");
    expect(formatHeartbeat({ expectedSamples: 0, observedSamples: 0 }).value).toBe("未知");
    expect(formatHeartbeat(null).note).toContain("source_unavailable");
  });

  it("formats a confirmed expected and observed count", () => {
    expect(formatHeartbeat({ expectedSamples: 4, observedSamples: 3 }).value).toBe("3/4");
  });
});

describe("censusTenantGrants", () => {
  it("counts only server-confirmed grants and does not invent none", () => {
    const census = censusTenantGrants(
      [
        { tenantId: "a", tenantGrant: "granted" },
        { tenantId: "b", tenantGrant: "none" },
        { tenantId: "c", tenantGrant: "unknown" },
        { tenantId: "d" },
      ],
      { a: "granted", b: "none", c: "unknown" },
    );
    expect(census).toEqual({
      granted: 1,
      none: 1,
      unconfirmed: 2,
      total: 4,
      hasConfirmed: true,
    });
    expect(formatGrantCensus(census).value).toBe("1 已授权 / 1 无授权 / 2 尚未确认");
  });

  it("renders 尚未确认 when no grant has been confirmed", () => {
    const census = censusTenantGrants(
      [{ tenantId: "a" }, { tenantId: "b", tenantGrant: "unknown" }],
      null,
    );
    expect(census.hasConfirmed).toBe(false);
    expect(formatGrantCensus(census).value).toBe("尚未确认");
    expect(formatGrantCensus(census).value).not.toContain("无授权");
  });
});

describe("tenant row projection", () => {
  it("does not invent coverage numbers and keeps unconfirmed distinct from none", () => {
    expect(formatTenantCoverage("granted")).toBe("未知");
    expect(formatTenantCoverage("none")).toBe("无授权");
    expect(formatTenantCoverage("unknown")).toBe("尚未确认");
    expect(tenantGrantNote("none", false)).toContain("不返回该租户运行");
    expect(tenantGrantNote("unknown", false)).toContain("尚未确认");
  });
});

describe("exactRunMatches", () => {
  const runs = [
    run({ id: "sample-personal", clientRunId: "client_01", sourceRunId: "engine_A" }),
    run({
      id: "sample-partial",
      clientRunId: "client_02",
      sourceRunId: "engine_C",
      scenarioTaskRef: "task_review",
      outcomeRevision: "2",
    }),
    run({ id: "sample-collaboration", clientRunId: "client_02", sourceRunId: "engine_B" }),
  ];

  it("matches only exact identifiers and does not fold case or take prefixes", () => {
    expect(exactRunMatches(runs, "sample-personal").map((row) => row.id)).toEqual(["sample-personal"]);
    expect(exactRunMatches(runs, "client_01").map((row) => row.id)).toEqual(["sample-personal"]);
    expect(exactRunMatches(runs, "task_review@2").map((row) => row.id)).toEqual(["sample-partial"]);
    expect(exactRunMatches(runs, "SAMPLE-PERSONAL")).toEqual([]);
    expect(exactRunMatches(runs, "sample-pers")).toEqual([]);
    expect(exactRunMatches(runs, " client_01 ")).toHaveLength(1);
  });

  it("does not pick an arbitrary row when one identifier is shared", () => {
    expect(exactRunMatches(runs, "client_02")).toHaveLength(2);
  });
});
