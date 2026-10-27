/**
 * P4b — production organizer entry onto GroupBoardClaim / ClaimContract.
 *
 * Reuses publishBoardItem → claimBoardItem → applyClaim + task-runtime seed only.
 * When collaboration.task.claimContract is off, entry points refuse (fail-closed).
 * Does not invent SessionTaskBoard / SupervisorTaskBoard / second task system /
 * Floor live / multi-beat / RCIS / tip-prompt rules. Does not grant bots L3 task.assign.
 */
import type { Task } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  listChallengeWindows,
  openChallengeWindow,
  recordChallengeCritique,
  resolveChallengeWindow,
  skipChallengeWindow,
  type ChallengeDraftSnapshot,
  type ChallengeIssueKind,
  type ChallengeResolutionDecision,
  type ChallengeWindowRecord,
} from "../collaboration-dispatch/challenge-window.js";
import {
  acceptBoardItemSubmission,
  applyClaim,
  blockBoardItem,
  cancelBoardItem,
  unblockBoardItem,
  claimBoardItem,
  isCollabTaskClaimContractEnabled,
  listBoardClaimItems,
  loadBoardClaimItem,
  markBoardItemInProgress,
  oralDispatchCreatesBoardFact,
  publishBoardItem,
  returnBoardItemSubmission,
  submitBoardItemForReview,
  type ClaimResult,
  type GroupBoardClaimItem,
} from "../collaboration-dispatch/claim-contract.js";
import { episodeIdForClientRun } from "../collaboration-dispatch/collaboration-event-key.js";
import {
  buildExecutionTaskBagForActor,
  canReadExecutorTodolist,
  confirmTodolist,
  formatExecutionTaskBagForPrompt,
  freeChatIsTodolist,
  listExecutorTodolists,
  loadExecutorTodolist,
  proposeTodolist,
  reviseTodolist,
  signalInsight,
  todolistIsGroupSharedBoardSubrecord,
  type ExecutionTaskBag,
  type ExecutorPrivateTodolist,
  type TodolistResult,
} from "../collaboration-dispatch/executor-private-todolist.js";
import {
  buildBoardPublishDraftFromIntent,
  materializeIntentToBoardItem,
  type BoardIntentMaterializeInput,
  type BoardPublishDraft,
  type MaterializeIntentResult,
} from "../collaboration-dispatch/intent-board-materialize.js";
import {
  aggregateMemberProgress,
  type MemberProgressReport,
} from "../collaboration-dispatch/member-progress-export.js";
import {
  listPeerReviews,
  recordPeerReview,
  type PeerReviewEvent,
  type PeerReviewVerdict,
} from "../collaboration-dispatch/peer-review-gate.js";
import { resolveGroupPolicyInput } from "../collaboration-dispatch/resolve-effective-policy.js";
import {
  createRoundPolicySnapshot,
  generatePolicySnapshotId,
} from "../collaboration-dispatch/round-policy-snapshot.js";
import {
  createRuntimeAuthority,
  type RuntimeAuthority,
} from "../collaboration-dispatch/runtime-authority.js";
import { applyBusinessTaskPatchUnderControlLock } from "../collaboration-dispatch/task-control-cas.js";
import {
  asGovernedTask,
  nextGovernedTaskFields,
  seedTaskResponsibility,
} from "../collaboration-dispatch/task-runtime.js";
import {
  assertTaskNotStopped,
  isTaskStopAccepted,
} from "../collaboration-dispatch/task-stop-control.js";
import { resolveSecurityProfile } from "../security-profile.js";
import {
  confirmationConsumedDelivery,
  normalizeOwnerDecisionDelivery,
  proposalCreatedDelivery,
  readOwnerDecisionDeliveries,
  recordOwnerDecisionDelivery,
  staleOwnerDecisionDelivery,
  type OwnerDecisionCardDelivery,
} from "./owner-decision-delivery.js";
import { emitOwnerDecisionCardForProposedTodolist } from "./owner-decision-emit.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  resolveCollaborationGroupTenantId,
  syncGroupOperatingState,
} from "./shared.js";
import { assertPersistedTaskNotStopped } from "./task-stop-entry.js";
import {
  resolveAuthorityTenantForEntry,
  type CollaborationTenantResolution,
} from "./trusted-tenant.js";

export { oralDispatchCreatesBoardFact };
export { freeChatIsTodolist, todolistIsGroupSharedBoardSubrecord };

export class ClaimContractFlagOffError extends Error {
  readonly code = "CLAIM_CONTRACT_FLAG_OFF";
  constructor() {
    super(
      "collaboration.task.claimContract is off; enable the flag to run publish → claim → apply board facts",
    );
    this.name = "ClaimContractFlagOffError";
  }
}

export class ClaimContractEntryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ClaimContractEntryError";
    this.code = code;
  }
}

function unwrap<T>(result: ClaimResult<T>, step: string): T {
  if (result.ok) {
    return result.value;
  }
  if (result.reason === "flag_off") {
    throw new ClaimContractFlagOffError();
  }
  throw new ClaimContractEntryError(result.reason, `${step}: ${result.message}`);
}

function requireFlag(cfg: OpenBotConfig, groupId?: string | null, tenantId?: string | null): void {
  if (!isCollabTaskClaimContractEnabled(cfg, groupId, tenantId)) {
    throw new ClaimContractFlagOffError();
  }
}

/** Prefer explicit tenant resolution; else group→tenant map (may be null). */
function tenantIdForClaimFlag(
  groupId: string,
  tenant?: CollaborationTenantResolution | null,
): string | null {
  const explicit = tenant?.tenantId?.trim();
  if (explicit) {
    return explicit;
  }
  return resolveCollaborationGroupTenantId(groupId);
}

async function buildClaimAuthority(params: {
  groupId: string;
  taskId: string;
  cfg: OpenBotConfig;
  tenant?: CollaborationTenantResolution | null;
}) {
  const stores = createWorkspaceCollaborationStores();
  const operatingState = await readGroupOperatingState({
    fileStore: stores.fileStore,
    groupId: params.groupId,
  });
  const now = Date.now();
  const snapshot = createRoundPolicySnapshot(resolveGroupPolicyInput({ operatingState }), {
    now,
    idGen: () => generatePolicySnapshotId(now),
  });
  const groupTenantId = resolveCollaborationGroupTenantId(params.groupId);
  const tenant: CollaborationTenantResolution = resolveAuthorityTenantForEntry({
    preferred: params.tenant,
    groupTenantId,
  });
  const profile = resolveSecurityProfile(params.cfg).profile;
  const authority = createRuntimeAuthority({
    snapshot,
    episodeId: episodeIdForClientRun(`task-claim:${params.groupId}:${params.taskId}`),
    tenant,
    groupId: params.groupId,
    profile,
    cfg: params.cfg,
  });
  return { authority, stores, operatingState };
}

/**
 * Operating-state slice used for Todolist ACL. Coordinator and 主答 rights come
 * from this record plus the board `publishedBy` fact — never from RPC params.
 */
type OperatingStateAclSource = {
  governance?: { coordinatorBotId?: string | null };
  memberRoleMap?: ReadonlyArray<{ memberId?: string | null; status?: string | null }>;
} | null;

type TrustedTodolistAcl = {
  authorizedConfirmerIds: readonly string[];
  coordinatorBotId: string | null;
};

/**
 * Membership proof for Todolist confirmer / coordinator rights.
 * A missing memberRoleMap row is not active: `client.connect.user` equal to
 * publishedBy or coordinatorBotId cannot inherit that role without an explicit
 * active row. When the id is in the map, RPC delivery handlers also require
 * `resolveDeliveryAclActor` to match a handshake-stamped session subject.
 */
function memberExplicitlyActive(state: OperatingStateAclSource, memberId: string): boolean {
  const id = memberId.trim();
  if (!id) {
    return false;
  }
  const member = state?.memberRoleMap?.find((row) => (row.memberId ?? "").trim() === id);
  if (!member) {
    return false;
  }
  return (member.status ?? "active") === "active";
}

function trustedCoordinatorBotId(state: OperatingStateAclSource): string | null {
  const id = state?.governance?.coordinatorBotId?.trim() ?? "";
  if (!id || !memberExplicitlyActive(state, id)) {
    return null;
  }
  return id;
}

async function resolveTrustedTodolistAcl(params: {
  authority: RuntimeAuthority;
  operatingState: OperatingStateAclSource;
  taskId: string;
  boardItemId?: string | null;
}): Promise<TrustedTodolistAcl> {
  const coordinatorBotId = trustedCoordinatorBotId(params.operatingState);
  const boardItemId = params.boardItemId?.trim() ?? "";
  const leads: string[] = [];
  if (boardItemId) {
    const board = await loadBoardClaimItem(params.authority, {
      taskId: params.taskId,
      itemId: boardItemId,
    });
    const publishedBy = board?.publishedBy?.trim() ?? "";
    if (publishedBy && memberExplicitlyActive(params.operatingState, publishedBy)) {
      leads.push(publishedBy);
    }
  }
  return { authorizedConfirmerIds: leads, coordinatorBotId };
}

async function resolveTrustedAclForStoredTodolist(params: {
  authority: RuntimeAuthority;
  operatingState: OperatingStateAclSource;
  taskId: string;
  todolistId: string;
}): Promise<TrustedTodolistAcl> {
  const todolist = await loadExecutorTodolist(params.authority, {
    taskId: params.taskId,
    todolistId: params.todolistId,
  });
  return resolveTrustedTodolistAcl({
    authority: params.authority,
    operatingState: params.operatingState,
    taskId: params.taskId,
    boardItemId: todolist?.boardItemId,
  });
}

/**
 * Authenticated actor wins. A request id may repeat it, but must not replace it.
 */
/** Request ACL fields are never an authorization source. */
function ignoreRequestAcl(params: {
  authorizedConfirmerIds?: readonly string[];
  coordinatorBotId?: string | null;
}): void {
  void params.authorizedConfirmerIds;
  void params.coordinatorBotId;
}

function boundRuntimeActor(params: {
  actor?: string;
  requested?: string;
  missingCode: string;
  missingMessage: string;
  mismatchCode: string;
}): string {
  const actor = params.actor?.trim() ?? "";
  const requested = params.requested?.trim() ?? "";
  if (actor && requested && actor !== requested) {
    throw new ClaimContractEntryError(
      params.mismatchCode,
      `${params.mismatchCode}: request identity must match the authenticated actor`,
    );
  }
  const id = actor || requested;
  if (!id) {
    throw new ClaimContractEntryError(params.missingCode, params.missingMessage);
  }
  return id;
}

export type PublishCollaborationBoardItemParams = {
  groupId: string;
  taskId: string;
  remainingWork: string;
  acceptanceCriteria: string[];
  title?: string;
  goal?: string;
  constraints?: string[];
  dueAtMs?: number;
  suggestedRole?: string;
  intendedClaimantIds?: string[];
  publishedBy?: string;
  /** P5 challenge window id when challengeWindow flag ON. */
  challengeWindowId?: string;
  /** P5 per-item 可关. */
  skipChallengeWindow?: boolean;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
};

export async function publishCollaborationBoardItem(
  params: PublishCollaborationBoardItemParams,
): Promise<GroupBoardClaimItem> {
  const cfg = params.cfg ?? loadConfig();
  requireFlag(cfg, params.groupId, tenantIdForClaimFlag(params.groupId, params.tenant));
  await assertPersistedTaskNotStopped({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
  });
  const { authority, stores } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const current = await stores.objectStorage.readObject<Task>(
    params.groupId,
    "task",
    params.taskId,
  );
  if (!current) {
    throw new ClaimContractEntryError("task_not_found", `task not found: ${params.taskId}`);
  }
  const publishedBy =
    params.publishedBy?.trim() ||
    params.actor?.trim() ||
    current.ownerMemberId ||
    current.createdBy;
  if (!publishedBy?.trim()) {
    throw new ClaimContractEntryError("publisher_required", "publishedBy / actor is required");
  }
  return unwrap(
    await publishBoardItem(
      authority,
      {
        groupId: params.groupId,
        taskId: params.taskId,
        title: params.title ?? current.title,
        remainingWork: params.remainingWork,
        acceptanceCriteria: params.acceptanceCriteria,
        goal: params.goal,
        constraints: params.constraints,
        dueAtMs: params.dueAtMs,
        suggestedRole: params.suggestedRole,
        intendedClaimantIds: params.intendedClaimantIds,
        publishedBy,
        challengeWindowId: params.challengeWindowId,
        skipChallengeWindow: params.skipChallengeWindow,
      },
      { cfg },
    ),
    "publishBoardItem",
  );
}

export type ClaimCollaborationBoardItemParams = {
  groupId: string;
  taskId: string;
  itemId: string;
  claimantId?: string;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
};

export async function claimCollaborationBoardItem(
  params: ClaimCollaborationBoardItemParams,
): Promise<GroupBoardClaimItem> {
  const cfg = params.cfg ?? loadConfig();
  requireFlag(cfg, params.groupId, tenantIdForClaimFlag(params.groupId, params.tenant));
  await assertPersistedTaskNotStopped({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
  });
  const { authority } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const claimantId = params.claimantId?.trim() || params.actor?.trim();
  if (!claimantId) {
    throw new ClaimContractEntryError("claimant_required", "claimantId / actor is required");
  }
  return unwrap(
    await claimBoardItem(
      authority,
      {
        taskId: params.taskId,
        itemId: params.itemId,
        claimantId,
      },
      { cfg },
    ),
    "claimBoardItem",
  );
}

export type ApplyCollaborationBoardClaimParams = {
  groupId: string;
  taskId: string;
  itemId: string;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
  /** Test-only: after outside read, before control-lock write. */
  _testAfterTaskReadBarrier?: () => Promise<void>;
  /**
   * Test-only: after board applyClaim succeeds (status=applied) and before the
   * task patch is returned — simulates board durable / task write failure.
   */
  _testAfterBoardAppliedBeforeTaskPatch?: () => Promise<void>;
};

/**
 * Applies a claimed board item: adds claimant to assignedMemberIds, seeds
 * responsibility via task-runtime, persists Task, syncs operatingState
 * (currentTaskId from active task selection).
 *
 * T45: board applyClaim runs **under** the task control lock after the live
 * stop check, so stop cannot land between board-applied and task patch.
 * If board is already applied (retry / prior partial), task side is repaired
 * idempotently without re-mutating the board row.
 */
export async function applyCollaborationBoardClaim(
  params: ApplyCollaborationBoardClaimParams,
): Promise<{ task: GovernedTask; item: GroupBoardClaimItem }> {
  const cfg = params.cfg ?? loadConfig();
  requireFlag(cfg, params.groupId, tenantIdForClaimFlag(params.groupId, params.tenant));
  // T45: stop / partial_success classification runs under the control lock below.
  // An early assertPersistedTaskNotStopped would collapse "board already applied +
  // task stopped" into generic TaskStoppedError and hide the recoverable signal.
  const { authority, stores, operatingState } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const current = await stores.objectStorage.readObject<Task>(
    params.groupId,
    "task",
    params.taskId,
  );
  if (!current) {
    throw new ClaimContractEntryError("task_not_found", `task not found: ${params.taskId}`);
  }
  if (params._testAfterTaskReadBarrier) {
    await params._testAfterTaskReadBarrier();
  }
  let resultItem: GroupBoardClaimItem | null = null;
  const updated = await applyBusinessTaskPatchUnderControlLock({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    // Custom stop handling so board-already-applied + stopped is identifiable.
    refuseIfStopped: false,
    buildPatch: async (live) => {
      const now = Date.now();
      const liveGoverned = asGovernedTask(live);
      const existing = await loadBoardClaimItem(authority, {
        taskId: params.taskId,
        itemId: params.itemId,
      });
      if (isTaskStopAccepted(liveGoverned)) {
        if (existing?.status === "applied") {
          throw new ClaimContractEntryError(
            "partial_success_board_applied_task_stopped",
            `board item ${params.itemId} is applied but task ${params.taskId} is stopped; responsibility not repaired`,
          );
        }
        assertTaskNotStopped(liveGoverned);
      }

      let assignedMemberIds: string[];
      let responsibility: NonNullable<typeof liveGoverned.responsibility>;
      let item: GroupBoardClaimItem;

      if (existing?.status === "applied") {
        // Idempotent recovery: board durable. Repair task projection only when the
        // claim is still the legitimate assignee — never re-grant after a later
        // handoff removed the claimant, and never re-seed over a newer responsibility.
        const claimantId = (existing.claimantId ?? "").trim();
        if (!claimantId) {
          throw new ClaimContractEntryError(
            "claimant_missing",
            "applied board item has no claimantId",
          );
        }
        const assigned = (liveGoverned.assignedMemberIds ?? [])
          .map((s) => s.trim())
          .filter(Boolean);
        const executors = (liveGoverned.responsibility?.executors ?? []).map((s) => s.trim());
        const alreadyProjected = assigned.includes(claimantId) || executors.includes(claimantId);
        // T48: only history after THIS board apply's baseline can supersede the claim.
        // Arbitrary older h.from===claimantId must not block a legitimate new applied repair.
        const handoffs = liveGoverned.handoffs ?? [];
        const baseLen = existing.applyBaseHistoryLen;
        const subsequent =
          typeof baseLen === "number" && baseLen >= 0 ? handoffs.slice(baseLen) : handoffs;
        const handedOffAway = subsequent.some((h) => (h.from ?? "").trim() === claimantId);
        if (!alreadyProjected && handedOffAway) {
          throw new ClaimContractEntryError(
            "stale_applied_claim_superseded",
            `board item ${params.itemId} is applied for ${claimantId}, but a later handoff moved responsibility away; refusing to re-grant`,
          );
        }
        if (alreadyProjected) {
          // Task already reflects claimant — keep live responsibility (do not re-seed).
          assignedMemberIds = assigned;
          responsibility =
            liveGoverned.responsibility ??
            seedTaskResponsibility({
              task: liveGoverned,
              effective: authority.policy.effective,
              actor: claimantId,
              nominatedOwnerId: (liveGoverned.ownerMemberId ?? "").trim() || undefined,
              memberRoleMap: operatingState?.memberRoleMap ?? undefined,
            });
          item = existing;
        } else {
          // Partial success repair: board applied, task never projected claimant.
          const merged = Array.from(new Set([...assigned, claimantId]));
          const baseResp =
            liveGoverned.responsibility ??
            seedTaskResponsibility({
              task: { ...liveGoverned, assignedMemberIds: merged },
              effective: authority.policy.effective,
              actor: claimantId,
              nominatedOwnerId: (liveGoverned.ownerMemberId ?? "").trim() || undefined,
              memberRoleMap: operatingState?.memberRoleMap ?? undefined,
            });
          responsibility = {
            ...baseResp,
            executors: Array.from(
              new Set([...(baseResp.executors ?? []).map((s) => s.trim()), claimantId]),
            ).filter(Boolean),
          };
          assignedMemberIds = merged;
          item = existing;
        }
      } else {
        const applied = unwrap(
          await applyClaim(
            authority,
            { taskId: params.taskId, itemId: params.itemId },
            liveGoverned,
            authority.policy.effective,
            { cfg, memberRoleMap: operatingState?.memberRoleMap ?? null },
          ),
          "applyClaim",
        );
        if (params._testAfterBoardAppliedBeforeTaskPatch) {
          await params._testAfterBoardAppliedBeforeTaskPatch();
        }
        assignedMemberIds = applied.assignedMemberIds;
        responsibility = applied.responsibility;
        item = applied.item;
      }
      resultItem = item;

      const governanceFields = nextGovernedTaskFields({
        task: liveGoverned,
        liveStatus: live.status,
        responsibility,
        handoffs: liveGoverned.handoffs ?? [],
      });
      return {
        ...governanceFields,
        assignedMemberIds,
        updatedBy: params.actor ?? item.claimantId ?? live.updatedBy,
        updatedAtMs: now,
      };
    },
  });
  if (!resultItem) {
    throw new ClaimContractEntryError(
      "apply_incomplete",
      "board claim apply finished without an item result",
    );
  }
  await syncGroupOperatingState({
    fileStore: stores.fileStore,
    groupStorage: stores.groupStorage,
    metadataStorage: stores.metadataStorage,
    memoryStorage: stores.memoryStorage,
    learningStorage: stores.learningStorage,
    objectStorage: stores.objectStorage,
    groupId: params.groupId,
  });
  return { task: updated, item: resultItem };
}

/**
 * Read-only load. Allowed even when claimContract flag is OFF so tip/export
 * can observe AS-IS board facts (writes still fail-closed).
 */
export async function loadCollaborationBoardClaimItem(params: {
  groupId: string;
  taskId: string;
  itemId: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<GroupBoardClaimItem | null> {
  const cfg = params.cfg ?? loadConfig();
  const { authority } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  return loadBoardClaimItem(authority, { taskId: params.taskId, itemId: params.itemId });
}

/** Read-only list for one task (no flag required). */
export async function listCollaborationBoardItems(params: {
  groupId: string;
  taskId: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<GroupBoardClaimItem[]> {
  const cfg = params.cfg ?? loadConfig();
  const { authority } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  return listBoardClaimItems(authority, { taskId: params.taskId });
}

/**
 * Read-only member progress for a task — answers claimed/in_progress/submitted/returned.
 * No ui.* RPC; uses existing board-claims authority.
 */
export async function getCollaborationBoardMemberProgress(params: {
  groupId: string;
  taskId: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<MemberProgressReport> {
  const cfg = params.cfg ?? loadConfig();
  const { authority, operatingState } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const items = await listBoardClaimItems(authority, { taskId: params.taskId });
  const currentTaskId =
    (operatingState as { activeContext?: { currentTaskId?: string | null } } | null)?.activeContext
      ?.currentTaskId ?? null;
  return aggregateMemberProgress({
    items: items.map((item) => ({
      itemId: item.itemId,
      groupId: item.groupId,
      taskId: item.taskId,
      title: item.title,
      status: item.status,
      publishedBy: item.publishedBy,
      claimantId: item.claimantId,
      claimedAt: item.claimedAt,
      appliedAt: item.appliedAt,
      inProgressAt: item.inProgressAt,
      submissionId: item.submissionId,
      submittedAt: item.submittedAt,
      acceptedAt: item.acceptedAt,
      acceptedBy: item.acceptedBy,
      returnedAt: item.returnedAt,
      returnedBy: item.returnedBy,
      returnReason: item.returnReason,
      blockedAt: item.blockedAt,
      blockedReason: item.blockedReason,
    })),
    claimsDir: `${authority.namespace.root}/board-claims`,
    groupIdHint: params.groupId,
    currentTaskId,
  });
}

async function mutateProgress(
  step: string,
  params: {
    groupId: string;
    taskId: string;
    tenant?: CollaborationTenantResolution | null;
    cfg?: OpenBotConfig;
  },
  run: (
    authority: Awaited<ReturnType<typeof buildClaimAuthority>>["authority"],
    cfg: OpenBotConfig,
  ) => Promise<ClaimResult<GroupBoardClaimItem>>,
): Promise<GroupBoardClaimItem> {
  const cfg = params.cfg ?? loadConfig();
  requireFlag(cfg, params.groupId, tenantIdForClaimFlag(params.groupId, params.tenant));
  await assertPersistedTaskNotStopped({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
  });
  const { authority } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  return unwrap(await run(authority, cfg), step);
}

export async function markCollaborationBoardItemInProgress(params: {
  groupId: string;
  taskId: string;
  itemId: string;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<GroupBoardClaimItem> {
  const actorId = params.actor?.trim();
  if (!actorId) {
    throw new ClaimContractEntryError("actor_required", "actor is required");
  }
  return mutateProgress("markBoardItemInProgress", params, (authority, cfg) =>
    markBoardItemInProgress(
      authority,
      { taskId: params.taskId, itemId: params.itemId, actorId },
      { cfg },
    ),
  );
}

export async function submitCollaborationBoardItemForReview(params: {
  groupId: string;
  taskId: string;
  itemId: string;
  submissionId: string;
  /** FINAL v3 S3: product/artifact version bound to this submission. */
  artifactVersion: string;
  submissionSummary?: string;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<GroupBoardClaimItem> {
  const actorId = params.actor?.trim();
  if (!actorId) {
    throw new ClaimContractEntryError("actor_required", "actor is required");
  }
  // Load operating-state coordinator so claim-contract can wake 主答 after submit.
  // Falls back to board publishedBy inside submitBoardItemForReview when null.
  const cfg = params.cfg ?? loadConfig();
  requireFlag(cfg, params.groupId, tenantIdForClaimFlag(params.groupId, params.tenant));
  await assertPersistedTaskNotStopped({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
  });
  const { authority, operatingState } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const coordinatorBotId = trustedCoordinatorBotId(operatingState);
  return unwrap(
    await submitBoardItemForReview(
      authority,
      {
        taskId: params.taskId,
        itemId: params.itemId,
        actorId,
        submissionId: params.submissionId,
        artifactVersion: params.artifactVersion,
        submissionSummary: params.submissionSummary,
      },
      { cfg, coordinatorBotId },
    ),
    "submitBoardItemForReview",
  );
}

export async function acceptCollaborationBoardItemSubmission(params: {
  groupId: string;
  taskId: string;
  itemId: string;
  /** S3: must match pending submissionId. */
  expectedSubmissionId: string;
  /** S3: acceptance rationale. */
  reason: string;
  /** S3: must cover board Acceptance criteria. */
  checkedAcceptanceCriteria: readonly string[];
  proxyForActorId?: string;
  proxyBasis?: string;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<GroupBoardClaimItem> {
  const actorId = params.actor?.trim();
  if (!actorId) {
    throw new ClaimContractEntryError("actor_required", "actor is required");
  }
  return mutateProgress("acceptBoardItemSubmission", params, (authority, cfg) =>
    acceptBoardItemSubmission(
      authority,
      {
        taskId: params.taskId,
        itemId: params.itemId,
        actorId,
        expectedSubmissionId: params.expectedSubmissionId,
        reason: params.reason,
        checkedAcceptanceCriteria: params.checkedAcceptanceCriteria,
        proxyForActorId: params.proxyForActorId,
        proxyBasis: params.proxyBasis,
      },
      { cfg },
    ),
  );
}

export async function returnCollaborationBoardItemSubmission(params: {
  groupId: string;
  taskId: string;
  itemId: string;
  reason: string;
  /** S3: must match pending submissionId. */
  expectedSubmissionId: string;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<GroupBoardClaimItem> {
  const actorId = params.actor?.trim();
  if (!actorId) {
    throw new ClaimContractEntryError("actor_required", "actor is required");
  }
  return mutateProgress("returnBoardItemSubmission", params, (authority, cfg) =>
    returnBoardItemSubmission(
      authority,
      {
        taskId: params.taskId,
        itemId: params.itemId,
        actorId,
        reason: params.reason,
        expectedSubmissionId: params.expectedSubmissionId,
      },
      { cfg },
    ),
  );
}

export async function blockCollaborationBoardItem(params: {
  groupId: string;
  taskId: string;
  itemId: string;
  reason?: string;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<GroupBoardClaimItem> {
  const actorId = params.actor?.trim();
  if (!actorId) {
    throw new ClaimContractEntryError("actor_required", "actor is required");
  }
  return mutateProgress("blockBoardItem", params, (authority, cfg) =>
    blockBoardItem(
      authority,
      {
        taskId: params.taskId,
        itemId: params.itemId,
        actorId,
        reason: params.reason,
      },
      { cfg },
    ),
  );
}

export async function unblockCollaborationBoardItem(params: {
  groupId: string;
  taskId: string;
  itemId: string;
  reason: string;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<GroupBoardClaimItem> {
  const actorId = params.actor?.trim();
  const reason = params.reason?.trim();
  if (!actorId) {
    throw new ClaimContractEntryError("actor_required", "actor is required");
  }
  if (!reason) {
    throw new ClaimContractEntryError("reason_required", "unblock reason is required");
  }
  return mutateProgress("unblockBoardItem", params, (authority, cfg) =>
    unblockBoardItem(
      authority,
      {
        taskId: params.taskId,
        itemId: params.itemId,
        actorId,
        reason,
      },
      { cfg },
    ),
  );
}

export async function cancelCollaborationBoardItem(params: {
  groupId: string;
  taskId: string;
  itemId: string;
  reason?: string;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<GroupBoardClaimItem> {
  const actorId = params.actor?.trim();
  if (!actorId) {
    throw new ClaimContractEntryError("actor_required", "actor is required");
  }
  return mutateProgress("cancelBoardItem", params, (authority, cfg) =>
    cancelBoardItem(
      authority,
      {
        taskId: params.taskId,
        itemId: params.itemId,
        actorId,
        reason: params.reason,
      },
      { cfg },
    ),
  );
}

export async function recordCollaborationBoardItemPeerReview(params: {
  groupId: string;
  taskId: string;
  itemId: string;
  verdict: PeerReviewVerdict;
  comment?: string;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<PeerReviewEvent> {
  const actorId = params.actor?.trim();
  if (!actorId) {
    throw new ClaimContractEntryError("actor_required", "actor is required");
  }
  const cfg = params.cfg ?? loadConfig();
  requireFlag(cfg, params.groupId, tenantIdForClaimFlag(params.groupId, params.tenant));
  const { authority } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const item = await loadBoardClaimItem(authority, {
    taskId: params.taskId,
    itemId: params.itemId,
  });
  if (!item) {
    throw new ClaimContractEntryError("not_found", `board claim item not found: ${params.itemId}`);
  }
  const result = await recordPeerReview(
    authority,
    {
      taskId: params.taskId,
      itemId: params.itemId,
      reviewerId: actorId,
      verdict: params.verdict,
      comment: params.comment,
      item,
    },
    { cfg },
  );
  if (result.ok) {
    return result.value;
  }
  if (result.reason === "flag_off") {
    throw new ClaimContractFlagOffError();
  }
  throw new ClaimContractEntryError(result.reason, `recordPeerReview: ${result.message}`);
}

/**
 * Read-only peer reviews for a task (optional item/submission filters).
 * Observe AS-IS files; does not require claimContract/requirePeerReview flags.
 */
export async function listCollaborationPeerReviews(params: {
  groupId: string;
  taskId: string;
  itemId?: string;
  submissionId?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<PeerReviewEvent[]> {
  const cfg = params.cfg ?? loadConfig();
  const { authority } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  return listPeerReviews(authority, {
    taskId: params.taskId,
    itemId: params.itemId,
    submissionId: params.submissionId,
  });
}

export type { BoardIntentMaterializeInput, BoardPublishDraft, MaterializeIntentResult };

export { buildBoardPublishDraftFromIntent };

/**
 * P1 organizer entry: intent text → board draft → optional human confirm → publish.
 * Reuses publishBoardItem; does not open a second orchestrator.
 */
export async function materializeCollaborationIntentToBoard(params: {
  groupId: string;
  taskId: string;
  message: string;
  publishedBy?: string;
  actor?: string;
  title?: string;
  suggestedClaimantIds?: string[];
  suggestedRole?: string;
  constraints?: string[];
  acceptanceCriteria?: string[];
  dueAtMs?: number;
  requireHumanConfirm?: boolean;
  humanConfirmed?: boolean;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<MaterializeIntentResult> {
  const cfg = params.cfg ?? loadConfig();
  const publishedBy = params.publishedBy?.trim() || params.actor?.trim();
  if (!publishedBy) {
    throw new ClaimContractEntryError("publisher_required", "publishedBy / actor is required");
  }
  const { authority } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const input: BoardIntentMaterializeInput = {
    message: params.message,
    groupId: params.groupId,
    taskId: params.taskId,
    publishedBy,
    title: params.title,
    suggestedClaimantIds: params.suggestedClaimantIds,
    suggestedRole: params.suggestedRole,
    constraints: params.constraints,
    acceptanceCriteria: params.acceptanceCriteria,
    dueAtMs: params.dueAtMs,
    requireHumanConfirm: params.requireHumanConfirm,
    humanConfirmed: params.humanConfirmed,
  };
  return materializeIntentToBoardItem({ authority, input, cfg });
}

// --- P2 Executor-private Todolist + plan gate ---

function unwrapTodolist<T>(result: TodolistResult<T>, step: string): T {
  if (result.ok) {
    return result.value;
  }
  if (result.reason === "flag_off") {
    throw new ClaimContractFlagOffError();
  }
  throw new ClaimContractEntryError(result.reason, `${step}: ${result.message}`);
}

export type ProposeCollaborationTodolistResult = {
  todolist: ExecutorPrivateTodolist;
  /** Independent of plan creation. Failure here does not roll back the proposal. */
  cardDelivery: OwnerDecisionCardDelivery;
};

async function rememberDelivery(
  groupId: string,
  delivery: OwnerDecisionCardDelivery,
  cfg?: OpenBotConfig,
): Promise<OwnerDecisionCardDelivery> {
  try {
    return await recordOwnerDecisionDelivery({ groupId, delivery, cfg });
  } catch {
    return normalizeOwnerDecisionDelivery({ ...delivery, deliveryTracked: false, retryable: true });
  }
}

export async function proposeCollaborationTodolist(params: {
  groupId: string;
  taskId: string;
  boardItemId: string;
  ownerMemberId?: string;
  steps: Array<{ title: string; detail?: string; stepId?: string }>;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<ProposeCollaborationTodolistResult> {
  const cfg = params.cfg ?? loadConfig();
  requireFlag(cfg, params.groupId, tenantIdForClaimFlag(params.groupId, params.tenant));
  await assertPersistedTaskNotStopped({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
  });
  const ownerMemberId = params.ownerMemberId?.trim() || params.actor?.trim();
  if (!ownerMemberId) {
    throw new ClaimContractEntryError("owner_required", "ownerMemberId / actor is required");
  }
  const { authority } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const todolist = unwrapTodolist(
    await proposeTodolist(
      authority,
      {
        boardItemId: params.boardItemId,
        taskId: params.taskId,
        groupId: params.groupId,
        ownerMemberId,
        steps: params.steps,
        proposedBy: ownerMemberId,
      },
      { cfg },
    ),
    "proposeTodolist",
  );
  // Plan creation already committed. Card delivery is a separate, retryable result.
  let cardDelivery = proposalCreatedDelivery(todolist);
  try {
    const emitted = await emitOwnerDecisionCardForProposedTodolist({
      groupId: params.groupId,
      todolist,
      authority,
      cfg,
    });
    cardDelivery = emitted.delivery;
  } catch (err) {
    cardDelivery = await rememberDelivery(
      params.groupId,
      normalizeOwnerDecisionDelivery({
        ...proposalCreatedDelivery(todolist),
        ok: false,
        stage: "delivery_failed",
        reason: "emit_threw",
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
        userFacing: "delivery_failed_retryable",
      }),
      cfg,
    );
  }
  return { todolist, cardDelivery };
}

/**
 * Re-deliver the card for an existing proposal version.
 * Does not call proposeTodolist or confirmTodolist.
 */
export async function retryCollaborationOwnerDecisionDelivery(params: {
  groupId: string;
  taskId: string;
  todolistId: string;
  expectedVersion?: number;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<ProposeCollaborationTodolistResult> {
  const cfg = params.cfg ?? loadConfig();
  requireFlag(cfg, params.groupId, tenantIdForClaimFlag(params.groupId, params.tenant));
  const todolist = await getCollaborationTodolist({
    groupId: params.groupId,
    taskId: params.taskId,
    todolistId: params.todolistId,
    actor: params.actor,
    tenant: params.tenant,
    cfg,
  });
  const expected = params.expectedVersion;
  if (
    typeof expected === "number" &&
    Number.isFinite(expected) &&
    Math.floor(expected) !== todolist.version
  ) {
    const requestedVersion = Math.floor(expected);
    const cardDelivery = await rememberDelivery(
      params.groupId,
      staleOwnerDecisionDelivery({
        // Record the requested version as stale. Do not label the live proposal stale.
        todolist: { ...todolist, version: requestedVersion },
        reason: "version_mismatch",
        message: "旧版本已失效",
      }),
      cfg,
    );
    return { todolist, cardDelivery };
  }
  if (todolist.status === "superseded") {
    const cardDelivery = await rememberDelivery(
      params.groupId,
      staleOwnerDecisionDelivery({
        todolist,
        reason: "superseded",
        message: "旧版本已失效",
      }),
      cfg,
    );
    return { todolist, cardDelivery };
  }
  if (todolist.status === "confirmed") {
    const cardDelivery = await rememberDelivery(
      params.groupId,
      confirmationConsumedDelivery(todolist),
      cfg,
    );
    return { todolist, cardDelivery };
  }
  const { authority } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  try {
    const emitted = await emitOwnerDecisionCardForProposedTodolist({
      groupId: params.groupId,
      todolist,
      authority,
      cfg,
    });
    return { todolist, cardDelivery: emitted.delivery };
  } catch (err) {
    const cardDelivery = await rememberDelivery(
      params.groupId,
      normalizeOwnerDecisionDelivery({
        ...proposalCreatedDelivery(todolist),
        ok: false,
        stage: "delivery_failed",
        reason: "emit_threw",
        message: err instanceof Error ? err.message : String(err),
        retryable: true,
        userFacing: "delivery_failed_retryable",
      }),
      cfg,
    );
    return { todolist, cardDelivery };
  }
}

export async function listCollaborationOwnerDecisionDeliveries(params: {
  groupId: string;
  taskId?: string;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<OwnerDecisionCardDelivery[]> {
  const cfg = params.cfg ?? loadConfig();
  const rows = await readOwnerDecisionDeliveries({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
  });
  const latest = new Map<string, OwnerDecisionCardDelivery>();
  for (const row of rows) {
    latest.set(`${row.todolistId}:v${row.version}`, row);
  }
  const visible: OwnerDecisionCardDelivery[] = [];
  const readable = new Map<string, boolean>();
  for (const row of latest.values()) {
    const key = `${row.taskId}:${row.todolistId}`;
    let canRead = readable.get(key);
    if (canRead == null) {
      try {
        await getCollaborationTodolist({
          groupId: params.groupId,
          taskId: row.taskId,
          todolistId: row.todolistId,
          actor: params.actor,
          tenant: params.tenant,
          cfg,
        });
        canRead = true;
      } catch {
        canRead = false;
      }
      readable.set(key, canRead);
    }
    // D6b: historyReloadable describes redraw eligibility for an already-authorized
    // viewer; it must not bypass current access re-check after revocation.
    if (canRead) {
      visible.push(row);
    }
  }
  return visible;
}

export async function confirmCollaborationTodolist(params: {
  groupId: string;
  taskId: string;
  todolistId: string;
  confirmerId?: string;
  /** Card plan version. See confirmTodolist. Does not widen who may confirm. */
  expectedVersion?: number;
  actor?: string;
  /** Ignored. Confirmers are resolved from board publishedBy + operating state. */
  authorizedConfirmerIds?: string[];
  /** Ignored. Coordinator comes from operating-state governance, not the request. */
  coordinatorBotId?: string | null;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<ExecutorPrivateTodolist> {
  const cfg = params.cfg ?? loadConfig();
  ignoreRequestAcl(params);
  requireFlag(cfg, params.groupId, tenantIdForClaimFlag(params.groupId, params.tenant));
  await assertPersistedTaskNotStopped({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
  });
  const confirmerId = boundRuntimeActor({
    actor: params.actor,
    requested: params.confirmerId,
    missingCode: "confirmer_required",
    missingMessage: "confirmerId / actor is required",
    mismatchCode: "confirmer_mismatch",
  });
  const { authority, operatingState } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const acl = await resolveTrustedAclForStoredTodolist({
    authority,
    operatingState,
    taskId: params.taskId,
    todolistId: params.todolistId,
  });
  const confirmed = unwrapTodolist(
    await confirmTodolist(
      authority,
      {
        taskId: params.taskId,
        todolistId: params.todolistId,
        confirmerId,
        expectedVersion: params.expectedVersion,
      },
      { cfg, ...acl },
    ),
    "confirmTodolist",
  );
  try {
    await recordOwnerDecisionDelivery({
      groupId: params.groupId,
      cfg,
      delivery: confirmationConsumedDelivery(confirmed),
    });
  } catch {
    // Confirmation already committed. Tracking must not roll it back or repeat it.
  }
  return confirmed;
}

export async function reviseCollaborationTodolist(params: {
  groupId: string;
  taskId: string;
  todolistId: string;
  reason: string;
  reviserId?: string;
  /** Card plan version. See reviseTodolist. Does not widen who may revise. */
  expectedVersion?: number;
  actor?: string;
  steps?: Array<{ title: string; detail?: string; stepId?: string }>;
  /** Ignored. See confirmCollaborationTodolist. */
  authorizedConfirmerIds?: string[];
  /** Ignored. See confirmCollaborationTodolist. */
  coordinatorBotId?: string | null;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<ExecutorPrivateTodolist> {
  const cfg = params.cfg ?? loadConfig();
  ignoreRequestAcl(params);
  requireFlag(cfg, params.groupId, tenantIdForClaimFlag(params.groupId, params.tenant));
  await assertPersistedTaskNotStopped({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
  });
  const reviserId = boundRuntimeActor({
    actor: params.actor,
    requested: params.reviserId,
    missingCode: "reviser_required",
    missingMessage: "reviserId / actor is required",
    mismatchCode: "reviser_mismatch",
  });
  const { authority, operatingState } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const acl = await resolveTrustedAclForStoredTodolist({
    authority,
    operatingState,
    taskId: params.taskId,
    todolistId: params.todolistId,
  });
  return unwrapTodolist(
    await reviseTodolist(
      authority,
      {
        taskId: params.taskId,
        todolistId: params.todolistId,
        reviserId,
        reason: params.reason,
        steps: params.steps,
        expectedVersion: params.expectedVersion,
      },
      { cfg, ...acl },
    ),
    "reviseTodolist",
  );
}

export async function getCollaborationTodolist(params: {
  groupId: string;
  taskId: string;
  todolistId: string;
  viewerId?: string;
  actor?: string;
  /** Ignored. See confirmCollaborationTodolist. */
  authorizedConfirmerIds?: string[];
  /** Ignored. See confirmCollaborationTodolist. */
  coordinatorBotId?: string | null;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<ExecutorPrivateTodolist> {
  const cfg = params.cfg ?? loadConfig();
  ignoreRequestAcl(params);
  const viewerId = boundRuntimeActor({
    actor: params.actor,
    requested: params.viewerId,
    missingCode: "viewer_required",
    missingMessage: "viewerId / actor is required",
    mismatchCode: "viewer_mismatch",
  });
  const { authority, operatingState } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const todolist = await loadExecutorTodolist(authority, {
    taskId: params.taskId,
    todolistId: params.todolistId,
  });
  if (!todolist) {
    throw new ClaimContractEntryError("not_found", `todolist not found: ${params.todolistId}`);
  }
  const acl = await resolveTrustedTodolistAcl({
    authority,
    operatingState,
    taskId: params.taskId,
    boardItemId: todolist.boardItemId,
  });
  if (
    !canReadExecutorTodolist({
      viewerId,
      todolist,
      ...acl,
    })
  ) {
    throw new ClaimContractEntryError(
      "forbidden",
      "todolist is executor-private; only owner, lead/主答, or coordinator may read",
    );
  }
  return todolist;
}

export async function listCollaborationTodolists(params: {
  groupId: string;
  taskId: string;
  boardItemId?: string;
  ownerMemberId?: string;
  viewerId?: string;
  actor?: string;
  /** Ignored. See confirmCollaborationTodolist. */
  authorizedConfirmerIds?: string[];
  /** Ignored. See confirmCollaborationTodolist. */
  coordinatorBotId?: string | null;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<ExecutorPrivateTodolist[]> {
  const cfg = params.cfg ?? loadConfig();
  ignoreRequestAcl(params);
  const viewerId = boundRuntimeActor({
    actor: params.actor,
    requested: params.viewerId,
    missingCode: "viewer_required",
    missingMessage: "viewerId / actor is required",
    mismatchCode: "viewer_mismatch",
  });
  const { authority, operatingState } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const items = await listExecutorTodolists(authority, {
    taskId: params.taskId,
    boardItemId: params.boardItemId,
    ownerMemberId: params.ownerMemberId,
  });
  const cache = new Map<string, TrustedTodolistAcl>();
  const visible: ExecutorPrivateTodolist[] = [];
  for (const todolist of items) {
    let acl = cache.get(todolist.boardItemId);
    if (!acl) {
      acl = await resolveTrustedTodolistAcl({
        authority,
        operatingState,
        taskId: params.taskId,
        boardItemId: todolist.boardItemId,
      });
      cache.set(todolist.boardItemId, acl);
    }
    if (canReadExecutorTodolist({ viewerId, todolist, ...acl })) {
      visible.push(todolist);
    }
  }
  return visible;
}

export async function buildCollaborationExecutionTaskBag(params: {
  groupId: string;
  taskId: string;
  boardItemId: string;
  ownerMemberId: string;
  /** Viewer for private Todolist ACL. Does not fall back to ownerMemberId. */
  viewerId?: string;
  actor?: string;
  /** Ignored. See confirmCollaborationTodolist. */
  authorizedConfirmerIds?: string[];
  /** Ignored. See confirmCollaborationTodolist. */
  coordinatorBotId?: string | null;
  requireDeliveryComplete?: boolean;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<ExecutionTaskBag> {
  const cfg = params.cfg ?? loadConfig();
  ignoreRequestAcl(params);
  const viewerId = boundRuntimeActor({
    actor: params.actor,
    requested: params.viewerId,
    missingCode: "viewer_required",
    missingMessage: "viewerId / actor is required",
    mismatchCode: "viewer_mismatch",
  });
  const { authority, operatingState } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const acl = await resolveTrustedTodolistAcl({
    authority,
    operatingState,
    taskId: params.taskId,
    boardItemId: params.boardItemId,
  });
  return unwrapTodolist(
    await buildExecutionTaskBagForActor(authority, {
      taskId: params.taskId,
      boardItemId: params.boardItemId,
      ownerMemberId: params.ownerMemberId,
      viewerId,
      ...acl,
      requireDeliveryComplete: params.requireDeliveryComplete,
    }),
    "buildExecutionTaskBag",
  );
}

export async function signalCollaborationInsight(params: {
  groupId: string;
  taskId: string;
  boardItemId: string;
  insightSummary: string;
  toLeadIds: string[];
  fromMemberId?: string;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<{ woke: boolean; wakeId?: string }> {
  const cfg = params.cfg ?? loadConfig();
  const fromMemberId = params.fromMemberId?.trim() || params.actor?.trim();
  if (!fromMemberId) {
    throw new ClaimContractEntryError("actor_required", "fromMemberId / actor is required");
  }
  const { authority } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  return unwrapTodolist(
    await signalInsight(
      authority,
      {
        groupId: params.groupId,
        taskId: params.taskId,
        boardItemId: params.boardItemId,
        fromMemberId,
        toLeadIds: params.toLeadIds,
        insightSummary: params.insightSummary,
      },
      { cfg },
    ),
    "signalInsight",
  );
}

// --- P5 challenge window entry (deploy L-Deploy short gate) ---

function draftSnapshotFromParams(params: {
  goal?: string;
  remainingWork: string;
  acceptanceCriteria: string[];
  constraints?: string[];
  suggestedRole?: string;
  title?: string;
}): ChallengeDraftSnapshot {
  return {
    goal: params.goal?.trim() || params.remainingWork,
    remainingWork: params.remainingWork,
    acceptanceCriteria: params.acceptanceCriteria,
    constraints: params.constraints,
    suggestedRole: params.suggestedRole,
    title: params.title,
  };
}

export async function openCollaborationChallengeWindow(params: {
  groupId: string;
  taskId: string;
  challengerId: string;
  remainingWork: string;
  acceptanceCriteria: string[];
  goal?: string;
  constraints?: string[];
  suggestedRole?: string;
  title?: string;
  windowId?: string;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<ChallengeWindowRecord> {
  const leadId = params.actor?.trim();
  if (!leadId) {
    throw new ClaimContractEntryError("actor_required", "actor (lead/主答) is required");
  }
  const cfg = params.cfg ?? loadConfig();
  const { authority } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const result = await openChallengeWindow(
    authority,
    {
      groupId: params.groupId,
      taskId: params.taskId,
      leadId,
      challengerId: params.challengerId,
      draft: draftSnapshotFromParams(params),
      windowId: params.windowId,
    },
    { cfg },
  );
  if (result.ok) {
    return result.value;
  }
  if (result.reason === "flag_off") {
    throw new ClaimContractEntryError("flag_off", "collaboration.task.challengeWindow is off");
  }
  throw new ClaimContractEntryError(result.reason, `openChallengeWindow: ${result.message}`);
}

export async function recordCollaborationChallengeCritique(params: {
  groupId: string;
  taskId: string;
  windowId: string;
  issues: ChallengeIssueKind[];
  comment: string;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<ChallengeWindowRecord> {
  const challengerId = params.actor?.trim();
  if (!challengerId) {
    throw new ClaimContractEntryError("actor_required", "actor (challenger/蓝) is required");
  }
  const cfg = params.cfg ?? loadConfig();
  const { authority } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const result = await recordChallengeCritique(
    authority,
    {
      taskId: params.taskId,
      windowId: params.windowId,
      challengerId,
      issues: params.issues,
      comment: params.comment,
    },
    { cfg },
  );
  if (result.ok) {
    return result.value;
  }
  if (result.reason === "flag_off") {
    throw new ClaimContractEntryError("flag_off", "collaboration.task.challengeWindow is off");
  }
  throw new ClaimContractEntryError(result.reason, `recordChallengeCritique: ${result.message}`);
}

export async function resolveCollaborationChallengeWindow(params: {
  groupId: string;
  taskId: string;
  windowId: string;
  decision: ChallengeResolutionDecision;
  reason: string;
  revisedDraft?: ChallengeDraftSnapshot;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<ChallengeWindowRecord> {
  const leadId = params.actor?.trim();
  if (!leadId) {
    throw new ClaimContractEntryError("actor_required", "actor (lead/主答) is required");
  }
  const cfg = params.cfg ?? loadConfig();
  const { authority } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const result = await resolveChallengeWindow(
    authority,
    {
      taskId: params.taskId,
      windowId: params.windowId,
      leadId,
      decision: params.decision,
      reason: params.reason,
      revisedDraft: params.revisedDraft,
    },
    { cfg },
  );
  if (result.ok) {
    return result.value;
  }
  if (result.reason === "flag_off") {
    throw new ClaimContractEntryError("flag_off", "collaboration.task.challengeWindow is off");
  }
  throw new ClaimContractEntryError(result.reason, `resolveChallengeWindow: ${result.message}`);
}

export async function skipCollaborationChallengeWindow(params: {
  groupId: string;
  taskId: string;
  remainingWork: string;
  acceptanceCriteria: string[];
  skipReason: string;
  goal?: string;
  constraints?: string[];
  suggestedRole?: string;
  title?: string;
  windowId?: string;
  actor?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<ChallengeWindowRecord> {
  const leadId = params.actor?.trim();
  if (!leadId) {
    throw new ClaimContractEntryError("actor_required", "actor (lead/主答) is required");
  }
  const cfg = params.cfg ?? loadConfig();
  const { authority } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  const result = await skipChallengeWindow(
    authority,
    {
      groupId: params.groupId,
      taskId: params.taskId,
      leadId,
      draft: draftSnapshotFromParams(params),
      skipReason: params.skipReason,
      windowId: params.windowId,
    },
    { cfg },
  );
  if (result.ok) {
    return result.value;
  }
  if (result.reason === "flag_off") {
    throw new ClaimContractEntryError("flag_off", "collaboration.task.challengeWindow is off");
  }
  throw new ClaimContractEntryError(result.reason, `skipChallengeWindow: ${result.message}`);
}

/**
 * Read-only challenge windows for a task (observe AS-IS; does not require flag).
 */
export async function listCollaborationChallengeWindows(params: {
  groupId: string;
  taskId: string;
  windowId?: string;
  tenant?: CollaborationTenantResolution | null;
  cfg?: OpenBotConfig;
}): Promise<ChallengeWindowRecord[]> {
  const cfg = params.cfg ?? loadConfig();
  const { authority } = await buildClaimAuthority({
    groupId: params.groupId,
    taskId: params.taskId,
    cfg,
    tenant: params.tenant,
  });
  return listChallengeWindows(authority, {
    taskId: params.taskId,
    windowId: params.windowId,
  });
}

export type {
  ChallengeDraftSnapshot,
  ChallengeIssueKind,
  ChallengeResolutionDecision,
  ChallengeWindowRecord,
};

export { formatExecutionTaskBagForPrompt };
export type { ExecutionTaskBag, ExecutorPrivateTodolist };
