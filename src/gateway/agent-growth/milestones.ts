/**
 * Agent Growth OS — 成长漏斗里程碑（spec: agent-growth-lifecycle, P0A 任务 2.3）。
 *
 * first-write-wins 语义：同一 milestone 重复调用不覆盖更早的有效时间戳（R7.2）。
 */

import type { GrowthMilestones } from "./types.js";

/** 可记录的里程碑键（createdAtMs 在创建时写入，亦可幂等记录）。 */
export type RecordableMilestoneKey = keyof GrowthMilestones;

/**
 * 幂等写入里程碑时间戳。
 * - 若该键已有正有限值，则保留旧值（first-write-wins）。
 * - 否则写入 `atMs`。
 * 返回新对象（不可变更新），便于调用方比较是否变化。
 */
export function recordMilestone(
  milestones: GrowthMilestones,
  key: RecordableMilestoneKey,
  atMs: number,
): GrowthMilestones {
  const existing = milestones[key];
  if (typeof existing === "number" && Number.isFinite(existing) && existing > 0) {
    return milestones;
  }
  if (!Number.isFinite(atMs) || atMs <= 0) {
    return milestones;
  }
  return { ...milestones, [key]: atMs };
}

/** 创建空里程碑集合（仅 createdAtMs 必填）。 */
export function createMilestones(createdAtMs: number): GrowthMilestones {
  return { createdAtMs };
}
