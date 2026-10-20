import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Security regression suite for the POST /tools/invoke operator boundary.
//
// The endpoint is an operator / automation surface (loopback CLI, the Fabric
// loopback invoker, shared-secret / token automation). It must NOT be usable by
// a remote identity-scoped session (a platform-auth browser cookie or a
// reverse-proxy forwarded trusted-proxy user), because the request body can name
// an arbitrary `sessionKey` and the handler builds tools bound to that session —
// which would let any logged-in tenant user act against another agent's / tenant's
// session. See the guard in tools-invoke-http.ts.

const TEST_GATEWAY_TOKEN = "test-gateway-token-session-guard";

type AuthResultLike = {
  ok: boolean;
  method?: "none" | "token" | "password" | "tailscale" | "device-token" | "trusted-proxy";
  trustedProxy?: {
    provider?: "trusted-proxy";
    user?: string;
    domain?: "platform" | "enterprise" | "employee";
    enterpriseId?: string;
    membershipId?: string;
  };
};

const { authState, localDirectState, toolState } = vi.hoisted(() => ({
  authState: { current: { ok: true } as AuthResultLike },
  localDirectState: { current: false },
  toolState: {
    builtContext: undefined as Record<string, unknown> | undefined,
    executed: false,
  },
}));

let cfg: Record<string, unknown> = {};

vi.mock("../config/config.js", () => ({
  loadConfig: () => cfg,
}));

vi.mock("../config/sessions.js", () => ({
  resolveMainSessionKey: () => "agent:main:main",
}));

// Both exports are controllable so each test can set the auth method and whether
// the caller is loopback-direct independently.
vi.mock("./auth.js", () => ({
  authorizeHttpGatewayConnect: async () => authState.current,
  isLocalDirectRequest: () => localDirectState.current,
}));

vi.mock("./governance/shadow-sink.js", () => ({
  appendGovernanceShadowDecision: async () => true,
}));

vi.mock("../logger.js", () => ({
  logWarn: () => {},
}));

vi.mock("../plugins/config-state.js", () => ({
  isTestDefaultMemorySlotDisabled: () => false,
}));

vi.mock("../plugins/tools.js", () => ({
  getPluginToolMeta: () => undefined,
}));

// `createOpenClawTools` is only reached once the request has cleared the operator
// guard, so recording whether it ran is a precise signal of whether the guard
// allowed the request through.
vi.mock("../agents/openclaw-tools.js", () => ({
  createOpenClawTools: (ctx: Record<string, unknown>) => {
    toolState.builtContext = ctx;
    return [
      {
        name: "probe",
        parameters: { type: "object", properties: {} },
        execute: async () => {
          toolState.executed = true;
          return { ok: true };
        },
      },
    ];
  },
}));

const { handleToolsInvokeHttpRequest } = await import("./tools-invoke-http.js");

let sharedPort = 0;
let sharedServer: ReturnType<typeof createServer> | undefined;

beforeAll(async () => {
  sharedServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const handled = await handleToolsInvokeHttpRequest(req, res, {
        auth: { mode: "token", token: TEST_GATEWAY_TOKEN, allowTailscale: false },
      });
      if (handled) {
        return;
      }
      res.statusCode = 404;
      res.end("not found");
    })().catch((err) => {
      res.statusCode = 500;
      res.end(String(err));
    });
  });

  await new Promise<void>((resolve, reject) => {
    sharedServer?.once("error", reject);
    sharedServer?.listen(0, "127.0.0.1", () => {
      const address = sharedServer?.address() as AddressInfo | null;
      sharedPort = address?.port ?? 0;
      resolve();
    });
  });
});

afterAll(async () => {
  const server = sharedServer;
  if (!server) {
    return;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  sharedServer = undefined;
});

beforeEach(() => {
  authState.current = { ok: true };
  localDirectState.current = false;
  cfg = {};
  toolState.builtContext = undefined;
  toolState.executed = false;
});

const postToolsInvoke = async (body: Record<string, unknown>) =>
  await fetch(`http://127.0.0.1:${sharedPort}/tools/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const remotePlatformSession = (): AuthResultLike => ({
  ok: true,
  method: "trusted-proxy",
  trustedProxy: {
    provider: "trusted-proxy",
    user: "employee@tenant-a.example",
    domain: "employee",
    enterpriseId: "tenant-a",
    membershipId: "membership-a",
  },
});

describe("POST /tools/invoke operator boundary", () => {
  it("rejects a remote platform session that names another agent's sessionKey", async () => {
    authState.current = remotePlatformSession();
    localDirectState.current = false;

    const res = await postToolsInvoke({
      tool: "probe",
      args: {},
      sessionKey: "agent:other-tenant-agent:main",
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: { type: "forbidden" },
    });
    // The guard fires before any tool is built or executed.
    expect(toolState.builtContext).toBeUndefined();
    expect(toolState.executed).toBe(false);
  });

  it("rejects a remote platform session even without an explicit sessionKey", async () => {
    authState.current = remotePlatformSession();
    localDirectState.current = false;

    const res = await postToolsInvoke({ tool: "probe", args: {} });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: { type: "forbidden" } });
    expect(toolState.builtContext).toBeUndefined();
  });

  it("allows a loopback-direct caller (local operator / Fabric loopback invoker)", async () => {
    // Loopback operator adopts a platform identity but is a trusted local caller.
    authState.current = remotePlatformSession();
    localDirectState.current = true;

    const res = await postToolsInvoke({
      tool: "probe",
      args: {},
      sessionKey: "agent:other-tenant-agent:main",
    });

    expect(res.status).not.toBe(403);
    // Reached tool construction with the caller-supplied sessionKey (operators may
    // target any session).
    expect(toolState.builtContext).toBeDefined();
    expect(toolState.builtContext?.agentSessionKey).toBe("agent:other-tenant-agent:main");
  });

  it("allows a shared-secret token operator even when not loopback-direct", async () => {
    authState.current = { ok: true, method: "token" };
    localDirectState.current = false;

    const res = await postToolsInvoke({
      tool: "probe",
      args: {},
      sessionKey: "agent:other-tenant-agent:main",
    });

    expect(res.status).not.toBe(403);
    expect(toolState.builtContext).toBeDefined();
  });

  it("allows auth.mode=none (personal / local single-operator) callers", async () => {
    authState.current = { ok: true, method: "none" };
    localDirectState.current = false;

    const res = await postToolsInvoke({ tool: "probe", args: {} });

    expect(res.status).not.toBe(403);
    expect(toolState.builtContext).toBeDefined();
  });
});
