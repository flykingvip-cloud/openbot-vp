import { html } from "lit";
import type { createCapacityReader } from "../../../../src/observation/capacity-reader.js";
import type { createMetricCompareQuery } from "../../../../src/observation/metric-compare-query.js";
export type CapacityView = Extract<
  Awaited<ReturnType<ReturnType<typeof createCapacityReader>>>,
  { ok: true }
>;
export type ComparisonView = Extract<
  Awaited<ReturnType<ReturnType<typeof createMetricCompareQuery>>>,
  { ok: true }
>;
export type ComparisonRefs = {
  baseline: {
    refs: { agentId: string; taskId: string; outcomeVersion: number }[];
    window: { from: number; to: number };
  };
  candidate: {
    refs: { agentId: string; taskId: string; outcomeVersion: number }[];
    window: { from: number; to: number };
  };
};
export function hasComparisonRefs(value: ComparisonRefs | null): value is ComparisonRefs {
  return Boolean(
    value &&
    [value.baseline, value.candidate].every(
      (side) =>
        side &&
        side.refs.length > 0 &&
        side.refs.every(
          (ref) =>
            ref.taskId.trim() &&
            ref.agentId.trim() &&
            Number.isSafeInteger(ref.outcomeVersion) &&
            ref.outcomeVersion > 0,
        ) &&
        Number.isFinite(side.window.from) &&
        Number.isFinite(side.window.to) &&
        side.window.from < side.window.to,
    ),
  );
}
export function renderComparisonCapacity(
  capacity: CapacityView | null,
  comparison: ComparisonView | null,
) {
  const snapshot = capacity?.snapshot;
  return html`<section aria-label="比较与容量只读证据"><h3>容量与风险</h3><p>登记快照不是在线率；容量不代表业务结果。</p>
 <dl>${(
   [
     ["资源健康", snapshot?.health],
     ["心跳", snapshot?.heartbeat],
     ["登记并发", snapshot?.concurrency],
     ["额度", snapshot?.quota],
   ] as const
 ).map(
   ([label, row]) =>
     html`<dt>${label}</dt><dd>${row?.state ?? "unknown"} · ${row?.reasons.join(", ") ?? "source_unavailable"}</dd>`,
 )}</dl>
 <p>登记并发：${snapshot?.concurrency.activeRuns ?? "未知"} / ${snapshot?.concurrency.limit ?? "未知"} · 余量：${snapshot?.concurrency.remaining ?? "未知"}</p><p>额度余量：${snapshot?.quota.remaining ?? "未知"} · 分母：${snapshot?.quota.allowance ?? "未知"} · ${capacity?.reasons.join(", ") ?? "来源未知"}</p>
 <h3>显式任务版本对照</h3>${
   comparison
     ? html`<p>${comparison.comparison.status} · ${comparison.comparison.provenanceLabel}</p><p>baseline：${comparison.comparison.baselineValue ?? "未知"} · candidate：${comparison.comparison.candidateValue ?? "未知"} · 差值：${comparison.comparison.delta ?? "未知"}</p><p>${comparison.comparison.reasons.join(", ")}</p>`
     : html`
         <p>未知 · 缺少显式baseline/candidate任务版本与窗口证据</p>
       `
 }
 <p>只读相关性对照，不代表因果改善或生产验证；不自动推理或晋升。</p></section>`;
}
