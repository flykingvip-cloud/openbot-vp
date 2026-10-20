/**
 * 企业能力中心 — 贡献记录 Controller
 *
 * 状态管理：纯函数 + 可变 state 对象 + async 方法
 * （与 asset-list.ts / review-queue.ts 对齐）。
 *
 * 行为要点：
 * - 默认分页 `{ currentPage: 1, pageSize: 20, totalItems: 0 }`（需求 10.1：每页默认展示 20 条）
 * - 默认 filters 全部为 `null`，表示"全部"（员工 / 部门 / 时间窗口 / 审核状态）
 * - 加载失败时保留 `items` 与 `pagination`，避免错误抹除已展示列表
 * - 任何会改变结果集语义的状态变更（filters）都将 `currentPage` 重置为 1；
 *   分页相关变更（changeContributionPage / changeContributionPageSize）则
 *   调用 `autoCorrectPage()` 保证页码不越界（Property 14 + 需求 17.4）
 * - mutation 函数本身不触发网络请求；调用方负责在 mutation 之后调用
 *   `loadContributionRecords()`，以便 UI 层可以合并多次状态变更后再请求一次
 *
 * 业务语言映射（reviewStatus）由 endpoints.ts 中
 * `ContributionRecordListItem.reviewStatus` 字段直接承载，由后端按需求 10.4 完成
 * AssetLifecycle → 业务语言标签的映射；本 controller 仅做透传与分页/筛选状态管理。
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

import type {
  ContributionRecordListItem,
  ContributionRecordsFilters,
  ContributionRecordsSorting,
} from "../../capability/enterprise-capability/endpoints.ts";
import type { EnterpriseCapabilityGateway } from "../../capability/enterprise-capability/gateway-client.ts";
import type { PaginationState } from "../../capability/enterprise-capability/types.ts";
import { autoCorrectPage } from "./pagination-utils.ts";

export type ContributionRecordsState = {
  gateway: EnterpriseCapabilityGateway | null;
  loading: boolean;
  error: string | null;
  items: ContributionRecordListItem[];
  pagination: PaginationState;
  filters: ContributionRecordsFilters;
  sorting: ContributionRecordsSorting;
};

/**
 * 默认分页：第 1 页、每页 20 条、总数 0（待首次 load 后由响应填充）。
 * 见需求 10.1：贡献记录页面默认每页 20 条。
 */
const DEFAULT_PAGINATION: PaginationState = {
  currentPage: 1,
  pageSize: 20,
  totalItems: 0,
};

/**
 * 默认筛选：全部 `null` 表示"不限"，与 endpoints.ts 中
 * `ContributionRecordsFilters` 的字段语义一致。
 */
const DEFAULT_FILTERS: ContributionRecordsFilters = {
  employeeId: null,
  department: null,
  submittedAfter: null,
  submittedBefore: null,
  reviewStatus: null,
};

const DEFAULT_SORTING: ContributionRecordsSorting = {
  field: "submittedAt",
  direction: "desc",
};

export function createInitialContributionRecordsState(): ContributionRecordsState {
  return {
    gateway: null,
    loading: false,
    error: null,
    items: [],
    // Spread 后赋值新对象，避免外部 mutation 污染默认常量对象。
    pagination: { ...DEFAULT_PAGINATION },
    filters: { ...DEFAULT_FILTERS },
    sorting: { ...DEFAULT_SORTING },
  };
}

/**
 * 加载贡献记录（按提交时间倒序，由后端保证；需求 10.1 / 10.3）。
 *
 * 成功路径：以服务端返回的分页数据为准；当返回的 `currentPage` 超出
 * 由 `totalItems / pageSize` 计算出的总页数时，用 `autoCorrectPage` 自动修正
 * （需求 17.4 + Property 14）。
 *
 * 失败路径：仅写入业务语言错误信息，不清空 `items` 与 `pagination`，
 * 由展示层选择是否覆盖现有 UI（需求 17.6 加载失败提示 + 重试入口）。
 */
export async function loadContributionRecords(state: ContributionRecordsState): Promise<void> {
  if (state.gateway === null) {
    state.error = "暂时无法加载贡献记录，请稍后再试";
    return;
  }

  state.loading = true;
  state.error = null;
  try {
    const response = await state.gateway.contributionRecords({
      filters: state.filters,
      pagination: {
        page: state.pagination.currentPage,
        pageSize: state.pagination.pageSize,
      },
      sorting: state.sorting,
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
    state.error = "加载贡献记录失败";
  } finally {
    state.loading = false;
  }
}

/**
 * 修改单个筛选字段（员工 / 部门 / 提交时间窗口 / 审核状态）。
 *
 * 同步将 `currentPage` 重置为 1，避免在第 N 页切换筛选后落入空页
 * （需求 10.3 筛选后保持倒序排列；调用方在 UI 防抖后调用
 * `loadContributionRecords()` 以发起请求）。
 */
export function updateContributionFilter<K extends keyof ContributionRecordsFilters>(
  state: ContributionRecordsState,
  key: K,
  value: ContributionRecordsFilters[K],
): void {
  state.filters[key] = value;
  state.pagination.currentPage = 1;
}

/**
 * 切换页码。使用 `autoCorrectPage` 保证页码合法（Property 14）：
 * - `page < 1` → 1
 * - `page > totalPages` → totalPages
 * - 否则原值
 */
export function changeContributionPage(state: ContributionRecordsState, page: number): void {
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
export function changeContributionPageSize(
  state: ContributionRecordsState,
  size: 10 | 20 | 50,
): void {
  state.pagination.pageSize = size;
  state.pagination.currentPage = autoCorrectPage(
    state.pagination.currentPage,
    state.pagination.totalItems,
    size,
  );
}

export function changeContributionSorting(
  state: ContributionRecordsState,
  field: ContributionRecordsSorting["field"],
): void {
  state.sorting = {
    field,
    direction:
      state.sorting.field === field
        ? state.sorting.direction === "asc"
          ? "desc"
          : "asc"
        : field === "submittedAt"
          ? "desc"
          : "asc",
  };
  state.pagination.currentPage = 1;
}
