/**
 * Robot Capability View Controller — 「机器人能力视图」子页的状态管理。
 *
 * 职责：
 * - 管理机器人列表的加载、筛选、排序、分页状态
 * - 管理机器人详情面板的打开/关闭与数据加载
 * - 通过 EnterpriseUsageGateway 调用 RPC 端点
 *
 * 落实需求：Requirements 4.1–4.10, 12.3, 12.4
 */

import type { EnterpriseUsageGateway } from "../../capability/enterprise-asset-library-usage/gateway-client.ts";
import type { PaginationState } from "../../capability/enterprise-capability/types.ts";
import type {
  HealthStatus,
  RobotCapabilityUsageView,
  RobotDetail,
} from "../../capability/runtime-projection/types.ts";
import { describeLoadError, loadWithRetry } from "./load-with-retry.ts";

// ─────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────

export type RobotCapabilityViewFilters = {
  nameQuery: string;
  healthStatus: HealthStatus | null;
  monthlyExecutionsRange: "全部" | "<100" | "100-1000" | ">1000";
};

export type RobotCapabilityViewSorting = {
  field: "monthlyExecutions" | "capabilityCount" | "employeeCoverage" | "successRate";
  direction: "asc" | "desc";
};

export type RobotCapabilityViewKpis = {
  totalRobots: number;
  totalMonthlyExecutions: number;
  totalEmployeeCoverage: number;
  averageSuccessRate: number;
};

export type RobotCapabilityViewDetail = {
  open: boolean;
  robotId: string | null;
  data: RobotDetail | null;
  loading: boolean;
};

export type RobotCapabilityViewState = {
  loading: boolean;
  error: string | null;
  items: RobotCapabilityUsageView[];
  pagination: PaginationState;
  filters: RobotCapabilityViewFilters;
  sorting: RobotCapabilityViewSorting;
  kpis: RobotCapabilityViewKpis | null;
  detail: RobotCapabilityViewDetail;
};

// ─────────────────────────────────────────────────────────────────────────
// Default state
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_STATE: RobotCapabilityViewState = {
  loading: false,
  error: null,
  items: [],
  pagination: { currentPage: 1, pageSize: 10, totalItems: 0 },
  filters: { nameQuery: "", healthStatus: null, monthlyExecutionsRange: "全部" },
  sorting: { field: "monthlyExecutions", direction: "desc" },
  kpis: null,
  detail: { open: false, robotId: null, data: null, loading: false },
};

// ─────────────────────────────────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────────────────────────────────

export type RobotCapabilityViewController = ReturnType<typeof createRobotCapabilityViewController>;

/**
 * 创建「机器人能力视图」子页 controller。
 *
 * @param gateway EnterpriseUsageGateway 实例
 * @param onChange 状态变更回调（由视图层订阅以触发重渲染）
 */
export function createRobotCapabilityViewController(
  gateway: EnterpriseUsageGateway,
  onChange: (state: RobotCapabilityViewState) => void,
) {
  let state: RobotCapabilityViewState = { ...DEFAULT_STATE };
  let loadAbortController: AbortController | null = null;

  function setState(partial: Partial<RobotCapabilityViewState>): void {
    state = { ...state, ...partial };
    onChange(state);
  }

  function getState(): RobotCapabilityViewState {
    return state;
  }

  async function load(): Promise<void> {
    // 取消前一次未完成的请求
    if (loadAbortController) {
      loadAbortController.abort();
    }
    const abortController = new AbortController();
    loadAbortController = abortController;

    setState({ loading: true, error: null });

    try {
      const response = await loadWithRetry(
        () =>
          gateway.listRobotCapabilityViews({
            filters: {
              nameQuery: state.filters.nameQuery,
              healthStatus: state.filters.healthStatus,
              monthlyExecutionsRange: state.filters.monthlyExecutionsRange,
            },
            sorting: {
              field: state.sorting.field,
              direction: state.sorting.direction,
            },
            pagination: {
              page: state.pagination.currentPage,
              pageSize: state.pagination.pageSize,
            },
          }),
        { label: "listRobotCapabilityViews", signal: abortController.signal },
      );
      // 取消（期间触发了新的 load）：丢弃过期结果。
      if (!response || abortController.signal.aborted) {
        return;
      }
      setState({
        loading: false,
        items: response.items,
        pagination: response.pagination,
        kpis: response.kpis,
      });
    } catch (err) {
      if (abortController.signal.aborted) {
        return;
      }
      setState({ loading: false, error: describeLoadError(err) });
    }
  }

  function updateFilter(partial: Partial<RobotCapabilityViewFilters>): void {
    setState({
      filters: { ...state.filters, ...partial },
      pagination: { ...state.pagination, currentPage: 1 },
    });
    void load();
  }

  function changeSort(field: RobotCapabilityViewSorting["field"]): void {
    const direction: "asc" | "desc" =
      state.sorting.field === field && state.sorting.direction === "desc" ? "asc" : "desc";
    setState({ sorting: { field, direction } });
    void load();
  }

  function changePage(page: number): void {
    setState({ pagination: { ...state.pagination, currentPage: page } });
    void load();
  }

  function changePageSize(pageSize: 10 | 20 | 50): void {
    // 如果新 pageSize 导致当前页超出总页数，跳到最后一页
    const totalPages = Math.ceil(state.pagination.totalItems / pageSize) || 1;
    const currentPage = Math.min(state.pagination.currentPage, totalPages);
    setState({ pagination: { ...state.pagination, pageSize, currentPage } });
    void load();
  }

  async function openDetail(robotId: string): Promise<void> {
    setState({ detail: { open: true, robotId, data: null, loading: true } });
    try {
      const response = await gateway.getRobotDetail({ robotId });
      setState({
        detail: {
          open: true,
          robotId,
          data: {
            robotId: response.basic.robotId,
            robotName: response.basic.robotName,
            healthStatus: response.basic.healthStatus,
            lastActiveAt: response.basic.lastActiveAt,
            capabilities: response.capabilities,
            trend30d: response.trend30d,
            employeeCoverage:
              state.items.find((item) => item.robotId === robotId)?.employeeCoverage ?? 0,
            topCapabilities: response.topCapabilities,
          },
          loading: false,
        },
      });
    } catch {
      setState({
        detail: { open: true, robotId, data: null, loading: false },
      });
    }
  }

  function closeDetail(): void {
    setState({ detail: { open: false, robotId: null, data: null, loading: false } });
  }

  return {
    getState,
    load,
    updateFilter,
    changeSort,
    changePage,
    changePageSize,
    openDetail,
    closeDetail,
  };
}
