import { GATEWAY_CLIENT_CAPS } from "../../../../../src/gateway/protocol/client-info.js";
import { ConnectErrorDetailCodes } from "../../../../../src/gateway/protocol/connect-error-details.js";
import {
  isCurrentControlUiGatewayTarget,
  type ControlUiBootstrapState,
} from "../../controllers/control-ui-bootstrap.ts";
import { isGatewayAuthIssue } from "../../gateway-auth-classification.ts";
import {
  resolveGatewayErrorDetailCode,
  GatewayBrowserClient,
  type GatewayBrowserClientOptions,
} from "../../gateway.ts";
import { inferBasePathFromPathname, normalizeBasePath } from "../../navigation.ts";
import { resolveRecoveredGatewayUrlForHostMismatch as resolveHostMismatchGatewayUrl } from "../../routing/openbot-subdomain-redirect.ts";

let createGatewayBrowserClient = (options: ConstructorParameters<typeof GatewayBrowserClient>[0]) =>
  new GatewayBrowserClient(options);

let resolveGatewayCloseErrorDetailCode = resolveGatewayErrorDetailCode;

export type GatewayCapabilityRuntimeHooks = {
  createClient?: typeof createGatewayBrowserClient;
  resolveErrorDetailCode?: typeof resolveGatewayErrorDetailCode;
};

export type GatewayCapabilityConnectionInput = {
  gatewayUrl: string;
  token: string;
  password: string;
  clientInstanceId: string;
  serverVersion: string | null;
  bootstrapAuthMode: ControlUiBootstrapState["bootstrapAuthMode"];
  bootstrapAuthSession: ControlUiBootstrapState["bootstrapAuthSession"];
  onHello: GatewayBrowserClientOptions["onHello"];
  onClose: GatewayBrowserClientOptions["onClose"];
  onEvent: GatewayBrowserClientOptions["onEvent"];
  onGap: GatewayBrowserClientOptions["onGap"];
  onReconnectUrl?: GatewayBrowserClientOptions["onReconnectUrl"];
};

export function setGatewayCapabilityRuntimeTestHooks(hooks: GatewayCapabilityRuntimeHooks | null) {
  createGatewayBrowserClient =
    hooks?.createClient ?? ((options) => new GatewayBrowserClient(options));
  resolveGatewayCloseErrorDetailCode =
    hooks?.resolveErrorDetailCode ?? resolveGatewayErrorDetailCode;
}

function isGenericBrowserFetchFailure(message: string): boolean {
  return /^(?:typeerror:\s*)?(?:fetch failed|failed to fetch)$/i.test(message.trim());
}

function formatAuthCloseErrorMessage(code: string | null, fallback: string): string {
  const resolvedCode = code ?? "";
  if (resolvedCode === ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH) {
    return "unauthorized: gateway token mismatch (open dashboard URL with current token)";
  }
  if (resolvedCode === ConnectErrorDetailCodes.AUTH_RATE_LIMITED) {
    return "unauthorized: too many failed authentication attempts (retry later)";
  }
  if (
    resolvedCode === ConnectErrorDetailCodes.AUTH_TRUSTED_PROXY_UNTRUSTED_SOURCE ||
    resolvedCode === ConnectErrorDetailCodes.AUTH_TRUSTED_PROXY_USER_MISSING ||
    resolvedCode === ConnectErrorDetailCodes.AUTH_TRUSTED_PROXY_USER_NOT_ALLOWED ||
    resolvedCode === ConnectErrorDetailCodes.AUTH_TRUSTED_PROXY_INVALID_ROLE ||
    resolvedCode === ConnectErrorDetailCodes.AUTH_TRUSTED_PROXY_CONFIG_MISSING ||
    resolvedCode === ConnectErrorDetailCodes.AUTH_TRUSTED_PROXY_NO_PROXIES_CONFIGURED ||
    resolvedCode === ConnectErrorDetailCodes.AUTH_TRUSTED_PROXY_MISSING_HEADER ||
    resolvedCode === ConnectErrorDetailCodes.AUTH_TRUSTED_PROXY_SESSION_MISSING
  ) {
    return fallback;
  }
  if (resolvedCode === ConnectErrorDetailCodes.AUTH_UNAUTHORIZED) {
    return isGatewayAuthIssue(fallback) ? fallback : "unauthorized: authentication failed";
  }
  return fallback;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.startsWith("127.")
  );
}

function resolveCurrentControlUiGatewayUrl(pageUrl?: string): string | null {
  const currentPageUrl =
    pageUrl ?? (typeof window === "undefined" ? undefined : window.location.href);
  if (!currentPageUrl) {
    return null;
  }
  try {
    const page = new URL(currentPageUrl);
    const configuredBasePath =
      typeof window !== "undefined" ? window.__OPENBOT_CONTROL_UI_BASE_PATH__ : undefined;
    const basePath =
      typeof configuredBasePath === "string" && configuredBasePath.trim()
        ? normalizeBasePath(configuredBasePath)
        : inferBasePathFromPathname(page.pathname);
    const protocol = page.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${page.host}${basePath}`;
  } catch {
    return null;
  }
}

export function resolveAuthenticatedControlUiGatewayUrl(params: {
  gatewayUrl: string;
  bootstrapAuthMode: ControlUiBootstrapState["bootstrapAuthMode"];
  bootstrapAuthSession: ControlUiBootstrapState["bootstrapAuthSession"];
  pageUrl?: string;
}): string {
  if (params.bootstrapAuthMode !== "trusted-proxy" || !params.bootstrapAuthSession?.user?.trim()) {
    return params.gatewayUrl;
  }
  // Platform sessions are carried by a host-scoped HTTP cookie. A stale saved
  // gateway on another subdomain can still chat via its device token, but loses
  // the employee identity required by governed tools. Keep authenticated WebChat
  // on the page origin so the WebSocket upgrade carries the validated cookie.
  return resolveCurrentControlUiGatewayUrl(params.pageUrl) ?? params.gatewayUrl;
}

export function resolveRecoveredGatewayUrlForOriginError(params: {
  currentGatewayUrl: string;
  errorMessage: string;
  pageUrl?: string;
}): string | null {
  if (!/origin not allowed/i.test(params.errorMessage)) {
    return null;
  }
  const currentPageUrl =
    params.pageUrl ?? (typeof window === "undefined" ? undefined : window.location.href);
  if (!currentPageUrl) {
    return null;
  }
  try {
    const page = new URL(currentPageUrl);
    if (!isLoopbackHostname(page.hostname)) {
      return null;
    }
    const recoveredUrl = resolveCurrentControlUiGatewayUrl(currentPageUrl);
    return recoveredUrl && recoveredUrl !== params.currentGatewayUrl ? recoveredUrl : null;
  } catch {
    return null;
  }
}

export function resolveControlUiClientVersion(params: {
  gatewayUrl: string;
  serverVersion: string | null;
  pageUrl?: string;
}): string | undefined {
  const serverVersion = params.serverVersion?.trim();
  if (!serverVersion) {
    return undefined;
  }
  const pageUrl =
    params.pageUrl ?? (typeof window === "undefined" ? undefined : window.location.href);
  if (!pageUrl) {
    return undefined;
  }
  return isCurrentControlUiGatewayTarget({
    gatewayUrl: params.gatewayUrl,
    pageUrl,
  })
    ? serverVersion
    : undefined;
}

export { resolveHostMismatchGatewayUrl as resolveRecoveredGatewayUrlForHostMismatch };

export function resolveRecoveredGatewayUrl(params: {
  currentGatewayUrl: string;
  errorMessage?: string;
  pageUrl?: string;
  basePath?: string;
}): string | null {
  const originRecovery = params.errorMessage
    ? resolveRecoveredGatewayUrlForOriginError({
        currentGatewayUrl: params.currentGatewayUrl,
        errorMessage: params.errorMessage,
        pageUrl: params.pageUrl,
      })
    : null;
  if (originRecovery) {
    return originRecovery;
  }
  return resolveHostMismatchGatewayUrl({
    currentGatewayUrl: params.currentGatewayUrl,
    pageUrl: params.pageUrl,
    basePath: params.basePath,
  });
}

export function createGatewayConnectionClient(input: GatewayCapabilityConnectionInput) {
  const gatewayUrl = resolveAuthenticatedControlUiGatewayUrl({
    gatewayUrl: input.gatewayUrl,
    bootstrapAuthMode: input.bootstrapAuthMode,
    bootstrapAuthSession: input.bootstrapAuthSession,
  });
  const useBootstrapAuth = isCurrentControlUiGatewayTarget({
    gatewayUrl,
  });
  const clientVersion = resolveControlUiClientVersion({
    gatewayUrl,
    serverVersion: input.serverVersion,
  });
  return createGatewayBrowserClient({
    url: gatewayUrl,
    token: input.token.trim() ? input.token : undefined,
    password: input.password.trim() ? input.password : undefined,
    clientName: "openbot-control-ui",
    clientVersion,
    mode: "webchat",
    instanceId: input.clientInstanceId,
    authMode: useBootstrapAuth ? input.bootstrapAuthMode : null,
    trustedProxySession: useBootstrapAuth ? input.bootstrapAuthSession : null,
    onHello: input.onHello,
    onClose: input.onClose,
    onEvent: input.onEvent,
    onGap: input.onGap,
    onReconnectUrl: input.onReconnectUrl,
    // Tool phase (正在验证) is carried on the existing agent event, which the
    // gateway only forwards to clients that advertise tool-events. History
    // requests still pass includeTools: false.
    caps: [GATEWAY_CLIENT_CAPS.TOOL_EVENTS],
  });
}

export function resolveGatewayCloseDetailCode(
  error: Parameters<typeof resolveGatewayErrorDetailCode>[0],
) {
  return resolveGatewayCloseErrorDetailCode(error);
}

export function resolveGatewayCloseMessage(params: {
  errorCode: string | null;
  errorMessage: string;
}) {
  return params.errorCode && isGenericBrowserFetchFailure(params.errorMessage)
    ? formatAuthCloseErrorMessage(params.errorCode, params.errorMessage)
    : params.errorMessage;
}
