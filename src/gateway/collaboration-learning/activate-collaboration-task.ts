/**
 * TEAM-REAL F1.1 — Activate an independent collaboration Task + shared board item.
 *
 * Reuses materializeCollaborationIntentToBoard / publishBoardItem. Does not open a
 * second orchestrator, remount formal-root twins, or treat oral chat as a board fact.
 *
 * Review B: task writes go through withTaskControlLock; terminal tasks are never
 * reopened; activationKey is a full contract fingerprint used for lock-scoped
 * idempotency; board sync failure after publish returns partial_success.
 */
import { createHash } from "node:crypto";
import type { Task } from "@openbot/collaboration-core";
import {
  buildAuthoritativeResponsibility,
  parseAppointedProjectOwner,
  type KnownBindingMember,
} from "../../agent-runtime/policy/collaboration-current-goal-binding.js";
import type { TaskResponsibility } from "../../agent-runtime/policy/collaboration-policy-model.js";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { GroupBoardClaimItem } from "../collaboration-dispatch/claim-contract.js";
import { oralDispatchCreatesBoardFact } from "../collaboration-dispatch/claim-contract.js";
import { listBoardClaimItems } from "../collaboration-dispatch/claim-contract.js";
import { episodeIdForClientRun } from "../collaboration-dispatch/collaboration-event-key.js";
import type { MaterializeIntentResult } from "../collaboration-dispatch/intent-board-materialize.js";
import {
  materializeIntentToBoardItem,
  type BoardIntentMaterializeInput,
} from "../collaboration-dispatch/intent-board-materialize.js";
import { resolveGroupPolicyInput } from "../collaboration-dispatch/resolve-effective-policy.js";
import {
  createRoundPolicySnapshot,
  generatePolicySnapshotId,
} from "../collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { buildRuntimeNamespace } from "../collaboration-dispatch/runtime-namespace.js";
import { withTaskControlLock } from "../collaboration-dispatch/task-control-cas.js";
import type { WakeRoundDispatcher } from "../collaboration-dispatch/wake-round-dispatch.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { ClaimContractEntryError } from "./claim-contract-entry.js";
import {
  adjudicateDiscussToTaskTagsUnderLock,
  isDiscussToTaskMetaTag,
} from "./discuss-to-task-stages.js";
import { readGroupOperatingState, syncGroupOperatingState } from "./shared.js";
import {
  resolveTeamDeliverableStores,
  type TeamResourceAuthOk,
  type TrustedGroupStores,
} from "./team-resource-auth.js";
import {
  resolveAuthorityTenantForEntry,
  type CollaborationTenantResolution,
} from "./trusted-tenant.js";
import {
  tryClaimAfterBoardPublish,
  type TryClaimAfterBoardPublishResult,
} from "./try-claim-after-board-publish.js";

/** Board publish is not dispatcher acceptance. Never flip to true here. */
export const ACTIVATE_SUCCESS_DISPATCHED = false as const;

export type ActivateFormalClaimAdvance = TryClaimAfterBoardPublishResult;

export type ActivateCollaborationTaskInput = {
  groupId: string;
  /** Stable task id chosen by caller (must be filesystem-safe). */
  taskId: string;
  title: string;
  message: string;
  actor: string;
  /** User-appointed project owner; recorded separately from the standing group coordinator. */
  appointedOwnerId?: string | null;
  /** Standing group coordinator bot id; never used as a fallback project owner. */
  coordinatorBotId?: string | null;
  knownMembers?: readonly KnownBindingMember[] | null;
  goal?: string;
  acceptanceCriteria?: readonly string[];
  constraints?: readonly string[];
  suggestedClaimantIds?: readonly string[];
  suggestedRole?: string;
  dueAtMs?: number;
  /** Required for publish. Draft-only when false/omitted. */
  humanConfirmed?: boolean;
  requireHumanConfirm?: boolean;
  skipChallengeWindow?: boolean;
  tenant?: CollaborationTenantResolution | null;
  /** Trusted auth from gateway — preferred store root (managed tenants/<tid>/…). */
  auth?: TeamResourceAuthOk | null;
  /** Explicit trusted locator for tests; never silent ~/.openbot/collaboration. */
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  cfg?: OpenBotConfig;
  nowMs?: number;
  /** Extra tags merged under withTaskControlLock (e.g. discuss-to-task source/contract). */
  extraTags?: readonly string[];
  /**
   * Test/boot override for post-publish handoff consumeWake. undefined → process
   * registry; null → force recorded-not-dispatched (dispatcher unavailable).
   * Activate.dispatched stays false either way.
   */
  roundDispatcher?: WakeRoundDispatcher | null;
};

export type ActivateCollaborationTaskResult =
  | {
      status: "needs_confirm";
      taskId: string;
      activationKey: string;
      reason: string;
      qualityIssues?: string[];
      draftTitle?: string;
      taskEnsured: boolean;
      boardPublished: false;
      dispatched: false;
    }
  | {
      status: "blocked";
      taskId: string;
      activationKey: string;
      reason: string;
      detail?: string;
      taskEnsured: boolean;
      boardPublished: false;
      dispatched: false;
    }
  | {
      status: "partial_success";
      taskId: string;
      activationKey: string;
      boardItemId: string;
      item: GroupBoardClaimItem;
      taskCreated: boolean;
      reason: string;
      detail?: string;
      taskEnsured: true;
      boardPublished: true;
      operatingStateSynced: false;
      dispatched: false;
      /** Real claim entry outcome after publish; absent when claim was not attempted. */
      formalClaim?: ActivateFormalClaimAdvance;
    }
  | {
      status: "activated";
      taskId: string;
      activationKey: string;
      boardItemId: string;
      item: GroupBoardClaimItem;
      taskCreated: boolean;
      idempotentReplay: boolean;
      currentTaskId: string | null;
      taskEnsured: true;
      boardPublished: true;
      operatingStateSynced: true;
      dispatched: false;
      /** Real claimCollaborationBoardItem outcome when a rightful actor was present or blocked. */
      formalClaim: ActivateFormalClaimAdvance;
    };

const TERMINAL_TASK_STATUSES = new Set(["completed", "cancelled"]);

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Stable activation key = normalized full contract fingerprint (not free-text join). */

function resolveActivationStores(params: {
  groupId: string;
  cfg: OpenBotConfig;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  tenant?: CollaborationTenantResolution | null;
}):
  | { ok: true; stores: TrustedGroupStores & { groupDir: string } }
  | { ok: false; reason: string; detail?: string } {
  const resolved = resolveTeamDeliverableStores({
    auth: params.auth,
    trusted: params.trusted,
    groupId: params.groupId,
    cfg: params.cfg,
    tenantId: params.auth?.tenantId ?? params.tenant?.tenantId ?? null,
  });
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason, detail: resolved.detail };
  }
  return { ok: true, stores: resolved };
}

async function buildTrustedBoardAuthority(params: {
  groupId: string;
  taskId: string;
  cfg: OpenBotConfig;
  stores: TrustedGroupStores;
  tenant?: CollaborationTenantResolution | null;
}) {
  const operatingState = await readGroupOperatingState({
    fileStore: params.stores.fileStore,
    groupId: params.groupId,
  });
  const now = Date.now();
  const snapshot = createRoundPolicySnapshot(resolveGroupPolicyInput({ operatingState }), {
    now,
    idGen: () => generatePolicySnapshotId(now),
  });
  const tenant = resolveAuthorityTenantForEntry({
    preferred: params.tenant,
    groupTenantId: params.tenant?.tenantId ?? null,
  });
  const profile = resolveSecurityProfile(params.cfg).profile;
  // Force namespace onto the same trusted locator used for task/deliverable SoT.
  const namespace = buildRuntimeNamespace({
    profile,
    tenantId: tenant.tenantId,
    groupId: params.groupId,
    groupLocator: params.stores.groupLocator,
  });
  const authority = createRuntimeAuthority({
    snapshot,
    episodeId: episodeIdForClientRun(`task-claim:${params.groupId}:${params.taskId}`),
    tenant,
    groupId: params.groupId,
    profile,
    cfg: params.cfg,
  });
  // Replace namespace root with trusted locator (createRuntimeAuthority may re-resolve).
  return {
    authority: { ...authority, namespace },
    operatingState,
  };
}

export function buildActivationKey(params: {
  groupId: string;
  taskId: string;
  title: string;
  goal?: string;
  acceptanceCriteria?: readonly string[];
  constraints?: readonly string[];
  message?: string;
  suggestedClaimantIds?: readonly string[];
  suggestedRole?: string;
  dueAtMs?: number;
}): string {
  const normList = (values: readonly string[] | undefined) =>
    [...(values ?? [])]
      .map((line) => compact(line))
      .filter(Boolean)
      .sort();
  const payload = {
    groupId: compact(params.groupId),
    taskId: compact(params.taskId),
    title: compact(params.title),
    goal: compact(params.goal) || null,
    message: compact(params.message) || null,
    acceptanceCriteria: normList(params.acceptanceCriteria),
    constraints: normList(params.constraints),
    suggestedClaimantIds: normList(params.suggestedClaimantIds),
    suggestedRole: compact(params.suggestedRole) || null,
    dueAtMs:
      typeof params.dueAtMs === "number" && Number.isFinite(params.dueAtMs)
        ? Math.floor(params.dueAtMs)
        : null,
  };
  return `act-${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24)}`;
}

function isSafeTaskId(taskId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(taskId);
}

function boardItemActivationKey(item: GroupBoardClaimItem): string {
  const raw = (item as { activationKey?: unknown }).activationKey;
  return typeof raw === "string" ? compact(raw) : "";
}

type EnsureTaskResult =
  | { ok: true; task: Task; created: boolean }
  | { ok: false; reason: string; detail?: string };

/**
 * Create or touch task under the unified task control lock.
 * Never reopens completed/cancelled. Draft stays draft until readyRequested.
 */
const ACTIVATION_TAG_PREFIX = "activationKey:";

function mergeActivationTag(
  existing: readonly string[] | undefined,
  activationKey: string | undefined,
): string[] | undefined {
  const key = compact(activationKey);
  const base = [...(existing ?? [])].filter((tag) => !tag.startsWith(ACTIVATION_TAG_PREFIX));
  if (!key) {
    return base.length ? base : existing ? [...existing] : undefined;
  }
  return [...base, `${ACTIVATION_TAG_PREFIX}${key}`];
}

function taskActivationKey(task: Task | null | undefined): string {
  const tag = (task?.tags ?? []).find((row) => row.startsWith(ACTIVATION_TAG_PREFIX));
  return tag ? tag.slice(ACTIVATION_TAG_PREFIX.length) : "";
}

function mergeExtraTags(
  existing: readonly string[] | undefined,
  extraTags: readonly string[] | undefined,
): string[] | undefined {
  if (!extraTags || extraTags.length === 0) {
    return existing ? [...existing] : undefined;
  }
  const out = [...(existing ?? [])];
  for (const tag of extraTags) {
    const compactTag = compact(tag);
    if (!compactTag) {
      continue;
    }
    // Replace prior tags with the same prefix (text before first ':' or whole).
    const prefix = compactTag.includes(":")
      ? compactTag.slice(0, compactTag.indexOf(":") + 1)
      : compactTag;
    // Discuss-to-task ownership / claim tags are not generically replaceable.
    // Lock-held adjudication decides create/replay/conflict before this merge.
    if (isDiscussToTaskMetaTag(compactTag)) {
      const prior = out.find((row) => row.startsWith(prefix));
      if (prior && prior !== compactTag) {
        // Keep first-accepted value; caller should have conflicted already.
        continue;
      }
      if (prior && prior === compactTag) {
        continue;
      }
      out.push(compactTag);
      continue;
    }
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (prefix && out[i].startsWith(prefix)) {
        out.splice(i, 1);
      }
    }
    out.push(compactTag);
  }
  return out;
}

async function mutateCollaborationTaskObject(params: {
  groupId: string;
  taskId: string;
  title: string;
  actor: string;
  activationKey?: string;
  extraTags?: readonly string[];
  /** When true, new or draft tasks become ready; terminal still refused. */
  readyRequested: boolean;
  cfg: OpenBotConfig;
  nowMs?: number;
  stores: TrustedGroupStores;
  appointedOwnerId?: string | null;
  coordinatorBotId?: string | null;
  knownMembers?: readonly KnownBindingMember[] | null;
  message?: string | null;
}): Promise<EnsureTaskResult> {
  const now = params.nowMs ?? Date.now();
  const stores = params.stores;
  const existing = await stores.objectStorage.readObject<Task>(
    params.groupId,
    "task",
    params.taskId,
  );
  // Lock-held discuss-to-task source owner / kind / claim adjudication.
  const adjudication = adjudicateDiscussToTaskTagsUnderLock({
    existingTags: existing?.tags,
    proposedExtraTags: params.extraTags,
  });
  if (adjudication.action === "conflict") {
    return {
      ok: false,
      reason: adjudication.reason,
      detail: adjudication.detail,
    };
  }
  const effectiveExtraTags = ((): readonly string[] | undefined => {
    if (adjudication.action === "passthrough") {
      return params.extraTags;
    }
    const nonD2t = [...(params.extraTags ?? [])].filter((tag) => !isDiscussToTaskMetaTag(tag));
    return [...nonD2t, ...adjudication.tags];
  })();

  if (existing) {
    if (TERMINAL_TASK_STATUSES.has(existing.status)) {
      return {
        ok: false,
        reason: "terminal_task_not_reopened",
        detail: `task status=${existing.status}`,
      };
    }
    // Defense in depth: never silently replace a first-persisted activationKey.
    // Field changes (message/goal/constraints/candidates) require explicit revise,
    // not confirm-time overwrite (P1 #164 final hardening).
    const priorActivationKey = taskActivationKey(existing);
    const requestedActivationKey = compact(params.activationKey);
    if (
      priorActivationKey &&
      requestedActivationKey &&
      priorActivationKey !== requestedActivationKey
    ) {
      return {
        ok: false,
        reason: "activation_contract_conflict",
        detail: `existing activationKey=${priorActivationKey} requested=${requestedActivationKey}`,
      };
    }
    const nextStatus =
      params.readyRequested && existing.status === "draft" ? "ready" : existing.status;
    const tags = mergeExtraTags(
      mergeActivationTag(existing.tags, params.activationKey),
      effectiveExtraTags,
    );
    const existingResponsibility = (existing as Task & { responsibility?: TaskResponsibility })
      .responsibility;
    const appointment = parseAppointedProjectOwner({
      message: params.message,
      appointedOwnerId: params.appointedOwnerId,
      knownMembers: params.knownMembers,
    });
    const responsibility = buildAuthoritativeResponsibility({
      appointedOwnerId: appointment?.ownerId,
      standingCoordinatorBotId: params.coordinatorBotId,
      createdBy: compact(params.actor),
      existingOwnerMemberId: existing.ownerMemberId,
      existingResponsibility,
      assignedMemberIds: existing.assignedMemberIds,
    });
    const touched: Task = {
      ...existing,
      title: compact(params.title) || existing.title,
      status: nextStatus,
      tags,
      ownerMemberId:
        responsibility.owner === "group" ? existing.ownerMemberId : responsibility.owner,
      updatedBy: compact(params.actor) || existing.updatedBy,
      updatedAtMs: now,
      responsibility,
    } as Task;
    await stores.objectStorage.writeObject(params.groupId, "task", params.taskId, touched);
    return { ok: true, task: touched, created: false };
  }
  const appointment = parseAppointedProjectOwner({
    message: params.message,
    appointedOwnerId: params.appointedOwnerId,
    knownMembers: params.knownMembers,
  });
  const responsibility = buildAuthoritativeResponsibility({
    appointedOwnerId: appointment?.ownerId,
    standingCoordinatorBotId: params.coordinatorBotId,
    createdBy: compact(params.actor),
    assignedMemberIds: compact(params.actor) ? [compact(params.actor)] : [],
  });
  const created: Task = {
    taskId: params.taskId,
    groupId: params.groupId,
    title: compact(params.title) || params.taskId,
    status: params.readyRequested ? "ready" : "draft",
    ownerMemberId:
      responsibility.owner !== "group" ? responsibility.owner : compact(params.actor) || undefined,
    assignedMemberIds: compact(params.actor) ? [compact(params.actor)] : [],
    tags: mergeExtraTags(mergeActivationTag(undefined, params.activationKey), effectiveExtraTags),
    createdBy: compact(params.actor) || undefined,
    updatedBy: compact(params.actor) || undefined,
    createdAtMs: now,
    updatedAtMs: now,
    responsibility,
  } as Task;
  await stores.objectStorage.writeObject(params.groupId, "task", params.taskId, created);
  return { ok: true, task: created, created: true };
}

async function ensureCollaborationTaskObject(params: {
  groupId: string;
  taskId: string;
  title: string;
  actor: string;
  activationKey?: string;
  extraTags?: readonly string[];
  readyRequested: boolean;
  cfg?: OpenBotConfig;
  nowMs?: number;
  /** Trusted tenant-scoped stores — required (no host collaboration fallthrough). */
  stores: TrustedGroupStores;
  /** When true, caller already holds withTaskControlLock. */
  alreadyLocked?: boolean;
  appointedOwnerId?: string | null;
  coordinatorBotId?: string | null;
  knownMembers?: readonly KnownBindingMember[] | null;
  message?: string | null;
}): Promise<EnsureTaskResult> {
  const cfg = params.cfg ?? loadConfig();
  const run = () =>
    mutateCollaborationTaskObject({
      groupId: params.groupId,
      taskId: params.taskId,
      title: params.title,
      actor: params.actor,
      activationKey: params.activationKey,
      extraTags: params.extraTags,
      readyRequested: params.readyRequested,
      cfg,
      nowMs: params.nowMs,
      stores: params.stores,
      appointedOwnerId: params.appointedOwnerId,
      coordinatorBotId: params.coordinatorBotId,
      knownMembers: params.knownMembers,
      message: params.message,
    });
  try {
    if (params.alreadyLocked) {
      return await run();
    }
    return await withTaskControlLock({
      groupId: params.groupId,
      taskId: params.taskId,
      cfg,
      groupRootDir: params.stores.groupsRoot,
      fn: run,
    });
  } catch (error) {
    return {
      ok: false,
      reason: "task_control_write_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

type FindExistingResult =
  | { ok: true; item: GroupBoardClaimItem | null }
  | { ok: false; reason: string; detail?: string };

async function findExistingPublishedItem(params: {
  groupId: string;
  taskId: string;
  activationKey: string;
  title: string;
  cfg?: OpenBotConfig;
  tenant?: CollaborationTenantResolution | null;
  stores: TrustedGroupStores;
}): Promise<FindExistingResult> {
  const cfg = params.cfg ?? loadConfig();
  let items: GroupBoardClaimItem[];
  try {
    const { authority } = await buildTrustedBoardAuthority({
      groupId: params.groupId,
      taskId: params.taskId,
      cfg,
      stores: params.stores,
      tenant: params.tenant,
    });
    items = await listBoardClaimItems(authority, { taskId: params.taskId });
  } catch (error) {
    return {
      ok: false,
      reason: "board_list_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const active = items.filter(
    (item) =>
      item.status === "published" ||
      item.status === "claimed" ||
      item.status === "applied" ||
      item.status === "in_progress" ||
      item.status === "submitted_for_review",
  );
  // Confirm must bind the first-persisted activationKey even when no board item is
  // published yet (needs_confirm -> humanConfirmed). Skipping this check allowed
  // silent contract replace on confirm (P1 #164 final hardening).
  try {
    const stores = params.stores;
    const task = await stores.objectStorage.readObject<Task>(params.groupId, "task", params.taskId);
    const priorKey = taskActivationKey(task);
    if (priorKey && priorKey !== params.activationKey) {
      return {
        ok: false,
        reason: "activation_contract_conflict",
        detail: `existing activationKey=${priorKey} requested=${params.activationKey}`,
      };
    }
  } catch (error) {
    return {
      ok: false,
      reason: "task_fingerprint_read_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (active.length === 0) {
    return { ok: true, item: null };
  }
  const byKey = active.find((item) => boardItemActivationKey(item) === params.activationKey);
  if (byKey) {
    return { ok: true, item: byKey };
  }

  // Same taskId + title without key: treat as conflict when contract fingerprint differs.
  const title = compact(params.title);
  const sameTitle = active.find((item) => title && compact(item.title) === title);
  if (sameTitle) {
    const existingKey = boardItemActivationKey(sameTitle);
    if (existingKey && existingKey !== params.activationKey) {
      return {
        ok: false,
        reason: "activation_contract_conflict",
        detail: `existing activationKey=${existingKey} requested=${params.activationKey}`,
      };
    }
    // Legacy items without activationKey: allow idempotent replay only when title matches
    // and task tag (if any) matches.
    if (!existingKey) {
      return { ok: true, item: sameTitle };
    }
  }
  if (active.length > 0) {
    return {
      ok: false,
      reason: "activation_task_busy",
      detail: `task already has active board item ${active[0]?.itemId}`,
    };
  }
  return { ok: true, item: null };
}

/**
 * Activate a collaboration task. Oral chat alone never creates a board fact.
 */
export async function activateCollaborationTask(
  params: ActivateCollaborationTaskInput,
): Promise<ActivateCollaborationTaskResult> {
  const groupId = compact(params.groupId);
  const taskId = compact(params.taskId);
  const actor = compact(params.actor);
  const title = compact(params.title);
  const message = compact(params.message);
  const activationKey = buildActivationKey({
    groupId,
    taskId,
    title,
    goal: params.goal,
    acceptanceCriteria: params.acceptanceCriteria,
    constraints: params.constraints,
    message,
    suggestedClaimantIds: params.suggestedClaimantIds,
    suggestedRole: params.suggestedRole,
    dueAtMs: params.dueAtMs,
  });

  if (!groupId || !taskId || !actor || !title || !message) {
    return {
      status: "blocked",
      taskId: taskId || "(missing)",
      activationKey,
      reason: "missing_required_fields",
      detail: "groupId, taskId, title, message, actor are required",
      taskEnsured: false,
      boardPublished: false,
      dispatched: false,
    };
  }
  if (!isSafeTaskId(taskId)) {
    return {
      status: "blocked",
      taskId,
      activationKey,
      reason: "invalid_task_id",
      detail: "taskId must be a short filesystem-safe id",
      taskEnsured: false,
      boardPublished: false,
      dispatched: false,
    };
  }
  if (oralDispatchCreatesBoardFact()) {
    return {
      status: "blocked",
      taskId,
      activationKey,
      reason: "oral_dispatch_forbidden",
      detail: "oral chat must not become a board fact",
      taskEnsured: false,
      boardPublished: false,
      dispatched: false,
    };
  }

  const cfg = params.cfg ?? loadConfig();
  const humanConfirmed = params.humanConfirmed === true;

  const storesResolved = resolveActivationStores({
    groupId,
    cfg,
    auth: params.auth,
    trusted: params.trusted,
    tenant: params.tenant,
  });
  if (!storesResolved.ok) {
    return {
      status: "blocked",
      taskId,
      activationKey,
      reason: storesResolved.reason,
      detail: storesResolved.detail,
      taskEnsured: false,
      boardPublished: false,
      dispatched: false,
    };
  }
  const teamStores = storesResolved.stores;

  const profile = await teamStores.groupStorage.readProfile(groupId).catch(() => null);
  const roster = await teamStores.groupStorage.readMembers(groupId).catch(() => []);
  const knownMembers =
    params.knownMembers ??
    (roster ?? [])
      .map((member) => {
        const id = compact(member.agentId) || compact(member.userId) || compact(member.memberId);
        return {
          id,
          name: member.name ?? null,
          aliases: [
            compact(member.memberId),
            compact(member.agentId),
            compact(member.userId),
          ].filter(Boolean),
        };
      })
      .filter((member) => member.id);
  const coordinatorBotId =
    compact(params.coordinatorBotId) || compact(profile?.coordinatorBotId) || null;
  const appointedOwnerId =
    parseAppointedProjectOwner({
      message,
      appointedOwnerId: params.appointedOwnerId,
      knownMembers,
    })?.ownerId ??
    (compact(params.appointedOwnerId) || null);
  const bindingFields = {
    appointedOwnerId,
    coordinatorBotId,
    knownMembers,
    message,
  };

  const syncActivated = async (
    item: GroupBoardClaimItem,
    taskCreated: boolean,
    idempotentReplay: boolean,
  ) => {
    const stores = teamStores;
    // Sync OS auth/business projection BEFORE post-publish handoff / formalClaim
    // so dispatch recheck sees legitimate membership updates (not pre-sync OS).
    // Projection sync still runs OUTSIDE the task lock (auth lock separately) —
    // preserve existing auth↔task lock order; do not nest locks.
    try {
      // Explicit activate focus switch: new task B must beat a stale OS A.
      await syncGroupOperatingState({
        fileStore: stores.fileStore,
        groupStorage: stores.groupStorage,
        metadataStorage: stores.metadataStorage,
        memoryStorage: stores.memoryStorage,
        learningStorage: stores.learningStorage,
        objectStorage: stores.objectStorage,
        groupId,
        preferredTaskId: taskId,
      });
    } catch (error) {
      return {
        status: "partial_success" as const,
        taskId,
        activationKey,
        boardItemId: item.itemId,
        item,
        taskCreated,
        reason: "operating_state_sync_failed",
        detail: error instanceof Error ? error.message : String(error),
        taskEnsured: true as const,
        boardPublished: true as const,
        operatingStateSynced: false as const,
        // Board publish is not dispatcher acceptance. Keep false.
        // Skip formalClaim/handoff when OS sync failed — avoid wake on stale auth.
        dispatched: ACTIVATE_SUCCESS_DISPATCHED,
      };
    }
    // Publish ≠ claim. Schedule a controlled handoff wake for the single
    // intended claimant (or claim only when the present actor IS that intended).
    // Never auto-claim as the publisher; never pick intended[0] among many.
    const { authority } = await buildTrustedBoardAuthority({
      groupId,
      taskId,
      cfg,
      stores,
      tenant: params.tenant,
    });
    const formalClaim = await tryClaimAfterBoardPublish({
      groupId,
      taskId,
      item,
      actorId: actor,
      authority,
      auth: params.auth,
      trusted: params.trusted,
      stores,
      tenant: params.tenant,
      cfg,
      roundDispatcher: params.roundDispatcher,
    });
    const boardItem = formalClaim.item;
    const os = await readGroupOperatingState({ fileStore: stores.fileStore, groupId });
    return {
      status: "activated" as const,
      taskId,
      activationKey,
      boardItemId: boardItem.itemId,
      item: boardItem,
      taskCreated,
      idempotentReplay,
      currentTaskId: os?.activeContext?.currentTaskId ?? null,
      taskEnsured: true as const,
      boardPublished: true as const,
      operatingStateSynced: true as const,
      // 建板 ≠ 派工. dispatched stays false until consumeWake's dispatcher accepts.
      dispatched: ACTIVATE_SUCCESS_DISPATCHED,
      formalClaim,
    };
  };

  const runMaterialize = async () => {
    const { authority } = await buildTrustedBoardAuthority({
      groupId,
      taskId,
      cfg,
      stores: teamStores,
      tenant: params.tenant,
    });
    const publishedBy = actor;
    // humanConfirmed activate: board publish is pre-authorized; challenge window is
    // orthogonal and would otherwise block gray groups on allowlist. Todolist card
    // remains the execution human gate. Explicit skipChallengeWindow=false wins.
    const skipChallengeWindow =
      params.skipChallengeWindow === false
        ? false
        : params.skipChallengeWindow === true || humanConfirmed;
    // Include title so short activate messages (e.g. F4 连通性说明 + charter path)
    // still pass board-candidate detection.
    const intentMessage =
      title && !message.includes(title)
        ? `${title}
${message}`
        : message;
    const input: BoardIntentMaterializeInput = {
      message: intentMessage,
      groupId,
      taskId,
      publishedBy,
      title,
      goal: params.goal,
      suggestedClaimantIds: params.suggestedClaimantIds
        ? [...params.suggestedClaimantIds]
        : undefined,
      suggestedRole: params.suggestedRole,
      constraints: params.constraints ? [...params.constraints] : undefined,
      acceptanceCriteria: params.acceptanceCriteria ? [...params.acceptanceCriteria] : undefined,
      dueAtMs: params.dueAtMs,
      requireHumanConfirm: params.requireHumanConfirm ?? true,
      humanConfirmed,
      skipChallengeWindow,
    };
    return materializeIntentToBoardItem({ authority, input, cfg });
  };

  const mapMaterializeFailure = (
    materialized: MaterializeIntentResult,
    taskEnsured: boolean,
  ): ActivateCollaborationTaskResult | null => {
    if (materialized.status === "needs_confirm") {
      return {
        status: "needs_confirm",
        taskId,
        activationKey,
        reason: humanConfirmed
          ? "contract_incomplete_after_confirm"
          : "awaiting_human_confirm_or_contract_fields",
        qualityIssues: materialized.qualityIssues,
        draftTitle: materialized.draft.title,
        taskEnsured,
        boardPublished: false,
        dispatched: false,
      };
    }
    if (materialized.status === "needs_challenge") {
      return {
        status: "blocked",
        taskId,
        activationKey,
        reason: "needs_challenge",
        detail: materialized.reason,
        taskEnsured,
        boardPublished: false,
        dispatched: false,
      };
    }
    if (materialized.status === "flag_off") {
      return {
        status: "blocked",
        taskId,
        activationKey,
        reason: "claim_contract_flag_off",
        detail: materialized.reason,
        taskEnsured,
        boardPublished: false,
        dispatched: false,
      };
    }
    if (materialized.status === "skipped") {
      if (!humanConfirmed) {
        return {
          status: "needs_confirm",
          taskId,
          activationKey,
          reason: "awaiting_human_confirm_or_contract_fields",
          draftTitle: title,
          taskEnsured,
          boardPublished: false,
          dispatched: false,
        };
      }
      return {
        status: "blocked",
        taskId,
        activationKey,
        reason: "not_a_board_candidate_or_publish_skipped",
        detail: materialized.reason,
        taskEnsured,
        boardPublished: false,
        dispatched: false,
      };
    }
    return null;
  };

  // Draft / unconfirmed: ensure draft only (never ready before quality+publish).
  if (!humanConfirmed) {
    const ensured = await ensureCollaborationTaskObject({
      groupId,
      taskId,
      title,
      actor,
      activationKey,
      extraTags: params.extraTags,
      readyRequested: false,
      cfg,
      stores: teamStores,
      nowMs: params.nowMs,
      ...bindingFields,
    });
    if (!ensured.ok) {
      return {
        status: "blocked",
        taskId,
        activationKey,
        reason: ensured.reason,
        detail: ensured.detail,
        taskEnsured: false,
        boardPublished: false,
        dispatched: false,
      };
    }
    let materialized: MaterializeIntentResult;
    try {
      materialized = await runMaterialize();
    } catch (error) {
      if (error instanceof ClaimContractEntryError) {
        return {
          status: "blocked",
          taskId,
          activationKey,
          reason: error.code || "materialize_failed",
          detail: error.message,
          taskEnsured: true,
          boardPublished: false,
          dispatched: false,
        };
      }
      return {
        status: "blocked",
        taskId,
        activationKey,
        reason: "materialize_failed",
        detail: error instanceof Error ? error.message : String(error),
        taskEnsured: true,
        boardPublished: false,
        dispatched: false,
      };
    }
    const mapped = mapMaterializeFailure(materialized, true);
    if (mapped) {
      return mapped;
    }
    // Unexpected publish without humanConfirmed — treat as blocked.
    return {
      status: "blocked",
      taskId,
      activationKey,
      reason: "publish_without_human_confirm",
      taskEnsured: true,
      boardPublished: false,
      dispatched: false,
    };
  }

  // Confirmed publish: lookup + ensure(draft) + materialize + promote ready under ONE task lock.
  // Projection sync (takes group auth lock) MUST run outside the task lock — preserve auth→task order.
  type LockedPublish =
    | ActivateCollaborationTaskResult
    | {
        status: "ready_to_sync";
        item: GroupBoardClaimItem;
        taskCreated: boolean;
        idempotentReplay: boolean;
      };

  let locked: LockedPublish;
  try {
    locked = await withTaskControlLock({
      groupId,
      taskId,
      cfg,
      groupRootDir: teamStores.groupsRoot,
      fn: async (): Promise<LockedPublish> => {
        const existingLookup = await findExistingPublishedItem({
          groupId,
          taskId,
          activationKey,
          title,
          cfg,
          stores: teamStores,
          tenant: params.tenant,
        });
        if (!existingLookup.ok) {
          return {
            status: "blocked",
            taskId,
            activationKey,
            reason: existingLookup.reason,
            detail: existingLookup.detail,
            taskEnsured: false,
            boardPublished: false,
            dispatched: false,
          };
        }
        if (existingLookup.item) {
          return {
            status: "ready_to_sync",
            item: existingLookup.item,
            taskCreated: false,
            idempotentReplay: true,
          };
        }

        // Quality not yet proven — keep draft until materialize publishes.
        const ensured = await ensureCollaborationTaskObject({
          groupId,
          taskId,
          title,
          actor,
          activationKey,
          extraTags: params.extraTags,
          readyRequested: false,
          cfg,
          stores: teamStores,
          nowMs: params.nowMs,
          alreadyLocked: true,
          ...bindingFields,
        });
        if (!ensured.ok) {
          return {
            status: "blocked",
            taskId,
            activationKey,
            reason: ensured.reason,
            detail: ensured.detail,
            taskEnsured: false,
            boardPublished: false,
            dispatched: false,
          };
        }
        const taskCreated = ensured.created;

        let materialized: MaterializeIntentResult;
        try {
          materialized = await runMaterialize();
        } catch (error) {
          if (error instanceof ClaimContractEntryError) {
            return {
              status: "blocked",
              taskId,
              activationKey,
              reason: error.code || "materialize_failed",
              detail: error.message,
              taskEnsured: true,
              boardPublished: false,
              dispatched: false,
            };
          }
          return {
            status: "blocked",
            taskId,
            activationKey,
            reason: "materialize_failed",
            detail: error instanceof Error ? error.message : String(error),
            taskEnsured: true,
            boardPublished: false,
            dispatched: false,
          };
        }

        const mapped = mapMaterializeFailure(materialized, true);
        if (mapped) {
          // Contract incomplete / blocked — task remains draft.
          return mapped;
        }
        if (materialized.status !== "published") {
          return {
            status: "blocked",
            taskId,
            activationKey,
            reason: "materialize_unexpected_status",
            detail: String((materialized as { status?: string }).status),
            taskEnsured: true,
            boardPublished: false,
            dispatched: false,
          };
        }
        const publishedItem = materialized.item;

        // Promote draft → ready only AFTER successful board publish.
        const promoted = await ensureCollaborationTaskObject({
          groupId,
          taskId,
          title,
          actor,
          activationKey,
          extraTags: params.extraTags,
          readyRequested: true,
          cfg,
          stores: teamStores,
          nowMs: params.nowMs,
          alreadyLocked: true,
          ...bindingFields,
        });
        if (!promoted.ok) {
          return {
            status: "partial_success",
            taskId,
            activationKey,
            boardItemId: publishedItem.itemId,
            item: publishedItem,
            taskCreated,
            reason: "task_ready_promote_failed",
            detail: promoted.detail ?? promoted.reason,
            taskEnsured: true,
            boardPublished: true,
            operatingStateSynced: false,
            dispatched: false,
          };
        }

        return {
          status: "ready_to_sync",
          item: publishedItem,
          taskCreated,
          idempotentReplay: false,
        };
      },
    });
  } catch (error) {
    return {
      status: "blocked",
      taskId,
      activationKey,
      reason: "activation_lock_failed",
      detail: error instanceof Error ? error.message : String(error),
      taskEnsured: false,
      boardPublished: false,
      dispatched: false,
    };
  }

  if (locked.status === "ready_to_sync") {
    return await syncActivated(locked.item, locked.taskCreated, locked.idempotentReplay);
  }
  return locked;
}
