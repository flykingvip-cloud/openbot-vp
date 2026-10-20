import { describe, expect, it, vi } from "vitest";
import { AdapterRegistry, BUILTIN_ADAPTERS } from "./adapter-registry.js";
import type { FabricExecutionRecord } from "./audit.js";
import type {
  ExecutionEvent,
  PolicyDecision,
  RuntimeNode,
  ToolExecutionResult,
  ToolRequest,
} from "./contract.js";
import { createFabricService, type FabricServiceDeps } from "./service.js";

function req(name = "exec"): ToolRequest {
  return {
    id: "req-1",
    source: { type: "cursor", tenantId: "t1" },
    tool: { name },
    input: { args: ["x"] },
    context: {},
    trace: { sessionId: "s1", correlationId: "c1" },
  };
}

const ALLOW: PolicyDecision = { decision: "ALLOW", matchedRules: ["r1"], decisionTrace: [] };
const DENY: PolicyDecision = {
  decision: "DENY",
  reason: "blocked",
  matchedRules: [],
  decisionTrace: [],
};

function deps(decision: PolicyDecision, over: Partial<FabricServiceDeps> = {}): FabricServiceDeps {
  const executeNode = vi.fn(async (node: RuntimeNode): Promise<ToolExecutionResult> => {
    const now = Date.now();
    return {
      id: node.id,
      status: "success",
      output: { stdout: "ok" },
      timing: { start: now, end: now },
      trace: { policyDecisionId: node.id, executionId: "e1" },
    };
  });
  return {
    registry: new AdapterRegistry(BUILTIN_ADAPTERS),
    pipeline: { decideFor: () => decision, executeNode },
    ...over,
  };
}

describe("FabricService — check (dry-run, no execution)", () => {
  it("ALLOW maps to a CheckResult and does not execute", () => {
    const d = deps(ALLOW);
    const svc = createFabricService(d);
    const res = svc.check(req());
    expect(res.decision).toBe("ALLOW");
    expect(res.matchedRules).toEqual(["r1"]);
    expect(d.pipeline.executeNode).not.toHaveBeenCalled();
  });

  it("DENY surfaces the reason, no constraints", () => {
    const res = createFabricService(deps(DENY)).check(req());
    expect(res.decision).toBe("DENY");
    expect(res.reason).toBe("blocked");
    expect(res.constraints).toBeUndefined();
  });

  it("MODIFY surfaces constraints", () => {
    const MODIFY: PolicyDecision = {
      decision: "MODIFY",
      constraints: { sandboxMode: "strict" },
      matchedRules: [],
      decisionTrace: [],
    };
    const res = createFabricService(deps(MODIFY)).check(req());
    expect(res.decision).toBe("MODIFY");
    expect(res.constraints?.sandboxMode).toBe("strict");
  });
});

describe("FabricService — execute", () => {
  it("runs the pipeline and returns a result", async () => {
    const { result } = await createFabricService(deps(ALLOW)).execute(req());
    expect(result.status).toBe("success");
  });

  it("emits an audit record carrying the decision + ownership", async () => {
    const records: FabricExecutionRecord[] = [];
    const svc = createFabricService(
      deps(ALLOW, {
        onRecord: (r) => records.push(r),
        ownershipFor: () => ({ owner: "kiro-fabric", conflict: false, unattributed: false }),
      }),
    );
    await svc.execute(req());
    expect(records).toHaveLength(1);
    expect(records[0]?.decision.decision).toBe("ALLOW");
    expect(records[0]?.who.ownership?.owner).toBe("kiro-fabric");
    expect(records[0]?.tenantId).toBe("t1");
  });

  it("DENY short-circuits to a denied result", async () => {
    const { result } = await createFabricService(deps(DENY)).execute(req());
    expect(result.status).toBe("denied");
  });
});

describe("FabricService — registerAdapter", () => {
  it("registers via the registry", () => {
    const d = deps(ALLOW);
    const svc = createFabricService(d);
    const adapter = svc.registerAdapter({
      id: "x.custom",
      match: { toolNames: ["custom"] },
      execute: { command: "custom" },
    });
    expect(adapter.id).toBe("x.custom");
    expect(d.registry.resolve("custom")?.id).toBe("x.custom");
  });
});

describe("FabricService — cost / usage / replay closure (11.3)", () => {
  const MODIFY_LIMIT: PolicyDecision = {
    decision: "MODIFY",
    constraints: { costLimit: 1 },
    matchedRules: [],
    decisionTrace: [],
  };

  it("refuses before executing when estimate exceeds costLimit (R11.2)", async () => {
    const d = deps(MODIFY_LIMIT, { estimateCostUsd: () => 5 });
    const { result } = await createFabricService(d).execute(req());
    expect(result.status).toBe("failed");
    expect(result.output?.stderr).toContain("cost_limit_exceeded");
    expect(d.pipeline.executeNode).not.toHaveBeenCalled();
  });

  it("executes when estimate is under costLimit", async () => {
    const d = deps(MODIFY_LIMIT, { estimateCostUsd: () => 0.2 });
    const { result } = await createFabricService(d).execute(req());
    expect(result.status).toBe("success");
    expect(d.pipeline.executeNode).toHaveBeenCalled();
  });

  it("reports usage for executed runs and records policyInputs", async () => {
    const usages: unknown[] = [];
    const records: FabricExecutionRecord[] = [];
    const d = deps(ALLOW, {
      estimateCostUsd: () => 0.42,
      usage: { ingest: (u) => void usages.push(u) },
      policyInputsFor: () => ({ scope: { allowed: true } }),
      onRecord: (r) => records.push(r),
    });
    await createFabricService(d).execute(req());
    expect(usages).toHaveLength(1);
    expect((usages[0] as { costUsd: number }).costUsd).toBe(0.42);
    expect(records[0]?.policyInputs).toEqual({ scope: { allowed: true } });
    expect(records[0]?.costUsd).toBe(0.42);
  });

  it("does not report usage for denied results", async () => {
    const usages: unknown[] = [];
    const d = deps(DENY, { usage: { ingest: (u) => void usages.push(u) } });
    await createFabricService(d).execute(req());
    expect(usages).toHaveLength(0);
  });
});

describe("FabricService — stream (11.2)", () => {
  it("ALLOW emits policy → running → stdout → done in order with the final result", async () => {
    const events: ExecutionEvent[] = [];
    const { result } = await createFabricService(deps(ALLOW)).stream(req(), (e) => events.push(e));
    expect(result.status).toBe("success");
    expect(events.map((e) => e.type)).toEqual(["policy", "status", "stdout", "status"]);
    const [policy, running, , done] = events;
    expect(policy.type === "policy" && policy.decision.decision).toBe("ALLOW");
    expect(running.type === "status" && running.state).toBe("running");
    expect(done.type === "status" && done.state).toBe("done");
  });

  it("DENY emits only the policy event and never executes", async () => {
    const events: ExecutionEvent[] = [];
    const d = deps(DENY);
    const { result } = await createFabricService(d).stream(req(), (e) => events.push(e));
    expect(result.status).toBe("denied");
    expect(events.map((e) => e.type)).toEqual(["policy"]);
    expect(d.pipeline.executeNode).not.toHaveBeenCalled();
  });

  it("surfaces stderr breadcrumbs when the run fails", async () => {
    const events: ExecutionEvent[] = [];
    const failing = vi.fn(async (node: RuntimeNode): Promise<ToolExecutionResult> => {
      const now = Date.now();
      return {
        id: node.id,
        status: "failed",
        output: { stderr: "boom" },
        timing: { start: now, end: now },
        trace: { policyDecisionId: node.id, executionId: "e2" },
      };
    });
    const d = deps(ALLOW, { pipeline: { decideFor: () => ALLOW, executeNode: failing } });
    await createFabricService(d).stream(req(), (e) => events.push(e));
    expect(events.some((e) => e.type === "stderr" && e.data === "boom")).toBe(true);
  });
});
