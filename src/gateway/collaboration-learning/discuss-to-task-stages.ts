/**
 * Partial-success stage snapshot for controlled discuss→task recovery.
 * Stages are recorded separately — never collapse into a single "established".
 * Unverified fields use "unknown" — never false-as-not-yet.
 */
import type { Task } from "@openbot/collaboration-core";
import type { OpenBotConfig } from "../../config/types.js";
import type { GroupBoardClaimItem } from "../collaboration-dispatch/claim-contract.js";
import { listCollaborationTodolists } from "./claim-contract-entry.js";
import type { FormalTaskStageSnapshot, StageTriState } from "./discuss-to-task-receipt.js";
import type { TeamResourceAuthOk } from "./team-resource-auth.js";
import { resolveTeamDeliverableStores, type TrustedGroupStores } from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

export const DISCUSS_TO_TASK_SOURCE_TAG = "d2tSourceMessageId:";
export const DISCUSS_TO_TASK_CONTRACT_TAG = "d2tContractFp:";
export const DISCUSS_TO_TASK_SLOT_TAG = "d2tOperationSlot:";
export const DISCUSS_TO_TASK_OWNER_TAG = "d2tSourceOwner:";
export const DISCUSS_TO_TASK_KIND_TAG = "d2tSourceKind:";

export type DiscussToTaskSourceKindTag = "trusted_inbound" | "client_idempotency_key";

export type DiscussToTaskPersistedMeta = {
  sourceMessageId: string;
  contractFingerprint: string;
  operationSlot: string;
  /** Durable principal who owns this source — immutable once accepted. */
  sourceOwner: string;
  sourceKind: DiscussToTaskSourceKindTag;
};

export function buildDiscussToTaskTags(meta: DiscussToTaskPersistedMeta): string[] {
  return [
    `${DISCUSS_TO_TASK_SOURCE_TAG}${meta.sourceMessageId}`,
    `${DISCUSS_TO_TASK_CONTRACT_TAG}${meta.contractFingerprint}`,
    `${DISCUSS_TO_TASK_SLOT_TAG}${meta.operationSlot}`,
    `${DISCUSS_TO_TASK_OWNER_TAG}${meta.sourceOwner}`,
    `${DISCUSS_TO_TASK_KIND_TAG}${meta.sourceKind}`,
  ];
}

export function readDiscussToTaskMetaFromTags(
  tags: readonly string[] | undefined,
): DiscussToTaskPersistedMeta | null {
  const list = tags ?? [];
  const source = list.find((t) => t.startsWith(DISCUSS_TO_TASK_SOURCE_TAG));
  const contract = list.find((t) => t.startsWith(DISCUSS_TO_TASK_CONTRACT_TAG));
  const slot = list.find((t) => t.startsWith(DISCUSS_TO_TASK_SLOT_TAG));
  const owner = list.find((t) => t.startsWith(DISCUSS_TO_TASK_OWNER_TAG));
  const kind = list.find((t) => t.startsWith(DISCUSS_TO_TASK_KIND_TAG));
  // source/contract/slot required; owner/kind optional for R2 legacy rows.
  if (!source || !contract || !slot) {
    return null;
  }
  const sourceKindRaw = kind ? kind.slice(DISCUSS_TO_TASK_KIND_TAG.length) : "trusted_inbound";
  const sourceKind: DiscussToTaskSourceKindTag =
    sourceKindRaw === "client_idempotency_key" ? "client_idempotency_key" : "trusted_inbound";
  return {
    sourceMessageId: source.slice(DISCUSS_TO_TASK_SOURCE_TAG.length),
    contractFingerprint: contract.slice(DISCUSS_TO_TASK_CONTRACT_TAG.length),
    operationSlot: slot.slice(DISCUSS_TO_TASK_SLOT_TAG.length),
    sourceOwner: owner ? owner.slice(DISCUSS_TO_TASK_OWNER_TAG.length) : "",
    sourceKind,
  };
}

export function mergeDiscussToTaskTags(
  existing: readonly string[] | undefined,
  meta: DiscussToTaskPersistedMeta,
): string[] {
  const filtered = [...(existing ?? [])].filter(
    (t) =>
      !t.startsWith(DISCUSS_TO_TASK_SOURCE_TAG) &&
      !t.startsWith(DISCUSS_TO_TASK_CONTRACT_TAG) &&
      !t.startsWith(DISCUSS_TO_TASK_SLOT_TAG) &&
      !t.startsWith(DISCUSS_TO_TASK_OWNER_TAG) &&
      !t.startsWith(DISCUSS_TO_TASK_KIND_TAG),
  );
  return [...filtered, ...buildDiscussToTaskTags(meta)];
}

export function isDiscussToTaskMetaTag(tag: string): boolean {
  return (
    tag.startsWith(DISCUSS_TO_TASK_SOURCE_TAG) ||
    tag.startsWith(DISCUSS_TO_TASK_CONTRACT_TAG) ||
    tag.startsWith(DISCUSS_TO_TASK_SLOT_TAG) ||
    tag.startsWith(DISCUSS_TO_TASK_OWNER_TAG) ||
    tag.startsWith(DISCUSS_TO_TASK_KIND_TAG)
  );
}

export type DiscussToTaskLockAdjudication =
  | { action: "passthrough" }
  | { action: "create"; tags: string[] }
  | { action: "replay"; tags: string[] }
  | {
      action: "conflict";
      reason:
        | "discuss_to_task_source_owner_conflict"
        | "discuss_to_task_contract_conflict"
        | "discuss_to_task_source_kind_conflict";
      detail: string;
    };

/**
 * Lock-held source/claim adjudication. Existing ownership tags are never generically
 * replaced: create / replay / conflict only.
 */
export function adjudicateDiscussToTaskTagsUnderLock(params: {
  existingTags: readonly string[] | undefined;
  proposedExtraTags: readonly string[] | undefined;
}): DiscussToTaskLockAdjudication {
  const proposed = readDiscussToTaskMetaFromTags(params.proposedExtraTags);
  if (!proposed?.sourceMessageId || !proposed.contractFingerprint || !proposed.sourceOwner) {
    return { action: "passthrough" };
  }
  const existing = readDiscussToTaskMetaFromTags(params.existingTags);
  if (!existing?.sourceOwner) {
    return { action: "create", tags: buildDiscussToTaskTags(proposed) };
  }
  if (existing.sourceOwner !== proposed.sourceOwner) {
    return {
      action: "conflict",
      reason: "discuss_to_task_source_owner_conflict",
      detail: `firstOwner=${existing.sourceOwner} requested=${proposed.sourceOwner}`,
    };
  }
  if (existing.sourceKind && proposed.sourceKind && existing.sourceKind !== proposed.sourceKind) {
    return {
      action: "conflict",
      reason: "discuss_to_task_source_kind_conflict",
      detail: `firstKind=${existing.sourceKind} requested=${proposed.sourceKind}`,
    };
  }
  if (existing.contractFingerprint !== proposed.contractFingerprint) {
    return {
      action: "conflict",
      reason: "discuss_to_task_contract_conflict",
      detail: `firstAccepted=${existing.contractFingerprint} requested=${proposed.contractFingerprint}`,
    };
  }
  // Same owner + kind + claim fingerprint → replay; keep first-accepted tags.
  return { action: "replay", tags: buildDiscussToTaskTags(existing) };
}

export function stagesFromActivation(params: {
  taskEnsured: boolean | "unknown";
  boardPublished: boolean | "unknown";
  responsibilityAccepted?: boolean | "unknown";
  planProposed?: boolean | "unknown";
  planConfirmed?: boolean | "unknown";
  divisionSuggestionOnly?: boolean;
  roundComplete?: boolean;
}): FormalTaskStageSnapshot {
  return {
    taskEstablished: params.taskEnsured,
    boardPublished: params.boardPublished,
    responsibilityAccepted:
      params.responsibilityAccepted === undefined ? "unknown" : params.responsibilityAccepted,
    planProposed: params.planProposed === undefined ? "unknown" : params.planProposed,
    planConfirmed: params.planConfirmed === undefined ? "unknown" : params.planConfirmed,
    ...(params.divisionSuggestionOnly ? { divisionSuggestionOnly: true } : {}),
    ...(params.roundComplete ? { roundComplete: true } : {}),
  };
}

/** ROUND_COMPLETE must not flip task completion. */
export function applyRoundCompleteToStages(
  stages: FormalTaskStageSnapshot,
): FormalTaskStageSnapshot {
  return { ...stages, roundComplete: true };
}

export function taskHasDiscussToTaskMeta(task: Task | null | undefined): boolean {
  return Boolean(readDiscussToTaskMetaFromTags(task?.tags));
}

function responsibilityFromItems(items: readonly GroupBoardClaimItem[]): boolean {
  return items.some(
    (item) =>
      item.status === "claimed" ||
      item.status === "applied" ||
      item.status === "in_progress" ||
      item.status === "submitted_for_review",
  );
}

function boardPublishedFromItems(items: readonly GroupBoardClaimItem[]): boolean {
  return items.some(
    (item) =>
      item.status === "published" ||
      item.status === "claimed" ||
      item.status === "applied" ||
      item.status === "in_progress" ||
      item.status === "submitted_for_review",
  );
}

/**
 * Read authoritative stage projection from task/board/plan stores.
 * On read failure for a lane, that lane is "unknown" (not false).
 */
export async function readAuthoritativeDiscussToTaskStages(params: {
  groupId: string;
  taskId: string;
  cfg: OpenBotConfig;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  tenant?: CollaborationTenantResolution | null;
  /** Optional already-resolved stores. */
  stores?: TrustedGroupStores | null;
  /**
   * Authorized principal for plan visibility. Never use a synthetic system
   * viewer that would treat ACL-invisible plans as "not proposed".
   */
  viewerActor?: string | null;
  /** Seed from activation result when available. */
  activationHints?: {
    taskEnsured?: boolean;
    boardPublished?: boolean;
  };
}): Promise<FormalTaskStageSnapshot> {
  const resolved =
    params.stores ??
    (() => {
      const r = resolveTeamDeliverableStores({
        auth: params.auth,
        trusted: params.trusted,
        groupId: params.groupId,
        cfg: params.cfg,
        tenantId: params.auth?.tenantId ?? params.tenant?.tenantId ?? null,
      });
      return r.ok ? r : null;
    })();

  let taskEstablished: StageTriState = params.activationHints?.taskEnsured ?? "unknown";
  let boardPublished: StageTriState = params.activationHints?.boardPublished ?? "unknown";
  let responsibilityAccepted: StageTriState = "unknown";
  let planProposed: StageTriState = "unknown";
  let planConfirmed: StageTriState = "unknown";

  if (!resolved) {
    return stagesFromActivation({
      taskEnsured: taskEstablished,
      boardPublished,
      responsibilityAccepted,
      planProposed,
      planConfirmed,
    });
  }

  try {
    const task = await resolved.objectStorage.readObject<Task>(
      params.groupId,
      "task",
      params.taskId,
    );
    taskEstablished = Boolean(task);
  } catch {
    taskEstablished = "unknown";
  }

  // Use claim-contract-entry list helpers which share trusted stores.
  try {
    const { listCollaborationBoardItems } = await import("./claim-contract-entry.js");
    const items = await listCollaborationBoardItems({
      groupId: params.groupId,
      taskId: params.taskId,
      auth: params.auth,
      trusted: params.trusted,
      stores: resolved,
      tenant: params.tenant,
      cfg: params.cfg,
    });
    boardPublished = boardPublishedFromItems(items);
    responsibilityAccepted = responsibilityFromItems(items);
    const publishedIds = items
      .filter((item) => boardPublishedFromItems([item]))
      .map((item) => item.itemId);
    const viewer = (params.viewerActor ?? "").trim();
    if (!viewer) {
      // Without an authorized viewer we cannot distinguish ACL-invisible plans from absent.
      planProposed = "unknown";
      planConfirmed = "unknown";
    } else if (publishedIds.length === 0) {
      planProposed = false;
      planConfirmed = false;
    } else {
      let anyProposed = false;
      let anyConfirmed = false;
      let planReadFailed = false;
      let visibleReads = 0;
      // Full traversal — do not stop at three items.
      for (const boardItemId of publishedIds) {
        try {
          const lists = await listCollaborationTodolists({
            groupId: params.groupId,
            taskId: params.taskId,
            boardItemId,
            actor: viewer,
            viewerId: viewer,
            auth: params.auth,
            trusted: params.trusted,
            stores: resolved,
            tenant: params.tenant,
            cfg: params.cfg,
          });
          visibleReads += 1;
          if (lists.length > 0) {
            anyProposed = true;
          }
          if (lists.some((row) => row.status === "confirmed")) {
            anyConfirmed = true;
          }
        } catch {
          planReadFailed = true;
        }
      }
      if (planReadFailed || visibleReads < publishedIds.length) {
        // Partial / failed reads → unknown (never false-as-not-yet).
        planProposed = anyProposed ? true : "unknown";
        planConfirmed = anyConfirmed ? true : "unknown";
      } else if (anyProposed) {
        planProposed = true;
        planConfirmed = anyConfirmed;
      } else {
        // All items readable and empty for this viewer. Still may be private
        // plans invisible to this principal → unknown rather than false.
        planProposed = "unknown";
        planConfirmed = "unknown";
      }
    }
  } catch {
    // Keep activation hints if present; otherwise unknown.
    if (params.activationHints?.boardPublished === undefined) {
      boardPublished = "unknown";
    }
    responsibilityAccepted = "unknown";
    planProposed = "unknown";
    planConfirmed = "unknown";
  }

  return stagesFromActivation({
    taskEnsured: taskEstablished,
    boardPublished,
    responsibilityAccepted,
    planProposed,
    planConfirmed,
  });
}

export function formatStagesForUser(stages: FormalTaskStageSnapshot): string {
  const fmt = (v: StageTriState) => (v === "unknown" ? "未知" : v ? "是" : "否");
  return [
    `任务已建立=${fmt(stages.taskEstablished)}`,
    `工作项已发布=${fmt(stages.boardPublished)}`,
    `责任已接受=${fmt(stages.responsibilityAccepted)}`,
    `计划已提出=${fmt(stages.planProposed)}`,
    `计划已确认=${fmt(stages.planConfirmed)}`,
  ].join("；");
}
