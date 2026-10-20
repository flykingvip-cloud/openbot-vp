import { afterEach, describe, expect, it } from "vitest";
import { AdapterRegistry } from "../../fabric/adapter-registry.js";
import { createFabricAuditStore } from "../../fabric/audit-store.js";
import { buildExecutionRecord } from "../../fabric/audit.js";
import type { PolicyDecision, RuntimeNode, ToolExecutionResult } from "../../fabric/contract.js";
import { createFabricService } from "../../fabric/service.js";
import { fabricHandlers, setFabricAuditStoreProvider, setFabricServiceProvider } from "./fabric.js";

type RespondArgs = { ok: boolean; payload?: unknown; error?: unknown };
function captureRespond() {
  const calls: RespondArgs[] = [];
  const respond = (ok: boolean, payload?: unknown, error?: unknown) =>
    calls.push({ ok, payload, error });
  return { calls, respond };
}

const ALLOW: PolicyDecision = { decision: "ALLOW", matchedRules: [], decisionTrace: [] };

function ctxArgs(
  params: Record<string, unknown>,
  respond: ReturnType<typeof captureRespond>["respond"],
) {
  return {
    params,
    respond,
    context: {},
    client: null,
    req: {},
    isWebchatConnect: () => false,
  } as never;
}

function fakeService(decision: PolicyDecision = ALLOW) {
  return createFabricService({
    registry: new AdapterRegistry(),
    pipeline: {
      decideFor: () => decision,
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

afterEach(() => {
  setFabricServiceProvider(null);
  setFabricAuditStoreProvider(null);
});

describe("fabric handlers — feature gate", () => {
  it("reports UNAVAILABLE when no service provider is set (feature off)", () => {
    setFabricServiceProvider(null);
    const { calls, respond } = captureRespond();
    void fabricHandlers["fabric.policy.check"](ctxArgs({ request: validRequest }, respond));
    expect(calls[0]?.ok).toBe(false);
  });
});

describe("fabric handlers — policy.check", () => {
  it("returns decision + trace for a valid request", () => {
    setFabricServiceProvider(() => fakeService(ALLOW));
    const { calls, respond } = captureRespond();
    void fabricHandlers["fabric.policy.check"](ctxArgs({ request: validRequest }, respond));
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as {
      decision: { decision: string };
      trace: { correlationId: string };
    };
    expect(payload.decision.decision).toBe("ALLOW");
    expect(payload.trace.correlationId).toBe("c1");
  });

  it("rejects a malformed request with INVALID_REQUEST", () => {
    setFabricServiceProvider(() => fakeService());
    const { calls, respond } = captureRespond();
    void fabricHandlers["fabric.policy.check"](ctxArgs({ request: { id: "x" } }, respond));
    expect(calls[0]?.ok).toBe(false);
  });
});

describe("fabric handlers — tool.execute", () => {
  it("executes and returns result + trace", async () => {
    setFabricServiceProvider(() => fakeService(ALLOW));
    const { calls, respond } = captureRespond();
    await fabricHandlers["fabric.tool.execute"](ctxArgs({ request: validRequest }, respond));
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as { result: { status: string } };
    expect(payload.result.status).toBe("success");
  });
});

describe("fabric handlers — tool.stream (11.2)", () => {
  it("rejects without a connected client", async () => {
    setFabricServiceProvider(() => fakeService(ALLOW));
    const { calls, respond } = captureRespond();
    await fabricHandlers["fabric.tool.stream"](ctxArgs({ request: validRequest }, respond));
    expect(calls[0]?.ok).toBe(false);
  });

  it("registers a recipient, pushes events, and returns result + executionId", async () => {
    setFabricServiceProvider(() => fakeService(ALLOW));
    const { calls, respond } = captureRespond();
    const registered: Array<[string, string]> = [];
    const pushed: Array<{ event: string; payload: unknown }> = [];
    const args = {
      params: { request: validRequest },
      respond,
      client: { connId: "conn-1" },
      req: {},
      isWebchatConnect: () => false,
      context: {
        registerToolEventRecipient: (runId: string, connId: string) =>
          registered.push([runId, connId]),
        broadcastToConnIds: (event: string, payload: unknown) => pushed.push({ event, payload }),
      },
    } as never;
    await fabricHandlers["fabric.tool.stream"](args);
    expect(registered).toEqual([["req-1", "conn-1"]]);
    expect(pushed.length).toBeGreaterThan(0);
    expect(pushed.every((p) => p.event === "fabric.tool.event")).toBe(true);
    const payload = calls[0]?.payload as { result: { status: string }; executionId: string };
    expect(calls[0]?.ok).toBe(true);
    expect(payload.result.status).toBe("success");
    expect(payload.executionId).toBe("req-1");
  });
});

describe("fabric handlers — audit.query + status (read, platform UI)", () => {
  function storeWithOneRecord() {
    const store = createFabricAuditStore();
    store.append(
      buildExecutionRecord({
        request: {
          id: "req-1",
          source: { type: "cursor", tenantId: "t1" },
          tool: { name: "git" },
          input: { args: ["status"] },
          context: {},
          trace: { sessionId: "s1", correlationId: "c1" },
        },
        decision: ALLOW,
        result: {
          id: "req-1",
          status: "success",
          output: { stdout: "ok" },
          timing: { start: 1, end: 2 },
          trace: { policyDecisionId: "req-1", executionId: "e1" },
        },
      }),
    );
    return store;
  }

  it("audit.query returns empty (not UNAVAILABLE) when no store is wired", () => {
    setFabricAuditStoreProvider(null);
    const { calls, respond } = captureRespond();
    void fabricHandlers["fabric.audit.query"](ctxArgs({}, respond));
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as { records: unknown[]; stats: unknown };
    expect(payload.records).toEqual([]);
    expect(payload.stats).toBeNull();
  });

  it("audit.query returns records + stats from the store", () => {
    setFabricAuditStoreProvider(() => storeWithOneRecord());
    const { calls, respond } = captureRespond();
    void fabricHandlers["fabric.audit.query"](ctxArgs({ tenantId: "t1" }, respond));
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as {
      records: Array<{ correlationId: string }>;
      stats: { total: number; byDecision: { ALLOW: number } };
    };
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0]?.correlationId).toBe("c1");
    expect(payload.stats.total).toBe(1);
    expect(payload.stats.byDecision.ALLOW).toBe(1);
  });

  it("audit.query tenant filter excludes other tenants", () => {
    setFabricAuditStoreProvider(() => storeWithOneRecord());
    const { calls, respond } = captureRespond();
    void fabricHandlers["fabric.audit.query"](ctxArgs({ tenantId: "other" }, respond));
    const payload = calls[0]?.payload as { records: unknown[]; stats: { total: number } };
    expect(payload.records).toEqual([]);
    expect(payload.stats.total).toBe(0);
  });

  it("status reports service + audit retention", () => {
    setFabricServiceProvider(() => fakeService());
    setFabricAuditStoreProvider(() => storeWithOneRecord());
    const { calls, respond } = captureRespond();
    void fabricHandlers["fabric.status"](ctxArgs({}, respond));
    expect(calls[0]?.ok).toBe(true);
    const payload = calls[0]?.payload as { serviceInstalled: boolean; auditRetained: number };
    expect(payload.serviceInstalled).toBe(true);
    expect(payload.auditRetained).toBe(1);
  });
});

describe("fabric handlers — adapter.register", () => {
  it("registers a valid adapter", () => {
    setFabricServiceProvider(() => fakeService());
    const { calls, respond } = captureRespond();
    void fabricHandlers["fabric.adapter.register"](
      ctxArgs(
        { adapter: { id: "x.c", match: { toolNames: ["c"] }, execute: { command: "c" } } },
        respond,
      ),
    );
    expect(calls[0]?.ok).toBe(true);
  });

  it("rejects a malformed adapter", () => {
    setFabricServiceProvider(() => fakeService());
    const { calls, respond } = captureRespond();
    void fabricHandlers["fabric.adapter.register"](ctxArgs({ adapter: { id: "bad" } }, respond));
    expect(calls[0]?.ok).toBe(false);
  });
});
