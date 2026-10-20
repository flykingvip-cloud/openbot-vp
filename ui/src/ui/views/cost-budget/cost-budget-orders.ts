/**
 * 企业端「订单与支付」子页：订单历史 + 待支付结账（对公指引）。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../i18n/index.ts";
import { createCostBudgetGateway } from "../../capability/cost-budget-billing/gateway-client.ts";
import type {
  BankTransferInstructions,
  CommercialOrderDetail,
} from "../../capability/cost-budget-billing/index.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import { renderIcon } from "../../icons.ts";
import {
  renderBillingProfileDrawer,
  renderInvoiceRequestList,
  renderRequestInvoiceAction,
} from "./cost-budget-invoice-components.ts";
import {
  ensureInvoiceContextLoaded,
  findInvoiceRequestForOrder,
  invoiceContext,
  openBillingProfileDrawer,
  requestInvoiceForOrder,
  __resetInvoiceContextForTest,
} from "./cost-budget-invoice-context.ts";
import { renderOrderDetailDrawer } from "./cost-budget-order-detail-drawer.ts";
import {
  formatCommercialOrderNo,
  renderCommercialOrderAmount,
  renderCommercialOrderCreatedAt,
  renderCommercialOrderInvoiceCell,
  renderCommercialOrderListStats,
  renderCommercialOrderNoCell,
  renderCommercialOrderPlanCell,
  renderCommercialOrderStatusCell,
  resolveCommercialOrderPlanName,
  summarizeCommercialOrders,
} from "./cost-budget-order-display.ts";
import {
  DEFAULT_COMMERCIAL_ORDERS_LIST_FILTER,
  filterCommercialOrders,
  hasActiveCommercialOrdersListFilter,
  type CommercialOrderStatusFilter,
  type CommercialOrdersListFilter,
} from "./cost-budget-orders-filters.ts";
import type { CostBudgetTemplate } from "./cost-budget-table.ts";

export type CostBudgetOrdersPageOptions = {
  /** 打开时预选订单（如从订阅页跳转）。 */
  initialOrderId?: string | null;
  /** 待核销的订阅/换套餐订单；支付完成后触发席位引导。 */
  watchSubscriptionOrderId?: string | null;
  onSubscriptionOrderPaid?: (info: { orderId: string; kind: string }) => void;
  /** 已支付订阅类订单详情中的「前往席位与权限」跳转。 */
  onNavigateSeats?: () => void;
};

const SUBSCRIPTION_ORDER_KINDS = new Set(["subscribe", "change_plan"]);

type OrdersPageState = {
  loading: boolean;
  error: string | null;
  notice: string | null;
  orders: CommercialOrderDetail[];
  bankTransfer: BankTransferInstructions | null;
  selectedOrderId: string | null;
  busyOrderId: string | null;
  onlineCheckout: { checkoutUrl?: string; qrContent?: string } | null;
  listFilter: CommercialOrdersListFilter;
};

const state: OrdersPageState = {
  loading: false,
  error: null,
  notice: null,
  orders: [],
  bankTransfer: null,
  selectedOrderId: null,
  busyOrderId: null,
  onlineCheckout: null,
  listFilter: { ...DEFAULT_COMMERCIAL_ORDERS_LIST_FILTER },
};

let loaded = false;
let lastClient: GatewayBrowserClient | null = null;
let rerenderFn: (() => void) | null = null;
let pageOptions: CostBudgetOrdersPageOptions | undefined;

function fmtMoney(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function fmtTime(iso?: string): string {
  if (!iso) {
    return "—";
  }
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function reload(client: GatewayBrowserClient): Promise<void> {
  state.loading = true;
  state.error = null;
  rerenderFn?.();
  try {
    const gw = createCostBudgetGateway(client);
    const [ordersRes, checkoutRes] = await Promise.all([
      gw.listCommercialOrders(),
      gw.checkoutInfo(),
    ]);
    state.orders = ordersRes.orders;
    state.bankTransfer = checkoutRes.bankTransfer;
    if (state.selectedOrderId && !state.orders.some((o) => o.id === state.selectedOrderId)) {
      state.selectedOrderId = null;
    }
    notifySubscriptionOrderPaidIfNeeded(state.orders);
    loaded = true;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.loading = false;
    rerenderFn?.();
  }
}

function notifySubscriptionOrderPaidIfNeeded(orders: CommercialOrderDetail[]): void {
  const watchId = pageOptions?.watchSubscriptionOrderId;
  if (!watchId || !pageOptions?.onSubscriptionOrderPaid) {
    return;
  }
  const order = orders.find((row) => row.id === watchId);
  if (!order || order.status !== "paid" || !SUBSCRIPTION_ORDER_KINDS.has(order.kind)) {
    return;
  }
  pageOptions.onSubscriptionOrderPaid({ orderId: order.id, kind: order.kind });
}

function ensureLoaded(client: GatewayBrowserClient, rerender: () => void): void {
  rerenderFn = rerender;
  if (client !== lastClient) {
    lastClient = client;
    loaded = false;
    state.selectedOrderId = null;
  }
  if (!loaded && !state.loading) {
    void reload(client);
  }
}

async function startOnlinePayment(
  client: GatewayBrowserClient,
  orderId: string,
  provider: "stripe" | "alipay",
): Promise<void> {
  state.busyOrderId = orderId;
  state.error = null;
  rerenderFn?.();
  try {
    const gw = createCostBudgetGateway(client);
    const result = await gw.createPayment({ orderId, provider });
    state.onlineCheckout = {
      checkoutUrl: result.checkoutUrl ?? result.payment.checkoutUrl,
      qrContent: result.qrContent,
    };
    state.notice =
      provider === "stripe"
        ? t("costBudget.orders.noticeStripeCheckout")
        : t("costBudget.orders.noticeAlipayCheckout");
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.busyOrderId = null;
    rerenderFn?.();
  }
}

async function cancelOrder(client: GatewayBrowserClient, orderId: string): Promise<void> {
  state.busyOrderId = orderId;
  state.error = null;
  rerenderFn?.();
  try {
    const gw = createCostBudgetGateway(client);
    await gw.cancelCommercialOrder(orderId);
    state.notice = t("costBudget.orders.noticeCanceled", { orderId });
    closeOrderDetail();
    await reload(client);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.busyOrderId = null;
    rerenderFn?.();
  }
}

function renderBankTransfer(order: CommercialOrderDetail): CostBudgetTemplate {
  const bt = state.bankTransfer;
  if (!bt) {
    return nothing;
  }
  return html`
    <section class="card cost-budget-checkout" data-testid="checkout-bank-transfer">
      <div class="card-title">${t("costBudget.orders.checkoutTitle")}</div>
      <p class="muted">${t("costBudget.orders.checkoutSub", { orderId: order.id })}</p>
      <dl class="cost-budget-checkout__dl">
        <div>
          <dt>${t("costBudget.orders.bankAccountName")}</dt>
          <dd>${bt.accountName}</dd>
        </div>
        <div>
          <dt>${t("costBudget.orders.bankName")}</dt>
          <dd>${bt.bankName}</dd>
        </div>
        <div>
          <dt>${t("costBudget.orders.bankAccountNumber")}</dt>
          <dd><code>${bt.accountNumber}</code></dd>
        </div>
        <div>
          <dt>${t("costBudget.orders.bankRemark")}</dt>
          <dd>${bt.remarkHint}</dd>
        </div>
        <div>
          <dt>${t("costBudget.orders.checkoutAmount")}</dt>
          <dd><strong>${fmtMoney(order.amountCents)}</strong></dd>
        </div>
      </dl>
      <p class="enterprise-hint">${t("costBudget.orders.checkoutHint")}</p>
    </section>
  `;
}

function renderOnlineCheckout(): CostBudgetTemplate {
  const checkout = state.onlineCheckout;
  if (!checkout) {
    return nothing;
  }
  return html`
    <section class="card cost-budget-checkout cost-budget-checkout--online" data-testid="online-checkout">
      <div class="card-title">${t("costBudget.orders.onlineCheckoutTitle")}</div>
      ${
        checkout.checkoutUrl
          ? html`
              <p>
                <a href=${checkout.checkoutUrl} target="_blank" rel="noopener noreferrer">
                  ${t("costBudget.orders.openCheckout")}
                </a>
              </p>
            `
          : nothing
      }
      ${
        checkout.qrContent
          ? html`
              <p class="muted">${t("costBudget.orders.alipayQrHint")}</p>
              <pre class="cost-budget-checkout__qr">${checkout.qrContent}</pre>
            `
          : nothing
      }
    </section>
  `;
}

function selectOrder(orderId: string): void {
  state.selectedOrderId = orderId;
  state.onlineCheckout = null;
  rerenderFn?.();
}

function closeOrderDetail(): void {
  state.selectedOrderId = null;
  state.onlineCheckout = null;
  rerenderFn?.();
}

async function copyOrderNo(
  orderId: string,
  createdAt: string | undefined,
  event: Event,
): Promise<void> {
  event.stopPropagation();
  const displayNo = formatCommercialOrderNo(orderId, createdAt);
  try {
    await navigator.clipboard.writeText(displayNo);
    state.notice = t("costBudget.orders.copyOrderNoDone", { no: displayNo });
    rerenderFn?.();
  } catch {
    /* clipboard unavailable */
  }
}

function togglePendingFilter(): void {
  state.listFilter = {
    ...state.listFilter,
    statusFilter: state.listFilter.statusFilter === "pending_payment" ? "all" : "pending_payment",
  };
  if (state.listFilter.statusFilter === "pending_payment" && state.selectedOrderId) {
    const selected = state.orders.find((order) => order.id === state.selectedOrderId);
    if (selected?.status !== "pending_payment") {
      state.selectedOrderId = null;
    }
  }
  rerenderFn?.();
}

function updateListFilter(patch: Partial<CommercialOrdersListFilter>): void {
  state.listFilter = { ...state.listFilter, ...patch };
  if (state.selectedOrderId) {
    const visible = filterCommercialOrders(state.orders, state.listFilter);
    if (!visible.some((order) => order.id === state.selectedOrderId)) {
      state.selectedOrderId = null;
    }
  }
  rerenderFn?.();
}

function visibleOrders(): CommercialOrderDetail[] {
  return filterCommercialOrders(state.orders, state.listFilter);
}

function renderOrdersPanelToolbar(): TemplateResult {
  const { searchQuery, statusFilter, dateFrom, dateTo } = state.listFilter;
  return html`
    <div class="cost-budget-orders__panel-toolbar" data-testid="orders-panel-toolbar">
      <label class="cost-budget-orders__search">
        ${renderIcon("search", "cost-budget-orders__search-icon")}
        <input
          type="search"
          class="cost-budget-orders__search-input"
          placeholder=${t("costBudget.orders.searchPlaceholder")}
          aria-label=${t("costBudget.orders.searchPlaceholder")}
          data-testid="orders-search-input"
          .value=${searchQuery}
          @input=${(event: Event) => {
            updateListFilter({ searchQuery: (event.target as HTMLInputElement).value });
          }}
        />
      </label>
      <div class="cost-budget-orders__date-range" data-testid="orders-date-range">
        <input
          type="date"
          class="cost-budget-orders__date-input"
          aria-label=${t("costBudget.orders.dateFromLabel")}
          data-testid="orders-date-from"
          .value=${dateFrom}
          @change=${(event: Event) => {
            updateListFilter({ dateFrom: (event.target as HTMLInputElement).value });
          }}
        />
        <span class="cost-budget-orders__date-sep" aria-hidden="true">—</span>
        <input
          type="date"
          class="cost-budget-orders__date-input"
          aria-label=${t("costBudget.orders.dateToLabel")}
          data-testid="orders-date-to"
          .value=${dateTo}
          @change=${(event: Event) => {
            updateListFilter({ dateTo: (event.target as HTMLInputElement).value });
          }}
        />
      </div>
      <label class="cost-budget-orders__status-filter">
        ${renderIcon("filter", "cost-budget-orders__toolbar-icon")}
        <select
          class="cost-budget-orders__status-select"
          data-testid="orders-status-filter"
          .value=${statusFilter}
          @change=${(event: Event) => {
            updateListFilter({
              statusFilter: (event.target as HTMLSelectElement)
                .value as CommercialOrderStatusFilter,
            });
          }}
        >
          <option value="all">${t("costBudget.orders.filterStatusAll")}</option>
          <option value="paid">${t("costBudget.orders.filterStatusPaid")}</option>
          <option value="pending_payment">${t("costBudget.orders.filterStatusPending")}</option>
          <option value="canceled">${t("costBudget.orders.filterStatusCanceled")}</option>
        </select>
      </label>
    </div>
  `;
}

function renderOrderCheckoutSections(
  client: GatewayBrowserClient,
  order: CommercialOrderDetail,
  busy: boolean,
): TemplateResult | typeof nothing {
  if (order.status !== "pending_payment") {
    return nothing;
  }
  return html`
    ${renderBankTransfer(order)}
    ${renderOnlineCheckout()}
    <div class="cost-budget-orders__actions cost-budget-orders__actions--pay">
      <button
        type="button"
        class="btn btn--sm btn--primary"
        data-testid="pay-stripe"
        ?disabled=${busy}
        @click=${() => void startOnlinePayment(client, order.id, "stripe")}
      >
        ${busy ? t("costBudget.orders.busy") : t("costBudget.orders.payStripe")}
      </button>
      <button
        type="button"
        class="btn btn--sm"
        data-testid="pay-alipay"
        ?disabled=${busy}
        @click=${() => void startOnlinePayment(client, order.id, "alipay")}
      >
        ${busy ? t("costBudget.orders.busy") : t("costBudget.orders.payAlipay")}
      </button>
      <button
        type="button"
        class="btn btn--sm"
        data-testid="order-cancel"
        ?disabled=${busy}
        @click=${() => void cancelOrder(client, order.id)}
      >
        ${busy ? t("costBudget.orders.busy") : t("costBudget.orders.cancelOrder")}
      </button>
    </div>
  `;
}

function renderOrderPaidSections(order: CommercialOrderDetail): TemplateResult | typeof nothing {
  if (order.status !== "paid" || !SUBSCRIPTION_ORDER_KINDS.has(order.kind)) {
    return nothing;
  }
  return html`
    <div class="callout success cost-budget-orders__paid-seat-setup" data-testid="order-paid-seat-setup">
      <strong>${t("costBudget.orders.paidSeatSetupTitle")}</strong>
      <p>${t("costBudget.orders.paidSeatSetupBody")}</p>
      <button
        type="button"
        class="btn btn--sm btn--primary"
        data-testid="order-paid-goto-seats"
        @click=${() => pageOptions?.onNavigateSeats?.()}
      >
        ${t("costBudget.orders.paidSeatSetupCta")}
      </button>
    </div>
  `;
}

function renderSelectedOrderDrawer(client: GatewayBrowserClient): TemplateResult | typeof nothing {
  const order = state.orders.find((row) => row.id === state.selectedOrderId);
  if (!order) {
    return nothing;
  }
  const busy = state.busyOrderId === order.id;
  const invoiceBusy = invoiceContext.busyOrderId === order.id;
  return renderOrderDetailDrawer({
    client,
    order,
    busy,
    invoiceBusy,
    profileComplete: invoiceContext.profileComplete,
    onClose: closeOrderDetail,
    onRequestInvoice: () => void requestInvoiceForOrder(client, order.id),
    onOpenProfile: () => openBillingProfileDrawer(),
    onNavigateSeats: () => pageOptions?.onNavigateSeats?.(),
    fmtTime,
    fmtMoney,
    renderInvoiceSection: () =>
      order.status === "paid"
        ? html`
            ${renderRequestInvoiceAction({
              order,
              profileComplete: invoiceContext.profileComplete,
              existingRequest: findInvoiceRequestForOrder(order.id),
              busy: invoiceBusy,
              onRequest: () => void requestInvoiceForOrder(client, order.id),
              onOpenProfile: () => openBillingProfileDrawer(),
            })}
            ${renderOrderPaidSections(order)}
          `
        : nothing,
    renderCheckoutSections: () => renderOrderCheckoutSections(client, order, busy),
  });
}

function renderOrdersPanelHead(
  stats: ReturnType<typeof summarizeCommercialOrders>,
): TemplateResult {
  return html`
    <header class="cost-budget-orders__panel-head">
      <div class="cost-budget-orders__panel-head-main">
        <h4 class="cost-budget-orders__panel-title">${t("costBudget.orders.listTitle")}</h4>
        ${renderCommercialOrderListStats(stats, {
          pendingFilterActive: state.listFilter.statusFilter === "pending_payment",
          onPendingFilterToggle: togglePendingFilter,
        })}
      </div>
      ${renderOrdersPanelToolbar()}
    </header>
  `;
}

function renderOrdersList(client: GatewayBrowserClient): TemplateResult {
  if (state.orders.length === 0) {
    return html`<div class="enterprise-empty">${t("costBudget.orders.empty")}</div>`;
  }
  const orders = visibleOrders();
  const stats = summarizeCommercialOrders(state.orders);
  if (orders.length === 0) {
    const emptyMessage = hasActiveCommercialOrdersListFilter(state.listFilter)
      ? t("costBudget.orders.filterEmpty")
      : t("costBudget.orders.pendingFilterEmpty");
    return html`
      <div class="cost-budget-orders__layout">
        <section class="cost-budget-orders__panel" data-testid="orders-panel">
          ${renderOrdersPanelHead(stats)}
          <div class="enterprise-empty cost-budget-orders__filter-empty" data-testid="orders-filter-empty">
            ${emptyMessage}
          </div>
        </section>
      </div>
    `;
  }
  return html`
    <div class="cost-budget-orders__layout">
      <section class="cost-budget-orders__panel" data-testid="orders-panel">
        ${renderOrdersPanelHead(stats)}
        <div class="cost-budget-orders__table-wrap">
          <table class="cost-budget-orders__table" data-testid="orders-table">
            <colgroup>
              <col class="cost-budget-orders__col-index" />
              <col class="cost-budget-orders__col-order" />
              <col class="cost-budget-orders__col-plan" />
              <col class="cost-budget-orders__col-amount" />
              <col class="cost-budget-orders__col-status" />
              <col class="cost-budget-orders__col-created" />
              <col class="cost-budget-orders__col-invoice" />
            </colgroup>
            <thead>
              <tr>
                <th class="cost-budget-orders__col-index">${t("costBudget.orders.colIndex")}</th>
                <th class="cost-budget-orders__col-order">${t("costBudget.orders.colOrder")}</th>
                <th class="cost-budget-orders__col-plan">${t("costBudget.orders.colPlanInfo")}</th>
                <th class="cost-budget-orders__col-amount">${t("costBudget.orders.colAmount")}</th>
                <th class="cost-budget-orders__col-status">${t("costBudget.orders.colStatus")}</th>
                <th class="cost-budget-orders__col-created">${t("costBudget.orders.colCreated")}</th>
                <th class="cost-budget-orders__col-invoice">${t("costBudget.orders.colInvoice")}</th>
              </tr>
            </thead>
            <tbody>
              ${orders.map((order, index) => {
                const invoiceBusy = invoiceContext.busyOrderId === order.id;
                const payBusy = state.busyOrderId === order.id;
                const planName = resolveCommercialOrderPlanName(order);
                const isCanceled = order.status === "canceled";
                return html`
                  <tr
                    class="cost-budget-orders__table-row ${
                      state.selectedOrderId === order.id ? "is-selected" : ""
                    } ${isCanceled ? "is-canceled" : ""}"
                    data-testid="order-row"
                    tabindex="0"
                    @click=${() => selectOrder(order.id)}
                    @keydown=${(event: KeyboardEvent) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectOrder(order.id);
                      }
                    }}
                  >
                    <td class="cost-budget-orders__col-index">
                      <span class="cost-budget-orders__row-index">${index + 1}</span>
                    </td>
                    <td class="cost-budget-orders__col-order">
                      ${renderCommercialOrderNoCell(
                        order.id,
                        order.createdAt,
                        (event) => void copyOrderNo(order.id, order.createdAt, event),
                      )}
                    </td>
                    <td class="cost-budget-orders__col-plan">${renderCommercialOrderPlanCell(planName)}</td>
                    <td class="cost-budget-orders__col-amount">
                      <div class="cost-budget-orders__amount-wrap">
                        ${renderCommercialOrderAmount(order.amountCents)}
                      </div>
                    </td>
                    <td class="cost-budget-orders__col-status">
                      ${renderCommercialOrderStatusCell({
                        status: order.status,
                        busy: payBusy,
                        onPay:
                          order.status === "pending_payment"
                            ? () => selectOrder(order.id)
                            : undefined,
                      })}
                    </td>
                    <td class="cost-budget-orders__col-created">
                      ${renderCommercialOrderCreatedAt(order.createdAt)}
                    </td>
                    <td class="cost-budget-orders__col-invoice">
                      ${renderCommercialOrderInvoiceCell({
                        order,
                        existingRequest: findInvoiceRequestForOrder(order.id),
                        profileComplete: invoiceContext.profileComplete,
                        busy: invoiceBusy,
                        onRequest: () => void requestInvoiceForOrder(client, order.id),
                        onOpenProfile: () => openBillingProfileDrawer(),
                      })}
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

export function renderCostBudgetOrdersPage(
  client: GatewayBrowserClient,
  rerender: () => void,
  options?: CostBudgetOrdersPageOptions,
): TemplateResult {
  pageOptions = options;
  ensureLoaded(client, rerender);
  ensureInvoiceContextLoaded(client, rerender);
  if (options?.initialOrderId && !state.selectedOrderId) {
    state.selectedOrderId = options.initialOrderId;
  }
  if (!state.loading && state.orders.length > 0) {
    notifySubscriptionOrderPaidIfNeeded(state.orders);
  }

  if (state.loading && state.orders.length === 0) {
    return html`<div class="enterprise-empty">${t("costBudget.orders.loading")}</div>`;
  }

  const hasOrderList = state.orders.length > 0;

  return html`
    <div
      class="cost-budget-orders ${hasOrderList ? "cost-budget-orders--has-list" : ""}"
      data-testid="cost-budget-orders"
    >
      <header
        class="cost-budget-orders__header ${hasOrderList ? "cost-budget-orders__header--compact" : ""}"
      >
        ${
          hasOrderList
            ? nothing
            : html`
                <div>
                  <h3 class="enterprise-section-title">${t("costBudget.orders.title")}</h3>
                  <p class="muted">${t("costBudget.orders.subtitle")}</p>
                </div>
              `
        }
        <div
          class="cost-budget-orders__header-actions ${
            hasOrderList ? "cost-budget-orders__header-actions--primary" : ""
          }"
        >
          <button
            type="button"
            class="btn btn--sm btn--ghost"
            data-testid="orders-open-profile"
            @click=${() => openBillingProfileDrawer()}
          >
            ${t("costBudget.invoices.manageProfile")}
          </button>
          <button
            type="button"
            class="btn btn--sm"
            data-testid="orders-refresh"
            ?disabled=${state.loading}
            @click=${() => void reload(client)}
          >
            ${t("costBudget.orders.refresh")}
          </button>
        </div>
      </header>
      ${state.error ? html`<div class="callout warning">${state.error}</div>` : nothing}
      ${state.notice ? html`<div class="callout">${state.notice}</div>` : nothing}
      ${invoiceContext.error ? html`<div class="callout warning">${invoiceContext.error}</div>` : nothing}
      ${renderOrdersList(client)}
      ${
        invoiceContext.requests.length > 0
          ? html`
              <section class="enterprise-card cost-budget-orders__invoice-history" data-testid="orders-invoice-history">
                <div class="card-title">${t("costBudget.invoices.historyTitle")}</div>
                ${renderInvoiceRequestList({ requests: invoiceContext.requests, compact: true })}
              </section>
            `
          : nothing
      }
      ${renderBillingProfileDrawer(client, rerender)}
      ${renderSelectedOrderDrawer(client)}
    </div>
  `;
}

export function __resetCostBudgetOrdersPageForTest(): void {
  state.loading = false;
  state.error = null;
  state.notice = null;
  state.orders = [];
  state.bankTransfer = null;
  state.selectedOrderId = null;
  state.busyOrderId = null;
  state.onlineCheckout = null;
  state.listFilter = { ...DEFAULT_COMMERCIAL_ORDERS_LIST_FILTER };
  loaded = false;
  lastClient = null;
  rerenderFn = null;
  pageOptions = undefined;
  __resetInvoiceContextForTest();
}

export function openCostBudgetOrderCheckout(orderId: string): void {
  state.selectedOrderId = orderId;
  rerenderFn?.();
}
