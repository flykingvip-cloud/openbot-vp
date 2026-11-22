import { describe, expect, it, vi } from "vitest";
import { AdapterRegistry } from "./adapter-registry.js";
import type { PolicyDecision, RuntimeNode, ToolRequest } from "./contract.js";
import {
  buildExecuteNode,
  type RunnerResult,
  type ToolInvocation,
  type ToolRunner,
} from "./execution.js";

const ALLOW: PolicyDecision = { decision: "ALLOW", matchedRules: [], decisionTrace: [] };

function req(name = "agent:summarize", args: string[] = ["do", "x"]): ToolRequest {
  return {
    id: "n-agent",
    source: { type: "cursor" },
    tool: { name },
    input: { args },
    context: {},
    trace: { sessionId: "s1", correlationId: "c1" },
  };
}

function agentNode(request: ToolRequest): RuntimeNode {
  return { id: request.id, type: "agent", request, dependsOn: [], status: "pending" };
}

describe("execution — agent node fail-closed without agentRunner", () => {
  it("fails an agent node when agentRunner is missing and does not call the tool runner", async () => {
    const run = vi.fn(async (_inv: ToolInvocation): Promise<RunnerResult> => {
      return { ok: true, stdout: "tool-should-not-run", exitCode: 0 };
    });
    const runner: ToolRunner = { run };

    // An agent node must not fall through to the tool runner without an agent runner.
    const execute = buildExecuteNode(new AdapterRegistry([]), runner);
    const res = await execute(agentNode(req()), ALLOW);

    expect(res.status).toBe("failed");
    expect(res.output?.stderr).toMatch(/no agent runner configured/i);
    expect(run).not.toHaveBeenCalled();
  });
});
