import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  SUBSCRIPTION_COMMERCE_ENDPOINTS,
  type FromLeadRequest,
  type FromLeadResponse,
  type ReconcileQueueResponse,
  type SalesLeadsListResponse,
  type InvoicesListPlatformResponse,
  type InvoiceRequest,
} from "./endpoints.ts";

export function createSubscriptionCommerceGateway(client: GatewayBrowserClient) {
  return {
    listReconcileQueue(): Promise<ReconcileQueueResponse> {
      return client.request<ReconcileQueueResponse>(
        SUBSCRIPTION_COMMERCE_ENDPOINTS.reconcileQueue,
        {},
      );
    },
    listSalesLeads(): Promise<SalesLeadsListResponse> {
      return client.request<SalesLeadsListResponse>(
        SUBSCRIPTION_COMMERCE_ENDPOINTS.salesLeadsList,
        {},
      );
    },
    createOrderFromLead(req: FromLeadRequest): Promise<FromLeadResponse> {
      return client.request<FromLeadResponse>(SUBSCRIPTION_COMMERCE_ENDPOINTS.fromLead, req);
    },
    confirmManualPayment(paymentId: string, requestId?: string): Promise<unknown> {
      return client.request(SUBSCRIPTION_COMMERCE_ENDPOINTS.confirmManual, {
        paymentId,
        ...(requestId ? { requestId } : {}),
      });
    },
    retryFulfillment(orderId: string): Promise<unknown> {
      return client.request(SUBSCRIPTION_COMMERCE_ENDPOINTS.fulfillmentRetry, { orderId });
    },
    listPlatformInvoiceRequests(
      status?: InvoiceRequest["status"],
    ): Promise<InvoicesListPlatformResponse> {
      return client.request<InvoicesListPlatformResponse>(
        SUBSCRIPTION_COMMERCE_ENDPOINTS.invoicesListPlatform,
        status ? { status } : {},
      );
    },
    issueInvoice(
      requestId: string,
      invoiceNo: string,
      pdfUrl?: string,
    ): Promise<{ request: InvoiceRequest }> {
      return client.request(SUBSCRIPTION_COMMERCE_ENDPOINTS.invoicesIssue, {
        requestId,
        invoiceNo,
        ...(pdfUrl ? { pdfUrl } : {}),
      });
    },
    rejectInvoice(requestId: string, reason: string): Promise<{ request: InvoiceRequest }> {
      return client.request(SUBSCRIPTION_COMMERCE_ENDPOINTS.invoicesReject, { requestId, reason });
    },
  };
}
