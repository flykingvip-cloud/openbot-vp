/**
 * 席位 store（独立于订阅，按 enterpriseId 隔离）。
 *
 * Seat 是高频变更且与计费强耦合的对象，故从 Subscription_Service 拆出为独立模块。
 * - Seat 头记录可 upsert（当前角色/配额/生命周期状态）；
 * - 每次角色变更：关闭当前 seat_history 区间并追加新角色区间（append-only）；
 * - deactivate/remove 关闭开放区间；reactivate 重新开启；
 * - 至多一个 **active** 席位 per (enterpriseId, normalizedUserId)。
 *
 * 落盘：`CONFIG_DIR/openbot-billing-seats.json`。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import { appendLedgerRecord } from "./append-only-ledger.js";
import type { Seat, SeatHistoryInterval, SeatRole, SeatStatus } from "./types.js";

const SEATS_STORE_VERSION = 1;

type SeatsStore = {
  version: number;
  seats: Record<string, Seat>;
  history: SeatHistoryInterval[]; // append-only；区间关闭通过新增带 endTime 的替换记录处理
};

function createEmptyStore(): SeatsStore {
  return { version: SEATS_STORE_VERSION, seats: {}, history: [] };
}

export function resolveDefaultSeatsStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-billing-seats.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

/** 用户标识规范化（唯一 active 键：大小写不敏感 trim）。 */
export function normalizeSeatUserId(userId: string): string {
  return userId.trim().toLowerCase();
}

/** 历史数据缺 status → active。 */
export function resolveSeatStatus(seat: Pick<Seat, "status">): SeatStatus {
  return seat.status ?? "active";
}

export class DuplicateActiveSeatError extends Error {
  readonly code = "DUPLICATE_ACTIVE_SEAT" as const;
  constructor(
    readonly enterpriseId: string,
    readonly userId: string,
    readonly existingSeatId: string,
  ) {
    super(
      `已有 active 席位（seatId=${existingSeatId}）绑定用户 ${userId}；每个用户至多一个 active 席位`,
    );
    this.name = "DuplicateActiveSeatError";
  }
}

export class SeatLifecycleError extends Error {
  readonly code = "SEAT_LIFECYCLE_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "SeatLifecycleError";
  }
}

export class SeatRoleQuotaExceededError extends Error {
  readonly code = "SEAT_ROLE_QUOTA_EXCEEDED" as const;
  constructor(
    readonly role: SeatRole,
    readonly quota: number,
    readonly activeCount: number,
  ) {
    super(`角色 ${role} 的席位配额已满（上限 ${quota}，当前 active ${activeCount}）`);
    this.name = "SeatRoleQuotaExceededError";
  }
}

export type SeatWriteOptions = {
  effectiveAt?: string;
  /**
   * 角色配额上限（来自锁定 planVersion.snapshot.seatQuota[role]）。
   * 在 store 锁内校验：mutation 后该角色 active 数不得超过 quota。
   * 缺省 = 不校验配额（测试/内部调用）；Gateway handler 必须传入。
   */
  roleQuota?: number;
};

function parseWriteOptions(arg?: string | SeatWriteOptions): SeatWriteOptions {
  if (typeof arg === "string") {
    return { effectiveAt: arg };
  }
  return arg ?? {};
}

async function loadStore(storePath?: string): Promise<SeatsStore> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultSeatsStorePath());
  const parsed = await readJsonFile<Partial<SeatsStore>>(resolvedPath);
  if (!parsed) {
    return createEmptyStore();
  }
  return {
    version: SEATS_STORE_VERSION,
    seats: parsed.seats ?? {},
    history: Array.isArray(parsed.history) ? parsed.history : [],
  };
}

async function saveStore(store: SeatsStore, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultSeatsStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

/** 找某 seat 当前开放区间（endTime=null）。 */
function findOpenInterval(
  history: SeatHistoryInterval[],
  seatId: string,
): SeatHistoryInterval | null {
  return history.find((iv) => iv.seatId === seatId && iv.endTime === null) ?? null;
}

/**
 * 关闭区间要求 endTime > startTime（半开 [start, end) 正长度）。
 * 乱序 / 零长请求 **拒绝**，不再钳制。
 */
export function assertClosedIntervalEndAfterStart(
  startTime: string,
  endTime: string,
  action: string,
): void {
  const startMs = Date.parse(startTime);
  const endMs = Date.parse(endTime);
  if (!Number.isFinite(startMs)) {
    throw new SeatLifecycleError(`invalid interval startTime: ${startTime}`);
  }
  if (!Number.isFinite(endMs)) {
    throw new SeatLifecycleError(`${action}: invalid effectiveAt ${endTime}`);
  }
  if (endMs <= startMs) {
    throw new SeatLifecycleError(
      `${action}: effectiveAt must be after open.startTime (${endTime} <= ${startTime})`,
    );
  }
}

/** 该 seat 已关闭区间中最晚的 endTime；无则 null。 */
export function latestClosedEndTime(
  history: readonly SeatHistoryInterval[],
  seatId: string,
): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const iv of history) {
    if (iv.seatId !== seatId || iv.endTime == null) {
      continue;
    }
    const endMs = Date.parse(iv.endTime);
    if (Number.isFinite(endMs) && endMs > bestMs) {
      bestMs = endMs;
      best = iv.endTime;
    }
  }
  return best;
}

/**
 * reactivate：effectiveAt 不得早于 latestClosed.endTime。
 * 允许 equal（半开衔接 [prevEnd, …)）；strict 更早则拒绝。
 */
export function assertReactivateEffectiveAt(
  history: readonly SeatHistoryInterval[],
  seatId: string,
  effectiveAt: string,
): void {
  const atMs = Date.parse(effectiveAt);
  if (!Number.isFinite(atMs)) {
    throw new SeatLifecycleError(`reactivate: invalid effectiveAt ${effectiveAt}`);
  }
  const latestEnd = latestClosedEndTime(history, seatId);
  if (latestEnd == null) {
    return;
  }
  const endMs = Date.parse(latestEnd);
  if (Number.isFinite(endMs) && atMs < endMs) {
    throw new SeatLifecycleError(
      `reactivate: effectiveAt must be >= latestClosed.endTime (${effectiveAt} < ${latestEnd})`,
    );
  }
}

/** @deprecated 使用 assertClosedIntervalEndAfterStart；保留别名防旧 import。 */
export function ensureIntervalEndAfterStart(startTime: string, endTime: string): string {
  assertClosedIntervalEndAfterStart(startTime, endTime, "interval");
  return endTime;
}

/**
 * 同 seat 历史不变量：closed 满足 start < end；至多一个 open；半开区间不重叠。
 * @throws SeatLifecycleError
 */
export function assertSeatHistoryInvariants(
  history: readonly SeatHistoryInterval[],
  seatId: string,
): void {
  const rows = history
    .filter((iv) => iv.seatId === seatId)
    .map((iv) => ({
      ...iv,
      startMs: Date.parse(iv.startTime),
      endMs: iv.endTime == null ? Number.POSITIVE_INFINITY : Date.parse(iv.endTime),
    }))
    .toSorted((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  let openCount = 0;
  for (const iv of rows) {
    if (!Number.isFinite(iv.startMs)) {
      throw new SeatLifecycleError(`seat ${seatId} interval has invalid startTime`);
    }
    if (iv.endTime == null) {
      openCount += 1;
      continue;
    }
    if (!Number.isFinite(iv.endMs) || iv.endMs <= iv.startMs) {
      throw new SeatLifecycleError(
        `seat ${seatId} interval violates startTime < endTime (${iv.startTime} ≥ ${iv.endTime})`,
      );
    }
  }
  if (openCount > 1) {
    throw new SeatLifecycleError(`seat ${seatId} has ${openCount} open intervals`);
  }

  // 半开 [start, end)：相邻 end===next.start 不算重叠
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (a.startMs < b.endMs && b.startMs < a.endMs) {
        throw new SeatLifecycleError(
          `seat ${seatId} has overlapping intervals ${a.id} and ${b.id}`,
        );
      }
    }
  }
}

/**
 * 解析关闭时刻：
 * - **显式** effectiveAt：必须 > open.startTime，否则拒绝（禁止乱序/零长）
 * - **隐式** wall-clock：若与 open.start 同毫秒，仅 +1ms 消钟分辨率碰撞（非乱序请求）
 */
function resolveCloseAt(
  openStartTime: string,
  requestedAt: string,
  explicitEffectiveAt: boolean,
  action: string,
): string {
  const startMs = Date.parse(openStartTime);
  const atMs = Date.parse(requestedAt);
  if (!Number.isFinite(startMs)) {
    throw new SeatLifecycleError(`invalid open.startTime: ${openStartTime}`);
  }
  if (!Number.isFinite(atMs)) {
    throw new SeatLifecycleError(`${action}: invalid effectiveAt ${requestedAt}`);
  }
  if (atMs > startMs) {
    return requestedAt;
  }
  if (explicitEffectiveAt) {
    throw new SeatLifecycleError(
      `${action}: effectiveAt must be after open.startTime (${requestedAt} <= ${openStartTime})`,
    );
  }
  return new Date(startMs + 1).toISOString();
}

/**
 * 关闭开放区间：append closed 记录并移除 open 占位（append-only 语义）。
 * 显式 effectiveAt 乱序 → 拒绝；不钳制调用方给定的时间。
 * 若无开放区间则 no-op 返回 null。
 */
function closeOpenInterval(
  store: SeatsStore,
  seatId: string,
  at: string,
  action: string,
  explicitEffectiveAt: boolean,
): { closed: SeatHistoryInterval; nextStart: string } | null {
  const open = findOpenInterval(store.history, seatId);
  if (!open) {
    return null;
  }
  const endTime = resolveCloseAt(open.startTime, at, explicitEffectiveAt, action);
  const closed: SeatHistoryInterval = { ...open, id: `sh-${randomUUID()}`, endTime };
  store.history = store.history.filter((iv) => iv.id !== open.id);
  store.history = appendLedgerRecord(store.history, closed);
  return { closed, nextStart: endTime };
}

function findActiveSeatForUser(
  store: SeatsStore,
  enterpriseId: string,
  normalizedUserId: string,
): Seat | null {
  for (const seat of Object.values(store.seats)) {
    if (seat.enterpriseId !== enterpriseId) {
      continue;
    }
    if (resolveSeatStatus(seat) !== "active") {
      continue;
    }
    if (normalizeSeatUserId(seat.userId) === normalizedUserId) {
      return seat;
    }
  }
  return null;
}

/** 锁内统计 enterprise 下某角色 active 席位数。 */
function countActiveByRoleInStore(
  store: SeatsStore,
  enterpriseId: string,
  role: SeatRole,
  opts?: { excludeSeatId?: string },
): number {
  let n = 0;
  for (const seat of Object.values(store.seats)) {
    if (seat.enterpriseId !== enterpriseId) {
      continue;
    }
    if (opts?.excludeSeatId && seat.id === opts.excludeSeatId) {
      continue;
    }
    if (resolveSeatStatus(seat) !== "active") {
      continue;
    }
    if (seat.currentRole === role) {
      n += 1;
    }
  }
  return n;
}

/**
 * 锁内：mutation 后角色 active 数不得超过 roleQuota。
 * - assign / reactivate：当前尚未 active 计入，要求 count < quota
 * - set-role 换入新角色：本席仍属旧角色，要求 count[newRole] < quota（不含将换入的本席）
 */
function assertRoleQuotaOrThrow(
  store: SeatsStore,
  enterpriseId: string,
  role: SeatRole,
  roleQuota: number | undefined,
  opts?: { excludeSeatId?: string },
): void {
  if (roleQuota === undefined || !Number.isFinite(roleQuota)) {
    return;
  }
  const quota = Math.max(0, Math.floor(roleQuota));
  const activeCount = countActiveByRoleInStore(store, enterpriseId, role, opts);
  if (activeCount >= quota) {
    throw new SeatRoleQuotaExceededError(role, quota, activeCount);
  }
}

export type AssignSeatInput = {
  enterpriseId: string;
  userId: string;
  role: SeatRole;
  botQuota: number;
  effectiveAt?: string;
  /** 分配时锁定的 planVersionId（配额真源）。 */
  planVersionId?: string;
  /**
   * 锁内角色配额（来自锁定 planVersion）。并发 assign 时仅此校验可原子拒绝超额。
   */
  roleQuota?: number;
};

/** 分配席位：创建 active Seat + 开启首个 seat_history 区间；唯一 active + 锁内配额。 */
export async function assignSeat(input: AssignSeatInput, storePath?: string): Promise<Seat> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(input.enterpriseId);
    const normalizedUser = normalizeSeatUserId(input.userId);
    if (!normalizedUser) {
      throw new SeatLifecycleError("userId is required");
    }
    const existingActive = findActiveSeatForUser(store, t, normalizedUser);
    if (existingActive) {
      throw new DuplicateActiveSeatError(t, normalizedUser, existingActive.id);
    }
    assertRoleQuotaOrThrow(store, t, input.role, input.roleQuota);
    const now = input.effectiveAt ?? new Date().toISOString();
    const seat: Seat = {
      id: `seat-${randomUUID()}`,
      enterpriseId: t,
      userId: input.userId.trim(),
      currentRole: input.role,
      botQuota: input.botQuota,
      createdAt: now,
      status: "active",
      updatedAt: now,
      ...(input.planVersionId?.trim() ? { planVersionId: input.planVersionId.trim() } : {}),
    };
    store.seats[seat.id] = seat;
    store.history = appendLedgerRecord(store.history, {
      id: `sh-${randomUUID()}`,
      seatId: seat.id,
      enterpriseId: t,
      role: input.role,
      startTime: now,
      endTime: null,
    });
    assertSeatHistoryInvariants(store.history, seat.id);
    await saveStore(store, storePath);
    return seat;
  });
}

/**
 * 修改席位角色：关闭当前开放区间，追加新角色区间，更新头记录 currentRole。
 * 仅 active 席位可改角色。roleQuota 在锁内校验（并发 set-role 不破配额）。
 *
 * @param effectiveAtOrOptions 兼容旧签名：string = effectiveAt；或 { effectiveAt, roleQuota }
 */
export async function setSeatRole(
  enterpriseId: string,
  seatId: string,
  role: SeatRole,
  storePath?: string,
  effectiveAtOrOptions?: string | SeatWriteOptions,
): Promise<{ seat: Seat; closed: SeatHistoryInterval; opened: SeatHistoryInterval } | null> {
  const opts = parseWriteOptions(effectiveAtOrOptions);
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(enterpriseId);
    const seat = store.seats[seatId];
    if (!seat || seat.enterpriseId !== t) {
      return null;
    }
    if (resolveSeatStatus(seat) !== "active") {
      throw new SeatLifecycleError(
        `席位 ${seatId} 状态为 ${resolveSeatStatus(seat)}，仅 active 可变更角色`,
      );
    }
    const open = findOpenInterval(store.history, seatId);
    if (!open) {
      return null;
    }
    if (role !== seat.currentRole) {
      // 本席仍计旧角色，新角色 active 不含本席
      assertRoleQuotaOrThrow(store, t, role, opts.roleQuota);
    }
    const explicit = opts.effectiveAt !== undefined;
    const at = opts.effectiveAt ?? new Date().toISOString();
    // 显式 effectiveAt <= open.startTime → 拒绝
    const closedResult = closeOpenInterval(store, seatId, at, "set-role", explicit);
    if (!closedResult) {
      return null;
    }
    const { closed, nextStart } = closedResult;
    const opened: SeatHistoryInterval = {
      id: `sh-${randomUUID()}`,
      seatId,
      enterpriseId: t,
      role,
      startTime: nextStart,
      endTime: null,
    };
    store.history = appendLedgerRecord(store.history, opened);
    const updated: Seat = {
      ...seat,
      currentRole: role,
      status: "active",
      updatedAt: nextStart,
    };
    store.seats[seatId] = updated;
    assertSeatHistoryInvariants(store.history, seatId);
    await saveStore(store, storePath);
    return { seat: updated, closed, opened };
  });
}

export async function setSeatBotQuota(
  enterpriseId: string,
  seatId: string,
  botQuota: number,
  storePath?: string,
): Promise<Seat | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(enterpriseId);
    const seat = store.seats[seatId];
    if (!seat || seat.enterpriseId !== t) {
      return null;
    }
    if (resolveSeatStatus(seat) === "removed") {
      throw new SeatLifecycleError(`席位 ${seatId} 已 removed，不可修改 botQuota`);
    }
    const now = new Date().toISOString();
    const updated: Seat = { ...seat, botQuota, updatedAt: now };
    store.seats[seatId] = updated;
    await saveStore(store, storePath);
    return updated;
  });
}

/**
 * 停用席位：active → inactive，关闭开放 seat_history。
 * 不计入角色配额 / 商业运行授权。
 */
export async function deactivateSeat(
  enterpriseId: string,
  seatId: string,
  storePath?: string,
  effectiveAt?: string,
): Promise<{ seat: Seat; closed: SeatHistoryInterval | null } | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(enterpriseId);
    const seat = store.seats[seatId];
    if (!seat || seat.enterpriseId !== t) {
      return null;
    }
    const status = resolveSeatStatus(seat);
    if (status === "removed") {
      throw new SeatLifecycleError(`席位 ${seatId} 已 removed，不可 deactivate`);
    }
    if (status === "inactive") {
      // 幂等：已 inactive
      return { seat, closed: null };
    }
    const explicit = effectiveAt !== undefined;
    const now = effectiveAt ?? new Date().toISOString();
    // 显式 effectiveAt <= open.startTime → 拒绝
    const closedResult = closeOpenInterval(store, seatId, now, "deactivate", explicit);
    const closed = closedResult?.closed ?? null;
    if (!closed) {
      const updated: Seat = { ...seat, status: "inactive", updatedAt: now };
      store.seats[seatId] = updated;
      await saveStore(store, storePath);
      return { seat: updated, closed: null };
    }
    const updated: Seat = {
      ...seat,
      status: "inactive",
      updatedAt: closed.endTime ?? now,
    };
    store.seats[seatId] = updated;
    assertSeatHistoryInvariants(store.history, seatId);
    await saveStore(store, storePath);
    return { seat: updated, closed };
  });
}

/**
 * 移除席位：active|inactive → removed，关闭开放区间。
 * 不可再 reactivate（须重新 assign）。
 */
export async function removeSeat(
  enterpriseId: string,
  seatId: string,
  storePath?: string,
  effectiveAt?: string,
): Promise<{ seat: Seat; closed: SeatHistoryInterval | null } | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(enterpriseId);
    const seat = store.seats[seatId];
    if (!seat || seat.enterpriseId !== t) {
      return null;
    }
    if (resolveSeatStatus(seat) === "removed") {
      // 幂等：已 removed
      return { seat, closed: null };
    }
    const explicit = effectiveAt !== undefined;
    const now = effectiveAt ?? new Date().toISOString();
    let closed: SeatHistoryInterval | null = null;
    if (findOpenInterval(store.history, seatId)) {
      const closedResult = closeOpenInterval(store, seatId, now, "remove", explicit);
      closed = closedResult?.closed ?? null;
    }
    const updated: Seat = {
      ...seat,
      status: "removed",
      updatedAt: closed?.endTime ?? now,
    };
    store.seats[seatId] = updated;
    assertSeatHistoryInvariants(store.history, seatId);
    await saveStore(store, storePath);
    return { seat: updated, closed };
  });
}

/**
 * 重新激活：inactive → active，开启新 history 区间。
 * 强制唯一 active + 锁内角色配额；removed 不可恢复。
 * effectiveAt < latestClosed.endTime → 拒绝；== endTime 允许（半开衔接）。
 * 已 active 且有 open → 幂等直接返回。
 *
 * @param effectiveAtOrOptions 兼容旧签名：string = effectiveAt；或 { effectiveAt, roleQuota }
 */
export async function reactivateSeat(
  enterpriseId: string,
  seatId: string,
  storePath?: string,
  effectiveAtOrOptions?: string | SeatWriteOptions,
): Promise<{ seat: Seat; opened: SeatHistoryInterval } | null> {
  const opts = parseWriteOptions(effectiveAtOrOptions);
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(enterpriseId);
    const seat = store.seats[seatId];
    if (!seat || seat.enterpriseId !== t) {
      return null;
    }
    const status = resolveSeatStatus(seat);
    if (status === "removed") {
      throw new SeatLifecycleError(`席位 ${seatId} 已 removed，不可 reactivate；请重新 assign`);
    }
    if (status === "active") {
      const open = findOpenInterval(store.history, seatId);
      if (open) {
        // 幂等：已 active 且有 open
        return { seat, opened: open };
      }
    }
    const normalizedUser = normalizeSeatUserId(seat.userId);
    const otherActive = findActiveSeatForUser(store, t, normalizedUser);
    if (otherActive && otherActive.id !== seatId) {
      throw new DuplicateActiveSeatError(t, normalizedUser, otherActive.id);
    }
    assertRoleQuotaOrThrow(store, t, seat.currentRole, opts.roleQuota);
    const explicit = opts.effectiveAt !== undefined;
    let at = opts.effectiveAt ?? new Date().toISOString();
    if (findOpenInterval(store.history, seatId)) {
      const closedResult = closeOpenInterval(store, seatId, at, "reactivate", explicit);
      if (closedResult) {
        at = closedResult.nextStart;
      }
    }
    // 显式 effectiveAt < latestClosed.endTime → 拒绝；隐式 now 若更早则对齐到 end（钟分辨率）
    const latestEnd = latestClosedEndTime(store.history, seatId);
    if (latestEnd != null) {
      const atMs = Date.parse(at);
      const endMs = Date.parse(latestEnd);
      if (Number.isFinite(atMs) && Number.isFinite(endMs) && atMs < endMs) {
        if (explicit) {
          throw new SeatLifecycleError(
            `reactivate: effectiveAt must be >= latestClosed.endTime (${at} < ${latestEnd})`,
          );
        }
        at = latestEnd;
      }
    } else if (explicit) {
      assertReactivateEffectiveAt(store.history, seatId, at);
    }
    const opened: SeatHistoryInterval = {
      id: `sh-${randomUUID()}`,
      seatId,
      enterpriseId: t,
      role: seat.currentRole,
      startTime: at,
      endTime: null,
    };
    store.history = appendLedgerRecord(store.history, opened);
    const updated: Seat = { ...seat, status: "active", updatedAt: at };
    store.seats[seatId] = updated;
    assertSeatHistoryInvariants(store.history, seatId);
    await saveStore(store, storePath);
    return { seat: updated, opened };
  });
}

export type ListSeatsOptions = {
  /** 缺省列出全部；传入则仅匹配状态（历史缺 status 视为 active）。 */
  status?: SeatStatus | SeatStatus[];
};

export async function listSeats(
  enterpriseId: string,
  storePath?: string,
  options?: ListSeatsOptions,
): Promise<Seat[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  let seats = Object.values(store.seats).filter((s) => s.enterpriseId === t);
  if (options?.status) {
    const allowed = new Set(Array.isArray(options.status) ? options.status : [options.status]);
    seats = seats.filter((s) => allowed.has(resolveSeatStatus(s)));
  }
  return seats.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 按 userId 查找 **active** 计费席位（商业运行真源）。 */
export async function findBillingSeatByUserId(
  enterpriseId: string,
  userId: string,
  storePath?: string,
): Promise<Seat | null> {
  const normalized = normalizeSeatUserId(userId);
  if (!normalized) {
    return null;
  }
  const seats = await listSeats(enterpriseId, storePath, { status: "active" });
  return (
    seats
      .filter((seat) => normalizeSeatUserId(seat.userId) === normalized)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
  );
}

export async function getSeat(
  enterpriseId: string,
  seatId: string,
  storePath?: string,
): Promise<Seat | null> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  const seat = store.seats[seatId];
  if (!seat || seat.enterpriseId !== t) {
    return null;
  }
  return seat;
}

export async function listSeatIntervals(
  enterpriseId: string,
  storePath?: string,
): Promise<SeatHistoryInterval[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return store.history
    .filter((iv) => iv.enterpriseId === t)
    .toSorted((a, b) => a.startTime.localeCompare(b.startTime));
}

/** 统计各角色 **active** 席位数（配额校验 / 超配治理）。 */
export async function countSeatsByRole(
  enterpriseId: string,
  storePath?: string,
): Promise<Partial<Record<SeatRole, number>>> {
  const seats = await listSeats(enterpriseId, storePath, { status: "active" });
  const counts: Partial<Record<SeatRole, number>> = {};
  for (const seat of seats) {
    counts[seat.currentRole] = (counts[seat.currentRole] ?? 0) + 1;
  }
  return counts;
}

export async function __resetSeatsForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
