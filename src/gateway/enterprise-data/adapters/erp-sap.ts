import type { MockHandlerInput, MockHandlerResult } from "../mock-handlers.js";
import type { DataConnectorCredentialSecret } from "../types.js";

/**
 * SAP ERP live adapter. Targets the standard SAP S/4HANA OData sales-order
 * service (`API_SALES_ORDER_SRV`); customers point `instanceUrl` at their SAP
 * gateway (or a compatible OData facade). Auth is Basic when a `basicUsername`
 * is bound (the common SAP technical-user pattern), otherwise Bearer using the
 * OAuth access token / API key. Mirrors the Salesforce adapter: a `simulated-`
 * token short-circuits to deterministic dev-mode data so the demo works without
 * a real SAP tenant, and the returned payload shape matches the mock handler
 * (`{ order: { id, status, ... } }`) so masking + capability consumers are
 * unchanged.
 */

export type ErpSapProbeResult = {
  ok: boolean;
  message: string;
};

const SALES_ORDER_SERVICE = "/sap/opu/odata/sap/API_SALES_ORDER_SRV/A_SalesOrder";

export function normalizeErpSapInstanceUrl(instanceUrl: string): string {
  const trimmed = instanceUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new Error("SAP ERP instance URL is required.");
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

function isSimulatedToken(secret: DataConnectorCredentialSecret): boolean {
  const token = secret.oauthAccessToken?.trim() || secret.apiKey?.trim() || "";
  return token.startsWith("simulated-");
}

function buildAuthHeader(secret: DataConnectorCredentialSecret): string {
  const basicUsername = secret.basicUsername?.trim();
  if (basicUsername) {
    const password = secret.apiKey ?? "";
    return `Basic ${Buffer.from(`${basicUsername}:${password}`).toString("base64")}`;
  }
  const token = secret.oauthAccessToken?.trim() || secret.apiKey?.trim();
  if (!token) {
    throw new Error("SAP ERP access token or basic credentials are required.");
  }
  return `Bearer ${token}`;
}

export async function probeErpSapConnection(
  secret: DataConnectorCredentialSecret,
): Promise<ErpSapProbeResult> {
  const instanceUrl = normalizeErpSapInstanceUrl(secret.instanceUrl ?? "");
  if (isSimulatedToken(secret)) {
    return { ok: true, message: "SAP ERP 模拟凭证有效（开发模式）。" };
  }
  const authorization = buildAuthHeader(secret);
  const probePath = secret.probePath?.trim() || `${SALES_ORDER_SERVICE}?$top=1&$format=json`;
  let response: Response;
  try {
    response = await fetch(`${instanceUrl}${probePath}`, {
      headers: { Authorization: authorization, Accept: "application/json" },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `SAP ERP 连接失败：${detail.slice(0, 120)}` };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return {
      ok: false,
      message: `SAP ERP API 返回 ${response.status}${detail ? `：${detail.slice(0, 120)}` : ""}`,
    };
  }
  return { ok: true, message: "SAP ERP API 连通性正常（已验证凭证）。" };
}

/** Defensively read the first record out of OData v2 (`d.results`), OData v4 (`value`), or a bare object/array. */
function firstRecord(body: unknown): Record<string, unknown> | null {
  if (Array.isArray(body)) {
    return (body[0] as Record<string, unknown>) ?? null;
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const d = record.d as { results?: unknown[] } | Record<string, unknown> | undefined;
    if (d && typeof d === "object") {
      if (Array.isArray((d as { results?: unknown[] }).results)) {
        return ((d as { results: unknown[] }).results[0] as Record<string, unknown>) ?? null;
      }
      return d as Record<string, unknown>;
    }
    if (Array.isArray(record.value)) {
      return (record.value[0] as Record<string, unknown>) ?? null;
    }
    return record;
  }
  return null;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

async function queryOrderStatus(
  secret: DataConnectorCredentialSecret,
  orderId: string | undefined,
): Promise<{ id: string; status: string } | null> {
  const instanceUrl = normalizeErpSapInstanceUrl(secret.instanceUrl ?? "");
  const authorization = buildAuthHeader(secret);
  const target = orderId
    ? `${instanceUrl}${SALES_ORDER_SERVICE}('${encodeURIComponent(orderId)}')?$format=json`
    : `${instanceUrl}${SALES_ORDER_SERVICE}?$top=1&$format=json`;
  const response = await fetch(target, {
    headers: { Authorization: authorization, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`SAP ERP order query failed with status ${response.status}`);
  }
  const record = firstRecord(await response.json());
  if (!record) {
    return null;
  }
  const id = pickString(record, ["SalesOrder", "id", "order_id", "OrderID"]) ?? orderId ?? "";
  const status =
    pickString(record, ["OverallSDProcessStatus", "status", "OrderStatus", "OverallStatus"]) ??
    "unknown";
  return { id, status };
}

export async function executeErpSapHandler(
  handlerRef: string,
  input: MockHandlerInput,
  secret: DataConnectorCredentialSecret,
): Promise<MockHandlerResult> {
  if (handlerRef !== "enterprise-data/handlers/erp-order-read-status-v1") {
    throw new Error(`SAP ERP adapter does not support handler: ${handlerRef}`);
  }
  const orderId = typeof input.input?.orderId === "string" ? input.input.orderId : undefined;

  if (isSimulatedToken(secret)) {
    return {
      payload: {
        order: {
          id: orderId ?? "sap-sim-1001",
          status: "shipped",
          created_by: input.employeeId,
          team_id: input.scope.resolvedValues["order.team_id"] ?? "simulated-team",
        },
      },
    };
  }

  const order = await queryOrderStatus(secret, orderId);
  if (!order) {
    return { payload: { order: null } };
  }
  return {
    payload: {
      order: {
        id: order.id,
        status: order.status,
        created_by: input.employeeId,
        team_id: input.scope.resolvedValues["order.team_id"] ?? "live",
      },
    },
  };
}
