import { recordOrNull as asRecord } from "../records.js";
import { isLoopbackHttpUrl } from "./loopback.js";
import { formatWechatSidecarProbeError } from "./sidecar-spawn.js";
import { WECHAT_WORKER_OFFLINE_ERROR, type WechatPersonalWorker } from "./worker-contract.js";

export const WECHAT_SIDECAR_LOOPBACK_ERROR =
  "WeChat personal sidecar URL must be loopback (127.0.0.1, localhost, or ::1).";

const DEFAULT_LOGIN_TIMEOUT_MS = 120_000;
const LOGIN_POLL_INTERVAL_MS = 1_000;

export type LocalHttpWechatPersonalWorkerOpts = {
  proxyUrl: string;
  apiKey?: string;
  deviceType?: "ipad" | "mac";
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

type SidecarLoginStatus = {
  status?: string;
  qrCodeUrl?: string;
  wxid?: string;
  nickname?: string;
};

type SidecarLoginStart = {
  qrCodeUrl?: string;
  loginId?: string;
};

function joinUrl(base: string, path: string): string {
  const trimmed = base.endsWith("/") ? base.slice(0, -1) : base;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${trimmed}${suffix}`;
}

function stringField(record: Record<string, unknown> | null, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function authHeaders(apiKey: string | undefined, jsonBody: boolean): HeadersInit {
  const headers: Record<string, string> = {};
  if (jsonBody) {
    headers["Content-Type"] = "application/json";
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function isUnauthorizedStatus(status: number): boolean {
  return status === 401 || status === 403;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("WeChat personal sidecar returned invalid JSON.");
  }
}

async function toQrDataUrl(qrCodeUrl: string, fetchImpl: typeof fetch): Promise<string> {
  const trimmed = qrCodeUrl.trim();
  if (trimmed.startsWith("data:")) {
    return trimmed;
  }
  const response = await fetchImpl(trimmed);
  if (!response.ok) {
    throw new Error(`Failed to fetch WeChat QR image (HTTP ${response.status}).`);
  }
  const mimeRaw = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const mime =
    mimeRaw === "image/jpeg" || mimeRaw === "image/jpg"
      ? "image/jpeg"
      : mimeRaw && mimeRaw.startsWith("image/")
        ? mimeRaw
        : "image/png";
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

export function createLocalHttpWechatPersonalWorker(
  opts: LocalHttpWechatPersonalWorkerOpts,
): WechatPersonalWorker {
  if (!isLoopbackHttpUrl(opts.proxyUrl)) {
    throw new Error(WECHAT_SIDECAR_LOOPBACK_ERROR);
  }

  const proxyUrl = opts.proxyUrl;
  const apiKey = opts.apiKey;
  const deviceType = opts.deviceType ?? "ipad";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;

  const getLoginStatus = async (): Promise<{
    httpStatus: number;
    body: SidecarLoginStatus;
  }> => {
    const response = await fetchImpl(joinUrl(proxyUrl, "/api/loginStatus"), {
      method: "GET",
      headers: authHeaders(apiKey, false),
    });
    const raw = await readJson(response);
    const record = asRecord(raw);
    return {
      httpStatus: response.status,
      body: {
        status: stringField(record, "status"),
        qrCodeUrl: stringField(record, "qrCodeUrl"),
        wxid: stringField(record, "wxid"),
        nickname: stringField(record, "nickname"),
      },
    };
  };

  return {
    async probe() {
      // Prefer vNext GET /api/health; fall back to loginStatus on 404 / miss.
      try {
        const healthRes = await fetchImpl(joinUrl(proxyUrl, "/api/health"), {
          method: "GET",
          headers: authHeaders(apiKey, false),
        });
        if (healthRes.status >= 200 && healthRes.status < 300) {
          let warning: string | undefined;
          try {
            const raw = await readJson(healthRes);
            const record = asRecord(raw);
            if (record && record.sendReady === false) {
              // Soft warn only — do not mark offline solely for sendReady:false.
              warning = "WeChat sidecar sendReady:false (sidecar online; send may be deferred)";
            }
          } catch {
            // Health body parse miss still means reachable sidecar.
          }
          return warning ? { ok: true, online: true, warning } : { ok: true, online: true };
        }
        if (isUnauthorizedStatus(healthRes.status)) {
          return { ok: false, online: true, error: "unauthorized" };
        }
        // Non-404 hard errors still fall through to loginStatus for v1 sidecars
        // that lack /api/health (404) or odd statuses.
      } catch {
        // Network / fetch failure — try loginStatus before declaring offline.
      }

      try {
        const result = await getLoginStatus();
        if (result.httpStatus >= 200 && result.httpStatus < 300) {
          return { ok: true, online: true };
        }
        if (isUnauthorizedStatus(result.httpStatus)) {
          return { ok: false, online: true, error: "unauthorized" };
        }
        return {
          ok: false,
          online: true,
          error: `HTTP ${result.httpStatus}`,
        };
      } catch (error) {
        return {
          ok: false,
          online: false,
          error: formatWechatSidecarProbeError(error),
        };
      }
    },

    async loginStart() {
      const response = await fetchImpl(joinUrl(proxyUrl, "/api/login"), {
        method: "POST",
        headers: authHeaders(apiKey, true),
        body: JSON.stringify({ deviceType }),
      });
      if (isUnauthorizedStatus(response.status)) {
        throw new Error("unauthorized");
      }
      if (!response.ok) {
        throw new Error(`WeChat personal login start failed (HTTP ${response.status}).`);
      }
      const raw = await readJson(response);
      const record = asRecord(raw);
      const started: SidecarLoginStart = {
        qrCodeUrl: stringField(record, "qrCodeUrl"),
        loginId: stringField(record, "loginId"),
      };
      if (!started.qrCodeUrl) {
        throw new Error("WeChat personal sidecar did not return qrCodeUrl.");
      }
      const qrDataUrl = await toQrDataUrl(started.qrCodeUrl, fetchImpl);
      return {
        qrDataUrl,
        loginId: started.loginId ?? `qr-${Date.now()}`,
      };
    },

    async loginWait(params) {
      const timeoutMs = params.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
      const iterations = Math.max(1, Math.ceil(timeoutMs / LOGIN_POLL_INTERVAL_MS));
      for (let i = 0; i < iterations; i += 1) {
        try {
          const result = await getLoginStatus();
          if (isUnauthorizedStatus(result.httpStatus)) {
            return {
              connected: false,
              status: "error",
              message: "unauthorized",
            };
          }
          if (!result.httpStatus || result.httpStatus >= 500) {
            return {
              connected: false,
              status: "error",
              message: `HTTP ${result.httpStatus}`,
            };
          }
          if (result.body.status === "logged_in") {
            const wxid = result.body.wxid;
            return {
              connected: true,
              status: "logged_in",
              wxid,
              nickname: result.body.nickname,
              message: `Logged in as ${wxid || "unknown"}`,
            };
          }
        } catch (error) {
          return {
            connected: false,
            status: "error",
            message: error instanceof Error ? error.message : WECHAT_WORKER_OFFLINE_ERROR,
          };
        }
        if (i < iterations - 1) {
          await sleep(LOGIN_POLL_INTERVAL_MS);
        }
      }
      return {
        connected: false,
        status: "timeout",
        message: "WeChat personal QR login timed out.",
      };
    },

    async logout() {
      try {
        const response = await fetchImpl(joinUrl(proxyUrl, "/api/logout"), {
          method: "POST",
          headers: authHeaders(apiKey, true),
          body: JSON.stringify({}),
        });
        if (response.status === 404) {
          return { cleared: false };
        }
        if (isUnauthorizedStatus(response.status)) {
          return { cleared: false };
        }
        if (!response.ok) {
          return { cleared: false };
        }
        return { cleared: true };
      } catch {
        return { cleared: false };
      }
    },

    async status() {
      try {
        const result = await getLoginStatus();
        if (result.httpStatus < 200 || result.httpStatus >= 300) {
          return {
            online: result.httpStatus > 0,
            loggedIn: false,
          };
        }
        const loggedIn = result.body.status === "logged_in";
        return {
          online: true,
          loggedIn,
          wxid: loggedIn ? result.body.wxid : undefined,
          nickname: loggedIn ? result.body.nickname : undefined,
        };
      } catch {
        return { online: false, loggedIn: false };
      }
    },

    async sendText(params) {
      const response = await fetchImpl(joinUrl(proxyUrl, "/api/sendTextMsg"), {
        method: "POST",
        headers: authHeaders(apiKey, true),
        body: JSON.stringify({ to: params.to, content: params.text }),
      });
      const raw = await readJson(response);
      const record = asRecord(raw);
      const status = stringField(record, "status");
      const okField = record?.ok;
      const msgId = stringField(record, "msgId");
      const diagnostic = record?.diagnostic;
      const candidates = record?.candidates;
      const hint = stringField(record, "hint");

      if (response.status === 409 || status === "ambiguous") {
        const err = new Error(
          hint ? `Ambiguous WeChat recipient: ${hint}` : "Ambiguous WeChat recipient",
        ) as Error & { code?: string; candidates?: unknown };
        err.code = "AMBIGUOUS_RECIPIENT";
        err.candidates = candidates;
        throw err;
      }

      if (isUnauthorizedStatus(response.status)) {
        throw new Error("unauthorized");
      }

      // vNext structured failure may arrive on HTTP 200 with ok:false / status:failed.
      if (okField === false || status === "failed") {
        const detail =
          typeof diagnostic === "object" && diagnostic
            ? JSON.stringify(diagnostic)
            : stringField(record, "error") || status || "failed";
        throw new Error(`WeChat personal sendText failed: ${detail}`);
      }

      if (!response.ok) {
        throw new Error(`WeChat personal sendText failed (HTTP ${response.status}).`);
      }

      const messageId = msgId ?? `wechat-${Date.now()}`;
      // submitted_unconfirmed / status_unknown are success — caller may warn; do not blind-retry storm.
      if (status === "submitted_unconfirmed" || status === "status_unknown") {
        return {
          messageId,
          deliveryStatus: status,
        };
      }
      if (status === "delivered") {
        return { messageId, deliveryStatus: "delivered" };
      }
      // Legacy v1 body (msgId only) or unknown success status.
      return status ? { messageId, deliveryStatus: status } : { messageId };
    },
  };
}
