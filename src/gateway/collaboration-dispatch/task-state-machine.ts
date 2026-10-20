import type { TaskStatus } from "@openbot/collaboration-core";
import type { CollaborationTaskState } from "./effective-policy.js";

const VALID_GOVERNANCE_TRANSITIONS: Record<CollaborationTaskState, CollaborationTaskState[]> = {
  OPEN: ["TRIAGED", "ASSIGNED", "CLOSED"],
  TRIAGED: ["ASSIGNED", "CLOSED"],
  ASSIGNED: ["IN_PROGRESS", "CLOSED"],
  IN_PROGRESS: ["REVIEW", "CLOSED"],
  REVIEW: ["REVISION", "READY", "CLOSED"],
  REVISION: ["REVIEW", "IN_PROGRESS", "CLOSED"],
  READY: ["HUMAN_DECISION", "DELIVERED", "CLOSED"],
  HUMAN_DECISION: ["DELIVERED", "REVISION", "CLOSED"],
  DELIVERED: ["CLOSED"],
  CLOSED: [],
};

export class InvalidGovernanceTaskTransitionError extends Error {
  readonly from: CollaborationTaskState;
  readonly to: CollaborationTaskState;

  constructor(from: CollaborationTaskState, to: CollaborationTaskState) {
    super(`Invalid governance task transition from "${from}" to "${to}"`);
    this.name = "InvalidGovernanceTaskTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function canTransitionGovernanceTask(
  from: CollaborationTaskState,
  to: CollaborationTaskState,
): boolean {
  return VALID_GOVERNANCE_TRANSITIONS[from].includes(to);
}

export function transitionGovernanceTask(
  from: CollaborationTaskState,
  to: CollaborationTaskState,
): CollaborationTaskState {
  if (!canTransitionGovernanceTask(from, to)) {
    throw new InvalidGovernanceTaskTransitionError(from, to);
  }
  return to;
}

export function mapLiveStatusToGovernance(status: TaskStatus): CollaborationTaskState {
  switch (status) {
    case "ready":
      return "ASSIGNED";
    case "in_progress":
    case "blocked":
      return "IN_PROGRESS";
    case "review":
      return "REVIEW";
    case "completed":
      return "DELIVERED";
    case "cancelled":
      return "CLOSED";
    default:
      return "OPEN";
  }
}

export function mapGovernanceToLiveStatus(state: CollaborationTaskState): TaskStatus {
  switch (state) {
    case "ASSIGNED":
    case "READY":
      return "ready";
    case "IN_PROGRESS":
    case "REVISION":
      return "in_progress";
    case "REVIEW":
    case "HUMAN_DECISION":
      return "review";
    case "DELIVERED":
    case "CLOSED":
      return "completed";
    default:
      return "draft";
  }
}

export function syncGovernanceAfterLiveTransition(params: {
  previous: CollaborationTaskState;
  liveStatus: TaskStatus;
}): CollaborationTaskState {
  const mapped = mapLiveStatusToGovernance(params.liveStatus);
  if (params.liveStatus === "in_progress" && params.previous === "REVIEW") {
    return "REVISION";
  }
  if (
    params.liveStatus === "ready" &&
    (params.previous === "REVIEW" || params.previous === "READY")
  ) {
    return "READY";
  }
  if (params.liveStatus === "review" && params.previous === "READY") {
    return "HUMAN_DECISION";
  }
  if (params.liveStatus === "completed" && params.previous === "HUMAN_DECISION") {
    return "DELIVERED";
  }
  return mapped;
}

function shortestGovernancePath(
  from: CollaborationTaskState,
  to: CollaborationTaskState,
): CollaborationTaskState[] | null {
  if (from === to) {
    return [];
  }
  const queue: CollaborationTaskState[][] = [[from]];
  const seen = new Set<CollaborationTaskState>([from]);
  while (queue.length > 0) {
    const path = queue.shift();
    if (!path) {
      break;
    }
    const current = path[path.length - 1];
    if (!current) {
      continue;
    }
    for (const next of VALID_GOVERNANCE_TRANSITIONS[current]) {
      if (seen.has(next)) {
        continue;
      }
      const nextPath = [...path, next];
      if (next === to) {
        return nextPath.slice(1);
      }
      seen.add(next);
      queue.push(nextPath);
    }
  }
  return null;
}

/**
 * Live Task SM stays authoritative. Each mapped hop still goes through
 * `transitionGovernanceTask` so the v1.1 machine is on the write path.
 */
export function applyGovernanceAfterLiveTransition(params: {
  previous: CollaborationTaskState;
  liveStatus: TaskStatus;
}): CollaborationTaskState {
  const target = syncGovernanceAfterLiveTransition(params);
  if (params.previous === target) {
    return target;
  }
  if (canTransitionGovernanceTask(params.previous, target)) {
    return transitionGovernanceTask(params.previous, target);
  }
  const hops = shortestGovernancePath(params.previous, target);
  if (!hops) {
    return target;
  }
  let current = params.previous;
  for (const next of hops) {
    current = transitionGovernanceTask(current, next);
  }
  return current;
}
