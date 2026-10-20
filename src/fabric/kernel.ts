/**
 * kernel.ts — thin Agent Kernel (AOR) wrapper + routing handoff (R6, R18).
 *
 * Cognitive execution (LLM / multi-step orchestration) is delegated to AOR's
 * `Orchestrator`; Fabric does NOT reimplement routing/memory/skills. The Kernel
 * does NOT participate in policy (R6.2): a node only reaches here AFTER the
 * compile-time Policy Gate returned ALLOW/MODIFY.
 *
 * Routing intelligence extends AOR's `Selector`/`SelectionStrategy` (R18); v1
 * just hands the `costLimit` constraint through as the AOR budget (cost-aware
 * minimum). Tenant context is built from the request source (R6.3).
 *
 * The Orchestrator is injected via a narrow port so this module does not pull
 * the whole AOR runtime into Fabric's graph; the gateway/agent-node executor
 * supplies it.
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.6.
 */

import type { SelectionStrategy, TenantContext } from "@openbot/aor-core";
import type {
  ExecutionConstraints,
  PolicyDecision,
  RuntimeNode,
  ToolExecutionResult,
  ToolRequest,
} from "./contract.js";
import type { ExecuteNode } from "./gateway.js";
import { constraintsFromDecision, tenantContextFromSource } from "./mappers.js";

/** Narrow port over AOR `Orchestrator.run` (avoids importing the full runtime). */
export interface KernelOrchestrator {
  run(
    task: { goal: string; constraints?: { budgetUsd?: number } },
    opts: {
      strategy?: SelectionStrategy;
      runId?: string;
      tenant?: TenantContext;
      sessionKey?: string;
    },
  ): Promise<{ runId: string; output: { text: string } }>;
}

/** Options derived from a request + its (already-decided) policy. */
export interface KernelRunInputs {
  request: ToolRequest;
  decision: PolicyDecision;
  strategy?: SelectionStrategy;
  sessionKey?: string;
}

/** Map a Fabric constraint's costLimit into an AOR budget (cost-aware routing). */
export function budgetFromConstraints(
  constraints: ExecutionConstraints | undefined,
): number | undefined {
  return typeof constraints?.costLimit === "number" ? constraints.costLimit : undefined;
}

/**
 * Run a cognitive (agent) node through AOR. Builds tenant context + budget from
 * the request/decision; never re-evaluates policy.
 */
export async function runKernel(
  orchestrator: KernelOrchestrator,
  inputs: KernelRunInputs,
): Promise<{ runId: string; text: string }> {
  const { request, decision } = inputs;
  const tenant: TenantContext = tenantContextFromSource(request.source);
  const budgetUsd = budgetFromConstraints(constraintsFromDecision(decision));
  const goal = request.input.args?.join(" ") ?? request.tool.name;
  const result = await orchestrator.run(
    { goal, constraints: budgetUsd !== undefined ? { budgetUsd } : undefined },
    {
      strategy: inputs.strategy,
      runId: request.id,
      tenant: tenant.tenantId || tenant.userId ? tenant : undefined,
      sessionKey: inputs.sessionKey,
    },
  );
  return { runId: result.runId, text: result.output.text };
}

/**
 * Adapt the Kernel into an `ExecuteNode` for agent nodes: runs AOR and maps the
 * cognitive output text to a ToolExecutionResult. Never throws (failures become
 * status:"failed"); only reached for ALLOW/MODIFY agent nodes.
 */
export function createKernelAgentRunner(
  orchestrator: KernelOrchestrator,
  opts: { strategy?: SelectionStrategy } = {},
): ExecuteNode {
  return async (node: RuntimeNode, decision: PolicyDecision): Promise<ToolExecutionResult> => {
    const start = Date.now();
    const request = node.type === "agent" ? node.request : undefined;
    if (!request) {
      return {
        id: node.id,
        status: "failed",
        output: { stderr: `node "${node.id}" is not an agent node` },
        timing: { start, end: Date.now() },
        trace: { policyDecisionId: node.id, executionId: `kernel-${start}` },
      };
    }
    try {
      const out = await runKernel(orchestrator, { request, decision, strategy: opts.strategy });
      return {
        id: node.id,
        status: "success",
        output: { stdout: out.text },
        timing: { start, end: Date.now() },
        trace: { policyDecisionId: node.id, executionId: out.runId },
      };
    } catch (err) {
      return {
        id: node.id,
        status: "failed",
        output: { stderr: err instanceof Error ? err.message : String(err) },
        timing: { start, end: Date.now() },
        trace: { policyDecisionId: node.id, executionId: `kernel-${start}` },
      };
    }
  };
}
