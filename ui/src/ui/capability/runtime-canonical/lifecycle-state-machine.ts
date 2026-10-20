/**
 * Runtime Lifecycle 状态机 — Agent Runtime 部署生命周期的合法性闸门。
 *
 * 该状态机由 {@link RUNTIME_LIFECYCLE_TRANSITIONS} 在 `types.ts` 中以邻接表形式
 * 穷尽列举合法转换。本模块只提供对该邻接表的两个查询函数：
 *
 * - `canTransition(current, target)`        是否合法（boolean）
 * - `validateTransition(current, target)`   合法性 + 失败原因（discriminated union）
 *
 * 与企业端 `AssetLifecycle` 的关系：
 * 二者状态机**完全独立**——本状态机描述运行时实例的生死状态，前者描述能力资产
 * 的审批状态。即使存在同名值（例如 `deprecated`），其状态机邻接表、触发条件、
 * 投影目标均不一致。下游层只能通过 `projection.ts` 中的
 * `projectLifecycleToNotification` 消费本状态机的结果。
 */

import { RUNTIME_LIFECYCLE_TRANSITIONS, type RuntimeLifecycle } from "./types.ts";

/**
 * 检查从 `current` 转换到 `target` 是否合法。
 *
 * 合法当且仅当 `target` 在 {@link RUNTIME_LIFECYCLE_TRANSITIONS}[`current`] 中出现。
 *
 * 注意：自环（current === target）不被视为合法转换；调用方若希望允许"无变化"
 * 的语义，应在调用前先做相等判断而非依赖本函数。
 */
export function canTransition(current: RuntimeLifecycle, target: RuntimeLifecycle): boolean {
  const allowed = RUNTIME_LIFECYCLE_TRANSITIONS[current];
  return allowed.includes(target);
}

/** 校验结果。成功路径仅含 `ok: true`，失败路径携带可直接展示的中文原因。 */
export type LifecycleTransitionValidation = { ok: true } | { ok: false; reason: string };

/**
 * 校验生命周期转换并返回带原因的结果。
 *
 * 调用方约定：
 * - 收到 `{ ok: true }` 即可执行真实写入；
 * - 收到 `{ ok: false, reason }` 时应将 `reason` 作为人类可读提示展示给运维操作员；
 *
 * 失败原因经过分类，便于上层做差异化提示（例如自环误操作 vs 非法终态出度）。
 */
export function validateTransition(
  current: RuntimeLifecycle,
  target: RuntimeLifecycle,
): LifecycleTransitionValidation {
  if (current === target) {
    return {
      ok: false,
      reason: `已经处于 "${current}" 状态，无需转换`,
    };
  }
  if (canTransition(current, target)) {
    return { ok: true };
  }
  const allowed = RUNTIME_LIFECYCLE_TRANSITIONS[current];
  if (allowed.length === 0) {
    return {
      ok: false,
      reason: `"${current}" 是终态，不允许再转换到 "${target}"`,
    };
  }
  return {
    ok: false,
    reason: `"${current}" 不能转换到 "${target}"，仅允许 ${allowed.map((s) => `"${s}"`).join(" / ")}`,
  };
}

/**
 * 返回 `current` 状态的全部合法下一步状态（只读副本）。
 *
 * 用于 UI 渲染"操作"按钮：只展示合法转换，避免操作员尝试非法转换被拒绝。
 */
export function nextLifecycleStates(current: RuntimeLifecycle): readonly RuntimeLifecycle[] {
  return RUNTIME_LIFECYCLE_TRANSITIONS[current];
}

/**
 * 终态判定：当前状态是否再无任何合法出度。
 *
 * `archived` 是唯一的终态。
 */
export function isTerminalLifecycle(state: RuntimeLifecycle): boolean {
  return RUNTIME_LIFECYCLE_TRANSITIONS[state].length === 0;
}
