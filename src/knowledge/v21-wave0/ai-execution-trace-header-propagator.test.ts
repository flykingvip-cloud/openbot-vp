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
