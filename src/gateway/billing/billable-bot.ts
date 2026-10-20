/**
 * 计费 Bot 的统一创建 / 释放入口。
 *
 * `resources.create-bot` 与产品侧数字人创建（`agents.create` 企业路径）共用同一套
 * 商业闸口（authorizeCommercialRun bot_create）+ 用户级上限 + 登记逻辑，确保：
 * - 任何创建入口都不能绕过 Bot 配额 / 预算 / 订阅闸口；
 * - 登记后「已用 AI 员工」与「各用户 Bot 分布」（resources.summary）同步计数；
 * - 带 sourceAgentId 时幂等，重试不重复计数；删除数字人时软删对应计费 Bot。
 */

import { authorizeCommercialRun } from "./authorize-commercial-run.js";
import {
  countActiveBotsByUser,
  createBotWithStatus,
  deleteBot,
  findActiveBotBySourceAgentId,
  getUserBotLimit,
} from "./bot-resources-store.js";
import { billingEventBus } from "./event-bus.js";
import { refreshEnterpriseOverAllocationIfSubscribed } from "./refresh-enterprise-over-allocation.js";
import { findBillingSeatByUserId } from "./seats-store.js";
import type { BotResource } from "./types.js";

export type BillableBotStorePaths = {
  bots?: string;
  seats?: string;
};

export type BillableBotGateResult =
  | {
      allowed: true;
      /** 同源 agent 已登记过的活跃 Bot（幂等重试）。 */ existing: BotResource | null;
    }
  | { allowed: false; message: string };

/**
 * 创建前闸口：商业授权（预算 + 订阅 + Bot 配额 + 超配）与用户级 Bot 上限。
 *
 * 带 `sourceAgentId` 且已有同源活跃 Bot 时直接放行（不占新配额），用于重试幂等。
 */
export async function authorizeBillableBotCreate(params: {
  enterpriseId: string;
  ownerUserId: string;
  sourceAgentId?: string | null;
  storePaths?: BillableBotStorePaths;
}): Promise<BillableBotGateResult> {
  const sourceAgentId = params.sourceAgentId?.trim();
  if (sourceAgentId) {
    const existing = await findActiveBotBySourceAgentId(
      params.enterpriseId,
      sourceAgentId,
      params.storePaths?.bots,
    );
    if (existing) {
      return { allowed: true, existing };
    }
  }
  // 统一商业闸口（P0）：预算 + Bot 配额。
  const commercialAuth = await authorizeCommercialRun({
    enterpriseId: params.enterpriseId,
    action: "bot_create",
    ...(params.storePaths?.bots ? { storePaths: { botResources: params.storePaths.bots } } : {}),
  });
  if (!commercialAuth.skipped && !commercialAuth.allowed) {
    return { allowed: false, message: commercialAuth.message };
  }
  // 用户级 Bot 上限（非订阅商业约束，P1 ownership 落地后迁移）。
  const userLimit = await getUserBotLimit(
    params.enterpriseId,
    params.ownerUserId,
    params.storePaths?.bots,
  );
  if (userLimit !== null) {
    const userUsed = await countActiveBotsByUser(
      params.enterpriseId,
      params.ownerUserId,
      params.storePaths?.bots,
    );
    if (userUsed >= userLimit) {
      return { allowed: false, message: `该用户 Bot 数量已达上限（${userLimit}）。` };
    }
  }
  return { allowed: true, existing: null };
}

/**
 * 登记计费 Bot（不含闸口；调用方须先过 {@link authorizeBillableBotCreate}）。
 *
 * 有计费席位时挂 ownerSeatId。仅在真正新建时发布 bot.changed 并刷新超配。
 */
export async function registerBillableBot(params: {
  enterpriseId: string;
  ownerUserId: string;
  sourceAgentId?: string | null;
  visibility?: BotResource["visibility"];
  storePaths?: BillableBotStorePaths;
}): Promise<{ bot: BotResource; created: boolean }> {
  const billingSeat = await findBillingSeatByUserId(
    params.enterpriseId,
    params.ownerUserId,
    params.storePaths?.seats,
  );
  const sourceAgentId = params.sourceAgentId?.trim();
  return createBotWithStatus(params.enterpriseId, params.ownerUserId, {
    ...(billingSeat ? { ownerSeatId: billingSeat.id } : {}),
    visibility: params.visibility ?? "private",
    ...(sourceAgentId ? { sourceAgentId } : {}),
    ...(params.storePaths?.bots ? { storePath: params.storePaths.bots } : {}),
  });
}

/** 新建 / 删除后的下游通知：持久事件 + 超配重算。 */
export async function publishBillableBotChanged(params: {
  enterpriseId: string;
  bot: BotResource;
  action: "created" | "deleted";
}): Promise<void> {
  await billingEventBus.publish({
    type: "bot.changed",
    enterpriseId: params.enterpriseId,
    botId: params.bot.id,
    ownerUserId: params.bot.ownerUserId,
    action: params.action,
  });
  await refreshEnterpriseOverAllocationIfSubscribed(params.enterpriseId);
}

/**
 * 释放（软删）来源 agent 对应的计费 Bot。无对应记录时返回 null（幂等）。
 *
 * `enterpriseId` 为 null 时按 agentId 跨企业查找（网关内 agentId 唯一）。
 */
export async function releaseBillableBotForAgent(params: {
  enterpriseId: string | null;
  agentId: string;
  storePaths?: BillableBotStorePaths;
}): Promise<BotResource | null> {
  const existing = await findActiveBotBySourceAgentId(
    params.enterpriseId,
    params.agentId,
    params.storePaths?.bots,
  );
  if (!existing) {
    return null;
  }
  const deleted = await deleteBot(existing.enterpriseId, existing.id, params.storePaths?.bots);
  if (!deleted) {
    return null;
  }
  await publishBillableBotChanged({
    enterpriseId: deleted.enterpriseId,
    bot: deleted,
    action: "deleted",
  });
  return deleted;
}
