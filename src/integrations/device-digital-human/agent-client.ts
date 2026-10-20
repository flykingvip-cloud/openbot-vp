/**
 * Calls a local OpenBot gateway agent over the OpenAI-compatible chat completions route.
 * Live traffic stays on the operator machine. Tests pass a loopback mock.
 *
 *   POST {OPENBOT_DEVICE_DH_AGENT_BASE_URL}/v1/chat/completions
 *   Authorization: Bearer <gateway token>   (omitted when no token is configured)
 *   x-openclaw-agent-id          from the digital-human config record
 *   x-openclaw-session-key       device-dh:<digitalHumanId>:<conversationId>
 *   x-openclaw-message-channel: webchat
 *
 * OPENBOT_DEVICE_DH_AGENT_ID applies only when OPENBOT_DEVICE_DH_AGENT_DEBUG=1.
 * OPENBOT_DEVICE_DH_AGENT_SESSION_KEY applies only when
 * OPENBOT_DEVICE_DH_AGENT_SESSION_FORCE=1 (one shared UI session; grants merge).
 */
import {
  DeviceDhModelError,
  dropInventoryMutationClaims,
  type DeviceDhModelClient,
  type DeviceDhTrustedAgent,
} from "./model.js";

export const DEFAULT_DEVICE_DH_AGENT_BASE_URL = "http://127.0.0.1:18789";
export const DEVICE_DH_CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const DEFAULT_TIMEOUT_MS = 60_000;
const GATEWAY_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export type GatewayCancelTarget = {
  agentId: string;
  sessionKey: string;
};

export type GatewayAgentConfig = {
  baseUrl: string;
  token?: string;
  /**
   * Process-wide agent id. Honored only when OPENBOT_DEVICE_DH_AGENT_DEBUG=1.
   * Every grant then shares this agent.
   */
  debugAgentId?: string;
  /**
   * Fixed UI session. Honored only when forceSessionKey is set
   * (OPENBOT_DEVICE_DH_AGENT_SESSION_FORCE=1). Grants then share one gateway session.
   */
  sessionKey?: string;
  forceSessionKey?: boolean;
  /**
   * Also try Gateway WebSocket method `chat.abort` after the HTTP fetch is aborted.
   * Failures are ignored. There is no HTTP cancel on `/v1/chat/completions`.
   */
  attemptGatewayAbort?: boolean;
  onGatewayCancel?: (target: GatewayCancelTarget) => void | Promise<void>;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

type ChatMessage = {
  role: "system" | "user";
  content: string | Array<Record<string, unknown>>;
};

export function resolveGatewayAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
): GatewayAgentConfig {
  const raw = (
    env.OPENBOT_DEVICE_DH_AGENT_BASE_URL?.trim() || DEFAULT_DEVICE_DH_AGENT_BASE_URL
  ).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DeviceDhModelError("OPENBOT_DEVICE_DH_AGENT_BASE_URL is not a valid URL");
  }
  if (url.username || url.password) {
    throw new DeviceDhModelError("OPENBOT_DEVICE_DH_AGENT_BASE_URL must not include credentials");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DeviceDhModelError("OPENBOT_DEVICE_DH_AGENT_BASE_URL must be http or https");
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    throw new DeviceDhModelError(
      "OPENBOT_DEVICE_DH_AGENT_BASE_URL must be the gateway origin, not a path",
    );
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (env.OPENBOT_DEVICE_DH_AGENT_ALLOW_REMOTE !== "1" && !LOOPBACK_HOSTS.has(host)) {
    throw new DeviceDhModelError(
      "OPENBOT_DEVICE_DH_AGENT_BASE_URL must be loopback (127.0.0.1, localhost, or ::1)",
    );
  }
  const timeoutRaw = env.OPENBOT_DEVICE_DH_AGENT_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) {
    throw new DeviceDhModelError(
      "OPENBOT_DEVICE_DH_AGENT_TIMEOUT_MS must be an integer from 1 to 600000",
    );
  }
  const debugAgent = env.OPENBOT_DEVICE_DH_AGENT_DEBUG === "1";
  let debugAgentId: string | undefined;
  if (debugAgent) {
    const agentId = env.OPENBOT_DEVICE_DH_AGENT_ID?.trim() ?? "";
    if (!GATEWAY_AGENT_ID.test(agentId)) {
      throw new DeviceDhModelError(
        "OPENBOT_DEVICE_DH_AGENT_DEBUG requires a valid OPENBOT_DEVICE_DH_AGENT_ID",
      );
    }
    debugAgentId = agentId;
  }
  const forceSessionKey = env.OPENBOT_DEVICE_DH_AGENT_SESSION_FORCE === "1";
  let sessionKey: string | undefined;
  if (forceSessionKey) {
    const pinned = env.OPENBOT_DEVICE_DH_AGENT_SESSION_KEY?.trim() ?? "";
    if (!pinned || !isSafeSessionKey(pinned)) {
      throw new DeviceDhModelError(
        "OPENBOT_DEVICE_DH_AGENT_SESSION_FORCE requires a valid OPENBOT_DEVICE_DH_AGENT_SESSION_KEY",
      );
    }
    sessionKey = pinned;
  }
  const token =
    env.OPENBOT_DEVICE_DH_AGENT_TOKEN?.trim() ||
    env.OPENBOT_GATEWAY_TOKEN?.trim() ||
    env.OPENCLAW_GATEWAY_TOKEN?.trim() ||
    undefined;
  return {
    baseUrl: url.origin,
    token: token || undefined,
    debugAgentId,
    sessionKey,
    forceSessionKey,
    timeoutMs,
  };
}

/**
 * Product target is the digital-human config record. A missing mapping fails
 * the call. There is no fallback to agent `main`.
 * OPENBOT_DEVICE_DH_AGENT_ID is a debug override and skips the allowlist.
 */
export function resolveTrustedGatewayAgent(
  trusted: DeviceDhTrustedAgent | undefined,
  debugAgentId?: string,
): string {
  if (!trusted || trusted.humanDigitalHumanId !== trusted.grantDigitalHumanId) {
    throw new DeviceDhModelError("Grant digital human is not allowed to use a gateway agent");
  }
  if (debugAgentId) {
    return assertGatewayAgentId(debugAgentId);
  }
  const mapped = trusted.gatewayAgentId?.trim() ?? "";
  if (!mapped) {
    throw new DeviceDhModelError("Digital human has no gateway agent mapping");
  }
  const agentId = assertGatewayAgentId(mapped);
  const allowed = trusted.allowedGatewayAgentIds ?? [agentId];
  if (!allowed.includes(agentId)) {
    throw new DeviceDhModelError("Digital human is not allowed to use this gateway agent");
  }
  return agentId;
}

export function deviceDhSessionKey(
  config: Pick<GatewayAgentConfig, "sessionKey" | "forceSessionKey">,
  digitalHumanId: string,
  conversationId: string,
): string {
  if (config.forceSessionKey) {
    const pinned = config.sessionKey;
    if (!pinned || !isSafeSessionKey(pinned)) {
      throw new DeviceDhModelError(
        "OPENBOT_DEVICE_DH_AGENT_SESSION_FORCE requires OPENBOT_DEVICE_DH_AGENT_SESSION_KEY",
      );
    }
    return pinned;
  }
  const derived = `device-dh:${digitalHumanId}:${conversationId}`;
  if (!isSafeSessionKey(derived)) {
    throw new DeviceDhModelError("OpenBot agent session key is invalid");
  }
  return derived;
}

export function createGatewayAgentModelClient(config: GatewayAgentConfig): DeviceDhModelClient {
  const target = `${config.baseUrl}${DEVICE_DH_CHAT_COMPLETIONS_PATH}`;
  return {
    mode: "agent",
    target,
    completeTurn(ctx) {
      return completeSafe(config, {
        messages: [
          { role: "system", content: systemPrompt(ctx) },
          { role: "user", content: ctx.text },
        ],
        agentId: resolveTrustedGatewayAgent(ctx.trustedAgent, config.debugAgentId),
        sessionKey: deviceDhSessionKey(config, ctx.digitalHumanId, ctx.conversationId),
        signal: ctx.signal,
        onDelta: ctx.onDelta,
      });
    },
    describeImage(ctx) {
      const mime = ctx.contentType === "image/jpeg" ? "image/jpeg" : "image/png";
      if (ctx.contentType !== "image/jpeg" && ctx.contentType !== "image/png") {
        return Promise.reject(new DeviceDhModelError("Only JPEG and PNG images can be described"));
      }
      return completeSafe(config, {
        messages: [
          { role: "system", content: systemPrompt(ctx) },
          {
            role: "user",
            content: [
              { type: "text", text: visionPrompt(ctx.userText) },
              {
                type: "image_url",
                image_url: { url: `data:${mime};base64,${ctx.bytes.toString("base64")}` },
              },
            ],
          },
        ],
        agentId: resolveTrustedGatewayAgent(ctx.trustedAgent, config.debugAgentId),
        sessionKey: deviceDhSessionKey(config, ctx.digitalHumanId, ctx.conversationId),
        signal: ctx.signal,
        onDelta: ctx.onDelta,
      });
    },
  };
}

function systemPrompt(ctx: {
  displayName: string;
  digitalHumanId: string;
  locale?: string;
}): string {
  const locale = ctx.locale ? `Reply in ${ctx.locale}.` : "Reply in the user's language.";
  return [
    `You are ${ctx.displayName}, the OpenBot device digital human ${ctx.digitalHumanId}.`,
    locale,
    "Reply with one short sentence that can be spoken aloud.",
    "Do not say that inventory was updated, written, or deleted. This integration does not apply inventory changes.",
  ].join(" ");
}

function visionPrompt(userText: string): string {
  const lines = [
    "Describe this camera frame in one short speakable sentence.",
    "Only describe what is visible.",
    "Do not say that inventory was updated or modified.",
  ];
  if (userText.trim()) {
    lines.push(`The user said: ${userText.trim()}`);
  }
  return lines.join(" ");
}

async function completeSafe(
  config: GatewayAgentConfig,
  input: {
    messages: ChatMessage[];
    agentId: string;
    sessionKey: string;
    signal?: AbortSignal;
    onDelta: (delta: string) => void;
  },
): Promise<string> {
  // Accumulate gateway SSE first so an inventory-update claim never becomes a device event.
  const raw = await postChat(config, { ...input, onDelta: () => {} });
  if (input.signal?.aborted) {
    throw new DeviceDhModelError("OpenBot agent request was cancelled");
  }
  const visible = dropInventoryMutationClaims(raw);
  if (!visible) {
    throw new DeviceDhModelError(
      "OpenBot agent reply claimed an inventory change and had no speakable description",
    );
  }
  input.onDelta(visible);
  return visible;
}

async function postChat(
  config: GatewayAgentConfig,
  input: {
    messages: ChatMessage[];
    agentId: string;
    sessionKey: string;
    signal?: AbortSignal;
    onDelta: (delta: string) => void;
  },
): Promise<string> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-openclaw-agent-id": input.agentId,
    "x-openclaw-session-key": input.sessionKey,
    "x-openclaw-message-channel": "webchat",
  };
  if (config.token) {
    headers.authorization = `Bearer ${config.token}`;
  }
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  let cancelNotified = false;
  const notifyCancel = () => {
    if (cancelNotified || !input.signal?.aborted) {
      return;
    }
    cancelNotified = true;
    void bestEffortGatewayChatAbort(config, {
      agentId: input.agentId,
      sessionKey: input.sessionKey,
    });
  };
  input.signal?.addEventListener("abort", notifyCancel, { once: true });
  try {
    const response = await fetchImpl(`${config.baseUrl}${DEVICE_DH_CHAT_COMPLETIONS_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: `openclaw:${input.agentId}`,
        stream: true,
        user: input.sessionKey,
        messages: input.messages,
      }),
      signal,
    });
    if (!response.ok) {
      throw new DeviceDhModelError(httpFailureMessage(response.status));
    }
    const type = response.headers.get("content-type") ?? "";
    const text =
      type.includes("text/event-stream") && response.body
        ? await readSse(response.body, input.onDelta)
        : await readJsonCompletion(response, input.onDelta);
    if (!text.trim()) {
      throw new DeviceDhModelError("OpenBot agent returned an empty reply");
    }
    return text.trim();
  } catch (error) {
    if (error instanceof DeviceDhModelError) {
      throw error;
    }
    notifyCancel();
    if (input.signal?.aborted) {
      throw new DeviceDhModelError("OpenBot agent request was cancelled");
    }
    if (isAbort(error)) {
      throw new DeviceDhModelError("OpenBot agent request timed out");
    }
    throw new DeviceDhModelError("OpenBot agent request failed");
  } finally {
    input.signal?.removeEventListener("abort", notifyCancel);
  }
}

/**
 * Aborting the chat-completions fetch stops this stub from reading more tokens.
 * It does not roll back tools the agent already started: the gateway handler
 * only unsubscribes its SSE writer on `req.close` and does not call `chat.abort`.
 * `chat.abort` is a gateway WebSocket method. This attempts it when
 * `attemptGatewayAbort` is set and ignores failures.
 */
export async function bestEffortGatewayChatAbort(
  config: GatewayAgentConfig,
  target: GatewayCancelTarget,
): Promise<void> {
  try {
    await config.onGatewayCancel?.(target);
  } catch {
    // The stub cancel result does not depend on the notifier.
  }
  if (!config.attemptGatewayAbort) {
    return;
  }
  try {
    const imported = (await import("../../gateway/call.js")) as {
      callGateway?: (opts: {
        url?: string;
        token?: string;
        method: string;
        params?: unknown;
        timeoutMs?: number;
      }) => Promise<unknown>;
    };
    if (!imported.callGateway) {
      return;
    }
    await imported.callGateway({
      url: toWebSocketOrigin(config.baseUrl),
      token: config.token,
      method: "chat.abort",
      params: { sessionKey: target.sessionKey },
      timeoutMs: 1_500,
    });
  } catch {
    // HTTP abort already happened. A missed chat.abort leaves gateway tools running.
  }
}

function httpFailureMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "OpenBot gateway rejected the agent credential";
  }
  if (status === 404) {
    return "OpenBot gateway chat completions endpoint is unavailable";
  }
  return `OpenBot agent request failed (HTTP ${status})`;
}

async function readJsonCompletion(
  response: Response,
  onDelta: (delta: string) => void,
): Promise<string> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new DeviceDhModelError("OpenBot agent returned an unreadable reply");
  }
  const text = completionText(parsed);
  if (text) {
    onDelta(text);
  }
  return text;
}

async function readSse(
  body: ReadableStream<Uint8Array>,
  onDelta: (delta: string) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const consume = (block: string): "done" | "chunk" => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) {
      return "chunk";
    }
    if (data === "[DONE]") {
      return "done";
    }
    try {
      const delta = completionDelta(JSON.parse(data) as unknown);
      if (delta) {
        text += delta;
        onDelta(delta);
      }
    } catch {
      // Ignore a malformed SSE event and keep reading.
    }
    return "chunk";
  };
  let finished = false;
  while (!finished) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    buffer += decoder.decode(next.value, { stream: true });
    let boundary = findEventBoundary(buffer);
    while (boundary) {
      const block = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.next);
      if (consume(block) === "done") {
        finished = true;
        break;
      }
      boundary = findEventBoundary(buffer);
    }
  }
  if (!finished && buffer.trim()) {
    consume(buffer);
  }
  return text;
}

function findEventBoundary(buffer: string): { index: number; next: number } | undefined {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf < 0 && crlf < 0) {
    return undefined;
  }
  if (crlf >= 0 && (lf < 0 || crlf < lf)) {
    return { index: crlf, next: crlf + 4 };
  }
  return { index: lf, next: lf + 2 };
}

function completionText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") {
    return "";
  }
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") {
    return completionDelta(payload);
  }
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

function completionDelta(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") {
    return "";
  }
  const delta = (choices[0] as { delta?: unknown }).delta;
  if (!delta || typeof delta !== "object") {
    return "";
  }
  const content = (delta as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

function assertGatewayAgentId(agentId: string): string {
  if (!GATEWAY_AGENT_ID.test(agentId)) {
    throw new DeviceDhModelError("Gateway agent id is invalid");
  }
  return agentId;
}

function toWebSocketOrigin(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.origin;
}

function isSafeSessionKey(value: string): boolean {
  return value.length > 0 && value.length <= 256 && !/[\r\n]/.test(value);
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: string }).name === "AbortError"
  );
}
