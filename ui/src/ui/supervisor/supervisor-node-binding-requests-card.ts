import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../gateway.ts";
import { isGatewayReady, resolvePanelError, whenGatewayReady } from "./supervisor-gateway-utils.ts";
import type { SupervisorNodeBindingRequest } from "./supervisor-types.ts";

@customElement("supervisor-node-binding-requests-card")
export class SupervisorNodeBindingRequestsCard extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ type: String }) tenantId = "";
  @property({ type: String }) detailHref = "";

  @state() private loading = false;
  @state() private busyRequestId: string | null = null;
  @state() private error: string | null = null;
  @state() private notice: string | null = null;
  @state() private requests: SupervisorNodeBindingRequest[] = [];

  connectedCallback() {
    super.connectedCallback();
    if (this.client && this.tenantId.trim()) {
      void this.refresh();
    }
  }

  updated(changed: Map<string, unknown>) {
    if ((changed.has("client") || changed.has("tenantId")) && this.client && this.tenantId.trim()) {
      void this.refresh();
    }
  }

  private async refresh() {
    if (!this.client || !this.tenantId.trim()) {
      this.requests = [];
      return;
    }
    if (!(await whenGatewayReady(this.client))) {
      return;
    }
    this.loading = true;
    this.error = null;
    try {
      const result = await this.client.request<{ requests: SupervisorNodeBindingRequest[] }>(
        "supervisor.node.bindingRequest.list",
        { tenantId: this.tenantId.trim() },
      );
      this.requests = result.requests ?? [];
    } catch (err) {
      this.error = resolvePanelError(err, { connectionManaged: false });
    } finally {
      this.loading = false;
    }
  }

  private async resolveRequest(requestId: string, decision: "approved" | "rejected") {
    if (!this.client) {
      return;
    }
    const verb = decision === "approved" ? "批准" : "拒绝";
    if (!window.confirm(`确定${verb}这条本机 Node 连接申请吗？`)) {
      return;
    }
    this.busyRequestId = requestId;
    this.error = null;
    this.notice = null;
    try {
      await this.client.request("supervisor.node.bindingRequest.resolve", {
        requestId,
        decision,
      });
      this.notice = decision === "approved" ? "已批准，并自动完成 Node 绑定。" : "已拒绝申请。";
      await this.refresh();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busyRequestId = null;
    }
  }

  private renderRequest(request: SupervisorNodeBindingRequest) {
    const busy = this.busyRequestId === request.requestId;
    return html`
      <div class="supervisor-node-requests-card__row">
        <div class="supervisor-node-requests-card__main">
          <strong>${request.userId ?? "未知员工"}</strong>
          <span>
            申请连接 ${request.nodeDisplayName ?? request.nodeId}
            <span class="mono">${request.nodeId}</span>
          </span>
          <small>席位 ${request.seatId} · ${request.requestedAt}</small>
        </div>
        <div class="supervisor-node-requests-card__actions">
          <button
            class="btn btn--sm btn--primary"
            type="button"
            ?disabled=${busy}
            @click=${() => this.resolveRequest(request.requestId, "approved")}
          >
            ${busy ? "处理中…" : "批准"}
          </button>
          <button
            class="btn btn--sm btn--ghost"
            type="button"
            ?disabled=${busy}
            @click=${() => this.resolveRequest(request.requestId, "rejected")}
          >
            拒绝
          </button>
        </div>
      </div>
    `;
  }

  render() {
    if (!this.client || !this.tenantId.trim()) {
      return nothing;
    }
    return html`
      <section class="enterprise-overview-section enterprise-card supervisor-node-requests-card">
        <div class="enterprise-overview-section__head">
          <div class="enterprise-overview-section__title">Node 连接申请</div>
          <span class="enterprise-command-card__count">${this.requests.length}</span>
        </div>
        ${this.error ? html`<div class="employee-supervisor-center__banner is-error">${this.error}</div>` : nothing}
        ${this.notice ? html`<div class="employee-supervisor-center__banner is-success">${this.notice}</div>` : nothing}
        ${
          this.loading && this.requests.length === 0
            ? html`
                <p class="supervisor-governance-panel__muted">加载待确认申请…</p>
              `
            : this.requests.length > 0
              ? html`<div class="supervisor-node-requests-card__list">${this.requests.map((request) => this.renderRequest(request))}</div>`
              : html`
                  <div class="enterprise-empty enterprise-empty--compact">暂无员工 Node 连接申请。</div>
                `
        }
        <div class="supervisor-node-requests-card__footer">
          <button
            class="btn btn--sm btn--ghost"
            type="button"
            ?disabled=${this.loading || !isGatewayReady(this.client)}
            @click=${() => this.refresh()}
          >
            ${this.loading ? "刷新中…" : "刷新申请"}
          </button>
          ${
            this.detailHref
              ? html`<a class="enterprise-command-status__link" href=${this.detailHref}>进入 Node 管理</a>`
              : nothing
          }
        </div>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "supervisor-node-binding-requests-card": SupervisorNodeBindingRequestsCard;
  }
}
