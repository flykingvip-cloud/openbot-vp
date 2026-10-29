/**
 * Todolist owner-decision card delivery (batch 2).
 *
 * Plan creation and card delivery are separate. Authority is the server
 * proposal plus this delivery log (version, stage, retryability). A matching
 * ```owner-decision fence in a transcript line does not by itself prove the
 * card was issued.
 *
 * This track is not the meeting steward ticket. It has no 5-minute TTL and
 * must never store a confirmationToken.
 *
 * Ladder: proposal_created → card_persisted → push_attempted / push_completed
 * → client_presented (only with a client receipt; none exists yet) →
 * confirmation_consumed.
 *
 * Without a client receipt the record may say history is reloadable and that
 * the server delivery result is tracked. It must not claim the user saw the card.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../../config/types.js";
import type { ExecutorPrivateTodolist } from "../collaboration-dispatch/executor-private-todolist.js";
import type { OwnerDecisionCard } from "../collaboration-dispatch/owner-decision-card.js";
import { appendJsonlDurable } from "../collaboration-dispatch/round-store-io.js";
import { resolveGroupPublicTranscriptPath } from "./collaboration-paths.js";

export const OWNER_DECISION_DELIVERY_KIND = "owner_decision_card_delivery" as const;

export const OWNER_DECISION_DELIVERY_STAGES = [
  "proposal_created",
  "card_persisted",
  "push_attempted",
  "push_completed",
  "client_presented",
  "confirmation_consumed",
  "peer_confirmation_consumed",
  "delivery_failed",
  "skipped",
] as const;

export type OwnerDecisionDeliveryStage = (typeof OWNER_DECISION_DELIVERY_STAGES)[number];

export const OWNER_DECISION_USER_FACING = [
  "waiting_confirmation",
  "delivery_failed_retryable",
  "stale_version",
  "consumed",
  "peer_confirmed",
  "skipped",
  "tracked",
] as const;

export type OwnerDecisionUserFacing = (typeof OWNER_DECISION_USER_FACING)[number];

export const OWNER_DECISION_DELIVERY_COPY: Record<
  "waiting_confirmation" | "delivery_failed_retryable" | "stale_version",
  string
> = {
  waiting_confirmation: "等待确认",
  delivery_failed_retryable: "确认请求发送失败，可重试",
  stale_version: "旧版本已失效",
};

export type OwnerDecisionCardDelivery = {
  ok: boolean;
  stage: OwnerDecisionDeliveryStage;
  reason?: string;
  message?: string;
  /** Transcript (or an equivalent durable card message) can be reloaded. */
  historyReloadable: boolean;
  /** A server delivery row was written, or this object is that row. */
  deliveryTracked: boolean;
  /**
   * True only when a client presentation receipt exists.
   * This batch has no receipt channel, so writers force this to false.
   */
  clientPresented: false;
  retryable: boolean;
  userFacing: OwnerDecisionUserFacing;
  groupId: string;
  taskId: string;
  boardItemId: string;
  todolistId: string;
  version: number;
  messageId?: string;
  idempotencyKey?: string;
  /** Redraw payload. Never includes a confirmation token. */
  card?: OwnerDecisionCard;
};

type DeliveryLogLine = {
  kind: typeof OWNER_DECISION_DELIVERY_KIND;
  at: number;
  delivery: OwnerDecisionCardDelivery;
};

/** Same fence text is not issuance authority. */
export function ownerDecisionFenceProvesIssuance(): false {
  return false;
}

export function ownerDecisionDeliveryStatusCopy(
  userFacing: OwnerDecisionUserFacing | null | undefined,
): string | null {
  if (
    userFacing === "waiting_confirmation" ||
    userFacing === "delivery_failed_retryable" ||
    userFacing === "stale_version"
  ) {
    return OWNER_DECISION_DELIVERY_COPY[userFacing];
  }
  return null;
}

export function resolveOwnerDecisionDeliveryLogPath(
  groupId: string,
  cfg?: OpenBotConfig,
  options?: { groupRootDir?: string; groupLocator?: string },
): string {
  const transcript = resolveGroupPublicTranscriptPath(groupId, cfg, options);
  return path.join(path.dirname(transcript), "owner-decision-delivery.jsonl");
}

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Drop confirmation tokens before any durable delivery or recovery write. */
export function stripConfirmationTokens<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripConfirmationTokens(entry)) as T;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "confirmationToken") {
      continue;
    }
    out[key] = stripConfirmationTokens(entry);
  }
  return out as T;
}

export function deriveOwnerDecisionUserFacing(input: {
  ok: boolean;
  stage: OwnerDecisionDeliveryStage;
  reason?: string;
  historyReloadable: boolean;
  retryable: boolean;
}): OwnerDecisionUserFacing {
  const reason = compact(input.reason);
  if (
    reason === "stale_version" ||
    reason === "version_mismatch" ||
    reason === "superseded" ||
    reason === "status_superseded"
  ) {
    return "stale_version";
  }
  if (input.stage === "peer_confirmation_consumed") {
    return "peer_confirmed";
  }
  if (input.stage === "confirmation_consumed") {
    return "consumed";
  }
  if (input.stage === "skipped") {
    return "skipped";
  }
  if (!input.ok && input.retryable) {
    return "delivery_failed_retryable";
  }
  if (input.stage === "delivery_failed") {
    return input.retryable ? "delivery_failed_retryable" : "tracked";
  }
  if (
    input.historyReloadable &&
    (input.stage === "card_persisted" ||
      input.stage === "push_attempted" ||
      input.stage === "push_completed" ||
      input.stage === "proposal_created")
  ) {
    return "waiting_confirmation";
  }
  return "tracked";
}

export function normalizeOwnerDecisionDelivery(
  delivery: OwnerDecisionCardDelivery,
): OwnerDecisionCardDelivery {
  const stripped = stripConfirmationTokens(delivery);
  const userFacing = deriveOwnerDecisionUserFacing(stripped);
  const normalized: OwnerDecisionCardDelivery = {
    ...stripped,
    userFacing,
    clientPresented: false,
    deliveryTracked: stripped.deliveryTracked,
    historyReloadable: stripped.historyReloadable,
    retryable: stripped.retryable,
    ok: stripped.ok,
  };
  if (!normalized.reason) {
    delete normalized.reason;
  }
  if (!normalized.message) {
    delete normalized.message;
  }
  if (!normalized.messageId) {
    delete normalized.messageId;
  }
  if (!normalized.idempotencyKey) {
    delete normalized.idempotencyKey;
  }
  if (!normalized.card) {
    delete normalized.card;
  }
  return normalized;
}

export function proposalCreatedDelivery(
  todolist: Pick<
    ExecutorPrivateTodolist,
    "groupId" | "taskId" | "boardItemId" | "todolistId" | "version"
  >,
): OwnerDecisionCardDelivery {
  return normalizeOwnerDecisionDelivery({
    ok: true,
    stage: "proposal_created",
    historyReloadable: false,
    deliveryTracked: false,
    clientPresented: false,
    retryable: true,
    userFacing: "tracked",
    groupId: todolist.groupId,
    taskId: todolist.taskId,
    boardItemId: todolist.boardItemId,
    todolistId: todolist.todolistId,
    version: todolist.version,
  });
}

export function staleOwnerDecisionDelivery(params: {
  todolist: Pick<
    ExecutorPrivateTodolist,
    "groupId" | "taskId" | "boardItemId" | "todolistId" | "version" | "status"
  >;
  reason: string;
  message: string;
}): OwnerDecisionCardDelivery {
  return normalizeOwnerDecisionDelivery({
    ok: false,
    stage: "proposal_created",
    reason: params.reason,
    message: params.message,
    historyReloadable: false,
    deliveryTracked: false,
    clientPresented: false,
    retryable: false,
    userFacing: "stale_version",
    groupId: params.todolist.groupId,
    taskId: params.todolist.taskId,
    boardItemId: params.todolist.boardItemId,
    todolistId: params.todolist.todolistId,
    version: params.todolist.version,
  });
}

export function confirmationConsumedDelivery(
  todolist: Pick<
    ExecutorPrivateTodolist,
    "groupId" | "taskId" | "boardItemId" | "todolistId" | "version"
  >,
): OwnerDecisionCardDelivery {
  return normalizeOwnerDecisionDelivery({
    ok: true,
    stage: "confirmation_consumed",
    historyReloadable: true,
    deliveryTracked: false,
    clientPresented: false,
    retryable: false,
    userFacing: "consumed",
    groupId: todolist.groupId,
    taskId: todolist.taskId,
    boardItemId: todolist.boardItemId,
    todolistId: todolist.todolistId,
    version: todolist.version,
  });
}

/** Bot↔bot peer auto-confirm residual for human UI (compact「收到，并确认」). */
export function peerConfirmationConsumedDelivery(
  todolist: Pick<
    ExecutorPrivateTodolist,
    "groupId" | "taskId" | "boardItemId" | "todolistId" | "version"
  >,
): OwnerDecisionCardDelivery {
  return normalizeOwnerDecisionDelivery({
    ok: true,
    stage: "peer_confirmation_consumed",
    historyReloadable: true,
    deliveryTracked: false,
    clientPresented: false,
    retryable: false,
    userFacing: "peer_confirmed",
    groupId: todolist.groupId,
    taskId: todolist.taskId,
    boardItemId: todolist.boardItemId,
    todolistId: todolist.todolistId,
    version: todolist.version,
  });
}

export async function recordOwnerDecisionDelivery(params: {
  groupId: string;
  delivery: OwnerDecisionCardDelivery;
  cfg?: OpenBotConfig;
  nowMs?: number;
  /** Trusted group locator — keep delivery log on same SoT as board/plan. */
  groupRootDir?: string;
  groupLocator?: string;
}): Promise<OwnerDecisionCardDelivery> {
  const delivery = normalizeOwnerDecisionDelivery({
    ...params.delivery,
    deliveryTracked: true,
  });
  const raw = JSON.stringify(delivery);
  if (raw.includes("confirmationToken")) {
    throw new Error("owner-decision delivery record must not contain confirmationToken");
  }
  const dest = resolveOwnerDecisionDeliveryLogPath(params.groupId || delivery.groupId, params.cfg, {
    groupRootDir: params.groupRootDir,
    groupLocator: params.groupLocator,
  });
  await appendJsonlDurable(dest, {
    kind: OWNER_DECISION_DELIVERY_KIND,
    at: params.nowMs ?? Date.now(),
    delivery,
  } satisfies DeliveryLogLine);
  return delivery;
}

export async function readOwnerDecisionDeliveries(params: {
  groupId: string;
  taskId?: string;
  todolistId?: string;
  cfg?: OpenBotConfig;
  groupRootDir?: string;
  groupLocator?: string;
}): Promise<OwnerDecisionCardDelivery[]> {
  const dest = resolveOwnerDecisionDeliveryLogPath(params.groupId, params.cfg, {
    groupRootDir: params.groupRootDir,
    groupLocator: params.groupLocator,
  });
  let text = "";
  try {
    text = await fsp.readFile(dest, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const taskId = compact(params.taskId);
  const todolistId = compact(params.todolistId);
  const rows: OwnerDecisionCardDelivery[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as DeliveryLogLine;
      if (parsed?.kind !== OWNER_DECISION_DELIVERY_KIND || !parsed.delivery) {
        continue;
      }
      const delivery = normalizeOwnerDecisionDelivery(parsed.delivery);
      if (taskId && delivery.taskId !== taskId) {
        continue;
      }
      if (todolistId && delivery.todolistId !== todolistId) {
        continue;
      }
      rows.push(delivery);
    } catch {
      // Ignore a torn last line; the proposal log remains the plan authority.
    }
  }
  return rows;
}

export async function readLatestOwnerDecisionDelivery(params: {
  groupId: string;
  todolistId: string;
  version?: number;
  cfg?: OpenBotConfig;
}): Promise<OwnerDecisionCardDelivery | null> {
  const rows = await readOwnerDecisionDeliveries({
    groupId: params.groupId,
    todolistId: params.todolistId,
    cfg: params.cfg,
  });
  const version =
    typeof params.version === "number" && Number.isFinite(params.version)
      ? Math.floor(params.version)
      : null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row) {
      continue;
    }
    if (version != null && row.version !== version) {
      continue;
    }
    return row;
  }
  return null;
}
