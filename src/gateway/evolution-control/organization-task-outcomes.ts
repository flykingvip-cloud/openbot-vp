import type { ObservationWindow } from "@openbot/evolution-core";
import {
  taskAssignmentLatencyMs,
  type TaskAssignment,
} from "../../organization/task-assignment.js";
import type { SkillInvocationEvent } from "../skill-invocation/types.js";
import {
  crossTenantFromIds,
  percentileNearestRank,
  securityViolationFromFailureCategory,
  type CohortOutcome,
} from "./observation-cohort.js";

export type OrganizationTaskObservation = CohortOutcome & {
  taskId: string;
  groupId: string;
  ownerAgentId: string;
  createdByAgentId: string;
  ownerSkillInvocationRefs: string[];
  criticalInconclusive: boolean;
};

export type OwnerSkillAttribution = {
  invocationRefs: string[];
  securityViolation?: boolean;
  crossTenantContamination?: boolean;
  skillLatencyMs?: number;
  conflicting: boolean;
};

function hasId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function uniqueNonEmpty(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter(hasId))];
}

export function isOwnerSkillAttributedToTask(
  event: SkillInvocationEvent,
  task: Pick<TaskAssignment, "id" | "ownerAgentId" | "runId">,
): event is Extract<SkillInvocationEvent, { type: "skill_invocation_completed" }> {
  if (event.type !== "skill_invocation_completed") {
    return false;
  }
  if (event.outcome === "cancelled") {
    return false;
  }
  if (event.agentId !== task.ownerAgentId) {
    return false;
  }
  const eventTaskId = event.taskId;
  const eventRunId = event.runId;
  const taskRunId = task.runId;
  const hasEventTaskId = hasId(eventTaskId);
  const hasEventRunId = hasId(eventRunId);
  if (hasEventTaskId && hasEventRunId) {
    return eventTaskId === task.id && hasId(taskRunId) && eventRunId === taskRunId;
  }
  if (hasEventTaskId) {
    return eventTaskId === task.id;
  }
  if (hasEventRunId) {
    return hasId(taskRunId) && eventRunId === taskRunId;
  }
  return false;
}

/**
 * Attribute owner-skill completed events to a task by taskId or runId.
 * Time proximity alone never matches. Conflicting tenant or run ids
 * exclude critical observations instead of picking the latest event.
 */
export function attributeOwnerSkillInvocations(input: {
  task: Pick<TaskAssignment, "id" | "ownerAgentId" | "runId">;
  events: readonly SkillInvocationEvent[];
  windowTenantScope: string | null;
}): OwnerSkillAttribution {
  const attributed = input.events.filter((event) =>
    isOwnerSkillAttributedToTask(event, input.task),
  );
  if (attributed.length === 0) {
    return { invocationRefs: [], conflicting: false };
  }
  const tenantIds = uniqueNonEmpty(attributed.map((event) => event.tenantId));
  const runIds = uniqueNonEmpty(attributed.map((event) => event.runId));
  const conflicting = tenantIds.length > 1 || runIds.length > 1;
  const skillLatencies = attributed
    .map((event) => event.latencyMs)
    .filter((value) => Number.isFinite(value));
  const skillLatencyMs =
    skillLatencies.length > 0
      ? (percentileNearestRank(skillLatencies, 95) ?? undefined)
      : undefined;
  if (conflicting) {
    return {
      invocationRefs: attributed.map((event) => event.invocationId),
      conflicting: true,
      ...(skillLatencyMs != null ? { skillLatencyMs } : {}),
    };
  }
  const securityFlags = attributed.map((event) =>
    securityViolationFromFailureCategory(event.failureCategory),
  );
  const securityViolation = securityFlags.every((flag) => typeof flag === "boolean")
    ? securityFlags.some((flag) => flag)
    : undefined;
  const eventTenant = tenantIds[0];
  const crossTenantContamination =
    eventTenant !== undefined
      ? crossTenantFromIds(eventTenant, input.windowTenantScope)
      : undefined;
  return {
    invocationRefs: attributed.map((event) => event.invocationId),
    conflicting: false,
    ...(typeof securityViolation === "boolean" ? { securityViolation } : {}),
    ...(typeof crossTenantContamination === "boolean" ? { crossTenantContamination } : {}),
    ...(skillLatencyMs != null ? { skillLatencyMs } : {}),
  };
}

export function organizationTaskOccurredAt(task: TaskAssignment): number | undefined {
  const completedAt = task.completedAt ? Date.parse(task.completedAt) : Number.NaN;
  if (Number.isFinite(completedAt)) {
    return completedAt;
  }
  if (task.status === "rejected") {
    const updatedAt = Date.parse(task.updatedAt);
    if (Number.isFinite(updatedAt)) {
      return updatedAt;
    }
  }
  const createdAt = Date.parse(task.createdAt);
  return Number.isFinite(createdAt) ? createdAt : undefined;
}

export function organizationTaskLatencyMs(task: TaskAssignment): number | undefined {
  const completed = taskAssignmentLatencyMs(task);
  if (completed != null) {
    return completed;
  }
  if (task.status !== "rejected") {
    return undefined;
  }
  const createdAt = Date.parse(task.createdAt);
  const updatedAt = Date.parse(task.updatedAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt) || updatedAt < createdAt) {
    return undefined;
  }
  return updatedAt - createdAt;
}

export function isTerminalOrganizationTask(task: TaskAssignment): boolean {
  return task.status === "completed" || task.status === "rejected";
}

export function organizationHumanTakeover(task: TaskAssignment): boolean {
  return task.assigneeUserId != null || task.ownerAgentId !== task.createdByAgentId;
}

/**
 * Build observation rows from the task-assignment SoT plus attributed
 * owner-skill events. Does not write a parallel outcome log.
 */
export function collectOrganizationTaskOutcomes(input: {
  tasks: readonly TaskAssignment[];
  events: readonly SkillInvocationEvent[];
  window: ObservationWindow;
  groupId: string;
  appliedAt?: string;
}): OrganizationTaskObservation[] {
  const appliedAtMs = input.appliedAt ? Date.parse(input.appliedAt) : Number.NaN;
  const rows: OrganizationTaskObservation[] = [];
  for (const task of input.tasks) {
    if (task.organizationId !== input.groupId) {
      continue;
    }
    if (!isTerminalOrganizationTask(task)) {
      continue;
    }
    const occurredAt = organizationTaskOccurredAt(task);
    if (occurredAt == null) {
      continue;
    }
    if (hasId(task.experimentId) && task.experimentId !== input.window.experimentId) {
      continue;
    }
    if (input.window.phase === "baseline" && hasId(task.applicationId)) {
      continue;
    }
    if (input.window.phase === "treatment" && Number.isFinite(appliedAtMs)) {
      const createdAt = Date.parse(task.createdAt);
      if (!Number.isFinite(createdAt) || createdAt < appliedAtMs) {
        continue;
      }
    }
    const attributed = attributeOwnerSkillInvocations({
      task,
      events: input.events,
      windowTenantScope: input.window.tenantScope,
    });
    const completionLatency = organizationTaskLatencyMs(task);
    const latencyMs = completionLatency ?? attributed.skillLatencyMs;
    rows.push({
      occurredAt,
      succeeded: task.status === "completed",
      taskId: task.id,
      groupId: task.organizationId,
      ownerAgentId: task.ownerAgentId,
      createdByAgentId: task.createdByAgentId,
      ownerSkillInvocationRefs: attributed.invocationRefs,
      criticalInconclusive: attributed.conflicting,
      humanTakeover: organizationHumanTakeover(task),
      ...(latencyMs != null ? { latencyMs } : {}),
      ...(typeof attributed.securityViolation === "boolean"
        ? { securityViolation: attributed.securityViolation }
        : {}),
      ...(typeof attributed.crossTenantContamination === "boolean"
        ? { crossTenantContamination: attributed.crossTenantContamination }
        : {}),
      ...(hasId(task.runId) ? { runId: task.runId } : {}),
      ...(hasId(task.tenantId) ? { tenantId: task.tenantId } : {}),
      ...(hasId(task.experimentId) ? { experimentId: task.experimentId } : {}),
      ...(hasId(task.applicationId) ? { applicationId: task.applicationId } : {}),
      ...(hasId(task.cohortRef) ? { cohortRef: task.cohortRef } : {}),
      ...(hasId(task.ownerAgentId) ? { agentId: task.ownerAgentId } : {}),
    });
  }
  return rows;
}
