import { describe, expect, it } from "vitest";
import { createFabricAuditStore } from "./audit-store.js";
import { buildExecutionRecord } from "./audit.js";
import type { PolicyDecision, ToolExecutionResult, ToolRequest } from "./contract.js";

function req(over: Partial<ToolRequest> = {}): ToolRequest {
  return {
    id: "req-1",
    source: { type: "cursor", tenantId: "t1" },
    tool: { name: "git" },
    input: { args: ["status"] },
    context: {},
    trace: { sessionId: "s1", correlationId: "c1" },
    ...over,
  };
}

const ALLOW: PolicyDecision = { decision: "ALLOW", matchedRules: [], decisionTrace: [] };
const DENY: PolicyDecision = {
  decision: "DENY",
  reason: "no",
  matchedRules: [],
  decisionTrace: [],
};

function result(status: ToolExecutionResult["status"] = "success"): ToolExecutionResult {
  return {
    id: "req-1",
    status,
    output: { stdout: "ok" },
    timing: { start: 1, end: 3 },
    trace: { policyDecisionId: "req-1", executionId: "e1" },
  };
}

function record(decision: PolicyDecision, request: ToolRequest, costUsd?: number) {
  return buildExecutionRecord({
    request,
    decision,
    result: result(decision.decision === "DENY" ? "denied" : "success"),
    costUsd,
  });
}

describe("FabricAuditStore", () => {
  it("returns records newest-first", () => {
    const store = createFabricAuditStore();
    store.append(record(ALLOW, req({ id: "a", trace: { sessionId: "s1", correlationId: "c1" } })));
    store.append(record(ALLOW, req({ id: "b", trace: { sessionId: "s1", correlationId: "c2" } })));
    const recs = store.query();
    expect(recs.map((r) => r.correlationId)).toEqual(["c2", "c1"]);
  });

  it("filters by tenant/session/correlation", () => {
    const store = createFabricAuditStore();
    store.append(record(ALLOW, req({ source: { type: "cursor", tenantId: "t1" } })));
    store.append(
      record(
        ALLOW,
        req({
          source: { type: "kiro", tenantId: "t2" },
          trace: { sessionId: "s2", correlationId: "c2" },
        }),
      ),
    );
    expect(store.query({ tenantId: "t1" })).toHaveLength(1);
    expect(store.query({ tenantId: "t2" })[0]?.sessionId).toBe("s2");
  });

  it("respects the limit", () => {
    const store = createFabricAuditStore();
    for (let i = 0; i < 5; i += 1) {
      store.append(record(ALLOW, req({ trace: { sessionId: "s1", correlationId: `c${i}` } })));
    }
    expect(store.query(undefined, 2)).toHaveLength(2);
    expect(store.query(undefined, 0)).toHaveLength(5);
  });

  it("evicts oldest beyond capacity", () => {
    const store = createFabricAuditStore(3);
    for (let i = 0; i < 5; i += 1) {
      store.append(record(ALLOW, req({ trace: { sessionId: "s1", correlationId: `c${i}` } })));
    }
    expect(store.size()).toBe(3);
    // newest-first: c4, c3, c2 retained
    expect(store.query().map((r) => r.correlationId)).toEqual(["c4", "c3", "c2"]);
  });

  it("aggregates stats by decision/status + cost", () => {
    const store = createFabricAuditStore();
    store.append(record(ALLOW, req(), 0.1));
    store.append(record(ALLOW, req(), 0.2));
    store.append(record(DENY, req()));
    const stats = store.stats();
    expect(stats.total).toBe(3);
    expect(stats.byDecision.ALLOW).toBe(2);
    expect(stats.byDecision.DENY).toBe(1);
    expect(stats.byStatus.success).toBe(2);
    expect(stats.byStatus.denied).toBe(1);
    expect(stats.costUsd).toBeCloseTo(0.3);
  });

  it("scopes stats by tenant", () => {
    const store = createFabricAuditStore();
    store.append(record(ALLOW, req({ source: { type: "cursor", tenantId: "t1" } })));
    store.append(record(DENY, req({ source: { type: "cursor", tenantId: "t2" } })));
    expect(store.stats({ tenantId: "t1" }).byDecision.ALLOW).toBe(1);
    expect(store.stats({ tenantId: "t1" }).byDecision.DENY).toBe(0);
  });
});
