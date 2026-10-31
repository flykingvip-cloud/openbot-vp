/**
 * Controlled discuss→formal-task entry (phase 1).
 *
 * Authenticated inbound → classify → mint stable taskId → reuse
 * activateCollaborationTask / materialize / publish. No second task store.
 * humanConfirmed forced false (needs_confirm); meta tags commit inside activate lock. Flag-off keeps precise internal
 * codes and a unified user message. Recovery uses first-accepted contract +
 * activation fingerprint; same request with different goal/acceptance conflicts.
 */
import { createHash } from "node:crypto";
import type { Task } from "@openbot/collaboration-core";
import type { OpenBotConfig } from "../../config/types.js";
import {
  activateCollaborationTask,
  buildActivationKey,
  type ActivateCollaborationTaskInput,
  type ActivateCollaborationTaskResult,
} from "./activate-collaboration-task.js";
import {
  classifyDiscussToTaskIntent,
  type DiscussToTaskClassification,
} from "./discuss-to-task-classify.js";
import { DISCUSS_TO_TASK_OPERATION_SLOT, mintDiscussToTaskId } from "./discuss-to-task-id.js";
import {
  deriveFormalTaskUserStatus,
  FORMAL_TASK_FLAG_OFF_USER_MESSAGE,
  type FormalTaskUserStatusCode,
} from "./discuss-to-task-receipt.js";
import type { FormalTaskStageSnapshot } from "./discuss-to-task-receipt.js";
import {
  buildDiscussToTaskTags,
  readAuthoritativeDiscussToTaskStages,
  readDiscussToTaskMetaFromTags,
  stagesFromActivation,
} from "./discuss-to-task-stages.js";
import type { TeamResourceAuthOk } from "./team-resource-auth.js";
import { resolveTeamDeliverableStores } from "./team-resource-auth.js";
import type { CollaborationTenantResolution } from "./trusted-tenant.js";

export { FORMAL_TASK_FLAG_OFF_USER_MESSAGE };

export type ControlledDiscussToTaskInput = {
  /** Authenticated inbound message id — stable across retries; never model-filled. */
  sourceMessageId: string;
  groupId: string;
  /** Trusted tenant id (managed) or synthetic personal scope id. */
  tenantId: string;
  actor: string;
  /** Raw authenticated user message (or structured extraction already validated). */
  message: string;
  title?: string;
  goal?: string;
  acceptanceCriteria?: readonly string[];
  constraints?: readonly string[];
  /** Suggestions only — never treated as actual claimants. */
  suggestedClaimantIds?: readonly string[];
  suggestedRole?: string;
  dueAtMs?: number;
  /**
   * Phase-1: ignored. Client/model cannot set humanConfirmed or bypass
   * requireHumanConfirm; no preauth shortcut in this PR.
   * @deprecated Accepted for type compat only — always forced false/true.
   */
  humanConfirmed?: boolean;
  /** @deprecated Phase-1 always forces true. */
  requireHumanConfirm?: boolean;
  skipChallengeWindow?: boolean;
  roundId?: string;
  operationSlot?: string;
  tenant?: CollaborationTenantResolution | null;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  cfg?: OpenBotConfig;
  nowMs?: number;
  /** When true, skip classifier and treat as explicit (RPC with full fields). */
  forceExplicit?: boolean;
};

export type ControlledDiscussToTaskResult = {
  classification: DiscussToTaskClassification["kind"];
  classificationReason: string;
  attempted: boolean;
  taskId: string | null;
  activationKey: string | null;
  activation: ActivateCollaborationTaskResult | null;
  stages: FormalTaskStageSnapshot;
  statusCode: FormalTaskUserStatusCode;
  userMessage: string;
  /** Precise internal reason when blocked / conflict. */
  internalReason?: string;
  idempotentReplay?: boolean;
  contractConflict?: boolean;
};

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function contractFingerprint(params: {
  title: string;
  goal: string;
  message: string;
  acceptanceCriteria: readonly string[];
  constraints: readonly string[];
  suggestedClaimantIds: readonly string[];
}): string {
  const norm = (values: readonly string[]) =>
    [...values]
      .map((v) => compact(v))
      .filter(Boolean)
      .sort();
  const payload = {
    title: compact(params.title),
    goal: compact(params.goal),
    message: compact(params.message),
    acceptanceCriteria: norm(params.acceptanceCriteria),
    constraints: norm(params.constraints),
    suggestedClaimantIds: norm(params.suggestedClaimantIds),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}

async function readExistingTask(params: {
  groupId: string;
  taskId: string;
  cfg?: OpenBotConfig;
  auth?: TeamResourceAuthOk | null;
  trusted?: { groupsRoot: string; groupLocator: string } | null;
  tenant?: CollaborationTenantResolution | null;
}): Promise<Task | null> {
  if (!params.cfg && !params.auth && !params.trusted) {
    return null;
  }
  const cfg = params.cfg;
  if (!cfg) {
    return null;
  }
  const resolved = resolveTeamDeliverableStores({
    auth: params.auth,
    trusted: params.trusted,
    groupId: params.groupId,
    cfg,
    tenantId: params.auth?.tenantId ?? params.tenant?.tenantId ?? null,
  });
  if (!resolved.ok) {
    return null;
  }
  try {
    return await resolved.objectStorage.readObject<Task>(params.groupId, "task", params.taskId);
  } catch {
    return null;
  }
}

function finish(params: {
  classification: DiscussToTaskClassification;
  attempted: boolean;
  taskId: string | null;
  activationKey: string | null;
  activation: ActivateCollaborationTaskResult | null;
  stages: FormalTaskStageSnapshot;
  internalReason?: string;
  idempotentReplay?: boolean;
  contractConflict?: boolean;
}): ControlledDiscussToTaskResult {
  const status = deriveFormalTaskUserStatus({
    classification: params.classification.kind,
    attempted: params.attempted,
    blockedReason: params.internalReason,
    stages: params.stages,
    activationStatus: params.activation?.status,
  });
  return {
    classification: params.classification.kind,
    classificationReason: params.classification.reason,
    attempted: params.attempted,
    taskId: params.taskId,
    activationKey: params.activationKey,
    activation: params.activation,
    stages: params.stages,
    statusCode: status.code,
    userMessage: status.userMessage,
    ...(params.internalReason ? { internalReason: params.internalReason } : {}),
    ...(params.idempotentReplay ? { idempotentReplay: true } : {}),
    ...(params.contractConflict ? { contractConflict: true } : {}),
  };
}

/**
 * Server-controlled entry. Does not auto-set humanConfirmed.
 * Same sourceMessageId + different contract → conflict (no second task).
 */
export async function controlledDiscussToTask(
  input: ControlledDiscussToTaskInput,
): Promise<ControlledDiscussToTaskResult> {
  const sourceMessageId = compact(input.sourceMessageId);
  const groupId = compact(input.groupId);
  const tenantId = compact(input.tenantId);
  const actor = compact(input.actor);
  const message = compact(input.message);
  const operationSlot = compact(input.operationSlot) || DISCUSS_TO_TASK_OPERATION_SLOT;

  if (!sourceMessageId || !groupId || !tenantId || !actor || !message) {
    return finish({
      classification: { kind: "needs_clarification", reason: "ambiguous_delegation" },
      attempted: false,
      taskId: null,
      activationKey: null,
      activation: null,
      stages: stagesFromActivation({ taskEnsured: false, boardPublished: false }),
      internalReason: "missing_required_fields",
    });
  }

  const classified = classifyDiscussToTaskIntent(message);
  const classification: DiscussToTaskClassification = input.forceExplicit
    ? {
        kind: "explicit_delegation",
        reason: "explicit_team_task",
        titleHint:
          compact(input.title) ||
          (classified.kind === "explicit_delegation" ? classified.titleHint : message.slice(0, 80)),
        goalHint:
          compact(input.goal) ||
          (classified.kind === "explicit_delegation" ? classified.goalHint : message.slice(0, 240)),
        acceptanceHints:
          input.acceptanceCriteria && input.acceptanceCriteria.length > 0
            ? [...input.acceptanceCriteria]
            : classified.kind === "explicit_delegation"
              ? [...classified.acceptanceHints]
              : [],
      }
    : classified;

  if (classification.kind === "discussion") {
    return finish({
      classification,
      attempted: false,
      taskId: null,
      activationKey: null,
      activation: null,
      stages: stagesFromActivation({ taskEnsured: false, boardPublished: false }),
    });
  }
  if (classification.kind === "needs_clarification") {
    return finish({
      classification,
      attempted: false,
      taskId: null,
      activationKey: null,
      activation: null,
      stages: stagesFromActivation({ taskEnsured: false, boardPublished: false }),
      internalReason: classification.reason,
    });
  }

  const title =
    compact(input.title) ||
    (classification.kind === "explicit_delegation" ? classification.titleHint : "") ||
    message.slice(0, 80);
  const goal =
    compact(input.goal) ||
    (classification.kind === "explicit_delegation" ? classification.goalHint : "") ||
    message.slice(0, 240);
  const acceptanceCriteria =
    input.acceptanceCriteria && input.acceptanceCriteria.length > 0
      ? [...input.acceptanceCriteria]
      : classification.kind === "explicit_delegation"
        ? [...classification.acceptanceHints]
        : [];
  const constraints = input.constraints ? [...input.constraints] : [];
  const suggestedClaimantIds = input.suggestedClaimantIds ? [...input.suggestedClaimantIds] : [];

  if (acceptanceCriteria.length === 0) {
    return finish({
      classification: { kind: "needs_clarification", reason: "missing_acceptance" },
      attempted: false,
      taskId: null,
      activationKey: null,
      activation: null,
      stages: stagesFromActivation({ taskEnsured: false, boardPublished: false }),
      internalReason: "missing_acceptance",
    });
  }

  const taskId = mintDiscussToTaskId({
    tenantId,
    groupId,
    sourceMessageId,
    operationSlot,
  });
  const fp = contractFingerprint({
    title,
    goal,
    message,
    acceptanceCriteria,
    constraints,
    suggestedClaimantIds,
  });
  const activationKey = buildActivationKey({
    groupId,
    taskId,
    title,
    goal,
    message,
    acceptanceCriteria,
    constraints,
    suggestedClaimantIds,
    suggestedRole: input.suggestedRole,
    dueAtMs: input.dueAtMs,
  });

  // Recovery / conflict: read authoritative task first.
  const existing = await readExistingTask({
    groupId,
    taskId,
    cfg: input.cfg,
    auth: input.auth,
    trusted: input.trusted,
    tenant: input.tenant,
  });
  if (existing) {
    const meta = readDiscussToTaskMetaFromTags(existing.tags);
    if (meta && meta.contractFingerprint && meta.contractFingerprint !== fp) {
      const conflictStages = input.cfg
        ? await readAuthoritativeDiscussToTaskStages({
            groupId,
            taskId,
            cfg: input.cfg,
            auth: input.auth,
            trusted: input.trusted,
            tenant: input.tenant,
            activationHints: { taskEnsured: true },
          })
        : stagesFromActivation({
            taskEnsured: true,
            boardPublished: "unknown",
            responsibilityAccepted: "unknown",
            planProposed: "unknown",
            planConfirmed: "unknown",
          });
      return finish({
        classification,
        attempted: true,
        taskId,
        activationKey,
        activation: {
          status: "blocked",
          taskId,
          activationKey,
          reason: "discuss_to_task_contract_conflict",
          detail: `firstAccepted=${meta.contractFingerprint} requested=${fp}`,
          taskEnsured: true,
          boardPublished: conflictStages.boardPublished === true,
          dispatched: false,
        },
        stages: conflictStages,
        internalReason: "discuss_to_task_contract_conflict",
        contractConflict: true,
      });
    }
  }

  // Phase-1: never accept client/model humanConfirmed or requireHumanConfirm=false.
  const humanConfirmed = false;
  const requireHumanConfirm = true;
  const d2tExtraTags = buildDiscussToTaskTags({
    sourceMessageId,
    contractFingerprint: fp,
    operationSlot,
  });
  const activateInput: ActivateCollaborationTaskInput = {
    groupId,
    taskId,
    title,
    message,
    actor,
    goal,
    acceptanceCriteria,
    constraints,
    suggestedClaimantIds,
    suggestedRole: input.suggestedRole,
    dueAtMs: input.dueAtMs,
    humanConfirmed,
    requireHumanConfirm,
    skipChallengeWindow: input.skipChallengeWindow,
    tenant: input.tenant,
    auth: input.auth,
    trusted: input.trusted,
    cfg: input.cfg,
    nowMs: input.nowMs,
    // Source + contract fingerprint commit inside withTaskControlLock with first accept.
    extraTags: d2tExtraTags,
  };

  const activation = await activateCollaborationTask(activateInput);

  // If activate claimed taskEnsured/idempotent but meta tags missing → incomplete, not closed.
  let metaPersistFailed = false;
  if (activation.taskEnsured && input.cfg) {
    const after = await readExistingTask({
      groupId,
      taskId,
      cfg: input.cfg,
      auth: input.auth,
      trusted: input.trusted,
      tenant: input.tenant,
    });
    const meta = readDiscussToTaskMetaFromTags(after?.tags);
    if (!meta || meta.sourceMessageId !== sourceMessageId || meta.contractFingerprint !== fp) {
      metaPersistFailed = true;
    }
  }

  const stages = input.cfg
    ? await readAuthoritativeDiscussToTaskStages({
        groupId,
        taskId,
        cfg: input.cfg,
        auth: input.auth,
        trusted: input.trusted,
        tenant: input.tenant,
        activationHints: {
          taskEnsured: activation.taskEnsured,
          boardPublished: activation.boardPublished,
        },
      })
    : stagesFromActivation({
        taskEnsured: activation.taskEnsured,
        boardPublished: activation.boardPublished,
        responsibilityAccepted: "unknown",
        planProposed: "unknown",
        planConfirmed: "unknown",
      });

  const internalReason = metaPersistFailed
    ? "discuss_to_task_meta_persist_incomplete"
    : activation.status === "blocked"
      ? activation.reason
      : activation.status === "needs_confirm"
        ? activation.reason
        : undefined;

  // Meta incomplete: do not claim idempotent/recovery closed.
  const idempotentReplay =
    !metaPersistFailed && activation.status === "activated" ? activation.idempotentReplay : false;

  // Flag-off: keep precise code; user message unified via deriveFormalTaskUserStatus.
  return finish({
    classification,
    attempted: true,
    taskId,
    activationKey: activation.activationKey || activationKey,
    activation:
      metaPersistFailed && activation.status !== "blocked"
        ? {
            status: "partial_success" as const,
            taskId: activation.taskId,
            activationKey: activation.activationKey || activationKey,
            reason: "discuss_to_task_meta_persist_incomplete",
            detail: "source/contract tags missing after activate lock write",
            taskEnsured: activation.taskEnsured,
            boardPublished: activation.boardPublished,
            dispatched: false,
          }
        : activation,
    stages,
    internalReason,
    idempotentReplay,
    contractConflict:
      activation.status === "blocked" &&
      (activation.reason === "activation_contract_conflict" ||
        activation.reason === "discuss_to_task_contract_conflict"),
  });
}
