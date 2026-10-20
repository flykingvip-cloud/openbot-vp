/**
 * Bot 资源 store（按 enterpriseId 隔离）。软删保留历史（R20）。
 *
 * 落盘：`CONFIG_DIR/openbot-billing-resources.json`。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { canonicalizeTenantId } from "../tenant-canonicalization.js";
import type { BotResource } from "./types.js";

const RESOURCES_STORE_VERSION = 1;

type ResourcesStore = {
  version: number;
  bots: Record<string, BotResource>;
  /** 各用户可创建 Bot 上限（key=`${enterpriseId}:${userId}`）。 */
  userLimits: Record<string, number>;
};

function createEmptyStore(): ResourcesStore {
  return { version: RESOURCES_STORE_VERSION, bots: {}, userLimits: {} };
}

export function resolveDefaultBotResourcesStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-billing-resources.json");
}

const withLock = createAsyncLock();

function tenant(enterpriseId: string): string {
  return canonicalizeTenantId(enterpriseId) ?? enterpriseId;
}

function limitKey(enterpriseId: string, userId: string): string {
  return `${tenant(enterpriseId)}:${userId}`;
}

async function loadStore(storePath?: string): Promise<ResourcesStore> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultBotResourcesStorePath());
  const parsed = await readJsonFile<Partial<ResourcesStore>>(resolvedPath);
  if (!parsed) {
    return createEmptyStore();
  }
  return {
    version: RESOURCES_STORE_VERSION,
    bots: parsed.bots ?? {},
    userLimits: parsed.userLimits ?? {},
  };
}

async function saveStore(store: ResourcesStore, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultBotResourcesStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

function activeBots(store: ResourcesStore, enterpriseId: string): BotResource[] {
  const t = tenant(enterpriseId);
  return Object.values(store.bots).filter((b) => b.enterpriseId === t && b.deletedAt === null);
}

export async function listActiveBots(
  enterpriseId: string,
  storePath?: string,
): Promise<BotResource[]> {
  const store = await loadStore(storePath);
  return activeBots(store, enterpriseId);
}

export async function findActiveBotById(
  enterpriseId: string,
  botId: string,
  storePath?: string,
): Promise<BotResource | null> {
  const id = botId.trim();
  if (!id) {
    return null;
  }
  const store = await loadStore(storePath);
  const bot = store.bots[id];
  if (!bot || bot.enterpriseId !== tenant(enterpriseId) || bot.deletedAt !== null) {
    return null;
  }
  return bot;
}

/** 含软删记录，供 Bot 增长趋势统计。 */
export async function listEnterpriseBotHistory(
  enterpriseId: string,
  storePath?: string,
): Promise<BotResource[]> {
  const store = await loadStore(storePath);
  const t = tenant(enterpriseId);
  return Object.values(store.bots).filter((b) => b.enterpriseId === t);
}

export async function countActiveBots(enterpriseId: string, storePath?: string): Promise<number> {
  return (await listActiveBots(enterpriseId, storePath)).length;
}

/**
 * 按账期时点重建活跃 Bot 数（历史结算不得读「当前」数量）。
 * 判定：createdAt < atIso 且 (deletedAt == null || deletedAt >= atIso)。
 */
export async function countActiveBotsAt(
  enterpriseId: string,
  atIso: string,
  storePath?: string,
): Promise<number> {
  const at = new Date(atIso).getTime();
  if (!Number.isFinite(at)) {
    return countActiveBots(enterpriseId, storePath);
  }
  const history = await listEnterpriseBotHistory(enterpriseId, storePath);
  return history.filter((b) => {
    const created = new Date(b.createdAt).getTime();
    if (!Number.isFinite(created) || created >= at) {
      return false;
    }
    if (b.deletedAt == null) {
      return true;
    }
    const deleted = new Date(b.deletedAt).getTime();
    return Number.isFinite(deleted) && deleted >= at;
  }).length;
}

export async function countActiveBotsByUser(
  enterpriseId: string,
  userId: string,
  storePath?: string,
): Promise<number> {
  const bots = await listActiveBots(enterpriseId, storePath);
  return bots.filter((b) => b.ownerUserId === userId).length;
}

export async function getUserBotLimit(
  enterpriseId: string,
  userId: string,
  storePath?: string,
): Promise<number | null> {
  const store = await loadStore(storePath);
  const value = store.userLimits[limitKey(enterpriseId, userId)];
  return typeof value === "number" ? value : null;
}

export async function setUserBotLimit(
  enterpriseId: string,
  userId: string,
  limit: number,
  storePath?: string,
): Promise<void> {
  await withLock(async () => {
    const store = await loadStore(storePath);
    store.userLimits[limitKey(enterpriseId, userId)] = limit;
    await saveStore(store, storePath);
  });
}

export type CreateBotOptions = {
  ownerSeatId?: string;
  visibility?: BotResource["visibility"];
  /** 来源 agentId；提供时按 (enterpriseId, sourceAgentId) 幂等。 */
  sourceAgentId?: string;
  storePath?: string;
};

function findActiveBySource(
  store: ResourcesStore,
  enterpriseId: string | null,
  sourceAgentId: string,
): BotResource | null {
  const t = enterpriseId === null ? null : tenant(enterpriseId);
  return (
    Object.values(store.bots).find(
      (b) =>
        b.deletedAt === null &&
        b.sourceAgentId === sourceAgentId &&
        (t === null || b.enterpriseId === t),
    ) ?? null
  );
}

/**
 * 创建计费 Bot，并告知是否为新建。
 *
 * 带 `sourceAgentId` 时在同一把锁内查重：已有同源活跃 Bot 则直接返回（created=false），
 * 重试 / 并发重复登记不会重复计数。
 */
export async function createBotWithStatus(
  enterpriseId: string,
  ownerUserId: string,
  opts?: CreateBotOptions,
): Promise<{ bot: BotResource; created: boolean }> {
  return withLock(async () => {
    const store = await loadStore(opts?.storePath);
    const t = tenant(enterpriseId);
    const sourceAgentId = opts?.sourceAgentId?.trim() || undefined;
    if (sourceAgentId) {
      const existing = findActiveBySource(store, enterpriseId, sourceAgentId);
      if (existing) {
        return { bot: existing, created: false };
      }
    }
    const bot: BotResource = {
      id: `bot-${randomUUID()}`,
      enterpriseId: t,
      ownerUserId,
      ...(opts?.ownerSeatId?.trim() ? { ownerSeatId: opts.ownerSeatId.trim() } : {}),
      visibility: opts?.visibility ?? "private",
      ...(sourceAgentId ? { sourceAgentId } : {}),
      createdAt: new Date().toISOString(),
      deletedAt: null,
    };
    store.bots[bot.id] = bot;
    await saveStore(store, opts?.storePath);
    return { bot, created: true };
  });
}

export async function createBot(
  enterpriseId: string,
  ownerUserId: string,
  opts?: CreateBotOptions,
): Promise<BotResource> {
  return (await createBotWithStatus(enterpriseId, ownerUserId, opts)).bot;
}

/**
 * 按来源 agentId 查活跃计费 Bot。`enterpriseId` 为 null 时跨企业查找
 * （网关内 agentId 全局唯一，供删除路径在拿不到租户时使用）。
 */
export async function findActiveBotBySourceAgentId(
  enterpriseId: string | null,
  sourceAgentId: string,
  storePath?: string,
): Promise<BotResource | null> {
  const id = sourceAgentId.trim();
  if (!id) {
    return null;
  }
  const store = await loadStore(storePath);
  return findActiveBySource(store, enterpriseId, id);
}

export async function deleteBot(
  enterpriseId: string,
  botId: string,
  storePath?: string,
): Promise<BotResource | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(enterpriseId);
    const bot = store.bots[botId];
    if (!bot || bot.enterpriseId !== t || bot.deletedAt !== null) {
      return null;
    }
    const updated: BotResource = { ...bot, deletedAt: new Date().toISOString() };
    store.bots[botId] = updated;
    await saveStore(store, storePath);
    return updated;
  });
}

/** 更新 Bot 归属与可见性（共享 / 交接场景）。 */
export async function updateBotGovernance(
  enterpriseId: string,
  botId: string,
  patch: {
    ownerSeatId?: string | null;
    visibility?: BotResource["visibility"];
  },
  storePath?: string,
): Promise<BotResource | null> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const t = tenant(enterpriseId);
    const bot = store.bots[botId];
    if (!bot || bot.enterpriseId !== t || bot.deletedAt !== null) {
      return null;
    }
    const next: BotResource = { ...bot };
    if (patch.ownerSeatId !== undefined) {
      const seatId = patch.ownerSeatId?.trim();
      next.ownerSeatId = seatId ? seatId : undefined;
    }
    if (patch.visibility !== undefined) {
      next.visibility = patch.visibility;
    }
    store.bots[botId] = next;
    await saveStore(store, storePath);
    return next;
  });
}

/** 按用户聚合的活跃 Bot 数量。 */
export async function botCountsByUser(
  enterpriseId: string,
  storePath?: string,
): Promise<Record<string, number>> {
  const bots = await listActiveBots(enterpriseId, storePath);
  const counts: Record<string, number> = {};
  for (const bot of bots) {
    counts[bot.ownerUserId] = (counts[bot.ownerUserId] ?? 0) + 1;
  }
  return counts;
}

export async function __resetBotResourcesForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
