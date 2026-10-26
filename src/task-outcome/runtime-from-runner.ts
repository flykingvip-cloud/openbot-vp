import path from "node:path";
import { resolveAgentDir } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import { recordToolOutcomes } from "../gateway/agent-growth/operational-metrics-store.js";
import {
  assessTargetModalityAcceptance,
  capabilityModalityFromClaim,
} from "./capability-modality.js";
import { GROWTH_EVOLUTION_CONSUMER_ID, OutcomeConsumerRuntime } from "./consumers.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { publishEvolutionFromTaskOutcome } from "./growth-bridge.js";
import { newFencingToken, TaskOutcomeResultService } from "./result-service.js";
import { DurableTaskOutcomeStore } from "./store.js";
import { scopeIdOf } from "./transitions.js";
import type { CloseReasonCode, TaskOutcomeRecord, TrustedScope } from "./types.js";
export { assessTargetModalityAcceptance } from "./capability-modality.js";

function scopeIdSafe(scope: TrustedScope): string {
  return scopeIdOf(scope);
}

export const TASK_OUTCOME_STORE_DIRNAME = "task-outcomes";

export type RunnerTurnFailureReason =
  | "run_failed"
  | "user_cancelled"
  | "provider_fault"
  | "user_filtered"
  | "timeout"
  | "authz_denied"
  | "prepare_failed"
  | "other";

export type RunnerTurnOutcomeInput = {
  /** When true, records attempt/run as succeeded; does NOT invent acceptance/delivery. */
  success: boolean;
  runId: string;
  toolsTotal?: number;
  toolsSucceeded?: number;
  latencyMs?: number;
  tenantId?: string;
  /** Required stable task id from entry; do not invent from runId when provided. */
  taskId?: string;
  scope?: TrustedScope;
  /** Structured failure — required when success=false. Defaults to run_failed. */
  failureReason?: RunnerTurnFailureReason;
  failureDetail?: string;
  /**
   * Explicit acceptance/delivery only. Missing → leave pending (incomplete).
   * `not_required` is allowed only when a resolved task contract supplies the reason.
   */
  acceptance?:
    | { status: "pending" | "passed" | "failed" }
    | { status: "not_required"; reason: string };
  delivery?:
    | { status: "pending" | "blocked" | "delivered" | "delivery_unknown" | "failed" }
    | { status: "not_required"; reason: string };
  deliveryId?: string;
  acceptanceEvidence?: import("./types.js").AcceptanceEvidence[];
  allowRetry?: boolean;
  /** Process placeholder / interim reply — never closes as success. */
  processPlaceholder?: boolean;
  /**
   * P1: capability-plan outcome claim from resolveExecutionRoutingFromCapabilityPlan.
   * Chat replies must never be recorded as image/music (or other forbidden) modality success.
   */
  capabilityOutcome?: {
    planFailureKind: string;
    allowedModality: string;
    forbiddenSuccessModalities: readonly string[];
    detail?: string;
    /** Structured: explanatory text may be returned. */
    textReturnedAllowed?: boolean;
    /** Structured: image/music (target modality) actually completed. */
    targetModalityCompleted?: boolean;
    status?: string;
    incompleteModalities?: readonly string[];
  };
};

export type GrowthOutcomeCommitOpts = {
  failureReason?: RunnerTurnFailureReason;
  failureDetail?: string;
  acceptance?: RunnerTurnOutcomeInput["acceptance"];
  delivery?: RunnerTurnOutcomeInput["delivery"];
  deliveryId?: string;
  acceptanceEvidence?: import("./types.js").AcceptanceEvidence[];
  allowRetry?: boolean;
  processPlaceholder?: boolean;
};

function resolveStoreRoot(cfg: OpenBotConfig, agentId: string): string {
  return path.join(resolveAgentDir(cfg, agentId), TASK_OUTCOME_STORE_DIRNAME);
}

function defaultScope(tenantId?: string): TrustedScope {
  const tid = tenantId?.trim();
  if (tid) {
    return {
      kind: "enterprise",
      enterpriseDomainId: `enterprise:${tid}`,
      tenantId: tid,
      subjectRef: "runner",
      authzScopeRef: "agent-runner",
    };
  }
  return {
    kind: "personal",
    personalDomainId: "personal:runner",
    subjectRef: "runner",
    authzScopeRef: "agent-runner",
  };
}


/** True when trusted run evidence may advance routing_ok/incomplete → completed. */
function canMarkCompletedFromTrustedRun(
  modality: NonNullable<TaskOutcomeRecord["capabilityModality"]>,
): boolean {
  if (modality.targetModalityCompleted) {
    return false;
  }
  const blocked = new Set(["executor_unwired", "no_executable_candidates", "unsupported"]);
  if (blocked.has(modality.executionStatus) || blocked.has(modality.planFailureKind)) {
    return false;
  }
  return true;
}

function drainGrowthEvolution(
  cfg: OpenBotConfig,
  agentId: string,
  store: DurableTaskOutcomeStore,
): { written: boolean; reason: string; processed: number; deferred: number } {
  let written = false;
  let reason = "no_closed_events";
  const runtime = new OutcomeConsumerRuntime(store, {
    consumerId: GROWTH_EVOLUTION_CONSUMER_ID,
    handlers: [
      {
        consumerId: "growth-evolution-bridge",
        onEvent: (_event, record) => {
          const pub = publishEvolutionFromTaskOutcome(cfg, agentId, record);
          if (pub.written) {
            written = true;
            reason = pub.reason;
          } else if (!written) {
            reason = pub.reason;
          }
        },
      },
    ],
  });
  const drained = runtime.drain((taskId) => store.loadTask(taskId));
  return {
    written,
    reason,
    processed: drained.processed,
    deferred: drained.deferred,
  };
}

/**
 * Drain pending TaskOutcome outbox → growth evolution for one agent.
 * Safe to call from boot or a runtime timer without a user turn.
 */
export function drainPendingGrowthEvolution(
  cfg: OpenBotConfig,
  agentId: string,
): { written: boolean; reason: string; processed: number; deferred: number } {
  const store = new DurableTaskOutcomeStore(resolveStoreRoot(cfg, agentId));
  return drainGrowthEvolution(cfg, agentId, store);
}

/**
 * Production chat-runner hot path into unified TaskOutcome.
 * Evolution publish goes only through OutcomeConsumerRuntime drain (no direct bypass).
 * P1: capabilityOutcome claims persist as capabilityModality; executor_unwired cannot
 * be upgraded to target-modality success; trusted success may mark modality completed.
 */
export async function recordRunnerTurnOutcome(
  cfg: OpenBotConfig,
  agentId: string,
  input: RunnerTurnOutcomeInput,
): Promise<{ record: TaskOutcomeRecord; evolution: { written: boolean; reason: string } }> {
  const toolsTotal = Math.max(0, Math.floor(input.toolsTotal ?? 0));
  const toolsSucceeded = Math.min(toolsTotal, Math.max(0, Math.floor(input.toolsSucceeded ?? 0)));
  if (toolsTotal > 0) {
    await recordToolOutcomes(cfg, agentId, { total: toolsTotal, succeeded: toolsSucceeded });
  }

  const store = new DurableTaskOutcomeStore(resolveStoreRoot(cfg, agentId));
  const service = new TaskOutcomeResultService({
    store,
    submittedBy: "agent-runner-execution",
  });
  const chat = new ChatTaskOutcomeAdapter(service);
  const taskId = input.taskId?.trim();
  if (!taskId) {
    throw new Error(
      "recordRunnerTurnOutcome requires taskId from chat entry (ensureChatTurnTaskOutcome); refusing runId invent",
    );
  }
  const scope = input.scope ?? defaultScope(input.tenantId);

  const opened = chat.createOrRestore({
    taskId,
    scope,
    taskContractVersion: "1.0.0",
    commandId: `create:${taskId}`,
  });
  if (!opened.ok) {
    throw new Error(`task-outcome open failed: ${"code" in opened ? opened.code : "unknown"}`);
  }

  const fencingToken = opened.fencingToken || newFencingToken();
  const attemptId = `att:${input.runId}`;
  const runStatus = input.success ? ("succeeded" as const) : ("failed" as const);
  const attemptStatus = input.success ? ("succeeded" as const) : ("failed" as const);

  let res = chat.recordAttempt(
    taskId,
    opened.record.outcomeVersion,
    fencingToken,
    {
      attemptId,
      runId: input.runId,
      status: attemptStatus,
      observedAt: new Date().toISOString(),
      ...(toolsTotal > 0
        ? {
            toolObservations: [
              {
                toolName: "turn_tools",
                ok: toolsSucceeded === toolsTotal,
                summary: `${toolsSucceeded}/${toolsTotal}`,
              },
            ],
          }
        : {}),
    },
    {
      runId: input.runId,
      attemptIds: [attemptId],
      effectiveAttemptId: attemptId,
      fencingToken,
      status: runStatus,
    },
    { scope, commandId: `attempt:${taskId}:${input.runId}` },
  );
  if (!res.ok) {
    throw new Error(`task-outcome record_attempt failed: ${res.code}`);
  }

  if (!input.success) {
    const reason = (input.failureReason ?? "run_failed") as CloseReasonCode;
    res = chat.failClosed(taskId, res.record.outcomeVersion, reason as RunnerTurnFailureReason, {
      fencingToken,
      reasonDetail: input.failureDetail,
      scope,
      commandId: `fail:${taskId}:${input.runId}`,
    });
    if (!res.ok) {
      throw new Error(`task-outcome fail_closed failed: ${res.code}`);
    }
  } else if (!input.processPlaceholder) {
    // R85b: never invent not_required. Only apply gates the caller explicitly resolved.
    if (input.acceptance) {
      const evidence =
        input.acceptanceEvidence ??
        (input.acceptance.status === "passed" || input.acceptance.status === "not_required"
          ? [
              {
                validatorId: "agent-runner-execution",
                validatorVersion: "1.0.0",
                scope: scopeIdSafe(scope),
                artifactDigestOrReceiptRef: input.deliveryId ?? `receipt:${taskId}:${input.runId}`,
                taskContractVersion: "1.0.0",
                executionVersion: String(res.record.outcomeVersion),
              },
            ]
          : undefined);
      res = chat.setAcceptance(taskId, res.record.outcomeVersion, fencingToken, input.acceptance, {
        allowRetry: input.allowRetry ?? true,
        evidence,
        scope,
        commandId: `accept:${taskId}:${input.runId}`,
      });
      if (!res.ok) {
        throw new Error(`task-outcome set_acceptance failed: ${res.code}`);
      }
    }
    if (input.delivery) {
      res = chat.setDelivery(
        taskId,
        res.record.outcomeVersion,
        fencingToken,
        input.delivery,
        input.deliveryId ?? `delivery:${input.runId}`,
        { scope, commandId: `delivery:${taskId}:${input.runId}` },
      );
      if (!res.ok) {
        throw new Error(`task-outcome set_delivery failed: ${res.code}`);
      }
    }
    // Missing acceptance and/or delivery → remain pending / incomplete (no evolution positive).
  }
  // processPlaceholder: attempt recorded; acceptance/delivery stay pending.

  // P1: persist structured capabilityModality (and reasonDetail mirror) so
  // acceptance can refuse upgrading executor_unwired into target-modality success.
  let record = res.record;
  const claim = input.capabilityOutcome;
  if (claim) {
    const modality = capabilityModalityFromClaim(claim);
    const detail = [
      `capability_plan_failure=${claim.planFailureKind}`,
      `allowed_modality=${claim.allowedModality}`,
      `forbidden_success_modalities=${(claim.forbiddenSuccessModalities ?? []).join(",")}`,
      claim.textReturnedAllowed !== undefined
        ? `text_returned_allowed=${claim.textReturnedAllowed}`
        : null,
      claim.targetModalityCompleted !== undefined
        ? `target_modality_completed=${claim.targetModalityCompleted}`
        : null,
      claim.status ? `capability_status=${claim.status}` : null,
      claim.detail,
    ]
      .filter(Boolean)
      .join("; ");
    const patched: TaskOutcomeRecord = {
      ...record,
      capabilityModality: modality,
      reasonDetail: [record.reasonDetail, detail].filter(Boolean).join(" | "),
      updatedAt: new Date().toISOString(),
    };
    store.saveTask(patched);
    record = patched;
    // Defense: structured assessor must refuse target-modality success for unwired.
    const assessed = assessTargetModalityAcceptance(record.capabilityModality);
    if (
      claim.status === "executor_unwired" ||
      claim.planFailureKind === "executor_unwired" ||
      claim.targetModalityCompleted === false
    ) {
      if (assessed.targetModalitySucceeded) {
        throw new Error("capability modality acceptance upgraded unexpectedly");
      }
    }

    // Production: after trusted run success, mark target modality completed from
    // run evidence so formal set_acceptance can pass. Blocked statuses refuse.
    if (
      input.success &&
      record.capabilityModality &&
      canMarkCompletedFromTrustedRun(record.capabilityModality)
    ) {
      const markRes = chat.markTargetModalityCompleted(
        taskId,
        record.outcomeVersion,
        fencingToken,
        {
          kind: "run_completed",
          digestOrRef: `run:${input.runId}`,
          detail: "trusted_runner_turn_success",
        },
        { scope, commandId: `mark-modality:${taskId}:${input.runId}` },
      );
      if (markRes.ok) {
        record = markRes.record;
      }
    }
  }

  const evolution = drainGrowthEvolution(cfg, agentId, store);
  return { record, evolution };
}

/**
 * Apply channel send result to a turn that was prepared with delivery pending.
 * Prepare must leave delivery=pending; only this (or equivalent) may set delivered.
 */
export async function confirmRunnerTurnDelivery(
  cfg: OpenBotConfig,
  agentId: string,
  input: {
    taskId: string;
    deliveryId: string;
    status: "delivered" | "failed" | "delivery_unknown";
    scope?: TrustedScope;
    failureDetail?: string;
  },
): Promise<{ record: TaskOutcomeRecord; evolution: { written: boolean; reason: string } }> {
  const taskId = input.taskId.trim();
  if (!taskId) {
    throw new Error("confirmRunnerTurnDelivery requires taskId");
  }
  const deliveryId = input.deliveryId.trim();
  if (!deliveryId) {
    throw new Error("confirmRunnerTurnDelivery requires deliveryId");
  }

  const store = new DurableTaskOutcomeStore(resolveStoreRoot(cfg, agentId));
  const service = new TaskOutcomeResultService({
    store,
    submittedBy: "agent-runner-delivery-confirm",
  });
  const chat = new ChatTaskOutcomeAdapter(service);

  // Brief retry: prepare commit may still be flushing when dispatch confirms.
  let record = store.loadTask(taskId);
  for (let i = 0; i < 20 && !record; i += 1) {
    await new Promise((r) => setTimeout(r, 25));
    record = store.loadTask(taskId);
  }
  if (!record) {
    throw new Error(`confirmRunnerTurnDelivery: task not found: ${taskId}`);
  }

  if (record.lifecycle === "closed") {
    return {
      record,
      evolution: { written: false, reason: "already_closed" },
    };
  }

  // Already recorded delivered/failed — idempotent (do not reopen).
  if (
    record.deliveryId === deliveryId &&
    (record.delivery.status === "delivered" || record.delivery.status === "failed")
  ) {
    return {
      record,
      evolution: { written: false, reason: "delivery_already_terminal" },
    };
  }
  // Same unknown status — idempotent; still allow later upgrade to delivered/failed.
  if (
    record.deliveryId === deliveryId &&
    record.delivery.status === "delivery_unknown" &&
    input.status === "delivery_unknown"
  ) {
    return {
      record,
      evolution: { written: false, reason: "delivery_already_unknown" },
    };
  }

  const scope = input.scope ?? record.scope;
  const fencingToken = record.fencingToken || newFencingToken();
  const deliveryGate =
    input.status === "delivered"
      ? ({ status: "delivered" } as const)
      : input.status === "failed"
        ? ({ status: "failed" } as const)
        : ({ status: "delivery_unknown" } as const);

  const res = chat.setDelivery(
    taskId,
    record.outcomeVersion,
    fencingToken,
    deliveryGate,
    deliveryId,
    {
      scope,
      commandId: `delivery-confirm:${taskId}:${deliveryId}:${input.status}`,
    },
  );
  if (!res.ok) {
    throw new Error(`confirmRunnerTurnDelivery set_delivery failed: ${res.code}`);
  }

  const evolution = drainGrowthEvolution(cfg, agentId, store);
  return { record: res.record, evolution };
}
