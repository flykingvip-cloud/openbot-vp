import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../i18n/index.ts";
import type { CommercialOrderDetail } from "../../capability/cost-budget-billing/index.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  formatCommercialOrderNo,
  renderCommercialOrderAmount,
  renderCommercialOrderStatusCell,
  resolveCommercialOrderPlanName,
} from "./cost-budget-order-display.ts";

export type OrderDetailDrawerProps = {
  client: GatewayBrowserClient;
  order: CommercialOrderDetail;
  busy: boolean;
  invoiceBusy: boolean;
  profileComplete: boolean;
  onClose: () => void;
  onRequestInvoice: () => void;
  onOpenProfile: () => void;
  onNavigateSeats?: () => void;
  renderInvoiceSection: () => TemplateResult | typeof nothing;
  renderCheckoutSections: () => TemplateResult | typeof nothing;
  fmtTime: (iso?: string) => string;
  fmtMoney: (cents: number) => string;
};

export function renderOrderDetailBody(props: OrderDetailDrawerProps): TemplateResult {
  const { order, busy, fmtTime, fmtMoney } = props;
  return html`
    <div class="cost-budget-orders__detail" data-testid="order-detail">
      <div class="cost-budget-orders__detail-head">
        <div class="cost-budget-orders__detail-head-main">
          <div class="cost-budget-orders__order-id" title=${order.id}>
            ${formatCommercialOrderNo(order.id, order.createdAt)}
          </div>
          <div class="cost-budget-orders__order-id-raw muted">${order.id}</div>
        </div>
        ${renderCommercialOrderStatusCell({ status: order.status, busy })}
      </div>
      <div class="cost-budget-orders__detail-meta">
        <span class="cost-budget-orders__plan-name">${resolveCommercialOrderPlanName(order)}</span>
        ${renderCommercialOrderAmount(order.amountCents, "detail")}
        <span class="cost-budget-orders__detail-time">${fmtTime(order.createdAt)}</span>
      </div>
      ${
        order.lineItems?.length
          ? html`
              <ul class="cost-budget-orders__lines">
                ${order.lineItems.map(
                  (line) => html`
                    <li>${line.label} · ${fmtMoney(line.amountCents)}</li>
                  `,
                )}
              </ul>
            `
          : nothing
      }
      ${props.renderInvoiceSection()}
      ${props.renderCheckoutSections()}
    </div>
  `;
}

export function renderOrderDetailDrawer(props: OrderDetailDrawerProps): TemplateResult {
  return html`
    <div
      class="model-assets-drawer-overlay cost-budget-orders__detail-overlay"
      role="dialog"
      aria-modal="true"
      aria-label=${t("costBudget.orders.detailDrawerTitle")}
      data-testid="order-detail-drawer"
      @click=${() => props.onClose()}
    >
      <aside
        class="model-assets-drawer cost-budget-orders__detail-drawer"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <div class="model-assets-drawer__header">
          <div>
            <div class="model-assets-drawer__title">${t("costBudget.orders.detailDrawerTitle")}</div>
            <div class="model-assets-drawer__sub">
              ${formatCommercialOrderNo(props.order.id, props.order.createdAt)}
            </div>
          </div>
          <button
            type="button"
            class="btn btn--sm btn--ghost"
            data-testid="order-detail-drawer-close"
            @click=${() => props.onClose()}
          >
            ${t("costBudget.invoices.closeDrawer")}
          </button>
        </div>
        <div class="model-assets-drawer__body cost-budget-orders__detail-drawer-body">
          ${renderOrderDetailBody(props)}
        </div>
      </aside>
    </div>
  `;
}
