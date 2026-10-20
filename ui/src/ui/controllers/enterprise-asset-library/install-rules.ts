/**
 * 企业能力中心 — 安装约束规则（Install Constraints）
 *
 * 本模块实现 design.md 中 Property 8 的两个子约束：
 *
 * - Property 8a：能力的 `AssetLifecycle` 必须为 `published`，
 *   且 `healthStatus` 不为"已不适合继续推广"。
 * - Property 8c：安装目标必须是机器人（kind === "robot" 且具备 robotId）；
 *   员工 / 部门 / 协作小组 等非机器人目标一律拒绝。
 *
 * 设计要点：
 * - 纯函数，无副作用
 * - 严格 TypeScript，无 any
 * - 仅判定与原因描述，不修改输入
 *
 * Validates: Requirements 6.4, 8.2, 8.3, 8.12
 */

import type { EnterpriseCapabilityAsset } from "../../capability/enterprise-capability/types.ts";

/**
 * 安装规则统一返回类型。
 *
 * - `ok: true` — 通过校验
 * - `ok: false` — 拒绝；`reason` 为业务语言原因，可直接展示给管理员或员工
 */
export type InstallValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Property 8a — 能力安装的生命周期与健康前提。
 *
 * 拒绝条件：
 *
 * - `lifecycle !== "published"`：能力尚未发布或已下线，不允许安装
 * - `healthStatus === "已不适合继续推广"`：管理员已标记停用，禁止新装载
 *
 * 通过则返回 `{ ok: true }`，调用方可继续 Property 8c 的目标校验。
 */
export function canInstallCapability(
  asset: Pick<EnterpriseCapabilityAsset, "lifecycle" | "healthStatus">,
): InstallValidationResult {
  if (asset.lifecycle !== "published") {
    return { ok: false, reason: "仅已发布能力可安装" };
  }
  if (asset.healthStatus === "已不适合继续推广") {
    return { ok: false, reason: "该能力已不推荐使用，无法安装" };
  }
  return { ok: true };
}

/**
 * 安装目标 discriminated union。
 *
 * - `kind: "robot"` 时必须携带 `robotId`，且 `robotId` 不能为空字符串
 * - 其他 kind（员工 / 部门 / 协作小组）一律拒绝；列举出来是为了让
 *   类型层面就阻止误传非机器人目标
 */
export type InstallTarget =
  | { kind: "robot"; robotId: string }
  | { kind: "employee" | "department" | "group" };

/**
 * Property 8c — 安装目标必须为机器人。
 *
 * - `kind === "robot"` 且 `robotId` 非空 → 通过
 * - 其他任何 kind 或缺失/为空的 robotId → 拒绝
 *
 * 业务语义：能力安装的最终载体仅可以是机器人；
 * "安装到员工"、"安装到部门"、"安装到协作小组" 在企业能力中心一律不支持。
 */
export function validateInstallTarget(target: InstallTarget): InstallValidationResult {
  if (target.kind !== "robot") {
    return {
      ok: false,
      reason: "能力只能安装到机器人，无法安装到员工、部门或协作小组",
    };
  }
  if (typeof target.robotId !== "string" || target.robotId.trim().length === 0) {
    return { ok: false, reason: "未指定目标机器人" };
  }
  return { ok: true };
}
