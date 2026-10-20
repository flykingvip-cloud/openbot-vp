/**
 * service.ts — the Fabric facade behind the public API (R7).
 *
 * Assembles the pipeline (decide + execute), adapter registry, and audit sink
 * into three operations that map 1:1 to the public methods:
 *  - `check(request)`  → POST /v1/policy/check  (dry-run: decide only, R7.2)
 *  - `execute(request)`→ POST /v1/tool/execute  (full pipeline, R7.1)
 *  - `registerAdapter` → POST /v1/adapter/register (R7.4)
 *
 * Dependencies are injected so the facade is testable without the gateway and
 * so the real enforcement-point probes / TOL runner are supplied at wiring time
 * (task 9.2). All results preserve trace identity (R7.6).
 */

import type { AdapterRegistry } from "./adapter-registry.js";
import { buildExecutionRecord, type FabricExecutionRecord } from "./audit.js";
import type {
  DecisionTrace,
  ExecutionConstraints,
  ExecutionEvent,
  PolicyDecision,
  ToolAdapter,
  ToolExecutionResult,
  ToolRequest,
} from "./contract.js";
import { buildUsage, exceedsCostLimit, reportUsage, type UsageIngestPort } from "./cost.js";
import { compileGraph, runGraph, type PipelineDeps } from "./gateway.js";
import { constraintsFromDecision, type OwnershipMetadata } from "./mappers.js";
import { type GraphContext, singleToolGraph } from "./plan-adapter.js";
import type { PolicyInputs } from "./policy-runtime.js";
import { policyEvent } from "./streaming.js";

/** Dry-run decision result returned by `check` (mirrors PolicyDecision shape). */
export interface CheckResult {
  decision: PolicyDecision["decision"];
  constraints?: ExecutionConstraints;
  reason?: string;
  matchedRules: string[];
  decisionTrace: DecisionTrace;
}

export interface FabricServiceDeps {
  pipeline: PipelineDeps;
  registry: AdapterRegistry;
  /** Optional audit sink (e.g. control-plane-audit). */
  onRecord?: (record: FabricExecutionRecord) => void;
  /** Optional Loom ownership resolver (compile-time metadata). */
  ownershipFor?: (request: ToolRequest) => OwnershipMetadata | undefined;
  /** Optional usage/billing sink (reuses gateway usage-ingest). */
  usage?: UsageIngestPort;
  /** Optional pre-execution cost estimate (USD) for costLimit enforcement. */
  estimateCostUsd?: (request: ToolRequest) => number;
  /** Optional replay-snapshot inputs recorded with the audit record (R17.1). */
  policyInputsFor?: (request: ToolRequest) => PolicyInputs | undefined;
}

export interface FabricService {
  check(request: ToolRequest): CheckResult;
  execute(request: ToolRequest): Promise<{ result: ToolExecutionResult }>;
  /**
   * Same pipeline as `execute`, but emits `ExecutionEvent`s through `onEvent`
   * as the run progresses (R12). Reuses the compile-time decision for the
   * `policy` event; the delivery layer (gateway) forwards these over the
   * existing `tool-events` transport. External messaging surfaces never receive
   * these partial events (R12.3) — only the final result.
   */
  stream(
    request: ToolRequest,
    onEvent: (event: ExecutionEvent) => void,
  ): Promise<{ result: ToolExecutionResult }>;
  registerAdapter(raw: unknown): ToolAdapter;
}

function graphContext(request: ToolRequest): GraphContext {
  return {
    graphId: request.id,
    sessionId: request.trace.sessionId,
    correlationId: request.trace.correlationId,
    tenantId: request.source.tenantId,
  };
}

function toCheckResult(decision: PolicyDecision): CheckResult {
  return {
    decision: decision.decision,
    constraints: decision.decision === "DENY" ? undefined : decision.constraints,
    reason: decision.decision === "DENY" ? decision.reason : undefined,
    matchedRules: decision.matchedRules,
    decisionTrace: decision.decisionTrace,
  };
}

export function createFabricService(deps: FabricServiceDeps): FabricService {
  /**
   * Shared compile → (cost-gate) → execute core for `execute` and `stream`.
   * Returns the compile-time decision (single decision point, R21) plus the
   * final result; the decision is reused for audit and the `policy` event.
   */
  async function runPipeline(request: ToolRequest): Promise<{
    decision: PolicyDecision | undefined;
    result: ToolExecutionResult;
  }> {
    const compiled = compileGraph(singleToolGraph(request, graphContext(request)), deps.pipeline);
    const node = compiled.nodes[0];
    const decision = node.type === "tool" || node.type === "agent" ? node.policy : undefined;
    const constraints = decision ? constraintsFromDecision(decision) : undefined;
    const estimate = deps.estimateCostUsd?.(request) ?? 0;

    let result: ToolExecutionResult;
    if (decision && decision.decision !== "DENY" && exceedsCostLimit(constraints, estimate)) {
      // Cost ceiling enforcement (R11.2): refuse before executing.
      const now = Date.now();
      result = {
        id: node.id,
        status: "failed",
        output: { stderr: `cost_limit_exceeded: est ${estimate} >= ${constraints?.costLimit}` },
        timing: { start: now, end: now },
        trace: { policyDecisionId: node.id, executionId: `exec-${now}` },
      };
    } else {
      [result] = (await runGraph(compiled, deps.pipeline)) as [ToolExecutionResult];
    }

    // Audit (with replay-snapshot policyInputs + cost) using the compile-time decision.
    if (decision) {
      deps.onRecord?.(
        buildExecutionRecord({
          request,
          decision,
          result,
          ownership: deps.ownershipFor?.(request),
          policyInputs: deps.policyInputsFor?.(request),
          costUsd: estimate,
        }),
      );
    }
    // Best-effort usage reporting for actually-executed runs (not denied).
    if (deps.usage && result.status !== "denied") {
      await reportUsage(deps.usage, buildUsage(request, result, estimate));
    }
    return { decision, result };
  }

  return {
    check(request: ToolRequest): CheckResult {
      // Dry-run: decide only on the (trivial) node; never execute (R7.2).
      const [node] = singleToolGraph(request, graphContext(request)).nodes;
      return toCheckResult(deps.pipeline.decideFor(node));
    },

    async execute(request: ToolRequest): Promise<{ result: ToolExecutionResult }> {
      const { result } = await runPipeline(request);
      return { result };
    },

    async stream(
      request: ToolRequest,
      onEvent: (event: ExecutionEvent) => void,
    ): Promise<{ result: ToolExecutionResult }> {
      const { decision, result } = await runPipeline(request);
      // Explainability first: surface the compile-time decision on the stream (R12).
      if (decision) {
        onEvent(policyEvent(decision));
      }
      if (result.status === "denied") {
        // Denied runs never execute; the policy event already carried the reason.
        return { result };
      }
      onEvent({ type: "status", state: "running" });
      // The /tools/invoke boundary returns a final result (no partial token stream),
      // so map the captured output to stdout/stderr breadcrumbs, then signal done.
      if (result.output?.stdout) {
        onEvent({ type: "stdout", data: result.output.stdout });
      }
      if (result.output?.stderr) {
        onEvent({ type: "stderr", data: result.output.stderr });
      }
      onEvent({ type: "status", state: "done" });
      return { result };
    },

    registerAdapter(raw: unknown): ToolAdapter {
      return deps.registry.register(raw);
    },
  };
}
