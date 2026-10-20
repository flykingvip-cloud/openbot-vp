/**
 * 企业能力中心 — 适用范围可见性规则（Scope-Based Visibility）
 *
 * 本模块实现 design.md 中的 Property 7（Scope-based visibility）：
 *
 * 对于已发布能力的 ApplicableScope 与任意员工：
 *
 * - `enterprise` → 对全部员工可见
 * - `department` → 当且仅当员工的 `departmentId` 等于 `scope.id` 时可见
 * - `group`      → 当且仅当 `scope.id` ∈ 员工的 `groupIds` 时可见
 * - `role`       → 当且仅当 `scope.id` ∈ 员工的 `roleIds` 时可见
 *
 * 设计要点：
 * - 纯函数，无副作用
 * - 严格 TypeScript，无 any
 * - 通过 discriminated union 的 `kind` 进行穷尽匹配，
 *   未来新增 ApplicableScope 类型时由 TypeScript 守护编译报错
 *
 * Validates: Requirements 8.1, 8.9
 */

import type { ApplicableScope } from "../../capability/enterprise-capability/types.ts";

/**
 * 员工上下文：判定可见性所需的最小员工属性投影。
 *
 * - `employeeId`：员工唯一标识
 * - `departmentId`：员工所属部门 id
 * - `groupIds`：员工所属协作小组 id 列表
 * - `roleIds`：员工拥有的角色 id 列表
 *
 * 该类型有意保持小而精，使本模块不与员工领域模型耦合。
 */
export type EmployeeContext = {
  employeeId: string;
  departmentId: string;
  groupIds: string[];
  roleIds: string[];
};

/**
 * Property 7 — 基于 ApplicableScope 的可见性判定。
 *
 * 返回值含义：
 *
 * - `true`  — 该能力对该员工可见
 * - `false` — 不可见
 *
 * 注意：本函数仅判定 ApplicableScope 对员工的可见性，
 * 不判定能力的 lifecycle / health 状态；调用方应先确保能力已发布。
 */
export function isCapabilityVisibleToEmployee(
  scope: ApplicableScope,
  employee: EmployeeContext,
): boolean {
  switch (scope.kind) {
    case "enterprise":
      return true;
    case "department":
      return scope.id === employee.departmentId;
    case "group":
      return employee.groupIds.includes(scope.id);
    case "role":
      return employee.roleIds.includes(scope.id);
    default: {
      // 穷尽性检查：未来新增 ApplicableScope 类型时会在此报编译错
      const _exhaustive: never = scope;
      void _exhaustive;
      return false;
    }
  }
}
