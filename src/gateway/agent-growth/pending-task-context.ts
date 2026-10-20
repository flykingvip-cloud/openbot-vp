/**
 * Agent Growth OS — P1 pendingTaskContext 读写（可覆盖，非 FWW）。
 */

import type { OpenBotConfig } from "../../config/config.js";
import { createInitialGrowthStatus } from "./factory.js";
import { updateRobotGrowthStatus } from "./store.js";
import type { GrowthPendingTaskContext, GrowthStatus } from "./types.js";

export function withPendingTaskContext(
  status: GrowthStatus,
  pending: GrowthPendingTaskContext | null,
): GrowthStatus {
  return {
    ...status,
    pendingTaskContext: pending,
  };
}

/** 写入 / 覆盖 pendingTaskContext；不存在 growth-status 时初始化。 */
export async function setRobotPendingTaskContext(
  cfg: OpenBotConfig,
  agentId: string,
  pending: GrowthPendingTaskContext,
): Promise<GrowthStatus | null> {
  return await updateRobotGrowthStatus(cfg, agentId, (current) => {
    const base = current ?? createInitialGrowthStatus({ kind: "robot", atMs: Date.now() });
    return withPendingTaskContext(base, pending);
  });
}

/** 清除 pendingTaskContext（忽略 / 发送成功后）。 */
export async function clearRobotPendingTaskContext(
  cfg: OpenBotConfig,
  agentId: string,
): Promise<GrowthStatus | null> {
  return await updateRobotGrowthStatus(cfg, agentId, (current) => {
    if (!current?.pendingTaskContext) {
      return null;
    }
    return withPendingTaskContext(current, null);
  });
}
