import path from "node:path";
import { resolveAgentDir } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import { recordToolOutcomes } from "../gateway/agent-growth/operational-metrics-store.js";
import { GROWTH_EVOLUTION_CONSUMER_ID, OutcomeConsumerRuntime } from "./consumers.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { publishEvolutionFromTaskOutcome } from "./growth-bridge.js";
import { newFencingToken, TaskOutcomeResultService } from "./result-service.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { CloseReasonCode, TaskOutcomeRecord, TrustedScope } from "./types.js";

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
  /** When true, only records attempt/run and leaves awaiting_acceptance. */
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
  /** Optional acceptance/delivery close when the caller already has receipts. */
  acceptance?:
    | { status: "pending" | "passed" | "failed" }
    | { status: "not_required"; reason: string };
  delivery?:
    | { status: "pending" | "blocked" | "delivered" | "delivery_unknown" | "failed" }
    | { status: "not_required"; reason: string };
  deliveryId?: string;
  acceptanceEvidence?: import("./types.js").AcceptanceEvidence[];
  allowRetry?: boolean;
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

function drainGrowthEvolution(
  cfg: OpenBotConfig,
  agentId: string,
  store: DurableTaskOutcomeStore,
): { written: boolean; reason: string } {
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
  runtime.drain((taskId) => store.loadTask(taskId));
  return { written, reason };
}

/**
 * Production chat-runner hot path into unified TaskOutcome.
 * Evolution publish goes only through OutcomeConsumerRuntime drain (no direct bypass).
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
  } else if (input.acceptance) {
    res = chat.setAcceptance(taskId, res.record.outcomeVersion, fencingToken, input.acceptance, {
      allowRetry: input.allowRetry ?? true,
      evidence: input.acceptanceEvidence,
      scope,
      commandId: `accept:${taskId}:${input.runId}`,
    });
    if (!res.ok) {
      throw new Error(`task-outcome set_acceptance failed: ${res.code}`);
    }
    if (input.delivery && res.ok) {
      res = chat.setDelivery(
        taskId,
        res.record.outcomeVersion,
        fencingToken,
        input.delivery,
        input.deliveryId,
        { scope, commandId: `delivery:${taskId}:${input.runId}` },
      );
      if (!res.ok) {
        throw new Error(`task-outcome set_delivery failed: ${res.code}`);
      }
    }
  }
  // bare success with no acceptance/delivery: leave awaiting_acceptance

  const evolution = drainGrowthEvolution(cfg, agentId, store);
  return { record: res.record, evolution };
}
