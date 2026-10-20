import { randomUUID } from "node:crypto";
import type { ModelRef, NormalizedUsage } from "@openbot/aor-core";
import type { OpenBotChatRequest, OpenBotChatResponse, OpenBotGatewayClient } from "./client.js";

/**
 * Injectable Gateway RPC transport. Production wiring passes a WebSocket client;
 * tests use {@link FakeGatewayRpcTransport} to prove call sequences without a live
 * gateway. AOR never imports OpenBot internals — only these public method names.
 */
export interface GatewayRpcTransport {
  call<T = unknown>(method: string, params: unknown): Promise<T>;
}

export interface GatewayRpcClientOptions {
  transport: GatewayRpcTransport;
  /** Default session key prefix for AOR runs. */
  sessionKeyPrefix?: string;
  agentTimeoutMs?: number;
}

function modelString(ref: ModelRef): string {
  return `${ref.provider}/${ref.id}`;
}

interface AgentAccepted {
  runId?: string;
  status?: string;
}
interface AgentWaitResult {
  status?: string;
  error?: string;
}
interface ChatHistoryResult {
  messages?: Array<{ role?: string; content?: unknown }>;
}

function extractAssistantText(history: ChatHistoryResult): string {
  const messages = history.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") {
      continue;
    }
    const content = msg.content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      const parts = content
        .map((block) => {
          if (block && typeof block === "object" && "text" in block) {
            const text = (block as { text?: unknown }).text;
            return typeof text === "string" ? text : "";
          }
          return "";
        })
        .filter(Boolean);
      if (parts.length > 0) {
        return parts.join("\n");
      }
    }
  }
  return "";
}

/**
 * Gateway-RPC OpenBot client.
 *
 * Public contract: `sessions.patch` (primary model) → `agent` (with optional
 * `modelFallbacks` for OpenBot native `runWithModelFallback`) → `agent.wait` →
 * `chat.history`. AOR does not loop models client-side on this path.
 */
export class OpenBotGatewayRpcClient implements OpenBotGatewayClient {
  private readonly transport: GatewayRpcTransport;
  private readonly sessionKeyPrefix: string;
  private readonly agentTimeoutMs: number;
  /** RPC methods invoked in order (tests). */
  readonly callLog: Array<{ method: string; params: unknown }> = [];

  constructor(options: GatewayRpcClientOptions) {
    this.transport = options.transport;
    this.sessionKeyPrefix = options.sessionKeyPrefix ?? "aor";
    this.agentTimeoutMs = options.agentTimeoutMs ?? 120_000;
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    this.callLog.push({ method, params });
    return this.transport.call<T>(method, params);
  }

  listModels(): Promise<ModelRef[]> {
    return Promise.resolve([]);
  }

  async chat(req: OpenBotChatRequest): Promise<OpenBotChatResponse> {
    const sessionKey = req.sessionKey ?? `${this.sessionKeyPrefix}:${randomUUID()}`;
    await this.rpc("sessions.patch", {
      key: sessionKey,
      model: modelString(req.model),
    });
    const idempotencyKey = randomUUID();
    const modelFallbacks = req.fallbackModels?.map(modelString);
    const accepted = await this.rpc<AgentAccepted>("agent", {
      message: req.prompt,
      sessionKey,
      idempotencyKey,
      ...(modelFallbacks && modelFallbacks.length > 0 ? { modelFallbacks } : {}),
    });
    const runId = accepted.runId ?? idempotencyKey;
    const wait = await this.rpc<AgentWaitResult>("agent.wait", {
      runId,
      timeoutMs: this.agentTimeoutMs,
    });
    if (wait.status === "error") {
      throw new Error(wait.error ?? "agent.wait returned error");
    }
    const history = await this.rpc<ChatHistoryResult>("chat.history", {
      sessionKey,
      limit: 30,
    });
    const text = extractAssistantText(history);
    if (!text.trim()) {
      throw new Error("empty assistant response");
    }
    const usage: NormalizedUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    return {
      text,
      usage,
      raw: { runId, model: req.model, modelFallbacks, waitStatus: wait.status ?? "ok", rpc: true },
    };
  }
}

/** Test double: scripted RPC responses keyed by method + optional matcher. */
export class FakeGatewayRpcTransport implements GatewayRpcTransport {
  readonly calls: Array<{ method: string; params: unknown }> = [];
  constructor(
    private readonly handlers: Record<
      string,
      (params: unknown, ctx: { callIndex: number }) => unknown | Promise<unknown>
    >,
  ) {}

  async call<T>(method: string, params: unknown): Promise<T> {
    this.calls.push({ method, params });
    const handler = this.handlers[method];
    if (!handler) {
      throw new Error(`FakeGatewayRpcTransport: no handler for ${method}`);
    }
    return (await handler(params, { callIndex: this.calls.length - 1 })) as T;
  }
}
