/**
 * 发票与开票 — 共享模块状态（Phase 3：orders 嵌入 + invoices 页 wrapper 共用）。
 */

import { createCostBudgetGateway } from "../../capability/cost-budget-billing/gateway-client.ts";
import type {
  InvoiceRequest,
  TenantBillingProfile,
} from "../../capability/cost-budget-billing/index.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";

export type BillingProfileDraft = {
  legalName: string;
  taxId: string;
  invoiceType: TenantBillingProfile["invoiceType"];
  bankAccount: string;
  address: string;
  contactEmail: string;
};

export type InvoiceContextState = {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  notice: string | null;
  profileComplete: boolean;
  profileDraft: BillingProfileDraft;
  requests: InvoiceRequest[];
  busyOrderId: string | null;
  savingProfile: boolean;
  profileDrawerOpen: boolean;
};

const defaultDraft = (): BillingProfileDraft => ({
  legalName: "",
  taxId: "",
  invoiceType: "vat_special",
  bankAccount: "",
  address: "",
  contactEmail: "",
});

export const invoiceContext: InvoiceContextState = {
  loading: false,
  loaded: false,
  error: null,
  notice: null,
  profileComplete: false,
  profileDraft: defaultDraft(),
  requests: [],
  busyOrderId: null,
  savingProfile: false,
  profileDrawerOpen: false,
};

let lastClient: GatewayBrowserClient | null = null;
let rerenderFn: (() => void) | null = null;

export function bindInvoiceContextRerender(rerender: () => void): void {
  rerenderFn = rerender;
}

export function openBillingProfileDrawer(): void {
  invoiceContext.profileDrawerOpen = true;
  rerenderFn?.();
}

export function closeBillingProfileDrawer(): void {
  invoiceContext.profileDrawerOpen = false;
  rerenderFn?.();
}

export function findInvoiceRequestForOrder(orderId: string): InvoiceRequest | undefined {
  return invoiceContext.requests.find(
    (request) => request.orderId === orderId && request.status !== "rejected",
  );
}

export function hasOpenInvoiceRequestForOrder(orderId: string): boolean {
  return Boolean(findInvoiceRequestForOrder(orderId));
}

export async function loadInvoiceContext(client: GatewayBrowserClient): Promise<void> {
  invoiceContext.loading = true;
  invoiceContext.error = null;
  rerenderFn?.();
  try {
    const gw = createCostBudgetGateway(client);
    const [profileRes, requestsRes] = await Promise.all([
      gw.getBillingProfile(),
      gw.listInvoiceRequests(),
    ]);
    invoiceContext.profileComplete = profileRes.complete;
    if (profileRes.profile) {
      invoiceContext.profileDraft = {
        legalName: profileRes.profile.legalName,
        taxId: profileRes.profile.taxId,
        invoiceType: profileRes.profile.invoiceType,
        bankAccount: profileRes.profile.bankAccount ?? "",
        address: profileRes.profile.address ?? "",
        contactEmail: profileRes.profile.contactEmail ?? "",
      };
    }
    invoiceContext.requests = requestsRes.requests;
    invoiceContext.loaded = true;
  } catch (err) {
    invoiceContext.error = err instanceof Error ? err.message : String(err);
    // 避免 load 失败后每次 rerender 重试导致无限循环
    invoiceContext.loaded = true;
  } finally {
    invoiceContext.loading = false;
    rerenderFn?.();
  }
}

export function ensureInvoiceContextLoaded(
  client: GatewayBrowserClient,
  rerender: () => void,
): void {
  bindInvoiceContextRerender(rerender);
  if (client !== lastClient) {
    lastClient = client;
    invoiceContext.loaded = false;
  }
  if (!invoiceContext.loaded && !invoiceContext.loading) {
    void loadInvoiceContext(client);
  }
}

export async function saveBillingProfile(client: GatewayBrowserClient): Promise<void> {
  invoiceContext.savingProfile = true;
  invoiceContext.error = null;
  rerenderFn?.();
  try {
    const gw = createCostBudgetGateway(client);
    const draft = invoiceContext.profileDraft;
    const result = await gw.setBillingProfile({
      legalName: draft.legalName.trim(),
      taxId: draft.taxId.trim(),
      invoiceType: draft.invoiceType,
      ...(draft.bankAccount.trim() ? { bankAccount: draft.bankAccount.trim() } : {}),
      ...(draft.address.trim() ? { address: draft.address.trim() } : {}),
      ...(draft.contactEmail.trim() ? { contactEmail: draft.contactEmail.trim() } : {}),
    });
    invoiceContext.profileComplete = result.complete;
    invoiceContext.notice = "profile_saved";
  } catch (err) {
    invoiceContext.error = err instanceof Error ? err.message : String(err);
  } finally {
    invoiceContext.savingProfile = false;
    rerenderFn?.();
  }
}

export async function requestInvoiceForOrder(
  client: GatewayBrowserClient,
  orderId: string,
): Promise<void> {
  invoiceContext.busyOrderId = orderId;
  invoiceContext.error = null;
  rerenderFn?.();
  try {
    const gw = createCostBudgetGateway(client);
    await gw.requestInvoice({ orderId });
    invoiceContext.notice = `requested:${orderId}`;
    await loadInvoiceContext(client);
  } catch (err) {
    invoiceContext.error = err instanceof Error ? err.message : String(err);
  } finally {
    invoiceContext.busyOrderId = null;
    rerenderFn?.();
  }
}

export function __resetInvoiceContextForTest(): void {
  invoiceContext.loading = false;
  invoiceContext.loaded = false;
  invoiceContext.error = null;
  invoiceContext.notice = null;
  invoiceContext.profileComplete = false;
  invoiceContext.profileDraft = defaultDraft();
  invoiceContext.requests = [];
  invoiceContext.busyOrderId = null;
  invoiceContext.savingProfile = false;
  invoiceContext.profileDrawerOpen = false;
  lastClient = null;
  rerenderFn = null;
}
