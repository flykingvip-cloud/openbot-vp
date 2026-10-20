import { recordOrNull as asRecord } from "../records.js";
import {
  WECHAT_WORKER_COMMANDS,
  WECHAT_WORKER_OFFLINE_ERROR,
  type WechatPersonalWorker,
  type WechatWorkerLoginStartResult,
  type WechatWorkerLoginWaitResult,
  type WechatWorkerProbeResult,
  type WechatWorkerStatusResult,
} from "./worker-contract.js";

const DEFAULT_LOGIN_WAIT_TIMEOUT_MS = 120_000;

export type NodeInvokeFn = (p: {
  nodeId: string;
  command: string;
  params?: unknown;
  timeoutMs?: number;
}) => Promise<{
  ok: boolean;
  payload?: unknown;
  payloadJSON?: string | null;
  error?: { code?: string; message?: string } | null;
}>;

export type NodeInvokeWechatPersonalWorkerOpts = {
  nodeId: string;
  invoke: NodeInvokeFn;
};

function parseInvokePayload(result: { payload?: unknown; payloadJSON?: string | null }): unknown {
  if (result.payload !== undefined && result.payload !== null) {
    return result.payload;
  }
  if (typeof result.payloadJSON === "string" && result.payloadJSON.trim()) {
    return JSON.parse(result.payloadJSON) as unknown;
  }
  return undefined;
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function boolField(record: Record<string, unknown> | null, key: string): boolean | undefined {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function invokeErrorMessage(result: {
  error?: { code?: string; message?: string } | null;
}): string {
  return result.error?.message ?? WECHAT_WORKER_OFFLINE_ERROR;
}

function parseProbe(payload: unknown): WechatWorkerProbeResult {
  const record = asRecord(payload);
  const error = stringField(record, "error");
  return {
    ok: boolField(record, "ok") ?? true,
    online: boolField(record, "online") ?? true,
    ...(error ? { error } : {}),
  };
}

function parseLoginStart(payload: unknown): WechatWorkerLoginStartResult {
  const record = asRecord(payload);
  const qrDataUrl = stringField(record, "qrDataUrl") ?? stringField(record, "qrCodeUrl");
  if (!qrDataUrl) {
    throw new Error("WeChat personal node did not return qrDataUrl.");
  }
  return {
    qrDataUrl,
    loginId: stringField(record, "loginId") ?? `qr-${Date.now()}`,
  };
}

function parseLoginWait(payload: unknown): WechatWorkerLoginWaitResult {
  const record = asRecord(payload);
  const statusRaw = stringField(record, "status");
  const status: WechatWorkerLoginWaitResult["status"] =
    statusRaw === "scanning" ||
    statusRaw === "confirming" ||
    statusRaw === "logged_in" ||
    statusRaw === "logged_out" ||
    statusRaw === "timeout" ||
    statusRaw === "error"
      ? statusRaw
      : "error";
  const connected = boolField(record, "connected") ?? status === "logged_in";
  return {
    connected,
    status,
    wxid: stringField(record, "wxid"),
    nickname: stringField(record, "nickname"),
    message:
      stringField(record, "message") ?? (connected ? "Logged in" : WECHAT_WORKER_OFFLINE_ERROR),
  };
}

function parseStatus(payload: unknown): WechatWorkerStatusResult {
  const record = asRecord(payload);
  const loggedIn = boolField(record, "loggedIn") ?? false;
  return {
    online: boolField(record, "online") ?? true,
    loggedIn,
    wxid: loggedIn ? stringField(record, "wxid") : undefined,
    nickname: loggedIn ? stringField(record, "nickname") : undefined,
  };
}

export function createNodeInvokeWechatPersonalWorker(
  opts: NodeInvokeWechatPersonalWorkerOpts,
): WechatPersonalWorker {
  const { nodeId, invoke } = opts;

  return {
    async probe() {
      try {
        const result = await invoke({ nodeId, command: WECHAT_WORKER_COMMANDS.probe });
        if (!result.ok) {
          return { ok: false, online: false, error: invokeErrorMessage(result) };
        }
        return parseProbe(parseInvokePayload(result));
      } catch (error) {
        return {
          ok: false,
          online: false,
          error: error instanceof Error ? error.message : WECHAT_WORKER_OFFLINE_ERROR,
        };
      }
    },

    async loginStart(params) {
      const result = await invoke({
        nodeId,
        command: WECHAT_WORKER_COMMANDS.loginStart,
        params,
        timeoutMs: params.timeoutMs,
      });
      if (!result.ok) {
        throw new Error(invokeErrorMessage(result));
      }
      return parseLoginStart(parseInvokePayload(result));
    },

    async loginWait(params) {
      const timeoutMs = params.timeoutMs ?? DEFAULT_LOGIN_WAIT_TIMEOUT_MS;
      try {
        const result = await invoke({
          nodeId,
          command: WECHAT_WORKER_COMMANDS.loginWait,
          params: { ...params, timeoutMs },
          timeoutMs,
        });
        if (!result.ok) {
          return {
            connected: false,
            status: "error",
            message: invokeErrorMessage(result),
          };
        }
        return parseLoginWait(parseInvokePayload(result));
      } catch (error) {
        return {
          connected: false,
          status: "error",
          message: error instanceof Error ? error.message : WECHAT_WORKER_OFFLINE_ERROR,
        };
      }
    },

    async logout(params) {
      try {
        const result = await invoke({
          nodeId,
          command: WECHAT_WORKER_COMMANDS.logout,
          params,
        });
        if (!result.ok) {
          return { cleared: false };
        }
        const record = asRecord(parseInvokePayload(result));
        return { cleared: boolField(record, "cleared") ?? true };
      } catch {
        return { cleared: false };
      }
    },

    async status(params) {
      try {
        const result = await invoke({
          nodeId,
          command: WECHAT_WORKER_COMMANDS.status,
          params,
        });
        if (!result.ok) {
          return { online: false, loggedIn: false };
        }
        return parseStatus(parseInvokePayload(result));
      } catch {
        return { online: false, loggedIn: false };
      }
    },

    async sendText(params) {
      const result = await invoke({
        nodeId,
        command: WECHAT_WORKER_COMMANDS.sendText,
        params,
      });
      if (!result.ok) {
        throw new Error(invokeErrorMessage(result));
      }
      const record = asRecord(parseInvokePayload(result));
      const messageId = stringField(record, "messageId") ?? stringField(record, "msgId");
      return { messageId: messageId ?? `wechat-node-${Date.now()}` };
    },
  };
}
