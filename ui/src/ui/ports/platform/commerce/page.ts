/**
 * 平台商业核销工作台：待支付队列 + paid-unfulfilled 重试 + 销售线索转单。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import { createCostBudgetGateway } from "../../../capability/cost-budget-billing/gateway-client.ts";
import type { Plan } from "../../../capability/cost-budget-billing/index.ts";
import {
  createSubscriptionCommerceGateway,
  type CommercialOrder,
  type Payment,
  type SalesLead,
  type InvoiceRequest,
} from "../../../capability/subscription-commerce/index.ts";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import { isTransientGatewayError } from "../pricing/gateway-load-retry.ts";

type CommerceWorkbenchState = {
  loading: boolean;
  error: string | null;
  notice: string | null;
  pendingPayment: CommercialOrder[];
  paidUnfulfilled: CommercialOrder[];
  paymentsByOrderId: Record<string, Payment>;
  leads: SalesLead[];
  plans: Plan[];
  pendingInvoices: InvoiceRequest[];
  invoiceDraft: Record<
    string,
    { invoiceNo: string; pdfUrl: string; rejectReason: string; mode: "issue" | "reject" | null }
  >;
  busyOrderId: string | null;
  busyInvoiceId: string | null;
  leadDraft: Record<
    string,
    { enterpriseId: string; amountYuan: string; planId: string; open: boolean }
  >;
};

const state: CommerceWorkbenchState = {
  loading: false,
  error: null,
  notice: null,
  pendingPayment: [],
  paidUnfulfilled: [],
  paymentsByOrderId: {},
  leads: [],
  plans: [],
  pendingInvoices: [],
  invoiceDraft: {},
  busyOrderId: null,
  busyInvoiceId: null,
  leadDraft: {},
};

let loaded = false;
let lastClient: GatewayBrowserClient | null = null;
let rerenderFn: (() => void) | null = null;
let loadRetryTimer: ReturnType<typeof setTimeout> | null = null;

function cancelCommerceLoadRetry(): void {
  if (loadRetryTimer !== null) {
    clearTimeout(loadRetryTimer);
    loadRetryTimer = null;
  }
}

function scheduleCommerceLoadRetry(client: GatewayBrowserClient): void {
  if (loadRetryTimer !== null) {
    return;
  }
  loadRetryTimer = setTimeout(() => {
    loadRetryTimer = null;
    if (!loaded && lastClient === client && !state.loading) {
      void reload(client);
    }
  }, 800);
}

function fmtMoney(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function leadDraft(leadId: string, planId?: string) {
  if (!state.leadDraft[leadId]) {
    state.leadDraft[leadId] = {
      enterpriseId: "",
      amountYuan: "",
      planId: planId ?? state.plans[0]?.id ?? "",
      open: false,
    };
  }
  return state.leadDraft[leadId];
}

async function reload(client: GatewayBrowserClient): Promise<void> {
  state.loading = true;
  state.error = null;
  rerenderFn?.();
  try {
    const commerce = createSubscriptionCommerceGateway(client);
    const billing = createCostBudgetGateway(client);
    const [queue, leadsRes, plansRes, invoicesRes] = await Promise.all([
      commerce.listReconcileQueue(),
      commerce.listSalesLeads(),
      billing.listPlans(),
      commerce.listPlatformInvoiceRequests("pending"),
    ]);
    state.pendingPayment = queue.pendingPayment;
    state.paidUnfulfilled = queue.paidUnfulfilled;
    state.paymentsByOrderId = queue.paymentsByOrderId ?? {};
    state.leads = leadsRes.leads;
    state.plans = plansRes.plans;
    state.pendingInvoices = invoicesRes.requests;
    loaded = true;
    cancelCommerceLoadRetry();
  } catch (err) {
    if (isTransientGatewayError(err)) {
      loaded = false;
      state.error = null;
      scheduleCommerceLoadRetry(client);
    } else {
      state.error = err instanceof Error ? err.message : String(err);
    }
  } finally {
    state.loading = false;
    rerenderFn?.();
  }
}

function ensureLoaded(client: GatewayBrowserClient, rerender: () => void): void {
  rerenderFn = rerender;
  if (client !== lastClient) {
    lastClient = client;
    loaded = false;
  }
  if (!loaded && !state.loading) {
    void reload(client);
  }
}

async function confirmOrder(client: GatewayBrowserClient, order: CommercialOrder): Promise<void> {
  const payment = state.paymentsByOrderId[order.id];
  if (!payment) {
    state.error = t("platformCommerce.errorNoPayment");
    rerenderFn?.();
    return;
  }
  state.busyOrderId = order.id;
  state.error = null;
  rerenderFn?.();
  try {
    const commerce = createSubscriptionCommerceGateway(client);
    await commerce.confirmManualPayment(payment.id, `confirm:${order.id}`);
    state.notice = t("platformCommerce.noticeConfirmed", { orderId: order.id });
    await reload(client);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.busyOrderId = null;
    rerenderFn?.();
  }
}

async function retryFulfillment(
  client: GatewayBrowserClient,
  order: CommercialOrder,
): Promise<void> {
  state.busyOrderId = order.id;
  state.error = null;
  rerenderFn?.();
  try {
    const commerce = createSubscriptionCommerceGateway(client);
    await commerce.retryFulfillment(order.id);
    state.notice = t("platformCommerce.noticeRetried", { orderId: order.id });
    await reload(client);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.busyOrderId = null;
    rerenderFn?.();
  }
}

function invoiceDraftFor(requestId: string) {
  if (!state.invoiceDraft[requestId]) {
    state.invoiceDraft[requestId] = {
      invoiceNo: "",
      pdfUrl: "",
      rejectReason: "",
      mode: null,
    };
  }
  return state.invoiceDraft[requestId];
}

async function issueInvoiceRequest(
  client: GatewayBrowserClient,
  request: InvoiceRequest,
): Promise<void> {
  const draft = invoiceDraftFor(request.id);
  if (!draft.invoiceNo.trim()) {
    state.error = t("platformCommerce.invoiceNo");
    rerenderFn?.();
    return;
  }
  state.busyInvoiceId = request.id;
  state.error = null;
  rerenderFn?.();
  try {
    const commerce = createSubscriptionCommerceGateway(client);
    await commerce.issueInvoice(
      request.id,
      draft.invoiceNo.trim(),
      draft.pdfUrl.trim() || undefined,
    );
    state.notice = t("platformCommerce.noticeIssued", { requestId: request.id });
    draft.mode = null;
    await reload(client);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.busyInvoiceId = null;
    rerenderFn?.();
  }
}

async function rejectInvoiceRequest(
  client: GatewayBrowserClient,
  request: InvoiceRequest,
): Promise<void> {
  const draft = invoiceDraftFor(request.id);
  if (!draft.rejectReason.trim()) {
    state.error = t("platformCommerce.rejectReason");
    rerenderFn?.();
    return;
  }
  state.busyInvoiceId = request.id;
  state.error = null;
  rerenderFn?.();
  try {
    const commerce = createSubscriptionCommerceGateway(client);
    await commerce.rejectInvoice(request.id, draft.rejectReason.trim());
    state.notice = t("platformCommerce.noticeRejected", { requestId: request.id });
    draft.mode = null;
    await reload(client);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.busyInvoiceId = null;
    rerenderFn?.();
  }
}

function renderInvoiceRow(client: GatewayBrowserClient, request: InvoiceRequest): TemplateResult {
  const draft = invoiceDraftFor(request.id);
  const busy = state.busyInvoiceId === request.id;
  return html`
    <tr data-testid="commerce-invoice-row">
      <td><code>${request.id}</code></td>
      <td><code>${request.enterpriseId}</code></td>
      <td>${request.orderId ?? request.billId ?? "—"}</td>
      <td>${fmtMoney(request.amountCents)}</td>
      <td>${fmtTime(request.createdAt)}</td>
      <td>
        <button
          type="button"
          class="btn btn--sm"
          ?disabled=${busy}
          @click=${() => {
            draft.mode = draft.mode === "issue" ? null : "issue";
            rerenderFn?.();
          }}
        >
          ${t("platformCommerce.issueInvoice")}
        </button>
        <button
          type="button"
          class="btn btn--sm"
          ?disabled=${busy}
          @click=${() => {
            draft.mode = draft.mode === "reject" ? null : "reject";
            rerenderFn?.();
          }}
        >
          ${t("platformCommerce.rejectInvoice")}
        </button>
        ${
          draft.mode === "issue"
            ? html`
                <div class="platform-commerce__invoice-form">
                  <input
                    type="text"
                    placeholder=${t("platformCommerce.invoiceNo")}
                    .value=${draft.invoiceNo}
                    @input=${(event: Event) => {
                      draft.invoiceNo = (event.target as HTMLInputElement).value;
                    }}
                  />
                  <input
                    type="url"
                    placeholder=${t("platformCommerce.pdfUrl")}
                    .value=${draft.pdfUrl}
                    @input=${(event: Event) => {
                      draft.pdfUrl = (event.target as HTMLInputElement).value;
                    }}
                  />
                  <button
                    type="button"
                    class="btn btn--sm btn--primary"
                    ?disabled=${busy}
                    @click=${() => void issueInvoiceRequest(client, request)}
                  >
                    ${busy ? t("platformCommerce.busy") : t("platformCommerce.issueInvoice")}
                  </button>
                </div>
              `
            : nothing
        }
        ${
          draft.mode === "reject"
            ? html`
                <div class="platform-commerce__invoice-form">
                  <input
                    type="text"
                    placeholder=${t("platformCommerce.rejectReason")}
                    .value=${draft.rejectReason}
                    @input=${(event: Event) => {
                      draft.rejectReason = (event.target as HTMLInputElement).value;
                    }}
                  />
                  <button
                    type="button"
                    class="btn btn--sm"
                    ?disabled=${busy}
                    @click=${() => void rejectInvoiceRequest(client, request)}
                  >
                    ${busy ? t("platformCommerce.busy") : t("platformCommerce.rejectInvoice")}
                  </button>
                </div>
              `
            : nothing
        }
      </td>
    </tr>
  `;
}

function renderInvoicesSection(client: GatewayBrowserClient): TemplateResult {
  return html`
    <section class="card platform-commerce__section" data-testid="commerce-invoices-section">
      <div class="card-title">${t("platformCommerce.invoicesTitle")}</div>
      ${
        state.pendingInvoices.length === 0
          ? html`<div class="muted platform-commerce__empty">${t("platformCommerce.invoicesEmpty")}</div>`
          : html`
              <div class="table-wrap">
                <table class="table table--compact">
                  <thead>
                    <tr>
                      <th>${t("platformCommerce.colRequestId")}</th>
                      <th>${t("platformCommerce.colEnterprise")}</th>
                      <th>${t("platformCommerce.colOrderId")}</th>
                      <th>${t("platformCommerce.colInvoiceAmount")}</th>
                      <th>${t("platformCommerce.colCreated")}</th>
                      <th>${t("platformCommerce.colActions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${state.pendingInvoices.map((request) => renderInvoiceRow(client, request))}
                  </tbody>
                </table>
              </div>
            `
      }
    </section>
  `;
}

async function createFromLead(client: GatewayBrowserClient, lead: SalesLead): Promise<void> {
  const draft = leadDraft(lead.id, lead.planId);
  if (!draft.enterpriseId.trim()) {
    state.error = t("platformCommerce.errorEnterpriseRequired");
    rerenderFn?.();
    return;
  }
  if (!draft.planId.trim()) {
    state.error = t("platformCommerce.errorPlanRequired");
    rerenderFn?.();
    return;
  }
  state.busyOrderId = lead.id;
  state.error = null;
  rerenderFn?.();
  try {
    const commerce = createSubscriptionCommerceGateway(client);
    const amountYuan = draft.amountYuan.trim();
    const amountCents =
      amountYuan.length > 0 ? Math.round(Number.parseFloat(amountYuan) * 100) : undefined;
    await commerce.createOrderFromLead({
      leadId: lead.id,
      enterpriseId: draft.enterpriseId.trim(),
      planId: draft.planId,
      ...(amountCents !== undefined && Number.isFinite(amountCents) ? { amountCents } : {}),
    });
    state.notice = t("platformCommerce.noticeFromLead", { company: lead.company });
    draft.open = false;
    await reload(client);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
  } finally {
    state.busyOrderId = null;
    rerenderFn?.();
  }
}

function renderOrderRow(
  client: GatewayBrowserClient,
  order: CommercialOrder,
  mode: "pending" | "unfulfilled",
): TemplateResult {
  const busy = state.busyOrderId === order.id;
  return html`
    <tr data-testid="commerce-order-row">
      <td><code>${order.id}</code></td>
      <td><code>${order.enterpriseId}</code></td>
      <td>${order.kind}</td>
      <td>${fmtMoney(order.amountCents)}</td>
      <td>${fmtTime(order.createdAt)}</td>
      <td>
        ${
          mode === "pending"
            ? html`
                <button
                  type="button"
                  class="btn btn--sm btn--primary"
                  data-testid="commerce-confirm"
                  ?disabled=${busy}
                  @click=${() => void confirmOrder(client, order)}
                >
                  ${busy ? t("platformCommerce.busy") : t("platformCommerce.confirmPayment")}
                </button>
              `
            : html`
                <div class="platform-commerce__error muted">${order.fulfillmentError ?? "—"}</div>
                <button
                  type="button"
                  class="btn btn--sm"
                  data-testid="commerce-retry"
                  ?disabled=${busy}
                  @click=${() => void retryFulfillment(client, order)}
                >
                  ${busy ? t("platformCommerce.busy") : t("platformCommerce.retryFulfillment")}
                </button>
              `
        }
      </td>
    </tr>
  `;
}

function renderOrdersTable(
  client: GatewayBrowserClient,
  title: string,
  orders: CommercialOrder[],
  mode: "pending" | "unfulfilled",
  emptyLabel: string,
): TemplateResult {
  return html`
    <section class="card platform-commerce__section" data-testid="commerce-${mode}-section">
      <div class="card-title">${title}</div>
      ${
        orders.length === 0
          ? html`<div class="muted platform-commerce__empty">${emptyLabel}</div>`
          : html`
              <div class="table-wrap">
                <table class="table table--compact">
                  <thead>
                    <tr>
                      <th>${t("platformCommerce.colOrderId")}</th>
                      <th>${t("platformCommerce.colEnterprise")}</th>
                      <th>${t("platformCommerce.colKind")}</th>
                      <th>${t("platformCommerce.colAmount")}</th>
                      <th>${t("platformCommerce.colCreated")}</th>
                      <th>${t("platformCommerce.colActions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${orders.map((order) => renderOrderRow(client, order, mode))}
                  </tbody>
                </table>
              </div>
            `
      }
    </section>
  `;
}

function renderLeadRow(client: GatewayBrowserClient, lead: SalesLead): TemplateResult {
  const draft = leadDraft(lead.id, lead.planId);
  const busy = state.busyOrderId === lead.id;
  const planOptions = state.plans.map(
    (plan) =>
      html`<option value=${plan.id} ?selected=${draft.planId === plan.id}>${plan.name}</option>`,
  );
  return html`
    <tr data-testid="commerce-lead-row">
      <td>${lead.company}</td>
      <td>${lead.contact}<br /><span class="muted">${lead.phone}</span></td>
      <td>${fmtTime(lead.createdAt)}</td>
      <td>
        <button
          type="button"
          class="btn btn--sm"
          data-testid="commerce-lead-toggle"
          @click=${() => {
            draft.open = !draft.open;
            rerenderFn?.();
          }}
        >
          ${draft.open ? t("platformCommerce.leadCollapse") : t("platformCommerce.leadCreateOrder")}
        </button>
        ${
          draft.open
            ? html`
                <div class="platform-commerce__lead-form" data-testid="commerce-lead-form">
                  <label>
                    <span>${t("platformCommerce.leadEnterpriseId")}</span>
                    <input
                      type="text"
                      .value=${draft.enterpriseId}
                      @input=${(event: Event) => {
                        draft.enterpriseId = (event.target as HTMLInputElement).value;
                      }}
                    />
                  </label>
                  <label>
                    <span>${t("platformCommerce.leadPlan")}</span>
                    <select
                      .value=${draft.planId}
                      @change=${(event: Event) => {
                        draft.planId = (event.target as HTMLSelectElement).value;
                      }}
                    >
                      ${planOptions}
                    </select>
                  </label>
                  <label>
                    <span>${t("platformCommerce.leadAmountOptional")}</span>
                    <input
                      type="text"
                      inputmode="decimal"
                      placeholder=${t("platformCommerce.leadAmountPlaceholder")}
                      .value=${draft.amountYuan}
                      @input=${(event: Event) => {
                        draft.amountYuan = (event.target as HTMLInputElement).value;
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    class="btn btn--sm btn--primary"
                    data-testid="commerce-lead-submit"
                    ?disabled=${busy}
                    @click=${() => void createFromLead(client, lead)}
                  >
                    ${busy ? t("platformCommerce.busy") : t("platformCommerce.leadSubmit")}
                  </button>
                </div>
              `
            : nothing
        }
      </td>
    </tr>
  `;
}

export function renderPlatformCommerceWorkbench(
  client: GatewayBrowserClient,
  rerender: () => void,
): TemplateResult {
  ensureLoaded(client, rerender);

  return html`
    <div class="platform-commerce" data-testid="platform-commerce-workbench">
      <header class="platform-commerce__header">
        <div>
          <h2 class="platform-commerce__title">${t("platformCommerce.title")}</h2>
          <p class="muted platform-commerce__sub">${t("platformCommerce.subtitle")}</p>
        </div>
        <button
          type="button"
          class="btn btn--sm"
          data-testid="commerce-refresh"
          ?disabled=${state.loading}
          @click=${() => void reload(client)}
        >
          ${state.loading ? t("platformCommerce.loading") : t("platformCommerce.refresh")}
        </button>
      </header>
      ${state.error ? html`<div class="callout warning">${state.error}</div>` : nothing}
      ${state.notice ? html`<div class="callout">${state.notice}</div>` : nothing}
      ${renderOrdersTable(
        client,
        t("platformCommerce.pendingTitle"),
        state.pendingPayment,
        "pending",
        t("platformCommerce.pendingEmpty"),
      )}
      ${renderOrdersTable(
        client,
        t("platformCommerce.unfulfilledTitle"),
        state.paidUnfulfilled,
        "unfulfilled",
        t("platformCommerce.unfulfilledEmpty"),
      )}
      ${renderInvoicesSection(client)}
      <section class="card platform-commerce__section" data-testid="commerce-leads-section">
        <div class="card-title">${t("platformCommerce.leadsTitle")}</div>
        ${
          state.leads.length === 0
            ? html`<div class="muted platform-commerce__empty">${t("platformCommerce.leadsEmpty")}</div>`
            : html`
                <div class="table-wrap">
                  <table class="table table--compact">
                    <thead>
                      <tr>
                        <th>${t("platformCommerce.colCompany")}</th>
                        <th>${t("platformCommerce.colContact")}</th>
                        <th>${t("platformCommerce.colCreated")}</th>
                        <th>${t("platformCommerce.colActions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${state.leads.map((lead) => renderLeadRow(client, lead))}
                    </tbody>
                  </table>
                </div>
              `
        }
      </section>
    </div>
  `;
}

export function __resetPlatformCommerceWorkbenchForTest(): void {
  state.loading = false;
  state.error = null;
  state.notice = null;
  state.pendingPayment = [];
  state.paidUnfulfilled = [];
  state.paymentsByOrderId = {};
  state.leads = [];
  state.plans = [];
  state.pendingInvoices = [];
  state.invoiceDraft = {};
  state.busyOrderId = null;
  state.busyInvoiceId = null;
  state.leadDraft = {};
  loaded = false;
  lastClient = null;
  rerenderFn = null;
  cancelCommerceLoadRetry();
}

export function reloadPlatformCommerceWorkbench(client: GatewayBrowserClient): void {
  cancelCommerceLoadRetry();
  loaded = false;
  lastClient = client;
  void reload(client);
}
