/**
 * plan-adapter.ts — turn requests into an ExecutionGraphState PROJECTION (R20).
 *
 * Fabric NEVER plans: it does not build DAGs, derive dependencies, or reorder.
 * Two entry points:
 *  - `singleToolGraph(req)`: the dominant v1 path — a trivial 1-node graph for a
 *    single tool call; AOR's planner is not involved (R20.2).
 *  - `projectAorPlan(plan, ctx)`: when AOR produced a multi-step `ExecutionPlan`,
 *    project it 1:1 into a graph — one node per `PlannedStep`, edges copied
 *    VERBATIM from `plan.edges`, order preserved (R20.1/R20.3/R20.5).
 *  - `graphFromToolRequests(reqs, ctx)`: N independent tool nodes, NO fabricated
 *    edges (Fabric never invents dependencies).
 *
 * Note on impedance: an AOR `PlannedStep` is a cognitive (model/skill) step, not
 * a raw tool invocation. We project it to an `agent` node whose request wraps the
 * skill (`tool.name = "agent:<skillId>"`); the cognitive detail stays inside AOR
 * — Fabric only gates + traces the projected node.
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.2.
 */

import type { ExecutionPlan } from "@openbot/aor-core";
import {
  type ExecutionGraphState,
  parseContract,
  type RuntimeEdge,
  type RuntimeNode,
  type ToolRequest,
} from "./contract.js";
import { ExecutionGraphState as ExecutionGraphStateSchema } from "./contract.js";

/** Minimal context needed to build a graph's trace envelope. */
export interface GraphContext {
  graphId: string;
  sessionId: string;
  correlationId: string;
  tenantId?: string;
  /** Loom-derived ownership (mapped at compile time; no runtime lookup). */
  ownership?: Record<string, unknown>;
}

function envelope(ctx: GraphContext, nodes: RuntimeNode[], edges: RuntimeEdge[] = []) {
  return parseContract(
    ExecutionGraphStateSchema,
    {
      graphId: ctx.graphId,
      nodes,
      edges,
      runs: [],
      context: {
        tenantId: ctx.tenantId,
        sessionId: ctx.sessionId,
        correlationId: ctx.correlationId,
        ownership: ctx.ownership ?? {},
      },
    },
    "ExecutionGraphState",
  );
}

/** Trivial 1-node graph for a single tool call (no planner). */
export function singleToolGraph(req: ToolRequest, ctx: GraphContext): ExecutionGraphState {
  const node: RuntimeNode = {
    id: req.id,
    type: "tool",
    request: req,
    dependsOn: [],
    status: "pending",
  };
  return envelope(ctx, [node]);
}

/** N independent tool nodes; never fabricates edges/dependencies. */
export function graphFromToolRequests(reqs: ToolRequest[], ctx: GraphContext): ExecutionGraphState {
  const nodes: RuntimeNode[] = reqs.map((req) => ({
    id: req.id,
    type: "tool",
    request: req,
    dependsOn: [],
    status: "pending",
  }));
  return envelope(ctx, nodes);
}

function stepRequest(stepId: string, skillId: string, ctx: GraphContext): ToolRequest {
  return {
    id: stepId,
    source: { type: "openbot", tenantId: ctx.tenantId },
    tool: { name: `agent:${skillId}` },
    input: {},
    context: {},
    trace: { sessionId: ctx.sessionId, correlationId: ctx.correlationId },
  };
}

/**
 * Project an AOR ExecutionPlan into a graph 1:1. Steps keep their order; node
 * `dependsOn` and graph `edges` are copied VERBATIM from `plan.edges` — Fabric
 * neither derives nor reorders dependencies (R20.1/R20.5).
 */
export function projectAorPlan(plan: ExecutionPlan, ctx: GraphContext): ExecutionGraphState {
  // Map step id → incoming dependency ids, straight from AOR's edges.
  const incoming = new Map<string, string[]>();
  for (const edge of plan.edges) {
    const list = incoming.get(edge.to) ?? [];
    list.push(edge.from);
    incoming.set(edge.to, list);
  }
  const nodes: RuntimeNode[] = plan.steps.map((step) => ({
    id: step.id,
    type: "agent",
    request: stepRequest(step.id, step.skillId, ctx),
    dependsOn: incoming.get(step.id) ?? [],
    status: "pending",
  }));
  const edges: RuntimeEdge[] = plan.edges.map((e) => ({ from: e.from, to: e.to, kind: "control" }));
  return envelope(ctx, nodes, edges);
}
