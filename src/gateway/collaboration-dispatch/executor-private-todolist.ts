/**
 * P2 — Executor-private Todolist + plan gate (COLLAB-EXECUTION-SYSTEM-FINAL §3.3).
 *
 * Todolist after 主答 confirm = **executor-private**, NOT a group-shared board sub-record.
 * Shared board remains the group contract (Goal/Acceptance/Constraints/Due).
 *
 * Protocol: proposeTodolist → confirmTodolist / reviseTodolist (主答).
 * Plan gate: without confirm, markBoardItemInProgress (delivery progress) is refused.
 * Execution inject: task bag = board summary + group context pointer + owner current step.
 *
 * Transition OK: structured message protocol + durable private log; free chat ≠ Todolist.
 * signalInsight → wake 主答 via existing Wake Contract (flag-off = best-effort no-op).
 *
 * Does not open LIVE flags, claimContract allowlist, Floor, P3 heartbeat, or P4 self_advance.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  actorMatchesAuthorizedConfirmer,
  deliveryActorIdsEqual,
} from "../collaboration-learning/delivery-actor-binding.js";
import {
  boardItemGoal,
  isCollabTaskClaimContractEnabled,
  loadBoardClaimItem,
  type GroupBoardClaimItem,
} from "./claim-contract.js";
import { appendJsonlDurable, withRoundLock } from "./round-store-io.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import { assertCollaborationRuntimeWritable } from "./runtime-namespace.js";
import { noteUnattendedStaleConfirmation } from "./single-group-unattended.js";
import { recordWakeEventBestEffort } from "./wake-contract.js";

const todolistLog = createSubsystemLogger("gateway/executor-todolist");

export type TodolistStepStatus = "pending" | "active" | "done" | "skipped";

export type TodolistStatus = "proposed" | "confirmed" | "revise_requested" | "superseded";

export type TodolistStep = Readonly<{
  stepId: string;
  title: string;
  detail?: string;
  status: TodolistStepStatus;
}>;

/**
 * Executor-private plan bound to a board item. Not broadcast to the whole group.
 * Readable by owner + lead/主答 (+ optional coordinator).
 */
export type ExecutorPrivateTodolist = Readonly<{
  todolistId: string;
  boardItemId: string;
  taskId: string;
  groupId: string;
  ownerMemberId: string;
  status: TodolistStatus;
  steps: readonly TodolistStep[];
  proposedBy: string;
  proposedAt: number;
  confirmedBy?: string;
  confirmedAt?: number;
  revisedBy?: string;
  revisedAt?: number;
  reviseReason?: string;
  version: number;
  /** Always executor_private — never a group-shared board sub-record. */
  visibility: "executor_private";
}>;

export type TodolistResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; message: string };

export type TodolistOptions = {
  cfg?: OpenBotConfig;
  nowMs?: number;
  /**
   * Server-resolved 主答/lead ids (board `publishedBy`, active membership).
   * Empty is fail-closed: only an explicit coordinatorBotId may confirm.
   * Never pass caller-supplied request params here.
   */
  authorizedConfirmerIds?: readonly string[];
  /** Optional coordinator bot that may confirm/revise / read. */
  coordinatorBotId?: string | null;
  /**
   * Handshake-stamped session subjects (platformUserId / user email / membership).
   * Used only to treat Owner email as the same person as authorized `human:<uuid>`.
   */
  sessionActorSubjects?: readonly string[];
};

type TodolistLogLine = {
  kind: "executor_private_todolist";
  at: number;
  todolist: ExecutorPrivateTodolist;
};

export type ProposeTodolistInput = {
  boardItemId: string;
  taskId: string;
  groupId: string;
  ownerMemberId: string;
  steps: readonly { title: string; detail?: string; stepId?: string }[];
  proposedBy?: string;
  todolistId?: string;
};

export type ConfirmTodolistInput = {
  taskId: string;
  todolistId: string;
  confirmerId: string;
  /**
   * Plan version the caller saw. Omitted confirms are allowed only while this
   * id's steps and version are still the original proposal. After a content
   * change, omit / stale / mismatched versions do not write.
   */
  expectedVersion?: number;
};

export type ReviseTodolistInput = {
  taskId: string;
  todolistId: string;
  reviserId: string;
  reason: string;
  /** Optional replacement steps; when set, status stays revise_requested until re-confirm. */
  steps?: readonly { title: string; detail?: string; stepId?: string }[];
  /** Same binding as confirm. A stale card must not rewrite a newer plan. */
  expectedVersion?: number;
};

export type SignalInsightInput = {
  groupId: string;
  taskId: string;
  boardItemId: string;
  fromMemberId: string;
  /** 主答 / lead targets to wake. */
  toLeadIds: readonly string[];
  insightSummary: string;
};

export type ExecutionTaskBag = Readonly<{
  boardSummary: Readonly<{
    itemId: string;
    taskId: string;
    groupId: string;
    goal: string;
    acceptanceCriteria: readonly string[];
    constraints?: readonly string[];
    dueAtMs?: number;
    status: string;
    claimantId?: string;
  }>;
  groupContextPointer: Readonly<{
    groupId: string;
    /** Relative hint only — not a full transcript dump. */
    transcriptHint: string;
    note: string;
  }>;
  todolistCurrentStep: Readonly<{
    todolistId: string;
    version: number;
    status: TodolistStatus;
    stepId: string;
    title: string;
    detail?: string;
    stepIndex: number;
    totalSteps: number;
  }> | null;
  planGate: Readonly<{
    confirmed: boolean;
    todolistStatus: TodolistStatus | "missing";
  }>;
}>;

function fail(reason: string, message: string): TodolistResult<never> {
  return { ok: false, reason, message };
}

function flagOff<T>(): TodolistResult<T> {
  return fail(
    "flag_off",
    "collaboration.task.claimContract is off; ExecutorPrivateTodolist does not write",
  );
}

function nowOf(options?: TodolistOptions): number {
  return options?.nowMs ?? Date.now();
}

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function safeStem(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return null;
  }
  return encodeURIComponent(trimmed);
}

/** Free-chat / oral plans are never a Todolist fact. */
export function freeChatIsTodolist(): false {
  return false;
}

/** Todolist is never a group-shared board sub-record. */
export function todolistIsGroupSharedBoardSubrecord(): false {
  return false;
}

/** Private store under `<ns>/executor-todolists` (not board-claims). */
export function executorTodolistsDir(authority: RuntimeAuthority): string {
  return path.join(authority.namespace.root, "executor-todolists");
}

export function executorTodolistLogPath(dir: string, taskId: string): string {
  const stem = safeStem(taskId);
  if (!stem) {
    throw new Error("executor todolist taskId is not a safe id");
  }
  return path.join(dir, `${stem}.jsonl`);
}

function isStepStatus(value: unknown): value is TodolistStepStatus {
  return value === "pending" || value === "active" || value === "done" || value === "skipped";
}

function isTodolistStatus(value: unknown): value is TodolistStatus {
  return (
    value === "proposed" ||
    value === "confirmed" ||
    value === "revise_requested" ||
    value === "superseded"
  );
}

function isTodolist(value: unknown): value is ExecutorPrivateTodolist {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as ExecutorPrivateTodolist;
  return (
    typeof item.todolistId === "string" &&
    item.todolistId.trim().length > 0 &&
    typeof item.boardItemId === "string" &&
    typeof item.taskId === "string" &&
    typeof item.groupId === "string" &&
    typeof item.ownerMemberId === "string" &&
    isTodolistStatus(item.status) &&
    Array.isArray(item.steps) &&
    item.steps.every(
      (step) =>
        step &&
        typeof step === "object" &&
        typeof (step as TodolistStep).stepId === "string" &&
        typeof (step as TodolistStep).title === "string" &&
        isStepStatus((step as TodolistStep).status),
    ) &&
    item.visibility === "executor_private" &&
    typeof item.version === "number"
  );
}

async function readLog(logPath: string): Promise<TodolistLogLine[]> {
  let raw: string;
  try {
    raw = await fs.readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const lines: TodolistLogLine[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as TodolistLogLine;
      if (parsed?.kind === "executor_private_todolist" && isTodolist(parsed.todolist)) {
        lines.push(parsed);
      }
    } catch {
      // skip corrupt
    }
  }
  return lines;
}

function latestById(lines: TodolistLogLine[], todolistId: string): ExecutorPrivateTodolist | null {
  let latest: ExecutorPrivateTodolist | null = null;
  for (const line of lines) {
    if (line.todolist.todolistId === todolistId) {
      latest = line.todolist;
    }
  }
  return latest;
}

const TODOLIST_VERSION_REFUSAL_COPY = {
  stale_version: "旧版本已失效",
  version_mismatch: "计划版本不匹配",
  card_invalid: "旧版本已失效",
  expected_version_required: "确认必须绑定计划版本",
  confirmation_consumed: "该确认已生效",
} as const;

type TodolistVersionRefusal = keyof typeof TODOLIST_VERSION_REFUSAL_COPY;

function stepFingerprint(steps: readonly TodolistStep[]): string {
  return steps
    .map((step) => [step.stepId, step.title, step.detail ?? "", step.status].join("\u0000"))
    .join("\u0001");
}

function rowsForId(lines: TodolistLogLine[], todolistId: string): ExecutorPrivateTodolist[] {
  const rows: ExecutorPrivateTodolist[] = [];
  for (const line of lines) {
    if (line.todolist.todolistId === todolistId) {
      rows.push(line.todolist);
    }
  }
  return rows;
}

/** True when a later line changed this id's version or step content. Status-only lines do not count. */
function planContentChanged(lines: TodolistLogLine[], todolistId: string): boolean {
  const rows = rowsForId(lines, todolistId);
  const first = rows[0];
  const latest = rows[rows.length - 1];
  if (!first || !latest) {
    return false;
  }
  return (
    latest.version !== first.version ||
    stepFingerprint(latest.steps) !== stepFingerprint(first.steps)
  );
}

function refuseVersionGate(params: {
  op: "confirm" | "revise";
  reason: TodolistVersionRefusal;
  taskId: string;
  todolistId: string;
  status?: string;
  expectedVersion: number | null;
  actualVersion: number | null;
}): TodolistResult<never> {
  // Ids and version numbers only. Step text stays out of logs and caller messages.
  todolistLog.warn("todolist version gate refused", {
    op: params.op,
    reason: params.reason,
    taskId: params.taskId,
    todolistId: params.todolistId,
    status: params.status ?? null,
    expectedVersion: params.expectedVersion,
    actualVersion: params.actualVersion,
  });
  return fail(params.reason, `${params.reason}: ${TODOLIST_VERSION_REFUSAL_COPY[params.reason]}`);
}

function bindPlanVersion(params: {
  op: "confirm" | "revise";
  lines: TodolistLogLine[];
  current: ExecutorPrivateTodolist;
  expectedVersion?: number;
}): TodolistResult<never> | null {
  const actual = params.current.version;
  const meta = {
    op: params.op,
    taskId: params.current.taskId,
    todolistId: params.current.todolistId,
    status: params.current.status,
    actualVersion: actual,
  };
  if (params.expectedVersion == null) {
    if (planContentChanged(params.lines, params.current.todolistId)) {
      return refuseVersionGate({
        ...meta,
        reason: "expected_version_required",
        expectedVersion: null,
      });
    }
    return null;
  }
  const expected = params.expectedVersion;
  if (Number.isInteger(expected) && expected >= 1 && expected < actual) {
    return refuseVersionGate({ ...meta, reason: "stale_version", expectedVersion: expected });
  }
  if (!Number.isInteger(expected) || expected !== actual) {
    return refuseVersionGate({
      ...meta,
      reason: "version_mismatch",
      expectedVersion: Number.isFinite(expected) ? expected : null,
    });
  }
  return null;
}

/**
 * Read-check-append under the task lock so concurrent confirm/revise/propose
 * cannot apply a decision against a row that just changed.
 * Refusals append nothing.
 */
async function commitTodolistLines(
  authority: RuntimeAuthority,
  taskId: string,
  options: TodolistOptions | undefined,
  fn: (lines: TodolistLogLine[]) => {
    result: TodolistResult<ExecutorPrivateTodolist>;
    appends?: ExecutorPrivateTodolist[];
  },
): Promise<TodolistResult<ExecutorPrivateTodolist>> {
  const cfg = options?.cfg;
  assertCollaborationRuntimeWritable(executorTodolistsDir(authority), cfg);
  const stem = safeStem(taskId);
  if (!stem) {
    return fail("invalid_input", "taskId is not a safe id");
  }
  const dir = executorTodolistsDir(authority);
  const logPath = executorTodolistLogPath(dir, taskId);
  return withRoundLock(dir, stem, async () => {
    await fs.mkdir(dir, { recursive: true });
    const lines = await readLog(logPath);
    const outcome = fn(lines);
    if (outcome.result.ok && outcome.appends && outcome.appends.length > 0) {
      const at = nowOf(options);
      for (const todolist of outcome.appends) {
        await appendJsonlDurable(logPath, {
          kind: "executor_private_todolist",
          at,
          todolist,
        } satisfies TodolistLogLine);
      }
    }
    return outcome.result;
  });
}

function normalizeSteps(
  steps: readonly { title: string; detail?: string; stepId?: string }[],
): TodolistResult<TodolistStep[]> {
  if (!steps || steps.length === 0) {
    return fail("invalid_input", "proposeTodolist requires at least one step");
  }
  const out: TodolistStep[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const title = compact(steps[i]?.title);
    if (!title) {
      return fail("invalid_input", `step[${i}] title is required`);
    }
    const detail = compact(steps[i]?.detail);
    const stepId = compact(steps[i]?.stepId) || `step-${i + 1}`;
    out.push({
      stepId,
      title,
      ...(detail ? { detail } : {}),
      status: i === 0 ? "active" : "pending",
    });
  }
  return { ok: true, value: out };
}

export function canReadExecutorTodolist(params: {
  viewerId: string;
  todolist: ExecutorPrivateTodolist;
  authorizedConfirmerIds?: readonly string[];
  coordinatorBotId?: string | null;
}): boolean {
  const viewer = compact(params.viewerId);
  if (!viewer) {
    return false;
  }
  if (viewer === params.todolist.ownerMemberId) {
    return true;
  }
  const coordinator = compact(params.coordinatorBotId ?? undefined);
  if (coordinator && viewer === coordinator) {
    return true;
  }
  for (const id of params.authorizedConfirmerIds ?? []) {
    if (compact(id) === viewer) {
      return true;
    }
  }
  return false;
}

function isAuthorizedConfirmer(
  actorId: string,
  options: TodolistOptions | undefined,
  ownerMemberId: string,
): boolean {
  const actor = compact(actorId);
  if (!actor) {
    return false;
  }
  const owner = compact(ownerMemberId);
  const coordinator = compact(options?.coordinatorBotId ?? undefined);
  const list = (options?.authorizedConfirmerIds ?? []).map((id) => compact(id)).filter(Boolean);
  const sessionSubjects = options?.sessionActorSubjects;
  const matchesLead = (): boolean =>
    actorMatchesAuthorizedConfirmer({
      actor,
      authorizedConfirmerIds: list,
      sessionSubjects,
    });
  const matchesCoordinator = (): boolean =>
    Boolean(coordinator) &&
    actorMatchesAuthorizedConfirmer({
      actor,
      authorizedConfirmerIds: [coordinator],
      sessionSubjects,
    });
  // Owner may confirm only when explicitly listed as lead/coordinator (rare).
  // Compare with human:/bot: equivalence but do not use session email aliases to
  // treat a different principal as the todolist owner.
  if (deliveryActorIdsEqual(actor, owner)) {
    return matchesLead() || matchesCoordinator();
  }
  if (matchesCoordinator()) {
    return true;
  }
  if (list.length > 0) {
    return matchesLead();
  }
  // Empty trusted list must not promote an arbitrary non-owner into 主答.
  return false;
}

export async function loadExecutorTodolist(
  authority: RuntimeAuthority,
  params: { taskId: string; todolistId: string },
): Promise<ExecutorPrivateTodolist | null> {
  const taskId = compact(params.taskId);
  const todolistId = compact(params.todolistId);
  if (!safeStem(taskId) || !todolistId) {
    return null;
  }
  const lines = await readLog(executorTodolistLogPath(executorTodolistsDir(authority), taskId));
  return latestById(lines, todolistId);
}

export async function listExecutorTodolists(
  authority: RuntimeAuthority,
  params: { taskId: string; boardItemId?: string; ownerMemberId?: string },
): Promise<ExecutorPrivateTodolist[]> {
  const taskId = compact(params.taskId);
  if (!safeStem(taskId)) {
    return [];
  }
  const lines = await readLog(executorTodolistLogPath(executorTodolistsDir(authority), taskId));
  const byId = new Map<string, ExecutorPrivateTodolist>();
  for (const line of lines) {
    byId.set(line.todolist.todolistId, line.todolist);
  }
  let items = [...byId.values()].filter((item) => item.status !== "superseded");
  const boardItemId = compact(params.boardItemId);
  if (boardItemId) {
    items = items.filter((item) => item.boardItemId === boardItemId);
  }
  const ownerMemberId = compact(params.ownerMemberId);
  if (ownerMemberId) {
    items = items.filter((item) => item.ownerMemberId === ownerMemberId);
  }
  return items;
}

/**
 * Latest non-superseded todolist for board item + owner (plan-gate lookup).
 */
export async function loadLatestOwnerTodolistForBoardItem(
  authority: RuntimeAuthority,
  params: { taskId: string; boardItemId: string; ownerMemberId: string },
): Promise<ExecutorPrivateTodolist | null> {
  const items = await listExecutorTodolists(authority, params);
  if (items.length === 0) {
    return null;
  }
  items.sort((a, b) => b.version - a.version || b.proposedAt - a.proposedAt);
  return items[0] ?? null;
}

export function isTodolistConfirmedForDelivery(
  todolist: ExecutorPrivateTodolist | null | undefined,
): boolean {
  return todolist?.status === "confirmed";
}

/**
 * Plan gate helper for markInProgress: confirmed private todolist required.
 */
export async function assertPlanGateAllowsDeliveryProgress(
  authority: RuntimeAuthority,
  params: { taskId: string; boardItemId: string; ownerMemberId: string },
): Promise<TodolistResult<ExecutorPrivateTodolist>> {
  const todolist = await loadLatestOwnerTodolistForBoardItem(authority, params);
  if (!todolist) {
    return fail(
      "plan_gate_unconfirmed",
      "no ExecutorPrivateTodolist for this board item; proposeTodolist → confirmTodolist before markInProgress",
    );
  }
  if (!isTodolistConfirmedForDelivery(todolist)) {
    return fail(
      "plan_gate_unconfirmed",
      `todolist status is ${todolist.status}; confirmTodolist required before markInProgress delivery progress`,
    );
  }
  return { ok: true, value: todolist };
}

export async function proposeTodolist(
  authority: RuntimeAuthority,
  input: ProposeTodolistInput,
  options?: TodolistOptions,
): Promise<TodolistResult<ExecutorPrivateTodolist>> {
  const cfg = options?.cfg;
  const groupId = compact(input.groupId) || compact(authority.groupId);
  if (!isCollabTaskClaimContractEnabled(cfg, groupId, authority.tenantId)) {
    return flagOff();
  }
  const taskId = compact(input.taskId);
  const boardItemId = compact(input.boardItemId);
  const ownerMemberId = compact(input.ownerMemberId);
  if (!taskId || !boardItemId || !ownerMemberId) {
    return fail("invalid_input", "proposeTodolist requires taskId, boardItemId, ownerMemberId");
  }
  if (!safeStem(taskId)) {
    return fail("invalid_input", "taskId is not a safe id");
  }
  const proposedBy = compact(input.proposedBy) || ownerMemberId;
  if (proposedBy !== ownerMemberId) {
    return fail("actor_not_owner", "only the executor owner may propose their private Todolist");
  }
  const steps = normalizeSteps(input.steps);
  if (!steps.ok) {
    return steps;
  }

  // Supersede any prior active list for same board+owner inside one lock.
  return commitTodolistLines(authority, taskId, options, (lines) => {
    const byId = new Map<string, ExecutorPrivateTodolist>();
    for (const line of lines) {
      byId.set(line.todolist.todolistId, line.todolist);
    }
    let version = 1;
    const appends: ExecutorPrivateTodolist[] = [];
    for (const prev of byId.values()) {
      if (prev.status === "superseded") {
        continue;
      }
      if (prev.boardItemId !== boardItemId || prev.ownerMemberId !== ownerMemberId) {
        continue;
      }
      version = Math.max(version, prev.version + 1);
      appends.push({ ...prev, status: "superseded" });
    }
    const todolist: ExecutorPrivateTodolist = {
      todolistId: compact(input.todolistId) || randomUUID(),
      boardItemId,
      taskId,
      groupId,
      ownerMemberId,
      status: "proposed",
      steps: steps.value,
      proposedBy,
      proposedAt: nowOf(options),
      version,
      visibility: "executor_private",
    };
    appends.push(todolist);
    return { result: { ok: true, value: todolist }, appends };
  });
}

export async function confirmTodolist(
  authority: RuntimeAuthority,
  input: ConfirmTodolistInput,
  options?: TodolistOptions,
): Promise<TodolistResult<ExecutorPrivateTodolist>> {
  const cfg = options?.cfg;
  if (!isCollabTaskClaimContractEnabled(cfg, authority.groupId, authority.tenantId)) {
    return flagOff();
  }
  const taskId = compact(input.taskId);
  const todolistId = compact(input.todolistId);
  const confirmerId = compact(input.confirmerId);
  if (!taskId || !todolistId || !confirmerId) {
    return fail("invalid_input", "confirmTodolist requires taskId, todolistId, confirmerId");
  }
  if (!safeStem(taskId)) {
    return fail("not_found", `todolist not found: ${todolistId}`);
  }
  const result = await commitTodolistLines(authority, taskId, options, (lines) => {
    const current = latestById(lines, todolistId);
    if (!current) {
      return { result: fail("not_found", `todolist not found: ${todolistId}`) };
    }
    const gateMeta = {
      op: "confirm" as const,
      taskId,
      todolistId,
      status: current.status,
      expectedVersion: input.expectedVersion ?? null,
      actualVersion: current.version,
    };
    if (current.status === "superseded") {
      return { result: refuseVersionGate({ ...gateMeta, reason: "card_invalid" }) };
    }
    // Version before status so an older card is not reported as a generic status error.
    const versionGate = bindPlanVersion({
      op: "confirm",
      lines,
      current,
      expectedVersion: input.expectedVersion,
    });
    if (versionGate) {
      return { result: versionGate };
    }
    if (current.status === "confirmed") {
      return { result: refuseVersionGate({ ...gateMeta, reason: "confirmation_consumed" }) };
    }
    if (!isAuthorizedConfirmer(confirmerId, options, current.ownerMemberId)) {
      const allowed = [
        ...(options?.authorizedConfirmerIds ?? []).map((id) => id.trim()).filter(Boolean),
        ...(options?.coordinatorBotId?.trim() ? [options.coordinatorBotId.trim()] : []),
      ];
      const allowedHint =
        allowed.length > 0 ? `; actor=${confirmerId}; allowed=${allowed.join(",")}` : "";
      return {
        result: fail(
          "actor_not_confirmer",
          `confirmTodolist requires 主答/lead or coordinator (not executor self-confirm)${allowedHint}`,
        ),
      };
    }
    const next: ExecutorPrivateTodolist = {
      ...current,
      status: "confirmed",
      confirmedBy: confirmerId,
      confirmedAt: nowOf(options),
      reviseReason: undefined,
    };
    return { result: { ok: true, value: next }, appends: [next] };
  });
  if (!result.ok) {
    await noteUnattendedStaleConfirmation(authority, {
      cfg,
      reason: result.reason,
      taskId,
      todolistId,
      nowMs: options?.nowMs,
    });
  }
  return result;
}

export async function reviseTodolist(
  authority: RuntimeAuthority,
  input: ReviseTodolistInput,
  options?: TodolistOptions,
): Promise<TodolistResult<ExecutorPrivateTodolist>> {
  const cfg = options?.cfg;
  if (!isCollabTaskClaimContractEnabled(cfg, authority.groupId, authority.tenantId)) {
    return flagOff();
  }
  const taskId = compact(input.taskId);
  const todolistId = compact(input.todolistId);
  const reviserId = compact(input.reviserId);
  const reason = compact(input.reason);
  if (!taskId || !todolistId || !reviserId) {
    return fail("invalid_input", "reviseTodolist requires taskId, todolistId, reviserId");
  }
  if (!reason) {
    return fail("invalid_input", "reviseTodolist requires reason");
  }
  if (!safeStem(taskId)) {
    return fail("not_found", `todolist not found: ${todolistId}`);
  }
  let replacementSteps: TodolistStep[] | null = null;
  if (input.steps) {
    const normalized = normalizeSteps(input.steps);
    if (!normalized.ok) {
      return normalized;
    }
    replacementSteps = normalized.value;
  }
  return commitTodolistLines(authority, taskId, options, (lines) => {
    const current = latestById(lines, todolistId);
    if (!current) {
      return { result: fail("not_found", `todolist not found: ${todolistId}`) };
    }
    const gateMeta = {
      op: "revise" as const,
      taskId,
      todolistId,
      status: current.status,
      expectedVersion: input.expectedVersion ?? null,
      actualVersion: current.version,
    };
    if (current.status === "superseded") {
      return { result: refuseVersionGate({ ...gateMeta, reason: "card_invalid" }) };
    }
    const versionGate = bindPlanVersion({
      op: "revise",
      lines,
      current,
      expectedVersion: input.expectedVersion,
    });
    if (versionGate) {
      return { result: versionGate };
    }
    if (current.status !== "proposed" && current.status !== "confirmed") {
      return {
        result: fail(
          "invalid_status",
          `todolist status is ${current.status}; expected proposed|confirmed`,
        ),
      };
    }
    if (!isAuthorizedConfirmer(reviserId, options, current.ownerMemberId)) {
      return {
        result: fail("actor_not_confirmer", "reviseTodolist requires 主答/lead or coordinator"),
      };
    }
    const steps = replacementSteps ?? current.steps;
    const stepsChanged = stepFingerprint(steps) !== stepFingerprint(current.steps);
    const next: ExecutorPrivateTodolist = {
      ...current,
      status: "revise_requested",
      steps,
      version: stepsChanged ? current.version + 1 : current.version,
      revisedBy: reviserId,
      revisedAt: nowOf(options),
      reviseReason: reason,
      confirmedBy: undefined,
      confirmedAt: undefined,
    };
    return { result: { ok: true, value: next }, appends: [next] };
  });
}

/**
 * Current step for execution inject (first active, else first pending).
 */
export function resolveCurrentTodolistStep(
  todolist: ExecutorPrivateTodolist,
): { step: TodolistStep; stepIndex: number } | null {
  const activeIdx = todolist.steps.findIndex((s) => s.status === "active");
  if (activeIdx >= 0) {
    return { step: todolist.steps[activeIdx], stepIndex: activeIdx };
  }
  const pendingIdx = todolist.steps.findIndex((s) => s.status === "pending");
  if (pendingIdx >= 0) {
    return { step: todolist.steps[pendingIdx], stepIndex: pendingIdx };
  }
  return null;
}

/**
 * P2.3 execution inject — 三件套: board summary + group context pointer + owner Todolist step.
 */
export function buildExecutionTaskBag(params: {
  boardItem: GroupBoardClaimItem;
  todolist: ExecutorPrivateTodolist | null;
  groupContextPointer?: { transcriptHint?: string; note?: string };
}): ExecutionTaskBag {
  const board = params.boardItem;
  const todolist = params.todolist;
  const current = todolist ? resolveCurrentTodolistStep(todolist) : null;
  return {
    boardSummary: {
      itemId: board.itemId,
      taskId: board.taskId,
      groupId: board.groupId,
      goal: boardItemGoal(board),
      acceptanceCriteria: board.acceptanceCriteria,
      ...(board.constraints ? { constraints: board.constraints } : {}),
      ...(board.dueAtMs != null ? { dueAtMs: board.dueAtMs } : {}),
      status: board.status,
      ...(board.claimantId ? { claimantId: board.claimantId } : {}),
    },
    groupContextPointer: {
      groupId: board.groupId,
      transcriptHint:
        params.groupContextPointer?.transcriptHint?.trim() ||
        "runtime/transcript.jsonl (GROUP_PUBLIC; read recent member+human messages)",
      note:
        params.groupContextPointer?.note?.trim() ||
        "Pointer only — do not treat chat memory as task state; board + Todolist are authoritative.",
    },
    todolistCurrentStep:
      todolist && current
        ? {
            todolistId: todolist.todolistId,
            version: todolist.version,
            status: todolist.status,
            stepId: current.step.stepId,
            title: current.step.title,
            ...(current.step.detail ? { detail: current.step.detail } : {}),
            stepIndex: current.stepIndex,
            totalSteps: todolist.steps.length,
          }
        : null,
    planGate: {
      confirmed: isTodolistConfirmedForDelivery(todolist),
      todolistStatus: todolist?.status ?? "missing",
    },
  };
}

/**
 * Convenience: load board + owner todolist and build task bag.
 *
 * S2 ACL: when `viewerId` is set, refuse cross-executor bag reads unless viewer
 * is owner / authorized confirmer / coordinator (no 串读).
 * When `requireDeliveryComplete` is true, also assert 三件套 + confirmed plan.
 */
export async function buildExecutionTaskBagForActor(
  authority: RuntimeAuthority,
  params: {
    taskId: string;
    boardItemId: string;
    ownerMemberId: string;
    groupContextPointer?: { transcriptHint?: string; note?: string };
    /** S2: caller identity for private Todolist ACL. */
    viewerId?: string;
    authorizedConfirmerIds?: readonly string[];
    coordinatorBotId?: string | null;
    /** S2: fail closed unless board+context+confirmed step present. */
    requireDeliveryComplete?: boolean;
  },
): Promise<TodolistResult<ExecutionTaskBag>> {
  const board = await loadBoardClaimItem(authority, {
    taskId: params.taskId,
    itemId: params.boardItemId,
  });
  if (!board) {
    return fail("not_found", `board claim item not found: ${params.boardItemId}`);
  }
  const ownerMemberId = compact(params.ownerMemberId);
  const todolist = await loadLatestOwnerTodolistForBoardItem(authority, {
    taskId: params.taskId,
    boardItemId: params.boardItemId,
    ownerMemberId,
  });
  const viewerId = compact(params.viewerId);
  if (viewerId) {
    if (todolist) {
      if (
        !canReadExecutorTodolist({
          viewerId,
          todolist,
          authorizedConfirmerIds: params.authorizedConfirmerIds,
          coordinatorBotId: params.coordinatorBotId,
        })
      ) {
        return fail(
          "forbidden",
          "todolist is executor-private; only owner, lead/主答, or coordinator may read (no cross-executor bag)",
        );
      }
    } else if (viewerId !== ownerMemberId) {
      const coordinator = compact(params.coordinatorBotId ?? undefined);
      const confirmers = (params.authorizedConfirmerIds ?? [])
        .map((id) => compact(id))
        .filter(Boolean);
      const allowed =
        (coordinator !== "" && viewerId === coordinator) || confirmers.includes(viewerId);
      if (!allowed) {
        return fail(
          "forbidden",
          "cannot build another executor's task bag without owner/lead/coordinator authority",
        );
      }
    }
  }
  const bag = buildExecutionTaskBag({
    boardItem: board,
    todolist,
    groupContextPointer: params.groupContextPointer,
  });
  if (params.requireDeliveryComplete) {
    if (!bag.planGate.confirmed || !bag.todolistCurrentStep) {
      return fail(
        "plan_gate_unconfirmed",
        "delivery exec requires confirmed Todolist current step in 三件套",
      );
    }
    if (!compact(bag.boardSummary.itemId) || !compact(bag.groupContextPointer.groupId)) {
      return fail(
        "exec_bag_incomplete",
        "delivery exec requires board summary + group context pointer",
      );
    }
  }
  return { ok: true, value: bag };
}

/**
 * P2.4 contribution/insight → wake 主答 (uses Wake Contract; flag-off → no write).
 */
export async function signalInsight(
  authority: RuntimeAuthority,
  input: SignalInsightInput,
  options?: TodolistOptions,
): Promise<TodolistResult<{ woke: boolean; wakeId?: string }>> {
  const fromMemberId = compact(input.fromMemberId);
  const insightSummary = compact(input.insightSummary);
  const toLeadIds = (input.toLeadIds ?? []).map((id) => compact(id)).filter(Boolean);
  if (!fromMemberId || !insightSummary) {
    return fail("invalid_input", "signalInsight requires fromMemberId and insightSummary");
  }
  if (toLeadIds.length === 0) {
    return fail("invalid_input", "signalInsight requires at least one toLeadId (主答)");
  }
  const event = await recordWakeEventBestEffort(
    authority,
    {
      groupId: compact(input.groupId) || authority.groupId,
      taskId: compact(input.taskId) || undefined,
      itemId: compact(input.boardItemId) || undefined,
      fromAgentId: fromMemberId,
      toAgentIds: toLeadIds,
      source: "insight",
      outcome: "recorded",
      reason: insightSummary.slice(0, 500),
      relatedId: compact(input.boardItemId) || undefined,
    },
    { cfg: options?.cfg, nowMs: options?.nowMs },
  );
  if (!event) {
    return { ok: true, value: { woke: false } };
  }
  return { ok: true, value: { woke: true, wakeId: event.wakeId } };
}

/** Format task bag for prompt injection (execution rounds). */
export function formatExecutionTaskBagForPrompt(bag: ExecutionTaskBag): string {
  const lines: string[] = [
    "## 执行三件套（共享看板 + 群上下文指针 + 私有 Todolist）",
    "",
    "### 共享看板摘要",
    `- itemId: ${bag.boardSummary.itemId}`,
    `- Goal: ${bag.boardSummary.goal}`,
    `- Acceptance: ${bag.boardSummary.acceptanceCriteria.join("；") || "(无)"}`,
  ];
  if (bag.boardSummary.constraints?.length) {
    lines.push(`- Constraints: ${bag.boardSummary.constraints.join("；")}`);
  }
  if (bag.boardSummary.dueAtMs != null) {
    lines.push(`- DueAtMs: ${bag.boardSummary.dueAtMs}`);
  }
  lines.push(`- Board status: ${bag.boardSummary.status}`);
  lines.push("");
  lines.push("### 群上下文指针");
  lines.push(`- groupId: ${bag.groupContextPointer.groupId}`);
  lines.push(`- transcript: ${bag.groupContextPointer.transcriptHint}`);
  lines.push(`- note: ${bag.groupContextPointer.note}`);
  lines.push("");
  lines.push("### 本人 Todolist 当前步（私有，非全组共享合同）");
  if (!bag.todolistCurrentStep) {
    lines.push("- (无确认清单或无当前步 — 计划门禁未过则不得标交付推进中)");
  } else {
    const step = bag.todolistCurrentStep;
    lines.push(
      `- [${step.stepIndex + 1}/${step.totalSteps}] ${step.title} (todolist=${step.todolistId}, status=${step.status})`,
    );
    if (step.detail) {
      lines.push(`  detail: ${step.detail}`);
    }
  }
  lines.push("");
  lines.push(
    `计划门禁: ${bag.planGate.confirmed ? "已确认" : "未确认"} (todolistStatus=${bag.planGate.todolistStatus})`,
  );
  return lines.join("\n");
}
