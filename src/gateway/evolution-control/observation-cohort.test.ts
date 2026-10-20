import type { ObservationWindow } from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import {
  crossTenantFromIds,
  filterCohort,
  observationsFromCohort,
  percentileNearestRank,
  securityViolationFromFailureCategory,
  type CohortOutcome,
} from "./observation-cohort.js";

function event(over: Partial<CohortOutcome> = {}): CohortOutcome {
  return {
    occurredAt: Date.parse("2026-09-06T11:06:00.000Z"),
    succeeded: true,
    latencyMs: 20,
    securityViolation: false,
    crossTenantContamination: false,
    ...over,
  };
}

describe("observation-cohort", () => {
  it("uses nearest-rank P95 instead of the mean", () => {
    expect(percentileNearestRank([20, 40], 95)).toBe(40);
    expect(percentileNearestRank([10, 10, 10, 100], 95)).toBe(100);
    expect(percentileNearestRank([], 95)).toBeNull();
  });

  it("treats a present empty failureCategory as measured zero, not missing", () => {
    expect(securityViolationFromFailureCategory(undefined)).toBeUndefined();
    expect(securityViolationFromFailureCategory(null)).toBe(false);
    expect(securityViolationFromFailureCategory("security")).toBe(true);
    expect(securityViolationFromFailureCategory("timeout")).toBe(false);
  });

  it("requires both tenant ids before claiming cross-tenant observation", () => {
    expect(crossTenantFromIds(null, "tenant-a")).toBeUndefined();
    expect(crossTenantFromIds("tenant-b", "tenant-a")).toBe(true);
    expect(crossTenantFromIds("tenant-a", "tenant-a")).toBe(false);
  });

  it("omits criticals when any event lacks the sensor", () => {
    const observations = observationsFromCohort({
      events: [
        event(),
        event({ securityViolation: undefined, crossTenantContamination: undefined }),
      ],
      windowRef: "w",
      primary: {
        metricId: "task_success_rate",
        value: (rows) => rows.filter((row) => row.succeeded).length / rows.length,
      },
    });
    expect(observations.map((row) => row.metricId)).toEqual(["task_success_rate"]);
  });

  it("does not turn suspected bypass into confirmed security_violations", () => {
    const observations = observationsFromCohort({
      events: [
        event({
          securityViolation: undefined,
          suspectedAuthorizationBypass: true,
        }),
        event({
          securityViolation: false,
          suspectedAuthorizationBypass: true,
        }),
      ],
      windowRef: "w",
      primary: {
        metricId: "task_success_rate",
        value: (rows) => rows.filter((row) => row.succeeded).length / rows.length,
      },
    });
    expect(observations.find((row) => row.metricId === "security_violations")).toBeUndefined();
  });

  it("emits confirmed security_violations only from securityViolation", () => {
    const observations = observationsFromCohort({
      events: [
        event({ securityViolation: true, suspectedAuthorizationBypass: true }),
        event({ securityViolation: false, suspectedAuthorizationBypass: true }),
      ],
      windowRef: "w",
      primary: {
        metricId: "task_success_rate",
        value: (rows) => rows.filter((row) => row.succeeded).length / rows.length,
      },
    });
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricId: "security_violations", value: 0.5, sampleSize: 2 }),
      ]),
    );
  });

  it("emits measured-zero criticals when every event was inspected", () => {
    const observations = observationsFromCohort({
      events: [event({ succeeded: true }), event({ succeeded: false, latencyMs: 40 })],
      windowRef: "w",
      primary: {
        metricId: "task_success_rate",
        value: (rows) => rows.filter((row) => row.succeeded).length / rows.length,
      },
      includeLatencyP95: true,
    });
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricId: "task_success_rate", value: 0.5, sampleSize: 2 }),
        expect.objectContaining({ metricId: "security_violations", value: 0, sampleSize: 2 }),
        expect.objectContaining({
          metricId: "cross_tenant_contamination",
          value: 0,
          sampleSize: 2,
        }),
        expect.objectContaining({ metricId: "p95_latency", value: 40, sampleSize: 2 }),
      ]),
    );
  });
});

function windowFor(phase: ObservationWindow["phase"]): ObservationWindow {
  return {
    windowId: "w",
    experimentId: "exp-a",
    phase,
    startedAt: "2026-09-06T11:00:00.000Z",
    endedAt: "2026-09-06T12:00:00.000Z",
    tenantScope: "tenant-a",
    targetKey: "agent:bot",
    modelRevision: "m",
    configRevision: "c",
    cohortRef: "cohort-control",
  };
}

function boundEvent(over: Partial<CohortOutcome> = {}): CohortOutcome {
  return event({
    agentId: "bot",
    tenantId: "tenant-a",
    experimentId: "exp-a",
    applicationId: "app-a",
    cohortRef: "cohort-control",
    ...over,
  });
}

describe("observation-cohort binding", () => {
  it("treatment excludes missing IDs", () => {
    const rows = filterCohort(
      [
        boundEvent({ experimentId: undefined, applicationId: undefined }),
        boundEvent({ experimentId: undefined, applicationId: "app-a" }),
        boundEvent({ experimentId: "exp-a", applicationId: undefined }),
      ],
      windowFor("treatment"),
      { experimentId: "exp-a", applicationId: "app-a", agentId: "bot" },
    );
    expect(rows).toEqual([]);
  });

  it("treatment excludes wrong IDs", () => {
    const rows = filterCohort(
      [
        boundEvent({ experimentId: "exp-other" }),
        boundEvent({ applicationId: "app-other" }),
        boundEvent({ agentId: "other-bot" }),
        boundEvent({ tenantId: "tenant-b" }),
      ],
      windowFor("treatment"),
      { experimentId: "exp-a", applicationId: "app-a", agentId: "bot" },
    );
    expect(rows).toEqual([]);
  });

  it("treatment keeps only the correct IDs", () => {
    const keep = boundEvent();
    const rows = filterCohort(
      [keep, boundEvent({ experimentId: undefined }), boundEvent({ experimentId: "exp-other" })],
      windowFor("treatment"),
      { experimentId: "exp-a", applicationId: "app-a", agentId: "bot" },
    );
    expect(rows).toEqual([keep]);
  });

  it("baseline allows unlabeled control events bound by agent, tenant, window, and cohort", () => {
    const control = boundEvent({ experimentId: undefined, applicationId: undefined });
    const labeled = boundEvent();
    const rows = filterCohort(
      [
        control,
        labeled,
        boundEvent({ experimentId: "exp-other" }),
        boundEvent({ tenantId: undefined }),
        boundEvent({ agentId: undefined }),
        boundEvent({ cohortRef: "other-cohort" }),
      ],
      windowFor("baseline"),
      { experimentId: "exp-a", agentId: "bot" },
    );
    expect(rows).toEqual([control, labeled]);
  });

  it("treatment excludes events that have no runId", () => {
    const rows = filterCohort(
      [boundEvent({ runId: undefined }), boundEvent({ runId: "" })],
      windowFor("treatment"),
      {
        experimentId: "exp-a",
        applicationId: "app-a",
        agentId: "bot",
        requireRunId: true,
      },
    );
    expect(rows).toEqual([]);
  });

  it("treatment excludes missing, wrong, and matching-only-when runId is present", () => {
    const matching = boundEvent({ runId: "run-a" });
    const rows = filterCohort(
      [boundEvent({ runId: undefined }), boundEvent({ runId: "run-other" }), matching],
      windowFor("treatment"),
      {
        experimentId: "exp-a",
        applicationId: "app-a",
        agentId: "bot",
        runId: "run-a",
        requireRunId: true,
      },
    );
    expect(rows).toEqual([matching]);
  });

  it("baseline does not require runId but still requires agent, tenant, and cohort when asked", () => {
    const unlabeled = boundEvent({
      experimentId: undefined,
      applicationId: undefined,
      runId: undefined,
    });
    const rows = filterCohort(
      [unlabeled, boundEvent({ cohortRef: undefined }), boundEvent({ experimentId: "exp-other" })],
      windowFor("baseline"),
      { experimentId: "exp-a", agentId: "bot", requireCohort: true },
    );
    expect(rows).toEqual([unlabeled]);
  });

  it("baseline excludes orphan application stamps that are not on the current experiment", () => {
    const unlabeled = boundEvent({
      experimentId: undefined,
      applicationId: undefined,
    });
    const current = boundEvent();
    const orphan = boundEvent({
      experimentId: undefined,
      applicationId: "app-other",
    });
    const rows = filterCohort([unlabeled, current, orphan], windowFor("baseline"), {
      experimentId: "exp-a",
      agentId: "bot",
    });
    expect(rows).toEqual([unlabeled, current]);
  });
});
