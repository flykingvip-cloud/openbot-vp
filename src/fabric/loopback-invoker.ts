/**
 * loopback-invoker.ts — a ToolInvoker that calls the gateway's own
 * `POST /tools/invoke` over loopback (Phase B 11.1b bootstrap).
 *
 * This reuses the existing, fully-tested tool execution path (the same surface
 * `/tools/invoke` exposes) rather than re-implementing tool dispatch in Fabric.
 * The gateway bootstrap constructs one of these (pointing at its own port) and
 * passes it to `createGatewayFabricService` so Fabric's executor runs real tools.
 *
 * Inline (no cross-package dependency on aor-backend-openbot) and kept tiny.
 */

import type { ToolInvokeRequest, ToolInvokeResult, ToolInvoker } from "@openbot/aor-core";

export interface LoopbackToolInvokerOptions {
  /** Gateway base URL, e.g. http://127.0.0.1:18789 */
  baseUrl: string;
  /** Gateway auth token when the gateway runs in token mode (omit for none). */
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface ToolsInvokeResponseBody {
  ok?: boolean;
  result?: unknown;
  error?: { type?: string; message?: string };
}

/** Build a ToolInvoker that forwards to the local gateway `/tools/invoke`. */
export function createLoopbackToolInvoker(opts: LoopbackToolInvokerOptions): ToolInvoker {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return {
    async invoke(req: ToolInvokeRequest): Promise<ToolInvokeResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (opts.token) {
          headers.authorization = `Bearer ${opts.token}`;
        }
        const res = await fetchImpl(`${baseUrl}/tools/invoke`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            tool: req.tool,
            args: req.args ?? {},
            action: req.action,
            sessionKey: req.sessionKey,
          }),
          signal: controller.signal,
        });
        const body = (await res.json()) as ToolsInvokeResponseBody;
        if (!res.ok || body.ok === false) {
          return { ok: false, error: body.error?.message ?? `tools.invoke HTTP ${res.status}` };
        }
        return { ok: true, result: body.result };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
