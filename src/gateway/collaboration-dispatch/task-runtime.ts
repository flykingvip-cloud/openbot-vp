import type { Deliverable, Task } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type {
  CollaborationTaskState,
  EffectiveCollaborationPolicy,
  TaskHandoff,
  TaskResponsibility,
} from "./effective-policy.js";
import type { GovernanceActor, GovernanceMemberRoleLike } from "./governance-gate.js";
import { evaluateGovernanceGate } from "./governance-gate.js";
import {
  applyGovernanceAfterLiveTransition,
  mapLiveStatusToGovernance,
} from "./task-state-machine.js";

export type GovernedTask = Task & {
  governanceState?: CollaborationTaskState;
  responsibility?: TaskResponsibility;
  handoffs?: TaskHandoff[];
};

export class InvalidTaskHandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTaskHandoffError";
  }
}

export class MissingTaskDeliverableError extends Error {
  constructor(taskId: string) {
    super(`task ${taskId} requires a submitted deliverable before completion`);
    this.name = "MissingTaskDeliverableError";
  }
}

/**
 * Flag-on refusal: the owner_transfer shortcut must not change responsibility.
 * Flag-off (default) never throws this.
 */
export class HandoffContractRequiredError extends Error {
  readonly code = "HANDOFF_CONTRACT_REQUIRED";
  constructor() {
    super(
      "collaboration.task.handoffContract is enabled; owner and responsibility changes require proposeHandoff → acceptHandoff → approveHandoff → applyApprovedHandoff (contract API). The applyTaskHandoff / collaboration.task.handoff shortcut is refused",
    );
    this.name = "HandoffContractRequiredError";
  }
}

/** Plan flag `collab.task.handoffContract` → `collaboration.task.handoffContract` (default false). */
export function isCollabTaskHandoffContractEnabled(cfg?: OpenBotConfig): boolean {
  try {
    return (cfg ?? loadConfig()).collaboration?.task?.handoffContract === true;
  } catch {
    // Unreadable config must not tighten the flag-off shortcut.
    return false;
  }
}

function compactId(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function uniqueIds(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const id = compactId(value);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

function findRoleMember(
  memberRoleMap: readonly GovernanceMemberRoleLike[] | null | undefined,
  collaborationRole: string,
): string | undefined {
  const matched = (memberRoleMap ?? []).find(
    (member) => member.collaborationRole === collaborationRole,
  );
  return compactId(matched?.memberId) || undefined;
}

export function resolveBlockedAgentIdsFromHandoffs(
  handoffs: readonly TaskHandoff[] | null | undefined,
): string[] {
  const blocked: string[] = [];
  const seen = new Set<string>();
  for (const handoff of handoffs ?? []) {
    const to = compactId(handoff.to);
    const remaining = compactId(handoff.remainingWork);
    if (!to || !remaining || seen.has(to)) {
      continue;
    }
    seen.add(to);
    blocked.push(to);
  }
  return blocked;
}

export function asGovernedTask(task: Task): GovernedTask {
  const extra = task as GovernedTask;
  return {
    ...task,
    governanceState: extra.governanceState ?? mapLiveStatusToGovernance(task.status),
    ...(extra.responsibility ? { responsibility: extra.responsibility } : {}),
    handoffs: extra.handoffs ?? [],
  };
}

export function seedTaskResponsibility(params: {
  task: Task;
  effective: EffectiveCollaborationPolicy;
  actor?: string;
  ownerUserId?: string | null;
  coordinatorBotId?: string | null;
  nominatedOwnerId?: string | null;
  memberRoleMap?: readonly GovernanceMemberRoleLike[] | null;
}): TaskResponsibility {
  const owner =
    compactId(params.task.ownerMemberId) ||
    compactId(params.task.createdBy) ||
    compactId(params.nominatedOwnerId) ||
    compactId(params.ownerUserId) ||
    "group";
  const assigned = uniqueIds(params.task.assignedMemberIds ?? []);
  const actor = compactId(params.actor);
  const executors =
    assigned.length > 0 ? assigned : owner !== "group" ? [owner] : actor ? [actor] : [owner];
  const reviewer = findRoleMember(params.memberRoleMap, "reviewer");
  const coordinator =
    compactId(params.coordinatorBotId) || findRoleMember(params.memberRoleMap, "coordinator");
  const approver =
    findRoleMember(params.memberRoleMap, "final_decider") ||
    compactId(params.ownerUserId) ||
    undefined;
  const decisionAuthority =
    params.effective.governance.decisionMode === "human_required"
      ? compactId(params.ownerUserId) || "human"
      : compactId(coordinator) || owner;
  return {
    owner,
    executors,
    ...(reviewer ? { reviewer } : {}),
    ...(approver ? { approver } : {}),
    ...(coordinator ? { coordinator } : {}),
    decisionAuthority,
  };
}

export function resolveTaskResponsibility(params: {
  task: GovernedTask;
  effective: EffectiveCollaborationPolicy;
  actor?: string;
  ownerUserId?: string | null;
  coordinatorBotId?: string | null;
  nominatedOwnerId?: string | null;
  memberRoleMap?: readonly GovernanceMemberRoleLike[] | null;
}): TaskResponsibility {
  return (
    params.task.responsibility ??
    seedTaskResponsibility({
      task: params.task,
      effective: params.effective,
      actor: params.actor,
      ownerUserId: params.ownerUserId,
      coordinatorBotId: params.coordinatorBotId,
      nominatedOwnerId: params.nominatedOwnerId,
      memberRoleMap: params.memberRoleMap,
    })
  );
}

export function normalizeTaskHandoff(input: {
  taskId: string;
  from: string;
  to: string;
  reason: string;
  remainingWork: string;
  acceptanceCriteria: readonly string[];
  completedArtifacts?: readonly string[];
  assumptions?: readonly string[];
  blockers?: readonly string[];
}): TaskHandoff {
  const from = compactId(input.from);
  const to = compactId(input.to);
  const reason = compactId(input.reason);
  const remainingWork = compactId(input.remainingWork);
  const acceptanceCriteria = uniqueIds([...input.acceptanceCriteria]);
  if (!from || !to) {
    throw new InvalidTaskHandoffError("handoff requires from and to");
  }
  if (from === to) {
    throw new InvalidTaskHandoffError("handoff from and to must differ");
  }
  if (!reason) {
    throw new InvalidTaskHandoffError("handoff requires a reason");
  }
  if (!remainingWork) {
    throw new InvalidTaskHandoffError("handoff requires remainingWork");
  }
  if (acceptanceCriteria.length === 0) {
    throw new InvalidTaskHandoffError("handoff requires acceptanceCriteria");
  }
  return {
    taskId: compactId(input.taskId),
    from,
    to,
    reason,
    completedArtifacts: uniqueIds([...(input.completedArtifacts ?? [])]),
    remainingWork,
    assumptions: uniqueIds([...(input.assumptions ?? [])]),
    blockers: uniqueIds([...(input.blockers ?? [])]),
    acceptanceCriteria,
  };
}

export function applyTaskHandoff(params: {
  task: GovernedTask;
  handoff: TaskHandoff;
  responsibility: TaskResponsibility;
  /** Explicit config. Omitted calls load the runtime config; default flag is false. */
  cfg?: OpenBotConfig;
}): { responsibility: TaskResponsibility; handoffs: TaskHandoff[] } {
  // P1-B③: flag-on forbids the owner_transfer shortcut (and any responsibility
  // mutation) before HandoffContract events. Flag-off keeps the body below.
  if (isCollabTaskHandoffContractEnabled(params.cfg)) {
    throw new HandoffContractRequiredError();
  }
  const onGraph = new Set([params.responsibility.owner, ...params.responsibility.executors]);
  if (!onGraph.has(params.handoff.from)) {
    throw new InvalidTaskHandoffError("handoff from is not on the responsibility graph");
  }
  const transferOwner = params.handoff.reason === "owner_transfer";
  const owner = transferOwner ? params.handoff.to : params.responsibility.owner;
  const executors = transferOwner
    ? uniqueIds(params.responsibility.executors)
    : uniqueIds([
        params.handoff.to,
        ...params.responsibility.executors.filter((id) => id !== params.handoff.from),
      ]);
  return {
    responsibility: {
      ...params.responsibility,
      owner,
      executors,
    },
    handoffs: [...(params.task.handoffs ?? []), params.handoff],
  };
}

const COUNTED_DELIVERABLE_STATUSES = new Set(["submitted", "in_review", "approved", "published"]);

export function taskHasRequiredDeliverable(params: {
  taskId: string;
  deliverables: ReadonlyArray<Pick<Deliverable, "taskId" | "status">>;
}): boolean {
  return params.deliverables.some(
    (entry) => entry.taskId === params.taskId && COUNTED_DELIVERABLE_STATUSES.has(entry.status),
  );
}

export function assertTaskMayComplete(params: {
  task: GovernedTask;
  effective: EffectiveCollaborationPolicy;
  actor: GovernanceActor;
  deliverables: ReadonlyArray<Pick<Deliverable, "taskId" | "status">>;
}): void {
  if (!params.effective.strategy.deliverableRequired) {
    return;
  }
  if (
    !taskHasRequiredDeliverable({ taskId: params.task.taskId, deliverables: params.deliverables })
  ) {
    throw new MissingTaskDeliverableError(params.task.taskId);
  }
  const gate = evaluateGovernanceGate({
    action: "finalize_decision",
    actor: params.actor,
    effective: params.effective,
  });
  if (!gate.allowed) {
    throw new Error(gate.message);
  }
}

export function assertDeliverableCommit(params: {
  actor: GovernanceActor;
  effective: EffectiveCollaborationPolicy;
}): void {
  const gate = evaluateGovernanceGate({
    action: "finalize_decision",
    actor: params.actor,
    effective: params.effective,
  });
  if (!gate.allowed) {
    throw new Error(gate.message);
  }
}

export function nextGovernedTaskFields(params: {
  task: GovernedTask;
  liveStatus: Task["status"];
  responsibility: TaskResponsibility;
  handoffs?: TaskHandoff[];
}): Pick<
  GovernedTask,
  "governanceState" | "responsibility" | "handoffs" | "ownerMemberId" | "assignedMemberIds"
> {
  const previous = params.task.governanceState ?? mapLiveStatusToGovernance(params.task.status);
  return {
    governanceState: applyGovernanceAfterLiveTransition({
      previous,
      liveStatus: params.liveStatus,
    }),
    responsibility: params.responsibility,
    handoffs: params.handoffs ?? params.task.handoffs ?? [],
    ownerMemberId: params.responsibility.owner,
    assignedMemberIds: params.responsibility.executors,
  };
}
