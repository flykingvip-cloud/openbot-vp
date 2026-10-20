import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../i18n/index.ts";
import type {
  CommercialOrderDetail,
  InvoiceRequest,
} from "../../capability/cost-budget-billing/index.ts";
import { renderIcon } from "../../icons.ts";

export type CommercialOrderStatusTone = "success" | "warning" | "danger" | "neutral" | "info";

/** 将内部 UUID 订单号格式化为对外展示编号：OB-YYYYMMDD-XXXX */
export function formatCommercialOrderNo(orderId: string, createdAt?: string): string {
  const datePart = formatOrderDatePart(createdAt);
  const raw = orderId.replace(/^ord-/, "").replace(/-/g, "");
  const suffix = (raw.slice(0, 4) || "0000").toUpperCase();
  return `OB-${datePart}-${suffix}`;
}

/** 表格内弱化展示：OB-·····6016 */
export function formatCommercialOrderNoMasked(
  orderId: string,
  createdAt?: string,
): {
  prefix: string;
  suffix: string;
  full: string;
} {
  const full = formatCommercialOrderNo(orderId, createdAt);
  return {
    prefix: "OB-·····",
    suffix: full.slice(-4),
    full,
  };
}

const PLAN_TIER_TAGS: Record<string, string> = {
  试用版: "TRIAL",
  基础版: "BASIC",
  专业版: "BUSINESS",
  旗舰版: "PRO",
  卓越版: "ENTERPRISE",
};

export function resolvePlanTierTag(planName: string): string | undefined {
  return PLAN_TIER_TAGS[planName];
}

export function summarizeCommercialOrders(orders: Array<{ status: string; amountCents: number }>): {
  count: number;
  paidCount: number;
  pendingCount: number;
  totalCents: number;
} {
  const paid = orders.filter((order) => order.status === "paid");
  const pending = orders.filter((order) => order.status === "pending_payment");
  return {
    count: orders.length,
    paidCount: paid.length,
    pendingCount: pending.length,
    totalCents: paid.reduce((sum, order) => sum + order.amountCents, 0),
  };
}

export type CommercialOrderListStats = ReturnType<typeof summarizeCommercialOrders>;

export function renderCommercialOrderListStats(
  stats: CommercialOrderListStats,
  options?: { pendingFilterActive?: boolean; onPendingFilterToggle?: () => void },
): TemplateResult {
  const total = fmtCommercialOrderMoneySummary(stats.totalCents);
  return html`
    <p class="cost-budget-orders__panel-stats" data-testid="orders-list-stats">
      <span class="cost-budget-orders__stat-item">
        ${t("costBudget.orders.statCount", { count: String(stats.count) })}
      </span>
      <span class="cost-budget-orders__stat-sep" aria-hidden="true">·</span>
      <span class="cost-budget-orders__stat-item">
        ${t("costBudget.orders.statPaid", { paidCount: String(stats.paidCount) })}
      </span>
      ${
        stats.pendingCount > 0
          ? html`
              <span class="cost-budget-orders__stat-sep" aria-hidden="true">·</span>
              <button
                type="button"
                class="cost-budget-orders__stat-pending ${
                  options?.pendingFilterActive ? "is-active" : ""
                }"
                data-testid="orders-filter-pending"
                @click=${(event: Event) => {
                  event.stopPropagation();
                  options?.onPendingFilterToggle?.();
                }}
              >
                ${t("costBudget.orders.statPending", { pendingCount: String(stats.pendingCount) })}
              </button>
            `
          : nothing
      }
      <span class="cost-budget-orders__stat-sep" aria-hidden="true">·</span>
      <span class="cost-budget-orders__stat-item">
        ${t("costBudget.orders.statTotalPrefix")}
        <strong class="cost-budget-orders__stat-total">${total}</strong>
      </span>
    </p>
  `;
}

function formatOrderDatePart(iso?: string): string {
  if (!iso) {
    return "00000000";
  }
  try {
    const date = new Date(iso);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  } catch {
    return "00000000";
  }
}

/** @deprecated 使用 formatCommercialOrderNo */
export function shortCommercialOrderId(orderId: string): string {
  return formatCommercialOrderNo(orderId);
}

export function commercialOrderKindLabel(kind: string): string {
  const key = `costBudget.orders.kind.${kind}` as const;
  const label = t(key);
  return label === key ? kind : label;
}

const PLAN_LINE_META = new Set([
  "剩余周期抵扣",
  "剩余周期应付",
  "应付差价",
  "议价",
  "续费",
  "额外容量",
]);

/** 从订单行项目解析套餐/商品展示名（如「旗舰版」）。 */
export function resolveCommercialOrderPlanName(order: {
  kind: string;
  lineItems?: Array<{ label: string; amountCents: number }>;
}): string {
  const items = order.lineItems ?? [];
  if (order.kind === "change_plan") {
    const targetLine = items.find((line) => line.label.includes("剩余周期应付"));
    if (targetLine) {
      const name = extractPlanNameFromLineLabel(targetLine.label);
      if (name) {
        return name;
      }
    }
  }

  for (const line of items) {
    const name = extractPlanNameFromLineLabel(line.label);
    if (name && !PLAN_LINE_META.has(name)) {
      return name;
    }
  }

  return commercialOrderKindLabel(order.kind);
}

function extractPlanNameFromLineLabel(label: string): string {
  const parts = label
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return label.trim();
  }

  const payableIndex = parts.findIndex((part) => part === "剩余周期应付");
  if (payableIndex >= 0) {
    const candidate = parts[payableIndex + 1];
    if (candidate && !candidate.startsWith("v:")) {
      return candidate;
    }
  }

  const skipPrefixes = ["剩余周期抵扣", "剩余周期应付", "应付差价"];
  for (const part of parts) {
    if (skipPrefixes.some((prefix) => part.startsWith(prefix))) {
      continue;
    }
    if (part.startsWith("v:") || part === "monthly" || part === "yearly") {
      continue;
    }
    if (PLAN_LINE_META.has(part)) {
      continue;
    }
    if (part.endsWith("续费")) {
      return part.replace(/\s*·?\s*续费$/, "").trim();
    }
    return part;
  }

  return parts[0] ?? label.trim();
}

export function commercialOrderStatusLabel(status: string): string {
  switch (status) {
    case "pending_payment":
      return t("costBudget.orders.statusPending");
    case "paid":
      return t("costBudget.orders.statusPaid");
    case "canceled":
      return t("costBudget.orders.statusCanceled");
    case "failed":
      return t("costBudget.orders.statusFailed");
    default:
      return status;
  }
}

export function commercialOrderStatusTone(status: string): CommercialOrderStatusTone {
  switch (status) {
    case "paid":
      return "success";
    case "pending_payment":
      return "warning";
    case "failed":
      return "danger";
    case "canceled":
      return "neutral";
    default:
      return "info";
  }
}

export function renderCommercialOrderStatusBadge(status: string): TemplateResult {
  const tone = commercialOrderStatusTone(status);
  return html`
    <span class="cost-budget-orders__status-pill cost-budget-orders__status-pill--${tone}">
      <span class="cost-budget-orders__status-dot" aria-hidden="true"></span>
      ${commercialOrderStatusLabel(status)}
    </span>
  `;
}

export function renderCommercialOrderNoCell(
  orderId: string,
  createdAt: string | undefined,
  onCopy: (event: Event) => void,
): TemplateResult {
  const displayNo = formatCommercialOrderNo(orderId, createdAt);
  return html`
    <div class="cost-budget-orders__order-cell">
      <span
        class="cost-budget-orders__order-no cost-budget-orders__order-no--full"
        title=${t("costBudget.orders.orderNoTitle", { id: orderId })}
      >
        ${displayNo}
      </span>
      <button
        type="button"
        class="cost-budget-orders__copy-btn"
        data-testid="order-copy-id"
        title=${t("costBudget.orders.copyOrderNo")}
        aria-label=${t("costBudget.orders.copyOrderNo")}
        @click=${onCopy}
      >
        ${renderIcon("copy", "cost-budget-orders__copy-icon")}
      </button>
    </div>
  `;
}

export function renderCommercialOrderPlanCell(planName: string): TemplateResult {
  return html`
    <div class="cost-budget-orders__plan-cell">
      <div class="cost-budget-orders__plan-name">${planName}</div>
    </div>
  `;
}

export type CommercialOrderAmountVariant = "table" | "detail";

export function renderCommercialOrderAmount(
  cents: number,
  variant: CommercialOrderAmountVariant = "table",
): TemplateResult {
  const isZero = cents === 0;
  const yuan = Math.abs(cents) / 100;
  const intPart = Math.floor(yuan).toLocaleString("zh-CN");
  const decPart = String(Math.round(Math.abs(cents) % 100)).padStart(2, "0");
  return html`
    <span
      class="cost-budget-orders__amount cost-budget-orders__amount--${variant} ${
        isZero ? "cost-budget-orders__amount--zero" : ""
      }"
    >
      <span class="cost-budget-orders__amount-currency">¥</span>
      <span class="cost-budget-orders__amount-int">${intPart}</span>
      <span class="cost-budget-orders__amount-dec">.${decPart}</span>
    </span>
  `;
}

export function fmtCommercialOrderMoneySummary(cents: number): string {
  const yuan = cents / 100;
  return `¥${yuan.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export type CommercialOrderStatusCellProps = {
  status: string;
  busy?: boolean;
  onPay?: () => void;
};

export function renderCommercialOrderStatusCell(
  props: CommercialOrderStatusCellProps,
): TemplateResult {
  const { status, busy, onPay } = props;
  return html`
    <div class="cost-budget-orders__status-cell">
      ${renderCommercialOrderStatusBadge(status)}
      ${
        status === "pending_payment" && onPay
          ? html`
              <button
                type="button"
                class="cost-budget-orders__row-action"
                data-testid="order-pay-now"
                ?disabled=${busy}
                @click=${(event: Event) => {
                  event.stopPropagation();
                  onPay();
                }}
              >
                ${busy ? t("costBudget.orders.busy") : t("costBudget.orders.payNow")}
              </button>
            `
          : nothing
      }
    </div>
  `;
}

export type CommercialOrderInvoiceCellProps = {
  order: CommercialOrderDetail;
  existingRequest?: InvoiceRequest;
  profileComplete: boolean;
  busy: boolean;
  onRequest: () => void;
  onOpenProfile: () => void;
};

export function renderCommercialOrderInvoiceCell(
  props: CommercialOrderInvoiceCellProps,
): TemplateResult | string {
  const { order, existingRequest, profileComplete, busy } = props;
  if (order.status !== "paid") {
    return html`
      <span class="cost-budget-orders__invoice-na muted">—</span>
    `;
  }
  if (existingRequest) {
    if (existingRequest.status === "issued") {
      return html`
        <div class="cost-budget-orders__invoice-cell">
          <span class="cost-budget-orders__status-pill cost-budget-orders__status-pill--success">
            ${t("costBudget.orders.invoiceIssued")}
          </span>
          ${
            existingRequest.pdfUrl
              ? html`
                  <a
                    class="cost-budget-orders__invoice-link"
                    href=${existingRequest.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    @click=${(event: Event) => event.stopPropagation()}
                  >
                    ${t("costBudget.invoices.downloadPdf")}
                  </a>
                `
              : nothing
          }
        </div>
      `;
    }
    if (existingRequest.status === "rejected") {
      return html`
        <div class="cost-budget-orders__invoice-cell">
          <span class="cost-budget-orders__status-pill cost-budget-orders__status-pill--danger">
            ${t("costBudget.invoices.statusRejected")}
          </span>
          <button
            type="button"
            class="cost-budget-orders__text-btn"
            data-testid="invoice-request-order"
            ?disabled=${busy || !profileComplete}
            @click=${(event: Event) => {
              event.stopPropagation();
              props.onRequest();
            }}
          >
            ${t("costBudget.orders.invoiceRetry")}
          </button>
        </div>
      `;
    }
    return html`
      <span class="cost-budget-orders__status-pill cost-budget-orders__status-pill--info">
        ${t("costBudget.orders.invoiceReviewing")}
      </span>
    `;
  }
  if (!profileComplete) {
    return html`
      <button
        type="button"
        class="cost-budget-orders__text-btn cost-budget-orders__text-btn--accent"
        data-testid="invoice-open-profile"
        @click=${(event: Event) => {
          event.stopPropagation();
          props.onOpenProfile();
        }}
      >
        ${t("costBudget.orders.invoiceAction")} →
      </button>
    `;
  }
  return html`
    <button
      type="button"
      class="cost-budget-orders__text-btn cost-budget-orders__text-btn--accent"
      data-testid="invoice-request-order"
      ?disabled=${busy}
      @click=${(event: Event) => {
        event.stopPropagation();
        props.onRequest();
      }}
    >
      ${busy ? t("costBudget.orders.busy") : `${t("costBudget.orders.invoiceAction")} →`}
    </button>
  `;
}

export function fmtCommercialOrderMoney(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export type CommercialOrderCreatedAtOptions = {
  /** @deprecated 表格默认使用上下两行时间 */
  compact?: boolean;
};

export function renderCommercialOrderCreatedAt(
  iso?: string,
  options?: CommercialOrderCreatedAtOptions,
): TemplateResult | string {
  if (!iso) {
    return "—";
  }
  try {
    const date = new Date(iso);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const dateText = `${year}/${month}/${day}`;
    const timeText = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    if (options?.compact) {
      return html`
        <span class="cost-budget-orders__datetime cost-budget-orders__datetime--compact">
          <span class="cost-budget-orders__date">${dateText}</span>
          <span class="cost-budget-orders__time-sep" aria-hidden="true">·</span>
          <span class="cost-budget-orders__time">${timeText}</span>
        </span>
      `;
    }
    return html`
      <span class="cost-budget-orders__datetime">
        <span class="cost-budget-orders__date">${dateText}</span>
        <span class="cost-budget-orders__time">${timeText}</span>
      </span>
    `;
  } catch {
    return iso;
  }
}
