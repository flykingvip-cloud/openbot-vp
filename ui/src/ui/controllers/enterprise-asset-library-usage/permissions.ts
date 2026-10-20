/**
 * Permission helpers for the "能力使用管理" (Enterprise Capability Usage Management) module.
 *
 * 该模块的权限模型从旧的「企业代理」迁移而来：
 * - `agent:view`   → `usage:view`           （查看能力使用）
 * - `agent:create` → `usage:install-manage` （管理能力安装）
 *
 * 兼容窗口（≥ 1 个发布周期，对应 Requirement 2.8）：
 * UI 端的 `ACCESS_PERMISSION_CATALOG` 不再展示 `agent:view` / `agent:create`，
 * 但服务端校验与本模块的访问判断 SHALL 继续把旧权限位按等价权限处理，
 * 以避免在权限位尚未全量回填到新值时把企业管理员误锁在外面。
 *
 * 本文件仅做 **运行时** 的兼容映射；目录层（catalog）的迁移见
 * `ui/src/ui/ports/enterprise/views/enterprise-surfaces.ts` 中的
 * `ACCESS_PERMISSION_CATALOG` 与 `ACCESS_ROLE_PERMISSIONS`。
 */

/**
 * 旧权限位到新权限位的等价映射。在兼容窗口结束后，此 record 可整表删除——
 * 同时移除三个 `canXxx` 函数对其的引用即可。
 */
const LEGACY_PERMISSION_EQUIVALENCE: Record<string, string> = {
  "agent:view": "usage:view",
  "agent:create": "usage:install-manage",
};

/** 仅为权限判断需要的最小用户视图，避免与上层 user 模型耦合。 */
type UserPermissions = { permissions: readonly string[] };

/**
 * 判断用户是否可访问「能力使用管理」模块。
 *
 * 等价于：用户持有 `usage:view` 或者持有可映射为 `usage:view` 的旧权限位
 * （目前仅 `agent:view`）。
 */
export function canAccessUsageManagement(user: UserPermissions): boolean {
  return user.permissions.some(
    (permission) =>
      permission === "usage:view" || LEGACY_PERMISSION_EQUIVALENCE[permission] === "usage:view",
  );
}

/**
 * 判断用户是否可在「能力安装管理」执行卸载等管理操作。
 *
 * 等价于：用户持有 `usage:install-manage` 或者持有可映射为
 * `usage:install-manage` 的旧权限位（目前仅 `agent:create`）。
 */
export function canManageInstall(user: UserPermissions): boolean {
  return user.permissions.some(
    (permission) =>
      permission === "usage:install-manage" ||
      LEGACY_PERMISSION_EQUIVALENCE[permission] === "usage:install-manage",
  );
}

/**
 * 判断用户是否可在「使用治理」处理治理问题（acknowledge / 执行建议操作）。
 *
 * 该权限是新模块独有，没有旧权限位与之等价；因此仅做严格比对。
 */
export function canHandleGovernance(user: UserPermissions): boolean {
  return user.permissions.includes("usage:governance");
}
