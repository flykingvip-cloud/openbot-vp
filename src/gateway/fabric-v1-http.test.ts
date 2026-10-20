import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AdapterRegistry } from "../fabric/adapter-registry.js";
import type { PolicyDecision, RuntimeNode, ToolExecutionResult } from "../fabric/contract.js";
import { createFabricService } from "../fabric/service.js";
import { handleFabricV1HttpRequest } from "./fabric-v1-http.js";
import { setFabricServiceProvider } from "./server-methods/fabric.js";

const TOKEN = "test-fabric-token";
let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    void handleFabricV1HttpRequest(req, res, {
      auth: { mode: "token", token: TOKEN, allowTailscale: false },
    }).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
afterEach(() => setFabricServiceProvider(null));

const ALLOW: PolicyDecision = { decision: "ALLOW", matchedRules: [], decisionTrace: [] };

function fakeService() {
  return createFabricService({
    registry: new AdapterRegistry(),
    pipeline: {
      decideFor: () => ALLOW,
      executeNode: async (node: RuntimeNode): Promise<ToolExecutionResult> => {
        const now = Date.now();
        return {
          id: node.id,
          status: "success",
          timing: { start: now, end: now },
          trace: { policyDecisionId: node.id, executionId: "e1" },
        };
      },
    },
  });
}

const validRequest = {
  id: "req-1",
  source: { type: "cursor" },
  tool: { name: "git" },
  input: { args: ["status"] },
  trace: { sessionId: "s1", correlationId: "c1" },
};

async function post(path: string, body: unknown, token = TOKEN) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("/v1/* fabric HTTP forwarding", () => {
  it("returns 404 for non-fabric paths (does not own them)", async () => {
    setFabricServiceProvider(() => fakeService());
    const res = await fetch(`http://127.0.0.1:${port}/not-fabric`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("503 when fabric is not enabled", async () => {
    setFabricServiceProvider(null);
    const { status, json } = await post("/v1/policy/check", { request: validRequest });
    expect(status).toBe(503);
    expect(json.ok).toBe(false);
  });

  it("401/403 when auth token is wrong", async () => {
    setFabricServiceProvider(() => fakeService());
    const { status } = await post("/v1/policy/check", { request: validRequest }, "wrong");
    expect(status).toBeGreaterThanOrEqual(401);
    expect(status).toBeLessThan(500);
  });

  it("policy.check returns decision + trace", async () => {
    setFabricServiceProvider(() => fakeService());
    const { status, json } = await post("/v1/policy/check", { request: validRequest });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect((json.decision as { decision: string }).decision).toBe("ALLOW");
  });

  it("tool.execute returns result + trace", async () => {
    setFabricServiceProvider(() => fakeService());
    const { status, json } = await post("/v1/tool/execute", { request: validRequest });
    expect(status).toBe(200);
    expect((json.result as { status: string }).status).toBe("success");
  });

  it("tool.stream returns result + batched events", async () => {
    setFabricServiceProvider(() => fakeService());
    const { status, json } = await post("/v1/tool/stream", { request: validRequest });
    expect(status).toBe(200);
    expect((json.result as { status: string }).status).toBe("success");
    const events = json.events as Array<{ type: string }>;
    expect(events[0]?.type).toBe("policy");
    expect(events.some((e) => e.type === "status")).toBe(true);
  });

  it("adapter.register registers a valid adapter", async () => {
    setFabricServiceProvider(() => fakeService());
    const { status, json } = await post("/v1/adapter/register", {
      adapter: { id: "x.c", match: { toolNames: ["c"] }, execute: { command: "c" } },
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it("rejects a malformed request body", async () => {
    setFabricServiceProvider(() => fakeService());
    const { status, json } = await post("/v1/policy/check", { request: { id: "x" } });
    expect(status).toBe(400);
    expect(json.error).toBeDefined();
  });
});
