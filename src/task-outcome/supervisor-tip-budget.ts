/**
 * One budget ledger for supervisor rounds and TaskOutcome tips.
 *
 * Reuses assessRunnerTurnBudgetGate / chargeModelCallAgainstTip / tip spend.
 * SupervisedTask.budget.spentCostUsd is a projection of that tip, not a second accumulator.
 */
import path from "node:path";
import { resolveAgentDir } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import type { SupervisedTask, SupervisedTaskState } from "../gateway/supervisor/types.js";
import { buildTaskBudgetState } from "./budget.js";
import type { TaskBudgetExhaustion, TaskBudgetState } from "./budget.js";
import { scopeFromChatEntry } from "./chat-entry.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { TaskOutcomeResultService } from "./result-service.js";
import {
  assessRunnerTurnBudgetGate,
  chargeModelCallAgainstTip,
  TASK_OUTCOME_STORE_DIRNAME,
  TaskBudgetExceededError,
} from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

export function supervisorLedgerAgentId(task: SupervisedTask): string {
  return task.agentId?.trim() || "main";
}

/** Existing tip wins. Otherwise the supervised task gets one stable tip id. */
export function resolveSupervisorLedgerTaskId(cfg: OpenBotConfig, task: SupervisedTask): string {
  const agentId = supervisorLedgerAgentId(task);
  const store = new DurableTaskOutcomeStore(storeRoot(cfg, agentId));
  const direct = task.taskId.trim();
  if (direct && store.loadTask(direct)) {
    return direct;
  }
  return `supervisor:${agentId}:${direct}`;
}

function storeRoot(cfg: OpenBotConfig, agentId: string): string {
  return path.join(resolveAgentDir(cfg, agentId), TASK_OUTCOME_STORE_DIRNAME);
}

function scopeFor(task: SupervisedTask): TrustedScope {
  return scopeFromChatEntry({
    agentId: supervisorLedgerAgentId(task),
    runId: task.taskId,
    subjectRef: task.userId?.trim() || "subject:supervisor",
    tenantId: task.tenantId,
    authzScopeRef: "supervisor-entry",
  });
}

function limitsOf(task: SupervisedTask) {
  return {
    maxIterations: task.budget.maxIterations,
    maxCostUsd: task.budget.maxCostUsd,
    maxDurationMinutes: task.budget.maxDurationMinutes,
  };
}

export function projectSupervisorBudgetFromTip(
  task: SupervisedTask,
  tip: TaskBudgetState,
): SupervisedTask {
  const iterationCount = tip.iterationCount + (tip.childAttributedIterations ?? 0);
  const spentCostUsd = tip.spentCostUsd + (tip.childAttributedCostUsd ?? 0);
  return {
    ...task,
    budget: {
      maxIterations: tip.maxIterations,
      maxCostUsd: tip.maxCostUsd,
      maxDurationMinutes: tip.maxDurationMinutes,
      spentCostUsd,
      iterationCount,
      ...(tip.startedAtMs != null ? { startedAtMs: tip.startedAtMs } : {}),
    },
  };
}

export function supervisorStopForExhaustion(exhaustion: TaskBudgetExhaustion): SupervisedTaskState {
  if (exhaustion.dimension === "iterations") {
    return "max_iterations";
  }
  if (exhaustion.dimension === "cost") {
    return "budget_exhausted";
  }
  return "timed_out";
}

function ensureLedgerTip(cfg: OpenBotConfig, task: SupervisedTask, taskId: string): TrustedScope {
  const agentId = supervisorLedgerAgentId(task);
  const scope = scopeFor(task);
  const store = new DurableTaskOutcomeStore(storeRoot(cfg, agentId));
  const service = new TaskOutcomeResultService({ store, submittedBy: "supervisor-tip-budget" });
  const chat = new ChatTaskOutcomeAdapter(service);
  const existing = store.loadTask(taskId);
  if (!existing) {
    const opened = chat.createOrRestore({
      taskId,
      scope,
      taskContractVersion: "1.0.0",
      commandId: `supervisor-entry:${taskId}`,
      entrypoint: "supervisor",
    });
    if (!opened.ok) {
      throw new Error(`supervisor tip open failed: ${opened.code}`);
    }
  }
  return scope;
}

/**
 * Read the shared tip and refuse another round when it is already exhausted.
 * Does not charge. Does not invent a second spend counter.
 */
export function prepareSupervisorRoundBudget(
  cfg: OpenBotConfig,
  task: SupervisedTask,
  nowMs: number = Date.now(),
): { task: SupervisedTask; stop?: SupervisedTaskState; detail?: string } {
  const agentId = supervisorLedgerAgentId(task);
  const taskId = resolveSupervisorLedgerTaskId(cfg, task);
  const scope = ensureLedgerTip(cfg, task, taskId);
  let gate: ReturnType<typeof assessRunnerTurnBudgetGate>;
  try {
    gate = assessRunnerTurnBudgetGate(cfg, agentId, {
      taskId,
      scope,
      budgetLimits: limitsOf(task),
      ...(task.budget.startedAtMs != null ? { startedAtMs: task.budget.startedAtMs } : {}),
      nowMs,
    });
  } catch (err) {
    if (err instanceof TaskBudgetExceededError) {
      return {
        task,
        stop: supervisorStopForExhaustion(err.exhaustion),
        detail: err.message,
      };
    }
    throw err;
  }
  const budget = gate.record.budget ?? buildTaskBudgetState({ taskLimits: limitsOf(task) });
  const projected = projectSupervisorBudgetFromTip(task, budget);
  if (!gate.allowed) {
    return {
      task: projected,
      stop: supervisorStopForExhaustion(gate.exhaustion),
      detail: gate.exhaustion.detail,
    };
  }
  return { task: projected };
}

/** One completed supervisor round → one tip charge, then project that tip back. */
export function recordSupervisorRoundOnTip(
  cfg: OpenBotConfig,
  task: SupervisedTask,
  roundIndex: number,
  usage?: { input?: number; output?: number },
): SupervisedTask {
  const agentId = supervisorLedgerAgentId(task);
  const taskId = resolveSupervisorLedgerTaskId(cfg, task);
  const scope = ensureLedgerTip(cfg, task, taskId);
  const charged = chargeModelCallAgainstTip(cfg, agentId, {
    taskId,
    scope,
    runId: task.taskId,
    callSeq: roundIndex,
    usage,
    provider: task.worker.backendId,
    model: task.worker.model,
  });
  if (!charged.record.budget) {
    return task;
  }
  return projectSupervisorBudgetFromTip(task, charged.record.budget);
}
