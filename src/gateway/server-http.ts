import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { TlsOptions } from "node:tls";
import type { WebSocketServer } from "ws";
import { resolveAgentAvatar } from "../agents/identity-avatar.js";
import { consumeNoVncObserverToken } from "../agents/sandbox/novnc-auth.js";
import { handleNoVncObserverHttp } from "../browser/novnc-observer-http.js";
import { handleNoVncObserverUpgrade } from "../browser/novnc-relay.js";
import { handleA2uiHttpRequest, isCanvasWsPath } from "../canvas-host/a2ui.js";
import type { CanvasHostHandler } from "../canvas-host/server.js";
import { LEGACY_HOOK_TOKEN_HEADER_DISPLAY_NAMES } from "../compat/legacy-names.js";
import { loadConfig } from "../config/config.js";
import { handleClaw4FirmwareHttpRequest } from "../integrations/device-digital-human/claw4-firmware-http.js";
import { handleIntegrationsGrantHttpRequest } from "../integrations/device-digital-human/integrations-grant-http.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import { safeEqualSecret } from "../security/secret-equal.js";
import { handleSlackHttpRequest } from "../slack/http/index.js";
import { handleVaultSyncHttpRequest } from "../vault-sync/http-upload-handler.js";
import {
  AUTH_RATE_LIMIT_SCOPE_HOOK_AUTH,
  createAuthRateLimiter,
  normalizeRateLimitClientIp,
  type AuthRateLimiter,
} from "./auth-rate-limit.js";
import {
  authorizeHttpGatewayConnect,
  isLocalDirectRequest,
  type GatewayAuthResult,
  type ResolvedGatewayAuth,
} from "./auth.js";
import { normalizeCanvasScopedUrl } from "./canvas-capability.js";
import { handleCommercePaymentsHttpRequest } from "./commerce-payments-http.js";
import {
  handleControlUiAvatarRequest,
  handleControlUiHttpRequest,
  type ControlUiRootState,
} from "./control-ui.js";
import { handleDevicePlatformHttpRequest } from "./device-platform-http.js";
import { handleExecProtocolHttpRequest } from "./exec-protocol-http.js";
import { handleFabricV1HttpRequest } from "./fabric-v1-http.js";
import {
  parseHookJsonPayload,
  readRawHookBody,
  resolveHookMappingAuth,
  verifyHookMappingHmac,
  verifyHookMappingToken,
} from "./hooks-auth.js";
import { applyHookMappings } from "./hooks-mapping.js";
import {
  extractHookToken,
  getHookAgentPolicyError,
  getHookChannelError,
  type HookAgentDispatchPayload,
  type HooksConfigResolved,
  isHookAgentAllowed,
  normalizeAgentPayload,
  normalizeHookHeaders,
  normalizeWakePayload,
  readJsonBody,
  normalizeHookDispatchSessionKey,
  resolveHookSessionKey,
  resolveHookTargetAgentId,
  resolveHookChannel,
  resolveHookDeliver,
} from "./hooks.js";
import { sendGatewayAuthFailure, setDefaultSecurityHeaders } from "./http-common.js";
import { getBearerToken } from "./http-utils.js";
import { createNativeBootstrapHttpHandler } from "./native-bootstrap-http.js";
import { handleOpenAiHttpRequest } from "./openai-http.js";
import { handleOpenResponsesHttpRequest } from "./openresponses-http.js";
import {
  authorizeCanvasRequest,
  enforcePluginRouteGatewayAuth,
  isCanvasPath,
} from "./server/http-auth.js";
import {
  isProtectedPluginRoutePathFromContext,
  resolvePluginRoutePathContext,
  type PluginHttpRequestHandler,
  type PluginRoutePathContext,
} from "./server/plugins-http.js";
import type { ReadinessChecker } from "./server/readiness.js";
import type { GatewayWsClient } from "./server/ws-types.js";
import { handleToolsInvokeHttpRequest } from "./tools-invoke-http.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

const HOOK_AUTH_FAILURE_LIMIT = 20;
const HOOK_AUTH_FAILURE_WINDOW_MS = 60_000;

type HookDispatchers = {
  dispatchWakeHook: (value: { text: string; mode: "now" | "next-heartbeat" }) => void;
  dispatchAgentHook: (value: HookAgentDispatchPayload) => string;
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

const GATEWAY_PROBE_STATUS_BY_PATH = new Map<string, "live" | "ready">([
  ["/health", "live"],
  ["/healthz", "live"],
  ["/ready", "ready"],
  ["/readyz", "ready"],
]);
const MATTERMOST_SLASH_CALLBACK_PATH = "/api/channels/mattermost/command";

function resolveMattermostSlashCallbackPaths(
  configSnapshot: ReturnType<typeof loadConfig>,
): Set<string> {
  const callbackPaths = new Set<string>([MATTERMOST_SLASH_CALLBACK_PATH]);
  const isMattermostCommandCallbackPath = (path: string): boolean =>
    path === MATTERMOST_SLASH_CALLBACK_PATH || path.startsWith("/api/channels/mattermost/");

  const normalizeCallbackPath = (value: unknown): string => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (!trimmed) {
      return MATTERMOST_SLASH_CALLBACK_PATH;
    }
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  };

  const tryAddCallbackUrlPath = (rawUrl: unknown) => {
    if (typeof rawUrl !== "string") {
      return;
    }
    const trimmed = rawUrl.trim();
    if (!trimmed) {
      return;
    }
    try {
      const pathname = new URL(trimmed).pathname;
      if (pathname && isMattermostCommandCallbackPath(pathname)) {
        callbackPaths.add(pathname);
      }
    } catch {
      // Ignore invalid callback URLs in config and keep default path behavior.
    }
  };

  const mmRaw = configSnapshot.channels?.mattermost as Record<string, unknown> | undefined;
  const addMmCommands = (raw: unknown) => {
    if (raw == null || typeof raw !== "object") {
      return;
    }
    const commands = raw as Record<string, unknown>;
    const callbackPath = normalizeCallbackPath(commands.callbackPath);
    if (isMattermostCommandCallbackPath(callbackPath)) {
      callbackPaths.add(callbackPath);
    }
    tryAddCallbackUrlPath(commands.callbackUrl);
  };

  addMmCommands(mmRaw?.commands);
  const accountsRaw = (mmRaw?.accounts ?? {}) as Record<string, unknown>;
  for (const accountId of Object.keys(accountsRaw)) {
    const accountCfg = accountsRaw[accountId] as Record<string, unknown> | undefined;
    addMmCommands(accountCfg?.commands);
  }

  return callbackPaths;
}

function shouldEnforceDefaultPluginGatewayAuth(pathContext: PluginRoutePathContext): boolean {
  return (
    pathContext.malformedEncoding ||
    pathContext.decodePassLimitReached ||
    isProtectedPluginRoutePathFromContext(pathContext)
  );
}

async function canRevealReadinessDetails(params: {
  req: IncomingMessage;
  resolvedAuth: ResolvedGatewayAuth;
  trustedProxies: string[];
  allowRealIpFallback: boolean;
}): Promise<boolean> {
  if (isLocalDirectRequest(params.req, params.trustedProxies, params.allowRealIpFallback)) {
    return true;
  }
  if (params.resolvedAuth.mode === "none") {
    return false;
  }

  const bearerToken = getBearerToken(params.req);
  const authResult = await authorizeHttpGatewayConnect({
    auth: params.resolvedAuth,
    connectAuth: bearerToken ? { token: bearerToken, password: bearerToken } : null,
    req: params.req,
    trustedProxies: params.trustedProxies,
    allowRealIpFallback: params.allowRealIpFallback,
  });
  return authResult.ok;
}

async function handleGatewayProbeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  requestPath: string,
  resolvedAuth: ResolvedGatewayAuth,
  trustedProxies: string[],
  allowRealIpFallback: boolean,
  getReadiness?: ReadinessChecker,
): Promise<boolean> {
  const status = GATEWAY_PROBE_STATUS_BY_PATH.get(requestPath);
  if (!status) {
    return false;
  }

  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method Not Allowed");
    return true;
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  let statusCode: number;
  let body: string;
  if (status === "ready" && getReadiness) {
    const includeDetails = await canRevealReadinessDetails({
      req,
      resolvedAuth,
      trustedProxies,
      allowRealIpFallback,
    });
    try {
      const result = getReadiness();
      statusCode = result.ready ? 200 : 503;
      body = JSON.stringify(includeDetails ? result : { ready: result.ready });
    } catch {
      statusCode = 503;
      body = JSON.stringify(
        includeDetails ? { ready: false, failing: ["internal"], uptimeMs: 0 } : { ready: false },
      );
    }
  } else {
    statusCode = 200;
    body = JSON.stringify({ ok: true, status });
  }
  res.statusCode = statusCode;
  res.end(method === "HEAD" ? undefined : body);
  return true;
}

function writeUpgradeAuthFailure(
  socket: { write: (chunk: string) => void },
  auth: GatewayAuthResult,
) {
  if (auth.rateLimited) {
    const retryAfterSeconds =
      auth.retryAfterMs && auth.retryAfterMs > 0 ? Math.ceil(auth.retryAfterMs / 1000) : undefined;
    socket.write(
      [
        "HTTP/1.1 429 Too Many Requests",
        retryAfterSeconds ? `Retry-After: ${retryAfterSeconds}` : undefined,
        "Content-Type: application/json; charset=utf-8",
        "Connection: close",
        "",
        JSON.stringify({
          error: {
            message: "Too many failed authentication attempts. Please try again later.",
            type: "rate_limited",
          },
        }),
      ]
        .filter(Boolean)
        .join("\r\n"),
    );
    return;
  }
  socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
}

export type HooksRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

type GatewayHttpRequestStage = {
  name: string;
  run: () => Promise<boolean> | boolean;
};

async function runGatewayHttpRequestStages(
  stages: readonly GatewayHttpRequestStage[],
): Promise<boolean> {
  for (const stage of stages) {
    if (await stage.run()) {
      return true;
    }
  }
  return false;
}

function buildPluginRequestStages(params: {
  req: IncomingMessage;
  res: ServerResponse;
  requestPath: string;
  mattermostSlashCallbackPaths: ReadonlySet<string>;
  pluginPathContext: PluginRoutePathContext | null;
  handlePluginRequest?: PluginHttpRequestHandler;
  shouldEnforcePluginGatewayAuth?: (pathContext: PluginRoutePathContext) => boolean;
  resolvedAuth: ResolvedGatewayAuth;
  trustedProxies: string[];
  allowRealIpFallback: boolean;
  rateLimiter?: AuthRateLimiter;
}): GatewayHttpRequestStage[] {
  if (!params.handlePluginRequest) {
    return [];
  }
  let pluginGatewayAuthSatisfied = false;
  return [
    {
      name: "plugin-auth",
      run: async () => {
        if (params.mattermostSlashCallbackPaths.has(params.requestPath)) {
          return false;
        }
        const pathContext =
          params.pluginPathContext ?? resolvePluginRoutePathContext(params.requestPath);
        if (
          !(params.shouldEnforcePluginGatewayAuth ?? shouldEnforceDefaultPluginGatewayAuth)(
            pathContext,
          )
        ) {
          return false;
        }
        const pluginAuthOk = await enforcePluginRouteGatewayAuth({
          req: params.req,
          res: params.res,
          auth: params.resolvedAuth,
          trustedProxies: params.trustedProxies,
          allowRealIpFallback: params.allowRealIpFallback,
          rateLimiter: params.rateLimiter,
        });
        if (!pluginAuthOk) {
          return true;
        }
        pluginGatewayAuthSatisfied = true;
        return false;
      },
    },
    {
      name: "plugin-http",
      run: () => {
        const pathContext =
          params.pluginPathContext ?? resolvePluginRoutePathContext(params.requestPath);
        return (
          params.handlePluginRequest?.(params.req, params.res, pathContext, {
            gatewayAuthSatisfied: pluginGatewayAuthSatisfied,
          }) ?? false
        );
      },
    },
  ];
}

export function createHooksRequestHandler(
  opts: {
    getHooksConfig: () => HooksConfigResolved | null;
    bindHost: string;
    port: number;
    logHooks: SubsystemLogger;
  } & HookDispatchers,
): HooksRequestHandler {
  const { getHooksConfig, logHooks, dispatchAgentHook, dispatchWakeHook } = opts;
  const hookAuthLimiter = createAuthRateLimiter({
    maxAttempts: HOOK_AUTH_FAILURE_LIMIT,
    windowMs: HOOK_AUTH_FAILURE_WINDOW_MS,
    lockoutMs: HOOK_AUTH_FAILURE_WINDOW_MS,
    exemptLoopback: false,
    // Handler lifetimes are tied to gateway runtime/tests; skip background timer fanout.
    pruneIntervalMs: 0,
  });

  const resolveHookClientKey = (req: IncomingMessage): string => {
    return normalizeRateLimitClientIp(req.socket?.remoteAddress);
  };

  return async (req, res) => {
    const hooksConfig = getHooksConfig();
    if (!hooksConfig) {
      return false;
    }
    // Only pathname/search are used here; keep the base host fixed so bind-host
    // representation (e.g. IPv6 wildcards) cannot break request parsing.
    const url = new URL(req.url ?? "/", "http://localhost");
    const basePath = hooksConfig.basePath;
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
      return false;
    }

    if (url.searchParams.has("token")) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(
        `Hook token must be provided via Authorization: Bearer <token> or X-OpenBot-Token header (legacy: ${LEGACY_HOOK_TOKEN_HEADER_DISPLAY_NAMES.join(", ")}) (query parameters are not allowed).`,
      );
      return true;
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return true;
    }

    const clientKey = resolveHookClientKey(req);
    const rejectUnauthorized = (logDetail?: string): boolean => {
      const throttle = hookAuthLimiter.check(clientKey, AUTH_RATE_LIMIT_SCOPE_HOOK_AUTH);
      if (!throttle.allowed) {
        const retryAfter = throttle.retryAfterMs > 0 ? Math.ceil(throttle.retryAfterMs / 1000) : 1;
        res.statusCode = 429;
        res.setHeader("Retry-After", String(retryAfter));
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Too Many Requests");
        logHooks.warn(`hook auth throttled for ${clientKey}; retry-after=${retryAfter}s`);
        return true;
      }
      hookAuthLimiter.recordFailure(clientKey, AUTH_RATE_LIMIT_SCOPE_HOOK_AUTH);
      if (logDetail) {
        logHooks.warn(logDetail);
      }
      res.statusCode = 401;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Unauthorized");
      return true;
    };

    // Mapping-level credentials are keyed by match.path (validated at config
    // time), so they can be resolved from the URL before any body read.
    const subPathRaw = url.pathname.slice(basePath.length).replace(/^\/+/, "");
    const mappingAuth = subPathRaw
      ? resolveHookMappingAuth(hooksConfig.mappings, subPathRaw)
      : null;

    let rawBodyForMapping: string | null = null;
    if (mappingAuth) {
      // Strict override: the mapping's own credentials replace the global
      // hooks.token for this path. Token phase is header-only, so
      // unauthenticated senders never trigger a body read.
      const tokenCheck = verifyHookMappingToken(mappingAuth, req);
      if (!tokenCheck.ok) {
        return rejectUnauthorized(
          `hook mapping auth failed (${mappingAuth.mappingId}): ${tokenCheck.error}`,
        );
      }
      const rawBody = await readRawHookBody(req, hooksConfig.maxBodyBytes);
      if (!rawBody.ok) {
        const status =
          rawBody.error === "payload too large"
            ? 413
            : rawBody.error === "request body timeout"
              ? 408
              : 400;
        sendJson(res, status, { ok: false, error: rawBody.error });
        return true;
      }
      const hmacCheck = verifyHookMappingHmac(mappingAuth, req, rawBody.raw);
      if (!hmacCheck.ok) {
        return rejectUnauthorized(
          `hook mapping auth failed (${mappingAuth.mappingId}): ${hmacCheck.error}`,
        );
      }
      hookAuthLimiter.reset(clientKey, AUTH_RATE_LIMIT_SCOPE_HOOK_AUTH);
      rawBodyForMapping = rawBody.raw;
    } else {
      const token = extractHookToken(req);
      if (!safeEqualSecret(token, hooksConfig.token)) {
        return rejectUnauthorized();
      }
      hookAuthLimiter.reset(clientKey, AUTH_RATE_LIMIT_SCOPE_HOOK_AUTH);
    }

    const subPath = subPathRaw;
    if (!subPath) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
      return true;
    }

    const body =
      rawBodyForMapping !== null
        ? parseHookJsonPayload(rawBodyForMapping)
        : await readJsonBody(req, hooksConfig.maxBodyBytes);
    if (!body.ok) {
      const status =
        body.error === "payload too large"
          ? 413
          : body.error === "request body timeout"
            ? 408
            : 400;
      sendJson(res, status, { ok: false, error: body.error });
      return true;
    }

    const payload = typeof body.value === "object" && body.value !== null ? body.value : {};
    const headers = normalizeHookHeaders(req);

    if (subPath === "wake") {
      const normalized = normalizeWakePayload(payload as Record<string, unknown>);
      if (!normalized.ok) {
        sendJson(res, 400, { ok: false, error: normalized.error });
        return true;
      }
      dispatchWakeHook(normalized.value);
      sendJson(res, 200, { ok: true, mode: normalized.value.mode });
      return true;
    }

    if (subPath === "agent") {
      const normalized = normalizeAgentPayload(payload as Record<string, unknown>);
      if (!normalized.ok) {
        sendJson(res, 400, { ok: false, error: normalized.error });
        return true;
      }
      if (!isHookAgentAllowed(hooksConfig, normalized.value.agentId)) {
        sendJson(res, 400, { ok: false, error: getHookAgentPolicyError() });
        return true;
      }
      const sessionKey = resolveHookSessionKey({
        hooksConfig,
        source: "request",
        sessionKey: normalized.value.sessionKey,
      });
      if (!sessionKey.ok) {
        sendJson(res, 400, { ok: false, error: sessionKey.error });
        return true;
      }
      const targetAgentId = resolveHookTargetAgentId(hooksConfig, normalized.value.agentId);
      const runId = dispatchAgentHook({
        ...normalized.value,
        sessionKey: normalizeHookDispatchSessionKey({
          sessionKey: sessionKey.value,
          targetAgentId,
        }),
        agentId: targetAgentId,
      });
      sendJson(res, 200, { ok: true, runId });
      return true;
    }

    if (hooksConfig.mappings.length > 0) {
      try {
        const mapped = await applyHookMappings(hooksConfig.mappings, {
          payload: payload as Record<string, unknown>,
          headers,
          url,
          path: subPath,
        });
        if (mapped) {
          if (!mapped.ok) {
            sendJson(res, 400, { ok: false, error: mapped.error });
            return true;
          }
          if (mapped.action === null) {
            res.statusCode = 204;
            res.end();
            return true;
          }
          if (mapped.action.kind === "wake") {
            dispatchWakeHook({
              text: mapped.action.text,
              mode: mapped.action.mode,
            });
            sendJson(res, 200, { ok: true, mode: mapped.action.mode });
            return true;
          }
          const channel = resolveHookChannel(mapped.action.channel);
          if (!channel) {
            sendJson(res, 400, { ok: false, error: getHookChannelError() });
            return true;
          }
          if (!isHookAgentAllowed(hooksConfig, mapped.action.agentId)) {
            sendJson(res, 400, { ok: false, error: getHookAgentPolicyError() });
            return true;
          }
          const sessionKey = resolveHookSessionKey({
            hooksConfig,
            source: "mapping",
            sessionKey: mapped.action.sessionKey,
          });
          if (!sessionKey.ok) {
            sendJson(res, 400, { ok: false, error: sessionKey.error });
            return true;
          }
          const targetAgentId = resolveHookTargetAgentId(hooksConfig, mapped.action.agentId);
          const runId = dispatchAgentHook({
            message: mapped.action.message,
            name: mapped.action.name ?? "Hook",
            agentId: targetAgentId,
            wakeMode: mapped.action.wakeMode,
            sessionKey: normalizeHookDispatchSessionKey({
              sessionKey: sessionKey.value,
              targetAgentId,
            }),
            deliver: resolveHookDeliver(mapped.action.deliver),
            channel,
            to: mapped.action.to,
            model: mapped.action.model,
            thinking: mapped.action.thinking,
            timeoutSeconds: mapped.action.timeoutSeconds,
            allowUnsafeExternalContent: mapped.action.allowUnsafeExternalContent,
          });
          sendJson(res, 200, { ok: true, runId });
          return true;
        }
      } catch (err) {
        logHooks.warn(`hook mapping failed: ${String(err)}`);
        sendJson(res, 500, { ok: false, error: "hook mapping failed" });
        return true;
      }
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not Found");
    return true;
  };
}

export function createGatewayHttpServer(opts: {
  canvasHost: CanvasHostHandler | null;
  clients: Set<GatewayWsClient>;
  controlUiEnabled: boolean;
  controlUiBasePath: string;
  controlUiRoot?: ControlUiRootState;
  openAiChatCompletionsEnabled: boolean;
  openAiChatCompletionsConfig?: import("../config/types.gateway.js").GatewayHttpChatCompletionsConfig;
  openResponsesEnabled: boolean;
  openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
  strictTransportSecurityHeader?: string;
  handleHooksRequest: HooksRequestHandler;
  handlePluginRequest?: PluginHttpRequestHandler;
  shouldEnforcePluginGatewayAuth?: (pathContext: PluginRoutePathContext) => boolean;
  resolvedAuth: ResolvedGatewayAuth;
  /** Optional rate limiter for auth brute-force protection. */
  rateLimiter?: AuthRateLimiter;
  getReadiness?: ReadinessChecker;
  tlsOptions?: TlsOptions;
}): HttpServer {
  const {
    canvasHost,
    clients,
    controlUiEnabled,
    controlUiBasePath,
    controlUiRoot,
    openAiChatCompletionsEnabled,
    openAiChatCompletionsConfig,
    openResponsesEnabled,
    openResponsesConfig,
    strictTransportSecurityHeader,
    handleHooksRequest,
    handlePluginRequest,
    shouldEnforcePluginGatewayAuth,
    resolvedAuth,
    rateLimiter,
    getReadiness,
  } = opts;
  // Tri-platform employee shell: /native/bootstrap mint + consume endpoints.
  // Created once so the in-memory one-time token store persists across requests.
  const handleNativeBootstrap = createNativeBootstrapHttpHandler();
  const httpServer: HttpServer = opts.tlsOptions
    ? createHttpsServer(opts.tlsOptions, (req, res) => {
        void handleRequest(req, res);
      })
    : createHttpServer((req, res) => {
        void handleRequest(req, res);
      });

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    setDefaultSecurityHeaders(res, {
      strictTransportSecurity: strictTransportSecurityHeader,
    });

    // Don't interfere with WebSocket upgrades; ws handles the 'upgrade' event.
    if (String(req.headers.upgrade ?? "").toLowerCase() === "websocket") {
      return;
    }

    try {
      const configSnapshot = loadConfig();
      const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
      const allowRealIpFallback = configSnapshot.gateway?.allowRealIpFallback === true;
      const scopedCanvas = normalizeCanvasScopedUrl(req.url ?? "/");
      if (scopedCanvas.malformedScopedPath) {
        sendGatewayAuthFailure(res, { ok: false, reason: "unauthorized" });
        return;
      }
      if (scopedCanvas.rewrittenUrl) {
        req.url = scopedCanvas.rewrittenUrl;
      }
      const requestPath = new URL(req.url ?? "/", "http://localhost").pathname;
      const mattermostSlashCallbackPaths = resolveMattermostSlashCallbackPaths(configSnapshot);
      const pluginPathContext = handlePluginRequest
        ? resolvePluginRoutePathContext(requestPath)
        : null;
      const requestStages: GatewayHttpRequestStage[] = [
        {
          // Account-computer noVNC page, static files, and bootstrap. The iframe
          // is same-origin with the control UI. Auth is the one-time token.
          name: "account-computer-novnc",
          run: () => handleNoVncObserverHttp(req, res, consumeNoVncObserverToken),
        },
        {
          name: "hooks",
          run: () => handleHooksRequest(req, res),
        },
        {
          name: "tools-invoke",
          run: () =>
            handleToolsInvokeHttpRequest(req, res, {
              auth: resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
            }),
        },
        {
          // Claw4 firmware HTTP compat (Scheme B1): /api/v1/upload + messages.
          // Maps to integrations conversations/turns. Does not change frozen
          // device-platform OpenAPI. grayRelease stays false. No PROMOTE.
          name: "claw4-firmware",
          run: () => handleClaw4FirmwareHttpRequest(req, res),
        },
        {
          // Integrations grant mint (consent → PKCE → exchange) on the same
          // in-process DeviceDhService as Claw4 when INPROCESS/inject is on.
          // Opt-in only; unbound production leaves these paths unclaimed.
          // Stub 8787 remains a valid full joint path. No PROMOTE.
          name: "integrations-grant",
          run: () => handleIntegrationsGrantHttpRequest(req, res),
        },
        {
          // OpenBot management routes only: /admin for a platform-admin session
          // and /me for a signed-in member. Device-control is a different origin
          // (loopback joint default http://127.0.0.1:8791). The same path prefix
          // on this host must not be treated as that process. Does not reverse-
          // proxy the loopback stub. Full /api/integrations/v1 stays off except
          // the opt-in grant mint stage above.
          name: "device-platform-admin",
          run: () => handleDevicePlatformHttpRequest(req, res),
        },
        {
          name: "fabric-v1",
          run: () =>
            handleFabricV1HttpRequest(req, res, {
              auth: resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
            }),
        },
        {
          // Isolation-only exec-protocol product path. Off unless
          // gateway.execProtocol.enabled is set with explicit isolation keys.
          // Does not cut 回源 or enable a production execution profile.
          name: "exec-protocol",
          run: () =>
            handleExecProtocolHttpRequest(req, res, {
              auth: resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
              execProtocol: configSnapshot.gateway?.execProtocol,
            }),
        },
        {
          name: "slack",
          run: () => handleSlackHttpRequest(req, res),
        },
        {
          name: "commerce-payments",
          run: () => handleCommercePaymentsHttpRequest(req, res),
        },
        {
          // Vault Sync binary chunk upload (Wave D). Before control-ui SPA;
          // self-gated on upload-session httpUploadToken (not WS Base64).
          name: "vault-sync-http",
          run: () => handleVaultSyncHttpRequest(req, res),
        },
        {
          // Employee-shell native bootstrap (mint + consume). Runs before the
          // control-ui SPA catch-all so /native/bootstrap is not swallowed by it;
          // self-gated on the one-time token, so it sits outside gateway bearer auth.
          name: "native-bootstrap",
          run: () => handleNativeBootstrap(req, res),
        },
      ];
      if (openResponsesEnabled) {
        requestStages.push({
          name: "openresponses",
          run: () =>
            handleOpenResponsesHttpRequest(req, res, {
              auth: resolvedAuth,
              config: openResponsesConfig,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
            }),
        });
      }
      if (openAiChatCompletionsEnabled) {
        requestStages.push({
          name: "openai",
          run: () =>
            handleOpenAiHttpRequest(req, res, {
              auth: resolvedAuth,
              config: openAiChatCompletionsConfig,
              trustedProxies,
              allowRealIpFallback,
              rateLimiter,
            }),
        });
      }
      if (canvasHost) {
        requestStages.push({
          name: "canvas-auth",
          run: async () => {
            if (!isCanvasPath(requestPath)) {
              return false;
            }
            const ok = await authorizeCanvasRequest({
              req,
              auth: resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
              clients,
              canvasCapability: scopedCanvas.capability,
              malformedScopedPath: scopedCanvas.malformedScopedPath,
              rateLimiter,
            });
            if (!ok.ok) {
              sendGatewayAuthFailure(res, ok);
              return true;
            }
            return false;
          },
        });
        requestStages.push({
          name: "a2ui",
          run: () => handleA2uiHttpRequest(req, res),
        });
        requestStages.push({
          name: "canvas-http",
          run: () => canvasHost.handleHttpRequest(req, res),
        });
      }
      // Plugin routes run before the Control UI SPA catch-all so explicitly
      // registered plugin endpoints stay reachable. Core built-in gateway
      // routes above still keep precedence on overlapping paths.
      requestStages.push(
        ...buildPluginRequestStages({
          req,
          res,
          requestPath,
          mattermostSlashCallbackPaths,
          pluginPathContext,
          handlePluginRequest,
          shouldEnforcePluginGatewayAuth,
          resolvedAuth,
          trustedProxies,
          allowRealIpFallback,
          rateLimiter,
        }),
      );

      if (controlUiEnabled) {
        requestStages.push({
          name: "control-ui-avatar",
          run: () =>
            handleControlUiAvatarRequest(req, res, {
              basePath: controlUiBasePath,
              resolveAvatar: (agentId) => resolveAgentAvatar(configSnapshot, agentId),
            }),
        });
        requestStages.push({
          name: "control-ui-http",
          run: () =>
            handleControlUiHttpRequest(req, res, {
              basePath: controlUiBasePath,
              config: configSnapshot,
              root: controlUiRoot,
              resolvedAuth,
              trustedProxies,
              allowRealIpFallback,
            }),
        });
      }

      requestStages.push({
        name: "gateway-probes",
        run: () =>
          handleGatewayProbeRequest(
            req,
            res,
            requestPath,
            resolvedAuth,
            trustedProxies,
            allowRealIpFallback,
            getReadiness,
          ),
      });

      if (await runGatewayHttpRequestStages(requestStages)) {
        return;
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    } catch {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Internal Server Error");
    }
  }

  return httpServer;
}

export function attachGatewayUpgradeHandler(opts: {
  httpServer: HttpServer;
  wss: WebSocketServer;
  canvasHost: CanvasHostHandler | null;
  clients: Set<GatewayWsClient>;
  resolvedAuth: ResolvedGatewayAuth;
  /** Optional rate limiter for auth brute-force protection. */
  rateLimiter?: AuthRateLimiter;
}) {
  const { httpServer, wss, canvasHost, clients, resolvedAuth, rateLimiter } = opts;
  httpServer.on("upgrade", (req, socket, head) => {
    void (async () => {
      const scopedCanvas = normalizeCanvasScopedUrl(req.url ?? "/");
      if (scopedCanvas.malformedScopedPath) {
        writeUpgradeAuthFailure(socket, { ok: false, reason: "unauthorized" });
        socket.destroy();
        return;
      }
      if (scopedCanvas.rewrittenUrl) {
        req.url = scopedCanvas.rewrittenUrl;
      }
      if (handleNoVncObserverUpgrade(req, socket, head)) {
        return;
      }
      if (canvasHost) {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (isCanvasWsPath(url.pathname)) {
          const configSnapshot = loadConfig();
          const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
          const allowRealIpFallback = configSnapshot.gateway?.allowRealIpFallback === true;
          const ok = await authorizeCanvasRequest({
            req,
            auth: resolvedAuth,
            trustedProxies,
            allowRealIpFallback,
            clients,
            canvasCapability: scopedCanvas.capability,
            malformedScopedPath: scopedCanvas.malformedScopedPath,
            rateLimiter,
          });
          if (!ok.ok) {
            writeUpgradeAuthFailure(socket, ok);
            socket.destroy();
            return;
          }
        }
        if (canvasHost.handleUpgrade(req, socket, head)) {
          return;
        }
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    })().catch(() => {
      socket.destroy();
    });
  });
}
