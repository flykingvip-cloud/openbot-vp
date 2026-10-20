/**
 * Install Management Dual View Controller — 「能力安装管理」双视角子页状态管理。
 */

import type { InstallManagementFilters } from "../../capability/enterprise-capability/endpoints.ts";
import type { EnterpriseCapabilityGateway } from "../../capability/enterprise-capability/gateway-client.ts";
import type {
  InstallRelation,
  PaginationState,
} from "../../capability/enterprise-capability/types.ts";
import type { InstallRelationEnhanced } from "../../capability/runtime-projection/types.ts";
import { autoCorrectPage } from "../enterprise-asset-library/pagination-utils.ts";

export type InstallViewMode = "byRobot" | "byCapability";

export type InstallManagementDualViewFilters = {
  capabilityNameQuery: string;
  robotNameQuery: string;
  source: "员工沉淀" | "企业发布" | null;
  status: "正常" | "待优化" | null;
};

export type InstallManagementDualViewState = {
  gateway: EnterpriseCapabilityGateway | null;
  loading: boolean;
  error: string | null;
  items: InstallRelationEnhanced[];
  pagination: PaginationState;
  filters: InstallManagementDualViewFilters;
  viewMode: InstallViewMode;
  summary: { totalRelations: number; coveredRobots: number; coveredCapabilities: number };
  pendingUninstallId: string | null;
  uninstalling: boolean;
  uninstallError: string | null;
};

const DEFAULT_FILTERS: InstallManagementDualViewFilters = {
  capabilityNameQuery: "",
  robotNameQuery: "",
  source: null,
  status: null,
};

const DEFAULT_PAGINATION: PaginationState = {
  currentPage: 1,
  pageSize: 50,
  totalItems: 0,
};

function mapInstallRelation(item: InstallRelation): InstallRelationEnhanced {
  const source: InstallRelationEnhanced["source"] =
    item.source === "员工自主安装" ? "员工沉淀" : "企业发布";
  const status: InstallRelationEnhanced["status"] =
    item.status === "正常运行" ? "正常" : item.status === "待更新" ? "待优化" : "已停用";
  return {
    id: item.id,
    capabilityId: item.capabilityId,
    capabilityName: item.capabilityName,
    robotId: item.robotId,
    robotName: item.robotName,
    installedAt: item.installedAt,
    source,
    status,
    usageStats: { executions30d: 0, successRate: 1 },
  };
}

function mapFiltersToGateway(filters: InstallManagementDualViewFilters): InstallManagementFilters {
  return {
    capabilityNameQuery: filters.capabilityNameQuery,
    robotNameQuery: filters.robotNameQuery,
    installedAfter: null,
    installedBefore: null,
    source:
      filters.source === "员工沉淀"
        ? "员工自主安装"
        : filters.source === "企业发布"
          ? "管理员推送"
          : null,
    status: filters.status === "正常" ? "正常运行" : filters.status === "待优化" ? "待更新" : null,
  };
}

export function groupInstallRelationsByRobot(
  items: readonly InstallRelationEnhanced[],
): Map<string, InstallRelationEnhanced[]> {
  const groups = new Map<string, InstallRelationEnhanced[]>();
  for (const item of items) {
    const bucket = groups.get(item.robotId) ?? [];
    bucket.push(item);
    groups.set(item.robotId, bucket);
  }
  return groups;
}

export function groupInstallRelationsByCapability(
  items: readonly InstallRelationEnhanced[],
): Map<string, InstallRelationEnhanced[]> {
  const groups = new Map<string, InstallRelationEnhanced[]>();
  for (const item of items) {
    const bucket = groups.get(item.capabilityId) ?? [];
    bucket.push(item);
    groups.set(item.capabilityId, bucket);
  }
  return groups;
}

export type InstallManagementDualViewController = ReturnType<
  typeof createInstallManagementDualViewController
>;

export function createInstallManagementDualViewController(
  gateway: EnterpriseCapabilityGateway,
  onChange: (state: InstallManagementDualViewState) => void,
) {
  let state: InstallManagementDualViewState = {
    gateway,
    loading: false,
    error: null,
    items: [],
    pagination: { ...DEFAULT_PAGINATION },
    filters: { ...DEFAULT_FILTERS },
    viewMode: "byRobot",
    summary: { totalRelations: 0, coveredRobots: 0, coveredCapabilities: 0 },
    pendingUninstallId: null,
    uninstalling: false,
    uninstallError: null,
  };

  function setState(partial: Partial<InstallManagementDualViewState>): void {
    state = { ...state, ...partial };
    onChange(state);
  }

  return {
    getState: () => state,

    async load(): Promise<void> {
      if (!state.gateway) {
        setState({ error: "暂时无法加载安装管理数据，请稍后再试" });
        return;
      }
      setState({ loading: true, error: null });
      try {
        const response = await state.gateway.installManagement({
          filters: mapFiltersToGateway(state.filters),
          pagination: {
            page: state.pagination.currentPage,
            pageSize: state.pagination.pageSize,
          },
        });
        const items = response.items.map(mapInstallRelation);
        setState({
          items,
          pagination: {
            currentPage: autoCorrectPage(
              response.pagination.currentPage,
              response.pagination.totalItems,
              response.pagination.pageSize,
            ),
            pageSize: response.pagination.pageSize,
            totalItems: response.pagination.totalItems,
          },
          summary: {
            totalRelations: response.pagination.totalItems,
            coveredRobots: response.summary.coveredRobotCount,
            coveredCapabilities: response.summary.coveredCapabilityCount,
          },
        });
      } catch {
        setState({ error: "加载安装管理数据失败" });
      } finally {
        setState({ loading: false });
      }
    },

    updateFilter(partial: Partial<InstallManagementDualViewFilters>): void {
      setState({
        filters: { ...state.filters, ...partial },
        pagination: { ...state.pagination, currentPage: 1 },
      });
    },

    changeViewMode(mode: InstallViewMode): void {
      setState({ viewMode: mode });
    },

    changePage(page: number): void {
      setState({
        pagination: {
          ...state.pagination,
          currentPage: autoCorrectPage(
            page,
            state.pagination.totalItems,
            state.pagination.pageSize,
          ),
        },
      });
    },

    changePageSize(pageSize: PaginationState["pageSize"]): void {
      setState({
        pagination: {
          currentPage: 1,
          pageSize,
          totalItems: state.pagination.totalItems,
        },
      });
    },

    groupByRobot(): Map<string, InstallRelationEnhanced[]> {
      return groupInstallRelationsByRobot(state.items);
    },

    groupByCapability(): Map<string, InstallRelationEnhanced[]> {
      return groupInstallRelationsByCapability(state.items);
    },

    requestUninstall(installRelationId: string): void {
      setState({ pendingUninstallId: installRelationId, uninstallError: null });
    },

    cancelUninstall(): void {
      setState({ pendingUninstallId: null, uninstallError: null });
    },

    async confirmUninstall(): Promise<boolean> {
      const pendingId = state.pendingUninstallId;
      if (!pendingId || !state.gateway) {
        setState({ uninstallError: "暂时无法卸载，请稍后再试" });
        return false;
      }
      setState({ uninstalling: true, uninstallError: null });
      try {
        await state.gateway.uninstall({ installRelationId: pendingId });
        const items = state.items.filter((item) => item.id !== pendingId);
        setState({
          items,
          pagination: {
            ...state.pagination,
            totalItems: Math.max(0, state.pagination.totalItems - 1),
          },
          summary: {
            ...state.summary,
            totalRelations: Math.max(0, state.summary.totalRelations - 1),
          },
          pendingUninstallId: null,
        });
        return true;
      } catch {
        setState({ uninstallError: "卸载失败，请稍后再试" });
        return false;
      } finally {
        setState({ uninstalling: false });
      }
    },
  };
}
