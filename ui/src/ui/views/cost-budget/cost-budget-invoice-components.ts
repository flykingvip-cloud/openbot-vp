/**
 * 发票与开票 — 可组合 UI 组件（Phase 3）。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../i18n/index.ts";
import type {
  CommercialOrderDetail,
  InvoiceRequest,
} from "../../capability/cost-budget-billing/index.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  closeBillingProfileDrawer,
  invoiceContext,
  saveBillingProfile,
  type BillingProfileDraft,
} from "./cost-budget-invoice-context.ts";
import type { CostBudgetTemplate } from "./cost-budget-table.ts";

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

export function invoiceStatusLabel(status: InvoiceRequest["status"]): string {
  switch (status) {
    case "pending":
      return t("costBudget.invoices.statusPending");
    case "issued":
      return t("costBudget.invoices.statusIssued");
    case "rejected":
      return t("costBudget.invoices.statusRejected");
    default:
      return status;
  }
}

function invoiceTypeLabel(type: BillingProfileDraft["invoiceType"]): string {
  switch (type) {
    case "vat_special":
      return t("costBudget.invoices.typeVatSpecial");
    case "vat_normal":
      return t("costBudget.invoices.typeVatNormal");
    case "electronic":
      return t("costBudget.invoices.typeElectronic");
    default:
      return type;
  }
}

export function renderInvoiceNotice(notice: string | null): CostBudgetTemplate {
  if (!notice) {
    return nothing;
  }
  if (notice === "profile_saved") {
    return html`<div class="callout success">${t("costBudget.invoices.noticeProfileSaved")}</div>`;
  }
  if (notice.startsWith("requested:")) {
    const orderId = notice.slice("requested:".length);
    return html`<div class="callout success">${t("costBudget.invoices.noticeRequested", { orderId })}</div>`;
  }
  return html`<div class="callout">${notice}</div>`;
}

export type BillingProfileFormProps = {
  draft: BillingProfileDraft;
  profileComplete: boolean;
  savingProfile: boolean;
  onDraftChange: (patch: Partial<BillingProfileDraft>) => void;
  onSave: () => void;
};

export function renderBillingProfileForm(props: BillingProfileFormProps): TemplateResult {
  const draft = props.draft;
  return html`
    <section class="cost-budget-invoices__profile" data-testid="billing-profile-form">
      <div class="card-title">${t("costBudget.invoices.profileTitle")}</div>
      <p class="muted">${t("costBudget.invoices.profileSub")}</p>
      ${
        !props.profileComplete
          ? html`<div class="callout info">${t("costBudget.invoices.profileIncomplete")}</div>`
          : nothing
      }
      <div class="cost-budget-invoices__form-grid">
        <label>
          <span>${t("costBudget.invoices.legalName")}</span>
          <input
            type="text"
            .value=${draft.legalName}
            @input=${(event: Event) => {
              props.onDraftChange({ legalName: (event.target as HTMLInputElement).value });
            }}
          />
        </label>
        <label>
          <span>${t("costBudget.invoices.taxId")}</span>
          <input
            type="text"
            .value=${draft.taxId}
            @input=${(event: Event) => {
              props.onDraftChange({ taxId: (event.target as HTMLInputElement).value });
            }}
          />
        </label>
        <label>
          <span>${t("costBudget.invoices.invoiceType")}</span>
          <select
            .value=${draft.invoiceType}
            @change=${(event: Event) => {
              props.onDraftChange({
                invoiceType: (event.target as HTMLSelectElement)
                  .value as BillingProfileDraft["invoiceType"],
              });
            }}
          >
            <option value="vat_special">${invoiceTypeLabel("vat_special")}</option>
            <option value="vat_normal">${invoiceTypeLabel("vat_normal")}</option>
            <option value="electronic">${invoiceTypeLabel("electronic")}</option>
          </select>
        </label>
        <label>
          <span>${t("costBudget.invoices.bankAccount")}</span>
          <input
            type="text"
            .value=${draft.bankAccount}
            @input=${(event: Event) => {
              props.onDraftChange({ bankAccount: (event.target as HTMLInputElement).value });
            }}
          />
        </label>
        <label>
          <span>${t("costBudget.invoices.address")}</span>
          <input
            type="text"
            .value=${draft.address}
            @input=${(event: Event) => {
              props.onDraftChange({ address: (event.target as HTMLInputElement).value });
            }}
          />
        </label>
        <label>
          <span>${t("costBudget.invoices.contactEmail")}</span>
          <input
            type="email"
            .value=${draft.contactEmail}
            @input=${(event: Event) => {
              props.onDraftChange({ contactEmail: (event.target as HTMLInputElement).value });
            }}
          />
        </label>
      </div>
      <div class="cost-budget-invoices__actions">
        <button
          type="button"
          class="btn btn--sm btn--primary"
          data-testid="billing-profile-save"
          ?disabled=${props.savingProfile}
          @click=${props.onSave}
        >
          ${props.savingProfile ? t("costBudget.invoices.busy") : t("costBudget.invoices.saveProfile")}
        </button>
      </div>
    </section>
  `;
}

export function renderBillingProfileDrawer(
  client: GatewayBrowserClient,
  rerender: () => void,
): CostBudgetTemplate {
  if (!invoiceContext.profileDrawerOpen) {
    return nothing;
  }
  return html`
    <div
      class="model-assets-drawer-overlay cost-budget-invoice-drawer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label=${t("costBudget.invoices.profileTitle")}
      data-testid="billing-profile-drawer"
      @click=${() => closeBillingProfileDrawer()}
    >
      <aside
        class="model-assets-drawer cost-budget-invoice-drawer"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <div class="model-assets-drawer__header">
          <div>
            <div class="model-assets-drawer__title">${t("costBudget.invoices.profileTitle")}</div>
            <div class="model-assets-drawer__sub">${t("costBudget.invoices.profileDrawerSub")}</div>
          </div>
          <button
            type="button"
            class="btn btn--sm btn--ghost"
            data-testid="billing-profile-drawer-close"
            @click=${() => closeBillingProfileDrawer()}
          >
            ${t("costBudget.invoices.closeDrawer")}
          </button>
        </div>
        <div class="model-assets-drawer__body">
          ${renderBillingProfileForm({
            draft: invoiceContext.profileDraft,
            profileComplete: invoiceContext.profileComplete,
            savingProfile: invoiceContext.savingProfile,
            onDraftChange: (patch) => {
              Object.assign(invoiceContext.profileDraft, patch);
              rerender();
            },
            onSave: () => void saveBillingProfile(client),
          })}
        </div>
      </aside>
    </div>
  `;
}

export type RequestInvoiceActionProps = {
  order: CommercialOrderDetail;
  profileComplete: boolean;
  existingRequest: InvoiceRequest | undefined;
  busy: boolean;
  onRequest: () => void;
  onOpenProfile: () => void;
};

export function renderRequestInvoiceAction(props: RequestInvoiceActionProps): TemplateResult {
  const { existingRequest, profileComplete, busy } = props;
  return html`
    <section class="card cost-budget-order-invoice" data-testid="order-invoice-action">
      <div class="card-title">${t("costBudget.invoices.orderSectionTitle")}</div>
      ${
        existingRequest
          ? html`
              <div class="cost-budget-order-invoice__status" data-testid="order-invoice-status">
                <span>${invoiceStatusLabel(existingRequest.status)}</span>
                ${
                  existingRequest.status === "issued"
                    ? html`
                        <span>${existingRequest.invoiceNo ?? "—"}</span>
                        ${
                          existingRequest.pdfUrl
                            ? html`
                                <a
                                  href=${existingRequest.pdfUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  ${t("costBudget.invoices.downloadPdf")}
                                </a>
                              `
                            : nothing
                        }
                      `
                    : existingRequest.status === "rejected"
                      ? html`<span class="muted">${existingRequest.rejectReason ?? "—"}</span>`
                      : html`<span class="muted">${t("costBudget.invoices.orderPendingHint")}</span>`
                }
              </div>
            `
          : html`
              <p class="muted">${t("costBudget.invoices.orderSectionSub")}</p>
              <div class="cost-budget-order-invoice__actions">
                ${
                  profileComplete
                    ? html`
                        <button
                          type="button"
                          class="btn btn--sm btn--primary"
                          data-testid="invoice-request-order"
                          ?disabled=${busy}
                          @click=${props.onRequest}
                        >
                          ${busy ? t("costBudget.invoices.busy") : t("costBudget.invoices.requestInvoice")}
                        </button>
                      `
                    : html`
                        <div class="callout info">${t("costBudget.invoices.profileIncomplete")}</div>
                        <button
                          type="button"
                          class="btn btn--sm"
                          data-testid="invoice-open-profile"
                          @click=${props.onOpenProfile}
                        >
                          ${t("costBudget.invoices.manageProfile")}
                        </button>
                      `
                }
              </div>
            `
      }
    </section>
  `;
}

export type InvoiceRequestListProps = {
  requests: InvoiceRequest[];
  /** 仅展示与某订单相关的申请（订单详情 embed 模式）。 */
  filterOrderId?: string;
  compact?: boolean;
};

export function renderInvoiceRequestList(props: InvoiceRequestListProps): TemplateResult {
  const rows = props.filterOrderId
    ? props.requests.filter((request) => request.orderId === props.filterOrderId)
    : props.requests;
  if (rows.length === 0) {
    return html`<div class="enterprise-empty">${t("costBudget.invoices.emptyRequests")}</div>`;
  }
  return html`
    <div class="table-wrap">
      <table
        class="table table--compact"
        data-testid="invoice-requests-table"
        data-compact=${props.compact ? "true" : nothing}
      >
        <thead>
          <tr>
            <th>${t("costBudget.invoices.colRequest")}</th>
            ${props.filterOrderId ? nothing : html`<th>${t("costBudget.invoices.colTarget")}</th>`}
            <th>${t("costBudget.invoices.colAmount")}</th>
            <th>${t("costBudget.invoices.colStatus")}</th>
            <th>${t("costBudget.invoices.colCreated")}</th>
            <th>${t("costBudget.invoices.colInvoiceNo")}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (request) => html`
              <tr>
                <td><code>${request.id}</code></td>
                ${
                  props.filterOrderId
                    ? nothing
                    : html`
                        <td>
                          ${
                            request.orderId
                              ? html`<span>${t("costBudget.invoices.targetOrder")} ${request.orderId}</span>`
                              : request.billId
                                ? html`<span>${t("costBudget.invoices.targetBill")} ${request.billId}</span>`
                                : "—"
                          }
                        </td>
                      `
                }
                <td>${fmtMoney(request.amountCents)}</td>
                <td>${invoiceStatusLabel(request.status)}</td>
                <td>${fmtTime(request.createdAt)}</td>
                <td>
                  ${
                    request.status === "issued"
                      ? html`
                          <span>${request.invoiceNo ?? "—"}</span>
                          ${
                            request.pdfUrl
                              ? html`
                                  <a href=${request.pdfUrl} target="_blank" rel="noopener noreferrer">
                                    ${t("costBudget.invoices.downloadPdf")}
                                  </a>
                                `
                              : nothing
                          }
                        `
                      : request.status === "rejected"
                        ? html`<span class="muted">${request.rejectReason ?? "—"}</span>`
                        : html`
                            <span class="muted">—</span>
                          `
                  }
                </td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

export type InvoiceEligibleOrdersProps = {
  paidOrders: CommercialOrderDetail[];
  profileComplete: boolean;
  busyOrderId: string | null;
  hasOpenRequest: (orderId: string) => boolean;
  onRequest: (orderId: string) => void;
};

export function renderInvoiceEligibleOrders(props: InvoiceEligibleOrdersProps): TemplateResult {
  if (props.paidOrders.length === 0) {
    return html`<div class="enterprise-empty">${t("costBudget.invoices.noPaidOrders")}</div>`;
  }
  return html`
    <div class="table-wrap">
      <table class="table table--compact" data-testid="invoice-eligible-orders">
        <thead>
          <tr>
            <th>${t("costBudget.invoices.colOrder")}</th>
            <th>${t("costBudget.invoices.colAmount")}</th>
            <th>${t("costBudget.invoices.colPaidAt")}</th>
            <th>${t("costBudget.invoices.colActions")}</th>
          </tr>
        </thead>
        <tbody>
          ${props.paidOrders.map((order) => {
            const busy = props.busyOrderId === order.id;
            const blocked = props.hasOpenRequest(order.id);
            return html`
              <tr>
                <td><code>${order.id}</code></td>
                <td>${fmtMoney(order.amountCents)}</td>
                <td>${fmtTime(order.paidAt ?? order.createdAt)}</td>
                <td>
                  ${
                    blocked
                      ? html`<span class="muted">${t("costBudget.invoices.alreadyRequested")}</span>`
                      : html`
                          <button
                            type="button"
                            class="btn btn--sm"
                            data-testid="invoice-request-order"
                            ?disabled=${busy || !props.profileComplete}
                            @click=${() => props.onRequest(order.id)}
                          >
                            ${busy ? t("costBudget.invoices.busy") : t("costBudget.invoices.requestInvoice")}
                          </button>
                        `
                  }
                </td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </div>
  `;
}
