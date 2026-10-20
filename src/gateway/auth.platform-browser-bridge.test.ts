import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authorizeHttpGatewayConnect,
  authorizeWsControlUiGatewayConnect,
  resolveControlUiBrowserAuthMode,
  resolveGatewayAuth,
} from "./auth.js";
import { CONTROL_UI_BOOTSTRAP_CONFIG_PATH } from "./control-ui-contract.js";
import { handleControlUiPlatformAuthRequest } from "./platform-auth.js";
import {
  CONTROL_UI_CLIENT,
  connectReq,
  openWs,
  testState,
  withGatewayServer,
  writeTrustedProxyControlUiConfig,
} from "./server.auth.shared.js";
import { makeMockHttpResponse } from "./test-http-response.js";

function makeJsonRequest(params: {
  url: string;
  method: "POST" | "GET";
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}): IncomingMessage {
  const body = params.body ? JSON.stringify(params.body) : "";
  const req = Readable.from(body ? [body] : []) as IncomingMessage;
  Object.assign(req, {
    url: params.url,
    method: params.method,
    headers: params.headers ?? {},
  });
  Object.defineProperty(req, "socket", {
    value: { remoteAddress: "127.0.0.1" },
    configurable: true,
  });
  return req;
}

function getPrimarySetCookie(
  setHeader: ReturnType<typeof makeMockHttpResponse>["setHeader"],
): string | undefined {
  const raw = setHeader.mock.calls.find((call) => call[0] === "Set-Cookie")?.[1];
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw.find((value): value is string => typeof value === "string" && value.includes("="));
  }
  return undefined;
}

describe("platform browser auth bridge (token mode + platform session)", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-bridge-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  const trustedProxy = () => ({
    userHeader: "x-forwarded-user",
    platformAuth: {
      enabled: true,
      requireMfaForPlatformAdmins: false,
      store: path.join(tempDir, "platform-auth.json"),
    },
  });

  async function bootstrapPlatformAdmin(): Promise<string> {
    const registerReq = makeJsonRequest({
      url: "/__openbot/platform-auth/platform/bootstrap",
      method: "POST",
      headers: { host: "127.0.0.1:18789" },
      body: {
        email: "alice@example.com",
        password: "password-123",
        displayName: "Alice",
      },
    });
    const { res, setHeader, end } = makeMockHttpResponse();
    const handled = await handleControlUiPlatformAuthRequest(registerReq, res, {
      trustedProxy: trustedProxy(),
      localDirect: true,
    });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toMatchObject({ ok: true });
    const sessionCookie = getPrimarySetCookie(setHeader);
    expect(typeof sessionCookie).toBe("string");
    return String(sessionCookie).split(";")[0];
  }

  it("defaults gateway auth mode to trusted-proxy when platform auth is enabled and mode is unset", () => {
    const resolved = resolveGatewayAuth({
      authConfig: {
        trustedProxy: trustedProxy(),
      },
    });
    expect(resolved.mode).toBe("trusted-proxy");
    expect(resolved.modeSource).toBe("platform-auth");
  });

  it("reports browser auth mode as trusted-proxy while gateway remains on token for CLI", () => {
    const resolved = resolveGatewayAuth({
      authConfig: {
        mode: "token",
        token: "secret",
        trustedProxy: trustedProxy(),
      },
    });
    expect(resolved.mode).toBe("token");
    expect(resolveControlUiBrowserAuthMode(resolved)).toBe("trusted-proxy");
  });

  it("authorizes WS control-ui via platform cookie without gateway token when mode is token", async () => {
    const cookie = await bootstrapPlatformAdmin();
    const req = {
      url: "/",
      method: "GET",
      headers: {
        host: "127.0.0.1:18789",
        cookie,
      },
      socket: { remoteAddress: "127.0.0.1" },
    } as IncomingMessage;

    const authResult = await authorizeWsControlUiGatewayConnect({
      auth: {
        mode: "token",
        allowTailscale: false,
        token: "secret",
        trustedProxy: trustedProxy(),
      },
      connectAuth: null,
      req,
      trustedProxies: ["127.0.0.1"],
    });

    expect(authResult.ok).toBe(true);
    expect(authResult.method).toBe("trusted-proxy");
    expect(authResult.trustedProxy).toMatchObject({
      user: "alice@example.com",
      role: "operator",
    });
  });

  it("authorizes HTTP bootstrap via platform cookie without gateway token when mode is token", async () => {
    const cookie = await bootstrapPlatformAdmin();
    const req = {
      url: CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
      method: "GET",
      headers: {
        host: "127.0.0.1:18789",
        cookie,
      },
      socket: { remoteAddress: "127.0.0.1" },
    } as IncomingMessage;

    const authResult = await authorizeHttpGatewayConnect({
      auth: {
        mode: "token",
        allowTailscale: false,
        token: "secret",
        trustedProxy: trustedProxy(),
      },
      connectAuth: null,
      req,
      trustedProxies: ["127.0.0.1"],
    });

    expect(authResult.ok).toBe(true);
    expect(authResult.method).toBe("trusted-proxy");
    expect(authResult.trustedProxy?.user).toBe("alice@example.com");
  });

  it("still requires gateway token for WS when platform session is absent", async () => {
    const req = {
      url: "/",
      method: "GET",
      headers: { host: "127.0.0.1:18789" },
      socket: { remoteAddress: "127.0.0.1" },
    } as IncomingMessage;

    const authResult = await authorizeWsControlUiGatewayConnect({
      auth: {
        mode: "token",
        allowTailscale: false,
        token: "secret",
        trustedProxy: trustedProxy(),
      },
      connectAuth: null,
      req,
      trustedProxies: ["127.0.0.1"],
    });

    expect(authResult.ok).toBe(false);
    expect(authResult.reason).toBe("token_missing");
  });

  it("prefers platform session over an invalid gateway token on WS control-ui", async () => {
    const cookie = await bootstrapPlatformAdmin();
    const req = {
      url: "/",
      method: "GET",
      headers: {
        host: "127.0.0.1:18789",
        cookie,
      },
      socket: { remoteAddress: "127.0.0.1" },
    } as IncomingMessage;

    const authResult = await authorizeWsControlUiGatewayConnect({
      auth: {
        mode: "token",
        allowTailscale: false,
        token: "secret",
        trustedProxy: trustedProxy(),
      },
      connectAuth: { token: "wrong-token" },
      req,
      trustedProxies: ["127.0.0.1"],
    });

    expect(authResult.ok).toBe(true);
    expect(authResult.method).toBe("trusted-proxy");
    expect(authResult.trustedProxy?.user).toBe("alice@example.com");
  });
});

describe("gateway server WS bridge (token mode + platform cookie)", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-platform-ws-bridge-"));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("connects control-ui over WS without gateway token after platform login", async () => {
    const trustedProxyConfig = {
      userHeader: "x-forwarded-user",
      platformAuth: {
        enabled: true,
        requireMfaForPlatformAdmins: false,
        store: path.join(tempDir, "platform-auth.json"),
      },
    };
    const registerReq = makeJsonRequest({
      url: "/__openbot/platform-auth/platform/bootstrap",
      method: "POST",
      headers: { host: "127.0.0.1:18789" },
      body: {
        email: "alice@example.com",
        password: "password-123",
        displayName: "Alice",
      },
    });
    const bootstrapRes = makeMockHttpResponse();
    await handleControlUiPlatformAuthRequest(registerReq, bootstrapRes.res, {
      trustedProxy: trustedProxyConfig,
      localDirect: true,
    });
    const sessionCookie = getPrimarySetCookie(bootstrapRes.setHeader);
    expect(typeof sessionCookie).toBe("string");

    testState.gatewayAuth = {
      mode: "token",
      token: "secret",
      trustedProxy: trustedProxyConfig,
    };
    await writeTrustedProxyControlUiConfig();

    await withGatewayServer(async ({ port }) => {
      const ws = await openWs(port, {
        origin: "https://localhost",
        cookie: String(sessionCookie).split(";")[0],
      });
      const res = await connectReq(ws, {
        skipDefaultAuth: true,
        device: null,
        client: { ...CONTROL_UI_CLIENT },
      });
      expect(res.ok).toBe(true);
      const payload = res.payload as {
        auth?: { provider?: string; user?: string };
      };
      expect(payload.auth).toMatchObject({
        provider: "trusted-proxy",
        user: "alice@example.com",
      });
      ws.close();
    });
  });

  it("reconnects control-ui WS with the same platform cookie after close", async () => {
    const trustedProxyConfig = {
      userHeader: "x-forwarded-user",
      platformAuth: {
        enabled: true,
        requireMfaForPlatformAdmins: false,
        store: path.join(tempDir, "platform-auth.json"),
      },
    };
    const registerReq = makeJsonRequest({
      url: "/__openbot/platform-auth/platform/bootstrap",
      method: "POST",
      headers: { host: "127.0.0.1:18789" },
      body: {
        email: "alice@example.com",
        password: "password-123",
        displayName: "Alice",
      },
    });
    const bootstrapRes = makeMockHttpResponse();
    await handleControlUiPlatformAuthRequest(registerReq, bootstrapRes.res, {
      trustedProxy: trustedProxyConfig,
      localDirect: true,
    });
    const sessionCookie = String(getPrimarySetCookie(bootstrapRes.setHeader)).split(";")[0];

    testState.gatewayAuth = {
      mode: "token",
      token: "secret",
      trustedProxy: trustedProxyConfig,
    };
    await writeTrustedProxyControlUiConfig();

    await withGatewayServer(
      async ({ port }) => {
        const connectOnce = async () => {
          const ws = await openWs(port, {
            origin: "https://localhost",
            cookie: sessionCookie,
          });
          const res = await connectReq(ws, {
            skipDefaultAuth: true,
            device: null,
            client: { ...CONTROL_UI_CLIENT },
          });
          expect(res.ok).toBe(true);
          ws.close();
          await new Promise<void>((resolve) => ws.once("close", () => resolve()));
        };
        await connectOnce();
        await connectOnce();
      },
      { serverOptions: { controlUiEnabled: true } },
    );
  });

  it("serves bootstrap authSession from running gateway HTTP when mode is token", async () => {
    const trustedProxyConfig = {
      userHeader: "x-forwarded-user",
      platformAuth: {
        enabled: true,
        requireMfaForPlatformAdmins: false,
        store: path.join(tempDir, "platform-auth-rebootstrap.json"),
      },
    };
    const registerReq = makeJsonRequest({
      url: "/__openbot/platform-auth/platform/bootstrap",
      method: "POST",
      headers: { host: "127.0.0.1:18789" },
      body: {
        email: "alice@example.com",
        password: "password-123",
        displayName: "Alice",
      },
    });
    const bootstrapRes = makeMockHttpResponse();
    await handleControlUiPlatformAuthRequest(registerReq, bootstrapRes.res, {
      trustedProxy: trustedProxyConfig,
      localDirect: true,
    });
    const sessionCookie = String(getPrimarySetCookie(bootstrapRes.setHeader)).split(";")[0];

    testState.gatewayAuth = {
      mode: "token",
      token: "secret",
      trustedProxy: trustedProxyConfig,
    };
    await writeTrustedProxyControlUiConfig();

    await withGatewayServer(
      async ({ port }) => {
        const res = await fetch(`http://127.0.0.1:${port}${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`, {
          headers: {
            cookie: sessionCookie,
            host: "127.0.0.1:18789",
          },
        });
        expect(res.status).toBe(200);
        const parsed = (await res.json()) as {
          authMode?: string;
          authSession?: { user?: string; provider?: string };
          platformAuth?: { sessionKind?: string };
        };
        expect(parsed.authMode).toBe("trusted-proxy");
        expect(parsed.authSession).toMatchObject({
          provider: "trusted-proxy",
          user: "alice@example.com",
        });
        expect(parsed.platformAuth?.sessionKind).toBe("platform-super-admin");
      },
      { serverOptions: { controlUiEnabled: true } },
    );
  });
});
