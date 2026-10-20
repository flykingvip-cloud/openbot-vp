/**
 * Gateway-side inbound webhook bind rules for personal WeChat.
 *
 * Cloud / LIVE never binds a public webhook (sidecar POSTs to the Mac Node
 * loopback). Local-direct Gateway may bind 127.0.0.1 only — never 0.0.0.0 /
 * public — and only when no wechat-capable desktop node owns the port.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { handleWechatPersonalInboundEvent } from "./inbound.js";

export const WECHAT_MAC_INBOUND_DEFAULT_PORT = 18789;
export const WECHAT_MAC_INBOUND_DEFAULT_PATH = "/webhook/wechat";

const LOOPBACK_HOST = "127.0.0.1" as const;
const MAX_BODY_BYTES = 256 * 1024;

export function resolveWechatGatewayWebhookListen(opts: {
  allowLocalSidecar?: boolean;
  port?: number;
}): { host: "127.0.0.1"; port: number } | null {
  if (!opts.allowLocalSidecar) {
    return null;
  }
  const port =
    typeof opts.port === "number" && Number.isFinite(opts.port) && opts.port >= 0
      ? Math.trunc(opts.port)
      : WECHAT_MAC_INBOUND_DEFAULT_PORT;
  return { host: LOOPBACK_HOST, port };
}

export type WechatGatewayInboundServer = {
  host: "127.0.0.1";
  port: number;
  path: string;
  stop: () => Promise<void>;
};

function normalizePath(raw: string): string {
  const pathOnly = raw.split("?")[0] ?? "/";
  if (!pathOnly) {
    return "/";
  }
  return pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += buf.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("payload too large"), { code: "PAYLOAD_TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    Connection: "close",
  });
  res.end(payload);
}

/**
 * Loopback-only inbound listener. Host is always 127.0.0.1 — never 0.0.0.0.
 * POST body is dispatched through handleWechatPersonalInboundEvent.
 */
export function startWechatGatewayInboundWebhook(opts?: {
  port?: number;
  path?: string;
}): Promise<WechatGatewayInboundServer> {
  const listen = resolveWechatGatewayWebhookListen({
    allowLocalSidecar: true,
    port: opts?.port,
  });
  if (!listen) {
    return Promise.reject(new Error("wechat inbound: loopback listen is not allowed"));
  }
  const path = normalizePath(opts?.path?.trim() || WECHAT_MAC_INBOUND_DEFAULT_PATH);

  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const urlPath = normalizePath(req.url ?? "/");
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false });
        return;
      }
      if (urlPath !== path) {
        writeJson(res, 404, { ok: false });
        return;
      }
      void (async () => {
        try {
          const body = await readBody(req);
          await handleWechatPersonalInboundEvent({ payloadJSON: body });
          writeJson(res, 200, { ok: true });
        } catch (error) {
          const code =
            error && typeof error === "object" && "code" in error
              ? String((error as { code?: unknown }).code)
              : "";
          writeJson(res, code === "PAYLOAD_TOO_LARGE" ? 413 : 500, { ok: false });
        }
      })();
    });

    const onListenError = (error: Error) => {
      reject(error);
    };
    server.once("error", onListenError);
    // Bind 127.0.0.1 only. Omitting the host would listen on 0.0.0.0.
    server.listen(listen.port, LOOPBACK_HOST, () => {
      server.removeListener("error", onListenError);
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("wechat inbound: failed to resolve listen address"));
        return;
      }
      if (addr.address !== LOOPBACK_HOST) {
        server.close();
        reject(
          new Error(
            `wechat inbound: refused non-loopback bind (${addr.address}); host must be 127.0.0.1`,
          ),
        );
        return;
      }
      resolve({
        host: LOOPBACK_HOST,
        port: addr.port,
        path,
        stop: () =>
          new Promise<void>((stopResolve, stopReject) => {
            server.close((err) => {
              if (
                err &&
                typeof err === "object" &&
                "code" in err &&
                (err as { code?: string }).code !== "ERR_SERVER_NOT_RUNNING"
              ) {
                stopReject(err);
                return;
              }
              stopResolve();
            });
          }),
      });
    });
  });
}
