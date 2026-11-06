import type { RuntimeObservation, RuntimeObservationSnapshot } from "../runtime-observation.ts";

/** A UI-only adapter boundary. In particular, this never claims `fully_linked`. */
export type ObservationEvidence = {
  label: string;
  value: string | null;
  state?: "observed" | "missing" | "unknown";
};
export type ObservationStage = {
  key: string;
  label: string;
  state: "observed" | "waiting" | "missing";
  detail: string;
};
export type ObservationEnterpriseEntry = {
  tenantId: string;
  label: string;
  status: string;
  plan?: string;
  healthSummary?: {
    label?: string;
    tone?: "ok" | "warn" | "danger" | "neutral";
    incidentLabel?: string;
    errorRate?: number;
    successRate?: number;
    fallbackRate?: number;
    avgLatencyMs?: number;
    updatedAt?: number;
  };
  usageSummary?: {
    calls7d?: number;
    cost7d?: number;
    activeAgentCount?: number;
    activeChannelCount?: number;
    activeRuntimeCount?: number;
    updatedAt?: number;
  };
};
export type ObservationRun = {
  id: string;
  label: string;
  scope: "personal" | "collaboration" | "unknown";
  tenantId: string | null;
  tenantLabel: string | null;
  clientRunId: string | null;
  sourceRunId: string | null;
  admittedWorkId: string | null;
  scenarioTaskRef: string | null;
  outcomeRevision: string | null;
  toolState: "completed" | "running" | "waiting" | "unknown";
  outcomeState: "accepted" | "rejected" | "pending" | "unavailable";
  latencyMs: number | null;
  attributedCost: { amount: number; currency: string; coverage: string } | null;
  stages: ObservationStage[];
  reasons: string[];
  eventCount: number;
  sample: boolean;
};
export type ObservationView = {
  source: "live" | "sample";
  connected: boolean;
  partial: boolean;
  sessionKey: string | null;
  reasons: string[];
  runs: ObservationRun[];
  receivedAt: number | null;
};
export const OBSERVATION_TYPES = ["全部", "个人", "协作"] as const;
export const MISSING_REASON_LABELS: Record<string, string> = {
  no_durable_replay: "没有持久化回放，当前只看到连接期间收到的片段",
  identity_links_missing: "业务身份与结果关联尚未完整供给",
  sequence_gap_or_reorder: "事件存在断序或乱序",
  incomplete_run_prefix: "缺少运行起始片段",
  retention_limit: "超过单个会话最多保留的 200 条事件",
  scenario_task_ref: "场景任务引用尚未供给",
  admitted_work_id: "准入工作 ID 尚未供给",
  outcome_revision: "结果版本尚未供给",
  source_provenance: "来源证明尚未供给",
  attributed_cost_missing: "没有可归属到本次运行的真实 request usage 成本",
  not_observed: "还没有严格匹配当前会话的事件",
  disconnected: "网络连接断开，不能补写缺失状态",
  sample_acceptance: "样例业务验收证据，不代表生产验收",
  sample_identity: "样例身份关联，仅供交互验收",
};

export function reasonLabel(reason: string) {
  return MISSING_REASON_LABELS[reason] ?? reason;
}

export function emptyObservation(
  connected: boolean,
  snapshot?: RuntimeObservationSnapshot | null,
  sessionKey: string | null = null,
): ObservationView {
  const events = snapshot?.events ?? [];
  const reasonSet = new Set(snapshot?.reasons ?? []);
  if (!connected) {
    reasonSet.add("disconnected");
  }
  const runs = groupRuns(events, snapshot?.reasons ?? []);
  return {
    source: "live",
    connected,
    partial:
      !connected || (snapshot?.partial ?? true) || runs.some((row) => row.reasons.length > 0),
    sessionKey,
    reasons: [...reasonSet, ...runs.flatMap((row) => row.reasons)].filter(
      (reason, index, all) => all.indexOf(reason) === index,
    ),
    runs,
    receivedAt: events.at(-1)?.receivedAt ?? null,
  };
}

function groupRuns(
  events: readonly RuntimeObservation[],
  sessionReasons: readonly string[] = [],
): ObservationRun[] {
  const groups = new Map<string, RuntimeObservation[]>();
  for (const event of events) {
    const key = JSON.stringify([event.runId, event.sourceRunId]);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.values()]
    .map((rows): ObservationRun & { latestAt: number } => {
      const last = rows.at(-1)!;
      const tool = rows.toReversed().find((event) => event.stream === "tool");
      const starts = rows.filter((row) => row.stream === "lifecycle" && row.phase === "start");
      const ends = rows.filter((row) => row.stream === "lifecycle" && row.phase === "end");
      const start = starts.length === 1 ? starts[0] : undefined;
      const end = ends.length === 1 ? ends[0] : undefined;
      const latencyMs =
        start && end && end.sequence > start.sequence && end.occurredAt >= start.occurredAt
          ? end.occurredAt - start.occurredAt
          : null;
      return {
        id: `${last.runId}@${last.sourceRunId ?? "unmapped"}`,
        label: `${last.runId}${last.sourceRunId ? ` → ${last.sourceRunId}` : ""}`,
        scope: "unknown",
        tenantId: null,
        tenantLabel: null,
        clientRunId: last.runId,
        sourceRunId: last.sourceRunId,
        admittedWorkId: null,
        scenarioTaskRef: null,
        outcomeRevision: null,
        toolState: tool?.phase === "end" ? "completed" : tool ? "running" : "unknown",
        // A terminal engine or tool event is explicitly not a task acceptance.
        outcomeState: "unavailable",
        latencyMs,
        attributedCost: null,
        stages: [
          {
            key: "execution",
            label: "运行片段",
            state: "observed",
            detail: `收到 ${rows.length} 条当前会话的元数据事件。`,
          },
          {
            key: "tool",
            label: "工具调用",
            state: tool ? "observed" : "missing",
            detail: tool ? "只保留调用 ID 和阶段，不读取参数或返回原文。" : "尚未观察到工具调用。",
          },
          {
            key: "work",
            label: "场景工作项",
            state: "missing",
            detail: "当前运行不能安全映射场景工作项或准入工作。",
          },
          {
            key: "outcome",
            label: "业务验收",
            state: "missing",
            detail: "无验收证据，工具完成不能替代业务结果。",
          },
        ],
        reasons: [
          ...new Set([...last.missing, ...rows.flatMap((row) => row.missing), ...sessionReasons]),
        ],
        eventCount: rows.length,
        sample: false,
        latestAt: rows.at(-1)?.receivedAt ?? 0,
      };
    })
    .toSorted((a, b) => b.latestAt - a.latestAt)
    .map(({ latestAt: _latestAt, ...row }): ObservationRun => row);
}
