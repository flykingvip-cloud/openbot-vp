/**
 * supervisor/engine.ts — supervision loop (M1 single-round + M2 bounded retry).
 *
 * Pure `judge` + injected ports + `superviseTick` (one advance per call).
 * M2: fixing → retry with redacted evidence; `nextStop` gates; escalator on stop.
 */

import { loadConfig, type OpenBotConfig } from "../../config/config.js";
import type {
  CredentialPolicy,
  ExecutionContext,
  PlacementFallback,
  WorkerLogEvent,
} from "../../fabric/worker/types.js";
import {
  prepareSupervisorRoundBudget,
  recordSupervisorRoundOnTip,
} from "../../task-outcome/supervisor-tip-budget.js";
import { ensureBudgetStarted } from "./budget.js";
import type { EscalatorPort } from "./escalator.js";
import { isSupervisorEnabled } from "./feature.js";
import type { NodeAgentRegistry } from "./node-agent-registry.js";
import type { NodeInvokePort } from "./node-invoke-port.js";
import type { ReporterPort } from "./reporter.js";
import { buildFixingPrompt, isWorkerExitRetryable, nextStop, stopReasonLabel } from "./retry.js";
import type {
  AcceptanceCriteria,
  SupervisedTask,
  SupervisedTaskState,
  SupervisionIteration,
  SupervisionExecutionContextSnapshot,
  ValidationReport,
} from "./types.js";
import { isTerminalTaskState } from "./types.js";
import type { ValidatorPort } from "./validator.js";
import { WorkerPlacementError } from "./worker-executor.js";
import type { WorkspacePort } from "./workspace.js";

export interface WorkerDispatchResult {
  summary: string;
  exitCode?: number;
  usage?: { input?: number; output?: number };
}

export class WorkerAuthError extends Error {
  constructor(message = "worker authentication failed") {
    super(message);
    this.name = "WorkerAuthError";
  }
}

export interface WorkerRunHandle {
  runId: string;
  workerId: string;
}

export interface WorkerPort {
  dispatch(input: {
    task: SupervisedTask;
    workerId: string;
    context: ExecutionContext;
    prompt: string;
    onProgress?: (event: WorkerLogEvent) => void;
    /** Fired after worker.start returns; engine persists activeRun checkpoint. */
    onStarted?: (handle: WorkerRunHandle) => void | Promise<void>;
    /** Polled during long worker runs; true ⇒ cooperative abort. */
    shouldAbort?: () => boolean | Promise<boolean>;
  }): Promise<WorkerDispatchResult>;
  /** Cancel the live in-process run for taskId (best-effort). */
  cancelActive?(taskId: string): Promise<void>;
  /** Resolve backend worker.retryableExitCodes for this task (if configured). */
  getRetryableExitCodes?(task: SupervisedTask): readonly number[] | undefined;
}

export type ExecutionContextResolution =
  | ExecutionContext
  | { fallback: PlacementFallback; reason: string };

export interface ExecutionContextPort {
  resolve(task: SupervisedTask): Promise<ExecutionContextResolution>;
}

export interface SupervisorPorts {
  executionContext: ExecutionContextPort;
  worker: WorkerPort;
  validator: ValidatorPort;
  workspace: WorkspacePort;
  escalator?: EscalatorPort;
  reporter?: ReporterPort;
  /** Live Node registry for create-time execution-chain gate (P0-1). */
  nodeAgentRegistry?: NodeAgentRegistry;
  nodeInvoke?: NodeInvokePort;
}

/** Allowed state transitions (Property 6). Terminal states have no outgoing edges. */
export const TASK_TRANSITIONS: Record<SupervisedTaskState, SupervisedTaskState[]> = {
  planned: [
    "dispatched",
    "aborted",
    "failed",
    "escalated",
    "max_iterations",
    "budget_exhausted",
    "timed_out",
  ],
  dispatched: ["executing", "aborted", "failed", "escalated"],
  executing: ["validating", "aborted", "failed", "escalated"],
  validating: ["accepted", "fixing", "aborted", "failed", "escalated"],
  fixing: [
    "executing",
    "aborted",
    "failed",
    "escalated",
    "max_iterations",
    "budget_exhausted",
    "timed_out",
  ],
  accepted: [],
  escalated: [],
  budget_exhausted: [],
  max_iterations: [],
  timed_out: [],
  aborted: [],
  failed: [],
};

export class IllegalTaskTransitionError extends Error {
  constructor(
    public readonly from: SupervisedTaskState,
    public readonly to: SupervisedTaskState,
  ) {
    super(`Illegal supervised-task transition ${from} → ${to}`);
    this.name = "IllegalTaskTransitionError";
  }
}

export function canTransitionTask(from: SupervisedTaskState, to: SupervisedTaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function assertTaskTransition(from: SupervisedTaskState, to: SupervisedTaskState): void {
  if (!canTransitionTask(from, to)) {
    throw new IllegalTaskTransitionError(from, to);
  }
}

/**
 * Pure acceptance judge (Property 1): all required steps must be ok.
 */
export function judge(report: ValidationReport, criteria: AcceptanceCriteria): boolean {
  const required = criteria.steps.filter((s) => s.required);
  if (required.length === 0) {
    return report.passed;
  }
  return required.every((step) => {
    const result = report.steps.find((s) => s.id === step.id);
    return result?.ok === true;
  });
}

function withState(task: SupervisedTask, state: SupervisedTaskState): SupervisedTask {
  assertTaskTransition(task.state, state);
  return { ...task, state };
}

function supervisorBudgetConfig(opts?: SuperviseTickOptions): OpenBotConfig {
  return opts?.config ?? loadConfig();
}

function buildInitialPrompt(task: SupervisedTask): string {
  return task.goal.trim();
}

function patchIteration(
  iterations: SupervisionIteration[],
  index: number,
  patch: Partial<SupervisionIteration>,
): SupervisionIteration[] {
  return iterations.map((it) => (it.index === index ? { ...it, ...patch } : it));
}

export interface SuperviseTickOptions {
  env?: NodeJS.ProcessEnv;
  readConfig?: () => boolean;
  nowMs?: number;
  /** cli-backend `worker.retryableExitCodes`; empty = all codes retryable. */
  retryableExitCodes?: readonly number[];
  /** Persist intermediate snapshots (executing/validating/activeRun). */
  persist?: (task: SupervisedTask) => Promise<void>;
  /** Cooperative abort: polled during worker dispatch. */
  isAborted?: () => boolean | Promise<boolean>;
  /**
   * Config used to open the shared TaskOutcome tip. Production omits this and
   * loads the runtime config. Tests pass an isolated agent dir.
   */
  config?: OpenBotConfig;
}

const DEFAULT_RETRYABLE_EXIT_CODES: readonly number[] = [1, 2];

const IN_FLIGHT_STATES: ReadonlySet<SupervisedTaskState> = new Set([
  "dispatched",
  "executing",
  "validating",
]);

export function isInFlightTaskState(state: SupervisedTaskState): boolean {
  return IN_FLIGHT_STATES.has(state);
}

async function persistCheckpoint(
  task: SupervisedTask,
  persist?: (t: SupervisedTask) => Promise<void>,
): Promise<void> {
  if (persist) {
    await persist(task);
  }
}

async function isAborted(opts?: SuperviseTickOptions): Promise<boolean> {
  if (!opts?.isAborted) {
    return false;
  }
  return Boolean(await opts.isAborted());
}

function isResolvedExecutionContext(value: ExecutionContextResolution): value is ExecutionContext {
  return "identity" in value && "placement" in value && "attribution" in value;
}

function redactedExecutionContextSnapshot(
  context: ExecutionContext,
): SupervisionExecutionContextSnapshot {
  const { identity, placement, attribution } = context;
  return {
    identity: {
      policy: identity.policy,
      status: identity.status,
      ...(identity.credentialId ? { credentialId: identity.credentialId } : {}),
    },
    placement: {
      placement: placement.placement,
      executor: placement.executor,
      ...(placement.nodeAgentId ? { nodeAgentId: placement.nodeAgentId } : {}),
      fallback: placement.fallback,
    },
    attribution: {
      ...(attribution.tenantId ? { tenantId: attribution.tenantId } : {}),
      ...(attribution.userId ? { userId: attribution.userId } : {}),
      ...(attribution.seatId ? { seatId: attribution.seatId } : {}),
      ...(attribution.credentialId ? { credentialId: attribution.credentialId } : {}),
      workerId: attribution.workerId,
      ...(attribution.model ? { model: attribution.model } : {}),
    },
  };
}

async function finishValidation(
  task: SupervisedTask,
  iterIndex: number,
  ports: SupervisorPorts,
  opts?: SuperviseTickOptions,
): Promise<SupervisedTask> {
  const report = await ports.validator.validate({ task, criteria: task.acceptance });
  const passed = judge(report, task.acceptance);
  const endedAt = new Date().toISOString();
  let next: SupervisedTask = {
    ...task,
    iterations: patchIteration(task.iterations, iterIndex, { validation: report, endedAt }),
  };
  await persistCheckpoint(next, opts?.persist);
  if (passed) {
    next = withState(next, "accepted");
    if (ports.reporter) {
      await ports.reporter.milestone(next, "Validation passed");
    }
  } else {
    next = withState(next, "fixing");
    if (ports.reporter) {
      await ports.reporter.milestone(next, "Validation failed, scheduling fixing round");
    }
  }
  return next;
}

async function resumeValidatingRound(
  task: SupervisedTask,
  ports: SupervisorPorts,
  opts?: SuperviseTickOptions,
): Promise<SupervisedTask> {
  const iterIndex = task.iterations.length - 1;
  if (iterIndex < 0) {
    return withState({ ...task, activeRun: undefined }, "planned");
  }
  const iter = task.iterations[iterIndex];
  if (iter?.validation) {
    return withState({ ...task, activeRun: undefined }, "planned");
  }
  if (await isAborted(opts)) {
    return withState({ ...task, activeRun: undefined }, "aborted");
  }
  return finishValidation(task, iterIndex, ports, opts);
}

async function finalizeStop(
  task: SupervisedTask,
  stopState: SupervisedTaskState,
  ports: SupervisorPorts,
  reason?: string,
): Promise<SupervisedTask> {
  const label = reason ?? stopReasonLabel(stopState);
  let next = withState(task, stopState);
  if (ports.escalator) {
    // Prefer the explicit, context-specific reason (credential missing, placement
    // fallback, worker auth, non-retryable exit) over the generic stop label so the
    // escalation/support case is actionable. Falls back to the generic stop label.
    const { ref } = await ports.escalator.escalate(next, label);
    next = { ...next, escalationRef: ref };
  }
  return next;
}

/**
 * Actionable escalation reason when a worker run has no usable credential.
 * Policy-aware so operators know whether an enterprise admin must configure a
 * shared key or the seat holder should add a personal key. `local_ide_login`
 * resolves to "configured" (not "missing"), so it never reaches here.
 */
function missingCredentialEscalationReason(policy: CredentialPolicy, workerId: string): string {
  if (policy === "enterprise_shared") {
    return `No usable credential for worker "${workerId}": an enterprise admin must configure a shared key for this worker, or add your personal seat key, then retry.`;
  }
  return `No usable credential for worker "${workerId}" (credential policy: ${policy}).`;
}

async function runOneRound(
  task: SupervisedTask,
  ports: SupervisorPorts,
  prompt: string,
  opts?: SuperviseTickOptions,
): Promise<SupervisedTask> {
  const nowMs = opts?.nowMs ?? Date.now();
  let next = ensureBudgetStarted(task, nowMs);

  if (!next.workspace?.root) {
    const workspace = await ports.workspace.ensure({
      taskId: next.taskId,
      agentId: next.agentId,
      repoRoot: next.repoRoot,
    });
    next = { ...next, workspace };
  }

  if (next.state === "planned") {
    next = withState(next, "dispatched");
    await persistCheckpoint(next, opts?.persist);
    if (ports.reporter) {
      await ports.reporter.taskStarted(next);
    }
  }
  if (await isAborted(opts)) {
    return withState({ ...next, activeRun: undefined }, "aborted");
  }

  next = withState(next, "executing");
  const executionContext = await ports.executionContext.resolve(next);
  if (!isResolvedExecutionContext(executionContext)) {
    const reason =
      executionContext.reason || `Execution placement fallback: ${executionContext.fallback}`;
    return finalizeStop({ ...next, activeRun: undefined }, "escalated", ports, reason);
  }

  // Credential readiness gate: never dispatch (and never burn a commercial run
  // slot) when the resolved identity has no usable credential. local_ide_login
  // resolves to "configured" and proceeds; enterprise_shared with no configured
  // key resolves to "missing" and escalates here with actionable guidance.
  if (executionContext.identity.status === "missing") {
    return finalizeStop(
      { ...next, activeRun: undefined },
      "escalated",
      ports,
      missingCredentialEscalationReason(executionContext.identity.policy, next.worker.backendId),
    );
  }

  const iterIndex = next.iterations.length;
  const startedAt = new Date().toISOString();
  next = {
    ...next,
    continuityKey: next.continuityKey ?? next.taskId,
    iterations: [
      ...next.iterations,
      {
        index: iterIndex,
        executionContext: redactedExecutionContextSnapshot(executionContext),
        startedAt,
      },
    ],
  };
  await persistCheckpoint(next, opts?.persist);

  let workerResult: WorkerDispatchResult;
  try {
    workerResult = await ports.worker.dispatch({
      task: next,
      workerId: next.worker.backendId,
      context: executionContext,
      prompt,
      onProgress: async (event) => {
        if (ports.reporter?.progress) {
          await ports.reporter.progress(next, event).catch(() => undefined);
        }
      },
      onStarted: async (handle) => {
        next = {
          ...next,
          activeRun: handle,
          iterations: patchIteration(next.iterations, iterIndex, { runId: handle.runId }),
        };
        await persistCheckpoint(next, opts?.persist);
        if (ports.reporter) {
          await ports.reporter
            .milestone(next, `Dispatch started · runId ${handle.runId}`)
            .catch(() => undefined);
        }
      },
      shouldAbort: opts?.isAborted,
    });
  } catch (err) {
    if (err instanceof WorkerAuthError) {
      return finalizeStop(
        { ...next, activeRun: undefined },
        "escalated",
        ports,
        "Worker authentication failed",
      );
    }
    if (err instanceof WorkerPlacementError) {
      return finalizeStop(
        { ...next, activeRun: undefined },
        "escalated",
        ports,
        err.message || "Worker placement unavailable",
      );
    }
    throw err;
  }

  if (await isAborted(opts)) {
    return withState({ ...next, activeRun: undefined }, "aborted");
  }

  const retryable = opts?.retryableExitCodes ?? DEFAULT_RETRYABLE_EXIT_CODES;
  if (
    !isWorkerExitRetryable(workerResult.exitCode, retryable) &&
    workerResult.exitCode !== 0 &&
    workerResult.exitCode !== undefined
  ) {
    return finalizeStop(
      next,
      "escalated",
      ports,
      `Worker exited with non-retryable code ${workerResult.exitCode}`,
    );
  }

  next = recordSupervisorRoundOnTip(
    supervisorBudgetConfig(opts),
    next,
    iterIndex,
    workerResult.usage,
  );
  next = withState({ ...next, activeRun: undefined }, "validating");
  next = {
    ...next,
    iterations: patchIteration(next.iterations, iterIndex, {
      workerSummary: workerResult.summary,
      exitCode: workerResult.exitCode,
      usage: workerResult.usage,
    }),
  };
  await persistCheckpoint(next, opts?.persist);

  if (await isAborted(opts)) {
    return withState(next, "aborted");
  }

  return finishValidation(next, iterIndex, ports, opts);
}

/**
 * Advance one supervised task by at most one full round. Returns an updated
 * snapshot (not persisted) — callers use `store.updateTask` or `driver.tick*`.
 */
export async function superviseTick(
  task: SupervisedTask,
  ports: SupervisorPorts,
  opts?: SuperviseTickOptions,
): Promise<SupervisedTask> {
  if (!isSupervisorEnabled(opts?.env, opts?.readConfig)) {
    return task;
  }
  if (isTerminalTaskState(task.state)) {
    return task;
  }

  const nowMs = opts?.nowMs ?? Date.now();
  if (task.state === "planned" || task.state === "fixing") {
    const prepared = prepareSupervisorRoundBudget(supervisorBudgetConfig(opts), task, nowMs);
    if (prepared.stop) {
      return finalizeStop(prepared.task, prepared.stop, ports, prepared.detail);
    }
    task = prepared.task;
  }
  if (isInFlightTaskState(task.state)) {
    if (task.state === "validating") {
      return resumeValidatingRound(task, ports, opts);
    }
    throw new Error(`superviseTick: task ${task.taskId} is in-flight (${task.state})`);
  }

  if (task.state === "fixing") {
    const stop = nextStop(task, nowMs);
    if (stop) {
      return finalizeStop(task, stop, ports);
    }
    const lastValidation = task.iterations.at(-1)?.validation;
    const prompt = lastValidation
      ? buildFixingPrompt(task, lastValidation)
      : buildInitialPrompt(task);
    return runOneRound(task, ports, prompt, opts);
  }

  if (task.state === "planned") {
    return runOneRound(task, ports, buildInitialPrompt(task), opts);
  }

  throw new Error(`superviseTick: unsupported state "${task.state}"`);
}
