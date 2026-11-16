/**
 * Display-only helpers for the enterprise 智能诊断 first screen.
 * Metrics use the original filtered run set; a missing or zero denominator
 * stays 未知 and is never shown as 0%.
 */
import type { DiagnosisTargetOption } from "../ports/diagnosis/diagnosis-targets.ts";
import type { ObservationRun } from "./model.ts";

export const LINK_BREAK_REASONS = new Set([
  "identity_links_missing",
  "scenario_task_ref",
  "admitted_work_id",
  "outcome_revision",
  "source_provenance",
]);

export type AttentionKind = "all" | "link" | "review" | "rule";

export type OverviewMetric = {
  key: string;
  label: string;
  value: string;
  unit: string;
  note: string;
};

export type AttentionRow = {
  run: ObservationRun;
  status: string;
  impact: string;
  qualification: string;
  next: string;
  kind: "link" | "review" | "observed";
};

export function percentile(values: readonly number[], p: number): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).toSorted((a, b) => a - b);
  if (!sorted.length) {
    return null;
  }
  if (p > 0.5 && sorted.length < 2) {
    return null;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

export function formatLifecycleRate(complete: number, denominator: number): OverviewMetric {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return {
      key: "run_completion_rate",
      label: "执行生命周期完成率",
      value: "未知",
      unit: "",
      note: "分母不足。完成率不是业务验收或任务成功率。",
    };
  }
  const pct = Math.round((complete / denominator) * 1000) / 10;
  return {
    key: "run_completion_rate",
    label: "执行生命周期完成率",
    value: `${complete}/${denominator}`,
    unit: "",
    note: `执行生命周期完成 ${complete}/${denominator} · 非业务验收 · ${pct}%（仅供参考）`,
  };
}

export function computeOverviewMetrics(runs: readonly ObservationRun[]): OverviewMetric[] {
  const active = runs.filter((row) => row.toolState === "running" || row.toolState === "waiting").length;
  const events = runs.reduce((sum, row) => sum + row.eventCount, 0);
  const complete = runs.filter((row) => row.latencyMs !== null).length;
  const latencies = runs
    .map((row) => row.latencyMs)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);
  const toolRuns = runs.filter((row) =>
    row.stages.some((stage) => stage.key === "tool" && stage.state === "observed"),
  );
  const lifecycle = formatLifecycleRate(complete, runs.length);
  return [
    {
      key: "active_runs",
      label: "活跃运行",
      value: String(active),
      unit: "次",
      note: `分母为当前筛选可见运行 ${runs.length}。统计进程仍在生命周期内的运行，不是业务任务进行中的证明。`,
    },
    {
      key: "event_receive_rate",
      label: "事件计数",
      value: String(events),
      unit: "条",
      note: "按当前筛选集合中已接收事件计数。有事件不等于偏离。",
    },
    lifecycle,
    {
      key: "latency_p50",
      label: "延迟 P50",
      value: p50 === null ? "未知" : `${Math.round((p50 / 1000) * 10) / 10}`,
      unit: p50 === null ? "" : "秒",
      note:
        latencies.length > 0
          ? `有效时延样本 n=${latencies.length}${latencies.length < 2 ? " · 趋势已隐藏" : ""}`
          : "未知 · 无时延样本",
    },
    {
      key: "latency_p95",
      label: "延迟 P95",
      value: p95 === null ? "未知" : `${Math.round((p95 / 1000) * 10) / 10}`,
      unit: p95 === null ? "" : "秒",
      note:
        latencies.length >= 2
          ? `有效时延样本 n=${latencies.length}`
          : "未知 · 样本不足（需至少 2 条）",
    },
    {
      key: "tool_calls",
      label: "工具调用",
      value: toolRuns.length ? String(toolRuns.length) : "未知",
      unit: toolRuns.length ? "次" : "",
      note: toolRuns.length
        ? "来自当前筛选集合中已观察的工具阶段。工具完成不等于任务成功或业务验收。"
        : "工具调用次数未作为独立计数供给，不填零。",
    },
  ];
}

export function classifyAttention(run: ObservationRun): AttentionRow {
  const hasLink = run.reasons.some((reason) => LINK_BREAK_REASONS.has(reason));
  if (hasLink) {
    return {
      run,
      status: "关联断链",
      impact: "缺少业务结果、关联不完整或无效",
      qualification: "资格未供给",
      next: "先核实断链，打开完整证据",
      kind: "link",
    };
  }
  if (run.reasons.length) {
    return {
      run,
      status: "待核实",
      impact: "证据不完整，不能把有事件写成验收或成功",
      qualification: "部分证据",
      next: "先核实证据，打开完整证据",
      kind: "review",
    };
  }
  return {
    run,
    status: "已观察",
    impact: "已收到执行事件或结果记录。当前没有可适用的规则时，不把有事件写成异常。",
    qualification: "已观察",
    next: "打开完整证据",
    kind: "observed",
  };
}

export function attentionCounts(rows: readonly AttentionRow[]): {
  all: number;
  link: number;
  review: number;
  rule: number;
} {
  return {
    all: rows.length,
    link: rows.filter((row) => row.kind === "link").length,
    review: rows.filter((row) => row.kind === "review" || row.kind === "link").length,
    rule: 0,
  };
}

export function filterAttention(
  rows: readonly AttentionRow[],
  kind: AttentionKind,
): AttentionRow[] {
  if (kind === "all") {
    return [...rows];
  }
  if (kind === "link") {
    return rows.filter((row) => row.kind === "link");
  }
  if (kind === "review") {
    return rows.filter((row) => row.kind === "review" || row.kind === "link");
  }
  return [];
}

export function groupTargetsByAgent(
  targets: readonly DiagnosisTargetOption[],
): { agentId: string; label: string; sessions: readonly DiagnosisTargetOption[] }[] {
  const groups = new Map<string, { agentId: string; label: string; sessions: DiagnosisTargetOption[] }>();
  for (const target of targets) {
    const existing = groups.get(target.agentId);
    if (existing) {
      existing.sessions.push(target);
      if (target.label && existing.label === existing.agentId) {
        existing.label = target.label;
      }
      continue;
    }
    groups.set(target.agentId, {
      agentId: target.agentId,
      label: target.label?.trim() || target.agentId,
      sessions: [target],
    });
  }
  return [...groups.values()];
}

export type CapacityCard = {
  title: string;
  value: string;
  detail: string;
  reasons: string;
  note: string;
};

/** Show a number only when both sides of the ratio are confirmed and the denominator is > 0. */
export function formatRatioOrUnknown(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  labels: { numerator: string; denominator: string },
): { value: string; detail: string } {
  if (
    numerator == null ||
    denominator == null ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator <= 0 ||
    numerator < 0
  ) {
    return {
      value: "未知",
      detail: `${labels.numerator} 未知 / ${labels.denominator} 未知`,
    };
  }
  return {
    value: `${numerator}/${denominator}`,
    detail: `${labels.numerator} ${numerator} / ${labels.denominator} ${denominator}`,
  };
}

export function defaultCapacityCards(): CapacityCard[] {
  return [
    {
      title: "采样覆盖",
      value: "未知",
      detail: "expectedSamples 未知 / observedSamples 未知",
      reasons: "continuous_probe_denominator_unavailable · source_unavailable",
      note: "登记快照不是在线率；无连续探针分母时不推断覆盖。",
    },
    {
      title: "心跳时效",
      value: "未知",
      detail: "expectedSamples 未知 / observedSamples 未知",
      reasons: "source_unavailable",
      note: "source_unavailable · 不等于窗口覆盖。分母不完整时状态为未知。",
    },
    {
      title: "登记并发",
      value: "未知",
      detail: "activeRuns 未知 / limit 未知 · 余量未知",
      reasons: "source_missing",
      note: "容量不代表业务结果。concurrency.kind = registered_run_snapshot。",
    },
    {
      title: "额度",
      value: "未知",
      detail: "remaining 未知 / allowance（分母）未知",
      reasons: "authoritative_balance_denominator_unavailable",
      note: "无权威余额分母时不展示剩余额度数字。",
    },
  ];
}
