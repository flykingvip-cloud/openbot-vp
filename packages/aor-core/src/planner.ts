import type { Task, TaskTypeId } from "./types.js";

/**
 * Planner (Stage 2).
 *
 * Turns a parsed task into a Task Graph (DAG). Stage 1 executed a single node;
 * Stage 2 lets a task decompose into multiple dependent steps that the
 * Orchestrator runs with topological + parallel scheduling.
 */

export interface PlanNode {
  id: string;
  taskType: TaskTypeId;
  /** Skill to use; falls back to the task type's default skill if omitted. */
  skillId?: string;
  /** Sub-goal for this node. */
  goal: string;
  /** Node ids this node depends on (their outputs feed this node). */
  dependsOn: string[];
}

export interface TaskGraph {
  rootTaskType: TaskTypeId;
  nodes: PlanNode[];
  /** Node whose output is the task's final result (defaults to last terminal). */
  terminalId?: string;
}

export interface Planner {
  plan(task: Task): Promise<TaskGraph>;
}

/** Validate a graph: unique ids, known deps, and acyclic. Returns topo order. */
export function topologicalOrder(graph: TaskGraph): PlanNode[] {
  const byId = new Map<string, PlanNode>();
  for (const node of graph.nodes) {
    if (byId.has(node.id)) {
      throw new Error(`Duplicate plan node id: ${node.id}`);
    }
    byId.set(node.id, node);
  }
  for (const node of graph.nodes) {
    for (const dep of node.dependsOn) {
      if (!byId.has(dep)) {
        throw new Error(`Plan node "${node.id}" depends on unknown node "${dep}"`);
      }
    }
  }

  const visited = new Set<string>();
  const inProgress = new Set<string>();
  const order: PlanNode[] = [];

  const visit = (node: PlanNode): void => {
    if (visited.has(node.id)) {
      return;
    }
    if (inProgress.has(node.id)) {
      throw new Error(`Cycle detected in task graph at node "${node.id}"`);
    }
    inProgress.add(node.id);
    for (const dep of node.dependsOn) {
      visit(byId.get(dep) as PlanNode);
    }
    inProgress.delete(node.id);
    visited.add(node.id);
    order.push(node);
  };

  for (const node of graph.nodes) {
    visit(node);
  }
  return order;
}

/**
 * Group nodes into dependency "levels": all nodes in a level can run in
 * parallel because their dependencies are satisfied by earlier levels.
 */
export function executionLevels(graph: TaskGraph): PlanNode[][] {
  const order = topologicalOrder(graph);
  const depth = new Map<string, number>();
  const byId = new Map(order.map((n) => [n.id, n]));
  for (const node of order) {
    const d =
      node.dependsOn.length === 0
        ? 0
        : 1 + Math.max(...node.dependsOn.map((dep) => depth.get(dep) ?? 0));
    depth.set(node.id, d);
  }
  const levels: PlanNode[][] = [];
  for (const node of order) {
    const d = depth.get(node.id) ?? 0;
    (levels[d] ??= []).push(byId.get(node.id) as PlanNode);
  }
  return levels;
}

/** Default planner: one node, equivalent to Stage 1 behaviour. */
export class SingleNodePlanner implements Planner {
  plan(task: Task): Promise<TaskGraph> {
    const taskType = task.type ?? "coding.review";
    const node: PlanNode = {
      id: "n0",
      taskType,
      goal: task.goal,
      dependsOn: [],
    };
    return Promise.resolve({ rootTaskType: taskType, nodes: [node], terminalId: "n0" });
  }
}

/** Build a planner from a static decomposition table keyed by task type. */
export type GraphTemplate = (task: Task) => TaskGraph | undefined;

export class StaticGraphPlanner implements Planner {
  constructor(
    private readonly template: GraphTemplate,
    private readonly fallback: Planner = new SingleNodePlanner(),
  ) {}

  async plan(task: Task): Promise<TaskGraph> {
    const graph = this.template(task);
    if (graph) {
      // Validate eagerly so authoring mistakes fail fast.
      topologicalOrder(graph);
      return graph;
    }
    return this.fallback.plan(task);
  }
}
