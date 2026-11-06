import { html } from "lit";
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
      <p>来源：${sample.provenance.join(", ") || "unknown"}${sample.provenance.some((p) => p === "seed" || p === "injected" || p === "sample_ui" || p === "unknown") ? " · 非生产来源" : ""}</p>
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
      <p>可归属成本：未知</p><p>断链原因：${sample.reasons.join(", ") || "无已报告断链"}</p>
    </article>`,
          )
        : html`
            <p>业务结果未知 · 无可用授权证据</p>
          `
    }
    <p>关联覆盖率：${model.coverage?.link == null ? "未知" : model.coverage.link} · 样本分母：${model.coverage?.attemptedCount ?? "未知"} · 无效样本：${model.coverage?.invalidCount ?? "未知"}</p>
    <p>事件覆盖率：未知 · 字段覆盖率：未知</p><p>${model.unavailableReason ?? ""} 指标字典版本：${model.metricDictVersion ?? "未知"} 窗口：[${evidenceTime(model.window?.from ?? null)}, ${evidenceTime(model.window?.to ?? null)})</p>
    <p>投影时间：${evidenceTime(model.projectedAt)} · 源水位：${model.watermark ?? "未知"}</p>
  </section>`;
}
