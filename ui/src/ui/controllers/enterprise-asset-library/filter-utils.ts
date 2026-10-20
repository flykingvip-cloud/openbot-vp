/**
 * 筛选与搜索工具函数（企业能力中心 · 全部能力表格）
 *
 * 实现 design.md 中：
 * - Property 12: Filter AND semantics
 *   多个激活筛选条件（关键词、使用场景、适用对象、能力领域、能力成熟度、
 *   健康状态、"只看我可安装"开关）之间为 AND 关系，结果集中的每一项必须同时
 *   满足所有激活条件，且所有满足条件的项都不被排除。
 * - Property 13: Filter reset idempotence
 *   `createDefaultFilters()` 返回与初始状态完全一致的 `AssetListFilters`，
 *   重置操作幂等。
 *
 * 关键词搜索：在 `name`（能力名称）与 `description`（能力说明）上做不区分大小写的
 * 子串匹配；最少 1 个字符即可触发命中。`matchesSearchQuery` 单独导出，便于 UI
 * 层在表格渲染时复用相同的命中逻辑实现高亮。
 *
 * 适用对象（applicableTarget）匹配：UI 下拉选项可能是中文标签
 * （"全企业" / "某部门" / "某协作组" / "某角色"）或具体名称（部门名/协作组名/
 * 角色名）。本工具同时支持两种语义：
 *   - 匹配中文标签 → 命中所有同类（kind）的能力
 *   - 匹配具体名称 → 命中 `applicableScope.name === filterValue` 的能力
 *
 * Validates: Requirements 3.1, 3.2, 3.4, 3.6
 *
 * 所有函数均为纯函数：不修改输入，仅返回新值。
 */

import type {
  ApplicableScope,
  AssetListFilters,
  EnterpriseAssetListItem,
} from "../../capability/enterprise-capability/types.ts";

/**
 * Property 13: 默认筛选器工厂。
 *
 * 返回与"全部"等价的初始状态：
 * - 搜索关键词为空字符串
 * - 5 个下拉筛选器为 null（即"全部"）
 * - "只看我可安装"开关关闭
 *
 * 重置按钮调用此工厂以保证幂等：连续多次调用得到结构相同的对象。
 */
export function createDefaultFilters(): AssetListFilters {
  return {
    searchQuery: "",
    usageScenario: null,
    applicableTarget: null,
    domain: null,
    maturity: null,
    healthStatus: null,
    onlyInstallable: false,
  };
}

/**
 * 关键词子串匹配（不区分大小写）：在 `name` 与 `description` 中查找子串。
 *
 * - 输入查询为空（去除首尾空白后）→ 返回 `true`，表示"无搜索条件"不影响结果集
 * - 命中规则：`name` 或 `description` 中任一包含查询子串
 * - 使用 `toLocaleLowerCase()` 处理多语言场景，与 `my-accumulation.ts` 保持一致
 *
 * 单独导出以便 UI 层（高亮渲染）复用相同的命中判定逻辑。
 */
export function matchesSearchQuery(item: EnterpriseAssetListItem, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) {
    return true;
  }
  return (
    item.name.toLocaleLowerCase().includes(normalized) ||
    item.description.toLocaleLowerCase().includes(normalized)
  );
}

/**
 * 中文适用对象标签 → `ApplicableScope.kind` 的映射。
 *
 * 仅当筛选值为这 4 个标签之一时，使用 kind-级匹配（命中所有同类能力）；
 * 其他值则按"具体名称"匹配（命中 `applicableScope.name === value` 的能力）。
 */
const APPLICABLE_TARGET_KIND_LABELS: Readonly<Record<string, ApplicableScope["kind"]>> = {
  全企业: "enterprise",
  某部门: "department",
  某协作组: "group",
  某角色: "role",
};

/**
 * 判断 `applicableScope` 是否匹配筛选值。
 *
 * - 若筛选值为中文 kind 标签（"全企业"/"某部门"/"某协作组"/"某角色"），
 *   则只比对 `scope.kind`
 * - 否则视为具体名称匹配；`enterprise` kind 没有 name，永远不命中具体名称筛选
 */
function matchesApplicableTarget(scope: ApplicableScope, filterValue: string): boolean {
  const mappedKind = APPLICABLE_TARGET_KIND_LABELS[filterValue];
  if (mappedKind !== undefined) {
    return scope.kind === mappedKind;
  }
  if (scope.kind === "enterprise") {
    return false;
  }
  return scope.name === filterValue;
}

/**
 * Property 12: 应用 AND 语义的多筛选器到能力资产列表。
 *
 * 激活条件（任一未激活则不参与过滤）：
 * - `searchQuery` 非空字符串：`name` 或 `description` 中包含子串（不区分大小写）
 * - `usageScenario` 非 null：`item.usageScenarios` 包含该值
 * - `applicableTarget` 非 null：按 kind 标签或具体名称匹配 `item.applicableScope`
 * - `domain` 非 null：`item.domain === filters.domain`
 * - `maturity` 非 null：`item.maturity === filters.maturity`
 * - `healthStatus` 非 null：`item.healthStatus === filters.healthStatus`
 * - `onlyInstallable` 为 true：`item.lifecycle === "published"` 且
 *   `item.healthStatus !== "已不适合继续推广"`
 *
 * 所有激活条件之间为 AND 关系：结果集中的每一项必须同时满足所有激活条件。
 *
 * 纯函数：不修改入参数组，返回新数组。
 */
export function applyFilters(
  items: EnterpriseAssetListItem[],
  filters: AssetListFilters,
): EnterpriseAssetListItem[] {
  return items.filter((item) => {
    if (!matchesSearchQuery(item, filters.searchQuery)) {
      return false;
    }
    if (filters.usageScenario !== null && !item.usageScenarios.includes(filters.usageScenario)) {
      return false;
    }
    if (
      filters.applicableTarget !== null &&
      !matchesApplicableTarget(item.applicableScope, filters.applicableTarget)
    ) {
      return false;
    }
    if (filters.domain !== null && item.domain !== filters.domain) {
      return false;
    }
    if (filters.maturity !== null && item.maturity !== filters.maturity) {
      return false;
    }
    if (filters.healthStatus !== null && item.healthStatus !== filters.healthStatus) {
      return false;
    }
    if (filters.onlyInstallable) {
      if (item.lifecycle !== "published" || item.healthStatus === "已不适合继续推广") {
        return false;
      }
    }
    return true;
  });
}
