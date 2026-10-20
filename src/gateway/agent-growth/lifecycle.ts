/**
 * Agent Growth OS — 生命周期推导与激活转移（spec: agent-growth-lifecycle, P0A 任务 2.2）。
 *
 * 纯函数：禁止调用方手写 lifecycleState（design §3.3）。
 */

import { recordMilestone } from "./milestones.js";
import type { GrowthStatus, LifecycleState } from "./types.js";

/**
 * 由当前 GrowthStatus 推导互斥生命周期（design §3.3）。
 *
 * 规则优先级：
 *  1. 已激活且有成长报告 → evolution
 *  2. 已激活 → activated
 *  3. activationScore 达阈值 且 capabilityReadiness（小组另需 alignmentComplete）→ mission_ready
 *  4. 刚创建、尚未开过会话 → birth
 *  5. 其余 → growing
 */
export function deriveLifecycleState(g: GrowthStatus, threshold: number): LifecycleState {
  if (g.isActivated && g.growthReport) {
    return "evolution";
  }
  if (g.isActivated) {
    return "activated";
  }
  const alignmentOk = g.alignmentComplete !== false; // 机器人无 alignment 字段时视为通过
  if (g.activationScore >= threshold && g.capabilityReadiness && alignmentOk) {
    return "mission_ready";
  }
  if (!g.milestones.sessionOpenedAtMs && g.lifecycleState === "birth") {
    return "birth";
  }
  return "growing";
}

/** 激活事件：首个有效任务成功。 */
export type ActivationEvent = {
  type: "first_mission_success";
  atMs: number;
};

/**
 * 应用激活转移：写入 firstMissionSuccessAtMs / activatedAtMs，置 isActivated=true。
 * 幂等：已激活则原样返回。返回新对象。
 */
export function applyActivationTransition(g: GrowthStatus, event: ActivationEvent): GrowthStatus {
  if (event.type !== "first_mission_success") {
    return g;
  }
  if (g.isActivated) {
    return g;
  }
  let milestones = recordMilestone(g.milestones, "firstMissionSuccessAtMs", event.atMs);
  milestones = recordMilestone(milestones, "activatedAtMs", event.atMs);
  return {
    ...g,
    isActivated: true,
    activatedAtMs: g.activatedAtMs ?? event.atMs,
    milestones,
  };
}
