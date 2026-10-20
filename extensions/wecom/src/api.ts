import { probeWecomAibotLongConnection } from "./aibot-ws.js";
import type {
  ResolvedWecomAccount,
  WecomProbeResult,
  WecomSendMessageResponse,
  WecomTokenResponse,
} from "./types.js";

const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

function buildTokenCacheKey(account: ResolvedWecomAccount): string {
  return `${account.corpId ?? ""}:${account.secret ?? ""}`;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`HTTP ${String(response.status)} returned an empty response.`);
  }
  return JSON.parse(text) as T;
}

async function requestWecomJson<T>(url: URL, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)} ${response.statusText}`);
  }
  const data = await readJsonResponse<Record<string, unknown>>(response);
  const errcode = Number(data.errcode ?? 0);
  if (Number.isFinite(errcode) && errcode !== 0) {
    throw new Error(`WeCom API ${String(errcode)}: ${String(data.errmsg ?? "unknown error")}`);
  }
  return data as T;
}

export async function getWecomAccessToken(account: ResolvedWecomAccount): Promise<string> {
  if (!account.corpId || !account.secret) {
    throw new Error("WeCom corpId and secret are required.");
  }
  const cacheKey = buildTokenCacheKey(account);
  const cached = accessTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/gettoken");
  url.searchParams.set("corpid", account.corpId);
  url.searchParams.set("corpsecret", account.secret);
  const data = await requestWecomJson<WecomTokenResponse & { errcode?: number; errmsg?: string }>(
    url,
  );
  const accessToken = String(data.access_token ?? "").trim();
  if (!accessToken) {
    throw new Error("WeCom gettoken returned an empty access_token.");
  }
  const ttlMs = Math.max(60, Number(data.expires_in ?? 7200) - 60) * 1000;
  accessTokenCache.set(cacheKey, {
    token: accessToken,
    expiresAt: Date.now() + ttlMs,
  });
  return accessToken;
}

export function normalizeWecomTarget(value: string | null | undefined): string | undefined {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed
    .replace(/^wecom:/i, "")
    .replace(/^wechat-work:/i, "")
    .replace(/^user:/i, "")
    .trim();
}

export async function sendWecomTextMessage(params: {
  account: ResolvedWecomAccount;
  to: string;
  text: string;
}): Promise<{ messageId: string }> {
  const target = normalizeWecomTarget(params.to);
  if (!target) {
    throw new Error("WeCom target is required.");
  }
  if (!params.account.agentId) {
    throw new Error("WeCom agentId is required.");
  }

  const accessToken = await getWecomAccessToken(params.account);
  const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/message/send");
  url.searchParams.set("access_token", accessToken);
  const data = await requestWecomJson<WecomSendMessageResponse>(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      touser: target,
      msgtype: "text",
      agentid: params.account.agentId,
      text: { content: params.text },
      safe: 0,
      enable_id_trans: 0,
      enable_duplicate_check: 0,
    }),
  });
  return {
    messageId: String(data.msgid ?? ""),
  };
}

export async function probeWecom(account: ResolvedWecomAccount): Promise<WecomProbeResult> {
  if (account.connectionMode === "websocket") {
    return await probeWecomAibotLongConnection({
      botId: account.botId ?? "",
      secret: account.secret ?? "",
    });
  }
  const startedAt = Date.now();
  try {
    await getWecomAccessToken(account);
    return { ok: true, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
