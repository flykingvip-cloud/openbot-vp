import type { OpenBotConfig } from "../config/config.js";
import {
  DIAGNOSIS_SKILL_MARKER,
  DIAGNOSIS_SKILL_GOAL,
  DIAGNOSIS_SKILL_ACCEPTANCE,
} from "../cron/diagnosis-skill-contract.js";
import { parsePersonalTaskMetaFromDescription } from "../cron/personal-task-meta.js";
import { resolveCronStorePath } from "../cron/store.js";
import { resolveCronLedgerTaskId } from "../cron/wake-identity.js";
import { qualifyOrdinaryCronTexts } from "./cron-qualify.js";
import { LedgerWriteError } from "./errors.js";
import { shouldNotifyHumanGate, type HumanGateNotification } from "./human-gate.js";
import { projectProgress } from "./project.js";
import { acceptReplanProposal } from "./replan.js";
import { createFileLedgerStore, loadFoldedLedger, type ProgressLedgerStore } from "./store.js";
import type {
  BlockingReason,
  EventActor,
  ExecutionEvent,
  ExecutionLedger,
  ProgressEvidence,
  ReplanProposal,
} from "./types.js";
import { appendLedgerEvent, assertNotLegacyProgressSource, newLedgerEventId } from "./writer.js";

export type LongHorizonCronPayload = {
  kind?: string;
  message?: string;
  text?: string;
  command?: string;
};

export type LongHorizonCronJob = {
  id: string;
  name?: string;
  description?: string;
  conversationTaskId?: string;
  /** agentTurn message, systemEvent text, or legacy command payload. */
  payload?: LongHorizonCronPayload;
  /** Legacy top-level command from before payload migration. */
  command?: string;
  /**
   * User-written command body for this tick (isolated `message`).
   * Not a persisted job column; the runner attaches it before qualify.
   */
  commandBody?: string;
};

export type LongHorizonCronMeta = {
  goal: string;
  acceptanceRules: string[];
};

function collectCronUserTexts(job: LongHorizonCronJob): string[] {
  const texts: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || texts.includes(trimmed)) {
      return;
    }
    texts.push(trimmed);
  };
  push(job.payload?.message);
  push(job.payload?.text);
  push(job.payload?.command);
  push(job.command);
  push(job.commandBody);
  return texts;
}

/**
 * Personal-task meta (goal + acceptanceRules) still qualifies on its own.
 * Otherwise the payload message / command body must yield a non-empty goal
 * and at least one concrete acceptance outcome. Vague reminders do not.
 */
export function parseLongHorizonCronMeta(job: LongHorizonCronJob): LongHorizonCronMeta | null {
  const parsed = parsePersonalTaskMetaFromDescription(job.description);
  if (parsed.acceptanceRules.length > 0) {
    const goal = parsed.goal.trim() || (typeof job.name === "string" ? job.name.trim() : "");
    if (goal) {
      return { goal, acceptanceRules: parsed.acceptanceRules };
    }
  }
  // Legacy confirmed prescriptions predate explicit goal/acceptance metadata.
  if (
    job.name?.startsWith("diagnosis-evolution:") &&
    parsed.visibleDescription === DIAGNOSIS_SKILL_MARKER &&
    collectCronUserTexts(job).some((text) =>
      text.startsWith("用空闲时间练习已安装但本窗未观察到使用的技能。"),
    )
  ) {
    return { goal: DIAGNOSIS_SKILL_GOAL, acceptanceRules: [...DIAGNOSIS_SKILL_ACCEPTANCE] };
  }
  return qualifyOrdinaryCronTexts(collectCronUserTexts(job), parsed.goal.trim());
}

export function isLongHorizonCronJob(job: LongHorizonCronJob): boolean {
  return parseLongHorizonCronMeta(job) !== null;
}

function acceptanceId(index: number): string {
  return `A${index + 1}`;
}

function stepId(index: number): string {
  return `E${index + 1}`;
}

export function buildCronSeedEvent(params: {
  job: LongHorizonCronJob;
  meta: LongHorizonCronMeta;
  atMs: number;
}): ExecutionEvent {
  return {
    id: newLedgerEventId(),
    atMs: params.atMs,
    type: "PLAN_SEEDED",
    taskId: resolveCronLedgerTaskId(params.job),
    planVersion: 1,
    actor: "runtime",
    payload: {
      goal: params.meta.goal,
      acceptance: params.meta.acceptanceRules.map((text, index) => ({
        id: acceptanceId(index),
        text,
        required: true,
        satisfiedByStepIds: [stepId(index)],
      })),
      steps: params.meta.acceptanceRules.map((text, index) => ({
        id: stepId(index),
        title: text,
        acceptanceIds: [acceptanceId(index)],
      })),
    },
  };
}

export async function ensureCronLedgerSeeded(params: {
  store: ProgressLedgerStore;
  job: LongHorizonCronJob;
  atMs?: number;
}): Promise<ExecutionLedger> {
  const existing = await loadFoldedLedger(params.store);
  if (existing) {
    return existing;
  }
  const meta = parseLongHorizonCronMeta(params.job);
  if (!meta) {
    throw new LedgerWriteError("cron job is not long-horizon (missing goal + acceptanceRules)");
  }
  return (
    await appendLedgerEvent(
      params.store,
      buildCronSeedEvent({
        job: params.job,
        meta,
        atMs: params.atMs ?? Date.now(),
      }),
    )
  ).ledger;
}

function isLiveStep(step: ExecutionLedger["steps"][number]): boolean {
  return !step.retired;
}

/** Prefer the live step; retry failed/blocked before opening the next pending step. */
export function currentWritableStep(ledger: ExecutionLedger) {
  return (
    ledger.steps.find((step) => isLiveStep(step) && step.status === "in_progress") ??
    ledger.steps.find(
      (step) => isLiveStep(step) && (step.status === "executed" || step.status === "verified"),
    ) ??
    ledger.steps.find((step) => isLiveStep(step) && step.status === "failed") ??
    ledger.steps.find((step) => isLiveStep(step) && step.status === "blocked") ??
    ledger.steps.find((step) => isLiveStep(step) && step.status === "pending")
  );
}

/**
 * User-prompt fragment for one ledger tick.
 * Only the current writable step is included; this is not a ledger event.
 */
export function buildCronCurrentStepPrompt(step: {
  id: string;
  title: string;
  acceptanceIds: readonly string[];
}): string {
  const acceptanceId = step.acceptanceIds.find((id) => id.trim().length > 0) ?? "";
  return [
    `step id: ${step.id}`,
    `title: ${step.title}`,
    `acceptance id: ${acceptanceId}`,
    "This tick does only this step.",
    "You must use a tool to complete this step.",
    "Plain text is not completion.",
    "Do not do later steps.",
  ].join("\n");
}

/** `cron:<jobId>:<sessionId>` is invented by the cron runner, not a delivery receipt. */
export function isSyntheticCronReceiptId(receiptId: string, jobId: string): boolean {
  const id = receiptId.trim();
  if (!id) {
    return true;
  }
  if (jobId && id.startsWith(`cron:${jobId}:`)) {
    return true;
  }
  return /^cron:[^:]+:[^:]+$/.test(id);
}

function associatedUnmetAcceptanceId(
  ledger: ExecutionLedger,
  step: ExecutionLedger["steps"][number],
): string | undefined {
  return step.acceptanceIds.find((id) => {
    const item = ledger.acceptance.find((row) => row.id === id);
    return item && item.status !== "met";
  });
}

async function ensureStepStarted(params: {
  store: ProgressLedgerStore;
  job: LongHorizonCronJob;
  ledger: ExecutionLedger;
  step: ExecutionLedger["steps"][number];
  atMs: number;
  toolName?: string;
}): Promise<ExecutionLedger> {
  if (
    params.step.status !== "pending" &&
    params.step.status !== "blocked" &&
    params.step.status !== "failed"
  ) {
    return params.ledger;
  }
  return (
    await appendLedgerEvent(params.store, {
      id: newLedgerEventId(),
      atMs: params.atMs,
      type: "STEP_STARTED",
      taskId: resolveCronLedgerTaskId(params.job),
      stepId: params.step.id,
      planVersion: params.ledger.currentPlanVersion,
      actor: "runtime",
      payload: params.toolName ? { toolName: params.toolName } : {},
    })
  ).ledger;
}

function cronTickEvidence(atMs: number, note: string): ProgressEvidence {
  return {
    type: "system_observation",
    atMs,
    source: "cron_tick",
    verification: "passed",
    note,
  };
}

export async function observeCronToolEvent(params: {
  store: ProgressLedgerStore;
  job: LongHorizonCronJob;
  phase: "start" | "result";
  toolName: string;
  isError?: boolean;
  atMs?: number;
  actor?: EventActor;
}): Promise<ExecutionLedger | null> {
  const atMs = params.atMs ?? Date.now();
  const ledger = await ensureCronLedgerSeeded({ store: params.store, job: params.job, atMs });
  const step = currentWritableStep(ledger);
  if (!step) {
    return ledger;
  }
  if (params.phase === "start") {
    return await ensureStepStarted({
      store: params.store,
      job: params.job,
      ledger,
      step,
      atMs,
      toolName: params.toolName,
    });
  }

  const evidence: ProgressEvidence = {
    type: "tool_result",
    atMs,
    source: params.toolName,
    verification: params.isError ? "failed" : "passed",
  };
  if (params.isError) {
    return (
      await appendLedgerEvent(params.store, {
        id: newLedgerEventId(),
        atMs,
        type: "TOOL_FAILED",
        taskId: resolveCronLedgerTaskId(params.job),
        stepId: step.id,
        planVersion: ledger.currentPlanVersion,
        actor: params.actor ?? "runtime",
        payload: {
          toolName: params.toolName,
          evidence,
          failure: { code: "tool_failed", message: `${params.toolName} failed` },
        },
      })
    ).ledger;
  }
  if (step.status === "pending" || step.status === "failed" || step.status === "blocked") {
    await ensureStepStarted({
      store: params.store,
      job: params.job,
      ledger,
      step,
      atMs,
      toolName: params.toolName,
    });
  }
  return (
    await appendLedgerEvent(params.store, {
      id: newLedgerEventId(),
      atMs: atMs + 1,
      type: "TOOL_SUCCEEDED",
      taskId: resolveCronLedgerTaskId(params.job),
      stepId: step.id,
      planVersion: ledger.currentPlanVersion,
      actor: params.actor ?? "runtime",
      payload: { toolName: params.toolName, evidence },
    })
  ).ledger;
}

export async function recordCanonicalValidation(params: {
  store: ProgressLedgerStore;
  taskId: string;
  stepId: string;
  acceptanceId?: string;
  evidence: ProgressEvidence;
  atMs?: number;
}): Promise<ExecutionLedger> {
  assertNotLegacyProgressSource({ kind: params.evidence.type, source: params.evidence.source });
  const ledger = await loadFoldedLedger(params.store);
  if (!ledger) {
    throw new LedgerWriteError("cannot validate an empty ledger");
  }
  const atMs = params.atMs ?? Date.now();
  await appendLedgerEvent(params.store, {
    id: newLedgerEventId(),
    atMs,
    type: "VALIDATION_PASSED",
    taskId: params.taskId,
    stepId: params.stepId,
    planVersion: ledger.currentPlanVersion,
    actor: "validator",
    payload: { evidence: params.evidence },
  });
  const completed = await appendLedgerEvent(params.store, {
    id: newLedgerEventId(),
    atMs: atMs + 1,
    type: "STEP_COMPLETED",
    taskId: params.taskId,
    stepId: params.stepId,
    planVersion: ledger.currentPlanVersion,
    actor: "runtime",
    payload: { evidence: params.evidence },
  });
  if (!params.acceptanceId) {
    return completed.ledger;
  }
  return (
    await appendLedgerEvent(params.store, {
      id: newLedgerEventId(),
      atMs: atMs + 2,
      type: "ACCEPTANCE_MET",
      taskId: params.taskId,
      acceptanceId: params.acceptanceId,
      planVersion: completed.ledger.currentPlanVersion,
      actor: "validator",
      payload: { evidence: params.evidence },
    })
  ).ledger;
}

export async function recordHumanGate(params: {
  store: ProgressLedgerStore;
  taskId: string;
  stepId: string;
  reason: BlockingReason;
  question: string;
  atMs?: number;
  quiet?: boolean;
  notify?: (payload: HumanGateNotification) => void | Promise<void>;
}): Promise<ExecutionLedger> {
  const ledger = await loadFoldedLedger(params.store);
  if (!ledger) {
    throw new LedgerWriteError("cannot raise a gate on an empty ledger");
  }
  const atMs = params.atMs ?? Date.now();
  const next = (
    await appendLedgerEvent(params.store, {
      id: newLedgerEventId(),
      atMs,
      type: "GATE_RAISED",
      taskId: params.taskId,
      stepId: params.stepId,
      planVersion: ledger.currentPlanVersion,
      actor: "runtime",
      payload: { reason: params.reason, question: params.question },
    })
  ).ledger;
  if (params.notify) {
    const view = projectProgress(
      next,
      {
        mode: params.quiet ? "quiet" : "ask",
        blockingGate: next.currentBlocking,
      },
      atMs,
    );
    if (shouldNotifyHumanGate(view) && view.blockingGate?.reason === "blocked_user") {
      try {
        await params.notify({
          taskId: params.taskId,
          question: params.question,
          reason: "blocked_user",
        });
      } catch {
        // Notification must never break ledger write.
      }
    }
  }
  return next;
}

export async function recordReplan(params: {
  store: ProgressLedgerStore;
  proposal: ReplanProposal;
  atMs?: number;
  triggeredBy?: "runtime" | "human" | "system";
}): Promise<ExecutionLedger> {
  return await acceptReplanProposal(params.store, params.proposal, {
    atMs: params.atMs,
    triggeredBy: params.triggeredBy,
  });
}

async function recordTickObservation(params: {
  store: ProgressLedgerStore;
  job: LongHorizonCronJob;
  ledger: ExecutionLedger;
  atMs: number;
  note: string;
}): Promise<ExecutionLedger> {
  const step = currentWritableStep(params.ledger);
  if (!step) {
    return (
      await appendLedgerEvent(params.store, {
        id: newLedgerEventId(),
        atMs: params.atMs,
        type: "MEANINGFUL_PROGRESS",
        taskId: resolveCronLedgerTaskId(params.job),
        planVersion: params.ledger.currentPlanVersion,
        actor: "runtime",
        payload: { evidence: cronTickEvidence(params.atMs, params.note) },
      })
    ).ledger;
  }
  return (
    await appendLedgerEvent(params.store, {
      id: newLedgerEventId(),
      atMs: params.atMs,
      type: "EVIDENCE_RECORDED",
      taskId: resolveCronLedgerTaskId(params.job),
      stepId: step.id,
      planVersion: params.ledger.currentPlanVersion,
      actor: "runtime",
      payload: { evidence: cronTickEvidence(params.atMs, params.note) },
    })
  ).ledger;
}

/** Open or retry the live step so a tool-less tick still continues the ledger. */
export async function observeCronRunTick(params: {
  store: ProgressLedgerStore;
  job: LongHorizonCronJob;
  atMs?: number;
}): Promise<ExecutionLedger> {
  const atMs = params.atMs ?? Date.now();
  let ledger = await ensureCronLedgerSeeded({ store: params.store, job: params.job, atMs });
  const step = currentWritableStep(ledger);
  if (step) {
    ledger = await ensureStepStarted({
      store: params.store,
      job: params.job,
      ledger,
      step,
      atMs,
    });
  }
  return await recordTickObservation({
    store: params.store,
    job: params.job,
    ledger,
    atMs: atMs + 1,
    note: "cron_run_started",
  });
}

export type CronRunFinishInput = {
  store: ProgressLedgerStore;
  job: LongHorizonCronJob;
  status: "ok" | "error";
  delivered?: boolean;
  /** Receipt id already present on the delivery result. Never `cron:<job>:<session>`. */
  receiptId?: string;
  /** Source from the delivery result, not a cron-runtime label. */
  receiptSource?: string;
  sawToolSuccess?: boolean;
  atMs?: number;
};

function latestToolResult(step: ExecutionLedger["steps"][number]): ProgressEvidence | undefined {
  return step.evidence.filter((item) => item.type === "tool_result").at(-1);
}

/**
 * Shared close predicate for cron finalize and chat reply close.
 * Passed tool_result, or external_receipt with a real receiptId.
 * system_observation, validation_result (including conversation_reply), and
 * assistant text are not closing evidence. Do not widen this.
 */
export function isCanonicalClosingEvidence(
  evidence: ProgressEvidence | null | undefined,
): evidence is ProgressEvidence {
  if (!evidence) {
    return false;
  }
  if (evidence.type === "tool_result") {
    return evidence.verification === "passed";
  }
  if (evidence.type === "external_receipt") {
    const receiptId = evidence.receiptId?.trim() ?? "";
    if (!receiptId || isSyntheticCronReceiptId(receiptId, "")) {
      return false;
    }
    return evidence.verification !== "failed";
  }
  return false;
}

/** Latest evidence already on the step that satisfies the shared close predicate. */
export function selectExistingClosingEvidence(step: {
  evidence: readonly ProgressEvidence[];
}): ProgressEvidence | undefined {
  for (let index = step.evidence.length - 1; index >= 0; index -= 1) {
    const item = step.evidence[index];
    if (isCanonicalClosingEvidence(item)) {
      return item;
    }
  }
  return undefined;
}

function stepReadyForValidation(step: ExecutionLedger["steps"][number]): boolean {
  return step.executed || step.status === "executed" || step.status === "verified";
}

function realDeliveryReceipt(
  params: CronRunFinishInput,
): { receiptId: string; source: string } | null {
  const receiptId = params.receiptId?.trim() ?? "";
  const source = params.receiptSource?.trim() ?? "";
  if (!receiptId || !source) {
    return null;
  }
  if (
    isSyntheticCronReceiptId(receiptId, params.job.id) ||
    isSyntheticCronReceiptId(source, params.job.id)
  ) {
    return null;
  }
  if (source === "cron_runtime" || source === "cron_tick" || source === "cron-tick-v1") {
    return null;
  }
  return { receiptId, source };
}

/** A real delivery receipt can satisfy I2 only after the step is executed. */
async function ensureStepExecutedForReceipt(params: {
  store: ProgressLedgerStore;
  job: LongHorizonCronJob;
  ledger: ExecutionLedger;
  step: ExecutionLedger["steps"][number];
  atMs: number;
  evidence: ProgressEvidence;
}): Promise<ExecutionLedger> {
  let ledger = params.ledger;
  let step = ledger.steps.find((item) => item.id === params.step.id) ?? params.step;
  if (stepReadyForValidation(step) || step.status === "completed") {
    return ledger;
  }
  if (step.status === "pending" || step.status === "failed" || step.status === "blocked") {
    ledger = await ensureStepStarted({
      store: params.store,
      job: params.job,
      ledger,
      step,
      atMs: params.atMs,
    });
    step = ledger.steps.find((item) => item.id === params.step.id) ?? step;
  }
  if (step.status !== "in_progress" && step.status !== "executed") {
    return ledger;
  }
  return (
    await appendLedgerEvent(params.store, {
      id: newLedgerEventId(),
      atMs: params.atMs,
      type: "STEP_EXECUTED",
      taskId: resolveCronLedgerTaskId(params.job),
      stepId: step.id,
      planVersion: ledger.currentPlanVersion,
      actor: "runtime",
      payload: { evidence: params.evidence },
    })
  ).ledger;
}

/**
 * Continue the ledger after an isolated cron turn.
 * Acceptance closes only from an existing passed tool_result on this tick,
 * or from a real delivery receipt. system_observation and run summaries do not.
 */
export async function finalizeCronRun(params: CronRunFinishInput): Promise<ExecutionLedger> {
  const atMs = params.atMs ?? Date.now();
  let ledger = await ensureCronLedgerSeeded({ store: params.store, job: params.job, atMs });
  ledger = await recordTickObservation({
    store: params.store,
    job: params.job,
    ledger,
    atMs,
    note: params.status === "ok" ? "cron_run_finished" : "cron_run_failed",
  });
  const step = currentWritableStep(ledger);
  if (!step || params.status !== "ok" || step.status === "completed") {
    return ledger;
  }
  const latestTool = latestToolResult(step);
  // system_observation (cron_run_started / cron_run_finished) is not closing evidence.
  // sawToolSuccess stays: an older passed tool_result must not close this tick.
  const closingTool =
    params.sawToolSuccess === true &&
    latestTool?.type === "tool_result" &&
    isCanonicalClosingEvidence(latestTool)
      ? latestTool
      : undefined;
  if (closingTool) {
    if (!stepReadyForValidation(step)) {
      return ledger;
    }
    return await recordCanonicalValidation({
      store: params.store,
      taskId: resolveCronLedgerTaskId(params.job),
      stepId: step.id,
      acceptanceId: associatedUnmetAcceptanceId(ledger, step),
      evidence: closingTool,
      atMs: atMs + 1,
    });
  }
  const receipt = realDeliveryReceipt(params);
  if (!receipt) {
    return ledger;
  }
  const evidence: ProgressEvidence = {
    type: "external_receipt",
    atMs: atMs + 1,
    source: receipt.source,
    receiptId: receipt.receiptId,
    verification: "passed",
  };
  if (!isCanonicalClosingEvidence(evidence)) {
    return ledger;
  }
  if (!stepReadyForValidation(step)) {
    ledger = await ensureStepExecutedForReceipt({
      store: params.store,
      job: params.job,
      ledger,
      step,
      atMs: atMs + 1,
      evidence,
    });
    const refreshed = ledger.steps.find((item) => item.id === step.id);
    if (!refreshed || !stepReadyForValidation(refreshed) || refreshed.status === "completed") {
      return ledger;
    }
  }
  return await recordCanonicalValidation({
    store: params.store,
    taskId: resolveCronLedgerTaskId(params.job),
    stepId: step.id,
    acceptanceId: associatedUnmetAcceptanceId(ledger, step),
    evidence,
    atMs: atMs + 2,
  });
}

export type CronLedgerSession = {
  store: ProgressLedgerStore;
  job: LongHorizonCronJob;
  ensureSeeded: () => Promise<ExecutionLedger>;
  observeAgentEvent: (evt: { stream: string; data: Record<string, unknown> }) => Promise<void>;
  observeRunStart: (atMs?: number) => Promise<void>;
  observeRunFinish: (
    input: Omit<CronRunFinishInput, "store" | "job" | "sawToolSuccess">,
  ) => Promise<void>;
};

/**
 * Bind a ledger session for a long-horizon cron job.
 * OPENBOT_PROGRESS_LEDGER_ENABLED and gateway.progressLedger.enabled stay off
 * for chat and other callers. They are not consulted here: a qualifying job
 * always gets a session. Qualification is the task text (personal meta, or a
 * payload message / command body with a goal and a concrete acceptance).
 * Non-long-horizon jobs, including vague reminders, still return null.
 * `env` and `readConfig` are retained so existing callers keep compiling.
 */
export function createCronLedgerSession(params: {
  job: LongHorizonCronJob;
  cfg?: OpenBotConfig;
  env?: NodeJS.ProcessEnv;
  store?: ProgressLedgerStore;
  readConfig?: () => boolean;
}): CronLedgerSession | null {
  if (!isLongHorizonCronJob(params.job)) {
    return null;
  }
  const store =
    params.store ??
    createFileLedgerStore({
      cronStorePath: resolveCronStorePath(params.cfg?.cron?.store),
      taskId: resolveCronLedgerTaskId(params.job),
    });
  let sawToolSuccess = false;
  let pendingToolObservations: Promise<void> = Promise.resolve();
  return {
    store,
    job: params.job,
    ensureSeeded: async () => await ensureCronLedgerSeeded({ store, job: params.job }),
    observeAgentEvent: (evt) => {
      pendingToolObservations = pendingToolObservations
        .catch(() => undefined)
        .then(async () => {
          if (evt.stream !== "tool") {
            return;
          }
          const phase =
            evt.data.phase === "start" || evt.data.phase === "result" ? evt.data.phase : null;
          const toolName = typeof evt.data.name === "string" ? evt.data.name.trim() : "";
          if (!phase || !toolName) {
            return;
          }
          try {
            await observeCronToolEvent({
              store,
              job: params.job,
              phase,
              toolName,
              isError: evt.data.isError === true,
            });
            if (phase === "result" && evt.data.isError !== true) {
              sawToolSuccess = true;
            }
          } catch {
            // Ledger must never break a cron run.
          }
        });
      return pendingToolObservations;
    },
    observeRunStart: async (atMs) => {
      try {
        await observeCronRunTick({
          store,
          job: params.job,
          ...(atMs !== undefined ? { atMs } : {}),
        });
      } catch {
        // Ledger must never break a cron run.
      }
    },
    observeRunFinish: async (input) => {
      try {
        await pendingToolObservations;
        await finalizeCronRun({
          store,
          job: params.job,
          status: input.status,
          ...(input.delivered !== undefined ? { delivered: input.delivered } : {}),
          ...(input.receiptId ? { receiptId: input.receiptId } : {}),
          ...(input.receiptSource ? { receiptSource: input.receiptSource } : {}),
          ...(input.atMs !== undefined ? { atMs: input.atMs } : {}),
          sawToolSuccess,
        });
      } catch {
        // Ledger must never break a cron run.
      }
    },
  };
}
