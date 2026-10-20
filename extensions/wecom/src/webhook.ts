import {
  createDecipheriv,
  createHash,
  createCipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createWebhookInFlightLimiter,
  readWebhookBodyOrReject,
  registerWebhookTargetWithPluginRoute,
  resolveWebhookPath,
  resolveWebhookTargetWithAuthOrRejectSync,
  withResolvedWebhookRequestPipeline,
  type RegisterWebhookPluginRouteOptions,
} from "openclaw/plugin-sdk/wecom";
import type { OpenBotConfig } from "openclaw/plugin-sdk/wecom";
import type { ResolvedWecomAccount } from "./types.js";

export type WecomWebhookTarget = {
  account: ResolvedWecomAccount;
  config: OpenBotConfig;
  path: string;
  runtime: {
    log?: (message: string) => void;
    error?: (message: string) => void;
  };
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

export type WecomInboundMessage = {
  msgType: string;
  fromUserName: string;
  toUserName?: string;
  agentId?: string;
  content?: string;
  msgId?: string;
  createTime?: number;
  event?: string;
  eventKey?: string;
  /** Present when inbound arrived via AIBot WebSocket (aibot_msg_callback). */
  aibotReqId?: string;
};

const webhookTargets = new Map<string, WecomWebhookTarget[]>();
const webhookInFlightLimiter = createWebhookInFlightLimiter();

function readXmlTag(xml: string, tag: string): string | undefined {
  const match = xml.match(
    new RegExp(`<${tag}>(?:<!\\[CDATA\\[(.*?)\\]\\]>|([^<]*))<\\/${tag}>`, "s"),
  );
  const raw = match?.[1] ?? match?.[2] ?? "";
  const value = raw.trim();
  return value || undefined;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeAesKey(key: string): Buffer {
  const normalized = key.trim();
  if (!normalized) {
    throw new Error("WeCom encodingAesKey is empty.");
  }
  const decoded = Buffer.from(`${normalized}=`, "base64");
  if (decoded.length !== 32) {
    throw new Error("WeCom encodingAesKey must decode to 32 bytes.");
  }
  return decoded;
}

function stripPkcs7(data: Buffer): Buffer {
  const padding = data[data.length - 1] ?? 0;
  if (padding <= 0 || padding > 32) {
    throw new Error("Invalid WeCom PKCS7 padding.");
  }
  return data.subarray(0, data.length - padding);
}

function addPkcs7(data: Buffer): Buffer {
  const blockSize = 32;
  const padding = blockSize - (data.length % blockSize || blockSize);
  return Buffer.concat([data, Buffer.alloc(padding || blockSize, padding || blockSize)]);
}

export function computeWecomSignature(params: {
  token: string;
  timestamp: string;
  nonce: string;
  value: string;
}): string {
  const payload = [params.token, params.timestamp, params.nonce, params.value].sort().join("");
  return createHash("sha1").update(payload).digest("hex");
}

function signatureMatches(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function decryptWecomPayload(params: {
  encodingAesKey: string;
  encrypted: string;
  corpId?: string;
}): string {
  const key = decodeAesKey(params.encodingAesKey);
  const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(params.encrypted, "base64")),
    decipher.final(),
  ]);
  const payload = stripPkcs7(decrypted);
  const xmlLength = payload.readUInt32BE(16);
  const xmlStart = 20;
  const xmlEnd = xmlStart + xmlLength;
  const xml = payload.subarray(xmlStart, xmlEnd).toString("utf8");
  const receiveId = payload.subarray(xmlEnd).toString("utf8");
  if (params.corpId && receiveId && receiveId !== params.corpId) {
    throw new Error(`WeCom receiveId mismatch: expected ${params.corpId}, got ${receiveId}`);
  }
  return xml;
}

export function encryptWecomPayload(params: {
  encodingAesKey: string;
  plainText: string;
  corpId: string;
}): string {
  const key = decodeAesKey(params.encodingAesKey);
  const content = Buffer.from(params.plainText, "utf8");
  const randomPrefix = randomBytes(16);
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(content.length, 0);
  const payload = addPkcs7(
    Buffer.concat([randomPrefix, lengthBuffer, content, Buffer.from(params.corpId, "utf8")]),
  );
  const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(payload), cipher.final()]).toString("base64");
}

function parseWecomMessageXml(xml: string): WecomInboundMessage {
  return {
    msgType: readXmlTag(xml, "MsgType") ?? "",
    fromUserName: readXmlTag(xml, "FromUserName") ?? "",
    toUserName: readXmlTag(xml, "ToUserName"),
    agentId: readXmlTag(xml, "AgentID"),
    content: readXmlTag(xml, "Content"),
    msgId: readXmlTag(xml, "MsgId"),
    createTime: Number.parseInt(readXmlTag(xml, "CreateTime") ?? "", 10) || undefined,
    event: readXmlTag(xml, "Event"),
    eventKey: readXmlTag(xml, "EventKey"),
  };
}

function resolveEncryptedEnvelope(xml: string): string | undefined {
  return readXmlTag(xml, "Encrypt");
}

function resolveQuery(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? "/", "http://localhost").searchParams;
}

function selectTargetForVerification(params: {
  targets: readonly WecomWebhookTarget[];
  res: ServerResponse;
  signature: string;
  timestamp: string;
  nonce: string;
  value: string;
}): WecomWebhookTarget | null {
  return resolveWebhookTargetWithAuthOrRejectSync({
    targets: params.targets,
    res: params.res,
    isMatch: (target) => {
      if (!target.account.token) {
        return false;
      }
      const computed = computeWecomSignature({
        token: target.account.token,
        timestamp: params.timestamp,
        nonce: params.nonce,
        value: params.value,
      });
      return signatureMatches(computed, params.signature);
    },
    unauthorizedStatusCode: 401,
    unauthorizedMessage: "unauthorized",
    ambiguousStatusCode: 409,
    ambiguousMessage: "ambiguous webhook target",
  });
}

function selectTargetWithoutSignature(
  targets: readonly WecomWebhookTarget[],
  res: ServerResponse,
): WecomWebhookTarget | null {
  if (targets.length === 1) {
    return targets[0] ?? null;
  }
  res.statusCode = 409;
  res.end("ambiguous webhook target");
  return null;
}

function respondXml(res: ServerResponse, text: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(text);
}

export function resolveWecomWebhookPath(account: ResolvedWecomAccount): string | undefined {
  return (
    resolveWebhookPath({
      webhookPath: account.config.webhookPath,
      webhookUrl: account.config.webhookUrl,
      defaultPath: "/wecom",
    }) ?? undefined
  );
}

export function registerWecomWebhookTarget(
  target: WecomWebhookTarget,
  route?: RegisterWebhookPluginRouteOptions,
): () => void {
  return registerWebhookTargetWithPluginRoute({
    targetsByPath: webhookTargets,
    target,
    route: route ?? {
      auth: "plugin",
      match: "exact",
      pluginId: "wecom",
      source: "wecom-webhook",
      accountId: target.account.accountId,
      log: target.runtime.log,
      handler: async (req, res) => {
        const handled = await handleWecomWebhookRequest(req, res, async () => {});
        if (!handled && !res.headersSent) {
          res.statusCode = 404;
          res.end("Not Found");
        }
      },
    },
  }).unregister;
}

export async function handleWecomWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
  processMessage: (params: {
    message: WecomInboundMessage;
    target: WecomWebhookTarget;
  }) => Promise<void>,
): Promise<boolean> {
  return await withResolvedWebhookRequestPipeline({
    req,
    res,
    targetsByPath: webhookTargets,
    allowMethods: ["GET", "POST"],
    inFlightLimiter: webhookInFlightLimiter,
    handle: async ({ targets }) => {
      const query = resolveQuery(req);
      const timestamp = query.get("timestamp")?.trim() ?? "";
      const nonce = query.get("nonce")?.trim() ?? "";
      const msgSignature = query.get("msg_signature")?.trim() ?? "";

      if (req.method === "GET") {
        const echoStr = query.get("echostr")?.trim() ?? "";
        if (!echoStr) {
          res.statusCode = 400;
          res.end("missing echostr");
          return true;
        }
        let target: WecomWebhookTarget | null;
        if (msgSignature && timestamp && nonce) {
          target = selectTargetForVerification({
            targets,
            res,
            signature: msgSignature,
            timestamp,
            nonce,
            value: echoStr,
          });
          if (!target) {
            return true;
          }
          if (target.account.encodingAesKey) {
            respondXml(
              res,
              decryptWecomPayload({
                encodingAesKey: target.account.encodingAesKey,
                encrypted: echoStr,
                corpId: target.account.corpId,
              }),
            );
            return true;
          }
        } else {
          target = selectTargetWithoutSignature(targets, res);
          if (!target) {
            return true;
          }
        }
        respondXml(res, echoStr);
        return true;
      }

      const body = await readWebhookBodyOrReject({
        req,
        res,
        maxBytes: 256 * 1024,
        timeoutMs: 15_000,
        invalidBodyMessage: "invalid xml",
      });
      if (!body.ok) {
        return true;
      }

      const rawXml = body.value.trim();
      if (!rawXml) {
        res.statusCode = 400;
        res.end("empty body");
        return true;
      }

      const encrypted = resolveEncryptedEnvelope(rawXml);
      let target: WecomWebhookTarget | null;
      let messageXml = rawXml;
      if (encrypted) {
        if (!msgSignature || !timestamp || !nonce) {
          res.statusCode = 401;
          res.end("unauthorized");
          return true;
        }
        target = selectTargetForVerification({
          targets,
          res,
          signature: msgSignature,
          timestamp,
          nonce,
          value: encrypted,
        });
        if (!target) {
          return true;
        }
        if (!target.account.encodingAesKey) {
          res.statusCode = 400;
          res.end("missing encodingAesKey");
          return true;
        }
        messageXml = decryptWecomPayload({
          encodingAesKey: target.account.encodingAesKey,
          encrypted,
          corpId: target.account.corpId,
        });
      } else {
        target = selectTargetWithoutSignature(targets, res);
        if (!target) {
          return true;
        }
      }

      const message = parseWecomMessageXml(messageXml);
      if (!message.msgType || !message.fromUserName) {
        res.statusCode = 400;
        res.end("invalid message");
        return true;
      }

      target.statusSink?.({ lastInboundAt: Date.now() });
      processMessage({ message, target }).catch((error) => {
        target.runtime.error?.(
          `[${target.account.accountId}] WeCom webhook failed: ${String(error)}`,
        );
      });

      respondXml(res, "success");
      return true;
    },
  });
}

export function buildWecomTextReplyXml(params: {
  toUser: string;
  fromUser: string;
  content: string;
  timestamp?: number;
}): string {
  const timestamp = Math.floor(params.timestamp ?? Date.now() / 1000);
  return `<xml><ToUserName><![CDATA[${escapeXml(params.toUser)}]]></ToUserName><FromUserName><![CDATA[${escapeXml(params.fromUser)}]]></FromUserName><CreateTime>${String(timestamp)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${escapeXml(params.content)}]]></Content></xml>`;
}
