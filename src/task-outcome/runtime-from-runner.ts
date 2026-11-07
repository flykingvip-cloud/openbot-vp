import path from "node:path";
import { resolveAgentDir } from "../agents/agent-scope.js";
import { normalizeUsage } from "../agents/usage.js";
import type { OpenBotConfig } from "../config/config.js";
import {
  associateBudgetCharge,
  type BudgetCommandReport,
} from "../executor-evidence/association.js";
import { publishFinalEvidenceLink } from "../executor-evidence/association.js";
import { buildCostColumns } from "../executor-evidence/cost-columns.js";
import { fullScopeEqual, snapshotIdentityFingerprint } from "../executor-evidence/identity.js";
import {
  currentExecutorModelCall,
  getModelCall,
  noteModelResponse,
  readCallFiles,
  usageFingerprint,
  usageFromUnknown,
  type ExecutorEvidenceContext,
} from "../executor-evidence/model-call-evidence.js";
import { recordToolOutcomes } from "../gateway/agent-growth/operational-metrics-store.js";
import { estimateUsageCost, resolveModelCostConfig } from "../utils/usage-format.js";
import { applySpendAndAssess, assessTaskBudgetExhaustion, buildTaskBudgetState } from "./budget.js";
import {
  assessTargetModalityAcceptance,
  capabilityModalityFromClaim,
} from "./capability-modality.js";
import { GROWTH_EVOLUTION_CONSUMER_ID, OutcomeConsumerRuntime } from "./consumers.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { createExperienceVerifiedHandler } from "./experience-verified-handler.js";
import { publishEvolutionFromTaskOutcome } from "./growth-bridge.js";
import { mergeAdoptedIntoExperienceExposure } from "./learning-adoption.js";
import {
  resolveTrustedRunModalityCompletionEvidence,
  type ModalityCompletionEvidence,
  type ModalityExecutionArtifact,
} from "./modality-artifact-evidence.js";
import { createModeQualityHandler, createSkillQualityHandler } from "./quality-handlers.js";
import { newFencingToken, TaskOutcomeResultService } from "./result-service.js";
import { DurableTaskOutcomeStore } from "./store.js";
import { scopeIdOf } from "./transitions.js";
import type {
  CloseReasonCode,
  CommittedSpend,
  SubmitResult,
  TaskOutcomeRecord,
  TrustedScope,
} from "./types.js";
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
  | "budget_exceeded"
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
  /** When creating (not restore), persist this entrypoint; defaults to chat. */
  entrypoint?: import("./types.js").Entrypoint;
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
  /**
   * Real generation artifacts from image_gen / music_gen for this turn.
   * Required to mark image_generation / audio_music_generation completed.
   */
  modalityArtifacts?: readonly ModalityExecutionArtifact[];
  /** Explicit completion evidence; overrides artifact/run defaults when set. */
  modalityCompletionEvidence?: ModalityCompletionEvidence;
  /**
   * W3 wrap-up: optional USD spend for this attempt (reuses tip budget projection).
   * When omitted, only iterationCount += 1 is charged on the chat runner path.
   */
  costUsd?: number;
  /**
   * known = priced (including 0); unknown = model call without a price;
   * not_applicable = non-model closeout (collab claim). Omitted + positive costUsd
   * stays the legacy "known positive" path.
   */
  costEvidence?: "known" | "unknown" | "not_applicable";
  /** Optional tighten-only tip budget limits (applied on first ensure). */
  budgetLimits?: Partial<import("./budget.js").TaskBudgetLimits>;
  /**
   * Residual: explicit adoption evidence (subset of tip exposure).
   * Merged onto tip before close/verify — never inferred from injected alone.
   */
  adoptedAssetIds?: readonly string[];
  /**
   * When true, skip closeout accumulate (mid-run pre-gate already charged this turn).
   * Closeout still assesses exhaustion and may fail_closed.
   */
  skipBudgetCharge?: boolean;
  /** Captured from chargeModelCallAgainstTip. Closeout does not invent a call. */
  modelCallLink?: ModelCallCloseoutLink | null;
  /** Every candidate in the turn, including failed and cancelled calls. */
  modelCallLinks?: ModelCallCloseoutLink[];
};

export type ModelCallCloseoutLink = {
  callId: string;
  evidenceId: string;
  candidateAttemptId: string;
  chargeOutcomeVersion: number;
  chargeCommitId: string | null;
  requestDigest: string | null;
  usageFingerprint: string;
  commandId: string;
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
  /** Explicit learning adoption evidence — forwarded to tip; never guessed from inject. */
  adoptedAssetIds?: readonly string[];
  /** Mid-run budget already charged — skip closeout accumulate. */
  skipBudgetCharge?: boolean;
};

/** Usage attached by a candidate failure, when the transport recorded it before throwing. */
export function usageCarriedByModelError(err: unknown): unknown {
  if (!err || typeof err !== "object" || !("usage" in err)) {
    return undefined;
  }
  return (err as { usage?: unknown }).usage;
}

function resolveStoreRoot(cfg: OpenBotConfig, agentId: string): string {
  return path.join(resolveAgentDir(cfg, agentId), TASK_OUTCOME_STORE_DIRNAME);
}

/** Optional model-fallback evidence context. Missing task identity collects nothing. */
export function runnerExecutorEvidenceContext(
  cfg: OpenBotConfig,
  agentId: string,
  params: { taskId?: string; scope?: TrustedScope; runId: string },
): ExecutorEvidenceContext | undefined {
  const taskId = params.taskId?.trim();
  const agent = agentId.trim();
  if (!taskId || !params.scope || !agent || !params.runId.trim()) {
    return undefined;
  }
  return {
    agentId: agent,
    scope: params.scope,
    taskId,
    runId: params.runId,
    storeRoot: resolveStoreRoot(cfg, agent),
    provenance: "live",
    collector: "model-fallback",
  };
}

export class TaskBudgetExceededError extends Error {
  readonly exhaustion: import("./budget.js").TaskBudgetExhaustion;
  readonly taskId: string;
  constructor(taskId: string, exhaustion: import("./budget.js").TaskBudgetExhaustion) {
    super(`task budget exceeded (${exhaustion.dimension}): ${exhaustion.detail}`);
    this.name = "TaskBudgetExceededError";
    this.taskId = taskId;
    this.exhaustion = exhaustion;
  }
}

export type RunnerBudgetGateResult =
  | { allowed: true; record: TaskOutcomeRecord; fencingToken: string }
  | {
      allowed: false;
      record: TaskOutcomeRecord;
      fencingToken: string;
      exhaustion: import("./budget.js").TaskBudgetExhaustion;
    };

function openRunnerBudgetContext(
  cfg: OpenBotConfig,
  agentId: string,
  params: {
    taskId: string;
    scope: TrustedScope;
    budgetLimits?: Partial<import("./budget.js").TaskBudgetLimits>;
    /** Wall-clock task start; used when tip budget has no startedAtMs yet. */
    startedAtMs?: number;
  },
): {
  store: DurableTaskOutcomeStore;
  service: TaskOutcomeResultService;
  chat: ChatTaskOutcomeAdapter;
  record: TaskOutcomeRecord;
  fencingToken: string;
} {
  const store = new DurableTaskOutcomeStore(resolveStoreRoot(cfg, agentId));
  const service = new TaskOutcomeResultService({ store, submittedBy: "runner-budget-gate" });
  const chat = new ChatTaskOutcomeAdapter(service);
  const existing = store.loadTask(params.taskId);
  let record = existing;
  let fencingToken = existing?.fencingToken || newFencingToken();
  if (!record) {
    const opened = chat.createOrRestore({
      taskId: params.taskId,
      scope: params.scope,
      taskContractVersion: "1.0.0",
      commandId: `budget-gate-open:${params.taskId}`,
    });
    if (!opened.ok) {
      throw new Error(`task-outcome budget gate open failed: ${opened.code}`);
    }
    record = opened.record;
    fencingToken = opened.fencingToken || fencingToken;
  }
  if (!record.budget) {
    const startedAtMs = params.startedAtMs ?? Date.now();
    const budget = {
      ...buildTaskBudgetState({ taskLimits: params.budgetLimits }),
      startedAtMs,
    };
    const ensured = service.submit(
      params.taskId,
      {
        type: "set_budget",
        budget,
        expectedVersion: record.outcomeVersion,
        fencingToken,
      },
      { requiredScope: params.scope, commandId: `budget-gate-ensure:${params.taskId}` },
    );
    if (!ensured.ok) {
      throw new Error(`task-outcome budget gate ensure failed: ${ensured.code}`);
    }
    record = ensured.record;
  } else if (record.budget.startedAtMs == null && params.startedAtMs != null) {
    const patched = service.submit(
      params.taskId,
      {
        type: "set_budget",
        budget: { ...record.budget, startedAtMs: params.startedAtMs },
        expectedVersion: record.outcomeVersion,
        fencingToken,
      },
      { requiredScope: params.scope, commandId: `budget-gate-start:${params.taskId}` },
    );
    if (patched.ok) {
      record = patched.record;
    }
  }
  return { store, service, chat, record, fencingToken };
}

export type TipBudgetCostClassification = {
  evidence: "known" | "unknown";
  /** Present only when evidence is known. 0 is a real price, not a missing config. */
  costUsd?: number;
};

/**
 * Price a model call from usage + cost config.
 * Missing usage or missing cost config is unknown — never a fabricated 0.
 * A cost config that prices to 0 is known.
 */
export function classifyTipBudgetCostFromUsage(params: {
  usage?: unknown;
  provider?: string;
  model?: string;
  config?: OpenBotConfig;
}): TipBudgetCostClassification {
  try {
    const usage = normalizeUsage(params.usage as never);
    if (!usage) {
      return { evidence: "unknown" };
    }
    const costConfig = resolveModelCostConfig({
      provider: params.provider,
      model: params.model,
      config: params.config,
    });
    const estimated = estimateUsageCost({ usage, cost: costConfig });
    if (typeof estimated === "number" && Number.isFinite(estimated) && estimated >= 0) {
      return { evidence: "known", costUsd: estimated };
    }
  } catch {
    // cost estimate is best-effort; callers still charge iterations and mark unknown
  }
  return { evidence: "unknown" };
}

/**
 * Best-effort positive USD estimate from real agent usage + model cost config.
 * Returns undefined for unknown and for known zero — callers that need the
 * distinction must use classifyTipBudgetCostFromUsage.
 */
export function estimateTipBudgetCostUsdFromUsage(params: {
  usage?: unknown;
  provider?: string;
  model?: string;
  config?: OpenBotConfig;
}): number | undefined {
  const classified = classifyTipBudgetCostFromUsage(params);
  if (
    classified.evidence === "known" &&
    typeof classified.costUsd === "number" &&
    classified.costUsd > 0
  ) {
    return classified.costUsd;
  }
  return undefined;
}

/**
 * Pre-model-call gate: assess tip budget WITHOUT charging.
 * Exhausted ⇒ allowed=false (caller must not invoke the model).
 */
function loadExistingTask(
  cfg: OpenBotConfig,
  agentId: string,
  taskId: string,
): TaskOutcomeRecord | null {
  const store = new DurableTaskOutcomeStore(resolveStoreRoot(cfg, agentId));
  return store.loadTask(taskId) ?? null;
}

export function assessRunnerTurnBudgetGate(
  cfg: OpenBotConfig,
  agentId: string,
  params: {
    taskId: string;
    scope: TrustedScope;
    budgetLimits?: Partial<import("./budget.js").TaskBudgetLimits>;
    startedAtMs?: number;
    nowMs?: number;
    /** When the parent tip exists, its limits apply too. Missing parent is not invented. */
    parentTaskId?: string;
    parentAgentId?: string;
  },
): RunnerBudgetGateResult {
  const ctx = openRunnerBudgetContext(cfg, agentId, params);
  const nowMs = params.nowMs ?? Date.now();
  const exhaustion =
    ctx.record.budget != null ? assessTaskBudgetExhaustion(ctx.record.budget, nowMs) : null;
  if (exhaustion) {
    return {
      allowed: false,
      record: ctx.record,
      fencingToken: ctx.fencingToken,
      exhaustion,
    };
  }
  const parentTaskId = params.parentTaskId?.trim();
  if (parentTaskId) {
    const parent = loadExistingTask(cfg, params.parentAgentId?.trim() || agentId, parentTaskId);
    if (parent?.budget) {
      const parentExhausted = assessTaskBudgetExhaustion(parent.budget, nowMs);
      if (parentExhausted || parent.reasonCode === "budget_exceeded") {
        return {
          allowed: false,
          record: parent,
          fencingToken: parent.fencingToken || ctx.fencingToken,
          exhaustion: parentExhausted ?? {
            dimension: "iterations",
            detail: "parent task already closed budget_exceeded",
          },
        };
      }
    }
  }
  return { allowed: true, record: ctx.record, fencingToken: ctx.fencingToken };
}

/** Pre-model-call gate used by production entrypoints. Throws instead of invoking the model. */
export function assertRunnerTurnBudgetAllowsModelCall(
  cfg: OpenBotConfig,
  agentId: string,
  params: {
    taskId: string;
    scope: TrustedScope;
    budgetLimits?: Partial<import("./budget.js").TaskBudgetLimits>;
    startedAtMs?: number;
    nowMs?: number;
    parentTaskId?: string;
    parentAgentId?: string;
  },
): void {
  const gate = assessRunnerTurnBudgetGate(cfg, agentId, params);
  if (!gate.allowed) {
    throw new TaskBudgetExceededError(
      params.parentTaskId?.trim() || params.taskId,
      gate.exhaustion,
    );
  }
}

/**
 * Post-model-call charge: accumulate real iterations/cost, then assess.
 * If exhausted, fail_closed(budget_exceeded) so the next gate blocks.
 */
function attributeChildSpendToParent(
  cfg: OpenBotConfig,
  childAgentId: string,
  params: {
    childTaskId: string;
    parentTaskId: string;
    parentAgentId?: string;
    runId: string;
    callSeq: number;
    iterations: number;
    costUsd?: number;
    costEvidence?: "known" | "unknown" | "not_applicable";
    nowMs: number;
  },
): void {
  const parentAgentId = params.parentAgentId?.trim() || childAgentId;
  const store = new DurableTaskOutcomeStore(resolveStoreRoot(cfg, parentAgentId));
  const service = new TaskOutcomeResultService({ store, submittedBy: "runner-budget-gate" });
  let current = store.loadTask(params.parentTaskId);
  if (!current?.budget || current.lifecycle === "closed") {
    return;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fencingToken = current.fencingToken || newFencingToken();
    const spent = service.submit(
      current.taskId,
      {
        type: "accumulate_budget_spend",
        iterations: params.iterations,
        ...(params.costUsd != null ? { costUsd: params.costUsd } : {}),
        ...(params.costEvidence ? { costEvidence: params.costEvidence } : {}),
        attribution: "child",
        expectedVersion: current.outcomeVersion,
        fencingToken,
        nowMs: params.nowMs,
      },
      {
        requiredScope: current.scope,
        commandId: `budget-spend:child:${current.taskId}:${params.childTaskId}:${params.runId}:call:${params.callSeq}`,
      },
    );
    if (spent.ok || spent.code === "command_conflict") {
      // Same child-call id already attributed. First payload wins; do not add again.
      return;
    }
    if (spent.code !== "version_conflict" && spent.code !== "stale_fencing") {
      throw new Error(`task-outcome parent budget attribution failed: ${spent.code}`);
    }
    const reloaded = store.loadTask(params.parentTaskId);
    if (!reloaded?.budget || reloaded.lifecycle === "closed") {
      return;
    }
    current = reloaded;
  }
  throw new Error("task-outcome parent budget attribution failed: version_conflict");
}

export function chargeRunnerTurnBudgetSpend(
  cfg: OpenBotConfig,
  agentId: string,
  params: {
    taskId: string;
    scope: TrustedScope;
    runId: string;
    callSeq: number;
    costUsd?: number;
    costEvidence?: "known" | "unknown" | "not_applicable";
    iterations?: number;
    nowMs?: number;
    parentTaskId?: string;
    parentAgentId?: string;
    budgetLimits?: Partial<import("./budget.js").TaskBudgetLimits>;
  },
): {
  record: TaskOutcomeRecord;
  exhaustion: import("./budget.js").TaskBudgetExhaustion | null;
  closedForBudget: boolean;
  budgetCommand: BudgetCommandReport;
} {
  const ctx = openRunnerBudgetContext(cfg, agentId, {
    taskId: params.taskId,
    scope: params.scope,
    ...(params.budgetLimits ? { budgetLimits: params.budgetLimits } : {}),
  });
  if (!ctx.record.budget) {
    return {
      record: ctx.record,
      exhaustion: null,
      closedForBudget: false,
      budgetCommand: {
        commandId: `budget-spend:${params.taskId}:${params.runId}:call:${params.callSeq}`,
        requestDigest: null,
        disposition: "absent",
        commitId: null,
        chargeOutcomeVersion: ctx.record.outcomeVersion,
        closeOutcomeVersion: null,
        committedCostUsd: null,
        costStatus: "not_committed",
      },
    };
  }
  if (ctx.record.lifecycle === "closed") {
    const commandId = `budget-spend:${params.taskId}:${params.runId}:call:${params.callSeq}`;
    const verified = verifyStoredSpend(ctx.store, commandId, params.scope);
    const parentTaskId = params.parentTaskId?.trim();
    if (parentTaskId && parentTaskId !== params.taskId && verified) {
      attributeChildSpendToParent(cfg, agentId, {
        childTaskId: params.taskId,
        parentTaskId,
        parentAgentId: params.parentAgentId,
        runId: params.runId,
        callSeq: params.callSeq,
        iterations: verified.iterations,
        ...(verified.costUsd != null ? { costUsd: verified.costUsd } : {}),
        ...(verified.costEvidence ? { costEvidence: verified.costEvidence } : {}),
        nowMs: params.nowMs ?? Date.now(),
      });
    }
    return {
      record: ctx.record,
      exhaustion: null,
      closedForBudget: false,
      budgetCommand: {
        commandId: `budget-spend:${params.taskId}:${params.runId}:call:${params.callSeq}`,
        requestDigest: null,
        disposition: "absent",
        commitId: null,
        chargeOutcomeVersion: ctx.record.outcomeVersion,
        closeOutcomeVersion: null,
        committedCostUsd: null,
        costStatus: "not_committed",
      },
    };
  }
  const nowMs = params.nowMs ?? Date.now();
  const iterations =
    typeof params.iterations === "number" && params.iterations > 0
      ? Math.floor(params.iterations)
      : 1;
  const knownPositive =
    typeof params.costUsd === "number" && Number.isFinite(params.costUsd) && params.costUsd > 0
      ? params.costUsd
      : undefined;
  const knownZero =
    params.costEvidence === "known" &&
    typeof params.costUsd === "number" &&
    Number.isFinite(params.costUsd) &&
    params.costUsd === 0;
  const costUsd = knownPositive ?? (knownZero ? 0 : undefined);
  const commandId = `budget-spend:${params.taskId}:${params.runId}:call:${params.callSeq}`;
  const spent = ctx.service.submit(
    params.taskId,
    {
      type: "accumulate_budget_spend",
      iterations,
      ...(costUsd != null ? { costUsd } : {}),
      ...(params.costEvidence ? { costEvidence: params.costEvidence } : {}),
      expectedVersion: ctx.record.outcomeVersion,
      fencingToken: ctx.fencingToken,
      nowMs,
    },
    {
      requiredScope: params.scope,
      commandId,
    },
  );
  if (!spent.ok && spent.code !== "command_conflict" && spent.code !== "evidence_missing") {
    throw new Error(`task-outcome mid-run budget charge failed: ${spent.code}`);
  }
  const knownSubmitted = params.costEvidence === "known" && costUsd != null;
  let budgetCommand = budgetReportFromSubmit(commandId, spent, {
    known: knownSubmitted,
    costUsd,
  });
  // Replay and conflict keep the stored command. A new callback cost is not committed.
  let record = spent.ok ? spent.record : (ctx.store.loadTask(params.taskId) ?? ctx.record);
  const storedSpend = verifyStoredSpend(ctx.store, commandId, params.scope);
  const recovering =
    budgetCommand.disposition === "replayed" || budgetCommand.disposition === "conflict";
  const sideEffectSpend: CommittedSpend | null =
    budgetCommand.disposition === "applied"
      ? {
          iterations,
          costUsd: costUsd ?? null,
          costEvidence: params.costEvidence ?? null,
        }
      : recovering
        ? storedSpend
        : null;
  const parentTaskId = params.parentTaskId?.trim();
  if (parentTaskId && parentTaskId !== params.taskId && sideEffectSpend) {
    attributeChildSpendToParent(cfg, agentId, {
      childTaskId: params.taskId,
      parentTaskId,
      parentAgentId: params.parentAgentId,
      runId: params.runId,
      callSeq: params.callSeq,
      iterations: sideEffectSpend.iterations,
      ...(sideEffectSpend.costUsd != null ? { costUsd: sideEffectSpend.costUsd } : {}),
      ...(sideEffectSpend.costEvidence ? { costEvidence: sideEffectSpend.costEvidence } : {}),
      nowMs,
    });
  }
  const tip = ctx.store.loadTask(params.taskId) ?? record;
  record = tip;
  const exhaustion = tip.budget != null ? assessTaskBudgetExhaustion(tip.budget, nowMs) : null;
  if (exhaustion && tip.lifecycle !== "closed" && sideEffectSpend) {
    const closeCommandId = `budget-exceeded:${params.taskId}:${params.runId}:call:${params.callSeq}`;
    const closed = ctx.chat.failClosed(params.taskId, tip.outcomeVersion, "budget_exceeded", {
      fencingToken: tip.fencingToken || ctx.fencingToken,
      reasonDetail: exhaustion.detail,
      scope: params.scope,
      commandId: closeCommandId,
    });
    if (!closed.ok && closed.code !== "command_conflict" && closed.code !== "evidence_missing") {
      throw new Error(`task-outcome mid-run budget fail_closed failed: ${closed.code}`);
    }
    const closeReport = budgetReportFromSubmit(closeCommandId, closed, { known: false });
    budgetCommand = {
      ...budgetCommand,
      closeOutcomeVersion: closeReport.chargeOutcomeVersion,
    };
    if (closed.ok) {
      record = closed.record;
    }
    return { record, exhaustion, closedForBudget: closed.ok, budgetCommand };
  }
  return { record, exhaustion, closedForBudget: false, budgetCommand };
}

function verifyStoredSpend(
  store: DurableTaskOutcomeStore,
  commandId: string,
  scope: TrustedScope,
): CommittedSpend | null {
  const prior = store.loadCommand(commandId);
  const spend = prior?.committedSpend;
  if (!prior?.commitId || !spend) {
    return null;
  }
  if (!Number.isInteger(spend.iterations) || spend.iterations < 0) {
    return null;
  }
  if (spend.costUsd != null && (!Number.isFinite(spend.costUsd) || spend.costUsd < 0)) {
    return null;
  }
  const bundle = store.loadCommitBundle(prior.commitId);
  const logged = bundle?.commandLog?.committedSpend;
  if (
    !bundle ||
    !logged ||
    bundle.commandLog?.commandId !== commandId ||
    bundle.commandLog?.digest !== prior.digest ||
    logged.iterations !== spend.iterations ||
    logged.costUsd !== spend.costUsd ||
    logged.costEvidence !== spend.costEvidence ||
    bundle.taskId !== prior.taskId ||
    bundle.record.taskId !== prior.taskId ||
    bundle.record.outcomeVersion !== prior.outcomeVersion
  ) {
    return null;
  }
  const snapshot = store.loadTaskVersion(prior.taskId, prior.outcomeVersion);
  if (
    !snapshot ||
    snapshot.taskId !== prior.taskId ||
    snapshot.outcomeVersion !== prior.outcomeVersion ||
    !fullScopeEqual(snapshot.scope, scope) ||
    !prior.snapshotFingerprint ||
    snapshotIdentityFingerprint(snapshot) !== prior.snapshotFingerprint ||
    snapshotIdentityFingerprint(bundle.record) !== prior.snapshotFingerprint
  ) {
    return null;
  }
  return spend;
}

function budgetReportFromSubmit(
  commandId: string,
  spent: SubmitResult,
  submitted: { known: boolean; costUsd?: number },
): BudgetCommandReport {
  if (spent.ok && spent.commandReceipt) {
    const applied = spent.commandReceipt.disposition === "applied";
    return {
      commandId,
      requestDigest: spent.commandReceipt.requestDigest,
      disposition: spent.commandReceipt.disposition,
      commitId: spent.commandReceipt.commitId,
      chargeOutcomeVersion: spent.commandReceipt.outcomeVersion,
      closeOutcomeVersion: null,
      committedCostUsd: applied && submitted.known ? (submitted.costUsd ?? null) : null,
      costStatus: !applied ? "not_committed" : submitted.known ? "known" : "unknown",
    };
  }
  if (!spent.ok && spent.code === "command_conflict" && spent.commandConflict) {
    return {
      commandId,
      requestDigest: spent.commandConflict.requestDigest,
      disposition: "conflict",
      commitId: spent.commandConflict.storedCommitId,
      chargeOutcomeVersion: spent.commandConflict.storedOutcomeVersion,
      closeOutcomeVersion: null,
      committedCostUsd: null,
      costStatus: "not_committed",
    };
  }
  if (!spent.ok && spent.code === "evidence_missing") {
    return {
      commandId,
      requestDigest: spent.evidenceGap?.requestDigest ?? null,
      disposition: "evidence_missing",
      commitId: null,
      chargeOutcomeVersion: spent.evidenceGap?.outcomeVersion ?? null,
      closeOutcomeVersion: null,
      committedCostUsd: null,
      costStatus: "not_committed",
    };
  }
  return {
    commandId,
    requestDigest: null,
    disposition: "absent",
    commitId: null,
    chargeOutcomeVersion: spent.ok ? spent.record.outcomeVersion : null,
    closeOutcomeVersion: null,
    committedCostUsd: null,
    costStatus: "not_committed",
  };
}

/**
 * Production post-call charge: classify usage, record known/unknown/zero,
 * and attribute the same call to the parent tip when one exists.
 */
export function chargeModelCallAgainstTip(
  cfg: OpenBotConfig,
  agentId: string,
  params: {
    taskId: string;
    scope: TrustedScope;
    runId: string;
    callSeq: number;
    usage?: unknown;
    provider?: string;
    model?: string;
    parentTaskId?: string;
    parentAgentId?: string;
    nowMs?: number;
    budgetLimits?: Partial<import("./budget.js").TaskBudgetLimits>;
  },
): {
  record: TaskOutcomeRecord;
  evidence: "known" | "unknown";
  costUsd?: number;
  closedForBudget: boolean;
  budgetCommand: BudgetCommandReport;
  callId: string | null;
  associationCompleteness: "complete" | "partial" | "unlinked";
  modelCallLink: ModelCallCloseoutLink | null;
} {
  const classified = classifyTipBudgetCostFromUsage({
    usage: params.usage,
    provider: params.provider,
    model: params.model,
    config: cfg,
  });
  const charged = chargeRunnerTurnBudgetSpend(cfg, agentId, {
    taskId: params.taskId,
    scope: params.scope,
    runId: params.runId,
    callSeq: params.callSeq,
    iterations: 1,
    costEvidence: classified.evidence,
    ...(classified.evidence === "known" && classified.costUsd != null
      ? { costUsd: classified.costUsd }
      : {}),
    ...(params.parentTaskId ? { parentTaskId: params.parentTaskId } : {}),
    ...(params.parentAgentId ? { parentAgentId: params.parentAgentId } : {}),
    ...(params.nowMs != null ? { nowMs: params.nowMs } : {}),
    ...(params.budgetLimits ? { budgetLimits: params.budgetLimits } : {}),
  });
  const active = currentExecutorModelCall();
  if (active && active.modelResponseStatus !== "observed") {
    try {
      noteModelResponse(active, { usage: params.usage, usageSource: "charge_callback" });
    } catch {
      // Noting usage must not change the committed budget result.
    }
  }
  const usage = usageFromUnknown(params.usage);
  const pricing = resolveModelCostConfig({
    provider: params.provider,
    model: params.model,
    config: cfg,
  });
  let associationCompleteness: "complete" | "partial" | "unlinked" = "unlinked";
  try {
    const linked = associateBudgetCharge({
      storeRoot: resolveStoreRoot(cfg, agentId),
      call: active && active.taskId === params.taskId ? active : null,
      budget: charged.budgetCommand,
      record: charged.record,
      scope: params.scope,
      agentId,
      taskId: params.taskId,
      runId: params.runId,
      attemptId: active?.attemptId ?? null,
      usage,
      cost: buildCostColumns({
        usage,
        provider: params.provider,
        model: params.model,
        cost: pricing ?? null,
        businessTaskId: params.taskId,
        runId: params.runId,
        rollupRole: params.parentTaskId ? "child" : "own",
      }),
    });
    associationCompleteness = linked?.completeness ?? "unlinked";
  } catch {
    associationCompleteness = "unlinked";
  }
  const committed =
    charged.budgetCommand.disposition === "applied" && charged.budgetCommand.costStatus === "known"
      ? charged.budgetCommand.committedCostUsd
      : undefined;
  return {
    record: charged.record,
    evidence: classified.evidence,
    ...(committed != null ? { costUsd: committed } : {}),
    closedForBudget: charged.closedForBudget,
    budgetCommand: charged.budgetCommand,
    callId: active?.callId ?? null,
    associationCompleteness,
    modelCallLink:
      active &&
      (charged.budgetCommand.disposition === "applied" ||
        charged.budgetCommand.disposition === "replayed") &&
      typeof charged.budgetCommand.chargeOutcomeVersion === "number"
        ? {
            callId: active.callId,
            evidenceId: active.evidenceId,
            candidateAttemptId: active.attemptId,
            chargeOutcomeVersion: charged.budgetCommand.chargeOutcomeVersion,
            chargeCommitId: charged.budgetCommand.commitId,
            requestDigest: charged.budgetCommand.requestDigest,
            usageFingerprint: usageFingerprint(active.usage),
            commandId: charged.budgetCommand.commandId,
          }
        : null,
  };
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

async function drainGrowthEvolution(
  cfg: OpenBotConfig,
  agentId: string,
  store: DurableTaskOutcomeStore,
): Promise<{ written: boolean; reason: string; processed: number; deferred: number }> {
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
      // W2: skill/mode consume tip+eligibility (not run terminal alone); skill also backfills attempt.
      createSkillQualityHandler(store, { agentId }),
      createModeQualityHandler(store, { agentId }),
      // W4 wrap-up: tip exposure + adopted only → outcome_verified; no agentId pending guess.
      createExperienceVerifiedHandler(store),
    ],
  });
  const drained = await runtime.drain((taskId) => store.loadTask(taskId));
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
export async function drainPendingGrowthEvolution(
  cfg: OpenBotConfig,
  agentId: string,
): Promise<{ written: boolean; reason: string; processed: number; deferred: number }> {
  const store = new DurableTaskOutcomeStore(resolveStoreRoot(cfg, agentId));
  return await drainGrowthEvolution(cfg, agentId, store);
}

/**
 * Production chat-runner hot path into unified TaskOutcome.
 * Evolution publish goes only through OutcomeConsumerRuntime drain (no direct bypass).
 * P1: capabilityOutcome claims persist as capabilityModality; executor_unwired cannot
 * be upgraded to target-modality success; trusted success may mark modality completed
 * (chat via run_completed; image/music only via execution_artifact evidence).
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
    ...(input.entrypoint ? { entrypoint: input.entrypoint } : {}),
  });
  if (!opened.ok) {
    throw new Error(`task-outcome open failed: ${"code" in opened ? opened.code : "unknown"}`);
  }

  const fencingToken = opened.fencingToken || newFencingToken();

  // W3 wrap-up: one production path — ensure tip budget, charge this attempt, stop on exhaust.
  // Reuses budget.ts projection of supervisor D-BUDGET (not a new ledger).
  let tipRecord = opened.record;
  if (!tipRecord.budget) {
    const ensured = service.submit(
      taskId,
      {
        type: "set_budget",
        budget: buildTaskBudgetState({ taskLimits: input.budgetLimits }),
        expectedVersion: tipRecord.outcomeVersion,
        fencingToken,
      },
      { requiredScope: scope, commandId: `budget-ensure:${taskId}` },
    );
    if (!ensured.ok) {
      throw new Error(`task-outcome set_budget failed: ${ensured.code}`);
    }
    tipRecord = ensured.record;
  } else if (input.budgetLimits) {
    // Tighten-only replace when caller passes limits and tip already has budget.
    const tightened = buildTaskBudgetState({
      ceiling: {
        maxIterations: tipRecord.budget.maxIterations,
        maxCostUsd: tipRecord.budget.maxCostUsd,
        maxDurationMinutes: tipRecord.budget.maxDurationMinutes,
      },
      taskLimits: input.budgetLimits,
    });
    const replaced = service.submit(
      taskId,
      {
        type: "set_budget",
        budget: {
          ...tightened,
          spentCostUsd: tipRecord.budget.spentCostUsd,
          iterationCount: tipRecord.budget.iterationCount,
          ...(tipRecord.budget.unknownCostCharges != null
            ? { unknownCostCharges: tipRecord.budget.unknownCostCharges }
            : {}),
          ...(tipRecord.budget.knownZeroCostCharges != null
            ? { knownZeroCostCharges: tipRecord.budget.knownZeroCostCharges }
            : {}),
          ...(tipRecord.budget.childAttributedCostUsd != null
            ? { childAttributedCostUsd: tipRecord.budget.childAttributedCostUsd }
            : {}),
          ...(tipRecord.budget.childAttributedIterations != null
            ? { childAttributedIterations: tipRecord.budget.childAttributedIterations }
            : {}),
          ...(tipRecord.budget.startedAtMs != null
            ? { startedAtMs: tipRecord.budget.startedAtMs }
            : {}),
        },
        expectedVersion: tipRecord.outcomeVersion,
        fencingToken,
      },
      { requiredScope: scope, commandId: `budget-tighten:${taskId}` },
    );
    if (replaced.ok) {
      tipRecord = replaced.record;
    }
  }

  // Residual: merge explicit adoptedAssetIds onto tip exposure (no invent / no inject copy).
  if (input.adoptedAssetIds && input.adoptedAssetIds.length > 0) {
    const merged = mergeAdoptedIntoExperienceExposure(
      tipRecord.experienceExposure,
      input.adoptedAssetIds,
    );
    if (merged) {
      const adoptedSubmit = service.submit(
        taskId,
        {
          type: "set_experience_exposure",
          experienceExposure: merged,
          expectedVersion: tipRecord.outcomeVersion,
          fencingToken,
        },
        { requiredScope: scope, commandId: `adopt-merge:${taskId}:${input.runId}` },
      );
      if (adoptedSubmit.ok) {
        tipRecord = adoptedSubmit.record;
      }
    }
  }

  const attemptId = `att:${input.runId}`;
  const runStatus = input.success ? ("succeeded" as const) : ("failed" as const);
  const attemptStatus = input.success ? ("succeeded" as const) : ("failed" as const);

  let res = chat.recordAttempt(
    taskId,
    tipRecord.outcomeVersion,
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

  // Budget: mid-run pre-gate may already have charged; closeout only accumulates when asked.
  if (res.record.budget && res.record.lifecycle !== "closed") {
    const costUsd =
      typeof input.costUsd === "number" && Number.isFinite(input.costUsd) && input.costUsd > 0
        ? input.costUsd
        : input.costEvidence === "known" && typeof input.costUsd === "number" && input.costUsd === 0
          ? 0
          : undefined;
    const costEvidence =
      input.costEvidence ?? (costUsd != null && costUsd > 0 ? ("known" as const) : undefined);
    if (!input.skipBudgetCharge) {
      const spent = service.submit(
        taskId,
        {
          type: "accumulate_budget_spend",
          iterations: 1,
          ...(costUsd != null ? { costUsd } : {}),
          ...(costEvidence ? { costEvidence } : {}),
          expectedVersion: res.record.outcomeVersion,
          fencingToken,
          nowMs: Date.now(),
        },
        { requiredScope: scope, commandId: `budget-spend:${taskId}:${input.runId}` },
      );
      if (!spent.ok) {
        throw new Error(`task-outcome accumulate_budget_spend failed: ${spent.code}`);
      }
      res = spent;
    }
    const exhaustion =
      res.record.budget != null
        ? assessTaskBudgetExhaustion(res.record.budget)
        : applySpendAndAssess(buildTaskBudgetState({}), {
            iterations: 1,
            ...(costUsd != null ? { costUsd } : {}),
          }).exhaustion;
    if (exhaustion && res.record.lifecycle !== "closed") {
      const closed = chat.failClosed(taskId, res.record.outcomeVersion, "budget_exceeded", {
        fencingToken,
        reasonDetail: exhaustion.detail,
        scope,
        commandId: `budget-exceeded:${taskId}:${input.runId}`,
      });
      if (!closed.ok) {
        throw new Error(`task-outcome fail_closed budget_exceeded failed: ${closed.code}`);
      }
      const evolution = await drainGrowthEvolution(cfg, agentId, store);
      linkRunnerFinalEvidence(
        cfg,
        agentId,
        scope,
        taskId,
        input.runId,
        attemptId,
        closed.record,
        input.modelCallLink,
        input.modelCallLinks,
      );
      return { record: closed.record, evolution };
    }
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
    // evidence so formal set_acceptance can pass. Artifact-backed modalities
    // (image/music) require a real tool artifact path; chat may use run_completed.
    // Blocked statuses (executor_unwired / …) refuse.
    if (
      input.success &&
      record.capabilityModality &&
      canMarkCompletedFromTrustedRun(record.capabilityModality)
    ) {
      const evidence = resolveTrustedRunModalityCompletionEvidence({
        targetModality: record.capabilityModality.targetModality,
        success: input.success,
        runId: input.runId,
        explicitEvidence: input.modalityCompletionEvidence,
        artifacts: input.modalityArtifacts,
      });
      if (evidence) {
        const markRes = chat.markTargetModalityCompleted(
          taskId,
          record.outcomeVersion,
          fencingToken,
          evidence,
          { scope, commandId: `mark-modality:${taskId}:${input.runId}` },
        );
        if (markRes.ok) {
          record = markRes.record;
        }
      }
    }
  }

  const evolution = await drainGrowthEvolution(cfg, agentId, store);
  linkRunnerFinalEvidence(
    cfg,
    agentId,
    scope,
    taskId,
    input.runId,
    attemptId,
    record,
    input.modelCallLink,
    input.modelCallLinks,
  );
  return { record, evolution };
}

function linkRunnerFinalEvidence(
  cfg: OpenBotConfig,
  agentId: string,
  scope: TrustedScope,
  taskId: string,
  runId: string,
  taskAttemptId: string,
  record: TaskOutcomeRecord,
  link: ModelCallCloseoutLink | null | undefined,
  links: ModelCallCloseoutLink[] | undefined,
): void {
  const all = dedupeLinks([...(links ?? []), ...(link ? [link] : [])]);
  try {
    const storeRoot = resolveStoreRoot(cfg, agentId);
    if (all.length === 0) {
      publishFinalEvidenceLink({
        storeRoot,
        call: null,
        scope,
        agentId,
        taskId,
        runId,
        candidateAttemptId: null,
        taskAttemptId,
        chargeOutcomeVersion: null,
        finalOutcomeVersion: record.outcomeVersion,
        recordRuns: record.runs.map((run) => ({ runId: run.runId, attemptIds: run.attemptIds })),
        recordAttempts: record.attempts.map((attempt) => attempt.attemptId),
        receiptReturned: true,
        snapshotFingerprint: snapshotIdentityFingerprint(record),
      });
      return;
    }
    for (const item of all) {
      const call =
        getModelCall(item.callId) ??
        readCallFiles(storeRoot).rows.find((row) => row.callId === item.callId) ??
        null;
      publishFinalEvidenceLink({
        storeRoot,
        call,
        scope,
        agentId,
        taskId,
        runId,
        candidateAttemptId: item.candidateAttemptId,
        taskAttemptId,
        chargeOutcomeVersion: item.chargeOutcomeVersion,
        finalOutcomeVersion: record.outcomeVersion,
        recordRuns: record.runs.map((run) => ({ runId: run.runId, attemptIds: run.attemptIds })),
        recordAttempts: record.attempts.map((attempt) => attempt.attemptId),
        receiptReturned: true,
        usageFingerprint: item.usageFingerprint,
        snapshotFingerprint: snapshotIdentityFingerprint(record),
        budgetCommandId: item.commandId,
        chargeCommitId: item.chargeCommitId,
        requestDigest: item.requestDigest,
      });
    }
  } catch {
    // Final evidence must not change the task receipt.
  }
}

function dedupeLinks(links: ModelCallCloseoutLink[]): ModelCallCloseoutLink[] {
  const seen = new Set<string>();
  const out: ModelCallCloseoutLink[] = [];
  for (const link of links) {
    if (!link.callId || seen.has(link.callId)) {
      continue;
    }
    seen.add(link.callId);
    out.push(link);
  }
  return out;
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

  const evolution = await drainGrowthEvolution(cfg, agentId, store);
  return { record: res.record, evolution };
}
