import {
  DecisionStateMachine,
  DeliverableStateMachine,
  ReviewStateMachine,
  TaskStateMachine,
  type Decision,
  type DecisionOption,
  type DecisionStatus,
  type Deliverable,
  type DeliverableStatus,
  type Review,
  type ReviewStatus,
  type Task,
  type TaskStatus,
} from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import { evaluateGovernanceGate } from "../collaboration-dispatch/governance-gate.js";
import {
  observeGovernanceLanePolicyHashDivergence,
  resolveGovernanceLaneActor,
} from "../collaboration-dispatch/policy-lane-governance.js";
import {
  compileGroupEffectivePolicy,
  resolveGroupPolicyInput,
} from "../collaboration-dispatch/resolve-effective-policy.js";
import { createRoundPolicySnapshot } from "../collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import {
  guardUnattendedFinalize,
  isSingleGroupUnattendedTarget,
} from "../collaboration-dispatch/single-group-unattended.js";
import { applyBusinessTaskPatchUnderControlLock } from "../collaboration-dispatch/task-control-cas.js";
import {
  asGovernedTask,
  assertDeliverableCommit,
  assertTaskMayComplete,
  HandoffContractRequiredError,
  nextGovernedTaskFields,
  resolveBlockedAgentIdsFromHandoffs,
  resolveTaskResponsibility,
} from "../collaboration-dispatch/task-runtime.js";
import { assertTaskNotStopped } from "../collaboration-dispatch/task-stop-control.js";
import { recordCollaborationQualityBestEffort } from "../collaboration-ledger/writer.js";
import { resolveSecurityProfile } from "../security-profile.js";
import {
  recordDeliverableTransitionSatisfactionBestEffort,
  recordReviewResolutionSatisfactionBestEffort,
  recordTaskTransitionSatisfactionBestEffort,
} from "./collaboration-satisfaction.js";
import { recordReviewOutcomeCapsuleSafely } from "./review-outcome-capsule.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  syncGroupOperatingState,
  resolveCollaborationGroupTenantId,
} from "./shared.js";

export function resolveCollaborationTransitionError(error: unknown) {
  return error instanceof Error ? error.message : null;
}

export async function transitionCollaborationTask(params: {
  groupId: string;
  taskId: string;
  toStatus: TaskStatus;
  actor?: string;
  cfg?: ReturnType<typeof loadConfig>;
  /** Test-only: after outside read / prechecks, before control-lock write. */
  _testAfterTaskReadBarrier?: () => Promise<void>;
}): Promise<Task> {
  const {
    fileStore,
    groupStorage,
    learningStorage,
    memoryStorage,
    metadataStorage,
    objectStorage,
  } = createWorkspaceCollaborationStores();
  const current = await objectStorage.readObject<Task>(params.groupId, "task", params.taskId);
  if (!current) {
    throw new Error(`task not found: ${params.taskId}`);
  }
  assertTaskNotStopped(asGovernedTask(current));
  const operatingState = await readGroupOperatingState({
    fileStore,
    groupId: params.groupId,
  });
  const effective = compileGroupEffectivePolicy({ operatingState });
  // Snapshot cfg once per entry (P1-A5 follow-up): under production runtime snapshot /
  // config cache this equals today's per-call loadConfig(); freezes lane flags for the
  // transition so mid-request setRuntimeConfigSnapshot cannot split actor vs observe.
  const cfg = loadConfig();
  // P1-A5 final: governance lane actor (legacy = fail-open classification byte-equal; no extra work).
  const actor = resolveGovernanceLaneActor({
    actorId: params.actor,
    memberRoleMap: operatingState?.memberRoleMap,
    cfg,
  }).actor;
  // BP-17 observe: legacy = no-op (no compile/hash). Shadow records OS-only vs overlay.
  observeGovernanceLanePolicyHashDivergence({
    operatingState,
    legacyOverlay: null,
    cfg,
  });
  const governed = asGovernedTask(current);
  const responsibility = resolveTaskResponsibility({
    task: governed,
    effective,
    actor: params.actor,
    ownerUserId: operatingState?.governance.ownerUserId,
    coordinatorBotId: operatingState?.governance.coordinatorBotId,
    memberRoleMap: operatingState?.memberRoleMap,
  });
  if (params.toStatus === "completed") {
    const deliverables = await objectStorage.listObjects<Deliverable>(
      params.groupId,
      "deliverable",
    );
    const finalizeGate = evaluateGovernanceGate({
      action: "finalize_decision",
      actor,
      effective,
    });
    // Batch 5 latch only. assertTaskMayComplete below is unchanged and still refuses.
    if (isSingleGroupUnattendedTarget(cfg, params.groupId, null)) {
      const fenceAuthority = createRuntimeAuthority({
        snapshot: createRoundPolicySnapshot(resolveGroupPolicyInput({ operatingState }), {
          now: Date.now(),
          idGen: () => `pss_unattended_finalize_${params.groupId}`,
        }),
        episodeId: `unattended-finalize:${params.groupId}`,
        tenant: { tenantId: null, trust: "none" },
        groupId: params.groupId,
        profile: resolveSecurityProfile(cfg).profile,
        cfg,
      });
      await guardUnattendedFinalize({
        authority: fenceAuthority,
        groupId: params.groupId,
        cfg,
        actorId: actor.id || params.actor || "",
        actorType: actor.type,
        gateAllowed: finalizeGate.allowed,
        coordinatorBotId: operatingState?.governance.coordinatorBotId,
        publishedBy: operatingState?.governance.ownerUserId,
      });
    }
    assertTaskMayComplete({
      task: { ...governed, responsibility },
      effective,
      actor,
      deliverables,
    });
  }
  // Intent from outside read (gates already passed). Persist under task control lock
  // so concurrent stop/claim cannot be lost to `{...stale, ...fields}` (T44).
  if (params._testAfterTaskReadBarrier) {
    await params._testAfterTaskReadBarrier();
  }
  const writeCfg = params.cfg ?? cfg;
  const updated = await applyBusinessTaskPatchUnderControlLock({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg: writeCfg,
    refuseIfStopped: true,
    buildPatch: (live) => {
      const machine = new TaskStateMachine();
      const status = machine.transition(live.status, params.toStatus, params.actor);
      const now = Date.now();
      const liveGoverned = asGovernedTask(live);
      const liveResponsibility = resolveTaskResponsibility({
        task: liveGoverned,
        effective,
        actor: params.actor,
        ownerUserId: operatingState?.governance.ownerUserId,
        coordinatorBotId: operatingState?.governance.coordinatorBotId,
        memberRoleMap: operatingState?.memberRoleMap,
      });
      const governanceFields = nextGovernedTaskFields({
        task: liveGoverned,
        liveStatus: status,
        responsibility: liveResponsibility,
      });
      return {
        ...governanceFields,
        status,
        startedAtMs: status === "in_progress" ? (live.startedAtMs ?? now) : live.startedAtMs,
        completedAtMs: status === "completed" ? now : live.completedAtMs,
        updatedBy: params.actor ?? live.updatedBy,
        updatedAtMs: now,
      };
    },
  });
  await syncGroupOperatingState({
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
    groupId: params.groupId,
  });
  // Evolution: task 终态 → 对 assigned/owner bot 记满意度（非 UI operator actor）。
  void recordTaskTransitionSatisfactionBestEffort(updated);
  return updated;
}

export async function handoffCollaborationTask(params: {
  groupId: string;
  taskId: string;
  from: string;
  to: string;
  reason: string;
  remainingWork: string;
  acceptanceCriteria: string[];
  completedArtifacts?: string[];
  assumptions?: string[];
  blockers?: string[];
  actor?: string;
}): Promise<Task> {
  const { fileStore, objectStorage } = createWorkspaceCollaborationStores();
  const current = await objectStorage.readObject<Task>(params.groupId, "task", params.taskId);
  if (!current) {
    throw new Error(`task not found: ${params.taskId}`);
  }
  // Touch operating-state read so missing group storage still fails the same way
  // before the retired shortcut would have mutated (keeps not-found / IO semantics).
  await readGroupOperatingState({
    fileStore,
    groupId: params.groupId,
  });
  void params.from;
  void params.to;
  void params.reason;
  void params.remainingWork;
  void params.acceptanceCriteria;
  void params.completedArtifacts;
  void params.assumptions;
  void params.blockers;
  void params.actor;
  // T09-B1: collaboration.task.handoff shortcut retired — never mutates responsibility
  // whether handoffContract is on or off. Sole writer: contract propose→accept→approve→apply.
  throw new HandoffContractRequiredError();
}

export async function transitionCollaborationDeliverable(params: {
  groupId: string;
  deliverableId: string;
  toStatus: DeliverableStatus;
  actor?: string;
}): Promise<Deliverable> {
  const {
    fileStore,
    groupStorage,
    learningStorage,
    memoryStorage,
    metadataStorage,
    objectStorage,
  } = createWorkspaceCollaborationStores();
  const current = await objectStorage.readObject<Deliverable>(
    params.groupId,
    "deliverable",
    params.deliverableId,
  );
  if (!current) {
    throw new Error(`deliverable not found: ${params.deliverableId}`);
  }
  if (params.toStatus === "approved" || params.toStatus === "published") {
    const operatingState = await readGroupOperatingState({
      fileStore,
      groupId: params.groupId,
    });
    const effective = compileGroupEffectivePolicy({ operatingState });
    const cfg = loadConfig();
    observeGovernanceLanePolicyHashDivergence({
      operatingState,
      legacyOverlay: null,
      cfg,
    });
    assertDeliverableCommit({
      actor: resolveGovernanceLaneActor({
        actorId: params.actor,
        memberRoleMap: operatingState?.memberRoleMap,
        cfg,
      }).actor,
      effective,
    });
  }
  const machine = new DeliverableStateMachine();
  const status = machine.transition(current.status, params.toStatus, params.actor);
  const now = Date.now();
  const updated: Deliverable = {
    ...current,
    status,
    submittedAtMs: status === "submitted" ? (current.submittedAtMs ?? now) : current.submittedAtMs,
    approvedAtMs: status === "approved" ? now : current.approvedAtMs,
    publishedAtMs: status === "published" ? now : current.publishedAtMs,
    submittedBy:
      status === "submitted" ? (params.actor ?? current.submittedBy) : current.submittedBy,
    approvedBy: status === "approved" ? (params.actor ?? current.approvedBy) : current.approvedBy,
    publishedBy:
      status === "published" ? (params.actor ?? current.publishedBy) : current.publishedBy,
    updatedBy: params.actor ?? current.updatedBy,
    updatedAtMs: now,
  };
  await objectStorage.writeObject(params.groupId, "deliverable", params.deliverableId, updated);
  await syncGroupOperatingState({
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
    groupId: params.groupId,
  });
  // Evolution: deliverable 终态 → 对 submittedBy bot 记满意度（非 UI operator actor）。
  void recordDeliverableTransitionSatisfactionBestEffort(updated);
  if (status === "approved" || status === "published") {
    recordCollaborationQualityBestEffort({
      groupId: params.groupId,
      ...(resolveCollaborationGroupTenantId(params.groupId)
        ? { tenantId: resolveCollaborationGroupTenantId(params.groupId)! }
        : {}),
      event: "deliverable",
      outcome: "accepted",
      agentId: updated.submittedBy ?? updated.createdBy,
      taskId: updated.taskId,
      deliverableId: updated.deliverableId,
      artifacts: [updated.deliverableId],
    });
  }
  return updated;
}

export async function transitionCollaborationReview(params: {
  groupId: string;
  reviewId: string;
  toStatus: ReviewStatus;
  actor?: string;
}): Promise<Review> {
  const {
    fileStore,
    groupStorage,
    learningStorage,
    memoryStorage,
    metadataStorage,
    objectStorage,
  } = createWorkspaceCollaborationStores();
  const current = await objectStorage.readObject<Review>(params.groupId, "review", params.reviewId);
  if (!current) {
    throw new Error(`review not found: ${params.reviewId}`);
  }
  const machine = new ReviewStateMachine();
  const status = machine.transition(current.status, params.toStatus, params.actor);
  const now = Date.now();
  const updated: Review = {
    ...current,
    status,
    submittedAtMs: status === "submitted" ? (current.submittedAtMs ?? now) : current.submittedAtMs,
    acknowledgedAtMs:
      status === "acknowledged" ? (current.acknowledgedAtMs ?? now) : current.acknowledgedAtMs,
    resolvedAtMs: status === "resolved" ? now : current.resolvedAtMs,
    submittedBy:
      status === "submitted" ? (params.actor ?? current.submittedBy) : current.submittedBy,
    acknowledgedBy:
      status === "acknowledged" ? (params.actor ?? current.acknowledgedBy) : current.acknowledgedBy,
    resolvedBy: status === "resolved" ? (params.actor ?? current.resolvedBy) : current.resolvedBy,
    updatedBy: params.actor ?? current.updatedBy,
    updatedAtMs: now,
  };
  await objectStorage.writeObject(params.groupId, "review", params.reviewId, updated);
  await syncGroupOperatingState({
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
    groupId: params.groupId,
  });
  // Part 2：评审收尾 → 经验胶囊（fire-and-forget；仅 reject/revise 产出 candidate，绝不阻塞迁移）。
  void recordReviewOutcomeCapsuleSafely(updated);
  // Evolution: resolved + verdict → satisfaction for deliverable author (best-effort).
  void recordReviewResolutionSatisfactionBestEffort(updated);
  if (status === "resolved" && updated.verdict) {
    let reviewedAgentId = updated.submittedBy ?? updated.resolvedBy;
    if (updated.deliverableId) {
      const deliverable = await objectStorage.readObject<Deliverable>(
        params.groupId,
        "deliverable",
        updated.deliverableId,
      );
      reviewedAgentId = deliverable?.submittedBy ?? deliverable?.createdBy ?? reviewedAgentId;
    }
    recordCollaborationQualityBestEffort({
      groupId: params.groupId,
      ...(resolveCollaborationGroupTenantId(params.groupId)
        ? { tenantId: resolveCollaborationGroupTenantId(params.groupId)! }
        : {}),
      event: "review",
      outcome: updated.verdict === "approve" ? "accepted" : "rejected",
      agentId: reviewedAgentId,
      taskId: updated.taskId,
      deliverableId: updated.deliverableId,
      reviewId: updated.reviewId,
      reviewVerdict: updated.verdict,
    });
  }
  return updated;
}

export async function transitionCollaborationDecision(params: {
  groupId: string;
  decisionId: string;
  toStatus: DecisionStatus;
  actor?: string;
  selectedOption?: string;
}): Promise<Decision> {
  const {
    fileStore,
    groupStorage,
    learningStorage,
    memoryStorage,
    metadataStorage,
    objectStorage,
  } = createWorkspaceCollaborationStores();
  const current = await objectStorage.readObject<Decision>(
    params.groupId,
    "decision",
    params.decisionId,
  );
  if (!current) {
    throw new Error(`decision not found: ${params.decisionId}`);
  }
  const operatingState = await readGroupOperatingState({
    fileStore,
    groupId: params.groupId,
  });
  if (params.toStatus === "finalized") {
    const effective = compileGroupEffectivePolicy({ operatingState });
    const cfg = loadConfig();
    observeGovernanceLanePolicyHashDivergence({
      operatingState,
      legacyOverlay: null,
      cfg,
    });
    const gate = evaluateGovernanceGate({
      action: "finalize_decision",
      actor: resolveGovernanceLaneActor({
        actorId: params.actor,
        memberRoleMap: operatingState?.memberRoleMap,
        cfg,
      }).actor,
      effective,
    });
    if (!gate.allowed) {
      throw new Error(gate.message);
    }
  }
  const machine = new DecisionStateMachine();
  const status = machine.transition(current.status, params.toStatus, params.actor);
  const selectedOption = params.selectedOption ?? current.selectedOption;
  if (
    status === "finalized" &&
    (!selectedOption || !current.options.some((entry) => entry.optionId === selectedOption))
  ) {
    throw new Error(`decision ${params.decisionId} requires a valid selectedOption to finalize`);
  }
  const now = Date.now();
  const updated: Decision = {
    ...current,
    status,
    selectedOption,
    deciderMemberId:
      status === "finalized" ? (params.actor ?? current.deciderMemberId) : current.deciderMemberId,
    finalizedAt: status === "finalized" ? (current.finalizedAt ?? now) : current.finalizedAt,
    updatedAt: now,
  };
  await objectStorage.writeObject(params.groupId, "decision", params.decisionId, updated);
  await syncGroupOperatingState({
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
    groupId: params.groupId,
  });
  return updated;
}

export async function updateCollaborationDecisionDraft(params: {
  groupId: string;
  decisionId: string;
  rationale?: string;
  selectedOption?: string;
  options?: Array<Pick<DecisionOption, "optionId" | "title">>;
}): Promise<Decision> {
  const {
    fileStore,
    groupStorage,
    learningStorage,
    memoryStorage,
    metadataStorage,
    objectStorage,
  } = createWorkspaceCollaborationStores();
  const current = await objectStorage.readObject<Decision>(
    params.groupId,
    "decision",
    params.decisionId,
  );
  if (!current) {
    throw new Error(`decision not found: ${params.decisionId}`);
  }
  if (current.status !== "draft") {
    throw new Error(`decision ${params.decisionId} is not editable outside draft status`);
  }
  if (
    params.selectedOption &&
    !(params.options ?? current.options).some((entry) => entry.optionId === params.selectedOption)
  ) {
    throw new Error(`decision ${params.decisionId} requires a valid selectedOption`);
  }
  const optionUpdates = params.options?.map((entry) => ({
    optionId: entry.optionId.trim(),
    title: entry.title.trim(),
  }));
  if (optionUpdates) {
    if (optionUpdates.length === 0) {
      throw new Error(`decision ${params.decisionId} requires at least one option`);
    }
    if (optionUpdates.some((entry) => entry.optionId.length === 0 || entry.title.length === 0)) {
      throw new Error(`decision ${params.decisionId} requires non-empty option ids and titles`);
    }
    const ids = optionUpdates.map((entry) => entry.optionId);
    if (new Set(ids).size !== ids.length) {
      throw new Error(`decision ${params.decisionId} requires unique option ids`);
    }
  }
  const nextOptions = optionUpdates
    ? optionUpdates.map((entry) => {
        const currentOption = current.options.find((option) => option.optionId === entry.optionId);
        return {
          ...currentOption,
          optionId: entry.optionId,
          title: entry.title,
        };
      })
    : current.options;
  const selectedOption =
    params.selectedOption !== undefined
      ? params.selectedOption
      : nextOptions.some((entry) => entry.optionId === current.selectedOption)
        ? current.selectedOption
        : undefined;
  const updated: Decision = {
    ...current,
    ...(optionUpdates ? { options: nextOptions } : {}),
    ...(params.rationale !== undefined ? { rationale: params.rationale } : {}),
    ...(selectedOption !== undefined ? { selectedOption } : { selectedOption: undefined }),
    updatedAt: Date.now(),
  };
  await objectStorage.writeObject(params.groupId, "decision", params.decisionId, updated);
  await syncGroupOperatingState({
    fileStore,
    groupStorage,
    metadataStorage,
    memoryStorage,
    learningStorage,
    objectStorage,
    groupId: params.groupId,
  });
  return updated;
}

/** Read current-task handoffs and return agent ids still blocked on remaining work. Fail-open. */
export async function resolveBlockedAgentIdsForCurrentTask(params: {
  groupId: string;
  currentTaskId?: string | null;
}): Promise<string[]> {
  const taskId = params.currentTaskId?.trim();
  if (!taskId) {
    return [];
  }
  try {
    const { objectStorage } = createWorkspaceCollaborationStores();
    const current = await objectStorage.readObject<Task>(params.groupId, "task", taskId);
    if (!current) {
      return [];
    }
    return resolveBlockedAgentIdsFromHandoffs(asGovernedTask(current).handoffs);
  } catch {
    return [];
  }
}
