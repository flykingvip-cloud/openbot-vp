import type { MockHandlerInput, MockHandlerResult } from "../mock-handlers.js";
import type { DataConnectorCredentialSecret } from "../types.js";
import {
  YONYOU_TPLUS_API_PREFIX,
  YONYOU_TPLUS_GATEWAY_ORIGIN,
  YONYOU_TPLUS_SIMULATED_TOKEN_PREFIX,
} from "./yonyou-tplus-oauth.js";

export const YONYOU_TPLUS_HANDLERS = {
  version: "enterprise-data/handlers/yonyou-tplus-account-version-v1",
  warehouse: "enterprise-data/handlers/yonyou-tplus-warehouse-query-v1",
  inventory: "enterprise-data/handlers/yonyou-tplus-inventory-query-page-v1",
  partner: "enterprise-data/handlers/yonyou-tplus-partner-query-page-v1",
  saleOrder: "enterprise-data/handlers/yonyou-tplus-sale-order-list-v1",
  doc: "enterprise-data/handlers/yonyou-tplus-doc-query-v1",
} as const;

const VERSION_PATH = `${YONYOU_TPLUS_API_PREFIX}/accountAPI/GetVersionInfo`;

type CallCredentials = {
  simulated: boolean;
  appKey: string;
  appSecret: string;
  openToken: string;
  gatewayOrigin: string;
  sid?: string;
  orgId?: string;
  appName?: string;
};

function isSimulatedToken(token: string): boolean {
  return token.startsWith(YONYOU_TPLUS_SIMULATED_TOKEN_PREFIX) || token.startsWith("simulated-");
}

function resolveCallCredentials(
  secret: DataConnectorCredentialSecret,
): CallCredentials | { error: string } {
  const openToken = secret.oauthAccessToken?.trim() || secret.apiKey?.trim() || "";
  const gatewayOrigin = (secret.instanceUrl?.trim() || YONYOU_TPLUS_GATEWAY_ORIGIN).replace(
    /\/+$/,
    "",
  );
  if (openToken && isSimulatedToken(openToken)) {
    return {
      simulated: true,
      appKey: secret.appKey?.trim() || "simulated-app-key",
      appSecret: secret.appSecret?.trim() || "simulated-app-secret",
      openToken,
      gatewayOrigin,
      sid: secret.sid?.trim() || undefined,
      orgId: secret.orgId?.trim() || undefined,
      appName: secret.appName?.trim() || undefined,
    };
  }
  const appKey =
    secret.appKey?.trim() || process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_KEY?.trim() || "";
  const appSecret =
    secret.appSecret?.trim() ||
    process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_SECRET?.trim() ||
    "";
  if (!appKey || !appSecret || !openToken) {
    return {
      error: "用友 T+ 凭证不完整：需要 appKey、appSecret 与 openToken。请先完成 OAuth 或写入凭证。",
    };
  }
  return {
    simulated: false,
    appKey,
    appSecret,
    openToken,
    gatewayOrigin,
    sid: secret.sid?.trim() || undefined,
    orgId: secret.orgId?.trim() || undefined,
    appName: secret.appName?.trim() || undefined,
  };
}

function chanjetHeaders(credentials: CallCredentials): Record<string, string> {
  const headers: Record<string, string> = {
    appKey: credentials.appKey,
    appSecret: credentials.appSecret,
    openToken: credentials.openToken,
    "Content-Type": "application/json",
  };
  if (credentials.sid) {
    headers.Cookie = `sid=${credentials.sid}`;
  }
  return headers;
}

type InterpretedBody = {
  ok: boolean;
  message: string;
  body: unknown;
};

function interpretChanjetBody(
  status: number,
  text: string,
  successMessage: string,
): InterpretedBody {
  const trimmed = text.trim();
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      message: `用友 T+ API 返回 ${status}${trimmed ? `：${trimmed.slice(0, 160)}` : ""}`,
      body: trimmed,
    };
  }
  if (!trimmed) {
    return { ok: true, message: successMessage, body: null };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const code = record.code;
      if (code != null && code !== 200 && code !== "200" && code !== 0 && code !== "0") {
        const message = typeof record.message === "string" ? record.message : trimmed.slice(0, 160);
        const codeText = typeof code === "string" || typeof code === "number" ? `${code}` : "error";
        return { ok: false, message: `用友 T+ API 返回 ${codeText}：${message}`, body: parsed };
      }
      const rest = record.RestException;
      if (rest && typeof rest === "object") {
        const restRecord = rest as Record<string, unknown>;
        const restMessage =
          typeof restRecord.message === "string" ? restRecord.message : "业务调用失败";
        return { ok: false, message: `用友 T+ API 返回错误：${restMessage}`, body: parsed };
      }
    }
    return { ok: true, message: successMessage, body: parsed };
  } catch {
    return { ok: true, message: `${successMessage}（${trimmed.slice(0, 80)}）`, body: trimmed };
  }
}

async function postTplus(params: {
  credentials: CallCredentials;
  path: string;
  body: unknown;
  successMessage: string;
}): Promise<InterpretedBody> {
  let response: Response;
  try {
    response = await fetch(`${params.credentials.gatewayOrigin}${params.path}`, {
      method: "POST",
      headers: chanjetHeaders(params.credentials),
      body: JSON.stringify(params.body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "网络请求失败";
    return { ok: false, message: `用友 T+ 连接失败：${message}`, body: null };
  }
  const text = await response.text().catch(() => "");
  return interpretChanjetBody(response.status, text, params.successMessage);
}

function objectInput(
  input: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | null {
  const value = input?.[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function queryBody(
  input: Record<string, unknown> | undefined,
  fallback: Record<string, unknown>,
): unknown {
  const dto = objectInput(input, "dto");
  if (dto) {
    return { dto };
  }
  const param = objectInput(input, "param");
  if (param) {
    return { param };
  }
  return fallback;
}

export async function probeYonyouTplusConnection(
  secret: DataConnectorCredentialSecret,
): Promise<{ ok: boolean; message: string }> {
  const resolved = resolveCallCredentials(secret);
  if ("error" in resolved) {
    return { ok: false, message: resolved.error };
  }
  if (resolved.simulated) {
    return { ok: true, message: "用友 T+ 模拟 OAuth 凭证有效（开发模式）。" };
  }
  const result = await postTplus({
    credentials: resolved,
    path: VERSION_PATH,
    body: {},
    successMessage: "用友 T+ 连通性正常（已读取版本信息）。",
  });
  return { ok: result.ok, message: result.message };
}

function simulatedPayload(handlerRef: string): MockHandlerResult {
  switch (handlerRef) {
    case YONYOU_TPLUS_HANDLERS.version:
      return { payload: { version: "simulated-tplus" } };
    case YONYOU_TPLUS_HANDLERS.warehouse:
      return { payload: { records: [{ Code: "01", Name: "模拟仓库" }] } };
    case YONYOU_TPLUS_HANDLERS.inventory:
      return { payload: { records: [{ Code: "10001", Name: "模拟存货" }] } };
    case YONYOU_TPLUS_HANDLERS.partner:
      return { payload: { records: [{ Code: "001", Name: "模拟往来单位" }] } };
    case YONYOU_TPLUS_HANDLERS.saleOrder:
      return {
        payload: {
          records: {
            code: "0",
            message: "ok",
            data: { TotalCount: 0, Rows: [] },
          },
        },
      };
    case YONYOU_TPLUS_HANDLERS.doc:
      return { payload: { records: [] } };
    default:
      throw new Error(`用友 T+ 适配器不支持该处理器：${handlerRef}`);
  }
}

function liveRequest(
  handlerRef: string,
  input: Record<string, unknown> | undefined,
): { path: string; body: unknown } {
  switch (handlerRef) {
    case YONYOU_TPLUS_HANDLERS.version:
      return { path: VERSION_PATH, body: {} };
    case YONYOU_TPLUS_HANDLERS.warehouse:
      return {
        path: `${YONYOU_TPLUS_API_PREFIX}/warehouse/Query`,
        body: queryBody(input, { param: {} }),
      };
    case YONYOU_TPLUS_HANDLERS.inventory:
      return {
        path: `${YONYOU_TPLUS_API_PREFIX}/inventory/QueryPage`,
        body: queryBody(input, {
          param: { PageSize: "20", PageIndex: "1", SelectFields: "ID,Code,Name" },
        }),
      };
    case YONYOU_TPLUS_HANDLERS.partner:
      return {
        path: `${YONYOU_TPLUS_API_PREFIX}/partner/QueryPage`,
        body: queryBody(input, {
          param: {
            PageSize: "10",
            PageIndex: "1",
            SelectFields: "ID,Code,Name,PartnerType.Code,PartnerType.Name",
          },
        }),
      };
    case YONYOU_TPLUS_HANDLERS.saleOrder: {
      const selectFields = input?.selectFields ?? [
        "SaleOrder.ID",
        "SaleOrder.VoucherDate",
        "SaleOrder.Code",
      ];
      return {
        path: `${YONYOU_TPLUS_API_PREFIX}/SaleOrderOpenApi/FindVoucherList`,
        body: {
          pageSize: input?.pageSize ?? 20,
          pageIndex: input?.pageIndex ?? 0,
          selectFields,
          paramDic: objectInput(input, "paramDic") ?? {},
        },
      };
    }
    case YONYOU_TPLUS_HANDLERS.doc:
      return {
        path: `${YONYOU_TPLUS_API_PREFIX}/doc/Query`,
        body: queryBody(input, { param: {} }),
      };
    default:
      throw new Error(`用友 T+ 适配器不支持该处理器：${handlerRef}`);
  }
}

export async function executeYonyouTplusHandler(
  handlerRef: string,
  input: MockHandlerInput,
  secret: DataConnectorCredentialSecret,
): Promise<MockHandlerResult> {
  const resolved = resolveCallCredentials(secret);
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }
  if (resolved.simulated) {
    return simulatedPayload(handlerRef);
  }
  const request = liveRequest(handlerRef, input.input);
  const result = await postTplus({
    credentials: resolved,
    path: request.path,
    body: request.body,
    successMessage: "用友 T+ 读取成功。",
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return { payload: { records: result.body } };
}
