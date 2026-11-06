import { describe, expect, it } from "vitest";
import {
  clearRuntimeObservations,
  recordRuntimeObservation,
  readRuntimeObservations,
  type RuntimeObservation,
  type RuntimeObservationSnapshot,
} from "../runtime-observation.ts";
import {
  OBSERVATION_STREAM_SCOPE_FROM_CONNECTION,
  buildObservationStream,
  drillObservationStreamMetric,
  type ObservationStreamMetricKey,
} from "./stream.ts";

function event(
  partial: Partial<RuntimeObservation> &
    Pick<
      RuntimeObservation,
      "eventId" | "runId" | "sequence" | "occurredAt" | "receivedAt" | "stream"
    >,
): RuntimeObservation {
  return {
    sourceRunId: "engine",
    phase: null,
    capabilityCallId: null,
    coverage: "execution_only",
    missing: ["scenario_task_ref", "admitted_work_id", "outcome_revision", "source_provenance"],
    ...partial,
  };
}

function snapshot(
  events: RuntimeObservation[],
  reasons: string[] = [],
): RuntimeObservationSnapshot {
  return { events, partial: true, reasons };
}

function metric(view: ReturnType<typeof buildObservationStream>, key: ObservationStreamMetricKey) {
  const row = view.metrics.find((item) => item.key === key);
  expect(row).toBeTruthy();
  return row!;
}

describe("observation stream window", () => {
  it("keeps empty live windows scoped to this connection without fabricating zeros", () => {
    const view = buildObservationStream({ connected: true, snapshot: null, sessionKey: "s1" });
    expect(view.scope).toBe(OBSERVATION_STREAM_SCOPE_FROM_CONNECTION);
    expect(view.windowStartAt).toBeNull();
    expect(view.windowEndAt).toBeNull();
    expect(view.metrics.length).toBeGreaterThan(0);
    for (const row of view.metrics) {
      expect(row.source).toContain("RuntimeObservationSnapshot");
      expect(row.scope).toBe(OBSERVATION_STREAM_SCOPE_FROM_CONNECTION);
      expect(row.updatedAt).toBeNull();
      expect(row.value).toBeNull();
      expect(row.display).not.toBe("0");
      expect(row.display).not.toBe("0%");
      expect(row.series).toEqual([]);
      expect(row.drilldown.metricKey).toBe(row.key);
    }
    expect(metric(view, "business_acceptance").display).toBe("未知");
    expect(metric(view, "attributed_cost").display).toBe("未知");
    expect(metric(view, "attributed_cost").drilldown.gaps).toContain("attributed_cost_missing");
  });

  it("is pure: rebuilding the same snapshot never accumulates sample points", () => {
    const events = [
      event({
        eventId: "a",
        runId: "r1",
        sequence: 1,
        occurredAt: 100,
        receivedAt: 1000,
        stream: "lifecycle",
        phase: "start",
      }),
      event({
        eventId: "b",
        runId: "r1",
        sequence: 2,
        occurredAt: 140,
        receivedAt: 1400,
        stream: "lifecycle",
        phase: "end",
      }),
    ];
    const input = { connected: true, snapshot: snapshot(events), sessionKey: "s1" };
    const first = buildObservationStream(input);
    const second = buildObservationStream(input);
    expect(second).toEqual(first);
    expect(metric(first, "latency_p50").series).toHaveLength(1);
    expect(metric(second, "latency_p50").series).toHaveLength(1);
  });

  it("builds short trends only at real receivedAt arrivals and ignores timer-only now", () => {
    const events = [
      event({
        eventId: "1",
        runId: "r1",
        sequence: 1,
        occurredAt: 10,
        receivedAt: 100,
        stream: "lifecycle",
        phase: "start",
      }),
      event({
        eventId: "2",
        runId: "r1",
        sequence: 2,
        occurredAt: 40,
        receivedAt: 400,
        stream: "tool",
        phase: "end",
        capabilityCallId: "tool_01",
      }),
      event({
        eventId: "3",
        runId: "r1",
        sequence: 3,
        occurredAt: 50,
        receivedAt: 700,
        stream: "lifecycle",
        phase: "end",
      }),
    ];
    const view = buildObservationStream({
      connected: true,
      snapshot: snapshot(events),
      sessionKey: "s1",
      now: 70_000,
    });
    expect(view.scope).toBe(OBSERVATION_STREAM_SCOPE_FROM_CONNECTION);
    expect(view.windowStartAt).toBe(100);
    expect(view.windowEndAt).toBe(700);
    const rate = metric(view, "event_receive_rate");
    expect(rate.value).not.toBeNull();
    expect(rate.series.every((point) => [400, 700].includes(point.at))).toBe(true);
    expect(rate.series.some((point) => point.at === 70_000)).toBe(false);
    expect(
      rate.series.every((point) => point.scope === OBSERVATION_STREAM_SCOPE_FROM_CONNECTION),
    ).toBe(true);
    expect(metric(view, "active_runs").value).toBe(0);
    expect(metric(view, "active_runs").display).toBe("0");
    expect(metric(view, "run_completion_rate").note).toContain("不是业务验收");
    expect(metric(view, "latency_p50").value).toBe(40);
    expect(metric(view, "latency_p95").value).toBe(40);
    expect(metric(view, "tool_calls").value).toBe(1);
  });

  it("does not infer latency or completion rate without a valid lifecycle pair", () => {
    for (const phases of [
      ["start", "start"],
      ["end", "end"],
      ["end", "start"],
      ["start"],
    ] as const) {
      const events = phases.map((phase, index) =>
        event({
          eventId: `${phase}-${index}`,
          runId: "r",
          sequence: index + 1,
          occurredAt: index * 10,
          receivedAt: index * 10,
          stream: "lifecycle",
          phase,
        }),
      );
      const view = buildObservationStream({
        connected: true,
        snapshot: snapshot(events),
        sessionKey: "s",
      });
      expect(metric(view, "latency_p50").value).toBeNull();
      expect(metric(view, "latency_p95").value).toBeNull();
      expect(metric(view, "latency_p50").display).not.toBe("0");
      expect(metric(view, "run_completion_rate").value).toBeNull();
      expect(metric(view, "run_completion_rate").display).not.toBe("0%");
      expect(metric(view, "active_runs").value).toBe(1);
    }
  });

  it("exposes drilldown runIds and gap codes for each metric key", () => {
    const host = {};
    recordRuntimeObservation(
      host,
      "agent:main",
      {
        runId: "client_01",
        sourceRunId: "engine_A",
        sessionKey: "agent:main",
        seq: 3,
        ts: 30,
        stream: "tool",
        data: { phase: "end", toolCallId: "tool_01" },
      },
      300,
    );
    const snap = readRuntimeObservations(host, "agent:main");
    expect(snap.reasons).toEqual(
      expect.arrayContaining([
        "no_durable_replay",
        "identity_links_missing",
        "incomplete_run_prefix",
      ]),
    );
    const view = buildObservationStream({
      connected: true,
      snapshot: snap,
      sessionKey: "agent:main",
    });
    const gaps = metric(view, "sequence_or_link_gaps");
    expect(gaps.drilldown.metricKey).toBe("sequence_or_link_gaps");
    expect(gaps.drilldown.runIds.length).toBeGreaterThan(0);
    expect(gaps.drilldown.gaps).toEqual(
      expect.arrayContaining(["incomplete_run_prefix", "identity_links_missing"]),
    );
    expect(drillObservationStreamMetric(view, "tool_calls")?.runIds.length).toBeGreaterThan(0);
    expect(drillObservationStreamMetric(view, "business_acceptance")?.gaps).toContain(
      "business_acceptance_unknown",
    );
    expect(drillObservationStreamMetric(view, "attributed_cost")?.gaps).toContain(
      "attributed_cost_missing",
    );
    clearRuntimeObservations(host);
  });

  it("marks business acceptance and attributed cost unknown on live execution_only data", () => {
    const view = buildObservationStream({
      connected: true,
      snapshot: snapshot([
        event({
          eventId: "1",
          runId: "r1",
          sequence: 1,
          occurredAt: 1,
          receivedAt: 1,
          stream: "lifecycle",
          phase: "start",
        }),
        event({
          eventId: "2",
          runId: "r1",
          sequence: 2,
          occurredAt: 11,
          receivedAt: 11,
          stream: "lifecycle",
          phase: "end",
        }),
      ]),
      sessionKey: "s",
    });
    expect(metric(view, "run_completion_rate").value).toBe(1);
    expect(metric(view, "run_completion_rate").label).toContain("进程生命周期");
    expect(metric(view, "business_acceptance").value).toBeNull();
    expect(metric(view, "business_acceptance").display).toBe("未知");
    expect(metric(view, "attributed_cost").value).toBeNull();
    expect(metric(view, "attributed_cost").display).toBe("未知");
  });

  it("omits event-rate samples when only a single arrival instant exists", () => {
    const view = buildObservationStream({
      connected: true,
      snapshot: snapshot([
        event({
          eventId: "1",
          runId: "r1",
          sequence: 1,
          occurredAt: 5,
          receivedAt: 50,
          stream: "tool",
          phase: "start",
          capabilityCallId: "t1",
        }),
      ]),
      sessionKey: "s",
      now: 50,
    });
    expect(metric(view, "event_receive_rate").value).toBeNull();
    expect(metric(view, "event_receive_rate").series).toEqual([]);
    expect(metric(view, "event_receive_rate").drilldown.gaps).toContain("insufficient_time_span");
    expect(metric(view, "tool_calls").value).toBe(1);
  });
});
