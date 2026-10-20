/**
 * employee-supervisor-center.ts — Employee settings surface for supervised dev tasks.
 * Phase-1 IA: A header readiness + B1/B2/B3 bands (Orca-inspired remodel).
 */

import { html, nothing } from "lit";
import { LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import "../../../supervisor/supervisor-task-board.ts";
import "../../../supervisor/cli-credential-self-panel.ts";
import "../../../supervisor/supervisor-seat-node-panel.ts";
import {
  groupSetupReadinessBands,
  loadSupervisorSetupReadiness,
  resolveSupervisorHeaderReadiness,
  summarizeSetupReadiness,
  SUPERVISOR_SETUP_CHANGED,
  type SupervisorSetupBand,
  type SupervisorSetupReadinessRow,
} from "../../../supervisor/supervisor-setup-readiness.ts";

export { SUPERVISOR_SETUP_CHANGED };

export type EmployeeSupervisorPendingSeatOffer = {
  offerId: string;
  seatTitle: string;
};

export type EmployeeSupervisorCenterProps = {
  client: GatewayBrowserClient | null;
  tenantId?: string;
  tenantLabel?: string;
  userId?: string;
  seatId?: string;
  seatTitle?: string;
  canCreateTasks?: boolean;
  defaultRepoRoot?: string;
  pendingSeatOffer?: EmployeeSupervisorPendingSeatOffer | null;
  pendingSeatOfferBusy?: boolean;
  initialTaskId?: string;
  onAcceptPendingSeatOffer?: (offerId: string) => void | Promise<void>;
  onOpenPersonalSettings?: () => void;
  onOpenDaibaiForDevTask?: () => void | Promise<void>;
};

@customElement("employee-supervisor-center")
export class EmployeeSupervisorCenter extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) supervisorProps: EmployeeSupervisorCenterProps | null = null;
  @state() private setupOpen = false;
  @state() private setupRows: SupervisorSetupReadinessRow[] = [];
  @state() private setupLoading = false;
  @state() private setupError: string | null = null;
  @state() private composerRequested = false;
  /** Selected / default worker from task board — drives header 可监督 judgment. */
  @state() private selectedWorkerBackendId = "";
  /** First worker from supervisor.worker.list when board has not emitted yet. */
  @state() private defaultWorkerBackendId = "";

  private setupLoadedOnce = false;
  private setupAutoExpanded = false;
  private setupRefreshKey = "";

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener(SUPERVISOR_SETUP_CHANGED, this.onSetupChanged);
    void this.refreshSetupReadiness();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener(SUPERVISOR_SETUP_CHANGED, this.onSetupChanged);
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("supervisorProps")) {
      void this.refreshSetupReadiness();
    }
  }

  private onSetupChanged = () => {
    void this.refreshSetupReadiness({ force: true });
  };

  private async refreshSetupReadiness(opts?: { force?: boolean }) {
    const props = this.supervisorProps;
    const tenantId = props?.tenantId?.trim() ?? "";
    if (!props?.client || !tenantId) {
      this.setupRows = [];
      return;
    }
    const refreshKey = `${tenantId}:${props.seatId ?? ""}`;
    if (!opts?.force && this.setupLoadedOnce && refreshKey === this.setupRefreshKey) {
      return;
    }
    this.setupRefreshKey = refreshKey;
    this.setupLoading = true;
    this.setupError = null;
    try {
      const [rows, workerList] = await Promise.all([
        loadSupervisorSetupReadiness(props.client, {
          tenantId,
          seatId: props.seatId,
        }),
        props.client
          .request<{ workers?: Array<{ backendId?: string }> }>("supervisor.worker.list", {})
          .catch(() => ({ workers: [] as Array<{ backendId?: string }> })),
      ]);
      this.setupRows = rows;
      const firstWorker = workerList.workers?.find((w) => w.backendId?.trim())?.backendId?.trim();
      this.defaultWorkerBackendId = firstWorker ?? "";
      this.setupLoadedOnce = true;
      const summary = summarizeSetupReadiness(rows);
      if (!this.setupAutoExpanded && !summary.allReady) {
        this.setupOpen = true;
        this.setupAutoExpanded = true;
      }
    } catch (err) {
      this.setupError = err instanceof Error ? err.message : String(err);
    } finally {
      this.setupLoading = false;
    }
  }

  private scrollToGap(gapId: string) {
    this.setupOpen = true;
    const anchor =
      gapId === "node-bound" || gapId === "node-online"
        ? "employee-supervisor-node-setup"
        : gapId.startsWith("api-key-")
          ? "employee-supervisor-api-key-setup"
          : "employee-supervisor-b1";
    requestAnimationFrame(() => {
      const target = this.querySelector(`#${anchor}`);
      if (target && typeof (target as HTMLElement).scrollIntoView === "function") {
        (target as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
      }
      const row = this.querySelector(`[data-setup-check-id="${gapId}"]`);
      row?.classList.add("is-highlight");
      window.setTimeout(() => row?.classList.remove("is-highlight"), 2400);
    });
  }

  private effectiveWorkerBackendId(): string {
    return (this.selectedWorkerBackendId || this.defaultWorkerBackendId).trim();
  }

  private headerReadiness() {
    return resolveSupervisorHeaderReadiness(this.setupRows, {
      selectedWorkerId: this.effectiveWorkerBackendId() || null,
    });
  }

  private onHeaderCta() {
    const header = this.headerReadiness();
    if (header.mode === "ready") {
      this.composerRequested = true;
      requestAnimationFrame(() => {
        const board = this.querySelector("supervisor-task-board");
        if (board && typeof (board as HTMLElement).scrollIntoView === "function") {
          (board as HTMLElement).scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      return;
    }
    if (header.mode === "disabled") {
      this.setupOpen = true;
      this.scrollToGap("supervisor-enabled");
      return;
    }
    // draft-only / not ready: never open create that will fail — guide to gap.
    this.composerRequested = false;
    this.scrollToGap(header.primaryGapId);
  }

  private renderHeaderReadiness(canCreate: boolean) {
    if (this.setupLoading && this.setupRows.length === 0) {
      return html`
        <header class="employee-supervisor-center__readiness-header is-pending">
          <div class="employee-supervisor-center__readiness-copy">
            <div class="employee-supervisor-center__section-label">监督就绪总控</div>
            <div class="employee-supervisor-center__readiness-title">检查中…</div>
          </div>
        </header>
      `;
    }
    const header = this.headerReadiness();
    const tone =
      header.mode === "ready" ? "is-ok" : header.mode === "disabled" ? "is-danger" : "is-pending";
    const ctaDisabled = header.mode === "ready" && !canCreate;
    return html`
      <header class="employee-supervisor-center__readiness-header ${tone}" data-readiness-mode=${header.mode}>
        <div class="employee-supervisor-center__readiness-copy">
          <div class="employee-supervisor-center__section-label">监督就绪总控</div>
          <div class="employee-supervisor-center__readiness-title">${header.label}</div>
          <p class="employee-supervisor-center__muted">
            ${
              header.mode === "ready"
                ? "当前默认执行链已就绪，可创建监督任务；验收仍以机检 ValidationReport.passed 为准。"
                : header.mode === "disabled"
                  ? "请启用 gateway.supervisor / OPENBOT_SUPERVISOR_ENABLED 后刷新。"
                  : "控制面已开，但执行链未齐。可先完善 Node/登录/Key，勿直接创建会立刻升级的任务。"
            }
          </p>
        </div>
        <div class="employee-supervisor-center__readiness-actions">
          <button
            type="button"
            class="btn btn--primary"
            data-testid="supervisor-header-cta"
            ?disabled=${ctaDisabled}
            @click=${() => this.onHeaderCta()}
          >
            ${header.cta.label}
          </button>
          <button
            type="button"
            class="btn btn--sm btn--ghost"
            ?disabled=${this.setupLoading}
            @click=${() => void this.refreshSetupReadiness({ force: true })}
          >
            ${this.setupLoading ? "刷新中…" : "刷新就绪"}
          </button>
        </div>
      </header>
    `;
  }

  private renderBandRows(band: SupervisorSetupBand) {
    if (band.rows.length === 0) {
      return html`
        <p class="employee-supervisor-center__muted">暂无检查项。</p>
      `;
    }
    return html`
      <ul class="employee-supervisor-center__band-list">
        ${band.rows.map(
          (row) => html`
            <li
              class="employee-supervisor-center__band-row ${row.ready ? "is-ready" : "is-pending"}"
              data-setup-check-id=${row.id}
            >
              <span class="employee-supervisor-center__setup-status ${row.ready ? "tone-ok" : "tone-warn"}">
                <span class="employee-supervisor-center__status-dot"></span>
                ${row.status}
              </span>
              <div class="employee-supervisor-center__band-copy">
                <div class="employee-supervisor-center__band-check">${row.check}</div>
                <div class="employee-supervisor-center__band-detail">${row.detail}</div>
              </div>
            </li>
          `,
        )}
      </ul>
    `;
  }

  private renderB1() {
    const bands = groupSetupReadinessBands(this.setupRows);
    const summary = summarizeSetupReadiness(this.setupRows);
    const summaryLabel =
      this.setupLoading && this.setupRows.length === 0
        ? "检查中…"
        : summary.total > 0
          ? `${summary.ready} / ${summary.total} 就绪`
          : "—";
    return html`
      <section class="employee-supervisor-center__band employee-supervisor-center__band--b1" id="employee-supervisor-b1">
        <header class="employee-supervisor-center__band-head">
          <div>
            <div class="employee-supervisor-center__section-label">B1 · 执行链就绪</div>
            <div class="employee-supervisor-center__band-title">能否派 Worker</div>
          </div>
          <span class="employee-supervisor-center__tasks-count">${summaryLabel}</span>
        </header>
        ${
          this.setupError
            ? html`<div class="employee-supervisor-center__banner is-error">${this.setupError}</div>`
            : nothing
        }
        <div class="employee-supervisor-center__band-groups">
          ${bands.map(
            (band) => html`
              <div class="employee-supervisor-center__band-group" data-band-id=${band.id}>
                <div class="employee-supervisor-center__band-group-title">${band.title}</div>
                ${this.renderBandRows(band)}
              </div>
            `,
          )}
        </div>
        <details
          class="employee-supervisor-center__setup"
          ?open=${this.setupOpen}
          @toggle=${(e: Event) => {
            this.setupOpen = (e.currentTarget as HTMLDetailsElement).open;
          }}
        >
          <summary class="employee-supervisor-center__setup-summary">
            <span class="employee-supervisor-center__section-label">执行链动作</span>
          </summary>
          <div class="employee-supervisor-center__setup-body">
            ${
              this.supervisorProps?.seatId?.trim()
                ? html`
                    <div class="employee-supervisor-center__setup-block" id="employee-supervisor-node-setup">
                      <div class="employee-supervisor-center__section-label">本机 Node</div>
                      <supervisor-seat-node-panel
                        variant="standalone"
                        .client=${this.supervisorProps.client ?? null}
                        .tenantId=${this.supervisorProps.tenantId ?? ""}
                        .tenantLabel=${this.supervisorProps.tenantLabel ?? ""}
                        .seatId=${this.supervisorProps.seatId ?? ""}
                        .seatLabel=${this.supervisorProps.seatTitle ?? ""}
                        .userId=${this.supervisorProps.userId ?? ""}
                        .editable=${false}
                      ></supervisor-seat-node-panel>
                    </div>
                  `
                : nothing
            }
            <div class="employee-supervisor-center__setup-block" id="employee-supervisor-api-key-setup">
              <div class="employee-supervisor-center__section-label">配置 API KEY</div>
              <cli-credential-self-panel
                variant="employee"
                .hideTitle=${true}
                .compact=${true}
                .client=${this.supervisorProps?.client ?? null}
              ></cli-credential-self-panel>
            </div>
          </div>
        </details>
      </section>
    `;
  }

  private renderB3() {
    return html`
      <section
        class="employee-supervisor-center__band employee-supervisor-center__band--b3"
        id="employee-supervisor-b3"
      >
        <header class="employee-supervisor-center__band-head">
          <div>
            <div class="employee-supervisor-center__section-label">B3 · 验收与治理</div>
            <div class="employee-supervisor-center__band-title">凭什么算完</div>
          </div>
        </header>
        <ul class="employee-supervisor-center__governance-list">
          <li>
            <strong>验收权</strong>
            仅 <span class="mono">ValidationReport.passed</span> → accepted；Worker 自报不算完成。
          </li>
          <li>
            <strong>有界自治</strong>
            迭代 / 预算 / 无进展 / 时长触及即 escalate，禁止静默无限修。
          </li>
          <li>
            <strong>双拓扑</strong>
            Gateway（企业 Key）与 Node（本机 IDE）正交；Node 不可用时 local_ide
            <em>不</em>静默 fallback Gateway。
          </li>
          <li>
            <strong>创建必填</strong>
            AcceptanceCriteria 首屏可见；后端拒绝空 criteria。
          </li>
        </ul>
        <p class="employee-supervisor-center__muted">
          选中任务后，详情区会只读回显该任务的 AcceptanceCriteria 与预算上限。
        </p>
      </section>
    `;
  }

  render() {
    const props = this.supervisorProps;
    const tenantId = props?.tenantId ?? "";
    const seatId = props?.seatId?.trim() ?? "";
    const hasActiveSeat = Boolean(tenantId && seatId);
    const canCreate = props?.canCreateTasks ?? false;
    const header = this.headerReadiness();
    // P0-4: not-ready must NOT open create that will fail — only allow when chain ready.
    const allowCreate = canCreate && hasActiveSeat && header.mode === "ready";

    return html`
      <div class="employee-supervisor-center">
        ${
          hasActiveSeat
            ? nothing
            : html`
                <div class="employee-supervisor-center__banner is-warn">
                  ${
                    props?.pendingSeatOffer
                      ? html`
                          <div>
                            待确认岗位「${props.pendingSeatOffer.seatTitle}」。确认后才能绑定本机
                            Node，并完成 CLI 检测。
                          </div>
                          <div class="employee-supervisor-center__banner-actions">
                            <button
                              type="button"
                              class="btn btn--primary"
                              ?disabled=${props.pendingSeatOfferBusy}
                              @click=${() =>
                                void props.onAcceptPendingSeatOffer?.(
                                  props.pendingSeatOffer!.offerId,
                                )}
                            >
                              ${props.pendingSeatOfferBusy ? "确认中…" : "确认岗位"}
                            </button>
                            <button
                              type="button"
                              class="btn"
                              @click=${() => props.onOpenPersonalSettings?.()}
                            >
                              打开个人设置
                            </button>
                          </div>
                        `
                      : html`
                          <div>
                            尚未生效企业岗位。请先在个人设置确认岗位，再绑定本机 Node 与 CLI。
                          </div>
                          ${
                            props?.onOpenPersonalSettings
                              ? html`
                                  <div class="employee-supervisor-center__banner-actions">
                                    <button
                                      type="button"
                                      class="btn btn--primary"
                                      @click=${() => props.onOpenPersonalSettings?.()}
                                    >
                                      去确认岗位
                                    </button>
                                  </div>
                                `
                              : nothing
                          }
                        `
                  }
                </div>
              `
        }
        ${
          !canCreate
            ? html`
                <div class="employee-supervisor-center__banner is-warn">
                  无创建权限（需 operator.write）。请联系管理员开通。
                </div>
              `
            : nothing
        }
        ${tenantId ? this.renderHeaderReadiness(canCreate) : nothing}
        ${
          tenantId
            ? html`
                <div class="employee-supervisor-center__bands">
                  ${this.renderB1()}
                  <section class="employee-supervisor-center__band employee-supervisor-center__band--b2">
                    <header class="employee-supervisor-center__band-head">
                      <div>
                        <div class="employee-supervisor-center__section-label">B2 · 今日监督队列</div>
                        <div class="employee-supervisor-center__band-title">在跑什么</div>
                      </div>
                    </header>
                    <p class="employee-supervisor-center__muted">
                      下方任务板仅展示活跃态与 Needs You；终态见「历史」。进度为「第 i/max 轮」或「已用 N 轮 · 上限 max」。
                    </p>
                  </section>
                  ${this.renderB3()}
                </div>
              `
            : nothing
        }
        <supervisor-task-board
          .client=${props?.client ?? null}
          .tenantId=${tenantId}
          .userId=${props?.userId ?? ""}
          .seatId=${props?.seatId ?? ""}
          .showCreateForm=${allowCreate}
          .defaultRepoRoot=${props?.defaultRepoRoot ?? ""}
          .initialTaskId=${props?.initialTaskId ?? ""}
          .onOpenDaibaiForDevTask=${props?.onOpenDaibaiForDevTask ?? null}
          title="开发监督"
          @supervisor-worker-change=${(e: Event) => {
            const detail = (e as CustomEvent<{ workerBackendId?: string }>).detail;
            const next = detail?.workerBackendId?.trim() ?? "";
            if (next && next !== this.selectedWorkerBackendId) {
              this.selectedWorkerBackendId = next;
            }
          }}
        ></supervisor-task-board>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "employee-supervisor-center": EmployeeSupervisorCenter;
  }
}

export function renderEmployeeSupervisorCenter(props: EmployeeSupervisorCenterProps) {
  return html`<employee-supervisor-center .supervisorProps=${props}></employee-supervisor-center>`;
}
