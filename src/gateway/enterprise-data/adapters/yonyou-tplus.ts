import { saveCredentialSecret } from "../connector-credential-vault.js";
import type { MockHandlerInput, MockHandlerResult } from "../mock-handlers.js";
import type { DataConnectorCredentialSecret } from "../types.js";
import {
  loadYonyouTplusAppTicket,
  loadYonyouTplusOrgPermanentAuth,
} from "../yonyou-tplus-message-store.js";
import { extractYonyouTplusRows, normalizeYonyouTplusVoucherRows } from "../yonyou-tplus-rows.js";
import {
  renewYonyouTplusOpenToken,
  resolveYonyouTplusAppCredentials,
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
  saleDelivery: "enterprise-data/handlers/yonyou-tplus-sale-delivery-list-v1",
  doc: "enterprise-data/handlers/yonyou-tplus-doc-query-v1",
} as const;

/** Default page size for QueryPage / FindVoucherList (aligned with sync PAGE_SIZE). */
export const YONYOU_TPLUS_DEFAULT_PAGE_SIZE = 100;

/**
 * Inventory QueryPage SelectFields: identity + documented cost/price fields.
 * AvailableQuantity / 现存量 live on currentStock/Query, not inventory QueryPage —
 * do not invent stock qty fields here.
 * @see https://open.chanjet.com/docs/file/apiFile/tcloud/t+jcda/t+ch
 */
export const YONYOU_TPLUS_INVENTORY_SELECT_FIELDS =
  "ID,Code,Name,Specification,InvSCost,LatestCost,AvagCost,RetailPriceNew";

/** Partner QueryPage SelectFields (identity + type). */
export const YONYOU_TPLUS_PARTNER_SELECT_FIELDS = "ID,Code,Name,PartnerType.Code,PartnerType.Name";

/**
 * Default FindVoucherList selectFields for sale delivery / sale order.
 * Paths follow Chanjet docs (明细前缀 SaleDelivery.SaleDeliveryDetails. /
 * SaleOrder.SaleOrderDetails.). Warehouse on sale order is omitted — list
 * examples document Customer + detail qty/amount, not header Warehouse.
 * CostPrice/CostAmount appear on Create DTO (合并流程) but not on published
 * FindVoucherList examples; skip rather than invent list columns.
 */
export function yonyouTplusDefaultVoucherSelectFields(
  prefix: "SaleOrder" | "SaleDelivery",
): string[] {
  const details = prefix === "SaleOrder" ? "SaleOrderDetails" : "SaleDeliveryDetails";
  const fields = [
    `${prefix}.ID`,
    `${prefix}.VoucherDate`,
    `${prefix}.Code`,
    `${prefix}.Customer.Code`,
    `${prefix}.Customer.Name`,
  ];
  if (prefix === "SaleDelivery") {
    fields.push(`${prefix}.Warehouse.Code`, `${prefix}.Warehouse.Name`);
  }
  fields.push(
    `${prefix}.${details}.Inventory.Code`,
    `${prefix}.${details}.Inventory.Name`,
    `${prefix}.${details}.Quantity`,
    `${prefix}.${details}.OrigTaxPrice`,
    `${prefix}.${details}.OrigTaxAmount`,
  );
  return fields;
}

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
  idMarketingOrgan?: string;
};

/** Chanjet documents `?idMarketingOrgan=` as a path query on some voucher writes. */
export function buildYonyouTplusRequestUrl(params: {
  gatewayOrigin: string;
  path: string;
  idMarketingOrgan?: string;
  marketingOrganQuery?: boolean;
}): string {
  const base = `${params.gatewayOrigin}${params.path}`;
  const organ = params.idMarketingOrgan?.trim();
  if (!params.marketingOrganQuery || !organ) {
    return base;
  }
  const joiner = params.path.includes("?") ? "&" : "?";
  return `${base}${joiner}idMarketingOrgan=${encodeURIComponent(organ)}`;
}

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
    const configuredAppKey =
      secret.appKey?.trim() ||
      process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_APP_KEY?.trim() ||
      "";
    if (configuredAppKey && !isSimulatedToken(configuredAppKey)) {
      return {
        error:
          "用友 T+ 当前仍是模拟 openToken，但已配置真实 appKey。请重新完成 OAuth 或粘贴真实 openToken／永久授权码，禁止继续使用模拟凭证。",
      };
    }
    return {
      simulated: true,
      appKey: secret.appKey?.trim() || "simulated-app-key",
      appSecret: secret.appSecret?.trim() || "simulated-app-secret",
      openToken,
      gatewayOrigin,
      sid: secret.sid?.trim() || undefined,
      orgId: secret.orgId?.trim() || undefined,
      appName: secret.appName?.trim() || undefined,
      idMarketingOrgan: secret.idMarketingOrgan?.trim() || undefined,
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
    idMarketingOrgan: secret.idMarketingOrgan?.trim() || undefined,
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
  marketingOrganQuery?: boolean;
}): Promise<InterpretedBody> {
  const url = buildYonyouTplusRequestUrl({
    gatewayOrigin: params.credentials.gatewayOrigin,
    path: params.path,
    idMarketingOrgan: params.credentials.idMarketingOrgan,
    marketingOrganQuery: params.marketingOrganQuery,
  });
  let response: Response;
  try {
    response = await fetch(url, {
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

export type YonyouTplusProbeContext = {
  /** When set, a successful renewal is written back to this vault credential. */
  credentialId?: string;
  vaultPath?: string;
  messageStorePath?: string;
};

const renewLocks = new Map<string, Promise<DataConnectorCredentialSecret>>();

function appMaterial(
  secret: DataConnectorCredentialSecret,
): { appKey: string; appSecret: string } | null {
  const env = resolveYonyouTplusAppCredentials();
  const appKey = secret.appKey?.trim() || env?.appKey || "";
  const appSecret = secret.appSecret?.trim() || env?.appSecret || "";
  if (!appKey || !appSecret) {
    return null;
  }
  return { appKey, appSecret };
}

function isOpenTokenRejected(result: InterpretedBody): boolean {
  if (result.ok) {
    return false;
  }
  return (
    result.message.includes("openToken") ||
    result.message.includes("token无效") ||
    result.message.includes("token失效") ||
    result.message.includes("返回 401")
  );
}

async function renewalMaterial(
  secret: DataConnectorCredentialSecret,
  messageStorePath?: string,
): Promise<{
  refreshToken?: string;
  userAuthPermanentCode?: string;
  orgPermanentAuthCode?: string;
  appTicket?: string;
} | null> {
  const apps = appMaterial(secret);
  if (!apps) {
    return null;
  }
  const refreshToken = secret.oauthRefreshToken?.trim() || undefined;
  const userAuthPermanentCode = secret.oauthPermanentCode?.trim() || undefined;
  const orgId = secret.orgId?.trim() || "";
  const storedOrg = orgId ? await loadYonyouTplusOrgPermanentAuth(orgId, messageStorePath) : null;
  const orgPermanentAuthCode = secret.orgPermanentAuthCode?.trim() || storedOrg?.permanentAuthCode;
  const appTicket = await loadYonyouTplusAppTicket(apps.appKey, messageStorePath);
  const permanentReady = Boolean(userAuthPermanentCode && orgPermanentAuthCode && appTicket);
  if (!refreshToken && !permanentReady) {
    return null;
  }
  return {
    refreshToken,
    userAuthPermanentCode,
    orgPermanentAuthCode,
    appTicket: appTicket ?? undefined,
  };
}

async function renewAndPersist(
  secret: DataConnectorCredentialSecret,
  context: YonyouTplusProbeContext,
): Promise<DataConnectorCredentialSecret> {
  const credentialId = context.credentialId?.trim() || "";
  if (!credentialId) {
    throw new Error("用友 T+ 续期需要已保存的凭证，内联探测不会轮换 token。");
  }
  const existing = renewLocks.get(credentialId);
  if (existing) {
    return existing;
  }
  const run = (async () => {
    const apps = appMaterial(secret);
    const material = await renewalMaterial(secret, context.messageStorePath);
    if (!apps || !material) {
      throw new Error("用友 T+ 无法续期：缺少 refresh token，或缺少 appTicket 与企业永久授权码。");
    }
    const token = await renewYonyouTplusOpenToken({
      appKey: apps.appKey,
      appSecret: apps.appSecret,
      gatewayOrigin: secret.instanceUrl,
      refreshToken: material.refreshToken,
      userAuthPermanentCode: material.userAuthPermanentCode,
      orgPermanentAuthCode: material.orgPermanentAuthCode,
      appTicket: material.appTicket,
    });
    const next: DataConnectorCredentialSecret = {
      ...secret,
      oauthAccessToken: token.accessToken,
      apiKey: token.accessToken,
      oauthRefreshToken: token.refreshToken || secret.oauthRefreshToken,
      oauthPermanentCode: token.permanentCode || secret.oauthPermanentCode,
      orgPermanentAuthCode: material.orgPermanentAuthCode || secret.orgPermanentAuthCode,
      orgId: token.orgId || secret.orgId,
      appName: token.appName || secret.appName,
      sid: token.sid || secret.sid,
    };
    await saveCredentialSecret(credentialId, next, context.vaultPath);
    return next;
  })();
  renewLocks.set(credentialId, run);
  try {
    return await run;
  } finally {
    renewLocks.delete(credentialId);
  }
}

export async function probeYonyouTplusConnection(
  secret: DataConnectorCredentialSecret,
  context?: YonyouTplusProbeContext,
): Promise<{ ok: boolean; message: string; refreshed?: boolean }> {
  let current = secret;
  let refreshed = false;
  const canPersist = Boolean(context?.credentialId?.trim());
  let resolved = resolveCallCredentials(current);
  if (
    "error" in resolved &&
    canPersist &&
    (await renewalMaterial(current, context?.messageStorePath))
  ) {
    try {
      current = await renewAndPersist(current, context ?? {});
      refreshed = true;
      resolved = resolveCallCredentials(current);
    } catch (error) {
      const message = error instanceof Error ? error.message : "刷新 openToken 失败";
      return { ok: false, message };
    }
  }
  if ("error" in resolved) {
    return { ok: false, message: resolved.error };
  }
  if (resolved.simulated) {
    return { ok: true, message: "用友 T+ 模拟 OAuth 凭证有效（开发模式）。" };
  }
  let result = await postTplus({
    credentials: resolved,
    path: VERSION_PATH,
    body: {},
    successMessage: "用友 T+ 连通性正常（已读取版本信息）。",
  });
  if (
    !result.ok &&
    !refreshed &&
    canPersist &&
    isOpenTokenRejected(result) &&
    (await renewalMaterial(current, context?.messageStorePath))
  ) {
    try {
      current = await renewAndPersist(current, context ?? {});
      refreshed = true;
      const next = resolveCallCredentials(current);
      if ("error" in next) {
        return { ok: false, message: next.error, refreshed: true };
      }
      result = await postTplus({
        credentials: next,
        path: VERSION_PATH,
        body: {},
        successMessage: "用友 T+ 连通性正常（已读取版本信息）。",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "刷新 openToken 失败";
      return { ok: false, message: `${result.message}；${message}` };
    }
  }
  const suffix = refreshed ? " 已将新的 openToken 写入凭证库。" : "";
  return { ok: result.ok, message: `${result.message}${suffix}`, refreshed };
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
    case YONYOU_TPLUS_HANDLERS.saleDelivery:
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

function voucherListRequest(
  input: Record<string, unknown> | undefined,
  apiPath: string,
  prefix: "SaleOrder" | "SaleDelivery",
): { path: string; body: unknown } {
  const selectFields = Array.isArray(input?.selectFields)
    ? input.selectFields
    : yonyouTplusDefaultVoucherSelectFields(prefix);
  const pageSize =
    typeof input?.pageSize === "number" ? input.pageSize : YONYOU_TPLUS_DEFAULT_PAGE_SIZE;
  const pageIndex = typeof input?.pageIndex === "number" ? input.pageIndex : 0;
  return {
    path: `${YONYOU_TPLUS_API_PREFIX}/${apiPath}`,
    body: {
      pageSize,
      pageIndex,
      selectFields,
      paramDic: objectInput(input, "paramDic") ?? {},
    },
  };
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
          param: {
            PageSize: `${YONYOU_TPLUS_DEFAULT_PAGE_SIZE}`,
            PageIndex: "1",
            SelectFields: YONYOU_TPLUS_INVENTORY_SELECT_FIELDS,
          },
        }),
      };
    case YONYOU_TPLUS_HANDLERS.partner:
      return {
        path: `${YONYOU_TPLUS_API_PREFIX}/partner/QueryPage`,
        body: queryBody(input, {
          param: {
            PageSize: `${YONYOU_TPLUS_DEFAULT_PAGE_SIZE}`,
            PageIndex: "1",
            SelectFields: YONYOU_TPLUS_PARTNER_SELECT_FIELDS,
          },
        }),
      };
    case YONYOU_TPLUS_HANDLERS.saleOrder:
      return voucherListRequest(input, "SaleOrderOpenApi/FindVoucherList", "SaleOrder");
    case YONYOU_TPLUS_HANDLERS.saleDelivery:
      return voucherListRequest(input, "SaleDeliveryOpenApi/FindVoucherList", "SaleDelivery");
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
  options?: YonyouTplusProbeContext & { marketingOrganQuery?: boolean },
): Promise<MockHandlerResult> {
  let current = secret;
  let refreshed = false;
  const canPersist = Boolean(options?.credentialId?.trim());
  let resolved = resolveCallCredentials(current);
  if (
    "error" in resolved &&
    canPersist &&
    (await renewalMaterial(current, options?.messageStorePath))
  ) {
    current = await renewAndPersist(current, options ?? {});
    refreshed = true;
    resolved = resolveCallCredentials(current);
  }
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }
  if (resolved.simulated) {
    return simulatedPayload(handlerRef);
  }
  const request = liveRequest(handlerRef, input.input);
  const call = (credentials: CallCredentials) =>
    postTplus({
      credentials,
      path: request.path,
      body: request.body,
      successMessage: "用友 T+ 读取成功。",
      marketingOrganQuery: options?.marketingOrganQuery,
    });
  let result = await call(resolved);
  if (
    !result.ok &&
    !refreshed &&
    canPersist &&
    isOpenTokenRejected(result) &&
    (await renewalMaterial(current, options?.messageStorePath))
  ) {
    current = await renewAndPersist(current, options ?? {});
    const next = resolveCallCredentials(current);
    if ("error" in next) {
      throw new Error(next.error);
    }
    refreshed = true;
    result = await call(next);
  }
  if (!result.ok) {
    throw new Error(result.message);
  }
  const rows = extractYonyouTplusRows(result.body);
  const selectFields = voucherSelectFieldsForHandler(handlerRef, input.input);
  return {
    payload: {
      records: selectFields ? normalizeYonyouTplusVoucherRows(rows, selectFields) : rows,
    },
  };
}

/** Default / override selectFields for voucher list handlers (positional Rows). */
function voucherSelectFieldsForHandler(
  handlerRef: string,
  input: Record<string, unknown> | undefined,
): string[] | undefined {
  if (
    handlerRef !== YONYOU_TPLUS_HANDLERS.saleOrder &&
    handlerRef !== YONYOU_TPLUS_HANDLERS.saleDelivery
  ) {
    return undefined;
  }
  if (Array.isArray(input?.selectFields)) {
    return input.selectFields.filter((field): field is string => typeof field === "string");
  }
  const prefix = handlerRef === YONYOU_TPLUS_HANDLERS.saleOrder ? "SaleOrder" : "SaleDelivery";
  return yonyouTplusDefaultVoucherSelectFields(prefix);
}
