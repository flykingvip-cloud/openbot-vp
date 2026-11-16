/**
 * Bind an activated ConversationTask to a Progress Ledger PLAN_SEEDED row.
 *
 * Acceptance text is the goal itself — this slice does not invent business
 * acceptance language. Orchestration / live invoke stays off.
 */

import { resolveCronStorePath } from "../cron/store.js";
import {
  currentWritableStep,
  isCanonicalClosingEvidence,
  recordCanonicalValidation,
  selectExistingClosingEvidence,
} from "../progress-ledger/cron-binding.js";
import {
  isProgressLedgerEnabled,
  isProgressLedgerShutdown,
  isProgressLedgerTenantAdmitted,
  type ProgressLedgerConfigReader,
} from "../progress-ledger/feature.js";
import { projectProgress } from "../progress-ledger/project.js";
import { inferTurnContractFromLedger } from "../progress-ledger/read.js";
import {
  createFileLedgerStore,
  loadFoldedLedger,
  type ProgressLedgerStore,
} from "../progress-ledger/store.js";
import type {
  ExecutionEvent,
  ExecutionLedger,
  ExecutionStep,
  ProgressEvidence,
  ProgressView,
} from "../progress-ledger/types.js";
import {
  appendLedgerEvent,
  assertNotLegacyProgressSource,
  newLedgerEventId,
} from "../progress-ledger/writer.js";
import { normalizeGoal } from "./canonical.js";
import { readConversationTaskFlags } from "./feature.js";
import { resolveActivationTenantId } from "./gateway-activation-hook.js";
import { openTaskStore, type StoredConversationTask } from "./store.js";

/**
 * Legacy close evidence. Used only when OPENBOT_CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE
 * is off. The strict path must not write this.
 */
const CONVERSATION_REPLY_EVIDENCE: ProgressEvidence = {
  type: "validation_result",
  atMs: 0,
  source: "conversation_reply",
  ruleVersion: "ct-reply-v1",
  verification: "passed",
};

/**
 * Default on. A normal gateway closes chat tasks only on canonical evidence.
 * Set OPENBOT_CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE=0 to restore the legacy
 * conversation_reply close. Not log-only.
 */
export const CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV =
  "OPENBOT_CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE";

export function isConversationTaskCloseRequiresEvidence(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV]?.trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

/**
 * Conversation-task evidence is recorded when close-requires-evidence is on
 * (the default), even if OPENBOT_PROGRESS_LEDGER_ENABLED and
 * gateway.progressLedger.enabled are unset. Do not flip the global ledger
 * default: long-horizon cron binds without it.
 */
export function isConversationTaskEvidenceLedgerEnabled(
  env: NodeJS.ProcessEnv = process.env,
  readConfig?: ProgressLedgerConfigReader,
): boolean {
  if (isConversationTaskCloseRequiresEvidence(env)) {
    return true;
  }
  return isProgressLedgerEnabled(env, readConfig);
}

/**
 * Conversation-task progress writes and projections. Applies shutdown and
 * tenant admission on top of the evidence-ledger source combination.
 * Close-requires-evidence stays default ON, so this can be true even when
 * the process-global progress-ledger switch is unset. A missing tenant id
 * fail-closes only when an allowlist is configured.
 */
export function isConversationTaskProgressEnabled(params: {
  tenantId?: string | null;
  env?: NodeJS.ProcessEnv;
  readConfig?: ProgressLedgerConfigReader;
}): boolean {
  const env = params.env ?? process.env;
  if (isProgressLedgerShutdown(env, params.readConfig)) {
    return false;
  }
  if (!isProgressLedgerTenantAdmitted(params.tenantId, env, params.readConfig)) {
    return false;
  }
  return isConversationTaskEvidenceLedgerEnabled(env, params.readConfig);
}

export function conversationLedgerClosedOnCanonicalEvidence(
  ledger: ExecutionLedger | null,
): boolean {
  if (!ledger) {
    return false;
  }
  return ledger.acceptance.some(
    (item) => item.status === "met" && item.evidence.some((row) => isCanonicalClosingEvidence(row)),
  );
}

async function ensureConversationStepStarted(params: {
  store: ProgressLedgerStore;
  taskId: string;
  ledger: ExecutionLedger;
  step: ExecutionStep;
  atMs: number;
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
      taskId: params.taskId,
      stepId: params.step.id,
      planVersion: params.ledger.currentPlanVersion,
      actor: "runtime",
      payload: {},
    })
  ).ledger;
}

async function ensureConversationStepExecuted(params: {
  store: ProgressLedgerStore;
  taskId: string;
  ledger: ExecutionLedger;
  step: ExecutionStep;
  atMs: number;
}): Promise<ExecutionLedger> {
  if (
    params.step.executed ||
    params.step.status === "executed" ||
    params.step.status === "verified"
  ) {
    return params.ledger;
  }
  const evidence: ProgressEvidence = {
    ...CONVERSATION_REPLY_EVIDENCE,
    atMs: params.atMs,
  };
  assertNotLegacyProgressSource({ kind: evidence.type, source: evidence.source });
  return (
    await appendLedgerEvent(params.store, {
      id: newLedgerEventId(),
      atMs: params.atMs,
      type: "STEP_EXECUTED",
      taskId: params.taskId,
      stepId: params.step.id,
      planVersion: params.ledger.currentPlanVersion,
      actor: "runtime",
      payload: { evidence },
    })
  ).ledger;
}

function conversationStepReadyForValidation(step: ExecutionStep): boolean {
  return step.executed || step.status === "executed" || step.status === "verified";
}

function unmetAcceptanceId(ledger: ExecutionLedger, step: ExecutionStep): string | undefined {
  return step.acceptanceIds.find((id) => {
    const item = ledger.acceptance.find((row) => row.id === id);
    return item !== undefined && item.status !== "met";
  });
}

/** Mark executed using evidence already on the step. Never conversation_reply. */
async function ensureConversationStepReadyForEvidence(params: {
  store: ProgressLedgerStore;
  taskId: string;
  ledger: ExecutionLedger;
  step: ExecutionStep;
  atMs: number;
  evidence: ProgressEvidence;
}): Promise<ExecutionLedger> {
  let ledger = params.ledger;
  let step = ledger.steps.find((row) => row.id === params.step.id) ?? params.step;
  if (conversationStepReadyForValidation(step) || step.status === "completed") {
    return ledger;
  }
  if (step.status === "pending" || step.status === "failed" || step.status === "blocked") {
    ledger = await ensureConversationStepStarted({
      store: params.store,
      taskId: params.taskId,
      ledger,
      step,
      atMs: params.atMs,
    });
    step = ledger.steps.find((row) => row.id === params.step.id) ?? step;
  }
  if (conversationStepReadyForValidation(step) || step.status === "completed") {
    return ledger;
  }
  if (step.status !== "in_progress" && step.status !== "executed") {
    return ledger;
  }
  return (
    await appendLedgerEvent(params.store, {
      id: newLedgerEventId(),
      atMs: params.atMs,
      type: "STEP_EXECUTED",
      taskId: params.taskId,
      stepId: step.id,
      planVersion: ledger.currentPlanVersion,
      actor: "runtime",
      payload: { evidence: params.evidence },
    })
  ).ledger;
}

async function completeConversationTaskLedgerOnCanonicalEvidence(params: {
  store: ProgressLedgerStore;
  taskId: string;
  ledger: ExecutionLedger;
  atMs: number;
}): Promise<ExecutionLedger> {
  const step = currentWritableStep(params.ledger);
  if (!step || step.status === "completed") {
    return params.ledger;
  }
  const evidence = selectExistingClosingEvidence(step);
  if (!evidence) {
    return params.ledger;
  }
  let ledger = params.ledger;
  if (!conversationStepReadyForValidation(step)) {
    ledger = await ensureConversationStepReadyForEvidence({
      store: params.store,
      taskId: params.taskId,
      ledger,
      step,
      atMs: params.atMs,
      evidence,
    });
    const refreshed = ledger.steps.find((row) => row.id === step.id);
    if (
      !refreshed ||
      !conversationStepReadyForValidation(refreshed) ||
      refreshed.status === "completed"
    ) {
      return ledger;
    }
  }
  return await recordCanonicalValidation({
    store: params.store,
    taskId: params.taskId,
    stepId: step.id,
    acceptanceId: unmetAcceptanceId(ledger, ledger.steps.find((row) => row.id === step.id) ?? step),
    evidence,
    atMs: params.atMs + 1,
  });
}

/** Close ledger acceptance when a matching inbound turn receives its assistant reply. */
export async function completeConversationTaskLedgerOnReply(params: {
  task: StoredConversationTask;
  cronStorePath?: string;
  atMs?: number;
  env?: NodeJS.ProcessEnv;
  readConfig?: ProgressLedgerConfigReader;
}): Promise<ExecutionLedger | null> {
  return (await completeConversationTaskLedgerOnReplyOutcome(params)).ledger;
}

export async function completeConversationTaskLedgerOnReplyOutcome(params: {
  task: StoredConversationTask;
  cronStorePath?: string;
  atMs?: number;
  env?: NodeJS.ProcessEnv;
  readConfig?: ProgressLedgerConfigReader;
}): Promise<{ ledger: ExecutionLedger | null; closedNow: boolean }> {
  const env = params.env ?? process.env;
  const enabled = isConversationTaskProgressEnabled({
    tenantId: params.task.tenantId,
    env,
    readConfig: params.readConfig,
  });
  if (!enabled) {
    return { ledger: null, closedNow: false };
  }
  const taskId = conversationTaskLedgerId(params.task);
  const store = createFileLedgerStore({
    cronStorePath: params.cronStorePath ?? resolveCronStorePath(),
    taskId,
  });
  let ledger = await loadFoldedLedger(store);
  if (!ledger || ledger.completed) {
    return { ledger, closedNow: false };
  }
  const beforeClosed = conversationLedgerClosedOnCanonicalEvidence(ledger) || ledger.completed;
  const atMs = params.atMs ?? Date.now();
  if (isConversationTaskCloseRequiresEvidence(env)) {
    const closedLedger = await completeConversationTaskLedgerOnCanonicalEvidence({
      store,
      taskId,
      ledger,
      atMs,
    });
    return {
      ledger: closedLedger,
      closedNow:
        (conversationLedgerClosedOnCanonicalEvidence(closedLedger) || closedLedger.completed) &&
        !beforeClosed,
    };
  }
  const step = ledger.steps.find((row) => !row.retired) ?? ledger.steps[0];
  if (!step) {
    return { ledger, closedNow: false };
  }

  ledger = await ensureConversationStepStarted({
    store,
    taskId,
    ledger,
    step: ledger.steps.find((row) => row.id === step.id) ?? step,
    atMs,
  });
  const liveStep = ledger.steps.find((row) => row.id === step.id) ?? step;
  ledger = await ensureConversationStepExecuted({
    store,
    taskId,
    ledger,
    step: liveStep,
    atMs: atMs + 1,
  });

  const evidence: ProgressEvidence = {
    ...CONVERSATION_REPLY_EVIDENCE,
    atMs: atMs + 2,
  };
  const closedLedger = await recordCanonicalValidation({
    store,
    taskId,
    stepId: step.id,
    acceptanceId: "A1",
    evidence,
    atMs: atMs + 3,
  });
  return {
    ledger: closedLedger,
    closedNow:
      (conversationLedgerClosedOnCanonicalEvidence(closedLedger) || closedLedger.completed) &&
      !beforeClosed,
  };
}

export function conversationTaskLedgerId(task: Pick<StoredConversationTask, "id">): string {
  return `ct-${task.id}`;
}

export function buildConversationTaskSeedEvent(params: {
  task: StoredConversationTask;
  atMs: number;
}): ExecutionEvent {
  const taskId = conversationTaskLedgerId(params.task);
  const goal = params.task.goal.trim() || params.task.normalizedGoal;
  return {
    id: newLedgerEventId(),
    atMs: params.atMs,
    type: "PLAN_SEEDED",
    taskId,
    planVersion: 1,
    actor: "runtime",
    payload: {
      goal,
      acceptance: [
        {
          id: "A1",
          text: goal,
          required: true,
          satisfiedByStepIds: ["E1"],
        },
      ],
      steps: [
        {
          id: "E1",
          title: goal,
          acceptanceIds: ["A1"],
        },
      ],
    },
  };
}

export async function ensureConversationTaskLedgerSeeded(params: {
  task: StoredConversationTask;
  store?: ProgressLedgerStore;
  cronStorePath?: string;
  atMs?: number;
  env?: NodeJS.ProcessEnv;
  readConfig?: ProgressLedgerConfigReader;
}): Promise<ExecutionLedger | null> {
  const enabled = isConversationTaskProgressEnabled({
    tenantId: params.task.tenantId,
    env: params.env ?? process.env,
    readConfig: params.readConfig,
  });
  if (!enabled) {
    return null;
  }
  const store =
    params.store ??
    createFileLedgerStore({
      cronStorePath: params.cronStorePath ?? resolveCronStorePath(),
      taskId: conversationTaskLedgerId(params.task),
    });
  const existing = await loadFoldedLedger(store);
  if (existing) {
    return existing;
  }
  return (
    await appendLedgerEvent(
      store,
      buildConversationTaskSeedEvent({
        task: params.task,
        atMs: params.atMs ?? Date.now(),
      }),
    )
  ).ledger;
}

export async function readConversationTaskProgressView(params: {
  task: StoredConversationTask;
  cronStorePath?: string;
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
  readConfig?: ProgressLedgerConfigReader;
}): Promise<ProgressView | null> {
  const enabled = isConversationTaskProgressEnabled({
    tenantId: params.task.tenantId,
    env: params.env ?? process.env,
    readConfig: params.readConfig,
  });
  if (!enabled) {
    return null;
  }
  const ledger = await loadFoldedLedger(
    createFileLedgerStore({
      cronStorePath: params.cronStorePath ?? resolveCronStorePath(),
      taskId: conversationTaskLedgerId(params.task),
    }),
  );
  if (!ledger) {
    return null;
  }
  return projectProgress(ledger, inferTurnContractFromLedger(ledger), params.nowMs ?? Date.now());
}

type ConversationToolAgentEvent = {
  stream: string;
  data: Record<string, unknown>;
};

const pendingConversationToolObservations = new Map<string, Promise<void>>();

export function conversationToolObservationKey(params: {
  requesterId: string;
  conversationId: string;
  sourceMessageId: string;
}): string {
  return `${params.requesterId}\0${params.conversationId}\0${params.sourceMessageId}`;
}

export async function flushConversationToolObservations(key: string): Promise<void> {
  let current = pendingConversationToolObservations.get(key);
  while (current) {
    await current;
    const next = pendingConversationToolObservations.get(key);
    if (!next || next === current) {
      if (pendingConversationToolObservations.get(key) === current) {
        pendingConversationToolObservations.delete(key);
      }
      return;
    }
    current = next;
  }
}

function trackConversationToolObservation(key: string, pending: Promise<void>): void {
  pendingConversationToolObservations.set(key, pending);
  void pending.finally(() => {
    if (pendingConversationToolObservations.get(key) === pending) {
      pendingConversationToolObservations.delete(key);
    }
  });
}

/**
 * Record a chat-turn Pi tool event. Tool stream start/result only.
 * Evidence is tool_result. Assistant text is ignored.
 */
export async function observeConversationToolEvent(params: {
  task: StoredConversationTask;
  evt: ConversationToolAgentEvent;
  store?: ProgressLedgerStore;
  cronStorePath?: string;
  atMs?: number;
  env?: NodeJS.ProcessEnv;
  readConfig?: ProgressLedgerConfigReader;
}): Promise<ExecutionLedger | null> {
  if (params.evt.stream !== "tool") {
    return null;
  }
  const phase =
    params.evt.data.phase === "start" || params.evt.data.phase === "result"
      ? params.evt.data.phase
      : null;
  const toolName = typeof params.evt.data.name === "string" ? params.evt.data.name.trim() : "";
  if (!phase || !toolName) {
    return null;
  }
  const env = params.env ?? process.env;
  const store =
    params.store ??
    createFileLedgerStore({
      cronStorePath: params.cronStorePath ?? resolveCronStorePath(),
      taskId: conversationTaskLedgerId(params.task),
    });
  const seeded = await ensureConversationTaskLedgerSeeded({
    task: params.task,
    store,
    ...(params.cronStorePath ? { cronStorePath: params.cronStorePath } : {}),
    ...(params.atMs !== undefined ? { atMs: params.atMs } : {}),
    env,
    ...(params.readConfig ? { readConfig: params.readConfig } : {}),
  });
  if (!seeded) {
    return null;
  }
  const atMs = params.atMs ?? Date.now();
  const step = currentWritableStep(seeded);
  if (!step) {
    return seeded;
  }
  const taskId = conversationTaskLedgerId(params.task);
  if (phase === "start") {
    return await ensureConversationStepStarted({
      store,
      taskId,
      ledger: seeded,
      step,
      atMs,
    });
  }
  const isError = params.evt.data.isError === true;
  const evidence: ProgressEvidence = {
    type: "tool_result",
    atMs,
    source: toolName,
    verification: isError ? "failed" : "passed",
  };
  if (isError) {
    return (
      await appendLedgerEvent(store, {
        id: newLedgerEventId(),
        atMs,
        type: "TOOL_FAILED",
        taskId,
        stepId: step.id,
        planVersion: seeded.currentPlanVersion,
        actor: "runtime",
        payload: {
          toolName,
          evidence,
          failure: { code: "tool_failed", message: `${toolName} failed` },
        },
      })
    ).ledger;
  }
  let ledger = seeded;
  if (step.status === "pending" || step.status === "failed" || step.status === "blocked") {
    ledger = await ensureConversationStepStarted({
      store,
      taskId,
      ledger,
      step,
      atMs,
    });
  }
  const live = ledger.steps.find((row) => row.id === step.id) ?? step;
  return (
    await appendLedgerEvent(store, {
      id: newLedgerEventId(),
      atMs: atMs + 1,
      type: "TOOL_SUCCEEDED",
      taskId,
      stepId: live.id,
      planVersion: ledger.currentPlanVersion,
      actor: "runtime",
      payload: { toolName, evidence },
    })
  ).ledger;
}

export function createConversationTurnToolObserver(params: {
  isHeartbeat?: boolean;
  sessionKey?: string | null;
  commandBody?: string | null;
  sessionCtx: {
    GatewayClientPlatformUserId?: string;
    GatewayClientSessionEnterpriseId?: string;
    CollaborationTenantId?: string;
    MessageSid?: string;
    MessageSidFirst?: string;
    MessageSidLast?: string;
    BodyForCommands?: string;
    CommandBody?: string;
    RawBody?: string;
    Body?: string;
  };
  tenantId?: string | null;
  storeRoot: string;
  cronStorePath?: string;
  env?: NodeJS.ProcessEnv;
  readConfig?: ProgressLedgerConfigReader;
}): ((evt: ConversationToolAgentEvent) => void) | null {
  if (params.isHeartbeat) {
    return null;
  }
  const env = params.env ?? process.env;
  const ledgerOn = isConversationTaskProgressEnabled({
    tenantId: params.tenantId,
    env,
    readConfig: params.readConfig,
  });
  if (!ledgerOn) {
    return null;
  }
  if (!readConversationTaskFlags(env).activation) {
    return null;
  }
  const requesterId = params.sessionCtx.GatewayClientPlatformUserId?.trim() ?? "";
  const conversationId = params.sessionKey?.trim() ?? "";
  const text =
    [
      params.sessionCtx.BodyForCommands,
      params.sessionCtx.CommandBody,
      params.sessionCtx.RawBody,
      params.sessionCtx.Body,
      params.commandBody,
    ]
      .find((value): value is string => typeof value === "string" && value.trim() !== "")
      ?.trim() ?? "";
  const sourceMessageId =
    [
      params.sessionCtx.MessageSid,
      params.sessionCtx.MessageSidFirst,
      params.sessionCtx.MessageSidLast,
    ]
      .find((value): value is string => typeof value === "string" && value.trim() !== "")
      ?.trim() ?? "";
  if (!requesterId || !conversationId || !text) {
    return null;
  }
  const tenantId = resolveActivationTenantId(
    params.tenantId ??
      params.sessionCtx.GatewayClientSessionEnterpriseId ??
      params.sessionCtx.CollaborationTenantId ??
      null,
    requesterId,
  );
  if (!tenantId) {
    return null;
  }
  const key = conversationToolObservationKey({ requesterId, conversationId, sourceMessageId });
  const cronStorePath = params.cronStorePath ?? resolveCronStorePath();
  let chain: Promise<void> = Promise.resolve();
  let prepared: Promise<{
    store: ProgressLedgerStore;
    task: StoredConversationTask;
  } | null> | null = null;

  const prepare = (): Promise<{
    store: ProgressLedgerStore;
    task: StoredConversationTask;
  } | null> => {
    if (!prepared) {
      prepared = (async () => {
        const taskStore = openTaskStore({ tenantId, storeRoot: params.storeRoot });
        try {
          const normalizedGoal = normalizeGoal(text);
          const task = taskStore
            .findActiveTasksByConversation(conversationId)
            .filter((row) => row.requesterId === requesterId || row.ownerId === requesterId)
            .find(
              (row) =>
                (sourceMessageId !== "" && row.sourceMessageId === sourceMessageId) ||
                row.normalizedGoal === normalizedGoal,
            );
          if (!task) {
            return null;
          }
          const store = createFileLedgerStore({
            cronStorePath,
            taskId: conversationTaskLedgerId(task),
          });
          await ensureConversationTaskLedgerSeeded({
            task,
            store,
            cronStorePath,
            env,
          });
          return { store, task };
        } finally {
          taskStore.close();
        }
      })().catch(() => null);
    }
    return prepared;
  };

  return (evt) => {
    try {
      if (evt.stream !== "tool") {
        return;
      }
      chain = chain
        .catch(() => undefined)
        .then(async () => {
          const ctx = await prepare();
          if (!ctx) {
            return;
          }
          await observeConversationToolEvent({
            task: ctx.task,
            store: ctx.store,
            evt,
            cronStorePath,
            env,
            ...(params.readConfig ? { readConfig: params.readConfig } : {}),
          });
        });
      trackConversationToolObservation(key, chain);
    } catch {
      // Ledger observation must never break the chat turn.
    }
  };
}
