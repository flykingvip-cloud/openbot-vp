import type { RuntimeObservation, RuntimeObservationSnapshot } from "../runtime-observation.ts";
import { emptyObservation, reasonLabel, type ObservationRun } from "./model.ts";

/** Live observation has no durable replay; UI must say so instead of inventing history. */
export const OBSERVATION_STREAM_SCOPE_FROM_CONNECTION = "从本次连接开始" as const;

export const OBSERVATION_STREAM_SOURCE_LIVE =
  "RuntimeObservationSnapshot · execution_only" as const;

export type ObservationStreamMetricKey =
  | "active_runs"
  | "event_receive_rate"
  | "run_completion_rate"
  | "latency_p50"
  | "latency_p95"
  | "tool_calls"
  | "sequence_or_link_gaps"
  | "business_acceptance"
  | "attributed_cost";

/** One real arrival-derived sample. Never invent timestamps the snapshot did not receive. */
export type ObservationStreamSamplePoint = {
  at: number;
  value: number | null;
  source: string;
  updatedAt: number;
  scope: string;
};

export type ObservationStreamDrilldown = {
  metricKey: ObservationStreamMetricKey;
  /** ObservationRun.id values the metric can currently support. */
  runIds: string[];
  /** Evidence / association gaps (raw reason codes or short labels). */
  gaps: string[];
};

export type ObservationStreamMetric = {
  key: ObservationStreamMetricKey;
  label: string;
  /** Numeric payload when known. `null` means the UI must not render a fabricated 0. */
  value: number | null;
  /** Ready-to-show text; prefers 未知 / — over "0" when absent. */
  display: string;
  unit: string | null;
  source: string;
  updatedAt: number | null;
  scope: string;
  note: string;
  series: readonly ObservationStreamSamplePoint[];
  drilldown: ObservationStreamDrilldown;
};

/** Pure window over a live snapshot. Re-building with the same input never accumulates samples. */
export type ObservationStreamView = {
  source: "live";
  connected: boolean;
  partial: boolean;
  sessionKey: string | null;
  scope: typeof OBSERVATION_STREAM_SCOPE_FROM_CONNECTION;
  windowStartAt: number | null;
  windowEndAt: number | null;
  updatedAt: number | null;
  sourceLabel: typeof OBSERVATION_STREAM_SOURCE_LIVE;
  metrics: readonly ObservationStreamMetric[];
  reasons: readonly string[];
};

export type BuildObservationStreamInput = {
  connected: boolean;
  snapshot?: RuntimeObservationSnapshot | null;
  sessionKey?: string | null;
  /**
   * Optional clock used only as the rate denominator end when it is at/after the
   * last real receivedAt. Never creates sample points by itself.
   */
  now?: number;
};

const GAP_REASONS = new Set([
  "sequence_gap_or_reorder",
  "incomplete_run_prefix",
  "identity_links_missing",
  "scenario_task_ref",
  "admitted_work_id",
  "outcome_revision",
  "source_provenance",
  "no_durable_replay",
  "retention_limit",
  "not_observed",
]);

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].toSorted((a, b) => a - b);
}

function prefixSnapshot(
  snapshot: RuntimeObservationSnapshot,
  throughReceivedAt: number,
): RuntimeObservationSnapshot {
  return {
    partial: snapshot.partial,
    reasons: snapshot.reasons,
    events: snapshot.events.filter((event) => event.receivedAt <= throughReceivedAt),
  };
}

function isLifecycleComplete(run: ObservationRun): boolean {
  return typeof run.latencyMs === "number" && Number.isFinite(run.latencyMs);
}

function isActiveRun(run: ObservationRun): boolean {
  return !isLifecycleComplete(run);
}

function percentileSorted(sortedAsc: readonly number[], p: number): number | null {
  if (sortedAsc.length === 0) {
    return null;
  }
  const first = sortedAsc[0];
  if (sortedAsc.length === 1 || first === undefined) {
    return first ?? null;
  }
  const rank = (sortedAsc.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const lowValue = sortedAsc[low];
  const highValue = sortedAsc[high];
  if (lowValue === undefined || highValue === undefined) {
    return null;
  }
  if (low === high) {
    return lowValue;
  }
  const weight = rank - low;
  return lowValue * (1 - weight) + highValue * weight;
}

function formatUnknownDisplay(kind: "unknown" | "empty"): string {
  return kind === "unknown" ? "未知" : "—";
}

function point(
  at: number,
  value: number | null,
  source: string,
  scope: string,
): ObservationStreamSamplePoint {
  return { at, value, source, updatedAt: at, scope };
}

function metricBase(input: {
  key: ObservationStreamMetricKey;
  label: string;
  value: number | null;
  display: string;
  unit: string | null;
  source: string;
  updatedAt: number | null;
  scope: string;
  note: string;
  series: readonly ObservationStreamSamplePoint[];
  runIds: string[];
  gaps: string[];
}): ObservationStreamMetric {
  return {
    key: input.key,
    label: input.label,
    value: input.value,
    display: input.display,
    unit: input.unit,
    source: input.source,
    updatedAt: input.updatedAt,
    scope: input.scope,
    note: input.note,
    series: input.series,
    drilldown: {
      metricKey: input.key,
      runIds: input.runIds,
      gaps: input.gaps,
    },
  };
}

function runGapCodes(run: ObservationRun): string[] {
  return run.reasons.filter((reason) => GAP_REASONS.has(reason));
}

function sessionGapCodes(reasons: readonly string[]): string[] {
  return reasons.filter((reason) => GAP_REASONS.has(reason));
}

function ratePerMinute(
  eventCount: number,
  windowStartAt: number,
  windowEndAt: number,
): number | null {
  if (eventCount <= 0) {
    return null;
  }
  const elapsedMs = windowEndAt - windowStartAt;
  if (elapsedMs <= 0) {
    // A single arrival instant cannot define a rate without inventing duration.
    return null;
  }
  return (eventCount * 60_000) / elapsedMs;
}

function buildSeriesForArrivals(
  arrivals: readonly number[],
  snapshot: RuntimeObservationSnapshot,
  connected: boolean,
  sessionKey: string | null,
  scope: string,
  source: string,
  project: (
    runs: readonly ObservationRun[],
    events: readonly RuntimeObservation[],
    at: number,
  ) => number | null,
): ObservationStreamSamplePoint[] {
  const series: ObservationStreamSamplePoint[] = [];
  for (const at of arrivals) {
    const prefixed = prefixSnapshot(snapshot, at);
    const view = emptyObservation(connected, prefixed, sessionKey);
    const value = project(view.runs, prefixed.events, at);
    // Omit unknown points so the UI never charts fabricated zeros.
    if (value === null) {
      continue;
    }
    series.push(point(at, value, source, scope));
  }
  return series;
}

/**
 * Build a live observation window and short trends from a real snapshot.
 * Pure: same input ⇒ same output; does not retain or grow sample history across calls.
 */
export function buildObservationStream(input: BuildObservationStreamInput): ObservationStreamView {
  const connected = input.connected;
  const sessionKey = input.sessionKey ?? null;
  const snapshot = input.snapshot ?? null;
  const scope = OBSERVATION_STREAM_SCOPE_FROM_CONNECTION;
  const source = OBSERVATION_STREAM_SOURCE_LIVE;
  const liveView = emptyObservation(connected, snapshot, sessionKey);
  const events = snapshot?.events ?? [];
  const arrivals = uniqueSorted(events.map((event) => event.receivedAt));
  const windowStartAt = arrivals[0] ?? null;
  const lastReceivedAt = arrivals.at(-1) ?? null;
  const rateEndAt =
    lastReceivedAt === null
      ? null
      : typeof input.now === "number" && Number.isFinite(input.now) && input.now >= lastReceivedAt
        ? input.now
        : lastReceivedAt;
  const updatedAt = lastReceivedAt;
  const runs = liveView.runs;
  const completedRuns = runs.filter(isLifecycleComplete);
  const activeRuns = runs.filter(isActiveRun);
  const latencies = completedRuns
    .map((run) => run.latencyMs)
    .filter((value): value is number => typeof value === "number")
    .toSorted((a, b) => a - b);
  const toolRuns = runs.filter((run) => run.toolState !== "unknown");
  const toolCallIds = new Set<string>();
  for (const event of events) {
    if (event.stream === "tool" && event.capabilityCallId) {
      toolCallIds.add(event.capabilityCallId);
    }
  }
  const toolCallCount =
    toolCallIds.size > 0
      ? toolCallIds.size
      : events.filter((event) => event.stream === "tool").length || null;
  const gapRuns = runs.filter((run) => runGapCodes(run).length > 0);
  const gapCodes = [
    ...new Set([...sessionGapCodes(liveView.reasons), ...runs.flatMap((run) => runGapCodes(run))]),
  ];
  const acceptedRuns = runs.filter((run) => run.outcomeState === "accepted");
  const knownAcceptanceRuns = runs.filter(
    (run) => run.outcomeState === "accepted" || run.outcomeState === "rejected",
  );
  const costKnownRuns = runs.filter((run) => run.attributedCost !== null);

  const activeSeries = buildSeriesForArrivals(
    arrivals,
    snapshot ?? { events: [], partial: true, reasons: ["not_observed"] },
    connected,
    sessionKey,
    scope,
    source,
    (prefixRuns) => prefixRuns.filter(isActiveRun).length,
  );

  const rateSeries: ObservationStreamSamplePoint[] = [];
  if (windowStartAt !== null) {
    for (const at of arrivals) {
      const count = events.filter((event) => event.receivedAt <= at).length;
      const value = ratePerMinute(count, windowStartAt, at);
      if (value === null) {
        continue;
      }
      rateSeries.push(point(at, value, source, scope));
    }
  }

  const completionSeries = buildSeriesForArrivals(
    arrivals,
    snapshot ?? { events: [], partial: true, reasons: ["not_observed"] },
    connected,
    sessionKey,
    scope,
    source,
    (prefixRuns) => {
      const startedOrEnded = prefixRuns.filter(
        (run) => isLifecycleComplete(run) || run.toolState !== "unknown" || run.eventCount > 0,
      );
      const done = prefixRuns.filter(isLifecycleComplete);
      if (startedOrEnded.length === 0) {
        return null;
      }
      // Only report a rate once at least one lifecycle completion exists;
      // otherwise a lone in-flight run would look like "0% complete".
      if (done.length === 0) {
        return null;
      }
      return done.length / startedOrEnded.length;
    },
  );

  const latencyP50Series = buildSeriesForArrivals(
    arrivals,
    snapshot ?? { events: [], partial: true, reasons: ["not_observed"] },
    connected,
    sessionKey,
    scope,
    source,
    (prefixRuns) => {
      const values = prefixRuns
        .map((run) => run.latencyMs)
        .filter((value): value is number => typeof value === "number")
        .toSorted((a, b) => a - b);
      return percentileSorted(values, 0.5);
    },
  );

  const latencyP95Series = buildSeriesForArrivals(
    arrivals,
    snapshot ?? { events: [], partial: true, reasons: ["not_observed"] },
    connected,
    sessionKey,
    scope,
    source,
    (prefixRuns) => {
      const values = prefixRuns
        .map((run) => run.latencyMs)
        .filter((value): value is number => typeof value === "number")
        .toSorted((a, b) => a - b);
      return percentileSorted(values, 0.95);
    },
  );

  const toolSeries = buildSeriesForArrivals(
    arrivals,
    snapshot ?? { events: [], partial: true, reasons: ["not_observed"] },
    connected,
    sessionKey,
    scope,
    source,
    (_runs, prefixEvents) => {
      const ids = new Set<string>();
      for (const event of prefixEvents) {
        if (event.stream === "tool" && event.capabilityCallId) {
          ids.add(event.capabilityCallId);
        }
      }
      if (ids.size > 0) {
        return ids.size;
      }
      const count = prefixEvents.filter((event) => event.stream === "tool").length;
      return count > 0 ? count : null;
    },
  );

  const gapSeries = buildSeriesForArrivals(
    arrivals,
    snapshot ?? { events: [], partial: true, reasons: ["not_observed"] },
    connected,
    sessionKey,
    scope,
    source,
    (prefixRuns, _events, _at) => {
      const count = prefixRuns.filter((run) => runGapCodes(run).length > 0).length;
      return count > 0 ? count : null;
    },
  );

  const eventCount = events.length;
  const eventRate =
    windowStartAt !== null && rateEndAt !== null
      ? ratePerMinute(eventCount, windowStartAt, rateEndAt)
      : null;
  const completionRate =
    runs.length === 0 || completedRuns.length === 0 ? null : completedRuns.length / runs.length;
  const latencyP50 = percentileSorted(latencies, 0.5);
  const latencyP95 = percentileSorted(latencies, 0.95);

  const metrics: ObservationStreamMetric[] = [
    metricBase({
      key: "active_runs",
      label: "活跃运行",
      value: runs.length === 0 ? null : activeRuns.length,
      display: runs.length === 0 ? formatUnknownDisplay("empty") : String(activeRuns.length),
      unit: "runs",
      source,
      updatedAt,
      scope,
      note: "有事件但尚无合法 lifecycle start→end 的运行；不是业务任务进行中证明。",
      series: activeSeries,
      runIds: activeRuns.map((run) => run.id),
      gaps: runs.length === 0 ? ["not_observed"] : [],
    }),
    metricBase({
      key: "event_receive_rate",
      label: "收到事件速率",
      value: eventRate,
      display: eventRate === null ? formatUnknownDisplay("empty") : eventRate.toFixed(2),
      unit: "events/min",
      source,
      updatedAt,
      scope,
      note: "仅按本连接窗口内真实 receivedAt 计算；单一时刻无法定义速率。",
      series: rateSeries,
      runIds: runs.map((run) => run.id),
      gaps:
        eventRate === null
          ? eventCount === 0
            ? ["not_observed"]
            : ["insufficient_time_span"]
          : [],
    }),
    metricBase({
      key: "run_completion_rate",
      label: "运行完成率（进程生命周期）",
      value: completionRate,
      display:
        completionRate === null
          ? formatUnknownDisplay("unknown")
          : `${(completionRate * 100).toFixed(0)}%`,
      unit: "ratio",
      source,
      updatedAt,
      scope,
      note: "仅表示合法 lifecycle start→end 的进程完成，不是业务验收成功率。",
      series: completionSeries,
      runIds: completedRuns.map((run) => run.id),
      gaps:
        completionRate === null
          ? runs.length === 0
            ? ["not_observed"]
            : ["lifecycle_completion_unavailable"]
          : activeRuns.map((run) => `incomplete:${run.id}`),
    }),
    metricBase({
      key: "latency_p50",
      label: "延迟 P50",
      value: latencyP50,
      display: latencyP50 === null ? formatUnknownDisplay("empty") : `${Math.round(latencyP50)}`,
      unit: "ms",
      source,
      updatedAt,
      scope,
      note: "只统计唯一合法 start/end 且 sequence/occurredAt 有序的运行。",
      series: latencyP50Series,
      runIds: completedRuns.map((run) => run.id),
      gaps: latencyP50 === null ? ["lifecycle_latency_unavailable"] : [],
    }),
    metricBase({
      key: "latency_p95",
      label: "延迟 P95",
      value: latencyP95,
      display: latencyP95 === null ? formatUnknownDisplay("empty") : `${Math.round(latencyP95)}`,
      unit: "ms",
      source,
      updatedAt,
      scope,
      note: "只统计唯一合法 start/end 且 sequence/occurredAt 有序的运行。",
      series: latencyP95Series,
      runIds: completedRuns.map((run) => run.id),
      gaps: latencyP95 === null ? ["lifecycle_latency_unavailable"] : [],
    }),
    metricBase({
      key: "tool_calls",
      label: "工具调用",
      value: toolCallCount,
      display: toolCallCount === null ? formatUnknownDisplay("empty") : String(toolCallCount),
      unit: "calls",
      source,
      updatedAt,
      scope,
      note: "仅统计 tool 流元数据（调用 ID / 阶段），不读取参数或返回原文。",
      series: toolSeries,
      runIds: toolRuns.map((run) => run.id),
      gaps: toolCallCount === null ? ["tool_events_not_observed"] : [],
    }),
    metricBase({
      key: "sequence_or_link_gaps",
      label: "断序或关联证据缺口",
      // Only a positive per-run gap count is numeric; session-only gaps stay null (no fabricated 0).
      value: gapRuns.length > 0 ? gapRuns.length : null,
      display: gapRuns.length > 0 ? String(gapRuns.length) : formatUnknownDisplay("empty"),
      unit: "runs",
      source,
      updatedAt,
      scope,
      note: gapCodes.length
        ? gapCodes.map((code) => reasonLabel(code)).join("；")
        : "当前窗口未见断序或关联缺口证据。",
      series: gapSeries,
      runIds: gapRuns.map((run) => run.id),
      gaps: gapCodes,
    }),
    metricBase({
      key: "business_acceptance",
      label: "业务验收",
      value: knownAcceptanceRuns.length > 0 ? acceptedRuns.length : null,
      display:
        knownAcceptanceRuns.length > 0
          ? String(acceptedRuns.length)
          : formatUnknownDisplay("unknown"),
      unit: "accepted",
      source,
      updatedAt,
      scope,
      note: "execution_only 投影不提供业务验收；工具/进程完成不能替代 TaskOutcome。",
      series: [],
      runIds: knownAcceptanceRuns.map((run) => run.id),
      gaps:
        knownAcceptanceRuns.length > 0 ? [] : ["outcome_revision", "business_acceptance_unknown"],
    }),
    metricBase({
      key: "attributed_cost",
      label: "归属成本",
      value: costKnownRuns.length > 0 ? costKnownRuns.length : null,
      display:
        costKnownRuns.length > 0 ? String(costKnownRuns.length) : formatUnknownDisplay("unknown"),
      unit: "runs_with_cost",
      source,
      updatedAt,
      scope,
      note: "没有可归属到本次运行的真实 request usage 时保持未知，不填零。",
      series: [],
      runIds: costKnownRuns.map((run) => run.id),
      gaps: costKnownRuns.length > 0 ? [] : ["attributed_cost_missing"],
    }),
  ];

  return {
    source: "live",
    connected,
    partial: liveView.partial,
    sessionKey,
    scope,
    windowStartAt,
    windowEndAt: lastReceivedAt,
    updatedAt,
    sourceLabel: source,
    metrics,
    reasons: liveView.reasons,
  };
}

/** Lookup drilldown already computed on the stream view (metric key + runIds / gaps). */
export function drillObservationStreamMetric(
  view: ObservationStreamView,
  key: ObservationStreamMetricKey,
): ObservationStreamDrilldown | null {
  return view.metrics.find((metric) => metric.key === key)?.drilldown ?? null;
}
