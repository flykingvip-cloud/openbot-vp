import type { ToolInvokeRequest, ToolInvokeResult, ToolInvoker } from "@openbot/aor-core";

export interface OpenBotToolsInvokeClientOptions {
  /** Gateway base URL, e.g. http://127.0.0.1:18789 */
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface ToolsInvokeResponseBody {
  ok?: boolean;
  result?: unknown;
  error?: { type?: string; message?: string };
}

/**
 * OpenBot public tool surface: `POST /tools/invoke` (core + plugin tools including Lobster).
 */
export class OpenBotToolsInvokeClient implements ToolInvoker {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OpenBotToolsInvokeClientOptions) {
    const baseUrl = options.baseUrl.replace(/\/$/, "");
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      throw new Error(
        `OpenBotToolsInvokeClient requires an HTTP(S) gateway URL for /tools/invoke, got: ${options.baseUrl}`,
      );
    }
    this.baseUrl = baseUrl;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async invoke(req: ToolInvokeRequest): Promise<ToolInvokeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }
      const res = await this.fetchImpl(`${this.baseUrl}/tools/invoke`, {
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
        return {
          ok: false,
          error: body.error?.message ?? `tools.invoke HTTP ${res.status}`,
        };
      }
      return { ok: true, result: body.result };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
