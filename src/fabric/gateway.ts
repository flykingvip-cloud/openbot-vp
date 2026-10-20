/**
 * gateway.ts — Fabric compile + execute pipeline (R2, R21).
 *
 * The pipeline is strictly:
 *   normalize → toGraph (plan-adapter, NO Fabric planning)
 *   → per node: compile-time decide (Policy Runtime) → attach decision
 *   → execute: GATE INVARIANT (node must carry a decision) → DENY short-circuit
 *     | MODIFY inject precomputed constraints | ALLOW → delegate to TOL
 *   → Trace Layer projection/record.
 *
 * Key invariants:
 *  - Single decision point: `decide` runs ONCE per node at compile time; the
 *    executor never re-evaluates policy (R21.1/R21.2).
 *  - Gate invariant: a node with no attached PolicyDecision cannot execute
 *    (R21.3) — enforced here regardless of graph shape.
 *  - Change = recompile: retry/rollback re-runs the pipeline; there is no
 *    runtime graph/policy mutation (R21.5).
 *
 * Dependencies (decideFor / executeNode) are injected so the pipeline is
 * testable without wiring the real enforcement points / TOL. Real wiring lands
 * with the compile probes (task 3 callers) and execution.ts (task 5.2).
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.2.
 */

import {
  parseContract,
  ToolRequest as ToolRequestSchema,
  type ExecutionGraphState,
  type PolicyDecision,
  type RuntimeNode,
  type ToolExecutionResult,
  type ToolRequest,
} from "./contract.js";
import { attachPolicy } from "./graph/state.js";
import { constraintsFromDecision } from "./mappers.js";
import { type GraphContext, singleToolGraph } from "./plan-adapter.js";

/** Decide a node's policy at compile time (injected: wraps Policy Runtime). */
export type DecideFor = (node: RuntimeNode) => PolicyDecision;

/** Execute an already-gated node against TOL (injected: wraps execution.ts). */
export type ExecuteNode = (
  node: RuntimeNode,
  decision: PolicyDecision,
) => Promise<ToolExecutionResult>;

export interface PipelineDeps {
  decideFor: DecideFor;
  executeNode: ExecuteNode;
}

/** Gateable node types carry a compile-time PolicyDecision. */
function isGateable(node: RuntimeNode): node is Extract<RuntimeNode, { type: "tool" | "agent" }> {
  return node.type === "tool" || node.type === "agent";
}

let executionSeq = 0;
function nextExecutionId(): string {
  executionSeq += 1;
  return `exec-${Date.now()}-${executionSeq}`;
}

function deniedResult(node: RuntimeNode, decision: PolicyDecision): ToolExecutionResult {
  const reason = decision.decision === "DENY" ? decision.reason : "policy gate failed";
  const now = Date.now();
  return {
    id: node.id,
    status: "denied",
    output: { stderr: reason },
    timing: { start: now, end: now },
    trace: { policyDecisionId: node.id, executionId: nextExecutionId() },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalization (source adapter table) — R2.1/R2.5
// ─────────────────────────────────────────────────────────────────────────────

/** Source-specific normalizer: raw payload → canonical ToolRequest. */
export type Normalizer = (raw: unknown) => ToolRequest;

const NORMALIZERS = new Map<string, Normalizer>();

/** Default normalizer: validate the payload directly as a ToolRequest. */
function defaultNormalize(raw: unknown): ToolRequest {
  return parseContract(ToolRequestSchema, raw, "ToolRequest");
}

/** Register a source-specific normalizer (extensible without touching the pipeline). */
export function registerNormalizer(sourceType: string, normalizer: Normalizer): void {
  NORMALIZERS.set(sourceType, normalizer);
}

/** Normalize a raw payload from a given source into a ToolRequest. */
export function normalize(sourceType: string, raw: unknown): ToolRequest {
  return (NORMALIZERS.get(sourceType) ?? defaultNormalize)(raw);
}

// ─────────────────────────────────────────────────────────────────────────────
// Compile (decide once, attach) + run (gate invariant + execute)
// ─────────────────────────────────────────────────────────────────────────────

/** Attach a compile-time PolicyDecision to every gateable node (decide once). */
export function compileGraph(state: ExecutionGraphState, deps: PipelineDeps): ExecutionGraphState {
  let next = state;
  for (const node of state.nodes) {
    if (isGateable(node)) {
      next = attachPolicy(next, node.id, deps.decideFor(node));
    }
  }
  return next;
}

/**
 * Execute a compiled graph in projection order. Enforces the gate invariant:
 * a gateable node with no attached decision is DENIED (never run). DENY
 * short-circuits that node; ALLOW/MODIFY delegate to TOL via `executeNode`.
 */
export async function runGraph(
  state: ExecutionGraphState,
  deps: PipelineDeps,
): Promise<ToolExecutionResult[]> {
  const results: ToolExecutionResult[] = [];
  for (const node of state.nodes) {
    if (!isGateable(node)) {
      continue; // fork/merge/policy/adapter/audit are not executed here
    }
    const decision = node.policy;
    if (!decision) {
      // Gate invariant (R21.3): no decision ⇒ cannot execute.
      results.push(
        deniedResult(node, {
          decision: "DENY",
          reason: "gate_invariant_no_decision",
          matchedRules: [],
          decisionTrace: [],
        }),
      );
      continue;
    }
    if (decision.decision === "DENY") {
      results.push(deniedResult(node, decision));
      continue;
    }
    results.push(await deps.executeNode(node, decision));
  }
  return results;
}

/** Full pipeline: compile (decide once) then run (gate + execute). */
export async function compileAndRun(
  state: ExecutionGraphState,
  deps: PipelineDeps,
): Promise<ToolExecutionResult[]> {
  return runGraph(compileGraph(state, deps), deps);
}

/** Convenience for the dominant v1 path: one tool request end-to-end. */
export async function compileAndRunSingle(
  req: ToolRequest,
  ctx: GraphContext,
  deps: PipelineDeps,
): Promise<ToolExecutionResult> {
  const state = singleToolGraph(req, ctx);
  const [result] = await compileAndRun(state, deps);
  return result;
}

/** Effective constraints attached to a node's decision (for the executor). */
export function nodeConstraints(decision: PolicyDecision) {
  return constraintsFromDecision(decision);
}
