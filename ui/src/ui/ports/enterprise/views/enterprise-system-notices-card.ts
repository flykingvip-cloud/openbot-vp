import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import {
  isGatewayReady,
  resolvePanelError,
  whenGatewayReady,
} from "../../../supervisor/supervisor-gateway-utils.ts";

type EnterpriseNoticeItem = {
  id: string;
  kind: "budget" | "over-allocation" | "credits" | "channel-offline";
  severity: "info" | "warning" | "critical";
  code: string;
  count?: number;
  source?: string;
};

type EnterpriseNoticesResult = {
  totalCount: number;
  billingCount: number;
  channelOfflineCount: number;
  items: EnterpriseNoticeItem[];
};

/** Machine-stable code → admin-facing label (zh-CN), mirroring the sibling
 * supervisor card's inline-copy convention (no i18n indirection). */
function noticeLabel(item: EnterpriseNoticeItem): string {
  switch (item.code) {
    case "budget-exceeded":
      return "预算已超限";
    case "budget-alert":
      return "预算即将达到上限";
    case "over-allocated":
      return "资源用量超出订阅配额";
    case "credits-exhausted":
      return "额度已用尽";
    case "credits-low":
      return "额度即将用尽";
    case "channel-offline":
      return `渠道掉线：${item.source ?? "未知渠道"}`;
    default:
      return "系统告警";
  }
}

function severityClass(severity: EnterpriseNoticeItem["severity"]): string {
  if (severity === "critical") {
    return "is-error";
  }
  if (severity === "warning") {
    return "is-warn";
  }
  return "";
}

/**
 * Enterprise-ADMIN system alerts card for the enterprise overview: surfaces the
 * billing/quota + channel-offline signals from `enterprise.notices.list`. These
 * are the install/admin-scoped notices intentionally excluded from the
 * per-employee 重要通知 card. The RPC is admin-gated server-side; if the caller
 * is not an enterprise admin (or has no alerts) the card renders nothing, so it
 * stays additive and non-intrusive.
 */
@customElement("enterprise-system-notices-card")
export class EnterpriseSystemNoticesCard extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) client: GatewayBrowserClient | null = null;
  @property({ type: String }) tenantId = "";
  @property({ type: String }) detailHref = "";

  @state() private loading = false;
  @state() private suppressed = false;
  @state() private result: EnterpriseNoticesResult | null = null;

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
      this.result = null;
      return;
    }
    if (!(await whenGatewayReady(this.client))) {
      return;
    }
    this.loading = true;
    try {
      const result = await this.client.request<EnterpriseNoticesResult>("enterprise.notices.list", {
        tenantId: this.tenantId.trim(),
      });
      this.result = result;
      this.suppressed = false;
    } catch (err) {
      // Non-admin sessions are rejected server-side; hide the card rather than
      // surface an authorization error on the overview.
      this.result = null;
      this.suppressed = true;
      void resolvePanelError(err, { connectionManaged: false });
    } finally {
      this.loading = false;
    }
  }

  render() {
    if (!this.client || !this.tenantId.trim() || this.suppressed) {
      return nothing;
    }
    const result = this.result;
    // Additive + non-intrusive: only surface the card when there is an actual alert.
    if (!result || result.totalCount === 0) {
      return nothing;
    }
    return html`
      <section class="enterprise-overview-section enterprise-card enterprise-system-notices-card">
        <div class="enterprise-overview-section__head">
          <div class="enterprise-overview-section__title">系统告警</div>
          <span class="enterprise-command-card__count">${result.totalCount}</span>
        </div>
        <div class="enterprise-system-notices-card__list">
          ${result.items.map(
            (item) => html`
              <div class="enterprise-system-notices-card__row ${severityClass(item.severity)}">
                <span class="enterprise-system-notices-card__label">${noticeLabel(item)}</span>
                <span class="enterprise-command-status__badge">
                  ${item.severity === "critical" ? "严重" : "警告"}
                </span>
              </div>
            `,
          )}
        </div>
        <div class="enterprise-system-notices-card__footer">
          <button
            class="btn btn--sm btn--ghost"
            type="button"
            ?disabled=${this.loading || !isGatewayReady(this.client)}
            @click=${() => this.refresh()}
          >
            ${this.loading ? "刷新中…" : "刷新告警"}
          </button>
          ${
            this.detailHref
              ? html`<a class="enterprise-command-status__link" href=${this.detailHref}>查看成本与预算</a>`
              : nothing
          }
        </div>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "enterprise-system-notices-card": EnterpriseSystemNoticesCard;
  }
}
