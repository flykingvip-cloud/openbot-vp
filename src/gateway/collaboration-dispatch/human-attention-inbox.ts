/**
 * Formal human-attention intake + unified todo list source.
 *
 * Heartbeat opens durable todos here (deduped by groupId|itemId|fingerprint).
 * Workbench pending-tasks lists active rows. Conversation cards bind todoId +
 * fingerprint + version. Operators act via gateway; recover clears heartbeat
 * humanAttention so automation may resume.
 */
import fs from "node:fs";
import path from "node:path";
import type { OpenBotConfig } from "../../config/types.js";
import { resolveConfigDir } from "../../utils.js";
import { broadcastWorkbenchSignalsInvalidate } from "../workbench/signals-invalidate.js";
import {
  resolveHumanAttentionFailureKind,
  type HumanAttentionFailureKind,
  type HumanAttentionOptionId,
} from "./human-attention-card.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import { sanitizeDispatchErrorMessage } from "./sanitize-dispatch-error.js";

export type HumanAttentionTodoStatus =
  | "open"
  | "claimed"
  | "acknowledged"
  | "resolved"
  | "recovered";

export type HumanAttentionTodoResolution = {
  action: HumanAttentionOptionId;
  actorId: string;
  at: number;
  result: string;
};

export type HumanAttentionTodo = {
  id: string;
  groupId: string;
  itemId: string;
  taskId: string;
  fingerprint: string;
  version: number;
  status: HumanAttentionTodoStatus;
  failureKind: HumanAttentionFailureKind;
  reason: string;
  ownerIds: string[];
  recoveryHint: string;
  source: string;
  taskTitle?: string;
  boardStatus?: string;
  wakeOpKey?: string;
  sideEffectClass?: string;
  openedAt: number;
  updatedAt: number;
  claimedBy?: string;
  claimedAt?: number;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
  resolution?: HumanAttentionTodoResolution;
  recoveredAt?: number;
  recoveredBy?: string;
};

export type UpsertHumanAttentionTodoInput = {
  groupId: string;
  itemId: string;
  taskId: string;
  fingerprint: string;
  reason: string;
  ownerIds: readonly string[];
  recoveryHint: string;
  source: string;
  openedAt?: number;
  nowMs?: number;
  taskTitle?: string;
  boardStatus?: string;
  wakeOpKey?: string;
  sideEffectClass?: string;
};

export type UpsertHumanAttentionTodoResult = {
  todo: HumanAttentionTodo;
  created: boolean;
  deduped: boolean;
};

const ACTIVE: ReadonlySet<HumanAttentionTodoStatus> = new Set(["open", "claimed", "acknowledged"]);

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeId(value: string | null | undefined): string {
  return compact(value).toLowerCase();
}

export function humanAttentionTodoId(params: {
  groupId: string;
  itemId: string;
  fingerprint: string;
}): string {
  return `${compact(params.groupId)}|${compact(params.itemId)}|${compact(params.fingerprint)}`;
}

function inboxPath(): string {
  return path.join(resolveConfigDir(), "human-attention-inbox.json");
}

function readAll(): HumanAttentionTodo[] {
  let raw = "[]";
  try {
    raw = fs.readFileSync(inboxPath(), "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((row): row is HumanAttentionTodo => {
    return Boolean(
      row &&
      typeof row === "object" &&
      typeof (row as HumanAttentionTodo).id === "string" &&
      typeof (row as HumanAttentionTodo).groupId === "string" &&
      typeof (row as HumanAttentionTodo).itemId === "string" &&
      typeof (row as HumanAttentionTodo).fingerprint === "string",
    );
  });
}

function writeAll(rows: HumanAttentionTodo[]): void {
  const file = inboxPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

export function actorMatchesHumanAttentionOwners(
  ownerIds: readonly string[],
  actorId: string,
): boolean {
  const actor = normalizeId(actorId);
  if (!actor) {
    return false;
  }
  const aliases = new Set([actor, `human:${actor}`, `user:${actor}`, `platform:${actor}`]);
  for (const owner of ownerIds) {
    const o = normalizeId(owner);
    if (!o) {
      continue;
    }
    if (aliases.has(o) || o === actor) {
      return true;
    }
    for (const prefix of ["human:", "user:", "platform:"]) {
      if (o.startsWith(prefix) && o.slice(prefix.length) === actor) {
        return true;
      }
    }
  }
  return false;
}

export function getHumanAttentionTodo(id: string): HumanAttentionTodo | null {
  const want = compact(id);
  if (!want) {
    return null;
  }
  return readAll().find((row) => row.id === want) ?? null;
}

/**
 * Open or refresh a human-attention todo. Same groupId|itemId|fingerprint while
 * still active is deduped (no second open row). Content refresh keeps version
 * unless reason/source/failureKind change, then version bumps for card update.
 */
export function upsertHumanAttentionTodo(
  input: UpsertHumanAttentionTodoInput,
): UpsertHumanAttentionTodoResult {
  const groupId = compact(input.groupId);
  const itemId = compact(input.itemId);
  const taskId = compact(input.taskId);
  const fingerprint = compact(input.fingerprint);
  const nowMs = input.nowMs ?? Date.now();
  if (!groupId || !itemId || !taskId || !fingerprint) {
    throw new Error("human attention todo requires groupId, itemId, taskId, fingerprint");
  }
  const id = humanAttentionTodoId({ groupId, itemId, fingerprint });
  const reason = sanitizeDispatchErrorMessage(input.reason || "needs_human", 320);
  const recoveryHint = sanitizeDispatchErrorMessage(
    input.recoveryHint || "Inspect board item + wake-op ledger; recover after verified fix.",
    400,
  );
  const ownerIds = [...new Set(input.ownerIds.map(compact).filter(Boolean))];
  const failureKind = resolveHumanAttentionFailureKind({
    source: input.source,
    boardStatus: input.boardStatus,
    sideEffectClass: input.sideEffectClass,
  });
  const all = readAll();
  const index = all.findIndex((row) => row.id === id);
  if (index >= 0) {
    const current = all[index];
    if (ACTIVE.has(current.status)) {
      const materialChange =
        current.reason !== reason ||
        current.source !== input.source ||
        current.failureKind !== failureKind;
      const refreshed: HumanAttentionTodo = {
        ...current,
        reason,
        recoveryHint,
        ownerIds: ownerIds.length > 0 ? ownerIds : current.ownerIds,
        source: input.source,
        failureKind,
        updatedAt: nowMs,
        taskId,
        version: materialChange ? current.version + 1 : current.version,
        ...(compact(input.taskTitle) ? { taskTitle: compact(input.taskTitle) } : {}),
        ...(compact(input.boardStatus) ? { boardStatus: compact(input.boardStatus) } : {}),
        ...(compact(input.wakeOpKey) ? { wakeOpKey: compact(input.wakeOpKey) } : {}),
        ...(compact(input.sideEffectClass)
          ? { sideEffectClass: compact(input.sideEffectClass) }
          : {}),
      };
      all[index] = refreshed;
      writeAll(all);
      return { todo: refreshed, created: false, deduped: true };
    }
  }
  const todo: HumanAttentionTodo = {
    id,
    groupId,
    itemId,
    taskId,
    fingerprint,
    version: 1,
    status: "open",
    failureKind,
    reason,
    ownerIds,
    recoveryHint,
    source: input.source,
    openedAt: input.openedAt || nowMs,
    updatedAt: nowMs,
    ...(compact(input.taskTitle) ? { taskTitle: compact(input.taskTitle) } : {}),
    ...(compact(input.boardStatus) ? { boardStatus: compact(input.boardStatus) } : {}),
    ...(compact(input.wakeOpKey) ? { wakeOpKey: compact(input.wakeOpKey) } : {}),
    ...(compact(input.sideEffectClass) ? { sideEffectClass: compact(input.sideEffectClass) } : {}),
  };
  if (index >= 0) {
    all[index] = todo;
  } else {
    all.push(todo);
  }
  writeAll(all);
  broadcastWorkbenchSignalsInvalidate({
    reason: "task",
    userIds: ownerIds.filter((oid) => !oid.startsWith("bot:")),
  });
  return { todo, created: true, deduped: false };
}

export type ListHumanAttentionTodosParams = {
  actorId?: string | null;
  groupIds?: readonly string[];
  includeResolved?: boolean;
  limit?: number;
};

export function listHumanAttentionTodos(
  params: ListHumanAttentionTodosParams = {},
): HumanAttentionTodo[] {
  const actorId = compact(params.actorId);
  const groupFilter =
    params.groupIds && params.groupIds.length > 0
      ? new Set(params.groupIds.map((g) => compact(g)).filter(Boolean))
      : null;
  const includeResolved = params.includeResolved === true;
  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit) && params.limit > 0
      ? Math.floor(params.limit)
      : 100;
  const rows = readAll()
    .filter((row) => {
      if (!includeResolved && (row.status === "recovered" || row.status === "resolved")) {
        return false;
      }
      if (groupFilter && !groupFilter.has(row.groupId)) {
        return false;
      }
      if (actorId && !actorMatchesHumanAttentionOwners(row.ownerIds, actorId)) {
        if (normalizeId(row.claimedBy) !== normalizeId(actorId)) {
          return false;
        }
      }
      return true;
    })
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
  return rows.slice(0, limit);
}

function requireTodo(id: string): {
  all: HumanAttentionTodo[];
  index: number;
  todo: HumanAttentionTodo;
} {
  const all = readAll();
  const index = all.findIndex((row) => row.id === id);
  if (index < 0) {
    throw new Error(`human attention todo not found: ${id}`);
  }
  return { all, index, todo: all[index] };
}

export type HumanAttentionActionResult =
  | { ok: true; todo: HumanAttentionTodo }
  | { ok: false; reason: string };

export function claimHumanAttentionTodo(params: {
  id: string;
  actorId: string;
  nowMs?: number;
}): HumanAttentionActionResult {
  const actorId = compact(params.actorId);
  if (!actorId) {
    return { ok: false, reason: "actor_required" };
  }
  let loaded: ReturnType<typeof requireTodo>;
  try {
    loaded = requireTodo(compact(params.id));
  } catch {
    return { ok: false, reason: "not_found" };
  }
  const { all, index, todo } = loaded;
  if (todo.status === "recovered" || todo.status === "resolved") {
    return { ok: false, reason: "already_resolved" };
  }
  if (!actorMatchesHumanAttentionOwners(todo.ownerIds, actorId)) {
    return { ok: false, reason: "not_owner" };
  }
  if (todo.status === "claimed" && normalizeId(todo.claimedBy) !== normalizeId(actorId)) {
    return { ok: false, reason: "claimed_by_other" };
  }
  const nowMs = params.nowMs ?? Date.now();
  const next: HumanAttentionTodo = {
    ...todo,
    status: "claimed",
    claimedBy: actorId,
    claimedAt:
      todo.claimedAt && normalizeId(todo.claimedBy) === normalizeId(actorId)
        ? todo.claimedAt
        : nowMs,
    updatedAt: nowMs,
  };
  all[index] = next;
  writeAll(all);
  broadcastWorkbenchSignalsInvalidate({ reason: "task", userIds: [actorId] });
  return { ok: true, todo: next };
}

export function acknowledgeHumanAttentionTodo(params: {
  id: string;
  actorId: string;
  nowMs?: number;
}): HumanAttentionActionResult {
  const actorId = compact(params.actorId);
  if (!actorId) {
    return { ok: false, reason: "actor_required" };
  }
  let loaded: ReturnType<typeof requireTodo>;
  try {
    loaded = requireTodo(compact(params.id));
  } catch {
    return { ok: false, reason: "not_found" };
  }
  const { all, index, todo } = loaded;
  if (todo.status === "recovered" || todo.status === "resolved") {
    return { ok: false, reason: "already_resolved" };
  }
  const isClaimant = normalizeId(todo.claimedBy) === normalizeId(actorId);
  if (!isClaimant && !actorMatchesHumanAttentionOwners(todo.ownerIds, actorId)) {
    return { ok: false, reason: "not_owner" };
  }
  const nowMs = params.nowMs ?? Date.now();
  const next: HumanAttentionTodo = {
    ...todo,
    status: "acknowledged",
    acknowledgedBy: actorId,
    acknowledgedAt: nowMs,
    claimedBy: todo.claimedBy ?? actorId,
    claimedAt: todo.claimedAt ?? nowMs,
    updatedAt: nowMs,
  };
  all[index] = next;
  writeAll(all);
  broadcastWorkbenchSignalsInvalidate({ reason: "task", userIds: [actorId] });
  return { ok: true, todo: next };
}

function safeStem(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return null;
  }
  return encodeURIComponent(trimmed);
}

async function clearHeartbeatHumanAttention(params: {
  authority: RuntimeAuthority;
  groupId: string;
  itemId: string;
  fingerprint: string;
  nowMs: number;
}): Promise<boolean> {
  const stem = safeStem(params.groupId);
  if (!stem) {
    return false;
  }
  const statePath = path.join(
    params.authority.namespace.root,
    "group-task-heartbeat",
    `${stem}.json`,
  );
  let raw: string;
  try {
    raw = await fs.promises.readFile(statePath, "utf8");
  } catch {
    return false;
  }
  let state: {
    groupId: string;
    lastScanAt: number;
    items: Record<string, Record<string, unknown>>;
  };
  try {
    state = JSON.parse(raw) as typeof state;
  } catch {
    return false;
  }
  const item = state.items?.[params.itemId];
  if (!item || typeof item !== "object") {
    return false;
  }
  const attention = item.humanAttention as { fingerprint?: string } | undefined;
  if (!attention) {
    return false;
  }
  if (compact(attention.fingerprint) !== compact(params.fingerprint)) {
    return false;
  }
  const nextItem = {
    ...item,
    humanAttention: undefined,
    nudgeFailCount: 0,
    escalateFailCount: 0,
  };
  const next = {
    ...state,
    lastScanAt: params.nowMs,
    items: {
      ...state.items,
      [params.itemId]: nextItem,
    },
  };
  await fs.promises.writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return true;
}

export async function resolveHumanAttentionTodo(params: {
  id: string;
  actorId: string;
  action: HumanAttentionOptionId;
  result: string;
  nowMs?: number;
  authority?: RuntimeAuthority | null;
  cfg?: OpenBotConfig;
  /** When true, clear heartbeat humanAttention so auto-advance may resume. */
  clearHeartbeat?: boolean;
  transferOwnerId?: string;
}): Promise<HumanAttentionActionResult & { heartbeatCleared?: boolean }> {
  const actorId = compact(params.actorId);
  if (!actorId) {
    return { ok: false, reason: "actor_required" };
  }
  let loaded: ReturnType<typeof requireTodo>;
  try {
    loaded = requireTodo(compact(params.id));
  } catch {
    return { ok: false, reason: "not_found" };
  }
  const { all, index, todo } = loaded;
  if (todo.status === "recovered" || todo.status === "resolved") {
    return { ok: true, todo, heartbeatCleared: false };
  }
  const isClaimant = normalizeId(todo.claimedBy) === normalizeId(actorId);
  if (!isClaimant && !actorMatchesHumanAttentionOwners(todo.ownerIds, actorId)) {
    return { ok: false, reason: "not_owner" };
  }
  const nowMs = params.nowMs ?? Date.now();
  let nextOwners = todo.ownerIds;
  if (params.action === "transfer") {
    const target = compact(params.transferOwnerId);
    if (!target) {
      return { ok: false, reason: "transfer_owner_required" };
    }
    nextOwners = [target];
  }
  let heartbeatCleared = false;
  if (params.clearHeartbeat && params.authority) {
    try {
      heartbeatCleared = await clearHeartbeatHumanAttention({
        authority: params.authority,
        groupId: todo.groupId,
        itemId: todo.itemId,
        fingerprint: todo.fingerprint,
        nowMs,
      });
    } catch {
      heartbeatCleared = false;
    }
  }
  const resolution: HumanAttentionTodoResolution = {
    action: params.action,
    actorId,
    at: nowMs,
    result: sanitizeDispatchErrorMessage(params.result, 240),
  };
  const terminal = params.action === "transfer" && !params.clearHeartbeat ? "open" : "resolved";
  const next: HumanAttentionTodo = {
    ...todo,
    status: terminal === "open" ? "open" : params.clearHeartbeat ? "recovered" : "resolved",
    ownerIds: nextOwners,
    resolution,
    recoveredBy: terminal === "open" ? undefined : actorId,
    recoveredAt: terminal === "open" ? undefined : nowMs,
    updatedAt: nowMs,
    version: todo.version + (params.action === "transfer" ? 1 : 0),
  };
  all[index] = next;
  writeAll(all);
  broadcastWorkbenchSignalsInvalidate({
    reason: "task",
    userIds: [...nextOwners.filter((oid) => !oid.startsWith("bot:")), actorId],
  });
  return { ok: true, todo: next, heartbeatCleared };
}

/** @deprecated prefer resolveHumanAttentionTodo */
export async function recoverHumanAttentionTodo(params: {
  id: string;
  actorId: string;
  nowMs?: number;
  authority?: RuntimeAuthority | null;
  cfg?: OpenBotConfig;
}): Promise<HumanAttentionActionResult & { heartbeatCleared?: boolean }> {
  return resolveHumanAttentionTodo({
    ...params,
    action: "take_over",
    result: "recovered",
    clearHeartbeat: true,
  });
}

export function resetHumanAttentionInboxForTests(): void {
  try {
    fs.unlinkSync(inboxPath());
  } catch {
    // missing is fine
  }
}
