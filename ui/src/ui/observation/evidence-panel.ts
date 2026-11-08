import { html, nothing } from "lit";
import { evidenceModel, evidenceTime, type EvidenceProjection } from "./evidence-model.ts";
const layers = {
  resource: "资源健康",
  technical: "技术调用",
  execution: "任务执行",
  business: "业务结果",
} as const;
export function renderObservationEvidence(projection: EvidenceProjection | null) {
  const model = evidenceModel(projection);
  return html`<section aria-label="运行证据投影">
    <p>只读证据投影；关联完整不代表业务成功。连接窗口仍为 execution_only。</p>
    ${
      model.samples.length
        ? model.samples.map(
            (sample) => html`<article data-qualification=${sample.qualification}>
      <h3>${sample.qualification}</h3>
      <p>来源：${sample.provenance.join(", ") || "unknown"}${sample.provenance.some((p) => p === "seed" || p === "injected" || p === "sample_ui") ? " · 非生产来源" : ""}${sample.provenance.includes("unknown") || !sample.provenance.length ? " · 来源未核验，不作为生产验证" : ""}</p>
      <dl>${Object.entries(layers).map(([key, label]) => {
        const layer = key as keyof typeof layers;
        return html`<dt>${label}</dt><dd>${sample.evidence[layer]} · ${sample.evidenceReasons[layer].join(", ")}</dd>`;
      })}</dl>
      ${
        sample.outcome
          ? html`<p>任务 ${sample.outcome.taskId}@${sample.outcome.outcomeVersion} · ${sample.outcome.isCurrentTip ? "当前结果版本" : "历史结果版本"}</p><p>业务裁决：${sample.outcome.taskJudgement} · 生命周期：${sample.outcome.lifecycle} · 验收：${sample.outcome.acceptanceStatus} · 投递：${sample.outcome.deliveryStatus}</p>`
          : html`
              <p>业务结果未知 · 缺少关联结果版本</p>
            `
      }
      <p>执行引用：run ${new Set(sample.executionRefs.map((ref) => ref.runId)).size} · attempt ${new Set(sample.executionRefs.map((ref) => ref.attemptId).filter(Boolean)).size} · event ${new Set(sample.executionRefs.map((ref) => JSON.stringify([ref.sourceId, ref.eventId]))).size}</p>
      <p>turn / attempt 粒度；关联回执不等于执行事件，invalid 不代表成功。</p>
      <p>可归属成本：未知</p><p>断链原因：${sample.reasons.map((reason) => (reason === "outside_cohort_window" ? "outside_cohort_window · 支持证据在cohort窗口外，不计入该窗口统计" : reason)).join(", ") || "无已报告断链"}</p>
    </article>`,
          )
        : html`
            <p>业务结果未知 · 无可用授权证据</p>
          `
    }
    <section aria-label="执行器技术调用证据"><h3>执行器技术调用 · 独立L2证据</h3><p>候选调用不等于任务执行成功；连接窗口保持 execution_only，运行总成本：未知。</p><p>当前切面：${model.technical?.state ?? "unknown"} · ${model.technical?.reasons.join(", ") ?? "executor_source_unavailable"}</p>${model.technical && "sourceCompleteness" in model.technical ? html`<p>源完整性：${model.technical.sourceCompleteness.overall} · 当前窗口完整性：${model.technical.completeness} · 源水位：${model.technical.sourceWatermark ?? "未知"}（不等于窗口覆盖）</p>` : nothing}${model.technical?.calls.map((call) => html`<article><p>调用：${call.callId} · run：${call.runId} · candidate：${call.candidateAttemptId}</p><p>来源：${call.provenance} · ${call.collector}${call.provenance !== "live" ? " · 不作为生产验证" : ""} · 状态：${call.status}</p></article>`)}${model.technical?.associations.map((row) => html`<p>candidate：${row.candidateAttemptId ?? "未知"} · taskAttempt：${row.taskAttemptId ?? "未知"} · 结果版本：${row.finalOutcomeVersion ?? "未知"} · ${row.budgetChargeReasons.join(", ")}</p>`)}${model.technical && "attributionGaps" in model.technical ? model.technical.attributionGaps.map((row) => html`<p>扣记断链：${row.reasons.join(", ")}</p>`) : nothing}</section>
    <p>关联覆盖率：${model.coverage?.link == null ? "未知" : model.coverage.link} · 关联分子：${model.coverage?.fullyLinkedCount ?? "未知"} · 样本分母：${model.coverage?.attemptedCount ?? "未知"} · 无效样本：${model.coverage?.invalidCount ?? "未知"}</p>
    <p>事件覆盖率：未知（${model.coverage?.events.reason ?? "source_unavailable"}） · 字段覆盖率：未知（${model.coverage?.fields.reason ?? "source_unavailable"}）</p><p>${model.unavailableReason ?? ""} 指标字典版本：${model.metricDictVersion ?? "未知"} cohort统计窗口：[${evidenceTime(model.window?.from ?? null)}, ${evidenceTime(model.window?.to ?? null)})</p>
    <p>支持证据检索窗口：${model.evidenceLookupWindow ? html`[${evidenceTime(model.evidenceLookupWindow.from)}, ${evidenceTime(model.evidenceLookupWindow.to)})` : "未提供（不推断扩大）"}；支持证据不自动计入cohort统计。</p>
    <p>执行来源保留：${model.executionSource?.retention ?? "未知"} · TTL(ms)：${model.executionSource?.ttlMs ?? "未知"} · 容量：${model.executionSource?.capacity ?? "未知"} · epoch：${model.executionSource?.epoch ?? "未知"}</p>
    <p>保留连续性：${model.executionSource?.reasons.join(", ") ?? "未知"} · 进程内存不代表耐久历史</p>
    <p>投影时间：${evidenceTime(model.projectedAt)} · 源水位：${model.watermark ?? "未知"}</p>
  </section>`;
}
