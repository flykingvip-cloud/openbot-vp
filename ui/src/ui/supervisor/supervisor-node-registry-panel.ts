/**
 * supervisor-node-registry-panel.ts — platform view of online Nodes + tenant seat bindings (M5).
 */

import { LitElement, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../gateway.ts";
import { GatewayRequestError } from "../gateway.ts";
import { isGatewayReady, resolvePanelError, whenGatewayReady } from "./supervisor-gateway-utils.ts";
import type {
  SupervisorNodeBindingRequest,
  SupervisorNodeSeatBinding,
  SupervisorNodeSessionSummary,
} from "./supervisor-types.ts";

export class SupervisorNodeRegistryPanel extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ type: String }) tenantId = "";
  @property({ type: Boolean }) editable = true;
  /** When true, tenant is chosen by a parent panel — hide manual tenant ID input. */
  @property({ type: Boolean }) externalTenantContext = false;
  /** When true, connection errors are shown once by the parent shell. */
  @property({ type: Boolean }) connectionManaged = false;

  @state() private tenantDraft = "";
  @state() private loading = false;
  @state() private busy = false;
  @state() private unavailable = false;
  @state() private error: string | null = null;
  @state() private notice: string | null = null;
  @state() private nodes: SupervisorNodeSessionSummary[] = [];
  @state() private bindings: SupervisorNodeSeatBinding[] = [];
  @state() private bindingRequests: SupervisorNodeBindingRequest[] = [];

  connectedCallback() {
    super.connectedCallback();
    if (this.tenantId.trim()) {
      this.tenantDraft = this.tenantId.trim();
    }
    if (this.client) {
      void this.refreshNodes();
    }
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("tenantId")) {
      const next = this.tenantId.trim();
      if (next && next !== this.tenantDraft.trim()) {
        this.tenantDraft = next;
      }
      if (this.client && next) {
        void this.refreshNodes();
      }
    }
    if (changed.has("client") && this.client) {
      void this.refreshNodes();
    }
  }

  private nodeOnline(nodeId: string): boolean {
    return this.nodes.some((node) => node.nodeId === nodeId);
  }

  private bindingsForNode(nodeId: string): SupervisorNodeSeatBinding[] {
    return this.bindings.filter((entry) => entry.nodeId === nodeId);
  }

  private async refreshNodes() {
    if (!this.client) {
      return;
    }
    if (!(await whenGatewayReady(this.client))) {
      return;
    }
    this.loading = true;
    this.error = null;
    this.unavailable = false;
    try {
      const nodeResult = await this.client.request<{ nodes: SupervisorNodeSessionSummary[] }>(
        "supervisor.node.list",
        {},
      );
      this.nodes = nodeResult.nodes ?? [];
      const tenant = this.tenantDraft.trim();
      if (tenant) {
        const [bindingResult, requestResult] = await Promise.all([
          this.client.request<{ bindings: SupervisorNodeSeatBinding[] }>(
            "supervisor.node.bindings.list",
            { tenantId: tenant },
          ),
          this.client.request<{ requests: SupervisorNodeBindingRequest[] }>(
            "supervisor.node.bindingRequest.list",
            { tenantId: tenant },
          ),
        ]);
        this.bindings = bindingResult.bindings ?? [];
        this.bindingRequests = requestResult.requests ?? [];
      } else {
        this.bindings = [];
        this.bindingRequests = [];
      }
    } catch (err) {
      if (err instanceof GatewayRequestError && err.gatewayCode === "UNAVAILABLE") {
        this.unavailable = true;
        this.nodes = [];
        this.bindings = [];
        this.bindingRequests = [];
      } else {
        const message = resolvePanelError(err, { connectionManaged: this.connectionManaged });
        this.error = message;
      }
    } finally {
      this.loading = false;
    }
  }

  private emitTenantChange() {
    this.dispatchEvent(
      new CustomEvent("supervisor-tenant-change", {
        detail: { tenantId: this.tenantDraft.trim() },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async loadBindings() {
    this.tenantId = this.tenantDraft.trim();
    this.emitTenantChange();
    await this.refreshNodes();
  }

  private async unbindSeat(seatId: string) {
    if (!this.client) {
      return;
    }
    const tenant = this.tenantDraft.trim();
    if (!tenant || !window.confirm(`确定解除席位「${seatId}」的 Node 绑定吗？`)) {
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      await this.client.request("supervisor.node.unbind", { tenantId: tenant, seatId });
      this.notice = `已解除席位「${seatId}」的绑定。`;
      await this.refreshNodes();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  private async resolveBindingRequest(requestId: string, decision: "approved" | "rejected") {
    if (!this.client) {
      return;
    }
    const verb = decision === "approved" ? "批准" : "拒绝";
    if (!window.confirm(`确定${verb}这条 Node 连接申请吗？`)) {
      return;
    }
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      await this.client.request("supervisor.node.bindingRequest.resolve", {
        requestId,
        decision,
      });
      this.notice =
        decision === "approved" ? "已批准申请，并自动完成席位与 Node 绑定。" : "已拒绝申请。";
      await this.refreshNodes();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  private renderNodesTable() {
    if (this.nodes.length === 0) {
      return html`
        <p class="supervisor-governance-panel__muted">暂无在线 Node</p>
      `;
    }
    return html`
      <table class="supervisor-governance-panel__table mono">
        <thead>
          <tr>
            <th>Node ID</th>
            <th>名称 / 平台</th>
            <th>监督 Worker</th>
            <th>绑定席位数</th>
          </tr>
        </thead>
        <tbody>
          ${this.nodes.map((node) => {
            const bound = this.bindingsForNode(node.nodeId);
            return html`
              <tr>
                <td>${node.nodeId}</td>
                <td>${node.displayName ?? "—"}${node.platform ? html` · ${node.platform}` : nothing}</td>
                <td>${node.supportsSupervisorWorker ? "支持" : "不支持"}</td>
                <td>${this.tenantDraft.trim() ? bound.length : "—"}</td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    `;
  }

  private renderRequestsTable() {
    if (!this.tenantDraft.trim()) {
      return nothing;
    }
    if (this.bindingRequests.length === 0) {
      return html`
        <p class="supervisor-governance-panel__muted">暂无待确认申请</p>
      `;
    }
    return html`
      <table class="supervisor-governance-panel__table mono">
        <thead>
          <tr>
            <th>员工</th>
            <th>席位 ID</th>
            <th>Node</th>
            <th>申请时间</th>
            ${
              this.editable
                ? html`
                    <th></th>
                  `
                : nothing
            }
          </tr>
        </thead>
        <tbody>
          ${this.bindingRequests.map(
            (request) => html`
              <tr>
                <td>${request.userId ?? "—"}</td>
                <td>${request.seatId}</td>
                <td>
                  ${request.nodeDisplayName ?? request.nodeId}
                  <small class="supervisor-governance-panel__muted">${request.nodeId}</small>
                </td>
                <td>${request.requestedAt}</td>
                ${
                  this.editable
                    ? html`
                        <td>
                          <div class="supervisor-governance-panel__row-actions">
                            <button
                              class="btn btn--sm btn--primary"
                              type="button"
                              ?disabled=${this.busy}
                              @click=${() =>
                                this.resolveBindingRequest(request.requestId, "approved")}
                            >
                              批准
                            </button>
                            <button
                              class="btn btn--sm btn--ghost"
                              type="button"
                              ?disabled=${this.busy}
                              @click=${() =>
                                this.resolveBindingRequest(request.requestId, "rejected")}
                            >
                              拒绝
                            </button>
                          </div>
                        </td>
                      `
                    : nothing
                }
              </tr>
            `,
          )}
        </tbody>
      </table>
    `;
  }

  private renderBindingsTable() {
    if (!this.tenantDraft.trim()) {
      return nothing;
    }
    if (this.bindings.length === 0) {
      return html`
        <p class="supervisor-governance-panel__muted">暂无席位绑定</p>
      `;
    }
    return html`
      <table class="supervisor-governance-panel__table mono">
        <thead>
          <tr>
            <th>席位 ID</th>
            <th>Node ID</th>
            <th>Node 在线</th>
            <th>更新时间</th>
            ${
              this.editable
                ? html`
                    <th></th>
                  `
                : nothing
            }
          </tr>
        </thead>
        <tbody>
          ${this.bindings.map(
            (entry) => html`
              <tr>
                <td>${entry.seatId}</td>
                <td>${entry.nodeId}</td>
                <td class="${this.nodeOnline(entry.nodeId) ? "is-ok" : ""}">
                  ${this.nodeOnline(entry.nodeId) ? "在线" : "离线"}
                </td>
                <td>${entry.updatedAt}</td>
                ${
                  this.editable
                    ? html`
                        <td>
                          <button
                            class="btn btn--sm btn--ghost"
                            type="button"
                            ?disabled=${this.busy}
                            @click=${() => this.unbindSeat(entry.seatId)}
                          >
                            解除
                          </button>
                        </td>
                      `
                    : nothing
                }
              </tr>
            `,
          )}
        </tbody>
      </table>
    `;
  }

  render() {
    return html`
      <section class="supervisor-governance-panel card">
        <div class="card-title">Node 与席位绑定</div>
        ${
          this.unavailable
            ? html`
                <div class="employee-supervisor-center__banner is-warn">
                  监督子系统未启用。请设置 OPENBOT_SUPERVISOR_ENABLED=1 并重启 Gateway。
                </div>
              `
            : nothing
        }
        ${
          !this.editable
            ? html`
                <div class="employee-supervisor-center__banner is-warn">
                  只读视图：可查看 Node 与绑定关系，解除绑定需 enterprise-admin 权限。
                </div>
              `
            : nothing
        }
        ${this.error ? html`<div class="employee-supervisor-center__banner is-error">${this.error}</div>` : nothing}
        ${this.notice ? html`<div class="employee-supervisor-center__banner is-success">${this.notice}</div>` : nothing}
        ${
          this.externalTenantContext
            ? this.tenantDraft.trim()
              ? html`
                  <div class="supervisor-governance-panel__toolbar">
                    <span class="supervisor-governance-panel__muted mono">租户 ${this.tenantDraft}</span>
                    <button
                      class="btn btn--sm btn--ghost"
                      type="button"
                      ?disabled=${this.loading || !isGatewayReady(this.client)}
                      @click=${() => this.refreshNodes()}
                    >
                      ${this.loading ? "刷新中…" : "刷新"}
                    </button>
                  </div>
                `
              : nothing
            : !this.editable && this.tenantId.trim()
              ? html`
                <div class="supervisor-governance-panel__toolbar">
                  <span class="supervisor-governance-panel__muted mono">租户 ${this.tenantDraft}</span>
                  <button
                    class="btn btn--sm btn--ghost"
                    type="button"
                    ?disabled=${this.loading}
                    @click=${() => this.refreshNodes()}
                  >
                    ${this.loading ? "刷新中…" : "刷新"}
                  </button>
                </div>
              `
              : html`
                <div class="supervisor-governance-panel__toolbar">
                  <label class="supervisor-governance-panel__field">
                    <span class="card-sub">租户 ID</span>
                    <input
                      class="input mono"
                      .value=${this.tenantDraft}
                      placeholder="加载绑定列表"
                      @input=${(e: Event) => {
                        this.tenantDraft = (e.target as HTMLInputElement).value;
                      }}
                    />
                  </label>
                  <button
                    class="btn btn--sm"
                    type="button"
                    ?disabled=${this.loading || !this.tenantDraft.trim()}
                    @click=${() => this.loadBindings()}
                  >
                    ${this.loading ? "加载中…" : "加载绑定"}
                  </button>
                  <button
                    class="btn btn--sm btn--ghost"
                    type="button"
                    ?disabled=${this.loading}
                    @click=${() => this.refreshNodes()}
                  >
                    刷新 Node
                  </button>
                </div>
              `
        }
        <div class="supervisor-governance-panel__section-title">在线 Node（${this.nodes.length}）</div>
        ${this.renderNodesTable()}
        <div class="supervisor-governance-panel__section-title">待确认申请（${this.bindingRequests.length}）</div>
        ${this.renderRequestsTable()}
        <div class="supervisor-governance-panel__section-title">席位绑定</div>
        ${this.renderBindingsTable()}
      </section>
    `;
  }
}

if (!customElements.get("supervisor-node-registry-panel")) {
  customElements.define("supervisor-node-registry-panel", SupervisorNodeRegistryPanel);
}

declare global {
  interface HTMLElementTagNameMap {
    "supervisor-node-registry-panel": SupervisorNodeRegistryPanel;
  }
}
