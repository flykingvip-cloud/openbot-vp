import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";

const WECHAT_STABLE_TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/stable_token";
const WECHAT_TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token";

/** Same env key convention as scripts/dev/seed-wechat-official-identity.ts */
export function buildWechatOfficialAppSecretEnvKey(appId: string): string {
  return `WECHAT_OFFICIAL_${normalizeWechatOfficialAppId(appId).toUpperCase()}_APPSECRET`;
}

export function resolveDefaultWechatOfficialEnvPath(): string {
  return path.join(CONFIG_DIR, ".env");
}

export function normalizeWechatOfficialAppId(value: string): string {
  return value.trim();
}

export function isValidWechatOfficialAppId(value: string): boolean {
  return /^wx[0-9a-zA-Z]{16}$/.test(normalizeWechatOfficialAppId(value));
}

export function shouldSkipWechatOfficialCredentialProbe(): boolean {
  const raw =
    process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_WECHAT_OA_SKIP_PROBE?.trim() ||
    process.env.OPENCLAW_USER_OPERATIONAL_IDENTITY_WECHAT_OA_SKIP_PROBE?.trim() ||
    process.env.OPENBOT_WECHAT_OFFICIAL_SKIP_PROBE?.trim();
  return raw === "1" || raw?.toLowerCase() === "true";
}

export function readWechatOfficialAppSecretFromEnv(params: {
  appId: string;
  envPath?: string;
  env?: NodeJS.ProcessEnv;
}): string | null {
  const appId = normalizeWechatOfficialAppId(params.appId);
  if (!appId) {
    return null;
  }
  const key = buildWechatOfficialAppSecretEnvKey(appId);
  const fromProcess = (params.env ?? process.env)[key]?.trim();
  if (fromProcess) {
    return fromProcess;
  }
  const resolvedPath = resolveUserPath(
    params.envPath?.trim() || resolveDefaultWechatOfficialEnvPath(),
  );
  let content = "";
  try {
    content = readFileSync(resolvedPath, "utf8");
  } catch {
    return null;
  }
  const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
  const value = match?.[1]?.trim();
  return value || null;
}

export function persistWechatOfficialAppSecretToEnv(params: {
  appId: string;
  appSecret: string;
  envPath?: string;
}): { ok: true; envKey: string; envPath: string } | { ok: false; code: string; error: string } {
  const appId = normalizeWechatOfficialAppId(params.appId);
  const appSecret = params.appSecret.trim();
  if (!isValidWechatOfficialAppId(appId)) {
    return {
      ok: false,
      code: "WECHAT_OA_APPID_INVALID",
      error: "AppID 格式无效，应以 wx 开头。",
    };
  }
  if (!appSecret) {
    return {
      ok: false,
      code: "WECHAT_OA_SECRET_REQUIRED",
      error: "AppSecret 不能为空。",
    };
  }
  const envKey = buildWechatOfficialAppSecretEnvKey(appId);
  const resolvedPath = resolveUserPath(
    params.envPath?.trim() || resolveDefaultWechatOfficialEnvPath(),
  );
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  let existing = "";
  try {
    existing = readFileSync(resolvedPath, "utf8");
  } catch {
    existing = "";
  }
  const line = `${envKey}=${appSecret}`;
  if (existing.includes(`${envKey}=`)) {
    const next = existing.replace(new RegExp(`^${envKey}=.*$`, "m"), line);
    writeFileSync(resolvedPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
  } else {
    appendFileSync(
      resolvedPath,
      `${existing.endsWith("\n") || existing === "" ? "" : "\n"}${line}\n`,
    );
  }
  process.env[envKey] = appSecret;
  return { ok: true, envKey, envPath: resolvedPath };
}

export async function probeWechatOfficialCredentials(params: {
  appId: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
  forceRefresh?: boolean;
}): Promise<{ ok: true; accessToken: string } | { ok: false; code: string; error: string }> {
  const appId = normalizeWechatOfficialAppId(params.appId);
  const appSecret = params.appSecret.trim();
  if (!isValidWechatOfficialAppId(appId)) {
    return {
      ok: false,
      code: "USER_IDENTITY_WECHAT_OA_APPID_INVALID",
      error: "AppID 格式无效，应以 wx 开头。",
    };
  }
  if (!appSecret) {
    return {
      ok: false,
      code: "USER_IDENTITY_WECHAT_OA_SECRET_REQUIRED",
      error: "AppSecret 不能为空。",
    };
  }
  if (shouldSkipWechatOfficialCredentialProbe()) {
    return { ok: true, accessToken: "skipped-probe" };
  }
  const fetchImpl = params.fetchImpl ?? fetch;
  let payload: { access_token?: string; errcode?: number; errmsg?: string };
  try {
    payload = await requestWechatOfficialAccessTokenPayload({
      appId,
      appSecret,
      fetchImpl,
      forceRefresh: params.forceRefresh === true,
    });
  } catch {
    return {
      ok: false,
      code: "USER_IDENTITY_WECHAT_OA_PROBE_FAILED",
      error: "无法连接微信公众平台校验凭证，请稍后重试。",
    };
  }
  if (payload.access_token?.trim()) {
    return { ok: true, accessToken: payload.access_token.trim() };
  }
  const errcode = payload.errcode;
  const errmsg = payload.errmsg?.trim() || "凭证校验失败";
  if (errcode === 40164 || /ip/i.test(errmsg)) {
    return {
      ok: false,
      code: "USER_IDENTITY_WECHAT_OA_IP_WHITELIST",
      error: explainWechatOfficialTokenError(errcode, errmsg),
    };
  }
  if (errcode === 40001 || errcode === 40125 || /secret|invalid/i.test(errmsg)) {
    return {
      ok: false,
      code: "USER_IDENTITY_WECHAT_OA_SECRET_INVALID",
      error: explainWechatOfficialTokenError(errcode, errmsg),
    };
  }
  return {
    ok: false,
    code: "USER_IDENTITY_WECHAT_OA_PROBE_FAILED",
    error: explainWechatOfficialTokenError(errcode, errmsg),
  };
}

async function requestWechatOfficialAccessTokenPayload(params: {
  appId: string;
  appSecret: string;
  fetchImpl: typeof fetch;
  forceRefresh?: boolean;
}): Promise<{ access_token?: string; errcode?: number; errmsg?: string }> {
  try {
    const stableResponse = await params.fetchImpl(WECHAT_STABLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credential",
        appid: params.appId,
        secret: params.appSecret,
        force_refresh: params.forceRefresh === true,
      }),
    });
    const stablePayload = (await stableResponse.json()) as {
      access_token?: string;
      errcode?: number;
      errmsg?: string;
    };
    // A WeChat errcode from stable_token must not fall through to cgi-bin/token:
    // that legacy call invalidates the stable ticket (40001 not latest).
    if (stablePayload.access_token?.trim() || stablePayload.errcode != null) {
      return stablePayload;
    }
  } catch {
    // Only when stable_token is unreachable: last-chance gettoken so send can proceed.
  }
  const url = new URL(WECHAT_TOKEN_URL);
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", params.appId);
  url.searchParams.set("secret", params.appSecret);
  const response = await params.fetchImpl(url.toString(), { method: "GET" });
  return (await response.json()) as { access_token?: string; errcode?: number; errmsg?: string };
}

export function explainWechatOfficialTokenError(errcode?: number, errmsg?: string): string {
  const message = errmsg?.trim() || "凭证校验失败";
  const rejectedIp = /invalid ip\s+([0-9a-f.:]+)/i.exec(message)?.[1];
  if (errcode === 40164 || /ip/i.test(message)) {
    return rejectedIp
      ? `IP 白名单未放行 ${rejectedIp}，请在微信公众平台 → 开发 → 基本配置中添加后再试。`
      : "IP 白名单未放行网关出口 IP，请在微信公众平台 → 开发 → 基本配置中添加后再试。";
  }
  if (errcode === 40013 || /invalid appid/i.test(message)) {
    return "AppID 无效，请核对微信公众平台中的 AppID。";
  }
  if (errcode === 40001 || errcode === 40125 || /secret|invalid/i.test(message)) {
    return "AppSecret 无效或已重置，请在微信公众平台重新启用并复制。";
  }
  return `公众号凭证校验失败：${message}${errcode != null ? ` (${errcode})` : ""}`;
}

/**
 * Shared ticket retry for enterprise and personal identities.
 * Config stays AppID + AppSecret; access_token is runtime-only.
 * Exchange failure refreshes once, then the business API still runs.
 */
export function isWechatOfficialAccessTokenRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const lower = message.toLowerCase();
  return (
    lower.includes("access_token expired") ||
    lower.includes("access_token is invalid") ||
    lower.includes("invalid or not latest") ||
    /\b42001\b/.test(message) ||
    /\b41001\b/.test(message) ||
    (/\b40001\b/.test(message) && /access_token|credential/i.test(message))
  );
}

export async function executeWechatOfficialActionWithTicketRetry<T>(params: {
  resolveTicket: (forceRefresh: boolean) => Promise<string | null>;
  cachedTicket?: string | null;
  execute: (accessToken: string) => Promise<T>;
  missingTicketError?: string;
}): Promise<T> {
  let ticket = (await params.resolveTicket(false))?.trim() || "";
  if (!ticket) {
    ticket = (await params.resolveTicket(true))?.trim() || "";
  }
  if (!ticket) {
    ticket = params.cachedTicket?.trim() || "";
  }
  if (!ticket) {
    throw new Error(
      params.missingTicketError ?? "缺少 AppID 或 access_token；请保存 AppID 与 AppSecret。",
    );
  }

  try {
    return await params.execute(ticket);
  } catch (error) {
    if (!isWechatOfficialAccessTokenRetryableError(error)) {
      throw error;
    }
    const refreshed = (await params.resolveTicket(true))?.trim() || ticket;
    return await params.execute(refreshed);
  }
}

/** Align personal catalog actions with enterprise wechat-official adapter. */
export const WECHAT_OFFICIAL_OPERATIONAL_ACTIONS = [
  { action: "verify_credentials", label: "验证凭证" },
  { action: "upload_thumb", label: "上传封面" },
  { action: "upload_content_image", label: "上传正文图片" },
  { action: "publish_draft", label: "创建草稿" },
  { action: "publish_article", label: "发布文章" },
  { action: "broadcast_article", label: "群发图文" },
  { action: "get_publish_status", label: "查询发布状态" },
] as const;

export const WECHAT_OFFICIAL_DATA_SYNC_ACTIONS = [
  { action: "sync_follower_stats", label: "同步粉丝统计" },
  { action: "sync_article_metrics", label: "同步阅读数据" },
] as const;
