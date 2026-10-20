import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { whenGatewayReady } from "../../../supervisor/supervisor-gateway-utils.ts";

@customElement("employee-data-retention-summary-card")
export class EmployeeDataRetentionSummaryCard extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;

  @state() private loading = false;
  @state() private summary: string | null = null;
  @state() private error: string | null = null;

  connectedCallback() {
    super.connectedCallback();
    void this.refresh();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("client")) {
      void this.refresh();
    }
  }

  private async refresh() {
    if (!this.client) {
      this.summary = null;
      return;
    }
    if (!(await whenGatewayReady(this.client))) {
      return;
    }
    this.loading = true;
    this.error = null;
    try {
      const result = await this.client.request<{ summary?: string }>("data.retention.summary", {});
      this.summary = result.summary?.trim() || null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.summary = null;
    } finally {
      this.loading = false;
    }
  }

  render() {
    if (!this.client) {
      return nothing;
    }
    return html`
      <section class="employee-workbench__settings-section employee-workbench__settings-section--personal-tab">
        <div class="employee-workbench__settings-section-title">企业数据保留规则</div>
        <div class="employee-workbench__settings-section-subtitle">
          以下为当前企业配置的会话与归档保留策略摘要（只读，不可绕过）。
        </div>
        ${
          this.loading
            ? html`
                <div class="employee-workbench__settings-status-copy">正在加载…</div>
              `
            : this.error
              ? html`<div class="callout callout--danger">${this.error}</div>`
              : html`<div class="employee-workbench__settings-status-copy">${this.summary ?? "暂无保留策略摘要。"}</div>`
        }
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "employee-data-retention-summary-card": EmployeeDataRetentionSummaryCard;
  }
}
