/**
 * Chanjet message receiver for 用友 T+.
 * The platform requires HTTP 200 and `{"result":"success"}` within a few seconds.
 * Contracts: https://open.chanjet.com/docs/file/guide/commonContent/jcwd-xxts/xxgs-jrzy
 * and https://open.chanjet.com/docs/file/guide/commonContent/jcwd-xxts/xxgs-xxlb
 */
import { createDecipheriv } from "node:crypto";
import {
  exchangeYonyouTplusOrgPermanentAuthCode,
  getYonyouTplusAppAccessToken,
  resolveYonyouTplusAppCredentials,
} from "./adapters/yonyou-tplus-oauth.js";
import {
  listYonyouTplusMessageEvents,
  loadYonyouTplusAppTicket,
  recordYonyouTplusMessageEvent,
  saveYonyouTplusAppTicket,
  saveYonyouTplusOrgPermanentAuth,
} from "./yonyou-tplus-message-store.js";

/** Default control-ui path. A configured control-ui base path is prefixed. */
export const YONYOU_TPLUS_CHANJET_MESSAGE_PATH = "/__openbot/enterprise-data/chanjet/messages";

export const YONYOU_TPLUS_MESSAGE_ACK = { result: "success" } as const;

export type YonyouTplusMessageAcceptResult = {
  msgType: string | null;
  stored: boolean;
  note?: string;
};

type ChanjetMessage = {
  id?: string;
  appKey?: string;
  msgType?: string;
  time?: string;
  bizContent?: Record<string, unknown>;
};

function messageKeyFromEnv(): string {
  return process.env.OPENBOT_ENTERPRISE_DATA_YONYOU_TPLUS_MESSAGE_KEY?.trim() || "";
}

/** AES-128-ECB PKCS7, matching Chanjet's published decrypt sample. */
export function decryptYonyouTplusMessage(encryptMsg: string, key: string): string {
  const trimmedKey = key.trim();
  if (Buffer.byteLength(trimmedKey) !== 16) {
    throw new Error("用友 T+ 消息密钥必须是 16 字节。");
  }
  const decipher = createDecipheriv("aes-128-ecb", Buffer.from(trimmedKey, "utf8"), null);
  decipher.setAutoPadding(true);
  const decoded = Buffer.from(encryptMsg.replace(/\s+/g, ""), "base64");
  return Buffer.concat([decipher.update(decoded), decipher.final()]).toString("utf8");
}

export function decodeYonyouTplusChanjetBody(raw: unknown, messageKey?: string): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }
  const record = raw as Record<string, unknown>;
  const encryptMsg = record.encryptMsg;
  if (typeof encryptMsg !== "string" || !encryptMsg.trim()) {
    return raw;
  }
  const key = messageKey ?? messageKeyFromEnv();
  if (!key) {
    throw new Error("用友 T+ 消息已加密，但未配置消息密钥。");
  }
  const plain = decryptYonyouTplusMessage(encryptMsg, key);
  return JSON.parse(plain) as unknown;
}

function asMessage(raw: unknown): ChanjetMessage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const biz = record.bizContent;
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    appKey: typeof record.appKey === "string" ? record.appKey : undefined,
    msgType: typeof record.msgType === "string" ? record.msgType : undefined,
    time: typeof record.time === "string" ? record.time : undefined,
    bizContent:
      biz && typeof biz === "object" && !Array.isArray(biz)
        ? (biz as Record<string, unknown>)
        : undefined,
  };
}

function bizString(message: ChanjetMessage, key: string): string {
  const value = message.bizContent?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function redact(note: string, secrets: string[]): string {
  let text = note;
  for (const secret of secrets) {
    if (secret.length >= 6) {
      text = text.split(secret).join("[redacted]");
    }
  }
  return text.slice(0, 160);
}

export async function acceptYonyouTplusChanjetMessage(params: {
  body: unknown;
  nowIso: string;
  storePath?: string;
  messageKey?: string;
}): Promise<YonyouTplusMessageAcceptResult> {
  const configuredKey = (params.messageKey ?? messageKeyFromEnv()).trim();
  const encrypted =
    params.body != null &&
    typeof params.body === "object" &&
    !Array.isArray(params.body) &&
    typeof (params.body as { encryptMsg?: unknown }).encryptMsg === "string";
  if (configuredKey && !encrypted) {
    await recordYonyouTplusMessageEvent(
      { msgType: "rejected", receivedAt: params.nowIso, note: "plaintext_rejected" },
      params.storePath,
    );
    return { msgType: null, stored: false, note: "plaintext_rejected" };
  }
  const decoded = decodeYonyouTplusChanjetBody(params.body, params.messageKey);
  const message = asMessage(decoded);
  const msgType = message?.msgType?.trim() || null;
  if (!message || !msgType) {
    await recordYonyouTplusMessageEvent(
      { msgType: "unknown", receivedAt: params.nowIso, note: "unrecognized_body" },
      params.storePath,
    );
    return { msgType: null, stored: false, note: "unrecognized_body" };
  }

  if (msgType === "APP_TEST") {
    await recordYonyouTplusMessageEvent(
      { id: message.id, msgType, receivedAt: params.nowIso, note: "address_check" },
      params.storePath,
    );
    return { msgType, stored: true, note: "address_check" };
  }

  if (msgType === "APP_TICKET") {
    const appTicket = bizString(message, "appTicket");
    const appKey = message.appKey?.trim() || "";
    if (!appTicket || !appKey) {
      await recordYonyouTplusMessageEvent(
        { id: message.id, msgType, receivedAt: params.nowIso, note: "missing_app_ticket" },
        params.storePath,
      );
      return { msgType, stored: false, note: "missing_app_ticket" };
    }
    await saveYonyouTplusAppTicket({
      appKey,
      appTicket,
      receivedAt: params.nowIso,
      storePath: params.storePath,
    });
    await recordYonyouTplusMessageEvent(
      { id: message.id, msgType, receivedAt: params.nowIso, note: "app_ticket_stored" },
      params.storePath,
    );
    return { msgType, stored: true, note: "app_ticket_stored" };
  }

  if (msgType === "TEMP_AUTH_CODE") {
    const tempAuthCode = bizString(message, "tempAuthCode");
    const app = resolveYonyouTplusAppCredentials();
    const appKey = message.appKey?.trim() || app?.appKey || "";
    const appTicket = appKey ? await loadYonyouTplusAppTicket(appKey, params.storePath) : null;
    if (!tempAuthCode || !app || !appTicket) {
      await recordYonyouTplusMessageEvent(
        {
          id: message.id,
          msgType,
          receivedAt: params.nowIso,
          note: "temp_auth_pending",
        },
        params.storePath,
      );
      return { msgType, stored: false, note: "temp_auth_pending" };
    }
    try {
      const appAccess = await getYonyouTplusAppAccessToken({
        appKey: app.appKey,
        appSecret: app.appSecret,
        appTicket,
        gatewayOrigin: app.gatewayOrigin,
      });
      const org = await exchangeYonyouTplusOrgPermanentAuthCode({
        appKey: app.appKey,
        appSecret: app.appSecret,
        appAccessToken: appAccess.appAccessToken,
        tempAuthCode,
        gatewayOrigin: app.gatewayOrigin,
      });
      if (!org.orgId) {
        throw new Error("用友 T+ 获取企业永久授权码未返回 orgId。");
      }
      await saveYonyouTplusOrgPermanentAuth({
        orgId: org.orgId,
        permanentAuthCode: org.permanentAuthCode,
        appName: org.appName,
        appId: org.appId,
        updatedAt: params.nowIso,
        storePath: params.storePath,
      });
      await recordYonyouTplusMessageEvent(
        {
          id: message.id,
          msgType,
          receivedAt: params.nowIso,
          orgId: org.orgId,
          note: "org_permanent_stored",
        },
        params.storePath,
      );
      return { msgType, stored: true, note: "org_permanent_stored" };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "exchange_failed";
      await recordYonyouTplusMessageEvent(
        {
          id: message.id,
          msgType,
          receivedAt: params.nowIso,
          note: redact(detail, [tempAuthCode]),
        },
        params.storePath,
      );
      return { msgType, stored: false, note: "temp_auth_exchange_failed" };
    }
  }

  const orgId = bizString(message, "orgId") || undefined;
  await recordYonyouTplusMessageEvent(
    {
      id: message.id,
      msgType,
      receivedAt: params.nowIso,
      orgId,
      note: "subscribed_event_stub",
    },
    params.storePath,
  );
  return { msgType, stored: true, note: "subscribed_event_stub" };
}

export async function latestYonyouTplusMessageEvent(storePath?: string) {
  const events = await listYonyouTplusMessageEvents(storePath);
  return events[0] ?? null;
}
