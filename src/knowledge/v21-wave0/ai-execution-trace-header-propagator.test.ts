import { describe, expect, it } from "vitest";
import {
  AI_EXECUTION_TRACE_HEADER_KEYS,
  AI_EXECUTION_TRACE_HEADER_PROPAGATOR_ENABLED_DEFAULT,
  createAiExecutionTraceHeaderPropagator,
} from "./ai-execution-trace-header-propagator.js";

const complete = {
  tenant_id: "syn_org",
  user_id: "syn_user",
  agent_id: "syn_agent",
  trace_id: "syn_trace",
  run_id: "syn_run",
  plan_id: "syn_plan",
  policy_generation: 9,
};

describe("AIExecutionTraceHeaderPropagator", () => {
  it("is default-off and lists the official seven keys", () => {
    expect(AI_EXECUTION_TRACE_HEADER_PROPAGATOR_ENABLED_DEFAULT).toBe(false);
    expect([...AI_EXECUTION_TRACE_HEADER_KEYS]).toEqual([
      "tenant_id",
      "user_id",
      "agent_id",
      "trace_id",
      "run_id",
      "plan_id",
      "policy_generation",
    ]);
    const propagator = createAiExecutionTraceHeaderPropagator();
    expect(propagator.propagate(complete)).toEqual({
      ok: false,
      reason: "PROPAGATOR_DISABLED",
      missing: [],
    });
  });

  it("when enabled, accepts snake_case or camelCase and fails closed on gaps", () => {
    const propagator = createAiExecutionTraceHeaderPropagator({ enabled: true });
    const ok = propagator.propagate({
      tenantId: "syn_org",
      userId: "syn_user",
      agentId: "syn_agent",
      traceId: "syn_trace",
      runId: "syn_run",
      planId: "syn_plan",
      policyGeneration: 9,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.headers).toEqual(complete);
      expect(ok.outgoing["x-openbot-trace-id"]).toBe("syn_trace");
    }
    const missing = propagator.propagate({ tenant_id: "syn_org", run_id: "syn_run" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.reason).toBe("MISSING_OR_INVALID_HEADER");
      expect(missing.missing).toContain("trace_id");
      expect(missing.missing).toContain("policy_generation");
    }
  });
});

function headersFromOutgoing(outgoing: Record<string, string>) {
  return {
    tenant_id: outgoing["x-openbot-tenant-id"],
    user_id: outgoing["x-openbot-user-id"],
    agent_id: outgoing["x-openbot-agent-id"],
    trace_id: outgoing["x-openbot-trace-id"],
    run_id: outgoing["x-openbot-run-id"],
    plan_id: outgoing["x-openbot-plan-id"],
    policy_generation: Number(outgoing["x-openbot-policy-generation"]),
  };
}

describe("AIExecutionTraceHeaderPropagator Gateway ↔ AOR ↔ Knowledge Adapter hops", () => {
  it("is default-off across Gateway, AOR Backend, and Knowledge Adapter hops", () => {
    const gateway = createAiExecutionTraceHeaderPropagator();
    const aor = createAiExecutionTraceHeaderPropagator();
    const adapter = createAiExecutionTraceHeaderPropagator();
    expect(gateway.enabled).toBe(false);
    expect(aor.enabled).toBe(false);
    expect(adapter.enabled).toBe(false);
    expect(gateway.propagate(complete).ok).toBe(false);
    expect(aor.propagate(complete).ok).toBe(false);
    expect(adapter.propagate(complete).ok).toBe(false);
  });

  it("when enabled, the official seven keys survive Gateway → AOR Backend → Knowledge Adapter and fail closed if a hop drops a key", () => {
    const gateway = createAiExecutionTraceHeaderPropagator({ enabled: true });
    const aor = createAiExecutionTraceHeaderPropagator({ enabled: true });
    const adapter = createAiExecutionTraceHeaderPropagator({ enabled: true });

    const fromGateway = gateway.propagate(complete);
    expect(fromGateway.ok).toBe(true);
    if (!fromGateway.ok) {
      return;
    }
    const fromAor = aor.propagate(headersFromOutgoing(fromGateway.outgoing));
    expect(fromAor.ok).toBe(true);
    if (!fromAor.ok) {
      return;
    }
    const fromAdapter = adapter.propagate(headersFromOutgoing(fromAor.outgoing));
    expect(fromAdapter.ok).toBe(true);
    if (fromAdapter.ok) {
      expect(fromAdapter.headers).toEqual(complete);
      expect(Object.keys(fromAdapter.headers)).toEqual([...AI_EXECUTION_TRACE_HEADER_KEYS]);
    }

    const dropped = { ...complete, trace_id: "" };
    const brokenHop = aor.propagate(dropped);
    expect(brokenHop.ok).toBe(false);
    if (!brokenHop.ok) {
      expect(brokenHop.reason).toBe("MISSING_OR_INVALID_HEADER");
      expect(brokenHop.missing).toContain("trace_id");
    }
  });
});
