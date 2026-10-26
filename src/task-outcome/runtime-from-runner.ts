import path from "node:path";
import { resolveAgentDir } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import { recordToolOutcomes } from "../gateway/agent-growth/operational-metrics-store.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { publishEvolutionFromTaskOutcome } from "./growth-bridge.js";
import { newFencingToken, TaskOutcomeResultService } from "./result-service.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TaskOutcomeRecord, TrustedScope } from "./types.js";

export const TASK_OUTCOME_STORE_DIRNAME = "task-outcomes";

export type RunnerTurnOutcomeInput = {
  success: boolean;
  runId: string;
  toolsTotal?: number;
  toolsSucceeded?: number;
  latencyMs?: number;
  tenantId?: string;
  /** Stable task id; defaults to `run:${runId}` for this turn. */
  taskId?: string;
  scope?: TrustedScope;
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

/**
 * Production chat-runner hot path into unified TaskOutcome.
 *
 * - Always persists attempt/run on durable TaskOutcome under the agent dir.
 * - Run failure → close as acceptance failed (stop) → growth-bridge may publish a negative.
 * - Run success → leave `awaiting_acceptance` (incomplete); does **not** invent task success
 *   or append an evolution success sample.
 * - Tool counters always update via `recordToolOutcomes`; task-level operational counters are
 *   deferred until a later acceptance/delivery close (P0 stops inventing success).
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
  const taskId = input.taskId?.trim() || `run:${input.runId}`;
  const scope = input.scope ?? defaultScope(input.tenantId);

  const opened = chat.createOrRestore({
    taskId,
    scope,
    taskContractVersion: "1.0.0",
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
  );
  if (!res.ok) {
    throw new Error(`task-outcome record_attempt failed: ${res.code}`);
  }

  if (!input.success) {
    // Close as capability failure — do not invent success.
    res = chat.setAcceptance(
      taskId,
      res.record.outcomeVersion,
      fencingToken,
      { status: "failed" },
      { allowRetry: false },
    );
    if (!res.ok) {
      throw new Error(`task-outcome set_acceptance failed: ${res.code}`);
    }
  }
  // success: leave acceptance pending → awaiting_acceptance → incomplete (no evolution success)

  const evolution = publishEvolutionFromTaskOutcome(cfg, agentId, res.record);
  return { record: res.record, evolution };
}
