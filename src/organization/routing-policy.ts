/**
 * Organization routing-policy SoT (evolution control-plane adapter).
 *
 * Tasks stay in task-assignment.ts. This module only versions the routing
 * policy used for *new* tasks. It never rewrites in-flight or completed work.
 */

import type { TaskAssignment, TaskAssignmentStatus } from "./task-assignment.js";

export const ORGANIZATION_ROUTING_STRATEGIES = [
  "discussion_driven",
  "task_driven",
  "review_driven",
] as const;
export type OrganizationRoutingStrategyId = (typeof ORGANIZATION_ROUTING_STRATEGIES)[number];

export const IN_FLIGHT_TASK_STATUSES: ReadonlySet<TaskAssignmentStatus> = new Set([
  "pending",
  "accepted",
  "running",
]);

export type OrganizationRoutingPolicy = {
  groupId: string;
  revision: number;
  strategyId: OrganizationRoutingStrategyId;
  defaultOwnerAgentId: string;
  memberIds: string[];
};

export type OrganizationShadowAssignment = {
  title: string;
  proposedOwnerAgentId: string;
};

export type OrganizationShadowPlan = {
  groupId: string;
  policyRevisionBefore: number;
  candidateRevision: number;
  inFlightTaskIds: string[];
  newTaskProjections: OrganizationShadowAssignment[];
  mutatesInFlightTasks: false;
};

export function isInFlightTask(assignment: Pick<TaskAssignment, "status">): boolean {
  return IN_FLIGHT_TASK_STATUSES.has(assignment.status);
}

export function routingPolicyVersion(policy: OrganizationRoutingPolicy): string {
  return `org:${policy.groupId}:${policy.revision}:${policy.strategyId}:${policy.defaultOwnerAgentId}`;
}

export function previewNewTaskOwner(policy: OrganizationRoutingPolicy, _title: string): string {
  void _title;
  return policy.defaultOwnerAgentId;
}

export function buildOrganizationShadowPlan(params: {
  current: OrganizationRoutingPolicy;
  candidate: OrganizationRoutingPolicy;
  tasks: readonly Pick<TaskAssignment, "id" | "status">[];
  sampleNewTaskTitles?: readonly string[];
}): OrganizationShadowPlan {
  return {
    groupId: params.current.groupId,
    policyRevisionBefore: params.current.revision,
    candidateRevision: params.candidate.revision,
    inFlightTaskIds: params.tasks.filter(isInFlightTask).map((row) => row.id),
    newTaskProjections: (params.sampleNewTaskTitles ?? []).map((title) => ({
      title,
      proposedOwnerAgentId: previewNewTaskOwner(params.candidate, title),
    })),
    mutatesInFlightTasks: false,
  };
}

export function nextRoutingPolicy(
  current: OrganizationRoutingPolicy,
  patch: Partial<
    Pick<OrganizationRoutingPolicy, "strategyId" | "defaultOwnerAgentId" | "memberIds">
  >,
): OrganizationRoutingPolicy {
  return {
    ...current,
    ...patch,
    revision: current.revision + 1,
  };
}
