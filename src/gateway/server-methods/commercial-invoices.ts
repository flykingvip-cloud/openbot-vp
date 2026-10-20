/**
 * 发票申请 RPC（企业端 + 平台审核）+ Statement 查询（Phase 4）。
 */

import { loadCommercialStatement } from "../commerce/commercial-statement.js";
import { createInvoiceRequest } from "../commerce/invoice-request-service.js";
import {
  getInvoiceRequestForEnterprise,
  issueInvoiceRequest,
  listAllInvoiceRequests,
  listInvoiceRequestsForEnterprise,
  rejectInvoiceRequest,
} from "../commerce/invoice-requests-store.js";
import type { InvoiceRequestStatus } from "../commerce/types.js";
import {
  numberValue,
  requireEnterpriseScope,
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

function parseInvoiceStatus(value: string | undefined): InvoiceRequestStatus | null {
  if (value === "pending" || value === "issued" || value === "rejected") {
    return value;
  }
  return null;
}

export const commercialInvoicesHandlers: GatewayRequestHandlers = {
  /** Phase 4：统一 Statement（Order 预付 + Bill 消费 + 可开票余额）。 */
  "billing.statement": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const statement = await loadCommercialStatement(scope.enterpriseId);
      respond(true, { statement });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "invoices.request": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const orderId = stringValue(params.orderId);
      const billId = stringValue(params.billId);
      // 允许都不传：按 Statement 总可开票余额开票（需至少一项可开）
      const request = await createInvoiceRequest({
        enterpriseId: scope.enterpriseId,
        ...(orderId ? { orderId } : {}),
        ...(billId ? { billId } : {}),
      });
      respond(true, { request });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("开票资料") ||
        message.includes("订单") ||
        message.includes("账单") ||
        message.includes("重复") ||
        message.includes("至少") ||
        message.includes("可开票") ||
        message.includes("其一")
      ) {
        respondInvalid(respond, message);
        return;
      }
      respondUnavailable(respond, err);
    }
  },

  "invoices.list": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const status = parseInvoiceStatus(stringValue(params.status) ?? undefined);
      const limit = numberValue(params.limit);
      const requests = await listInvoiceRequestsForEnterprise(scope.enterpriseId, {
        ...(status ? { status } : {}),
        ...(limit ? { limit } : {}),
      });
      respond(true, { requests });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "invoices.list-platform": async ({ params, respond }) => {
    try {
      const status = parseInvoiceStatus(stringValue(params.status) ?? undefined);
      const enterpriseId = stringValue(params.enterpriseId);
      const limit = numberValue(params.limit);
      const requests = await listAllInvoiceRequests({
        ...(status ? { status } : {}),
        ...(enterpriseId ? { enterpriseId } : {}),
        ...(limit ? { limit } : {}),
      });
      respond(true, { requests });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "invoices.issue": async ({ params, respond }) => {
    try {
      const requestId = stringValue(params.requestId);
      const invoiceNo = stringValue(params.invoiceNo);
      if (!requestId || !invoiceNo) {
        respondInvalid(respond, "requestId 与 invoiceNo 为必填项");
        return;
      }
      const request = await issueInvoiceRequest(requestId, {
        invoiceNo,
        ...(stringValue(params.pdfUrl) ? { pdfUrl: stringValue(params.pdfUrl) as string } : {}),
      });
      if (!request) {
        respondInvalid(respond, "发票申请不存在");
        return;
      }
      respond(true, { request });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("待审核") || message.includes("必填")) {
        respondInvalid(respond, message);
        return;
      }
      respondUnavailable(respond, err);
    }
  },

  "invoices.reject": async ({ params, respond }) => {
    try {
      const requestId = stringValue(params.requestId);
      const reason = stringValue(params.reason);
      if (!requestId || !reason) {
        respondInvalid(respond, "requestId 与 reason 为必填项");
        return;
      }
      const request = await rejectInvoiceRequest(requestId, reason);
      if (!request) {
        respondInvalid(respond, "发票申请不存在");
        return;
      }
      respond(true, { request });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("待审核") || message.includes("不能为空")) {
        respondInvalid(respond, message);
        return;
      }
      respondUnavailable(respond, err);
    }
  },

  "invoices.get": async ({ client, params, respond }) => {
    try {
      const scope = await requireEnterpriseScope(client, respond, params);
      if (!scope) {
        return;
      }
      const requestId = stringValue(params.requestId);
      if (!requestId) {
        respondInvalid(respond, "requestId 是必填项");
        return;
      }
      const request = await getInvoiceRequestForEnterprise(scope.enterpriseId, requestId);
      if (!request) {
        respondInvalid(respond, "发票申请不存在");
        return;
      }
      respond(true, { request });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
