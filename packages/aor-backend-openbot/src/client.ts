import type { ModelRef, NormalizedUsage } from "@openbot/aor-core";

/**
 * Minimal client contract AOR needs from OpenBot. This is intentionally tiny
 * and transport-agnostic so the backend stays decoupled: implementations may
 * use the OpenAI-compatible HTTP endpoint, the Gateway WebSocket RPC, or a
 * stub in tests. None of them import OpenBot internals.
 */
export interface OpenBotChatRequest {
  model: ModelRef;
  prompt: string;
  sessionKey?: string;
  signal?: AbortSignal;
  /**
   * Ordered fallback models. Gateway-RPC client forwards these as `modelFallbacks`
   * on the public `agent` RPC (OpenBot native `runWithModelFallback`). The OpenAI-
   * compatible HTTP client ignores them (no fallback field on that endpoint).
   */
  fallbackModels?: ModelRef[];
}

export interface OpenBotChatResponse {
  text: string;
  usage: NormalizedUsage;
  raw?: unknown;
}

export interface OpenBotGatewayClient {
  chat(req: OpenBotChatRequest): Promise<OpenBotChatResponse>;
  /** Optional model discovery; backends fall back to a known list. */
  listModels?(): Promise<ModelRef[]>;
}

export interface OpenAiCompatClientOptions {
  /** Base URL of the OpenBot gateway, e.g. http://127.0.0.1:18789 */
  baseUrl: string;
  /** Bearer token for the gateway, if configured. */
  apiKey?: string;
  /** Override fetch (defaults to global fetch, Node 22+). */
  fetchImpl?: typeof fetch;
  /** Request timeout in ms (default 120000). */
  timeoutMs?: number;
}

interface OpenAiChoiceMessage {
  content?: unknown;
}
interface OpenAiChoice {
  message?: OpenAiChoiceMessage;
}
interface OpenAiUsage {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
}
interface OpenAiChatResponseBody {
  choices?: OpenAiChoice[];
  usage?: OpenAiUsage;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function modelString(ref: ModelRef): string {
  return `${ref.provider}/${ref.id}`;
}

/**
 * Default client: posts to OpenBot's public `/v1/chat/completions` endpoint
 * (enabled via `gateway.http.endpoints.chatCompletions`). This is the most
 * stable public contract, so it is the safest coupling surface for Stage 1.
 *
 * Note: OpenBot currently returns zeroed token usage on this path; the SDK
 * supplements cost via the Selector estimate, and Stage 2 wires `usage.cost`.
 */
export class OpenAiCompatGatewayClient implements OpenBotGatewayClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OpenAiCompatClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    const resolvedFetch = options.fetchImpl ?? globalThis.fetch;
    if (!resolvedFetch) {
      throw new Error("No fetch implementation available; pass fetchImpl explicitly");
    }
    this.fetchImpl = resolvedFetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async chat(req: OpenBotChatRequest): Promise<OpenBotChatResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onUpstreamAbort = () => controller.abort();
    req.signal?.addEventListener("abort", onUpstreamAbort);

    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.apiKey) {
        headers.authorization = `Bearer ${this.apiKey}`;
      }
      const response = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: modelString(req.model),
          stream: false,
          messages: [{ role: "user", content: req.prompt }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`OpenBot gateway returned ${response.status}: ${detail.slice(0, 500)}`);
      }

      const body = (await response.json()) as OpenAiChatResponseBody;
      const content = body.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content : "";
      const usage: NormalizedUsage = {
        inputTokens: asNumber(body.usage?.prompt_tokens),
        outputTokens: asNumber(body.usage?.completion_tokens),
        totalTokens: asNumber(body.usage?.total_tokens),
      };
      return { text, usage, raw: body };
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onUpstreamAbort);
    }
  }
}
