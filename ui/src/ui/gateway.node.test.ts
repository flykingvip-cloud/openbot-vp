/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDeviceAuthToken, storeDeviceAuthToken } from "./device-auth.ts";
import type { DeviceIdentity } from "./device-identity.ts";

const wsInstances = vi.hoisted((): MockWebSocket[] => []);
const loadOrCreateDeviceIdentityMock = vi.hoisted(() =>
  vi.fn(
    async (): Promise<DeviceIdentity> => ({
      deviceId: "device-1",
      privateKey: "private-key", // pragma: allowlist secret
      publicKey: "public-key", // pragma: allowlist secret
    }),
  ),
);
const signDevicePayloadMock = vi.hoisted(() =>
  vi.fn(async (_privateKeyBase64Url: string, _payload: string) => "signature"),
);

type HandlerMap = {
  close: MockWebSocketHandler[];
  error: MockWebSocketHandler[];
  message: MockWebSocketHandler[];
  open: MockWebSocketHandler[];
};

type MockWebSocketHandler = (ev?: { code?: number; data?: string; reason?: string }) => void;

class MockWebSocket {
  static OPEN = 1;

  readonly handlers: HandlerMap = {
    close: [],
    error: [],
    message: [],
    open: [],
  };

  readonly sent: string[] = [];
  readyState = MockWebSocket.OPEN;

  constructor(_url: string) {
    wsInstances.push(this);
  }

  addEventListener(type: keyof HandlerMap, handler: MockWebSocketHandler) {
    this.handlers[type].push(handler);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  emitClose(code = 1000, reason = "") {
    for (const handler of this.handlers.close) {
      handler({ code, reason });
    }
  }

  emitOpen() {
    for (const handler of this.handlers.open) {
      handler();
    }
  }

  emitMessage(data: unknown) {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    for (const handler of this.handlers.message) {
      handler({ data: payload });
    }
  }
}

vi.mock("./device-identity.ts", () => ({
  loadOrCreateDeviceIdentity: loadOrCreateDeviceIdentityMock,
  signDevicePayload: signDevicePayloadMock,
}));

const { GatewayBrowserClient, setGatewayBrowserClientTestHooks } = await import("./gateway.ts");

function getLatestWebSocket(): MockWebSocket {
  const ws = wsInstances.at(-1);
  if (!ws) {
    throw new Error("missing websocket instance");
  }
  return ws;
}

describe("GatewayBrowserClient", () => {
  beforeEach(() => {
    wsInstances.length = 0;
    loadOrCreateDeviceIdentityMock.mockReset();
    signDevicePayloadMock.mockClear();
    loadOrCreateDeviceIdentityMock.mockResolvedValue({
      deviceId: "device-1",
      privateKey: "private-key", // pragma: allowlist secret
      publicKey: "public-key", // pragma: allowlist secret
    });

    window.localStorage.clear();
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("crypto", {
      subtle: {},
      getRandomValues: (array: Uint8Array) => array,
    } as Crypto);
    setGatewayBrowserClientTestHooks({
      loadOrCreateDeviceIdentity: loadOrCreateDeviceIdentityMock,
      signDevicePayload: signDevicePayloadMock,
    });

    storeDeviceAuthToken({
      deviceId: "device-1",
      role: "operator",
      token: "stored-device-token",
      scopes: ["operator.admin", "operator.approvals", "operator.pairing"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    setGatewayBrowserClientTestHooks(null);
    vi.unstubAllGlobals();
  });

  it("prefers explicit shared auth over cached device tokens", async () => {
    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:18789",
      token: "shared-auth-token",
    });

    client.start();
    const ws = getLatestWebSocket();
    ws.emitOpen();
    ws.emitMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-1" },
    });
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));

    const connectFrame = JSON.parse(ws.sent.at(-1) ?? "{}") as {
      id?: string;
      method?: string;
      params?: { auth?: { token?: string } };
    };
    expect(typeof connectFrame.id).toBe("string");
    expect(connectFrame.method).toBe("connect");
    expect(connectFrame.params?.auth?.token).toBe("shared-auth-token");
    expect(signDevicePayloadMock).toHaveBeenCalledWith("private-key", expect.any(String));
    const signedPayload = signDevicePayloadMock.mock.calls[0]?.[1];
    expect(signedPayload).toContain("|shared-auth-token|nonce-1");
    expect(signedPayload).not.toContain("stored-device-token");
  });

  it("uses cached device tokens only when no explicit shared auth is provided", async () => {
    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:18789",
    });

    client.start();
    const ws = getLatestWebSocket();
    ws.emitOpen();
    ws.emitMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-1" },
    });
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));

    const connectFrame = JSON.parse(ws.sent.at(-1) ?? "{}") as {
      id?: string;
      method?: string;
      params?: { auth?: { token?: string } };
    };
    expect(typeof connectFrame.id).toBe("string");
    expect(connectFrame.method).toBe("connect");
    expect(connectFrame.params?.auth?.token).toBe("stored-device-token");
    expect(signDevicePayloadMock).toHaveBeenCalledWith("private-key", expect.any(String));
    const signedPayload = signDevicePayloadMock.mock.calls[0]?.[1];
    expect(signedPayload).toContain("|stored-device-token|nonce-1");
  });

  it("uses trusted proxy session role and scopes in the initial signed connect", async () => {
    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:18789",
      trustedProxySession: {
        provider: "trusted-proxy",
        user: "alice@example.com",
        role: "operator",
        scopes: ["operator.read", "operator.approvals"],
      },
    });

    client.start();
    const ws = getLatestWebSocket();
    ws.emitOpen();
    ws.emitMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-1" },
    });
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));

    const connectFrame = JSON.parse(ws.sent.at(-1) ?? "{}") as {
      params?: { role?: string; scopes?: string[]; user?: string };
    };
    expect(connectFrame.params?.role).toBe("operator");
    expect(connectFrame.params?.scopes).toEqual(["operator.read", "operator.approvals"]);
    expect(connectFrame.params?.user).toBe("alice@example.com");
    const signedPayload = signDevicePayloadMock.mock.calls[0]?.[1];
    expect(signedPayload).toContain("|operator|operator.read,operator.approvals|");
  });

  it("does not advertise tool-events unless explicitly enabled", async () => {
    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:18789",
    });

    client.start();
    const ws = getLatestWebSocket();
    ws.emitOpen();
    ws.emitMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-1" },
    });
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));

    const connectFrame = JSON.parse(ws.sent.at(-1) ?? "{}") as {
      params?: { caps?: string[] };
    };
    expect(connectFrame.params?.caps).toBeUndefined();

    const clientWithCaps = new GatewayBrowserClient({
      url: "ws://127.0.0.1:18789",
      caps: ["tool-events"],
    });

    clientWithCaps.start();
    const wsWithCaps = getLatestWebSocket();
    wsWithCaps.emitOpen();
    wsWithCaps.emitMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-2" },
    });
    await vi.waitFor(() => expect(wsWithCaps.sent.length).toBeGreaterThan(0));

    const connectFrameWithCaps = JSON.parse(wsWithCaps.sent.at(-1) ?? "{}") as {
      params?: { caps?: string[] };
    };
    expect(connectFrameWithCaps.params?.caps).toEqual(["tool-events"]);
  });

  it("retries once with device token after token mismatch when shared token is explicit", async () => {
    vi.useFakeTimers();
    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:18789",
      token: "shared-auth-token",
    });

    client.start();
    const ws1 = getLatestWebSocket();
    ws1.emitOpen();
    ws1.emitMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-1" },
    });
    await vi.waitFor(() => expect(ws1.sent.length).toBeGreaterThan(0));
    const firstConnect = JSON.parse(ws1.sent.at(-1) ?? "{}") as {
      id: string;
      params?: { auth?: { token?: string; deviceToken?: string } };
    };
    expect(firstConnect.params?.auth?.token).toBe("shared-auth-token");
    expect(firstConnect.params?.auth?.deviceToken).toBeUndefined();

    ws1.emitMessage({
      type: "res",
      id: firstConnect.id,
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "unauthorized",
        details: { code: "AUTH_TOKEN_MISMATCH", canRetryWithDeviceToken: true },
      },
    });
    await vi.waitFor(() => expect(ws1.readyState).toBe(3));
    ws1.emitClose(4008, "connect failed");

    await vi.advanceTimersByTimeAsync(800);
    const ws2 = getLatestWebSocket();
    expect(ws2).not.toBe(ws1);
    ws2.emitOpen();
    ws2.emitMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-2" },
    });
    await vi.waitFor(() => expect(ws2.sent.length).toBeGreaterThan(0));
    const secondConnect = JSON.parse(ws2.sent.at(-1) ?? "{}") as {
      id: string;
      params?: { auth?: { token?: string; deviceToken?: string } };
    };
    expect(secondConnect.params?.auth?.token).toBe("shared-auth-token");
    expect(secondConnect.params?.auth?.deviceToken).toBe("stored-device-token");

    ws2.emitMessage({
      type: "res",
      id: secondConnect.id,
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "unauthorized",
        details: { code: "AUTH_TOKEN_MISMATCH" },
      },
    });
    await vi.waitFor(() => expect(ws2.readyState).toBe(3));
    ws2.emitClose(4008, "connect failed");
    expect(loadDeviceAuthToken({ deviceId: "device-1", role: "operator" })?.token).toBe(
      "stored-device-token",
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(wsInstances).toHaveLength(2);

    vi.useRealTimers();
  });

  it("treats IPv6 loopback as trusted for bounded device-token retry", async () => {
    vi.useFakeTimers();
    const client = new GatewayBrowserClient({
      url: "ws://[::1]:18789",
      token: "shared-auth-token",
    });

    client.start();
    const ws1 = getLatestWebSocket();
    ws1.emitOpen();
    ws1.emitMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-1" },
    });
    await vi.waitFor(() => expect(ws1.sent.length).toBeGreaterThan(0));
    const firstConnect = JSON.parse(ws1.sent.at(-1) ?? "{}") as {
      id: string;
      params?: { auth?: { token?: string; deviceToken?: string } };
    };
    expect(firstConnect.params?.auth?.token).toBe("shared-auth-token");
    expect(firstConnect.params?.auth?.deviceToken).toBeUndefined();

    ws1.emitMessage({
      type: "res",
      id: firstConnect.id,
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "unauthorized",
        details: { code: "AUTH_TOKEN_MISMATCH", canRetryWithDeviceToken: true },
      },
    });
    await vi.waitFor(() => expect(ws1.readyState).toBe(3));
    ws1.emitClose(4008, "connect failed");

    await vi.advanceTimersByTimeAsync(800);
    const ws2 = getLatestWebSocket();
    expect(ws2).not.toBe(ws1);
    ws2.emitOpen();
    ws2.emitMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-2" },
    });
    await vi.waitFor(() => expect(ws2.sent.length).toBeGreaterThan(0));
    const secondConnect = JSON.parse(ws2.sent.at(-1) ?? "{}") as {
      params?: { auth?: { token?: string; deviceToken?: string } };
    };
    expect(secondConnect.params?.auth?.token).toBe("shared-auth-token");
    expect(secondConnect.params?.auth?.deviceToken).toBe("stored-device-token");

    client.stop();
    vi.useRealTimers();
  });

  it("continues reconnecting on first token mismatch when no retry was attempted", async () => {
    vi.useFakeTimers();
    window.localStorage.clear();

    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:18789",
      token: "shared-auth-token",
    });

    client.start();
    const ws1 = getLatestWebSocket();
    ws1.emitOpen();
    ws1.emitMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-1" },
    });
    await vi.waitFor(() => expect(ws1.sent.length).toBeGreaterThan(0));
    const firstConnect = JSON.parse(ws1.sent.at(-1) ?? "{}") as { id: string };

    ws1.emitMessage({
      type: "res",
      id: firstConnect.id,
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "unauthorized",
        details: { code: "AUTH_TOKEN_MISMATCH" },
      },
    });
    await vi.waitFor(() => expect(ws1.readyState).toBe(3));
    ws1.emitClose(4008, "connect failed");

    await vi.advanceTimersByTimeAsync(800);
    expect(wsInstances).toHaveLength(2);

    client.stop();
    vi.useRealTimers();
  });

  it("clears stale cached device token after explicit device-token mismatch", async () => {
    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:18789",
    });

    client.start();
    const ws = getLatestWebSocket();
    ws.emitOpen();
    ws.emitMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-1" },
    });
    await vi.waitFor(() => expect(ws.sent.length).toBeGreaterThan(0));
    const connect = JSON.parse(ws.sent.at(-1) ?? "{}") as {
      id: string;
      params?: { auth?: { deviceToken?: string } };
    };
    expect(connect.params?.auth?.deviceToken).toBe("stored-device-token");

    ws.emitMessage({
      type: "res",
      id: connect.id,
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "unauthorized: device token mismatch",
        details: { code: "AUTH_DEVICE_TOKEN_MISMATCH" },
      },
    });
    await vi.waitFor(() => expect(ws.readyState).toBe(3));

    expect(loadDeviceAuthToken({ deviceId: "device-1", role: "operator" })).toBeNull();
    client.stop();
  });

  it("clears stale cached device token when the close reason reports mismatch", async () => {
    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:18789",
    });

    client.start();
    const ws = getLatestWebSocket();
    ws.emitClose(1008, "unauthorized: device token mismatch (rotate/reissue device token)");

    await vi.waitFor(() =>
      expect(loadDeviceAuthToken({ deviceId: "device-1", role: "operator" })).toBeNull(),
    );
    client.stop();
  });

  it("auto-reconnects on AUTH_TRUSTED_PROXY_USER_MISSING (transient cookie/session gap)", async () => {
    vi.useFakeTimers();
    window.localStorage.clear();

    const onClose = vi.fn();
    const client = new GatewayBrowserClient({
      url: "wss://www.openbot.love",
      onClose,
    });

    client.start();
    const ws1 = getLatestWebSocket();
    ws1.emitOpen();
    ws1.emitMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-1" },
    });
    await vi.waitFor(() => expect(ws1.sent.length).toBeGreaterThan(0));
    const connect = JSON.parse(ws1.sent.at(-1) ?? "{}") as { id: string };

    ws1.emitMessage({
      type: "res",
      id: connect.id,
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message:
          "unauthorized: platform session missing (sign in through platform or enterprise login, then refresh)",
        details: { code: "AUTH_TRUSTED_PROXY_USER_MISSING" },
      },
    });
    await vi.waitFor(() => expect(ws1.readyState).toBe(3));
    ws1.emitClose(4008, "connect failed");

    expect(onClose).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          details: expect.objectContaining({ code: "AUTH_TRUSTED_PROXY_USER_MISSING" }),
        }),
      }),
    );

    // Cookie/session gaps are recoverable — schedule reconnect instead of sticky stop.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(wsInstances.length).toBeGreaterThan(1);

    vi.useRealTimers();
    client.stop();
  });

  it("auto-reconnects after a 1006 transport close without an auth error", async () => {
    vi.useFakeTimers();

    const client = new GatewayBrowserClient({
      url: "wss://www.openbot.love",
    });

    client.start();
    const ws1 = getLatestWebSocket();
    ws1.emitClose(1006, "");

    await vi.advanceTimersByTimeAsync(800);
    expect(wsInstances).toHaveLength(2);

    vi.useRealTimers();
    client.stop();
  });

  it("auto-reconnects after a 1012 service-restart close without an auth error", async () => {
    vi.useFakeTimers();

    const client = new GatewayBrowserClient({
      url: "wss://www.openbot.love",
    });

    client.start();
    const ws1 = getLatestWebSocket();
    ws1.emitClose(1012, "service restart");

    await vi.advanceTimersByTimeAsync(800);
    expect(wsInstances).toHaveLength(2);

    vi.useRealTimers();
    client.stop();
  });

  it("does not auto-reconnect on AUTH_TOKEN_MISSING", async () => {
    vi.useFakeTimers();
    window.localStorage.clear();

    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:18789",
    });

    client.start();
    const ws1 = getLatestWebSocket();
    ws1.emitOpen();
    ws1.emitMessage({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "nonce-1" },
    });
    await vi.waitFor(() => expect(ws1.sent.length).toBeGreaterThan(0));
    const connect = JSON.parse(ws1.sent.at(-1) ?? "{}") as { id: string };

    ws1.emitMessage({
      type: "res",
      id: connect.id,
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "unauthorized",
        details: { code: "AUTH_TOKEN_MISSING" },
      },
    });
    await vi.waitFor(() => expect(ws1.readyState).toBe(3));
    ws1.emitClose(4008, "connect failed");

    await vi.advanceTimersByTimeAsync(30_000);
    expect(wsInstances).toHaveLength(1);

    vi.useRealTimers();
  });

  it("rewrites the gateway URL via onReconnectUrl before retrying transport failures", async () => {
    vi.useFakeTimers();
    const client = new GatewayBrowserClient({
      url: "wss://www.openbot.love",
      onReconnectUrl: (currentUrl) =>
        currentUrl === "wss://www.openbot.love" ? "wss://biz.openbot.love" : null,
    });

    client.start();
    const ws1 = getLatestWebSocket();
    ws1.emitClose(1006, "");

    await vi.advanceTimersByTimeAsync(900);
    expect(wsInstances).toHaveLength(2);
    expect(wsInstances[1]).toBeDefined();

    vi.useRealTimers();
    client.stop();
  });

  it("ignores close events from a replaced socket after reconnect", async () => {
    vi.useFakeTimers();
    const client = new GatewayBrowserClient({
      url: "ws://127.0.0.1:18789",
    });

    client.start();
    const ws1 = getLatestWebSocket();
    ws1.emitOpen();
    ws1.emitClose(1006, "");

    await vi.advanceTimersByTimeAsync(800);
    const ws2 = getLatestWebSocket();
    expect(ws2).not.toBe(ws1);
    expect(wsInstances).toHaveLength(2);
    ws2.emitOpen();
    expect(client.connected).toBe(true);

    ws1.emitClose(1006, "");
    expect(client.connected).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(wsInstances).toHaveLength(2);

    vi.useRealTimers();
    client.stop();
  });
});
