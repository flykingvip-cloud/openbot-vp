import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createLoopbackToolInvoker } from "../fabric/loopback-invoker.js";
import { createGatewayFabricService } from "../fabric/wiring.js";

const fixture = vi.hoisted(() => ({ effects: 0, deny: false }));
const TOKEN = "isolated-policy-composition-token";
vi.mock("../config/config.js", () => ({
  loadConfig: () => ({
    agents: { list: [{ id: "main", default: true, tools: { allow: ["exec"] } }] },
    gateway: { tools: { allow: ["exec"], deny: fixture.deny ? ["exec"] : [] } },
  }),
}));
// Only the terminal tool implementation is replaced; HTTP auth and both policy layers are real.
vi.mock("../agents/openclaw-tools.js", () => ({
  createOpenClawTools: () => [
    {
      name: "exec",
      parameters: {
        type: "object",
        properties: { argv: { type: "array", items: { type: "string" } } },
      },
      execute: async () => {
        fixture.effects += 1;
        return { ok: true };
      },
    },
  ],
}));
const { handleToolsInvokeHttpRequest } = await import("./tools-invoke-http.js");
const { setToolkitPhase2PolicyForTests } = await import("./toolkit-phase2-gate.js");
let requests = 0;
let baseUrl = "";
const server = createServer((req, res) => {
  requests += 1;
  void handleToolsInvokeHttpRequest(req, res, {
    auth: { mode: "token", token: TOKEN, allowTailscale: false },
  }).catch(() => {
    res.statusCode = 500;
    res.end("isolated handler failed");
  });
});
beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterEach(() => {
  setToolkitPhase2PolicyForTests(undefined);
  vi.unstubAllEnvs();
  fixture.effects = 0;
  fixture.deny = false;
  requests = 0;
});

async function execute(options: {
  fabricDeny?: boolean;
  httpDeny?: boolean;
  phase2Deny?: boolean;
}) {
  fixture.deny = options.httpDeny ?? false;
  vi.stubEnv("OPENBOT_TOOLKIT_PHASE2_GATE", "enforce");
  vi.stubEnv("OPENBOT_GOVERNANCE_TOOLS_INVOKE_SHADOW", "0");
  vi.stubEnv("OPENBOT_GOVERNANCE_TOOLS_INVOKE_MODE", "shadow");
  setToolkitPhase2PolicyForTests({ default: options.phase2Deny ? "deny" : "allow", rules: [] });
  const service = createGatewayFabricService({
    toolInvoker: createLoopbackToolInvoker({ baseUrl, token: TOKEN }),
    processRunner: false,
    probeDeps: {
      resolveApprovals: () => ({
        ask: "off",
        security: options.fabricDeny ? "deny" : "full",
        allowlist: [],
      }),
    },
  });
  return service.execute({
    id: "composition-request",
    source: { type: "cursor" },
    tool: { name: "exec" },
    input: { args: ["echo", "isolated"] },
    context: {},
    trace: { sessionId: "main", correlationId: "composition-test" },
  });
}

describe("Fabric to HTTP to Phase2 policy composition", () => {
  it("Fabric deny prevents loopback dispatch", async () => {
    const { result } = await execute({ fabricDeny: true });
    expect(result.status).toBe("denied");
    expect(requests).toBe(0);
    expect(fixture.effects).toBe(0);
  });
  it("Fabric allow cannot bypass the HTTP host deny list", async () => {
    const { result } = await execute({ httpDeny: true });
    expect(result.status).toBe("failed");
    expect(requests).toBe(1);
    expect(fixture.effects).toBe(0);
  });
  it("Phase2 deny prevents the terminal effect after upstream allow", async () => {
    const { result } = await execute({ phase2Deny: true });
    expect(result.status).toBe("failed");
    expect(requests).toBe(1);
    expect(fixture.effects).toBe(0);
  });
  it("all permitting layers execute the terminal effect exactly once", async () => {
    const { result } = await execute({});
    expect(result.status).toBe("success");
    expect(requests).toBe(1);
    expect(fixture.effects).toBe(1);
  });
});
