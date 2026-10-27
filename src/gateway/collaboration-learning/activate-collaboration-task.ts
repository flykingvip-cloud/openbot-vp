/**
 * TEAM-REAL F1.1 — Activate an independent collaboration Task + shared board item.
 *
 * Reuses materializeCollaborationIntentToBoard / publishBoardItem. Does not open a
 * second orchestrator, remount formal-root twins, or treat oral chat as a board fact.
 *
 * Contract:
 * - Incomplete fields → needs_confirm / blocked (never "已派工/已开工").
 * - Explicit humanConfirmed + complete contract → ensure Task object, publish board,
 *   sync operating-state so activeContext can select the new taskId.
 * - Same activationKey retry is idempotent (no duplicate Task / board item).
 * - Does not mutate or accept other tasks' artifacts.
 */
import { createHash } from "node:crypto";
import type { Task } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { GroupBoardClaimItem } from "../collaboration-dispatch/claim-contract.js";
import { oralDispatchCreatesBoardFact } from "../collaboration-dispatch/claim-contract.js";
import type { MaterializeIntentResult } from "../collaboration-dispatch/intent-board-materialize.js";
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
      dispatched: false;
    };

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Stable activation key for idempotent retries (not a semantic charter hash). */
export function buildActivationKey(params: {
  groupId: string;
  taskId: string;
  title: string;
  goal?: string;
  acceptanceCriteria?: readonly string[];
}): string {
  const material = [
    compact(params.groupId),
    compact(params.taskId),
    compact(params.title),
    compact(params.goal),
    ...(params.acceptanceCriteria ?? []).map((line) => compact(line)).filter(Boolean),
  ].join("\n");
  return `act-${createHash("sha256").update(material).digest("hex").slice(0, 24)}`;
}

function isSafeTaskId(taskId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(taskId);
}

async function ensureCollaborationTaskObject(params: {
  groupId: string;
  taskId: string;
  title: string;
  actor: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
}): Promise<{ task: Task; created: boolean }> {
  const stores = createWorkspaceCollaborationStores(params.cfg);
  const existing = await stores.objectStorage.readObject<Task>(
    params.groupId,
    "task",
    params.taskId,
  );
  const now = params.nowMs ?? Date.now();
  if (existing) {
    // Touch updatedAtMs so selectActiveTask prefers this task without rewriting
    // foreign fields (assignedMemberIds / owner / status transitions of others).
    const touched: Task = {
      ...existing,
      title: compact(params.title) || existing.title,
      status:
        existing.status === "completed" || existing.status === "cancelled"
          ? "ready"
          : existing.status === "draft"
            ? "ready"
            : existing.status,
      updatedBy: compact(params.actor) || existing.updatedBy,
      updatedAtMs: now,
    };
    await stores.objectStorage.writeObject(params.groupId, "task", params.taskId, touched);
    return { task: touched, created: false };
  }
  const created: Task = {
    taskId: params.taskId,
    groupId: params.groupId,
    title: compact(params.title) || params.taskId,
    status: "ready",
    ownerMemberId: compact(params.actor) || undefined,
    assignedMemberIds: compact(params.actor) ? [compact(params.actor)] : [],
    createdBy: compact(params.actor) || undefined,
    updatedBy: compact(params.actor) || undefined,
    createdAtMs: now,
    updatedAtMs: now,
  };
  await stores.objectStorage.writeObject(params.groupId, "task", params.taskId, created);
  return { task: created, created: true };
}

async function findExistingPublishedItem(params: {
  groupId: string;
  taskId: string;
  title: string;
  cfg?: OpenBotConfig;
  tenant?: CollaborationTenantResolution | null;
}): Promise<GroupBoardClaimItem | null> {
  const cfg = params.cfg ?? loadConfig();
  try {
    const items = await listCollaborationBoardItems({
      groupId: params.groupId,
      taskId: params.taskId,
      cfg,
      tenant: params.tenant,
    });
    const title = compact(params.title);
    const match = items.find(
      (item) =>
        item.status === "published" ||
        item.status === "claimed" ||
        item.status === "applied" ||
        item.status === "in_progress" ||
        item.status === "submitted",
    );
    if (!match) {
      return null;
    }
    if (title && compact(match.title) && compact(match.title) !== title) {
      // Same taskId reused for a different activation title → not an idempotent replay.
      return null;
    }
    return match;
  } catch {
    return null;
  }
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
  // Defense: oralDispatchCreatesBoardFact is permanently false — keep the assert visible.
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

  // Ensure Task object before publish so activeContext can select it and
  // publishCollaborationBoardItem-style entries do not see task_not_found.
  let taskCreated = false;
  try {
    const ensured = await ensureCollaborationTaskObject({
      groupId,
      taskId,
      title,
      actor,
      cfg,
      nowMs: params.nowMs,
    });
    taskCreated = ensured.created;
  } catch (error) {
    return {
      status: "blocked",
      taskId,
      activationKey,
      reason: "task_persist_failed",
      detail: error instanceof Error ? error.message : String(error),
      taskEnsured: false,
      boardPublished: false,
      dispatched: false,
    };
  }

  // Idempotent replay: existing published board for this task+title.
  const existing = await findExistingPublishedItem({
    groupId,
    taskId,
    title,
    cfg,
    tenant: params.tenant,
  });
  if (existing && humanConfirmed) {
    const stores = createWorkspaceCollaborationStores(cfg);
    await syncGroupOperatingState({
      fileStore: stores.fileStore,
      groupStorage: stores.groupStorage,
      metadataStorage: stores.metadataStorage,
      memoryStorage: stores.memoryStorage,
      learningStorage: stores.learningStorage,
      objectStorage: stores.objectStorage,
      groupId,
    });
    const os = await readGroupOperatingState({ fileStore: stores.fileStore, groupId });
    return {
      status: "activated",
      taskId,
      activationKey,
      boardItemId: existing.itemId,
      item: existing,
      taskCreated: false,
      idempotentReplay: true,
      currentTaskId: os?.activeContext?.currentTaskId ?? null,
      taskEnsured: true,
      boardPublished: true,
      dispatched: false,
    };
  }

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
    // Without humanConfirmed, treat skip-as-awaiting-confirm rather than false success.
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

  // published
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
      status: "blocked",
      taskId,
      activationKey,
      reason: "operating_state_sync_failed",
      detail: error instanceof Error ? error.message : String(error),
      taskEnsured: true,
      boardPublished: false,
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
    dispatched: false,
  };
}
