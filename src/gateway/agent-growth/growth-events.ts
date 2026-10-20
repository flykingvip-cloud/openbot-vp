/**
 * Agent growth lifecycle broadcasts (mission_ready, activated, false_ready_detected).
 * Shared by RPC recompute paths and background operational-metrics recompute.
 *
 * 模块边界说明：`emitGrowthEvents` 原本内联在 `server-methods/agent-growth.ts` 里，这里
 * 抽成独立模块以**对齐 main 上已存在的引用面**（`background-recompute.ts` 与
 * `server.impl.ts` 都按这个路径 import），避免合并时在 agent-growth.ts 上产生冲突。
 *
 * `registerGrowthEventBroadcast` / `getGrowthEventBroadcast` 目前在本分支还没有调用方：
 * 它们的消费者是 `background-recompute.ts`（后台重算）与 gateway 启动注册，而
 * `background-recompute.ts` 依赖 `tenant-agent-dir.ts` → `tenant-context.ts`，属另一条
 * 恢复线（见 main 恢复路由 L2）。这不是投机性接口——main 上已有两个文件按这组名字
 * import，先补齐边界是为了让那条线落地时不必再改本文件。
 */

import { detectFalseReady } from "./operational-score.js";
import type { GrowthStatus } from "./types.js";

export type GrowthBroadcast = (event: string, payload: unknown) => void;

let registeredBroadcast: GrowthBroadcast | undefined;

/** Gateway startup registers WS broadcast; tests may inject a spy. */
export function registerGrowthEventBroadcast(broadcast: GrowthBroadcast | undefined): void {
  registeredBroadcast = broadcast;
}

export function getGrowthEventBroadcast(): GrowthBroadcast | undefined {
  return registeredBroadcast;
}

/**
 * Broadcast when lifecycle / false-ready crosses thresholds (R7.4/7.5, R16).
 */
export function emitGrowthEvents(
  broadcast: GrowthBroadcast | undefined,
  ref: { idKey: "agentId" | "groupId"; id: string },
  prev: GrowthStatus | null,
  next: GrowthStatus,
): void {
  if (!broadcast) {
    return;
  }
  const base = { [ref.idKey]: ref.id, lifecycleState: next.lifecycleState, ts: Date.now() };
  if (prev?.lifecycleState !== "mission_ready" && next.lifecycleState === "mission_ready") {
    broadcast("agent_growth.mission_ready", { ...base, activationScore: next.activationScore });
  }
  if (!prev?.isActivated && next.isActivated) {
    broadcast("agent_growth.activated", { ...base, activatedAtMs: next.activatedAtMs ?? null });
  }
  const prevFalseReady = prev
    ? detectFalseReady(prev.activationScore, prev.operationalScore)
    : false;
  const nextFalseReady = detectFalseReady(next.activationScore, next.operationalScore);
  if (!prevFalseReady && nextFalseReady) {
    broadcast("agent_growth.false_ready_detected", {
      ...base,
      activationScore: next.activationScore,
      operationalScore: next.operationalScore,
    });
  }
}
