import { describe, expect, it } from "vitest";
import type { ObservationRun } from "./model.ts";
import {
  censusTenantGrants,
  exactRunMatches,
  formatGrantCensus,
  formatHeartbeat,
  formatHeartbeatFreshness,
  formatUnmappedEvents,
  grantFraction,
  heartbeatActivityMarks,
  heartbeatFraction,
  visibleTenantCode,
  tenantDisplayName,
  formatLinkCoverage,
  formatQuota,
  formatConcurrency,
  linkCoverageFraction,
  formatTenantCoverage,
  formatTenantHeartbeat,
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

describe("linkCoverageFraction", () => {
  it("is null when coverage is unknown and does not invent a zero ratio", () => {
    expect(linkCoverageFraction(null)).toBeNull();
    expect(linkCoverageFraction({ fullyLinkedCount: 0, attemptedCount: 0 })).toBeNull();
  });

  it("returns the confirmed linked ratio", () => {
    expect(linkCoverageFraction({ fullyLinkedCount: 1, attemptedCount: 5 })).toBe(0.2);
  });
});

describe("formatHeartbeat", () => {
  it("stays unknown when expected or observed samples are not supplied", () => {
    expect(formatHeartbeat(null).value).toBe("未知");
    expect(formatHeartbeat({ expectedSamples: null, observedSamples: 1 }).value).toBe("未知");
    expect(formatHeartbeat({ expectedSamples: 0, observedSamples: 0 }).value).toBe("未知");
    expect(formatHeartbeat({ scheduledRobotCount: 0, onCadenceRobotCount: 0 }).value).toBe("未知");
    expect(formatHeartbeat({ scheduledRobotCount: 2, onCadenceRobotCount: null }).value).toBe("未知");
    expect(formatHeartbeat(null).note).toContain("source_unavailable");
    expect(formatHeartbeat({ scheduledRobotCount: 0, onCadenceRobotCount: 0 }).value).not.toContain("0%");
  });

  it("formats a confirmed expected and observed count", () => {
    expect(formatHeartbeat({ expectedSamples: 4, observedSamples: 3 }).value).toBe("3/4");
  });

  it("formats a confirmed scheduled-robot cadence cohort, including an honest 0%", () => {
    expect(
      formatHeartbeat({ scheduledRobotCount: 2, confirmedRobotCount: 2, onCadenceRobotCount: 1 }).value,
    ).toBe("1/2 · 50%");
    expect(
      formatHeartbeat({ scheduledRobotCount: 2, confirmedRobotCount: 2, onCadenceRobotCount: 0 }).value,
    ).toBe("0/2 · 0%");
    // Mixed-period payloads must use the cohort, never a mashed tick ratio.
    expect(
      formatHeartbeat({
        scheduledRobotCount: 2,
        confirmedRobotCount: 2,
        onCadenceRobotCount: 1,
        expectedSamples: null,
        observedSamples: null,
      }).value,
    ).toBe("1/2 · 50%");
  });

  it("does not expose raw field names in the formatted detail", () => {
    expect(formatHeartbeat(null).detail).not.toContain("expectedSamples");
    expect(formatHeartbeat({ expectedSamples: 4, observedSamples: 3 }).detail).not.toContain(
      "observedSamples",
    );
  });
});

describe("heartbeatFraction", () => {
  it("is null when heartbeat is unknown and returns the confirmed ratio", () => {
    expect(heartbeatFraction(null)).toBeNull();
    expect(heartbeatFraction({ expectedSamples: 4, observedSamples: 3 })).toBe(0.75);
    expect(
      heartbeatFraction({ scheduledRobotCount: 2, confirmedRobotCount: 2, onCadenceRobotCount: 1 }),
    ).toBe(0.5);
  });
});

describe("visibleTenantCode", () => {
  it("hides technical ids when a distinct human label exists, including numeric aliases", () => {
    expect(visibleTenantCode("upbeyond", "001")).toBeNull();
    expect(visibleTenantCode("001", "001")).toBeNull();
    expect(visibleTenantCode("Aegis", "aegis-99491824")).toBeNull();
    expect(visibleTenantCode("小飞鱼", "workspace-97096055")).toBeNull();
    expect(visibleTenantCode("", "aegis-99491824")).toBe("aegis-99491824");
    expect(tenantDisplayName("Aegis", "aegis-99491824")).toBe("Aegis");
    expect(tenantDisplayName("", "workspace-97096055")).toBe("workspace-97096055");
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
    expect(formatGrantCensus(census).value).toBe("1/4 · 25%");
    expect(grantFraction(census)).toBe(0.25);
  });

  it("stays unknown without a directory denominator and never paints 0% for an empty directory", () => {
    const empty = censusTenantGrants([], null);
    expect(empty.total).toBe(0);
    expect(formatGrantCensus(empty).value).toBe("未知");
    expect(formatGrantCensus(empty).value).not.toContain("0%");
    expect(grantFraction(empty)).toBeNull();
  });

  it("renders a granted ratio when the directory has a positive denominator", () => {
    const census = censusTenantGrants(
      [{ tenantId: "a" }, { tenantId: "b", tenantGrant: "unknown" }],
      null,
    );
    expect(census.hasConfirmed).toBe(false);
    expect(formatGrantCensus(census).value).toBe("0/2 · 0%");
    expect(grantFraction(census)).toBe(0);
    expect(formatGrantCensus(census).value).not.toContain("无授权");
  });
});

describe("tenant row projection", () => {
  it("does not invent coverage numbers and keeps unconfirmed distinct from none", () => {
    expect(formatTenantCoverage("granted")).toBe("未知");
    expect(formatTenantCoverage("none")).toBe("无授权");
    expect(formatTenantCoverage("unknown")).toBe("尚未确认");
    expect(formatTenantHeartbeat("granted")).toBe("未知");
    expect(formatTenantHeartbeat("none")).toBe("无授权");
    expect(formatTenantHeartbeat("unknown")).toBe("尚未确认");
    expect(
      formatTenantHeartbeat("granted", {
        scheduledRobotCount: 1,
        confirmedRobotCount: 1,
        onCadenceRobotCount: 1,
      }),
    ).toBe("1/1 · 100%");
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

describe("formatConcurrency and formatQuota", () => {
  it("stays unknown without a positive denominator and never prints 0%", () => {
    expect(formatConcurrency(null).value).toBe("未知");
    expect(formatConcurrency({ activeRuns: 0, limit: 0 }).value).toBe("未知");
    expect(formatQuota({ remaining: 0, allowance: 0 }).value).toBe("未知");
    expect(formatConcurrency({ activeRuns: 0, limit: 0 }).value).not.toContain("0%");
  });

  it("formats confirmed counts and hides raw field names", () => {
    expect(formatConcurrency({ activeRuns: 1, limit: 4 }).value).toBe("1/4");
    expect(formatQuota({ remaining: 2, allowance: 10 }).value).toBe("2/10");
    expect(formatConcurrency({ activeRuns: 1, limit: 4 }).detail).not.toContain("activeRuns");
    expect(formatQuota({ remaining: 2, allowance: 10 }).detail).not.toContain("allowance");
  });
});

describe("formatUnmappedEvents", () => {
  it("shows a real count and uses a short empty state only at zero", () => {
    expect(formatUnmappedEvents(null).value).toBe("未知");
    expect(formatUnmappedEvents({ count: 0 }).value).toBe("0");
    expect(formatUnmappedEvents({ count: 0 }).detail).toContain("没有未映射事件");
    expect(formatUnmappedEvents({ count: 3 }).value).toBe("3");
    expect(formatUnmappedEvents({ count: 3 }).value).not.toContain("不计入企业");
  });
});

describe("heartbeat activity presentation", () => {
  it("keeps the ratio unknown without a period and describes an activity series instead", () => {
    const activity = {
      expectedSamples: null,
      observedSamples: null,
      observedEventCount: 2,
      lastEventAt: 1_000,
      events: [{ ts: 500, status: "sent" }, { ts: 1_000, status: "ok-empty" }],
    };
    expect(formatHeartbeat(activity).value).toBe("未知");
    expect(heartbeatFraction(activity)).toBeNull();
    expect(heartbeatActivityMarks(activity)).toHaveLength(2);
    expect(formatHeartbeatFreshness(activity, 1_000)).toContain("刚刚");
    expect(formatHeartbeatFreshness({ observedEventCount: 0, events: [] })).toBe("暂无心跳记录");
    expect(formatHeartbeatFreshness(activity, 1_000)).not.toContain("expectedSamples");
    expect(formatHeartbeatFreshness(activity, 1_000)).not.toContain("observedSamples");
  });
});
