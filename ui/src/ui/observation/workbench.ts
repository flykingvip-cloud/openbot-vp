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
  type ObservationEnterpriseEntry,
  type ObservationRun,
  type ObservationView,
} from "./model.ts";
import { observationSamples, SAMPLE_ENTERPRISE_DIRECTORY } from "./samples.ts";
import { buildObservationStream, type ObservationStreamMetricKey } from "./stream.ts";

export type ObservationProps = {
  role: "platform" | "enterprise";
  tenantId: string | null;
  sessionKey: string | null;
  connected: boolean;
  basePath?: string;
  observationHost: object | null;
  targets?: readonly DiagnosisTargetOption[];
  onDiagnoseRun?: (input: { runId: string; sessionKey: string; agentId: string }) => void;
  onSessionKey?: (sessionKey: string) => void;
  enterpriseDirectory?: readonly ObservationEnterpriseEntry[];
};
export function renderObservationWorkbench(props: ObservationProps) {
  return html`<openbot-observation-workbench
    .role=${props.role} .tenantId=${props.tenantId} .sessionKey=${props.sessionKey}
    .observationHost=${props.observationHost ?? null}
    .connected=${props.connected} .onSessionKey=${props.onSessionKey ?? null} .basePath=${props.basePath ?? ""} .targets=${props.targets ?? []}
    .enterpriseDirectory=${props.enterpriseDirectory ?? []}
    .onDiagnoseRun=${props.onDiagnoseRun ?? null}
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
  @property({ attribute: false }) onDiagnoseRun:
    | ((input: { runId: string; sessionKey: string; agentId: string }) => void)
    | null = null;
  @property({ attribute: false }) enterpriseDirectory: readonly ObservationEnterpriseEntry[] = [];
  @state() private surface: "overview" | "analysis" | "governance" = "overview";
  @state() private analysis: "tasks" | "models" | "executors" | "capacity" = "tasks";
  @property({ type: String }) source: "live" | "sample" = "live";
  @property({ attribute: false }) observationHost: object | null = null;
  @state() private filter: (typeof OBSERVATION_TYPES)[number] = "全部";
  @state() private timeWindow: "7d" | "current" = "7d";
  @state() private tenantFilter: string = "all";
  @state() private selected: ObservationRun | null = null;
  @state() private tick = 0;
  @state() private paused = false;
  @state() private changeCount = 0;
  @state() private metricFilter = "all";
  @state() private expanded = false;
  private frozenView: ObservationView | null = null;
  private lastFingerprint = "";
  private pendingStreamUpdate = false;

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
  private liveRuns(view: ObservationView) {
    if (this.role === "platform" && this.tenantFilter !== "all" && view.source === "live") {
      return [];
    }
    return view.runs;
  }
  private updateStream(view: ObservationView) {
    const fingerprint = JSON.stringify([
      this.source,
      this.sessionKey,
      this.tenantFilter,
      this.liveRuns(view).map((r) => [r.id, r.eventCount, r.latencyMs, r.reasons]),
    ]);
    if (fingerprint !== this.lastFingerprint) {
      this.lastFingerprint = fingerprint;
      this.changeCount += 1;
      if (this.paused && this.frozenView) {
        this.pendingStreamUpdate = true;
      }
      if (!this.paused) {
        this.frozenView = null;
      }
    }
    return this.paused && this.frozenView ? this.frozenView : view;
  }

  private setSource(value: string) {
    if (value === "sample" || value === "live") {
      this.source = value;
      this.selected = null;
      this.tenantFilter = "all";
      this.paused = false;
      this.frozenView = null;
      this.pendingStreamUpdate = false;
      this.metricFilter = "all";
    }
  }
  private directoryEntries(view: ObservationView): readonly ObservationEnterpriseEntry[] {
    if (this.role !== "platform") {
      return [];
    }
    if (view.source === "sample") {
      return SAMPLE_ENTERPRISE_DIRECTORY;
    }
    return this.enterpriseDirectory;
  }
  private filteredDirectory(view: ObservationView): readonly ObservationEnterpriseEntry[] {
    const rows = this.directoryEntries(view);
    if (this.tenantFilter === "all") {
      return rows;
    }
    return rows.filter((row) => row.tenantId === this.tenantFilter);
  }
  private filteredRuns(view: ObservationView): ObservationRun[] {
    const scope =
      this.filter === "个人" ? "personal" : this.filter === "协作" ? "collaboration" : null;
    return view.runs.filter((row) => {
      if (scope && row.scope !== scope) {
        return false;
      }
      if (this.role !== "platform" || this.tenantFilter === "all") {
        return true;
      }
      // Live execution_only events have no tenant mapping on this host.
      if (view.source === "live") {
        return false;
      }
      return row.tenantId === this.tenantFilter;
    });
  }
  private formatUnknown(value: number | undefined, format: (n: number) => string) {
    return value === undefined ? "未知" : format(value);
  }
  private formatSnapshotAt(updatedAt: number | undefined) {
    if (updatedAt === undefined) {
      return "摘要时间未知";
    }
    return new Date(updatedAt).toLocaleString("zh-CN", { hour12: false });
  }
  private selectTenant(tenantId: string) {
    this.tenantFilter = tenantId;
    this.surface = "overview";
    this.selected = null;
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
  private renderFilters(view: ObservationView) {
    const directory = this.directoryEntries(view);
    const tenantLabel =
      this.tenantFilter === "all"
        ? view.source === "sample"
          ? "全部企业（样例）"
          : "全部企业"
        : (directory.find((row) => row.tenantId === this.tenantFilter)?.label ?? this.tenantFilter);
    const windowLabel = this.timeWindow === "7d" ? "近 7 天" : "当前连接窗口";
    const typeLabel = this.filter === "全部" ? "全部任务类型" : this.filter;
    if (this.role === "enterprise") {
      return html`<section class="obs-filters" aria-label="观测筛选">
        <label><span>工作形态</span><select aria-label="工作形态筛选" @change=${(event: Event) => {
          this.filter = (event.target as HTMLSelectElement).value as typeof this.filter;
          this.selected = null;
        }}>${OBSERVATION_TYPES.map((row) => html`<option value=${row} ?selected=${this.filter === row}>${row === "全部" ? "全部" : row}</option>`)}</select></label>
        <p class="obs-filters__context">筛选上下文：${typeLabel} · 当前企业</p>
      </section>`;
    }
    return html`<section class="obs-filters" aria-label="观测筛选">
      <label><span>时间窗</span><select aria-label="时间窗筛选" @change=${(event: Event) => {
        const value = (event.target as HTMLSelectElement).value;
        this.timeWindow = value === "current" ? "current" : "7d";
        this.selected = null;
      }}><option value="7d" ?selected=${this.timeWindow === "7d"}>近 7 天</option><option value="current" ?selected=${this.timeWindow === "current"}>当前连接窗口</option></select></label>
      <label><span>租户</span><select aria-label="租户筛选" @change=${(event: Event) => {
        this.tenantFilter = (event.target as HTMLSelectElement).value || "all";
        this.selected = null;
      }}><option value="all" ?selected=${this.tenantFilter === "all"}>${view.source === "sample" ? "全部企业（样例）" : "全部企业"}</option>${directory.map((row) => html`<option value=${row.tenantId} ?selected=${this.tenantFilter === row.tenantId}>${row.label}</option>`)}</select></label>
      <label><span>任务类型</span><select aria-label="任务类型筛选" @change=${(event: Event) => {
        this.filter = (event.target as HTMLSelectElement).value as typeof this.filter;
        this.selected = null;
      }}>${OBSERVATION_TYPES.map((row) => html`<option value=${row} ?selected=${this.filter === row}>${row === "全部" ? "全部任务类型" : row}</option>`)}</select></label>
      <p class="obs-filters__context">筛选上下文：${windowLabel} · ${tenantLabel} · ${typeLabel}</p>
    </section>`;
  }
  private renderTenantCompare(view: ObservationView) {
    if (this.role !== "platform") {
      return nothing;
    }
    const rows = this.filteredDirectory(view);
    const isSample = view.source === "sample";
    const isCurrent = this.timeWindow === "current";
    if (!rows.length) {
      return html`<section class="obs-tenant-compare" data-testid="obs-tenant-compare">
        <div class="obs-tenant-compare__head"><h3>企业状态比较</h3><p>${isSample ? "目录摘要未供给 · 事件样例仅供验收" : "授权企业目录为空 · 不抽样假状态"}</p></div>
        <div class="obs-empty obs-tenant-empty"><strong>${isSample ? "样例企业未启用" : "暂无企业目录摘要"}</strong><p>${isSample ? "切换到样例验收后应出现明确标注的样例企业。" : "近 7 天跨租户视图依赖目录摘要，不是事件回放。"}</p></div>
      </section>`;
    }
    return html`<section class="obs-tenant-compare" data-testid="obs-tenant-compare">
      <div class="obs-tenant-compare__head">
        <h3>企业状态比较</h3>
        <p>${isSample ? "样例目录 · 仅供交互验收，非生产健康" : isCurrent ? "目录健康参考 · 非本次运行事件；当前连接事件未映射租户" : "目录摘要 · 近 7 天聚合快照，非事件回放"}</p>
      </div>
      <div class="obs-tenant-grid">${rows.map((entry) => this.renderTenantCard(entry, view))}</div>
    </section>`;
  }
  private renderTenantCard(entry: ObservationEnterpriseEntry, view: ObservationView) {
    const tone = entry.healthSummary?.tone ?? "neutral";
    const healthLabel = entry.healthSummary?.label ?? "未发现实体健康标签";
    const isCurrent = this.timeWindow === "current";
    const calls = this.formatUnknown(entry.usageSummary?.calls7d, (n) => String(n));
    const cost = this.formatUnknown(entry.usageSummary?.cost7d, (n) => n.toFixed(2));
    const success = this.formatUnknown(
      entry.healthSummary?.successRate,
      (n) => `${Math.round(n * 1000) / 10}%`,
    );
    const successDisplay = isCurrent ? "—" : success;
    const stamp = this.formatSnapshotAt(
      entry.usageSummary?.updatedAt ?? entry.healthSummary?.updatedAt,
    );
    return html`<button type="button" class="obs-tenant-card" data-tenant-id=${entry.tenantId} @click=${() => this.selectTenant(entry.tenantId)}>
      <div class="obs-tenant-card__top">
        <div><strong>${entry.label}</strong><code>${entry.tenantId}</code></div>
        <span class="obs-status is-${tone === "ok" ? "ok" : tone === "warn" || tone === "danger" ? "partial" : "neutral"}">${healthLabel}</span>
      </div>
      <div class="obs-tenant-card__meta">
        <span>状态 ${entry.status}</span>
        ${entry.plan ? html`<span>${entry.plan}</span>` : nothing}
        ${
          view.source === "sample"
            ? html`
                <span class="obs-status is-partial">样例</span>
              `
            : nothing
        }
      </div>
      <div class="obs-tenant-card__stats">
        <div><span>${isCurrent ? "目录调用参考" : "近 7 天调用"}</span><strong>${isCurrent ? "—" : calls}</strong></div>
        <div><span>${isCurrent ? "目录成本参考" : "近 7 天成本"}</span><strong>${isCurrent ? "—" : cost}</strong></div>
        <div><span>${isCurrent ? "成功率（非当前事件）" : "成功率"}</span><strong>${successDisplay}</strong></div>
      </div>
      <small>${isCurrent ? "目录健康参考 · 非本次运行事件" : `摘要时间 ${stamp}`} · 点击定位运行与改善</small>
    </button>`;
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
  private renderPulse(view: ObservationView, runs: readonly ObservationRun[]) {
    const unmapped = this.role === "platform" && this.tenantFilter !== "all";
    const stream = buildObservationStream({
      connected: view.connected,
      snapshot:
        this.source === "live" && !unmapped
          ? readRuntimeObservations(this.observationHost ?? {}, this.sessionKey ?? "")
          : null,
      sessionKey: view.sessionKey,
    });
    const samples = [
      {
        key: "active_runs",
        label: "活跃运行",
        value: runs.filter((row) => row.toolState === "running" || row.toolState === "waiting")
          .length,
        unit: "项",
        series: [1, 2, 1],
        note: "样例运行状态",
      },
      {
        key: "event_receive_rate",
        label: "元数据事件",
        value: runs.reduce((n, row) => n + row.eventCount, 0),
        unit: "条",
        series: [17, 22, 39],
        note: "样例窗口 · 非生产实时",
      },
      {
        key: "latency_p95",
        label: "已关联时延 P95",
        value: Math.max(0, ...runs.map((row) => row.latencyMs ?? 0)) / 1000,
        unit: "秒",
        series: [1.6, 4.2, 3.1],
        note: "样例生命周期",
      },
      {
        key: "sequence_or_link_gaps",
        label: "证据缺口",
        value: runs.filter((row) => row.reasons.length).length,
        unit: "项",
        series: [1, 2, 3],
        note: "点击查看对应运行",
      },
      {
        key: "business_acceptance",
        label: "业务验收",
        value:
          this.role === "enterprise"
            ? runs.filter((row) => row.outcomeState === "accepted").length
            : null,
        unit: "项",
        series: [0, 0, 1],
        note: this.role === "enterprise" ? "样例回验关联" : "平台样例未授权业务终态",
      },
      {
        key: "attributed_cost",
        label: "可归属成本",
        value: null,
        unit: "",
        series: [],
        note: "没有真实 request usage，不填零",
      },
    ];
    const rows =
      this.source === "sample"
        ? samples
        : stream.metrics.map((row) => ({
            ...row,
            unit: row.unit === "ms" ? "ms" : (row.unit ?? ""),
          }));
    return html`<section class="obs-realtime" aria-label="实时观测脉冲">
      <header class="obs-realtime-head"><div><span class="obs-live-dot"></span><h3>动态观测</h3><span>${this.source === "sample" ? "明确标注的静态验收样例" : stream.scope}</span></div>
        <div><span class="obs-update">${view.receivedAt ? `最后事件 ${new Date(view.receivedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "尚无真实事件"}</span><button type="button" data-action="pause" class="obs-pause" @click=${() => {
          if (!this.paused) {
            this.frozenView = view;
            this.paused = true;
            this.pendingStreamUpdate = false;
          } else {
            this.paused = false;
            this.frozenView = null;
            this.pendingStreamUpdate = false;
          }
        }}>${this.paused ? "继续观测" : "暂停观测"}</button></div></header>
      <div class="obs-pulse-grid">${rows.map((row) => this.renderMetric(row))}</div>
      <footer class="obs-stream-foot"><span>${this.source === "live" ? "新到达元数据驱动更新；不读取消息或工具载荷。等待真实事件后建立本次连接窗口" : "样例仅串联交互，不代表真实指标或生产改善"}</span><span>${this.paused ? (this.pendingStreamUpdate ? "已冻结展示 · 后台已收到更新；继续后显示；任务仍在运行" : "已冻结展示 · 任务仍在运行") : this.changeCount > 1 ? `本页观察到 ${this.changeCount - 1} 次数据变化` : "等待第一次事件"}</span></footer>
    </section>`;
  }

  private renderMetric(row: {
    key: string;
    label: string;
    value: number | null;
    unit: string;
    note: string;
    display?: string;
    unit?: string | null;
    series?: readonly { at: number; value: number | null }[] | readonly number[];
  }) {
    const raw = row.series ?? [];
    const numbers = raw
      .map((point) => (typeof point === "number" ? point : point.value))
      .filter((v): v is number => typeof v === "number");
    const max = Math.max(...numbers, 1);
    const points = numbers
      .map((v, i) => `${(i / Math.max(numbers.length - 1, 1)) * 148 + 4},${36 - (v / max) * 28}`)
      .join(" ");
    const display =
      row.display ?? (row.value === null ? "未知" : `${Math.round(row.value * 10) / 10}`);
    return html`<button type="button" class="obs-pulse-card ${this.metricFilter === row.key ? "is-selected" : ""}" data-metric=${row.key} @click=${() => this.drillMetric(row.key as ObservationStreamMetricKey)}>
      <span>${row.label}</span><strong>${display}<small>${row.unit ?? ""}</small></strong>
      ${
        points
          ? html`<svg class="obs-sparkline" viewBox="0 0 156 44" role="img" aria-label=${`${row.label}的实际接收窗口趋势`}> <polyline points=${points}></polyline></svg>`
          : html`
              <div class="obs-no-trend">无真实关联时序 · —</div>
            `
      }
      <small>${row.note}</small></button>`;
  }

  private drillMetric(key: ObservationStreamMetricKey) {
    this.metricFilter = key;
    this.expanded = false;
    if (key === "sequence_or_link_gaps") {
      this.selected =
        this.filteredRuns(this.updateStream(this.view())).find((row) => row.reasons.length) ?? null;
    } else if (key === "active_runs") {
      this.selected =
        this.filteredRuns(this.updateStream(this.view())).find(
          (row) => row.toolState === "running" || row.toolState === "waiting",
        ) ?? null;
    } else if (key === "business_acceptance" && this.role === "enterprise") {
      this.selected =
        this.filteredRuns(this.updateStream(this.view())).find(
          (row) => row.outcomeState === "accepted",
        ) ?? null;
    }
  }

  private renderLoop(
    view: ObservationView,
    runs: readonly ObservationRun[],
    selected: ObservationRun | undefined,
  ) {
    const shownRuns =
      this.metricFilter === "sequence_or_link_gaps"
        ? runs.filter((row) => row.reasons.length)
        : this.metricFilter === "active_runs"
          ? runs.filter((row) => row.toolState === "running" || row.toolState === "waiting")
          : this.metricFilter === "tool_calls" ||
              this.metricFilter === "event_receive_rate" ||
              this.metricFilter === "latency_p95" ||
              this.metricFilter === "latency_p50"
            ? runs
            : this.metricFilter === "business_acceptance"
              ? runs.filter((row) => row.outcomeState === "accepted")
              : this.metricFilter === "run_completion_rate"
                ? runs.filter((row) => row.latencyMs !== null)
                : this.metricFilter === "attributed_cost"
                  ? []
                  : runs;
    return html`<section class="obs-loop">
      <div class="obs-loop-runs"><header class="obs-section-head"><div><h3>${this.metricFilter === "sequence_or_link_gaps" ? "需要核实的事件" : "运行与改善对象"}</h3><p>点击一项，沿同一身份核实、诊断与回验。</p></div>${
        this.metricFilter !== "all"
          ? html`<button type="button" @click=${() => {
              this.metricFilter = "all";
              this.selected = null;
            }}>清除指标筛选</button>`
          : nothing
      }</header>
        ${
          shownRuns.length
            ? shownRuns.map(
                (row) =>
                  html`<button type="button" class="obs-run ${selected?.id === row.id ? "is-selected" : ""}" data-run-id=${row.id} @click=${() => {
                    this.selected = row;
                    this.expanded = true;
                  }}><span><strong>${row.label}</strong><code>${row.clientRunId ?? "clientRunId 未知"}${row.sourceRunId ? ` → ${row.sourceRunId}` : ""}</code><small>${row.latencyMs === null ? "时延未知" : `${(row.latencyMs / 1000).toFixed(1)} 秒`} · ${row.eventCount} 条元数据</small></span><span class="obs-status ${row.reasons.length ? "is-partial" : "is-ok"}">${row.reasons.length ? "待核实" : "已观测"}</span></button>`,
              )
            : html`<div class="obs-empty"><strong>${this.metricFilter === "attributed_cost" ? "当前没有可归属成本" : this.role === "platform" && this.tenantFilter !== "all" && view.source === "live" ? "所选企业暂无已映射运行事件" : runs.length === 0 && this.metricFilter === "all" ? "当前会话还没有观测事件" : "当前筛选没有运行"}</strong><p>${this.metricFilter === "attributed_cost" ? "周期账单不能摊到未关联的运行。" : "没有严格匹配的事件时，不借用其他会话数据。"}</p></div>`
        }
      </div>
      <div class="obs-loop-detail">${selected ? this.renderImprovement(view, selected) : this.renderLoopIntro(view)}</div>
    </section>`;
  }

  private renderLoopIntro(view: ObservationView) {
    return html`<div class="obs-loop-intro"><span class="obs-eyebrow">IMPROVEMENT CONTEXT</span><h3>从一条偏离开始，而不是从一张报表结束</h3><p>${view.source === "sample" ? "选择一个样例运行，查看同一证据如何串起诊断、实验和回验。" : "选择一次运行；在新事件到达时，指标与运行证据一起更新，已选身份不被其他会话替换。"}</p>
      <ol><li class="active"><span>01</span><div><strong>观测异常</strong><small>当前值、实际趋势、关联运行</small></div></li><li><span>02</span><div><strong>证据诊断</strong><small>确认事实与缺失，不猜根因</small></div></li><li><span>03</span><div><strong>改善实验</strong><small>候选、授权与配置分开回执</small></div></li><li><span>04</span><div><strong>业务回验</strong><small>同任务口径重新接入结果证据</small></div></li></ol></div>`;
  }

  private renderImprovement(view: ObservationView, run: ObservationRun) {
    const target = this.targets.find((row) => row.sessionKey === this.sessionKey);
    return html`<article class="obs-improvement" data-testid="obs-improvement">
      <header><div><span class="obs-eyebrow">同一改善对象 · ${run.tenantLabel ?? "当前会话"}</span><h3>${run.label}</h3><code>${run.clientRunId}${run.sourceRunId ? ` → ${run.sourceRunId}` : ""}</code></div><button type="button" class="obs-link" @click=${() => {
        this.expanded = true;
      }}>完整运行证据</button></header>
      <ol class="obs-loop-steps"><li class="is-done"><span>01</span><strong>偏离已发现</strong><small>${run.reasons.length ? `${run.reasons.length} 类证据需核实` : "收到执行元数据"}</small></li><li><span>02</span><strong>诊断与根因</strong><small>${target ? "可携带本次 runId 做针对性诊断" : "平台当前未映射租户；请从原诊断页核验企业目标"}</small></li><li><span>03</span><strong>实验与授权</strong><small>候选来自诊断；不默认创建或下发</small></li><li><span>04</span><strong>同口径回验</strong><small>${run.outcomeState === "accepted" ? "有业务验收关联；仍可对比改善前后" : "尚缺业务验收，工具完成不算改善有效"}</small></li></ol>
      ${run.reasons.length ? html`<div class="obs-deviation"><strong>本次先核实</strong><p>${[...new Set(run.reasons)].slice(0, 3).map(reasonLabel).join("；")}</p></div>` : nothing}
      <div class="obs-loop-actions">${target && view.source === "live" && run.clientRunId && this.onDiagnoseRun ? html`<button type="button" class="obs-primary" @click=${() => this.onDiagnoseRun?.({ runId: run.clientRunId!, sessionKey: target.sessionKey, agentId: target.agentId })}>诊断这次运行</button>` : html`<a class="obs-primary" href=${this.role === "platform" ? pathForTab("platformDiagnosis", this.basePath) : "#original-diagnosis"}>${target ? "进入针对性诊断" : "进入原诊断并选择目标"}</a>`}<a href=${this.role === "platform" ? pathForTab("platformAdvanced", this.basePath) : pathForTab("enterpriseCapabilityCenter", this.basePath, { tenantId: this.tenantId })}>进入实验与治理</a></div>
      <p class="obs-loop-boundary">诊断产生候选后才进入实验；批准、实际配置与效果验证分别记录，当前面板不自动执行改善。</p>
    </article>`;
  }

  private renderAnalysis(view: ObservationView, runs: readonly ObservationRun[]) {
    const unmappedLive =
      this.role === "platform" && view.source === "live" && this.tenantFilter !== "all";
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
      <div class="obs-toolbar"><span>${this.role === "platform" ? (view.source === "live" ? "当前只读事件未映射租户 · sessionKey 无企业标签" : "样例企业已标记 · 可按租户下钻") : "当前企业 · 个人与共享终态分开"}</span></div>
      <div class="obs-run-list">${
        runs.length
          ? runs.map(
              (
                row,
              ) => html`<button class="obs-run" type="button" data-run-id=${row.id} @click=${() => {
                this.selected = row;
                this.expanded = true;
              }}>
        <span><strong>${row.label}</strong><code>${row.clientRunId ?? "clientRunId 未知"}${row.sourceRunId ? ` → ${row.sourceRunId}` : ""}${row.tenantLabel ? ` · ${row.tenantLabel}` : view.source === "live" && this.role === "platform" ? " · 未映射" : ""}</code></span>
        <span class="obs-run__state"><span>${row.scope === "personal" ? "个人" : row.scope === "collaboration" ? "协作" : "场景未知"}</span><span class="obs-status ${row.reasons.length ? "is-partial" : "is-ok"}">${row.reasons.length ? "证据不完整" : "元数据已接收"}</span></span>
      </button>`,
            )
          : html`
              <div class="obs-empty">
                <strong>${unmappedLive ? "所选企业暂无已映射运行事件" : "当前会话还没有观测事件"}</strong>
                <p>${unmappedLive ? "execution_only 投影不含租户标签，不能把本机事件算到某个企业。" : "没有严格匹配的事件时不借用其他会话数据。请发起一个对话，或切换到明确标注的验收样例。"}</p>
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
      this.expanded = false;
    }}><aside class="obs-drawer" role="dialog" aria-modal="true" aria-label="运行证据" @click=${(event: Event) => event.stopPropagation()}>
      <header><div><span class="obs-status ${run.sample ? "is-partial" : "is-ok"}">${run.sample ? "样例证据" : "实时元数据"}</span><h2>${run.label}</h2></div><button type="button" aria-label="关闭证据" @click=${() => {
        this.expanded = false;
      }}>×</button></header>
      <section class="obs-evidence"><h3>只读证据</h3><dl>${[
        ["clientRunId", run.clientRunId],
        ["sourceRunId（引擎运行）", run.sourceRunId],
        ["租户", run.tenantLabel ?? (run.sample ? null : "未映射")],
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
  private renderEventScopeNote(view: ObservationView) {
    if (
      view.source === "sample" ||
      !this.enterpriseDirectory.length ||
      this.timeWindow === "current"
    ) {
      return nothing;
    }
    return html`
      <p class="obs-event-scope">
        下方运行证据仍是当前连接窗口的只读事件；时间窗只作用于上方企业目录摘要，不筛选本地事件历史。
      </p>
    `;
  }

  private liveNote(view: ObservationView) {
    if (this.role !== "platform" || view.source !== "live") {
      return "";
    }
    if (this.timeWindow === "7d") {
      return this.enterpriseDirectory.length
        ? "近 7 天跨租户视图来自企业目录摘要，不是事件回放；本机 execution_only 事件未映射租户。"
        : "暂无跨租户历史聚合查询能力；本平台不构造跨租户 session 事件。企业工作台按 sessionKey 读取原事件投影。";
    }
    return "当前连接窗口只读本机事件投影，不能标成 24 小时或近 7 天；目录健康仅作参考。";
  }
  render() {
    const view = this.updateStream(this.view());
    const runs = this.filteredRuns(view);
    // Re-resolve from the current authorized projection, never a stale drawer snapshot.
    const selected = this.selected
      ? runs.find((row) => row.id === this.selected?.id && row.sample === this.selected.sample)
      : undefined;
    return html`<div class="obs-workbench" id="observation-workbench" data-observation-source=${view.source} data-time-window=${this.role === "platform" ? this.timeWindow : "enterprise"} data-tenant-filter=${this.tenantFilter}>
      <div class="obs-header"><div><span class="obs-eyebrow">${this.role === "platform" ? "OBSERVABILITY" : "SELF-EVOLUTION / OBSERVABILITY"}</span><h2>${this.role === "platform" ? "实时运行与改善" : "任务质量进化中心"}</h2><p>${this.role === "platform" ? "不混淆一次成功调用与一项被验收的工作。" : "观测 → 诊断 → 候选与实验 → 效果与治理"}</p></div>
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
      ${this.renderFilters(view)}
      ${this.renderEventScopeNote(view)}
      ${this.renderPulse(view, this.liveRuns(view))}
      ${this.surface === "overview" ? html`${this.renderTenantCompare(view)}${this.renderCoverage(view)}${this.renderLoop(view, runs, selected)}<div class="obs-live-note">${this.liveNote(view)}</div>` : this.surface === "analysis" ? this.renderAnalysis(view, runs) : this.renderGovernance(view)}
      ${selected && this.expanded ? this.renderEvidence(selected) : nothing}
    </div>`;
  }
}
