import { randomUUID } from "node:crypto";
import type { loadConfig } from "../config/config.js";
import { loadOpenBotPlugins } from "../plugins/loader.js";
import { getPluginRuntimeGatewayRequestScope } from "../plugins/runtime/gateway-request-scope.js";
import type { PluginRuntime } from "../plugins/runtime/types.js";
import { GATEWAY_CLIENT_IDS, GATEWAY_CLIENT_MODES } from "./protocol/client-info.js";
import type { ErrorShape } from "./protocol/index.js";
import { PROTOCOL_VERSION } from "./protocol/index.js";
import { handleGatewayRequest } from "./server-methods.js";
import type {
  GatewayRequestContext,
  GatewayRequestHandler,
  GatewayRequestOptions,
} from "./server-methods/types.js";

// ── Fallback gateway context for non-WS paths (Telegram, WhatsApp, etc.) ──
//
// The WS path sets a per-request scope via AsyncLocalStorage, but channel
// adapters (Telegram polling, etc.) invoke the agent directly without going
// through handleGatewayRequest. The gateway holds a per-startup holder and
// passes it to the plugin runtime so dispatchGatewayMethod can fall back to
// it when no AsyncLocalStorage scope is active.
//
// Previously this lived on `globalThis` via a Symbol.for() key. That made the
// holder a process-wide singleton, which (a) leaked across the gateway's
// lifecycle in tests and (b) made staleness on reload an open TODO. The
// holder is now a normal object owned by the server and threaded through
// `loadGatewayPlugins`, so subagent runtimes capture it lexically.

export type FallbackGatewayContextHolder = {
  /** Replace the fallback context. Called by the gateway when assembling. */
  set: (ctx: GatewayRequestContext) => void;
  /** Clear the fallback context (used when the gateway shuts down). */
  clear: () => void;
  /** Read the current fallback context. */
  get: () => GatewayRequestContext | undefined;
};

export function createFallbackGatewayContextHolder(): FallbackGatewayContextHolder {
  let context: GatewayRequestContext | undefined;
  return {
    set(ctx) {
      context = ctx;
    },
    clear() {
      context = undefined;
    },
    get() {
      return context;
    },
  };
}

// Module-local default holder. We keep it so that legacy callers of
// `setFallbackGatewayContext` keep working without changes, but new code
// should use the holder returned from `loadGatewayPlugins`.
const defaultFallbackGatewayContextHolder = createFallbackGatewayContextHolder();

/**
 * @deprecated Prefer the holder returned from `loadGatewayPlugins({ ... })`
 * and pass it explicitly. This module-level setter is kept so existing
 * callers keep working during the transition.
 */
export function setFallbackGatewayContext(ctx: GatewayRequestContext): void {
  defaultFallbackGatewayContextHolder.set(ctx);
}

// ── Internal gateway dispatch for plugin runtime ────────────────────

function createSyntheticOperatorClient(): GatewayRequestOptions["client"] {
  return {
    connect: {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: GATEWAY_CLIENT_IDS.GATEWAY_CLIENT,
        version: "internal",
        platform: "node",
        mode: GATEWAY_CLIENT_MODES.BACKEND,
      },
      role: "operator",
      scopes: ["operator.admin", "operator.approvals", "operator.pairing"],
    },
  };
}

async function dispatchGatewayMethod<T>(
  fallbackHolder: FallbackGatewayContextHolder,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const scope = getPluginRuntimeGatewayRequestScope();
  const context = scope?.context ?? fallbackHolder.get();
  const isWebchatConnect = scope?.isWebchatConnect ?? (() => false);
  if (!context) {
    throw new Error(
      `Plugin subagent dispatch requires a gateway request scope (method: ${method}). No scope set and no fallback context available.`,
    );
  }

  let result: { ok: boolean; payload?: unknown; error?: ErrorShape } | undefined;
  await handleGatewayRequest({
    req: {
      type: "req",
      id: `plugin-subagent-${randomUUID()}`,
      method,
      params,
    },
    client: createSyntheticOperatorClient(),
    isWebchatConnect,
    respond: (ok, payload, error) => {
      if (!result) {
        result = { ok, payload, error };
      }
    },
    context,
  });

  if (!result) {
    throw new Error(`Gateway method "${method}" completed without a response.`);
  }
  if (!result.ok) {
    throw new Error(result.error?.message ?? `Gateway method "${method}" failed.`);
  }
  return result.payload as T;
}

function createGatewaySubagentRuntime(
  fallbackHolder: FallbackGatewayContextHolder,
): PluginRuntime["subagent"] {
  const dispatch = <T>(method: string, params: Record<string, unknown>) =>
    dispatchGatewayMethod<T>(fallbackHolder, method, params);

  const getSessionMessages: PluginRuntime["subagent"]["getSessionMessages"] = async (params) => {
    const payload = await dispatch<{ messages?: unknown[] }>("sessions.get", {
      key: params.sessionKey,
      ...(params.limit != null && { limit: params.limit }),
    });
    return { messages: Array.isArray(payload?.messages) ? payload.messages : [] };
  };

  return {
    async run(params) {
      const payload = await dispatch<{ runId?: string }>("agent", {
        sessionKey: params.sessionKey,
        message: params.message,
        deliver: params.deliver ?? false,
        ...(params.extraSystemPrompt && { extraSystemPrompt: params.extraSystemPrompt }),
        ...(params.lane && { lane: params.lane }),
        ...(params.idempotencyKey && { idempotencyKey: params.idempotencyKey }),
      });
      const runId = payload?.runId;
      if (typeof runId !== "string" || !runId) {
        throw new Error("Gateway agent method returned an invalid runId.");
      }
      return { runId };
    },
    async waitForRun(params) {
      const payload = await dispatch<{ status?: string; error?: string }>("agent.wait", {
        runId: params.runId,
        ...(params.timeoutMs != null && { timeoutMs: params.timeoutMs }),
      });
      const status = payload?.status;
      if (status !== "ok" && status !== "error" && status !== "timeout") {
        throw new Error(`Gateway agent.wait returned unexpected status: ${status}`);
      }
      return {
        status,
        ...(typeof payload?.error === "string" && payload.error && { error: payload.error }),
      };
    },
    getSessionMessages,
    async getSession(params) {
      return getSessionMessages(params);
    },
    async deleteSession(params) {
      await dispatch("sessions.delete", {
        key: params.sessionKey,
        deleteTranscript: params.deleteTranscript ?? true,
      });
    },
  };
}

// ── Plugin loading ──────────────────────────────────────────────────

export type LoadGatewayPluginsParams = {
  cfg: ReturnType<typeof loadConfig>;
  workspaceDir: string;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
  coreGatewayHandlers: Record<string, GatewayRequestHandler>;
  baseMethods: string[];
  /**
   * Optional explicit holder for the fallback gateway context. When omitted,
   * the legacy module-level holder (also writable via the deprecated
   * `setFallbackGatewayContext`) is used so existing callers stay working.
   */
  fallbackContextHolder?: FallbackGatewayContextHolder;
};

export function loadGatewayPlugins(params: LoadGatewayPluginsParams) {
  const fallbackHolder = params.fallbackContextHolder ?? defaultFallbackGatewayContextHolder;
  const pluginRegistry = loadOpenBotPlugins({
    config: params.cfg,
    workspaceDir: params.workspaceDir,
    logger: {
      info: (msg) => params.log.info(msg),
      warn: (msg) => params.log.warn(msg),
      error: (msg) => params.log.error(msg),
      debug: (msg) => params.log.debug(msg),
    },
    coreGatewayHandlers: params.coreGatewayHandlers,
    runtimeOptions: {
      subagent: createGatewaySubagentRuntime(fallbackHolder),
    },
  });
  const pluginMethods = Object.keys(pluginRegistry.gatewayHandlers);
  const gatewayMethods = Array.from(new Set([...params.baseMethods, ...pluginMethods]));
  if (pluginRegistry.diagnostics.length > 0) {
    for (const diag of pluginRegistry.diagnostics) {
      const details = [
        diag.pluginId ? `plugin=${diag.pluginId}` : null,
        diag.source ? `source=${diag.source}` : null,
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join(", ");
      const message = details
        ? `[plugins] ${diag.message} (${details})`
        : `[plugins] ${diag.message}`;
      if (diag.level === "error") {
        params.log.error(message);
      } else {
        params.log.info(message);
      }
    }
  }
  return { pluginRegistry, gatewayMethods, fallbackContextHolder: fallbackHolder };
}
