import type {
  ControlUiAuthMode,
  ControlUiTrustedProxySession,
} from "../../../src/gateway/control-ui-contract.js";
import { buildDeviceAuthPayload } from "../../../src/gateway/device-auth.js";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  type GatewayClientCap,
  type GatewayClientMode,
  type GatewayClientName,
} from "../../../src/gateway/protocol/client-info.js";
import {
  ConnectErrorDetailCodes,
  readConnectErrorRecoveryAdvice,
  readConnectErrorDetailCode,
} from "../../../src/gateway/protocol/connect-error-details.js";
import { describeBrowserDeviceName } from "./client-display-name.ts";
import { clearDeviceAuthToken, loadDeviceAuthToken, storeDeviceAuthToken } from "./device-auth.ts";
import { loadOrCreateDeviceIdentity, signDevicePayload } from "./device-identity.ts";
import { resolveLocalControlUiSurfaceFromPathname } from "./local-control-ui-surface.ts";
import { generateUUID } from "./uuid.ts";

const gatewayTestDeps = {
  loadOrCreateDeviceIdentity,
  signDevicePayload,
};

export function setGatewayBrowserClientTestHooks(hooks: Partial<typeof gatewayTestDeps> | null) {
  Object.assign(
    gatewayTestDeps,
    hooks ?? {
      loadOrCreateDeviceIdentity,
      signDevicePayload,
    },
  );
}

export type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: { presence: number; health: number };
};

export type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown };
};

export type GatewayErrorInfo = {
  code: string;
  message: string;
  details?: unknown;
};

export class GatewayRequestError extends Error {
  readonly gatewayCode: string;
  readonly details?: unknown;

  constructor(error: GatewayErrorInfo) {
    super(error.message);
    this.name = "GatewayRequestError";
    this.gatewayCode = error.code;
    this.details = error.details;
  }
}

export function resolveGatewayErrorDetailCode(
  error: { details?: unknown } | null | undefined,
): string | null {
  return readConnectErrorDetailCode(error?.details);
}

/**
 * Auth errors that won't resolve without user action — don't auto-reconnect.
 *
 * NOTE: AUTH_TOKEN_MISMATCH is intentionally NOT included here because the
 * browser client supports a bounded one-time retry with a cached device token
 * when the endpoint is trusted. Reconnect suppression for mismatch is handled
 * with client state (after retry budget is exhausted).
 *
 * Cookie-native Control UI (apex / nginx strips X-Forwarded-User) authenticates
 * via the platform session cookie on WS upgrade. Brief cookie/session gaps then
 * surface as AUTH_TRUSTED_PROXY_USER_MISSING / MISSING_HEADER / SESSION_MISSING.
 * Those are recoverable: reconnect can pick up a refreshed cookie, and the
 * gateway already rate-limits stampeding reconnects. Permanent proxy policy /
 * config failures stay sticky below.
 */
export function isNonRecoverableAuthError(error: GatewayErrorInfo | undefined): boolean {
  if (!error) {
    return false;
  }
  const code = resolveGatewayErrorDetailCode(error);
  return (
    code === ConnectErrorDetailCodes.AUTH_TOKEN_MISSING ||
    code === ConnectErrorDetailCodes.AUTH_PASSWORD_MISSING ||
    code === ConnectErrorDetailCodes.AUTH_PASSWORD_MISMATCH ||
    code === ConnectErrorDetailCodes.AUTH_RATE_LIMITED ||
    code === ConnectErrorDetailCodes.AUTH_TRUSTED_PROXY_UNTRUSTED_SOURCE ||
    code === ConnectErrorDetailCodes.AUTH_TRUSTED_PROXY_USER_NOT_ALLOWED ||
    code === ConnectErrorDetailCodes.AUTH_TRUSTED_PROXY_INVALID_ROLE ||
    code === ConnectErrorDetailCodes.AUTH_TRUSTED_PROXY_CONFIG_MISSING ||
    code === ConnectErrorDetailCodes.AUTH_TRUSTED_PROXY_NO_PROXIES_CONFIGURED ||
    code === ConnectErrorDetailCodes.PAIRING_REQUIRED ||
    code === ConnectErrorDetailCodes.CONTROL_UI_DEVICE_IDENTITY_REQUIRED ||
    code === ConnectErrorDetailCodes.DEVICE_IDENTITY_REQUIRED
  );
}

function isTrustedRetryEndpoint(url: string): boolean {
  try {
    const gatewayUrl = new URL(url, window.location.href);
    const host = gatewayUrl.hostname.trim().toLowerCase();
    const isLoopbackHost =
      host === "localhost" || host === "::1" || host === "[::1]" || host === "127.0.0.1";
    const isLoopbackIPv4 = host.startsWith("127.");
    if (isLoopbackHost || isLoopbackIPv4) {
      return true;
    }
    const pageUrl = new URL(window.location.href);
    return gatewayUrl.host === pageUrl.host;
  } catch {
    return false;
  }
}

export type GatewayHelloOk = {
  type: "hello-ok";
  protocol: number;
  server?: {
    version?: string;
    connId?: string;
  };
  features?: { methods?: string[]; events?: string[] };
  snapshot?: unknown;
  auth?: {
    provider?: "trusted-proxy";
    deviceToken?: string;
    user?: string;
    displayName?: string;
    tenantId?: string;
    role?: string;
    scopes?: string[];
    issuedAtMs?: number;
  };
  policy?: { tickIntervalMs?: number };
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
};

export type GatewayBrowserClientOptions = {
  url: string;
  token?: string;
  password?: string;
  clientName?: GatewayClientName;
  clientDisplayName?: string;
  clientVersion?: string;
  platform?: string;
  mode?: GatewayClientMode;
  instanceId?: string;
  authMode?: ControlUiAuthMode | null;
  trustedProxySession?: ControlUiTrustedProxySession | null;
  caps?: GatewayClientCap[];
  onHello?: (hello: GatewayHelloOk) => void;
  onEvent?: (evt: GatewayEventFrame) => void;
  onClose?: (info: { code: number; reason: string; error?: GatewayErrorInfo }) => void;
  onGap?: (info: { expected: number; received: number }) => void;
  /** Optional hook to rewrite the gateway URL before an automatic reconnect attempt. */
  onReconnectUrl?: (currentUrl: string) => string | null;
};

// 4008 = application-defined code (browser rejects 1008 "Policy Violation")
const CONNECT_FAILED_CLOSE_CODE = 4008;

export class GatewayBrowserClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private closed = false;
  private connectionUrl: string;
  private lastSeq: number | null = null;
  private connectNonce: string | null = null;
  private connectSent = false;
  private authenticated = false;
  private connectTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private tickTimer: number | null = null;
  private tickIntervalMs = 30_000;
  private lastTick = 0;
  /** Bumped on every connect()/stop() so stale socket close cannot null the live socket. */
  private socketGeneration = 0;
  private backoffMs = 800;
  private pendingConnectError: GatewayErrorInfo | undefined;
  private pendingDeviceTokenRetry = false;
  private deviceTokenRetryBudgetUsed = false;
  /** pagePath sent on the last successful connect (local surface projection). */
  private connectedPagePath: string | undefined;

  constructor(private opts: GatewayBrowserClientOptions) {
    this.connectionUrl = opts.url;
  }

  start() {
    this.closed = false;
    this.connect();
  }

  stop() {
    this.closed = true;
    this.authenticated = false;
    this.socketGeneration += 1;
    this.clearReconnectTimer();
    this.stopTickWatch();
    this.ws?.close();
    this.ws = null;
    this.pendingConnectError = undefined;
    this.pendingDeviceTokenRetry = false;
    this.deviceTokenRetryBudgetUsed = false;
    this.flushPending(new Error("gateway client stopped"));
  }

  get connected() {
    return this.authenticated && this.ws?.readyState === WebSocket.OPEN;
  }

  /** WebSocket URL used for this client (ws:// or wss://). */
  get url(): string {
    return this.opts.url;
  }

  /** Explicit gateway shared token when configured (Bearer for optional HTTP). */
  get token(): string | undefined {
    const value = this.opts.token?.trim();
    return value || undefined;
  }

  private connect() {
    if (this.closed) {
      return;
    }
    this.clearReconnectTimer();
    this.stopTickWatch();
    this.lastSeq = null;
    this.authenticated = false;
    const generation = ++this.socketGeneration;
    const previous = this.ws;
    this.ws = null;
    if (previous && previous.readyState < 2) {
      try {
        previous.close();
      } catch {
        // replaced socket; close is best-effort
      }
    }
    const ws = new WebSocket(this.connectionUrl);
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (generation !== this.socketGeneration || this.ws !== ws) {
        return;
      }
      this.queueConnect();
    });
    ws.addEventListener("message", (ev) => {
      if (generation !== this.socketGeneration || this.ws !== ws) {
        return;
      }
      this.handleMessage(String(ev.data ?? ""));
    });
    ws.addEventListener("close", (ev) => {
      if (generation !== this.socketGeneration) {
        return;
      }
      const reason = String(ev.reason ?? "");
      const connectError = this.pendingConnectError;
      this.pendingConnectError = undefined;
      this.authenticated = false;
      this.stopTickWatch();
      if (this.ws === ws) {
        this.ws = null;
      }
      void this.clearStaleDeviceTokenAfterClose(reason);
      this.flushPending(new Error(`gateway closed (${ev.code}): ${reason}`));
      this.opts.onClose?.({ code: ev.code, reason, error: connectError });
      const connectErrorCode = resolveGatewayErrorDetailCode(connectError);
      if (
        connectErrorCode === ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH &&
        this.deviceTokenRetryBudgetUsed &&
        !this.pendingDeviceTokenRetry
      ) {
        return;
      }
      if (!isNonRecoverableAuthError(connectError)) {
        this.scheduleReconnect();
      }
    });
    ws.addEventListener("error", () => {
      // ignored; close handler will fire
    });
  }

  private async clearStaleDeviceTokenAfterClose(reason: string) {
    if (
      this.opts.token?.trim() ||
      this.opts.password?.trim() ||
      !reason.toLowerCase().includes("device token mismatch")
    ) {
      return;
    }
    try {
      const deviceIdentity = await gatewayTestDeps.loadOrCreateDeviceIdentity();
      const role = this.opts.trustedProxySession?.role?.trim() || "operator";
      clearDeviceAuthToken({ deviceId: deviceIdentity.deviceId, role });
    } catch {
      // Best effort: closing/reconnecting must not be blocked by storage failures.
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer === null) {
      return;
    }
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private stopTickWatch() {
    if (this.tickTimer === null) {
      return;
    }
    window.clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  private startTickWatch() {
    this.stopTickWatch();
    this.lastTick = Date.now();
    const interval = Math.max(this.tickIntervalMs, 1000);
    this.tickTimer = window.setInterval(() => {
      if (this.closed || !this.lastTick) {
        return;
      }
      // Half-open sockets (browser still OPEN, proxy already reset) surface as
      // missing server ticks. Force a close so the existing reconnect path runs.
      if (Date.now() - this.lastTick > this.tickIntervalMs * 2) {
        this.ws?.close();
      }
    }, interval);
  }

  private scheduleReconnect() {
    if (this.closed) {
      return;
    }
    this.clearReconnectTimer();
    this.stopTickWatch();
    const recoveredUrl = this.opts.onReconnectUrl?.(this.connectionUrl)?.trim();
    if (recoveredUrl && recoveredUrl !== this.connectionUrl) {
      this.connectionUrl = recoveredUrl;
      this.backoffMs = 800;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, 15_000);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private flushPending(err: Error) {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }

  private async sendConnect() {
    if (this.connectSent) {
      return;
    }
    this.connectSent = true;
    const socket = this.ws;
    const generation = this.socketGeneration;
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    // crypto.subtle is only available in secure contexts (HTTPS, localhost).
    // Over plain HTTP, we skip device identity and fall back to token-only auth.
    // Gateways may reject this unless gateway.controlUi.allowInsecureAuth is enabled.
    const isSecureContext = typeof crypto !== "undefined" && !!crypto.subtle;

    const role = this.opts.trustedProxySession?.role?.trim() || "operator";
    const scopes = Array.isArray(this.opts.trustedProxySession?.scopes)
      ? this.opts.trustedProxySession.scopes.filter(
          (value) => typeof value === "string" && value.trim(),
        )
      : ["operator.admin", "operator.approvals", "operator.pairing"];
    const caps = Array.isArray(this.opts.caps)
      ? this.opts.caps.filter(
          (value): value is GatewayClientCap =>
            typeof value === "string" && value.trim().length > 0,
        )
      : [];
    let deviceIdentity: Awaited<ReturnType<typeof loadOrCreateDeviceIdentity>> | null = null;
    const explicitGatewayToken = this.opts.token?.trim() || undefined;
    let authToken = explicitGatewayToken;
    let deviceToken: string | undefined;

    if (isSecureContext) {
      deviceIdentity = await gatewayTestDeps.loadOrCreateDeviceIdentity();
      const storedToken = loadDeviceAuthToken({
        deviceId: deviceIdentity.deviceId,
        role,
      })?.token;
      const shouldUseDeviceRetryToken =
        this.pendingDeviceTokenRetry &&
        !deviceToken &&
        Boolean(explicitGatewayToken) &&
        Boolean(storedToken) &&
        isTrustedRetryEndpoint(this.opts.url);
      if (shouldUseDeviceRetryToken) {
        deviceToken = storedToken ?? undefined;
        this.pendingDeviceTokenRetry = false;
      } else {
        deviceToken = !(explicitGatewayToken || this.opts.password?.trim())
          ? (storedToken ?? undefined)
          : undefined;
      }
    }
    authToken = explicitGatewayToken ?? deviceToken;
    const auth =
      authToken || this.opts.password
        ? {
            token: authToken,
            deviceToken,
            password: this.opts.password,
          }
        : undefined;

    let device:
      | {
          id: string;
          publicKey: string;
          signature: string;
          signedAt: number;
          nonce: string;
        }
      | undefined;

    if (isSecureContext && deviceIdentity) {
      const signedAtMs = Date.now();
      const nonce = this.connectNonce ?? "";
      const payload = buildDeviceAuthPayload({
        deviceId: deviceIdentity.deviceId,
        clientId: this.opts.clientName ?? GATEWAY_CLIENT_NAMES.CONTROL_UI,
        clientMode: this.opts.mode ?? GATEWAY_CLIENT_MODES.WEBCHAT,
        role,
        scopes,
        signedAtMs,
        token: authToken ?? null,
        nonce,
      });
      const signature = await gatewayTestDeps.signDevicePayload(deviceIdentity.privateKey, payload);
      device = {
        id: deviceIdentity.deviceId,
        publicKey: deviceIdentity.publicKey,
        signature,
        signedAt: signedAtMs,
        nonce,
      };
    }
    // Friendly label ("Chrome · Mac") so pairing records stay human-readable;
    // the server refreshes it on every reconnect via access metadata.
    const clientDisplayName = this.opts.clientDisplayName?.trim() || describeBrowserDeviceName();
    // Own authenticated session email only (bootstrap / trusted-proxy). Never invent
    // a user from displayName — anti-forgery subject checks still apply server-side.
    const sessionUser =
      this.opts.trustedProxySession?.user?.trim() ||
      this.opts.trustedProxySession?.email?.trim() ||
      undefined;
    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: this.opts.clientName ?? GATEWAY_CLIENT_NAMES.CONTROL_UI,
        ...(clientDisplayName ? { displayName: clientDisplayName } : {}),
        version: this.opts.clientVersion ?? "control-ui",
        platform: this.opts.platform ?? navigator.platform ?? "web",
        mode: this.opts.mode ?? GATEWAY_CLIENT_MODES.WEBCHAT,
        instanceId: this.opts.instanceId,
      },
      role,
      scopes,
      device,
      ...(caps.length > 0 ? { caps } : {}),
      auth,
      ...(sessionUser ? { user: sessionUser } : {}),
      userAgent: navigator.userAgent,
      locale: navigator.language,
      // Local all-in-one Control UI: path selects employee vs enterprise vs platform surface.
      pagePath: typeof location !== "undefined" ? location.pathname : undefined,
    };
    this.connectedPagePath = typeof params.pagePath === "string" ? params.pagePath : undefined;

    // Identity/signing is asynchronous; an old handshake must not authenticate a replacement socket.
    if (this.ws !== socket || generation !== this.socketGeneration || this.closed) {
      return;
    }
    void this.request<GatewayHelloOk>("connect", params)
      .then((hello) => {
        if (this.ws !== socket || generation !== this.socketGeneration || this.closed) {
          return;
        }
        this.authenticated = true;
        this.pendingDeviceTokenRetry = false;
        this.deviceTokenRetryBudgetUsed = false;
        if (hello?.auth?.deviceToken && deviceIdentity) {
          storeDeviceAuthToken({
            deviceId: deviceIdentity.deviceId,
            role: hello.auth.role ?? role,
            token: hello.auth.deviceToken,
            scopes: hello.auth.scopes ?? [],
          });
        }
        this.backoffMs = 800;
        this.tickIntervalMs =
          typeof hello?.policy?.tickIntervalMs === "number" && hello.policy.tickIntervalMs > 0
            ? hello.policy.tickIntervalMs
            : 30_000;
        this.startTickWatch();
        this.opts.onHello?.(hello);
      })
      .catch((err: unknown) => {
        if (this.ws !== socket || generation !== this.socketGeneration || this.closed) {
          return;
        }
        const connectErrorCode =
          err instanceof GatewayRequestError ? resolveGatewayErrorDetailCode(err) : null;
        const recoveryAdvice =
          err instanceof GatewayRequestError ? readConnectErrorRecoveryAdvice(err.details) : {};
        const retryWithDeviceTokenRecommended =
          recoveryAdvice.recommendedNextStep === "retry_with_device_token";
        const canRetryWithDeviceTokenHint =
          recoveryAdvice.canRetryWithDeviceToken === true ||
          retryWithDeviceTokenRecommended ||
          connectErrorCode === ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH;
        const shouldRetryWithDeviceToken =
          !this.deviceTokenRetryBudgetUsed &&
          !deviceToken &&
          Boolean(explicitGatewayToken) &&
          Boolean(deviceIdentity) &&
          Boolean(
            loadDeviceAuthToken({
              deviceId: deviceIdentity?.deviceId ?? "",
              role,
            })?.token,
          ) &&
          canRetryWithDeviceTokenHint &&
          isTrustedRetryEndpoint(this.opts.url);
        if (shouldRetryWithDeviceToken) {
          this.pendingDeviceTokenRetry = true;
          this.deviceTokenRetryBudgetUsed = true;
        }
        if (err instanceof GatewayRequestError) {
          this.pendingConnectError = {
            code: err.gatewayCode,
            message: err.message,
            details: err.details,
          };
        } else {
          this.pendingConnectError = undefined;
        }
        if (
          deviceIdentity &&
          deviceToken &&
          connectErrorCode === ConnectErrorDetailCodes.AUTH_DEVICE_TOKEN_MISMATCH
        ) {
          try {
            clearDeviceAuthToken({ deviceId: deviceIdentity.deviceId, role });
          } catch {
            // Best effort: a stale token must not keep the connection flow stuck.
          }
        }
        this.ws?.close(CONNECT_FAILED_CLOSE_CODE, "connect failed");
      });
  }

  private handleMessage(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const frame = parsed as { type?: unknown };
    if (frame.type === "event") {
      const evt = parsed as GatewayEventFrame;
      if (evt.event === "connect.challenge") {
        const payload = evt.payload as { nonce?: unknown } | undefined;
        const nonce = payload && typeof payload.nonce === "string" ? payload.nonce : null;
        if (nonce) {
          this.connectNonce = nonce;
          void this.sendConnect();
        }
        return;
      }
      const seq = typeof evt.seq === "number" ? evt.seq : null;
      if (seq !== null) {
        if (this.lastSeq !== null && seq > this.lastSeq + 1) {
          this.opts.onGap?.({ expected: this.lastSeq + 1, received: seq });
        }
        this.lastSeq = seq;
      }
      if (evt.event === "tick") {
        this.lastTick = Date.now();
      }
      try {
        this.opts.onEvent?.(evt);
      } catch (err) {
        console.error("[gateway] event handler error:", err);
      }
      return;
    }

    if (frame.type === "res") {
      const res = parsed as GatewayResponseFrame;
      const pending = this.pending.get(res.id);
      if (!pending) {
        return;
      }
      this.pending.delete(res.id);
      if (res.ok) {
        pending.resolve(res.payload);
      } else {
        pending.reject(
          new GatewayRequestError({
            code: res.error?.code ?? "UNAVAILABLE",
            message: res.error?.message ?? "request failed",
            details: res.error?.details,
          }),
        );
      }
      return;
    }
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    // Transport OPEN precedes authenticated hello. Never send business traffic in that window.
    if (method !== "connect" && !this.connected) {
      return Promise.reject(new Error("gateway not connected"));
    }
    if (method !== "connect" && this.needsLocalSurfaceRebind()) {
      this.scheduleReconnect();
      return Promise.reject(
        new Error("gateway rebinding for Control UI surface change; please retry"),
      );
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway not connected"));
    }
    const id = generateUUID();
    const frame = { type: "req", id, method, params };
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
    });
    this.ws.send(JSON.stringify(frame));
    return p;
  }

  private needsLocalSurfaceRebind(): boolean {
    if (typeof location === "undefined") {
      return false;
    }
    const nextPath = location.pathname;
    const prev = this.connectedPagePath ?? "";
    return (
      resolveLocalControlUiSurfaceFromPathname(prev) !==
      resolveLocalControlUiSurfaceFromPathname(nextPath)
    );
  }

  private queueConnect() {
    this.connectNonce = null;
    this.connectSent = false;
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
    }
    this.connectTimer = window.setTimeout(() => {
      void this.sendConnect();
    }, 750);
  }
}
