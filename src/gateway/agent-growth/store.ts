/**
 * Agent Growth OS — 持久化（spec: agent-growth-lifecycle, P0A 任务 1.2）。
 *
 * 机器人：`{agentDir}/growth-status.json`（agentDir 由 resolveAgentDir 解析）。
 * 权威存储：**JSON 文档**（class=D），非 SQL；与 `ai-workforce-governance/shared/db-schema.ts`
 * 的逻辑表模型分离——后者为分析投影目标，见 openbot-persistence-engine-matrix-2026-07-13。
 * 小组：存于 collaboration operating-state.json 的 `growthStatus` 字段，由 spaces 层
 *       （readGroupOperatingState / writeGroupOperatingState）读写——见 server-methods/spaces。
 *
 * 本模块仅负责机器人侧落盘 + 低层文件读写，保持无 collaboration 依赖，便于单测。
 */

import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { type AgentGrowthPathOpts, resolveGrowthAgentDir } from "./tenant-agent-dir.js";
import type { GrowthStatus } from "./types.js";

export const GROWTH_STATUS_FILENAME = "growth-status.json";

/** 解析机器人 growth-status.json 路径。 */
export function resolveRobotGrowthStatusPath(
  cfg: OpenBotConfig,
  agentId: string,
  opts?: AgentGrowthPathOpts,
): string {
  return path.join(resolveGrowthAgentDir(cfg, agentId, opts), GROWTH_STATUS_FILENAME);
}

// 串行化同一进程内的读改写，避免并发 recompute 互相覆盖。
const lock = createAsyncLock();

/** 读取机器人 GrowthStatus；不存在返回 null。 */
export async function readRobotGrowthStatus(
  cfg: OpenBotConfig,
  agentId: string,
  opts?: AgentGrowthPathOpts,
): Promise<GrowthStatus | null> {
  return await readJsonFile<GrowthStatus>(resolveRobotGrowthStatusPath(cfg, agentId, opts));
}

/** 原子写入机器人 GrowthStatus。 */
export async function writeRobotGrowthStatus(
  cfg: OpenBotConfig,
  agentId: string,
  status: GrowthStatus,
  opts?: AgentGrowthPathOpts,
): Promise<void> {
  await writeJsonAtomic(resolveRobotGrowthStatusPath(cfg, agentId, opts), status);
}

/** 在锁内对机器人 GrowthStatus 做读改写（updater 返回 null 表示不写）。 */
export async function updateRobotGrowthStatus(
  cfg: OpenBotConfig,
  agentId: string,
  updater: (current: GrowthStatus | null) => GrowthStatus | null,
  opts?: AgentGrowthPathOpts,
): Promise<GrowthStatus | null> {
  return await lock(async () => {
    const current = await readRobotGrowthStatus(cfg, agentId, opts);
    const next = updater(current);
    if (next === null) {
      return current;
    }
    await writeRobotGrowthStatus(cfg, agentId, next, opts);
    return next;
  });
}
