import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveControlUiWechatComponentWebhookPath } from "../control-ui-contract.js";
import { sendText } from "../http-common.js";
import { saveWechatComponentVerifyTicket } from "./wechat-component-ticket-store.js";
import { resolveWechatComponentWebhookConfig } from "./wechat-component.js";
import {
  computeWechatOpenPlatformSignature,
  decryptWechatOpenPlatformPayload,
  readWechatOpenPlatformXmlTag,
  verifyWechatOpenPlatformSignature,
} from "./wechat-open-platform-crypto.js";

async function readRawBody(req: IncomingMessage, limitBytes = 256 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limitBytes) {
      throw new Error("Request body too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function resolveWebhookRoute(params: { pathname: string; basePath?: string }) {
  const routeBase = resolveControlUiWechatComponentWebhookPath(params.basePath);
  if (params.pathname !== routeBase) {
    return null;
  }
  return { routeBase };
}

function resolveQuery(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? "/", "http://localhost").searchParams;
}

function parseComponentVerifyTicket(xml: string): string | null {
  const infoType = readWechatOpenPlatformXmlTag(xml, "InfoType");
  if (infoType !== "component_verify_ticket") {
    return null;
  }
  return readWechatOpenPlatformXmlTag(xml, "ComponentVerifyTicket") ?? null;
}

export async function handleWechatComponentWebhookHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { basePath?: string },
): Promise<boolean> {
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  const url = new URL(urlRaw, "http://localhost");
  const route = resolveWebhookRoute({ pathname: url.pathname, basePath: opts.basePath });
  if (!route) {
    return false;
  }

  const config = resolveWechatComponentWebhookConfig();
  if (!config) {
    sendText(res, 503, "WeChat component webhook is not configured.");
    return true;
  }

  const query = resolveQuery(req);
  const signature = query.get("signature")?.trim() ?? "";
  const msgSignature = query.get("msg_signature")?.trim() ?? "";
  const timestamp = query.get("timestamp")?.trim() ?? "";
  const nonce = query.get("nonce")?.trim() ?? "";

  if (req.method === "GET") {
    const echostr = query.get("echostr")?.trim() ?? "";
    if (!echostr) {
      sendText(res, 400, "missing echostr");
      return true;
    }
    const verifySignature = msgSignature || signature;
    if (
      !verifyWechatOpenPlatformSignature({
        token: config.token,
        timestamp,
        nonce,
        value: echostr,
        signature: verifySignature,
      })
    ) {
      sendText(res, 403, "invalid signature");
      return true;
    }
    if (config.encodingAesKey) {
      try {
        const plain = decryptWechatOpenPlatformPayload({
          encodingAesKey: config.encodingAesKey,
          encrypted: echostr,
          receiveId: config.componentAppId,
        });
        sendText(res, 200, plain);
        return true;
      } catch (error) {
        sendText(res, 400, error instanceof Error ? error.message : "decrypt failed");
        return true;
      }
    }
    sendText(res, 200, echostr);
    return true;
  }

  if (req.method !== "POST") {
    return false;
  }

  let rawBody = "";
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    sendText(res, 413, error instanceof Error ? error.message : "body too large");
    return true;
  }

  let xml = rawBody;
  const encrypted = readWechatOpenPlatformXmlTag(rawBody, "Encrypt") ?? "";
  const verifySignature = msgSignature || signature;
  const signatureValue = encrypted || rawBody.trim();

  if (
    !verifyWechatOpenPlatformSignature({
      token: config.token,
      timestamp,
      nonce,
      value: signatureValue,
      signature: verifySignature,
    })
  ) {
    sendText(res, 403, "invalid signature");
    return true;
  }

  if (encrypted && config.encodingAesKey) {
    try {
      xml = decryptWechatOpenPlatformPayload({
        encodingAesKey: config.encodingAesKey,
        encrypted,
        receiveId: config.componentAppId,
      });
    } catch (error) {
      sendText(res, 400, error instanceof Error ? error.message : "decrypt failed");
      return true;
    }
  }

  const ticket = parseComponentVerifyTicket(xml);
  if (ticket) {
    await saveWechatComponentVerifyTicket({
      componentAppId: config.componentAppId,
      verifyTicket: ticket,
      nowIso: new Date().toISOString(),
    });
  }

  sendText(res, 200, "success");
  return true;
}

export function buildWechatComponentWebhookPublicUrl(params: {
  origin: string;
  basePath?: string;
}): string {
  const path = resolveControlUiWechatComponentWebhookPath(params.basePath);
  return `${params.origin.replace(/\/+$/, "")}${path}`;
}

export function resolveWechatComponentWebhookSignatureHint(params: {
  token: string;
  timestamp: string;
  nonce: string;
  value: string;
}): string {
  return computeWechatOpenPlatformSignature(params);
}
