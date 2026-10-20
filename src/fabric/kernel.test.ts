import { describe, expect, it, vi } from "vitest";
import type { PolicyDecision, ToolRequest } from "./contract.js";
import {
  budgetFromConstraints,
  createKernelAgentRunner,
  type KernelOrchestrator,
  runKernel,
} from "./kernel.js";

function req(args: string[] = ["summarize", "this"], tenantId?: string): ToolRequest {
  return {
    id: "run-1",
    source: { type: "openbot", userId: "u1", tenantId },
    tool: { name: "agent:summarize" },
    input: { args },
    context: {},
    trace: { sessionId: "s1", correlationId: "c1" },
  };
}

const ALLOW: PolicyDecision = { decision: "ALLOW", matchedRules: [], decisionTrace: [] };

describe("kernel — budgetFromConstraints", () => {
  it("maps costLimit to a budget; undefined otherwise", () => {
    expect(budgetFromConstraints({ costLimit: 0.5 })).toBe(0.5);
    expect(budgetFromConstraints({})).toBeUndefined();
    expect(budgetFromConstraints(undefined)).toBeUndefined();
  });
});

describe("kernel — runKernel (delegates to AOR; no policy)", () => {
  function fakeOrchestrator() {
    const run = vi.fn(
      async (
        _task: Parameters<KernelOrchestrator["run"]>[0],
        _opts: Parameters<KernelOrchestrator["run"]>[1],
      ) => ({ runId: "run-1", output: { text: "result" } }),
    );
    return { run } satisfies KernelOrchestrator;
  }

  it("delegates with goal from args, tenant context and budget", async () => {
    const orch = fakeOrchestrator();
    const MODIFY: PolicyDecision = {
      decision: "MODIFY",
      constraints: { costLimit: 1.25 },
      matchedRules: [],
      decisionTrace: [],
    };
    const out = await runKernel(orch, {
      request: req(["do", "x"], "t1"),
      decision: MODIFY,
      strategy: "balanced",
    });
    expect(out).toEqual({ runId: "run-1", text: "result" });
    expect(orch.run).toHaveBeenCalledWith(
      { goal: "do x", constraints: { budgetUsd: 1.25 } },
      {
        strategy: "balanced",
        runId: "run-1",
        tenant: { userId: "u1", tenantId: "t1" },
        sessionKey: undefined,
      },
    );
  });

  it("omits tenant context when source has neither user nor tenant", async () => {
    const orch = fakeOrchestrator();
    await runKernel(orch, {
      request: {
        ...req(["g"]),
        source: { type: "openbot" },
      },
      decision: ALLOW,
    });
    const call = orch.run.mock.calls[0]?.[1];
    expect(call?.tenant).toBeUndefined();
  });

  it("falls back to tool name as goal when no args", async () => {
    const orch = fakeOrchestrator();
    await runKernel(orch, { request: { ...req([]), input: {} }, decision: ALLOW });
    expect(orch.run.mock.calls[0]?.[0].goal).toBe("agent:summarize");
  });
});

describe("kernel — createKernelAgentRunner (ExecuteNode adapter)", () => {
  function agentNode() {
    return {
      id: "run-1",
      type: "agent" as const,
      request: req(["do", "x"]),
      dependsOn: [],
      status: "pending" as const,
    };
  }

  it("runs an agent node via AOR and maps text → stdout success", async () => {
    const run = vi.fn(async () => ({ runId: "run-1", output: { text: "kernel-out" } }));
    const runner = createKernelAgentRunner({ run } satisfies KernelOrchestrator);
    const res = await runner(agentNode(), ALLOW);
    expect(res.status).toBe("success");
    expect(res.output?.stdout).toBe("kernel-out");
  });

  it("maps orchestrator failure to status:failed (no throw)", async () => {
    const runner = createKernelAgentRunner({
      run: async () => {
        throw new Error("aor down");
      },
    });
    const res = await runner(agentNode(), ALLOW);
    expect(res.status).toBe("failed");
    expect(res.output?.stderr).toBe("aor down");
  });
});
