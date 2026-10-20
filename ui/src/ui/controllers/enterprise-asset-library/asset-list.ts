/**
 * 企业能力中心 — 资产列表 Controller（"查看全部能力"页面）
 *
 * 状态管理：纯函数 + 可变 state 对象 + async 方法
 * （与 my-accumulation.ts / statistics.ts / domain-distribution.ts 对齐）。
 *
 * 行为要点：
 * - 初始 filters 使用 `createDefaultFilters()`（Property 13 重置幂等的同一来源）
 * - 默认排序 `{ field: "maturity", direction: "desc" }`（Property 11：成熟度降序）
 * - 默认 sidebarEntry 为 "my-installed"，初始选中"我的安装能力"
 * - 加载失败时保留 `items` 与 `pagination`，避免错误抹除已展示的列表
 * - 任何会改变结果集语义的状态变更（filters / sidebarEntry / sort）都将
 *   `currentPage` 重置为 1；分页相关变更（changePage / changePageSize）则
 *   调用 `autoCorrectPage()` 保证页码不越界（Property 14 + 需求 17.4）
 * - mutation 函数本身不触发网络请求；调用方负责在 mutation 之后调用
 *   `loadAssetList()`，以便 UI 层可以合并多次状态变更后再请求一次
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.5,
 *            16.1, 16.2, 16.3, 16.4, 16.5, 16.6,
 *            17.1, 17.2, 17.3, 17.4, 17.5, 17.6
 */

import type { EnterpriseCapabilityGateway } from "../../capability/enterprise-capability/gateway-client.ts";
import type {
  AssetListFilters,
  AssetSortConfig,
  EnterpriseAssetListItem,
  PaginationState,
  SidebarEntry,
} from "../../capability/enterprise-capability/types.ts";
import { createDefaultFilters } from "./filter-utils.ts";
import { autoCorrectPage } from "./pagination-utils.ts";

export type AssetListState = {
  gateway: EnterpriseCapabilityGateway | null;
  loading: boolean;
  error: string | null;
  items: EnterpriseAssetListItem[];
  filters: AssetListFilters;
  pagination: PaginationState;
  sorting: AssetSortConfig;
  sidebarEntry: SidebarEntry;
  catalog: "skills" | "mcp";
};

/**
 * 默认排序：主键 = 成熟度降序，次键 = 复用价值降序。
 * 见 Property 11 与 ordering-utils.ts → `compareByDefaultSort`。
 */
const DEFAULT_SORTING: AssetSortConfig = {
  field: "maturity",
  direction: "desc",
};

/**
 * 默认分页：第 1 页、每页 10 条、总数 0（待首次 load 后由响应填充）。
 * 见需求 17.2（默认 10 条/页）与 Property 14（分页切片正确性）。
 */
const DEFAULT_PAGINATION: PaginationState = {
  currentPage: 1,
  pageSize: 10,
  totalItems: 0,
};

export function createInitialAssetListState(): AssetListState {
  return {
    gateway: null,
    loading: false,
    error: null,
    items: [],
    filters: createDefaultFilters(),
    // Spread 后赋值新对象，避免外部 mutation 污染默认常量对象。
    pagination: { ...DEFAULT_PAGINATION },
    sorting: { ...DEFAULT_SORTING },
    sidebarEntry: "my-installed",
    catalog: "skills",
  };
}

/**
 * 「全部技能」主 Tab 没有快捷入口侧边栏，必须直接看企业 registry 全量，
 * 不能沿用「我的安装能力」。否则刚审核通过、尚未推送到机器人的资产会从列表消失。
 */
export function createCapabilityCenterSkillsListState(): AssetListState {
  return {
    ...createInitialAssetListState(),
    sidebarEntry: "all",
    // 新通过的资产通常是「初步形成」；按成熟度降序会被挤出首页。
    sorting: { field: "createdAt", direction: "desc" },
  };
}

export function createCapabilityCenterMcpListState(): AssetListState {
  return {
    ...createCapabilityCenterSkillsListState(),
    catalog: "mcp",
  };
}

/**
 * 加载企业能力资产列表。
 *
 * 成功路径：写入 `items`，并以服务端返回的 `pagination` 为准更新本地分页状态；
 * 若服务端返回的 `currentPage` 超出由 `totalItems / pageSize` 计算出的总页数，
 * 则用 `autoCorrectPage` 自动修正（需求 17.4 + Property 14）。
 *
 * 失败路径：仅写入业务语言错误信息，不清空 `items` 与 `pagination`，
 * 由展示层选择是否覆盖现有 UI（需求 17.6 加载失败提示 + 重试入口）。
 */
export async function loadAssetList(state: AssetListState): Promise<void> {
  if (state.gateway === null) {
    state.error = "暂时无法加载能力资产列表，请稍后再试";
    return;
  }

  state.loading = true;
  state.error = null;
  try {
    const response = await state.gateway.list({
      filters: state.filters,
      pagination: {
        page: state.pagination.currentPage,
        pageSize: state.pagination.pageSize,
      },
      sorting: state.sorting,
      sidebarEntry: state.sidebarEntry,
      catalog: state.catalog,
    });
    state.items = response.items;
    state.pagination = {
      currentPage: autoCorrectPage(
        response.pagination.currentPage,
        response.pagination.totalItems,
        response.pagination.pageSize,
      ),
      pageSize: response.pagination.pageSize,
      totalItems: response.pagination.totalItems,
    };
  } catch {
    // 错误细节不透传至业务视图层（需求 12 投影边界），统一以业务语言提示。
    // 保留 items / pagination —— 失败不抹除已展示的列表内容。
    state.error = "加载能力资产列表失败";
  } finally {
    state.loading = false;
  }
}

/**
 * 修改单个筛选字段（关键词搜索 / 5 个下拉 / "只看我可安装"开关）。
 *
 * 同步将 `currentPage` 重置为 1，避免在第 N 页切换筛选后落入空页
 * （需求 3.5 + Property 12 / 14）。本函数不触发网络请求，调用方
 * 在 UI 防抖后调用 `loadAssetList()` 以发起一次请求。
 */
export function updateFilter<K extends keyof AssetListFilters>(
  state: AssetListState,
  key: K,
  value: AssetListFilters[K],
): void {
  state.filters[key] = value;
  state.pagination.currentPage = 1;
}

/**
 * 重置全部筛选与搜索关键词到默认状态（"全部"），并将页码重置为 1。
 * 与 `createInitialAssetListState().filters` 等价（Property 13 幂等保证）。
 */
export function resetFilters(state: AssetListState): void {
  state.filters = createDefaultFilters();
  state.pagination.currentPage = 1;
}

/**
 * 切换页码。使用 `autoCorrectPage` 保证页码合法（Property 14）：
 * - `page < 1` → 1
 * - `page > totalPages` → totalPages
 * - 否则原值
 */
export function changePage(state: AssetListState, page: number): void {
  state.pagination.currentPage = autoCorrectPage(
    page,
    state.pagination.totalItems,
    state.pagination.pageSize,
  );
}

/**
 * 切换每页条数（10 / 20 / 50）。
 *
 * 切换后用 `autoCorrectPage` 重算 `currentPage`：当新 pageSize 增大导致原
 * 页码超出 `ceil(totalItems / newSize)` 时自动跳到最后一页（需求 17.4）。
 */
export function changePageSize(state: AssetListState, size: 10 | 20 | 50): void {
  state.pagination.pageSize = size;
  state.pagination.currentPage = autoCorrectPage(
    state.pagination.currentPage,
    state.pagination.totalItems,
    size,
  );
}

/**
 * 切换快捷入口侧边栏选中项（我的安装能力 / 我贡献的能力 / 全部）。
 * 改变结果集语义，将 `currentPage` 重置为 1。
 *
 * 见需求 16.1–16.6：侧边栏选中态与主内容区列表筛选联动。
 */
export function changeSidebarEntry(state: AssetListState, entry: SidebarEntry): void {
  state.sidebarEntry = entry;
  state.pagination.currentPage = 1;
}

/**
 * 切换排序配置。改变结果集顺序，将 `currentPage` 重置为 1，
 * 避免用户在第 N 页排序后看到与原页码不对应的内容。
 */
export function changeSort(state: AssetListState, sort: AssetSortConfig): void {
  state.sorting = sort;
  state.pagination.currentPage = 1;
}
