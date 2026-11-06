import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "../../styles/observation-workbench.css";
import { pathForTab } from "../navigation.ts";
import type { DiagnosisTargetOption } from "../ports/diagnosis/diagnosis-targets.ts";
import { readRuntimeObservations } from "../runtime-observation.ts";
import {
  emptyObservation,
  OBSERVATION_TYPES,
  reasonLabel,
  type ObservationRun,
  type ObservationView,
} from "./model.ts";
import { observationSamples } from "./samples.ts";

export type ObservationProps = {
  role: "platform" | "enterprise";
  tenantId: string | null;
  sessionKey: string | null;
  connected: boolean;
  basePath?: string;
  observationHost: object | null;
  targets?: readonly DiagnosisTargetOption[];
  onSessionKey?: (sessionKey: string) => void;
};
export function renderObservationWorkbench(props: ObservationProps) {
  return html`<openbot-observation-workbench
    .role=${props.role} .tenantId=${props.tenantId} .sessionKey=${props.sessionKey}
    .observationHost=${props.observationHost ?? null}
    .connected=${props.connected} .onSessionKey=${props.onSessionKey ?? null} .basePath=${props.basePath ?? ""} .targets=${props.targets ?? []}
  ></openbot-observation-workbench>`;
}

@customElement("openbot-observation-workbench")
export class OpenBotObservationWorkbench extends LitElement {
  @property() role: "platform" | "enterprise" = "platform";
  @property({ attribute: false }) tenantId: string | null = null;
  @property({ attribute: false }) sessionKey: string | null = null;
  @property({ type: Boolean }) connected = false;
  @property() basePath = "";
  @property({ attribute: false }) onSessionKey: ((sessionKey: string) => void) | null = null;
  @property({ attribute: false }) targets: readonly DiagnosisTargetOption[] = [];
  @state() private surface: "overview" | "analysis" | "governance" = "overview";
  @state() private analysis: "tasks" | "models" | "executors" | "capacity" = "tasks";
  @property({ type: String }) source: "live" | "sample" = "live";
  @property({ attribute: false }) observationHost: object | null = null;
  @state() private filter: (typeof OBSERVATION_TYPES)[number] = "全部";
  @state() private selected: ObservationRun | null = null;
  @state() private tick = 0;

  createRenderRoot() {
    return this;
  }
  connectedCallback() {
    super.connectedCallback();
    this.tick = 0;
    this.poll = window.setInterval(() => {
      this.tick++;
    }, 1000);
  }
  disconnectedCallback() {
    if (this.poll !== undefined) {
      window.clearInterval(this.poll);
    }
    this.poll = undefined;
    super.disconnectedCallback();
  }
  private poll: number | undefined;
  private view(): ObservationView {
    void this.tick;
    return this.source === "sample"
      ? observationSamples(this.role)
      : emptyObservation(
          this.connected,
          readRuntimeObservations(this.observationHost ?? {}, this.sessionKey ?? ""),
          this.sessionKey,
        );
  }
  private setSource(value: string) {
    if (value === "sample" || value === "live") {
      this.source = value;
      this.selected = null;
    }
  }
  private renderTabs() {
    return html`<nav class="obs-tabs" aria-label="观测视图" role="tablist">
      ${(
        [
          ["overview", "态势总览"],
          ["analysis", "运行分析"],
          ["governance", "治理与验证"],
        ] as const
      ).map(
        ([id, label]) =>
          html`<button type="button" role="tab" aria-selected=${this.surface === id} class=${this.surface === id ? "is-active" : ""} @click=${() => {
            this.surface = id;
          }}>${label}</button>`,
      )}
    </nav>`;
  }
  private renderCoverage(view: ObservationView) {
    return html`<div class="obs-coverage">
      <span class="obs-status ${view.partial ? "is-partial" : "is-ok"}">${view.partial ? "部分数据" : "证据齐备"}</span>
      <span>${view.source === "sample" ? "交互验收样例 · 非生产数据" : "当前连接观察片段 · execution_only"}</span>
      ${
        view.connected
          ? html`<span class="obs-live">${view.source === "live" ? "连接正常" : "样例已启用"}</span>`
          : html`
              <span class="obs-status is-partial">未连接</span>
            `
      }
    </div>
    ${view.reasons.length ? html`<div class="obs-reasons">${[...new Set(view.reasons)].map(reasonLabel).map((reason) => html`<span>${reason}</span>`)}</div>` : nothing}`;
  }
  private renderSummary(view: ObservationView, runs: readonly ObservationRun[]) {
    const events = runs.reduce((n, row) => n + row.eventCount, 0);
    const accepted = runs.filter((row) => row.outcomeState === "accepted").length;
    return html`<section class="obs-metrics" aria-label="数据覆盖">
      ${[
        ["已观察运行", String(runs.length), "按 clientRunId 与 sourceRunId 区分"],
        ["元数据事件", String(events), "当前会话有界窗口"],
        [
          "有业务验收",
          view.source === "sample" ? String(accepted) : "未知",
          "不以工具结束代替验收",
        ],
        ["可归属成本", "未知", "没有真实 request usage 就不填零"],
      ].map(
        ([label, value, note]) =>
          html`<div class="obs-metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`,
      )}
    </section>
    <section class="obs-panel obs-attention">
      <div><h3>需要关注的证据</h3><p>事实、推断与建议分开显示。缺失关联只影响观测完整性，不改变任务本身状态。</p></div>
      <button class="obs-link" type="button" @click=${() => {
        this.surface = "analysis";
        this.analysis = "tasks";
      }}>查看运行与证据 →</button>
    </section>`;
  }
  private renderAnalysis(view: ObservationView, runs: readonly ObservationRun[]) {
    return html`<div class="obs-analysis-nav" role="tablist" aria-label="分析维度">
      ${(
        [
          ["tasks", "任务与执行"],
          ["models", "模型与路由"],
          ["executors", "执行器与能力"],
          ["capacity", "容量与风险"],
        ] as const
      ).map(
        ([id, label]) =>
          html`<button type="button" role="tab" aria-selected=${this.analysis === id} class=${this.analysis === id ? "is-active" : ""} @click=${() => {
            this.analysis = id;
          }}>${label}</button>`,
      )}
    </div>
    ${
      this.analysis === "tasks"
        ? html`
      <div class="obs-toolbar"><span>${this.role === "platform" ? "跨租户业务正文默认不可用" : "当前企业 · 个人与共享终态分开"}</span>
        <label>工作形态 <select aria-label="工作形态筛选" @change=${(event: Event) => {
          this.filter = (event.target as HTMLSelectElement).value as typeof this.filter;
        }}>${OBSERVATION_TYPES.map((row) => html`<option ?selected=${this.filter === row}>${row}</option>`)}</select></label></div>
      <div class="obs-run-list">${
        runs.length
          ? runs.map(
              (
                row,
              ) => html`<button class="obs-run" type="button" data-run-id=${row.id} @click=${() => {
                this.selected = row;
              }}>
        <span><strong>${row.label}</strong><code>${row.clientRunId ?? "clientRunId 未知"}${row.sourceRunId ? ` → ${row.sourceRunId}` : ""}</code></span>
        <span class="obs-run__state"><span>${row.scope === "personal" ? "个人" : row.scope === "collaboration" ? "协作" : "场景未知"}</span><span class="obs-status ${row.reasons.length ? "is-partial" : "is-ok"}">${row.reasons.length ? "证据不完整" : "元数据已接收"}</span></span>
      </button>`,
            )
          : html`
              <div class="obs-empty">
                <strong>当前会话还没有观测事件</strong>
                <p>没有严格匹配的事件时不借用其他会话数据。请发起一个对话，或切换到明确标注的验收样例。</p>
              </div>
            `
      }</div>
    `
        : this.renderUnavailableAnalysis()
    }
    ${this.surface !== "overview" ? this.renderCoverage(view) : nothing}`;
  }
  private renderUnavailableAnalysis() {
    const labels = {
      models: [
        "模型与路由",
        "没有从运行 eventStream 猜模型或任务类型的统计。",
        "进入模型管理",
        "platformModels",
      ],
      executors: [
        "执行器与能力",
        "缺少有统一 attempt / capabilityCall 关联的执行器指标。",
        "进入 Agent Runtime",
        "platformAgents",
      ],
      capacity: [
        "容量与风险",
        "当前只读事件不构造跨租户容量、成本和风险聚合。",
        "进入高级治理",
        "platformAdvanced",
      ],
    } as const;
    const [title, detail, link, tab] =
      labels[this.analysis as keyof typeof labels] ?? labels.capacity;
    return html`<section class="obs-panel obs-empty"><h3>${title}</h3><p>${detail}</p><span class="obs-status is-partial">待数据支撑</span><p>${this.role === "platform" ? html`<a href=${pathForTab(tab, this.basePath)}>${link} →</a>` : "企业自有效果可回到诊断与进化控制面继续分析。"}</p></section>`;
  }
  private renderGovernance(view: ObservationView) {
    return html`<section class="obs-panel obs-process"><h3>从发现到验证，每一步都有回执</h3><p>这里是建议，不是已执行或已生效的配置。</p>
      <ol>${[
        "任务证据",
        "诊断发现",
        "候选与实验",
        "授权与配置回读",
        "同口径验证",
        "晋升 / 回滚",
      ].map(
        (row, index) =>
          html`<li><span>${index + 1}</span><strong>${row}</strong>${
            index === 0
              ? html`<small>${view.source === "sample" ? "样例证据" : "仅元数据"}</small>`
              : html`
                  <small>原控制面</small>
                `
          }</li>`,
      )}</ol>
      <div class="obs-actions"><a href=${pathForTab(this.role === "platform" ? "platformModels" : "enterpriseCapabilityCenter", this.basePath, { tenantId: this.tenantId })}>${this.role === "platform" ? "配置模型" : "进入能力中心"} →</a><a href=${pathForTab(this.role === "platform" ? "platformAdvanced" : "enterpriseMesh", this.basePath, { tenantId: this.tenantId })}>进入治理控制面 →</a></div>
      <p class="obs-note">观测不会创建建议、授权请求或新任务；accepted、executed、effective、verified 不混称。</p>
    </section>`;
  }
  private renderEvidence(run: ObservationRun) {
    return html`<div class="obs-backdrop" @click=${() => {
      this.selected = null;
    }}><aside class="obs-drawer" role="dialog" aria-modal="true" aria-label="运行证据" @click=${(event: Event) => event.stopPropagation()}>
      <header><div><span class="obs-status ${run.sample ? "is-partial" : "is-ok"}">${run.sample ? "样例证据" : "实时元数据"}</span><h2>${run.label}</h2></div><button type="button" aria-label="关闭证据" @click=${() => {
        this.selected = null;
      }}>×</button></header>
      <section class="obs-evidence"><h3>只读证据</h3><dl>${[
        ["clientRunId", run.clientRunId],
        ["sourceRunId（引擎运行）", run.sourceRunId],
        ["admitted_work_id", run.admittedWorkId],
        ["场景工作项", run.scenarioTaskRef],
        ["结果版本", run.outcomeRevision],
        [
          "业务终态",
          run.outcomeState === "accepted"
            ? "accepted"
            : run.outcomeState === "pending"
              ? "待证据 / 待验收"
              : "不可用 / 未授权",
        ],
        ["耗时", run.latencyMs === null ? null : `${run.latencyMs.toLocaleString()} ms`],
        [
          "成本",
          run.attributedCost
            ? `${run.attributedCost.amount.toFixed(3)} ${run.attributedCost.currency} · ${run.attributedCost.coverage}`
            : "未知 · 未伪造为零或把周期账单摊到单任务",
        ],
      ].map(
        ([label, value]) =>
          html`<div><dt>${label}</dt><dd>${
            value ??
            html`
              <span class="obs-missing">未供给 / 不推断</span>
            `
          }</dd></div>`,
      )}</dl></section>
      <ol class="obs-timeline">${run.stages.map((row) => html`<li><span class="obs-dot is-${row.state}"></span><div><strong>${row.label}</strong><p>${row.detail}</p></div></li>`)}</ol>
      ${run.reasons.length ? html`<section class="obs-drawer-reasons"><h3>证据缺口</h3>${[...new Set(run.reasons)].map((reason) => html`<p>${reasonLabel(reason)}</p>`)}</section>` : nothing}
      <footer>此面板不改写任务板或业务状态。工具结束 ≠ 任务成功，投递 ≠ 场景验收。</footer>
    </aside></div>`;
  }
  render() {
    const view = this.view();
    const filter =
      this.filter === "个人任务" ? "personal" : this.filter === "协作任务" ? "collaboration" : null;
    const runs = view.runs.filter((row) => !filter || row.scope === filter);
    return html`<div class="obs-workbench" id="observation-workbench" data-observation-source=${view.source}>
      <div class="obs-header"><div><span class="obs-eyebrow">${this.role === "platform" ? "OBSERVABILITY" : "SELF-EVOLUTION / OBSERVABILITY"}</span><h2>${this.role === "platform" ? "跨租户运行证据" : "从任务证据到进化验证"}</h2><p>${this.role === "platform" ? "不混淆一次成功调用与一项被验收的工作。" : "观测 → 诊断 → 候选与实验 → 效果与治理"}</p></div>
        <div class="obs-source"><span class="obs-source-label">数据源</span><select aria-label="观测数据源" @change=${(event: Event) => this.setSource((event.target as HTMLSelectElement).value)}><option value="live" ?selected=${view.source === "live"}>真实连接</option><option value="sample" ?selected=${view.source === "sample"}>样例验收</option></select></div></div>
      ${
        this.role === "enterprise" && this.targets.length
          ? html`<div class="obs-session"><label>当前会话 <select aria-label="观测目标" .value=${this.sessionKey ?? ""} @change=${(
              event: Event,
            ) => {
              this.sessionKey = (event.target as HTMLSelectElement).value || null;
              this.onSessionKey?.(this.sessionKey ?? "");
              this.selected = null;
            }}><option value="">选择当前企业目标</option>${this.targets.map((row) => html`<option value=${row.sessionKey}>${row.label} · ${row.kind === "group" ? "协作" : "个人"}</option>`)}</select></label><span>严格按 sessionKey 接收事件，不借用其他会话。</span></div>`
          : nothing
      }
      ${this.renderTabs()}
      ${this.surface === "overview" ? html`${this.renderCoverage(view)}${this.renderSummary(view, runs)}<div class="obs-live-note">${this.role === "platform" && view.source === "live" ? "暂无跨租户历史聚合查询能力；本平台不构造跨租户 session 事件。企业工作台按 sessionKey 读取原事件投影。" : ""}</div>` : this.surface === "analysis" ? this.renderAnalysis(view, runs) : this.renderGovernance(view)}
      ${this.selected ? this.renderEvidence(this.selected) : nothing}
    </div>`;
  }
}
