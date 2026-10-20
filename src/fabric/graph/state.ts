/**
 * state.ts — ExecutionGraphState projection helpers (R20.5, R21.3, Trace Layer).
 *
 * The Trace Layer PROJECTS an AOR plan (or a trivial 1-node graph) and overlays
 * policy decisions + execution runs. It NEVER builds or reorders structure:
 * `nodes`/`edges` are kept exactly as produced by the plan adapter (task 4.1).
 * The resulting state doubles as the replay snapshot (R21.3).
 *
 * Design: `.kiro/specs/openbot-fabric/design.md` §3.2/§3.5.
 */

import {
  ExecutionGraphState,
  parseContract,
  type PolicyDecision,
  type RuntimeNode,
  type ToolExecutionRun,
} from "../contract.js";

export class GraphStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphStateError";
  }
}

/** Build + validate a projection state. Node/edge order is preserved as given. */
export function createGraphState(input: unknown): ExecutionGraphState {
  return parseContract(ExecutionGraphState, input, "ExecutionGraphState");
}

/** The node ids in projection order (used to assert no-reorder fidelity). */
export function nodeOrder(state: ExecutionGraphState): string[] {
  return state.nodes.map((n) => n.id);
}

/**
 * Overlay a compile-time PolicyDecision onto a Tool/Agent node, returning a new
 * state. Structure (node count/order/edges) is unchanged. Throws if the node is
 * not gateable (only tool/agent nodes carry a policy).
 */
export function attachPolicy(
  state: ExecutionGraphState,
  nodeId: string,
  decision: PolicyDecision,
): ExecutionGraphState {
  let found = false;
  const nodes = state.nodes.map((node): RuntimeNode => {
    if (node.id !== nodeId) {
      return node;
    }
    found = true;
    if (node.type !== "tool" && node.type !== "agent") {
      throw new GraphStateError(
        `Cannot attach policy to node "${nodeId}" of type "${node.type}" (only tool/agent).`,
      );
    }
    return { ...node, policy: decision };
  });
  if (!found) {
    throw new GraphStateError(`Node "${nodeId}" not found in graph "${state.graphId}".`);
  }
  return { ...state, nodes };
}

/** Add or replace a ToolExecutionRun by id, returning a new state. */
export function upsertRun(state: ExecutionGraphState, run: ToolExecutionRun): ExecutionGraphState {
  const idx = state.runs.findIndex((r) => r.id === run.id);
  const runs = idx >= 0 ? state.runs.map((r) => (r.id === run.id ? run : r)) : [...state.runs, run];
  return { ...state, runs };
}

/**
 * Assert that `state` preserves the node order of a reference projection
 * (projection-fidelity guard: Trace Layer must not reorder, R20.5).
 */
export function assertSameOrder(reference: string[], state: ExecutionGraphState): void {
  const order = nodeOrder(state);
  const same = order.length === reference.length && order.every((id, i) => id === reference[i]);
  if (!same) {
    throw new GraphStateError(
      `Projection reordered nodes: expected [${reference.join(", ")}], got [${order.join(", ")}].`,
    );
  }
}
