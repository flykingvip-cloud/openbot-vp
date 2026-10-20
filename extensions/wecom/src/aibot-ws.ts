/**
 * WeCom AIBot long-connection client (wss://openws.work.weixin.qq.com).
 *
 * Protocol: aibot_subscribe → aibot_msg_callback → aibot_respond_msg (+ ping heartbeat).
 * Spec: https://developer.work.weixin.qq.com/document/path/101463
 */

import { randomUUID } from "node:crypto";
import WebSocket from "ws";

export const WECOM_AIBOT_DEFAULT_WS_URL = "wss://openws.work.weixin.qq.com";

export type WecomAibotTextCallback = {
  reqId: string;
  msgId?: string;
  botId?: string;
  chatId?: string;
  chatType?: string;
  fromUserId: string;
  content: string;
};

export type WecomAibotWsClientOptions = {
  botId: string;
  secret: string;
  wsUrl?: string;
  heartbeatIntervalMs?: number;
  maxReconnectAttempts?: number;
  log?: (message: string) => void;
  error?: (message: string) => void;
  onTextMessage: (message: WecomAibotTextCallback) => void | Promise<void>;
  abortSignal?: AbortSignal;
};

type WsFrame = {
  cmd?: string;
  headers?: { req_id?: string };
  body?: Record<string, unknown>;
  errcode?: number;
  errmsg?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nextReqId(): string {
  return randomUUID().replaceAll("-", "");
}

export class WecomAibotWsClient {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private reconnectAttempt = 0;
  private readonly opts: Required<
    Pick<
      WecomAibotWsClientOptions,
      "botId" | "secret" | "wsUrl" | "heartbeatIntervalMs" | "maxReconnectAttempts"
    >
  > &
    WecomAibotWsClientOptions;

  constructor(options: WecomAibotWsClientOptions) {
    this.opts = {
      wsUrl: WECOM_AIBOT_DEFAULT_WS_URL,
      heartbeatIntervalMs: 30_000,
      maxReconnectAttempts: Number.POSITIVE_INFINITY,
      ...options,
    };
  }

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    this.clearHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }

  async replyText(params: { reqId: string; text: string }): Promise<void> {
    const streamId = nextReqId();
    await this.sendFrame({
      cmd: "aibot_respond_msg",
      headers: { req_id: params.reqId },
      body: {
        msgtype: "stream",
        stream: {
          id: streamId,
          finish: true,
          content: params.text,
        },
      },
    });
  }

  private connect(): void {
    if (this.closed || this.opts.abortSignal?.aborted) {
      return;
    }
    const log = this.opts.log ?? (() => undefined);
    const error = this.opts.error ?? (() => undefined);
    log(`wecom aibot: connecting ${this.opts.wsUrl}`);
    const socket = new WebSocket(this.opts.wsUrl);
    this.socket = socket;

    socket.on("open", () => {
      void this.subscribe().catch((err) => {
        error(`wecom aibot: subscribe failed: ${String(err)}`);
        socket.close();
      });
    });

    socket.on("message", (data) => {
      void this.handleMessage(String(data)).catch((err) => {
        error(`wecom aibot: message handler error: ${String(err)}`);
      });
    });

    socket.on("close", () => {
      this.clearHeartbeat();
      this.socket = null;
      if (!this.closed && !this.opts.abortSignal?.aborted) {
        this.scheduleReconnect();
      }
    });

    socket.on("error", (err) => {
      error(`wecom aibot: socket error: ${String(err)}`);
    });
  }

  private async subscribe(): Promise<void> {
    const reqId = nextReqId();
    await this.sendFrame({
      cmd: "aibot_subscribe",
      headers: { req_id: reqId },
      body: {
        bot_id: this.opts.botId,
        secret: this.opts.secret,
      },
    });
    this.reconnectAttempt = 0;
    this.startHeartbeat();
    this.opts.log?.(`wecom aibot: subscribed botId=${this.opts.botId}`);
  }

  private async handleMessage(raw: string): Promise<void> {
    let frame: WsFrame;
    try {
      frame = JSON.parse(raw) as WsFrame;
    } catch {
      return;
    }
    const cmd = typeof frame.cmd === "string" ? frame.cmd : "";
    if (cmd === "pong") {
      return;
    }
    if (typeof frame.errcode === "number" && frame.errcode !== 0 && !cmd) {
      this.opts.error?.(
        `wecom aibot: frame error ${String(frame.errcode)}: ${String(frame.errmsg ?? "unknown")}`,
      );
      return;
    }
    if (cmd !== "aibot_msg_callback") {
      return;
    }
    const body = asRecord(frame.body);
    if (!body) {
      return;
    }
    const msgtype = typeof body.msgtype === "string" ? body.msgtype : "";
    if (msgtype !== "text") {
      return;
    }
    const text = asRecord(body.text);
    const content = typeof text?.content === "string" ? text.content.trim() : "";
    const from = asRecord(body.from);
    const fromUserId = typeof from?.userid === "string" ? from.userid.trim() : "";
    const reqId = typeof frame.headers?.req_id === "string" ? frame.headers.req_id.trim() : "";
    if (!content || !fromUserId || !reqId) {
      return;
    }
    await this.opts.onTextMessage({
      reqId,
      msgId: typeof body.msgid === "string" ? body.msgid : undefined,
      botId: typeof body.aibotid === "string" ? body.aibotid : undefined,
      chatId: typeof body.chatid === "string" ? body.chatid : undefined,
      chatType: typeof body.chattype === "string" ? body.chattype : undefined,
      fromUserId,
      content,
    });
  }

  private async sendFrame(frame: WsFrame): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("WeCom AIBot WebSocket is not open");
    }
    await new Promise<void>((resolve, reject) => {
      socket.send(JSON.stringify(frame), (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      void this.sendFrame({
        cmd: "ping",
        headers: { req_id: nextReqId() },
      }).catch((err) => {
        this.opts.error?.(`wecom aibot: ping failed: ${String(err)}`);
      });
    }, this.opts.heartbeatIntervalMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) {
      return;
    }
    if (this.reconnectAttempt >= this.opts.maxReconnectAttempts) {
      this.opts.error?.("wecom aibot: max reconnect attempts reached");
      return;
    }
    const delayMs = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.opts.log?.(`wecom aibot: reconnecting in ${delayMs}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delayMs);
  }
}

export function mapAibotTextToInbound(message: WecomAibotTextCallback): {
  msgType: "text";
  fromUserName: string;
  content: string;
  msgId?: string;
  aibotReqId: string;
} {
  return {
    msgType: "text",
    fromUserName: message.fromUserId,
    content: message.content,
    msgId: message.msgId,
    aibotReqId: message.reqId,
  };
}

export type WecomAibotProbeResult =
  | { ok: true; elapsedMs: number }
  | { ok: false; elapsedMs: number; error: string };

/**
 * One-shot connectivity probe for AIBot long connection:
 * open WSS → aibot_subscribe → wait for errcode=0 ack → close.
 */
export async function probeWecomAibotLongConnection(params: {
  botId: string;
  secret: string;
  wsUrl?: string;
  timeoutMs?: number;
}): Promise<WecomAibotProbeResult> {
  const startedAt = Date.now();
  const botId = params.botId.trim();
  const secret = params.secret.trim();
  if (!botId || !secret) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: "WeCom AIBot long connection requires botId and secret.",
    };
  }

  const wsUrl = params.wsUrl?.trim() || WECOM_AIBOT_DEFAULT_WS_URL;
  const timeoutMs = Math.max(1_000, params.timeoutMs ?? 8_000);
  const reqId = nextReqId();

  return await new Promise<WecomAibotProbeResult>((resolve) => {
    let settled = false;
    let socket: WebSocket | null = null;
    const finish = (result: WecomAibotProbeResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (socket) {
        try {
          socket.removeAllListeners();
          socket.close();
        } catch {
          // ignore
        }
        socket = null;
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        elapsedMs: Date.now() - startedAt,
        error: `WeCom AIBot subscribe timed out after ${timeoutMs}ms.`,
      });
    }, timeoutMs);

    try {
      socket = new WebSocket(wsUrl);
    } catch (error) {
      finish({
        ok: false,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    socket.on("open", () => {
      const frame = {
        cmd: "aibot_subscribe",
        headers: { req_id: reqId },
        body: { bot_id: botId, secret },
      };
      socket?.send(JSON.stringify(frame), (err) => {
        if (err) {
          finish({
            ok: false,
            elapsedMs: Date.now() - startedAt,
            error: `WeCom AIBot subscribe send failed: ${String(err)}`,
          });
        }
      });
    });

    socket.on("message", (data) => {
      let frame: WsFrame;
      try {
        frame = JSON.parse(String(data)) as WsFrame;
      } catch {
        return;
      }
      const frameReqId =
        typeof frame.headers?.req_id === "string" ? frame.headers.req_id.trim() : "";
      // Prefer matching our subscribe req_id; also accept bare subscribe acks.
      const isSubscribeAck =
        frameReqId === reqId ||
        (frameReqId === "" &&
          typeof frame.errcode === "number" &&
          frame.cmd !== "aibot_msg_callback");
      if (!isSubscribeAck && frameReqId !== reqId) {
        return;
      }
      const errcode = typeof frame.errcode === "number" ? frame.errcode : undefined;
      if (errcode === 0) {
        finish({ ok: true, elapsedMs: Date.now() - startedAt });
        return;
      }
      if (errcode != null) {
        finish({
          ok: false,
          elapsedMs: Date.now() - startedAt,
          error:
            `WeCom AIBot subscribe failed: ${String(errcode)} ${String(frame.errmsg ?? "unknown")}`.trim(),
        });
      }
    });

    socket.on("error", (err) => {
      finish({
        ok: false,
        elapsedMs: Date.now() - startedAt,
        error: `WeCom AIBot websocket error: ${String(err)}`,
      });
    });

    socket.on("close", () => {
      finish({
        ok: false,
        elapsedMs: Date.now() - startedAt,
        error: "WeCom AIBot websocket closed before subscribe ack.",
      });
    });
  });
}
