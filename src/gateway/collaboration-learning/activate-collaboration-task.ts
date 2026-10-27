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
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { GroupBoardClaimItem } from "../collaboration-dispatch/claim-contract.js";
import { oralDispatchCreatesBoardFact } from "../collaboration-dispatch/claim-contract.js";
import type { MaterializeIntentResult } from "../collaboration-dispatch/intent-board-materialize.js";
import { withTaskControlLock } from "../collaboration-dispatch/task-control-cas.js";
import {
  ClaimContractEntryError,
  listCollaborationBoardItems,
  materializeCollaborationIntentToBoard,
} from "./claim-contract-entry.js";
import {
  createWorkspaceCollaborationStores,
  readGroupOperatingState,
  syncGroupOperatingState,
} from "./shared.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

export type ActivateCollaborationTaskInput = {
  groupId: string;
  /** Stable task id chosen by caller (must be filesystem-safe). */
  taskId: string;
  title: string;
  message: string;
  actor: string;
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
  cfg?: OpenBotConfig;
  nowMs?: number;
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
    };

const TERMINAL_TASK_STATUSES = new Set(["completed", "cancelled"]);

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Stable activation key = full contract fingerprint for idempotent retries. */
export function buildActivationKey(params: {
  groupId: string;
  taskId: string;
  title: string;
  goal?: string;
  acceptanceCriteria?: readonly string[];
  constraints?: readonly string[];
  message?: string;
}): string {
  const material = [
    compact(params.groupId),
    compact(params.taskId),
    compact(params.title),
    compact(params.goal),
    compact(params.message),
    ...(params.acceptanceCriteria ?? []).map((line) => compact(line)).filter(Boolean),
    ...(params.constraints ?? []).map((line) => compact(line)).filter(Boolean),
  ].join("\n");
  return `act-${createHash("sha256").update(material).digest("hex").slice(0, 24)}`;
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

async function ensureCollaborationTaskObject(params: {
  groupId: string;
  taskId: string;
  title: string;
  actor: string;
  activationKey?: string;
  /** When true, new or draft tasks become ready; terminal still refused. */
  readyRequested: boolean;
  cfg?: OpenBotConfig;
  nowMs?: number;
}): Promise<EnsureTaskResult> {
  const cfg = params.cfg ?? loadConfig();
  const now = params.nowMs ?? Date.now();
  try {
    return await withTaskControlLock({
      groupId: params.groupId,
      taskId: params.taskId,
      cfg,
      fn: async () => {
        const stores = createWorkspaceCollaborationStores(cfg);
        const existing = await stores.objectStorage.readObject<Task>(
          params.groupId,
          "task",
          params.taskId,
        );
        if (existing) {
          if (TERMINAL_TASK_STATUSES.has(existing.status)) {
            return {
              ok: false as const,
              reason: "terminal_task_not_reopened",
              detail: `task status=${existing.status}`,
            };
          }
          const nextStatus =
            params.readyRequested && existing.status === "draft" ? "ready" : existing.status;
          const tags = mergeActivationTag(existing.tags, params.activationKey);
          const touched: Task = {
            ...existing,
            title: compact(params.title) || existing.title,
            status: nextStatus,
            tags,
            updatedBy: compact(params.actor) || existing.updatedBy,
            updatedAtMs: now,
          };
          await stores.objectStorage.writeObject(params.groupId, "task", params.taskId, touched);
          return { ok: true as const, task: touched, created: false };
        }
        const created: Task = {
          taskId: params.taskId,
          groupId: params.groupId,
          title: compact(params.title) || params.taskId,
          status: params.readyRequested ? "ready" : "draft",
          ownerMemberId: compact(params.actor) || undefined,
          assignedMemberIds: compact(params.actor) ? [compact(params.actor)] : [],
          tags: mergeActivationTag(undefined, params.activationKey),
          createdBy: compact(params.actor) || undefined,
          updatedBy: compact(params.actor) || undefined,
          createdAtMs: now,
          updatedAtMs: now,
        };
        await stores.objectStorage.writeObject(params.groupId, "task", params.taskId, created);
        return { ok: true as const, task: created, created: true };
      },
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
}): Promise<FindExistingResult> {
  const cfg = params.cfg ?? loadConfig();
  let items: GroupBoardClaimItem[];
  try {
    items = await listCollaborationBoardItems({
      groupId: params.groupId,
      taskId: params.taskId,
      cfg,
      tenant: params.tenant,
    });
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
  if (active.length === 0) {
    return { ok: true, item: null };
  }
  const byKey = active.find((item) => boardItemActivationKey(item) === params.activationKey);
  if (byKey) {
    return { ok: true, item: byKey };
  }
  // Consult task tag fingerprint — same title with different contract is a conflict.
  try {
    const stores = createWorkspaceCollaborationStores(cfg);
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

  // Idempotency / conflict check BEFORE mutating task (except we still need lock later).
  const existingLookup = await findExistingPublishedItem({
    groupId,
    taskId,
    activationKey,
    title,
    cfg,
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
  if (existingLookup.item && humanConfirmed) {
    const stores = createWorkspaceCollaborationStores(cfg);
    try {
      await syncGroupOperatingState({
        fileStore: stores.fileStore,
        groupStorage: stores.groupStorage,
        metadataStorage: stores.metadataStorage,
        memoryStorage: stores.memoryStorage,
        learningStorage: stores.learningStorage,
        objectStorage: stores.objectStorage,
        groupId,
      });
    } catch (error) {
      return {
        status: "partial_success",
        taskId,
        activationKey,
        boardItemId: existingLookup.item.itemId,
        item: existingLookup.item,
        taskCreated: false,
        reason: "operating_state_sync_failed",
        detail: error instanceof Error ? error.message : String(error),
        taskEnsured: true,
        boardPublished: true,
        operatingStateSynced: false,
        dispatched: false,
      };
    }
    const os = await readGroupOperatingState({ fileStore: stores.fileStore, groupId });
    return {
      status: "activated",
      taskId,
      activationKey,
      boardItemId: existingLookup.item.itemId,
      item: existingLookup.item,
      taskCreated: false,
      idempotentReplay: true,
      currentTaskId: os?.activeContext?.currentTaskId ?? null,
      taskEnsured: true,
      boardPublished: true,
      operatingStateSynced: true,
      dispatched: false,
    };
  }

  // Draft path: ensure draft task only after basic validation; never claim published.
  // Publish path: ensure ready under control lock before materialize.
  let taskCreated = false;
  const ensured = await ensureCollaborationTaskObject({
    groupId,
    taskId,
    title,
    actor,
    activationKey,
    readyRequested: humanConfirmed,
    cfg,
    nowMs: params.nowMs,
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
  taskCreated = ensured.created;

  let materialized: MaterializeIntentResult;
  try {
    materialized = await materializeCollaborationIntentToBoard({
      groupId,
      taskId,
      message,
      publishedBy: actor,
      actor,
      title,
      suggestedClaimantIds: params.suggestedClaimantIds
        ? [...params.suggestedClaimantIds]
        : undefined,
      suggestedRole: params.suggestedRole,
      constraints: params.constraints ? [...params.constraints] : undefined,
      acceptanceCriteria: params.acceptanceCriteria ? [...params.acceptanceCriteria] : undefined,
      dueAtMs: params.dueAtMs,
      requireHumanConfirm: params.requireHumanConfirm ?? true,
      humanConfirmed,
      tenant: params.tenant,
      cfg,
    });
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
      taskEnsured: true,
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
      taskEnsured: true,
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
      taskEnsured: true,
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
        taskEnsured: true,
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
      taskEnsured: true,
      boardPublished: false,
      dispatched: false,
    };
  }

  const stores = createWorkspaceCollaborationStores(cfg);
  try {
    await syncGroupOperatingState({
      fileStore: stores.fileStore,
      groupStorage: stores.groupStorage,
      metadataStorage: stores.metadataStorage,
      memoryStorage: stores.memoryStorage,
      learningStorage: stores.learningStorage,
      objectStorage: stores.objectStorage,
      groupId,
    });
  } catch (error) {
    return {
      status: "partial_success",
      taskId,
      activationKey,
      boardItemId: materialized.item.itemId,
      item: materialized.item,
      taskCreated,
      reason: "operating_state_sync_failed",
      detail: error instanceof Error ? error.message : String(error),
      taskEnsured: true,
      boardPublished: true,
      operatingStateSynced: false,
      dispatched: false,
    };
  }
  const os = await readGroupOperatingState({ fileStore: stores.fileStore, groupId });
  return {
    status: "activated",
    taskId,
    activationKey,
    boardItemId: materialized.item.itemId,
    item: materialized.item,
    taskCreated,
    idempotentReplay: false,
    currentTaskId: os?.activeContext?.currentTaskId ?? null,
    taskEnsured: true,
    boardPublished: true,
    operatingStateSynced: true,
    dispatched: false,
  };
}
