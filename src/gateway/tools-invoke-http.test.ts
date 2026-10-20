import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readExecutionTraces,
  resetExecutionTraceForTest,
} from "../agents/execution-preflight/trace.js";

const TEST_GATEWAY_TOKEN = "test-gateway-token-1234567890";

const { appendGovernanceShadowDecisionMock, gatewayAuthResult } = vi.hoisted(() => ({
  appendGovernanceShadowDecisionMock: vi.fn(async (_decision: unknown, _opts?: unknown) => true),
  gatewayAuthResult: {
    current: { ok: true } as {
      ok: true;
      trustedProxy?: {
        domain?: "platform" | "enterprise" | "employee";
        enterpriseId?: string;
      };
    },
  },
}));

let cfg: Record<string, unknown> = {};
let lastCreateOpenClawToolsContext: Record<string, unknown> | undefined;

// Perf: keep this suite pure unit. Mock heavyweight config/session modules.
vi.mock("../config/config.js", () => ({
  loadConfig: () => cfg,
}));

vi.mock("../config/sessions.js", () => ({
  resolveMainSessionKey: (params?: {
    session?: { scope?: string; mainKey?: string };
    agents?: { list?: Array<{ id?: string; default?: boolean }> };
  }) => {
    if (params?.session?.scope === "global") {
      return "global";
    }
    const agents = params?.agents?.list ?? [];
    const rawDefault = agents.find((agent) => agent?.default)?.id ?? agents[0]?.id ?? "main";
    const agentId =
      String(rawDefault ?? "main")
        .trim()
        .toLowerCase() || "main";
    const mainKeyRaw = String(params?.session?.mainKey ?? "main")
      .trim()
      .toLowerCase();
    const mainKey = mainKeyRaw || "main";
    return `agent:${agentId}:${mainKey}`;
  },
}));

vi.mock("./auth.js", () => ({
  authorizeHttpGatewayConnect: async () => gatewayAuthResult.current,
  // These unit tests exercise HTTP routing/policy/governance with the operator
  // path; treat callers as loopback-direct so the browser/tenant-session guard
  // (which only fires for method "trusted-proxy" on non-local-direct requests)
  // stays out of the way. The guard itself is covered in
  // tools-invoke-http.session-guard.test.ts.
  isLocalDirectRequest: () => true,
}));

vi.mock("./governance/shadow-sink.js", () => ({
  appendGovernanceShadowDecision: (decision: unknown, opts?: unknown) =>
    appendGovernanceShadowDecisionMock(decision, opts),
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

// Perf: the real tool factory instantiates many tools per request; for these HTTP
// routing/policy tests we only need a small set of tool names.
vi.mock("../agents/openclaw-tools.js", () => {
  const toolInputError = (message: string) => {
    const err = new Error(message);
    err.name = "ToolInputError";
    return err;
  };
  const toolAuthorizationError = (message: string) => {
    const err = new Error(message) as Error & { status?: number };
    err.name = "ToolAuthorizationError";
    err.status = 403;
    return err;
  };

  const tools = [
    {
      name: "session_status",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ ok: true }),
    },
    {
      name: "agents_list",
      parameters: { type: "object", properties: { action: { type: "string" } } },
      execute: async () => ({ ok: true, result: [] }),
    },
    {
      name: "sessions_spawn",
      parameters: { type: "object", properties: {} },
      execute: async () => ({
        ok: true,
        route: {
          agentTo: lastCreateOpenClawToolsContext?.agentTo,
          agentThreadId: lastCreateOpenClawToolsContext?.agentThreadId,
        },
      }),
    },
    {
      name: "sessions_send",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ ok: true }),
    },
    {
      name: "gateway",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        throw toolInputError("invalid args");
      },
    },
    {
      name: "tools_invoke_test",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string" },
        },
        required: ["mode"],
        additionalProperties: false,
      },
      execute: async (_toolCallId: string, args: unknown) => {
        const mode = (args as { mode?: unknown })?.mode;
        if (mode === "input") {
          throw toolInputError("mode invalid");
        }
        if (mode === "auth") {
          throw toolAuthorizationError("mode forbidden");
        }
        if (mode === "crash") {
          throw new Error("boom");
        }
        return { ok: true };
      },
    },
    {
      name: "diffs_compat_test",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string" },
          fileFormat: { type: "string" },
        },
        additionalProperties: false,
      },
      execute: async (_toolCallId: string, args: unknown) => {
        const input = (args ?? {}) as Record<string, unknown>;
        return {
          ok: true,
          observedFormat: input.format,
          observedFileFormat: input.fileFormat,
        };
      },
    },
  ];

  return {
    createOpenClawTools: (ctx: Record<string, unknown>) => {
      lastCreateOpenClawToolsContext = ctx;
      return tools;
    },
  };
});

const {
  handleToolsInvokeHttpRequest,
  HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE_ENV,
  httpToolsInvokeObserveTaskId,
  isHttpToolsInvokePreflightObserveEnabled,
} = await import("./tools-invoke-http.js");

let pluginHttpHandlers: Array<(req: IncomingMessage, res: ServerResponse) => Promise<boolean>> = [];

let sharedPort = 0;
let sharedServer: ReturnType<typeof createServer> | undefined;

beforeAll(async () => {
  sharedServer = createServer((req, res) => {
    void (async () => {
      const handled = await handleToolsInvokeHttpRequest(req, res, {
        auth: { mode: "token", token: TEST_GATEWAY_TOKEN, allowTailscale: false },
      });
      if (handled) {
        return;
      }
      for (const handler of pluginHttpHandlers) {
        if (await handler(req, res)) {
          return;
        }
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
  delete process.env.OPENCLAW_GATEWAY_TOKEN;
  delete process.env.OPENCLAW_GATEWAY_PASSWORD;
  delete process.env[HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE_ENV];
  delete process.env.OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW;
  delete process.env.OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE;
  delete process.env.OPENBOT_GOVERNANCE_SHADOW_LOG;
  gatewayAuthResult.current = { ok: true };
  appendGovernanceShadowDecisionMock.mockClear();
  resetExecutionTraceForTest();
  pluginHttpHandlers = [];
  cfg = {};
  lastCreateOpenClawToolsContext = undefined;
});

const resolveGatewayToken = (): string => TEST_GATEWAY_TOKEN;
const gatewayAuthHeaders = () => ({ authorization: `Bearer ${resolveGatewayToken()}` });

const allowAgentsListForMain = () => {
  cfg = {
    ...cfg,
    agents: {
      list: [
        {
          id: "main",
          default: true,
          tools: {
            allow: ["agents_list"],
          },
        },
      ],
    },
  };
};

const postToolsInvoke = async (params: {
  port: number;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
}) =>
  await fetch(`http://127.0.0.1:${params.port}/tools/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json", ...params.headers },
    body: JSON.stringify(params.body),
  });

const withOptionalSessionKey = (body: Record<string, unknown>, sessionKey?: string) => ({
  ...body,
  ...(sessionKey ? { sessionKey } : {}),
});

const invokeAgentsList = async (params: {
  port: number;
  headers?: Record<string, string>;
  sessionKey?: string;
}) => {
  const body = withOptionalSessionKey(
    { tool: "agents_list", action: "json", args: {} },
    params.sessionKey,
  );
  return await postToolsInvoke({ port: params.port, headers: params.headers, body });
};

const invokeTool = async (params: {
  port: number;
  tool: string;
  args?: Record<string, unknown>;
  action?: string;
  headers?: Record<string, string>;
  sessionKey?: string;
}) => {
  const body: Record<string, unknown> = withOptionalSessionKey(
    {
      tool: params.tool,
      args: params.args ?? {},
    },
    params.sessionKey,
  );
  if (params.action) {
    body.action = params.action;
  }
  return await postToolsInvoke({ port: params.port, headers: params.headers, body });
};

const invokeAgentsListAuthed = async (params: { sessionKey?: string } = {}) =>
  invokeAgentsList({
    port: sharedPort,
    headers: gatewayAuthHeaders(),
    sessionKey: params.sessionKey,
  });

const invokeToolAuthed = async (params: {
  tool: string;
  args?: Record<string, unknown>;
  action?: string;
  sessionKey?: string;
}) =>
  invokeTool({
    port: sharedPort,
    headers: gatewayAuthHeaders(),
    ...params,
  });

const expectOkInvokeResponse = async (res: Response) => {
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  return body as { ok: boolean; result?: Record<string, unknown> };
};

const setMainAllowedTools = (params: {
  allow: string[];
  gatewayAllow?: string[];
  gatewayDeny?: string[];
}) => {
  cfg = {
    ...cfg,
    agents: {
      list: [{ id: "main", default: true, tools: { allow: params.allow } }],
    },
    ...(params.gatewayAllow || params.gatewayDeny
      ? {
          gateway: {
            tools: {
              ...(params.gatewayAllow ? { allow: params.gatewayAllow } : {}),
              ...(params.gatewayDeny ? { deny: params.gatewayDeny } : {}),
            },
          },
        }
      : {}),
  };
};

describe("POST /tools/invoke", () => {
  it("keeps status and body byte-identical when the tools invoke shadow flag flips", async () => {
    allowAgentsListForMain();
    cfg = {
      ...cfg,
      gateway: {
        tools: {
          tenantCapabilities: {
            "tenant-1": { agents_list: "deny" },
          },
        },
      },
    };
    gatewayAuthResult.current = {
      ok: true,
      trustedProxy: { domain: "enterprise", enterpriseId: "tenant-1" },
    };

    const off = await invokeAgentsListAuthed({ sessionKey: "main" });
    const offStatus = off.status;
    const offBody = await off.text();
    expect(appendGovernanceShadowDecisionMock).not.toHaveBeenCalled();

    process.env.OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW = "1";
    const on = await invokeAgentsListAuthed({ sessionKey: "main" });
    expect(on.status).toBe(offStatus);
    expect(await on.text()).toBe(offBody);
    expect(offStatus).toBe(200);
    expect(offBody).toContain('"ok":true');

    await vi.waitFor(() => {
      expect(appendGovernanceShadowDecisionMock).toHaveBeenCalled();
    });
    expect(appendGovernanceShadowDecisionMock.mock.calls[0]?.[0]).toMatchObject({
      effect: "deny",
      mode: "shadow",
      reason: "tenant-capability-deny",
      tenantId: "tenant-1",
      shadow: { existing: { effect: "allow" }, divergence: "D1" },
    });
  });

  it("default MODE (shadow/unset) keeps HTTP identical to legacy when capability would deny", async () => {
    allowAgentsListForMain();
    cfg = {
      ...cfg,
      gateway: {
        tools: {
          tenantCapabilities: {
            "tenant-1": { agents_list: "deny" },
          },
        },
      },
    };
    gatewayAuthResult.current = {
      ok: true,
      trustedProxy: { domain: "enterprise", enterpriseId: "tenant-1" },
    };

    const unsetMode = await invokeAgentsListAuthed({ sessionKey: "main" });
    expect(unsetMode.status).toBe(200);
    expect(await unsetMode.json()).toMatchObject({ ok: true });

    process.env.OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE = "legacy";
    const legacy = await invokeAgentsListAuthed({ sessionKey: "main" });
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toMatchObject({ ok: true });
  });

  it("enforced + capability deny returns the gateway deny-list 404 not_found shape", async () => {
    allowAgentsListForMain();
    cfg = {
      ...cfg,
      gateway: {
        tools: {
          tenantCapabilities: {
            "tenant-1": { agents_list: "deny" },
          },
        },
      },
    };
    gatewayAuthResult.current = {
      ok: true,
      trustedProxy: { domain: "enterprise", enterpriseId: "tenant-1" },
    };

    process.env.OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE = "enforced";
    const res = await invokeAgentsListAuthed({ sessionKey: "main" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      ok: false,
      error: { type: "not_found", message: "Tool not available: agents_list" },
    });
    await vi.waitFor(() => {
      expect(appendGovernanceShadowDecisionMock).toHaveBeenCalled();
    });
    expect(appendGovernanceShadowDecisionMock.mock.calls[0]?.[0]).toMatchObject({
      effect: "deny",
      mode: "enforced",
      reason: "tenant-capability-deny",
    });
  });

  it("enforced + capability allow still invokes the tool", async () => {
    allowAgentsListForMain();
    cfg = {
      ...cfg,
      gateway: {
        tools: {
          tenantCapabilities: {
            "tenant-1": { agents_list: "allow" },
          },
        },
      },
    };
    gatewayAuthResult.current = {
      ok: true,
      trustedProxy: { domain: "enterprise", enterpriseId: "tenant-1" },
    };

    process.env.OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE = "enforced";
    const res = await invokeAgentsListAuthed({ sessionKey: "main" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("enforced + unevaluated/skipped does not block HTTP", async () => {
    allowAgentsListForMain();
    cfg = {
      ...cfg,
      gateway: {
        tools: {
          tenantCapabilities: {
            "tenant-1": { sessions_send: "deny" },
          },
        },
      },
    };
    gatewayAuthResult.current = {
      ok: true,
      trustedProxy: { domain: "enterprise", enterpriseId: "tenant-1" },
    };

    process.env.OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE = "enforced";
    const res = await invokeAgentsListAuthed({ sessionKey: "main" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("does not feed tenantCapabilities into the HTTP deny list", () => {
    const source = readFileSync(new URL("./tools-invoke-http.ts", import.meta.url), "utf8");
    const start = source.indexOf("const gatewayToolsCfg");
    const end = source.indexOf("const tool = gatewayFiltered.find");
    expect(source.slice(start, end)).not.toContain("tenantCapabilities");
    expect(source).toContain("capabilityPolicy: gatewayToolsCfg?.tenantCapabilities");
    expect(source).toContain("applyToolsInvokeGovernance");
    expect(source).not.toMatch(/OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE\s*=\s*["']enforced/);
  });

  it("invokes a tool and returns {ok:true,result}", async () => {
    allowAgentsListForMain();
    const res = await invokeAgentsListAuthed({ sessionKey: "main" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty("result");
    expect(lastCreateOpenClawToolsContext?.allowMediaInvokeCommands).toBe(true);
  });

  it("supports tools.alsoAllow in profile and implicit modes", async () => {
    cfg = {
      ...cfg,
      agents: { list: [{ id: "main", default: true }] },
      tools: { profile: "minimal", alsoAllow: ["agents_list"] },
    };

    const resProfile = await invokeAgentsListAuthed({ sessionKey: "main" });

    expect(resProfile.status).toBe(200);
    const profileBody = await resProfile.json();
    expect(profileBody.ok).toBe(true);

    cfg = {
      ...cfg,
      tools: { alsoAllow: ["agents_list"] },
    };

    const resImplicit = await invokeAgentsListAuthed({ sessionKey: "main" });
    expect(resImplicit.status).toBe(200);
    const implicitBody = await resImplicit.json();
    expect(implicitBody.ok).toBe(true);
  });

  it("routes tools invoke before plugin HTTP handlers", async () => {
    const pluginHandler = vi.fn(async (_req: IncomingMessage, res: ServerResponse) => {
      res.statusCode = 418;
      res.end("plugin");
      return true;
    });
    allowAgentsListForMain();
    pluginHttpHandlers = [async (req, res) => pluginHandler(req, res)];

    const res = await invokeAgentsListAuthed({ sessionKey: "main" });

    expect(res.status).toBe(200);
    expect(pluginHandler).not.toHaveBeenCalled();
  });

  it("returns 404 when denylisted or blocked by tools.profile", async () => {
    cfg = {
      ...cfg,
      agents: {
        list: [
          {
            id: "main",
            default: true,
            tools: {
              deny: ["agents_list"],
            },
          },
        ],
      },
    };
    const denyRes = await invokeAgentsListAuthed({ sessionKey: "main" });
    expect(denyRes.status).toBe(404);
    // API-03: policy reject is an explicit error body — never empty 200 / silent drop.
    await expect(denyRes.json()).resolves.toEqual({
      ok: false,
      error: { type: "not_found", message: "Tool not available: agents_list" },
    });

    allowAgentsListForMain();
    cfg = {
      ...cfg,
      tools: { profile: "minimal" },
    };

    const profileRes = await invokeAgentsListAuthed({ sessionKey: "main" });
    expect(profileRes.status).toBe(404);
    await expect(profileRes.json()).resolves.toMatchObject({
      ok: false,
      error: { type: "not_found" },
    });
  });

  it("denies sessions_spawn via HTTP even when agent policy allows", async () => {
    cfg = {
      ...cfg,
      agents: {
        list: [
          {
            id: "main",
            default: true,
            tools: { allow: ["sessions_spawn"] },
          },
        ],
      },
    };

    const res = await invokeToolAuthed({
      tool: "sessions_spawn",
      args: { task: "test" },
      sessionKey: "main",
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.type).toBe("not_found");
  });

  it("propagates message target/thread headers into tools context for sessions_spawn", async () => {
    cfg = {
      ...cfg,
      agents: {
        list: [{ id: "main", default: true, tools: { allow: ["sessions_spawn"] } }],
      },
      gateway: { tools: { allow: ["sessions_spawn"] } },
    };

    const res = await invokeTool({
      port: sharedPort,
      headers: {
        ...gatewayAuthHeaders(),
        "x-openclaw-message-to": "channel:24514",
        "x-openclaw-thread-id": "thread-24514",
      },
      tool: "sessions_spawn",
      sessionKey: "main",
    });

    const body = await expectOkInvokeResponse(res);
    expect(body.result?.route).toEqual({
      agentTo: "channel:24514",
      agentThreadId: "thread-24514",
    });
  });

  it("denies sessions_send via HTTP gateway", async () => {
    setMainAllowedTools({ allow: ["sessions_send"] });

    const res = await invokeToolAuthed({
      tool: "sessions_send",
      sessionKey: "main",
    });

    expect(res.status).toBe(404);
  });

  it("denies gateway tool via HTTP", async () => {
    setMainAllowedTools({ allow: ["gateway"] });

    const res = await invokeToolAuthed({
      tool: "gateway",
      sessionKey: "main",
    });

    expect(res.status).toBe(404);
  });

  it("allows gateway tool via HTTP when explicitly enabled in gateway.tools.allow", async () => {
    setMainAllowedTools({ allow: ["gateway"], gatewayAllow: ["gateway"] });

    const res = await invokeToolAuthed({
      tool: "gateway",
      sessionKey: "main",
    });

    // Ensure we didn't hit the HTTP deny list (404). Invalid args should map to 400.
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error?.type).toBe("tool_error");
  });

  it("treats gateway.tools.deny as higher priority than gateway.tools.allow", async () => {
    setMainAllowedTools({
      allow: ["gateway"],
      gatewayAllow: ["gateway"],
      gatewayDeny: ["gateway"],
    });

    const res = await invokeToolAuthed({
      tool: "gateway",
      sessionKey: "main",
    });

    expect(res.status).toBe(404);
  });

  it("uses the configured main session key when sessionKey is missing or main", async () => {
    cfg = {
      ...cfg,
      agents: {
        list: [
          {
            id: "main",
            tools: {
              deny: ["agents_list"],
            },
          },
          {
            id: "ops",
            default: true,
            tools: {
              allow: ["agents_list"],
            },
          },
        ],
      },
      session: { mainKey: "primary" },
    };

    const resDefault = await invokeAgentsListAuthed();
    expect(resDefault.status).toBe(200);

    const resMain = await invokeAgentsListAuthed({ sessionKey: "main" });
    expect(resMain.status).toBe(200);
  });

  it("maps tool input/auth errors to 400/403 and unexpected execution errors to 500", async () => {
    cfg = {
      ...cfg,
      agents: {
        list: [{ id: "main", default: true, tools: { allow: ["tools_invoke_test"] } }],
      },
    };

    const inputRes = await invokeToolAuthed({
      tool: "tools_invoke_test",
      args: { mode: "input" },
      sessionKey: "main",
    });
    expect(inputRes.status).toBe(400);
    const inputBody = await inputRes.json();
    expect(inputBody.ok).toBe(false);
    expect(inputBody.error?.type).toBe("tool_error");
    expect(inputBody.error?.message).toBe("mode invalid");

    const authRes = await invokeToolAuthed({
      tool: "tools_invoke_test",
      args: { mode: "auth" },
      sessionKey: "main",
    });
    expect(authRes.status).toBe(403);
    const authBody = await authRes.json();
    expect(authBody.ok).toBe(false);
    expect(authBody.error?.type).toBe("tool_error");
    expect(authBody.error?.message).toBe("mode forbidden");

    const crashRes = await invokeToolAuthed({
      tool: "tools_invoke_test",
      args: { mode: "crash" },
      sessionKey: "main",
    });
    expect(crashRes.status).toBe(500);
    const crashBody = await crashRes.json();
    expect(crashBody.ok).toBe(false);
    expect(crashBody.error?.type).toBe("tool_error");
    expect(crashBody.error?.message).toBe("tool execution failed");
  });

  it("passes deprecated format alias through invoke payloads even when schema omits it", async () => {
    setMainAllowedTools({ allow: ["diffs_compat_test"] });

    const res = await invokeToolAuthed({
      tool: "diffs_compat_test",
      args: { mode: "file", format: "pdf" },
      sessionKey: "main",
    });

    const body = await expectOkInvokeResponse(res);
    expect(body.result?.observedFormat).toBe("pdf");
    expect(body.result?.observedFileFormat).toBeUndefined();
  });

  it("keeps the HTTP response unchanged when preflight observe is off", async () => {
    expect(isHttpToolsInvokePreflightObserveEnabled({})).toBe(false);
    expect(
      isHttpToolsInvokePreflightObserveEnabled({ [HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE_ENV]: "0" }),
    ).toBe(false);
    allowAgentsListForMain();
    const res = await invokeAgentsListAuthed({ sessionKey: "main" });
    const body = await expectOkInvokeResponse(res);
    expect(Object.keys(body).toSorted()).toEqual(["ok", "result"]);
    expect(
      readExecutionTraces(httpToolsInvokeObserveTaskId("agent:main:main", "agents_list")),
    ).toEqual([]);
  });

  it("records a preflight trace when observe is on without changing the allow response", async () => {
    process.env[HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE_ENV] = "1";
    expect(isHttpToolsInvokePreflightObserveEnabled()).toBe(true);
    allowAgentsListForMain();
    const res = await invokeAgentsListAuthed({ sessionKey: "main" });
    const body = await expectOkInvokeResponse(res);
    expect(Object.keys(body).toSorted()).toEqual(["ok", "result"]);
    const traces = readExecutionTraces(
      httpToolsInvokeObserveTaskId("agent:main:main", "agents_list"),
    );
    expect(traces.some((row) => row.decisionStage === "preflight")).toBe(true);
    expect(traces.every((row) => row.decisionStage === "preflight")).toBe(true);
    expect(traces[0]?.decisionCode).toBe("no_skill_contract");
  });

  it("keeps HTTP deny authoritative when observe is on", async () => {
    process.env[HTTP_TOOLS_INVOKE_PREFLIGHT_OBSERVE_ENV] = "1";
    cfg = {
      agents: {
        list: [{ id: "main", default: true, tools: { deny: ["agents_list"] } }],
      },
    };
    const agentDeny = await invokeAgentsListAuthed({ sessionKey: "main" });
    expect(agentDeny.status).toBe(404);
    expect(
      readExecutionTraces(httpToolsInvokeObserveTaskId("agent:main:main", "agents_list")),
    ).toEqual([]);

    setMainAllowedTools({ allow: ["sessions_spawn"] });
    const httpDeny = await invokeToolAuthed({
      tool: "sessions_spawn",
      args: { task: "test" },
      sessionKey: "main",
    });
    expect(httpDeny.status).toBe(404);
    expect(
      readExecutionTraces(httpToolsInvokeObserveTaskId("agent:main:main", "sessions_spawn")),
    ).toEqual([]);
  });

  it("does not enforce preflight on the HTTP invoke path", () => {
    const source = readFileSync(new URL("./tools-invoke-http.ts", import.meta.url), "utf8");
    expect(source).toContain("buildExecutionPreflight");
    expect(source).not.toContain("applyPreflightToTools");
    expect(source).not.toContain("armCompletionHold");
    expect(source).not.toContain("filterLaneTools");
    expect(source).not.toContain("ORCHESTRATION_LIVE_INVOKE");
  });
});
