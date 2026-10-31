/**
 * Partial-success stage snapshot for controlled discuss→task recovery.
 * Stages are recorded separately — never collapse into a single "established".
 */
import type { Task } from "@openbot/collaboration-core";
import type { FormalTaskStageSnapshot } from "./discuss-to-task-receipt.js";

export const DISCUSS_TO_TASK_SOURCE_TAG = "d2tSourceMessageId:";
export const DISCUSS_TO_TASK_CONTRACT_TAG = "d2tContractFp:";
export const DISCUSS_TO_TASK_SLOT_TAG = "d2tOperationSlot:";

export type DiscussToTaskPersistedMeta = {
  sourceMessageId: string;
  contractFingerprint: string;
  operationSlot: string;
};

export function buildDiscussToTaskTags(meta: DiscussToTaskPersistedMeta): string[] {
  return [
    `${DISCUSS_TO_TASK_SOURCE_TAG}${meta.sourceMessageId}`,
    `${DISCUSS_TO_TASK_CONTRACT_TAG}${meta.contractFingerprint}`,
    `${DISCUSS_TO_TASK_SLOT_TAG}${meta.operationSlot}`,
  ];
}

export function readDiscussToTaskMetaFromTags(
  tags: readonly string[] | undefined,
): DiscussToTaskPersistedMeta | null {
  const list = tags ?? [];
  const source = list.find((t) => t.startsWith(DISCUSS_TO_TASK_SOURCE_TAG));
  const contract = list.find((t) => t.startsWith(DISCUSS_TO_TASK_CONTRACT_TAG));
  const slot = list.find((t) => t.startsWith(DISCUSS_TO_TASK_SLOT_TAG));
  if (!source || !contract || !slot) {
    return null;
  }
  return {
    sourceMessageId: source.slice(DISCUSS_TO_TASK_SOURCE_TAG.length),
    contractFingerprint: contract.slice(DISCUSS_TO_TASK_CONTRACT_TAG.length),
    operationSlot: slot.slice(DISCUSS_TO_TASK_SLOT_TAG.length),
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
      !t.startsWith(DISCUSS_TO_TASK_SLOT_TAG),
  );
  return [...filtered, ...buildDiscussToTaskTags(meta)];
}

export function stagesFromActivation(params: {
  taskEnsured: boolean;
  boardPublished: boolean;
  responsibilityAccepted?: boolean;
  planProposed?: boolean;
  planConfirmed?: boolean;
  divisionSuggestionOnly?: boolean;
  roundComplete?: boolean;
}): FormalTaskStageSnapshot {
  return {
    taskEstablished: params.taskEnsured,
    boardPublished: params.boardPublished,
    responsibilityAccepted: params.responsibilityAccepted === true,
    planProposed: params.planProposed === true,
    planConfirmed: params.planConfirmed === true,
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
