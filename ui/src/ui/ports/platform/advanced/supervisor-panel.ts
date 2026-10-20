/**
 * supervisor-panel.ts — Platform Advanced surface for Development Supervisor (M4.1 + M5).
 */

import { LitElement, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { isGatewayReady } from "../../../supervisor/supervisor-gateway-utils.ts";
import "../../../supervisor/supervisor-task-board.ts";
import "../../../supervisor/supervisor-node-registry-panel.ts";
import "../../../supervisor/supervisor-worker-policy-panel.ts";

export type SupervisorEnterpriseOption = {
  tenantId: string;
  label: string;
};

interface SupervisorStatusResponse {
  enabled: boolean;
  envEnabled: boolean;
  configEnabled: boolean;
  runnerEnabled: boolean;
}

const TENANT_STORAGE_KEY = "platform.supervisor.tenantId";

export class SupervisorGovernanceSection extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ attribute: false }) enterprises: SupervisorEnterpriseOption[] = [];

  @state() private sharedTenantId = "";
  @state() private status: SupervisorStatusResponse | null = null;
  @state() private loadingStatus = false;
  @state() private toggling = false;
  @state() private error: string | null = null;
  @state() private notice: string | null = null;
  private loadedOnce = false;

  connectedCallback() {
    super.connectedCallback();
    this.restoreTenantSelection();
    if (this.client) {
      void this.loadStatus();
    }
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("enterprises")) {
      this.restoreTenantSelection();
    }
    if (changed.has("client") && this.client && !this.loadedOnce) {
      void this.loadStatus();
    }
    if (changed.has("client") && isGatewayReady(this.client) && this.loadedOnce) {
      void this.loadStatus();
    }
  }

  private restoreTenantSelection() {
    if (this.sharedTenantId.trim()) {
      return;
    }
    const stored =
      typeof localStorage !== "undefined" ? localStorage.getItem(TENANT_STORAGE_KEY)?.trim() : "";
    const match = this.enterprises.find((entry) => entry.tenantId === stored);
    if (match) {
      this.sharedTenantId = match.tenantId;
      return;
    }
    if (this.enterprises.length === 1) {
      this.sharedTenantId = this.enterprises[0].tenantId;
    }
  }

  private persistTenantSelection(tenantId: string) {
    if (typeof localStorage === "undefined") {
      return;
    }
    if (tenantId.trim()) {
      localStorage.setItem(TENANT_STORAGE_KEY, tenantId.trim());
    } else {
      localStorage.removeItem(TENANT_STORAGE_KEY);
    }
  }

  private async loadStatus() {
    if (!this.client) {
      return;
    }
    this.loadedOnce = true;
    this.loadingStatus = true;
    this.error = null;
    try {
      this.status = await this.client.request<SupervisorStatusResponse>("supervisor.status", {});
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.loadingStatus = false;
    }
  }

  private async toggleEnabled(next: boolean) {
    if (!this.client || this.toggling) {
      return;
    }
    const message = next
      ? "确认启用开发监督？启用后，监督任务会按当前配置开始记录。"
      : "确认关闭开发监督？若环境变量仍开启，功能可能保持可用。";
    if (
      typeof window !== "undefined" &&
      typeof window.confirm === "function" &&
      !window.confirm(message)
    ) {
      return;
    }
    this.toggling = true;
    this.error = null;
    this.notice = null;
    try {
      await this.client.request("supervisor.feature.set", { enabled: next });
      this.notice = next
        ? "已启用开发监督。若环境变量 OPENBOT_SUPERVISOR_ENABLED 已设置，将与其 OR 生效。"
        : "已写入配置关闭开发监督。若环境变量仍开启，功能可能保持可用。";
      await this.loadStatus();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.toggling = false;
    }
  }

  private onTenantSelect(event: Event) {
    const tenantId = (event.target as HTMLSelectElement).value.trim();
    this.sharedTenantId = tenantId;
    this.persistTenantSelection(tenantId);
  }

  private renderConnectionBanner() {
    if (isGatewayReady(this.client)) {
      return nothing;
    }
    return html`
      <div class="callout danger">
        Gateway 未连接。请通过 Gateway 控制页地址打开（如 127.0.0.1:18789），并确认网关服务已启动。
      </div>
    `;
  }

  private renderStatusCard() {
    const enabled = this.status?.enabled ?? false;
    const envOn = this.status?.envEnabled ?? false;
    const configOn = this.status?.configEnabled ?? false;
    return html`
      <section class="card">
        <div class="row row--split">
          <div>
            <div class="card-title">开发监督</div>
          </div>
          <div class="row row--tight">
            <button
              class="btn btn--sm ${enabled ? "" : "btn--primary"}"
              ?disabled=${this.toggling || !this.client}
              @click=${() => this.toggleEnabled(!enabled)}
            >
              ${this.toggling ? "处理中…" : enabled ? "停用" : "启用"}
            </button>
            <button
              class="btn btn--sm"
              ?disabled=${this.loadingStatus}
              @click=${() => this.loadStatus()}
            >
              ${this.loadingStatus ? "加载中…" : "刷新"}
            </button>
          </div>
        </div>
        <div class="stat-grid stat-grid--compact card-follow">
          <div class="stat stat--compact">
            <div class="stat-label">功能状态</div>
            <div class="stat-value ${enabled ? "ok" : "warn"}">
              ${enabled ? "已启用" : "未启用"}
            </div>
          </div>
          <div class="stat stat--compact">
            <div class="stat-label">配置开关</div>
            <div class="stat-value ${configOn ? "ok" : "neutral"}">
              ${configOn ? "已开启" : "未开启"}
            </div>
            <div class="muted stat-note">gateway.supervisor.enabled</div>
          </div>
          <div class="stat stat--compact">
            <div class="stat-label">环境变量</div>
            <div class="stat-value ${envOn ? "ok" : "neutral"}">${envOn ? "已开启" : "未设置"}</div>
            <div class="muted stat-note">OPENBOT_SUPERVISOR_ENABLED</div>
          </div>
          <div class="stat stat--compact">
            <div class="stat-label">Runner</div>
            <div class="stat-value ${this.status?.runnerEnabled ? "ok" : "neutral"}">
              ${this.status?.runnerEnabled ? "已启用" : "未启用"}
            </div>
          </div>
        </div>
      </section>
    `;
  }

  private renderTenantContext() {
    if (this.enterprises.length === 0) {
      return html`
        <section class="card">
          <div class="card-title">当前租户</div>
          <div class="callout warn card-follow--sm">
            暂无平台租户目录。请先在「租户管理」创建企业，或确认 platformAuth 已加载 enterprise 列表。
          </div>
        </section>
      `;
    }
    const selected = this.enterprises.find((entry) => entry.tenantId === this.sharedTenantId);
    return html`
      <section class="card">
        <div class="card-title">当前租户</div>
        <div class="row row--tight row--bottom row--wrap card-follow--sm">
          <label class="stack stack--field-wide">
            <span class="card-sub">企业租户</span>
            <select
              class="input"
              .value=${this.sharedTenantId}
              @change=${(event: Event) => this.onTenantSelect(event)}
            >
              <option value="">请选择租户…</option>
              ${this.enterprises.map(
                (entry) => html`
                  <option value=${entry.tenantId}>${entry.label} (${entry.tenantId})</option>
                `,
              )}
            </select>
          </label>
          ${
            selected
              ? html`
                  <span class="muted mono text-xs field-note-bottom">
                    已选：${selected.label}
                  </span>
                `
              : nothing
          }
        </div>
      </section>
    `;
  }

  render() {
    const tenantId = this.sharedTenantId.trim();
    return html`
      <div class="supervisor-governance-section stack">
        ${this.renderConnectionBanner()}
        ${this.error ? html`<div class="callout danger">${this.error}</div>` : nothing}
        ${this.notice ? html`<div class="callout">${this.notice}</div>` : nothing}
        ${this.renderStatusCard()} ${this.renderTenantContext()}
        <supervisor-node-registry-panel
          .client=${this.client}
          .tenantId=${tenantId}
          .externalTenantContext=${true}
          .connectionManaged=${true}
        ></supervisor-node-registry-panel>
        <supervisor-worker-policy-panel
          .client=${this.client}
          .tenantId=${tenantId}
          .externalTenantContext=${true}
          .connectionManaged=${true}
        ></supervisor-worker-policy-panel>
        <supervisor-task-board
          .client=${this.client}
          .tenantId=${tenantId}
          .showCreateForm=${true}
          .connectionManaged=${true}
          title="开发监督者"
        ></supervisor-task-board>
      </div>
    `;
  }
}

if (!customElements.get("supervisor-governance-section")) {
  customElements.define("supervisor-governance-section", SupervisorGovernanceSection);
}

declare global {
  interface HTMLElementTagNameMap {
    "supervisor-governance-section": SupervisorGovernanceSection;
  }
}
