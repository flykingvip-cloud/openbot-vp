/**
 * 企业能力中心 — 安装管理 Controller（Install_Management 页面）
 *
 * 状态管理：纯函数 + 可变 state 对象 + async 方法
 * （与 my-accumulation.ts / asset-list.ts / asset-detail.ts 对齐）。
 *
 * 业务职责：
 * - 加载所有安装关系（已成立的"能力 ↔ 机器人"关联），合并管理员推送与员工自主安装两条路径
 * - 提供分页（默认 50 条/页，需求 9.1）+ 多筛选器（能力名/机器人名/时间范围/来源/状态）
 * - 提供卸载二次确认流程（needs `beginUninstall` → `confirmUninstall`，需求 9.4）
 * - 提供管理员推送批量安装（最多 20 个机器人，需求 8.4）
 * - 卸载失败时保留原安装关系不变（需求 9.5）
 *
 * 行为要点：
 * - 加载/错误状态分别独立维护：列表加载 (loading/error)、卸载流程 (uninstalling/uninstallError)、
 *   推送安装 (installingCapabilityId/installError)。三组状态互不干扰，UI 可以并发触发各自动作而不冲突。
 * - 卸载成功后只在本地 `items` 中过滤掉对应关系，避免再发起一次列表请求；总数同步递减以保持
 *   分页摘要正确。卸载失败则完全保留 `items`（需求 9.5）。
 * - 推送安装的最大机器人数（20）由管理员侧前端先校验，避免无谓的网络请求；服务端仍会再次校验。
 * - 任何会改变结果集语义的状态变更（filters）都将 `currentPage` 重置为 1。
 *
 * Validates: Requirements 8.1, 8.4, 8.5, 8.6, 8.7, 8.8,
 *            9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
 */

import type { InstallManagementFilters } from "../../capability/enterprise-capability/endpoints.ts";
import type { EnterpriseCapabilityGateway } from "../../capability/enterprise-capability/gateway-client.ts";
import type {
  InstallRelation,
  PaginationState,
} from "../../capability/enterprise-capability/types.ts";
import { autoCorrectPage } from "./pagination-utils.ts";

/**
 * 单次推送安装允许选择的最大机器人数（需求 8.4）。
 * 服务端会再次校验，此处的本地校验主要为了避免无意义的网络请求与提供即时反馈。
 */
const MAX_ROBOTS_PER_INSTALL = 20;

/**
 * 推送安装结果摘要：与 `gateway.installToRobots` 响应中的成功/失败列表对齐，
 * 由展示层用于渲染"成功 N 个，失败 M 个"以及失败明细（需求 8.7、8.8）。
 */
export type InstallToRobotsResultSummary = {
  capabilityId: string;
  successfulRobotIds: string[];
  failures: Array<{ robotId: string; reason: string }>;
};

export type InstallManagementState = {
  gateway: EnterpriseCapabilityGateway | null;

  /** 列表加载态 */
  loading: boolean;
  error: string | null;
  items: InstallRelation[];
  pagination: PaginationState;
  filters: InstallManagementFilters;

  /** 来源统计摘要（管理员推送 / 员工自主安装），需求 9.7 */
  summary: {
    adminPushCount: number;
    employeeSelfInstallCount: number;
    coveredRobotCount: number;
    coveredCapabilityCount: number;
    coveredPositionCount: number;
  };
  viewMode: "byRobot" | "byCapability";

  /** 卸载二次确认流程：`pendingUninstallId` 为待确认的 InstallRelation.id */
  pendingUninstallId: string | null;
  uninstalling: boolean;
  uninstallError: string | null;

  /** 管理员推送安装流程：`installingCapabilityId` 为正在推送的能力 id */
  installingCapabilityId: string | null;
  lastInstallResult: InstallToRobotsResultSummary | null;
  installError: string | null;
};

/**
 * 默认筛选器：所有维度均为"全部"。
 *
 * - 文本搜索字段使用空字符串（与列表筛选 `applyFilters` 等效语义一致）
 * - 时间范围、来源、状态为 null 表示不限定
 */
function createDefaultInstallFilters(): InstallManagementFilters {
  return {
    capabilityNameQuery: "",
    robotNameQuery: "",
    installedAfter: null,
    installedBefore: null,
    source: null,
    status: null,
  };
}

/**
 * 默认分页：第 1 页、每页 50 条（需求 9.1：每页最多 50 条）、总数 0。
 */
const DEFAULT_PAGINATION: PaginationState = {
  currentPage: 1,
  pageSize: 50,
  totalItems: 0,
};

export function createInitialInstallManagementState(): InstallManagementState {
  return {
    gateway: null,
    loading: false,
    error: null,
    items: [],
    // Spread 后赋值新对象，避免外部 mutation 污染默认常量对象。
    pagination: { ...DEFAULT_PAGINATION },
    filters: createDefaultInstallFilters(),
    summary: {
      adminPushCount: 0,
      employeeSelfInstallCount: 0,
      coveredRobotCount: 0,
      coveredCapabilityCount: 0,
      coveredPositionCount: 0,
    },
    viewMode: "byRobot",
    pendingUninstallId: null,
    uninstalling: false,
    uninstallError: null,
    installingCapabilityId: null,
    lastInstallResult: null,
    installError: null,
  };
}

/**
 * 加载安装管理列表。
 *
 * 成功路径：写入 `items` / `pagination` / `summary`。
 * 失败路径：写入业务语言错误信息，保留 `items` / `pagination` / `summary` 不变，
 * 由展示层呈现错误提示与重试入口（与 asset-list 一致的非破坏性错误策略）。
 */
export async function loadInstallManagement(state: InstallManagementState): Promise<void> {
  if (state.gateway === null) {
    state.error = "暂时无法加载安装管理数据，请稍后再试";
    return;
  }

  state.loading = true;
  state.error = null;
  try {
    const response = await state.gateway.installManagement({
      filters: state.filters,
      pagination: {
        page: state.pagination.currentPage,
        pageSize: state.pagination.pageSize,
      },
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
    state.summary = response.summary;
  } catch {
    // 错误细节不透传至业务视图层（需求 12 投影边界），统一以业务语言提示。
    // 保留 items / pagination / summary —— 失败不抹除已展示的列表内容。
    state.error = "加载安装管理数据失败";
  } finally {
    state.loading = false;
  }
}

/**
 * 进入卸载二次确认流程。
 *
 * 同步设置 `pendingUninstallId`，由展示层弹出确认对话框（需求 9.4）。
 * 不触发任何网络请求；同时清空上一次的 `uninstallError` 以便新一次确认时
 * 不显示陈旧的错误信息。
 */
export function beginUninstall(state: InstallManagementState, installRelationId: string): void {
  state.pendingUninstallId = installRelationId;
  state.uninstallError = null;
}

/**
 * 取消卸载二次确认流程。
 *
 * 同步清空 `pendingUninstallId` 与 `uninstallError`。
 */
export function cancelUninstall(state: InstallManagementState): void {
  state.pendingUninstallId = null;
  state.uninstallError = null;
}

/**
 * 确认并执行卸载。
 *
 * - 若 `pendingUninstallId` 为 null（未进入确认流程）：直接返回 false
 * - 调用 `gateway.uninstall`：成功则在本地 `items` 中过滤掉对应关系并递减总数；
 *   重置 `pendingUninstallId` → null；返回 true
 * - 失败：写入 `uninstallError`，保留 `items` 与 `pendingUninstallId` 不变
 *   （需求 9.5：卸载失败保留原有安装关系不变）；返回 false
 *
 * 注意：卸载成功后并未重新调用 `loadInstallManagement`，避免一次额外的网络请求。
 * `summary` 不在此处调整 —— 来源统计需要按"管理员推送 vs 员工自主安装"重新计算，
 * 由 UI 层下一次刷新触发；该字段的临时偏差不会误导业务决策。
 */
export async function confirmUninstall(state: InstallManagementState): Promise<boolean> {
  if (state.pendingUninstallId === null) {
    return false;
  }
  if (state.gateway === null) {
    state.uninstallError = "暂时无法卸载，请稍后再试";
    return false;
  }

  const targetId = state.pendingUninstallId;
  state.uninstalling = true;
  state.uninstallError = null;
  try {
    const response = await state.gateway.uninstall({ installRelationId: targetId });
    if (!response.succeeded) {
      state.uninstallError = "卸载未成功，请稍后重试";
      return false;
    }
    // 成功路径：从本地列表中过滤目标关系，递减总数，重置确认态。
    state.items = state.items.filter((relation) => relation.id !== targetId);
    state.pagination = {
      ...state.pagination,
      totalItems: Math.max(0, state.pagination.totalItems - 1),
    };
    state.pendingUninstallId = null;
    return true;
  } catch {
    // 需求 9.5：卸载失败保留原 items 不变；同时保留 pendingUninstallId
    // 让用户可在确认对话框看到错误信息后选择重试或取消。
    state.uninstallError = "卸载未成功，请稍后重试";
    return false;
  } finally {
    state.uninstalling = false;
  }
}

/**
 * 管理员推送安装：将一个能力批量安装到多个机器人。
 *
 * 校验：
 * - `robotIds.length` 必须 ≥ 1 且 ≤ 20（需求 8.4）；超出立即返回 false 并写入 `installError`
 *
 * 行为：
 * - 调用 `gateway.installToRobots`：成功则写入 `lastInstallResult`，由展示层渲染
 *   "成功 N 个，失败 M 个"摘要与失败列表（需求 8.7、8.8）；返回 true
 * - 失败：写入 `installError`，保留 `lastInstallResult` 不变；返回 false
 *
 * 注意：本函数不会自动刷新列表 —— 安装关系是否进入分页结果取决于当前筛选器，
 * 由调用方（通常是关闭安装结果对话框后）按需调用 `loadInstallManagement`。
 */
export async function installToRobots(
  state: InstallManagementState,
  capabilityId: string,
  robotIds: string[],
): Promise<boolean> {
  if (robotIds.length === 0) {
    state.installError = "请至少选择一个机器人";
    return false;
  }
  if (robotIds.length > MAX_ROBOTS_PER_INSTALL) {
    state.installError = `单次最多可选择 ${MAX_ROBOTS_PER_INSTALL} 个机器人`;
    return false;
  }
  if (state.gateway === null) {
    state.installError = "暂时无法推送安装，请稍后再试";
    return false;
  }

  state.installingCapabilityId = capabilityId;
  state.installError = null;
  try {
    const response = await state.gateway.installToRobots({ capabilityId, robotIds });
    state.lastInstallResult = {
      capabilityId: response.capabilityId,
      successfulRobotIds: response.successfulRobotIds,
      failures: response.failures,
    };
    return true;
  } catch {
    // 错误细节不透传至业务视图层（需求 12 投影边界），统一以业务语言提示。
    state.installError = "推送安装失败";
    return false;
  } finally {
    state.installingCapabilityId = null;
  }
}

/**
 * 修改单个筛选字段（能力名 / 机器人名 / 时间范围 / 来源 / 状态）。
 *
 * 同步将 `currentPage` 重置为 1，避免在第 N 页切换筛选后落入空页。
 * 本函数不触发网络请求，调用方在 UI 防抖后调用 `loadInstallManagement()`。
 */
export function updateInstallFilter<K extends keyof InstallManagementFilters>(
  state: InstallManagementState,
  key: K,
  value: InstallManagementFilters[K],
): void {
  state.filters[key] = value;
  state.pagination.currentPage = 1;
}

/**
 * 切换页码。
 *
 * 使用 `autoCorrectPage` 做本地页码兜底；服务端仍是权威分页来源，
 * 但前端不会主动请求小于 1 或明显越界的页码。
 */
export function changeInstallPage(state: InstallManagementState, page: number): void {
  state.pagination.currentPage = autoCorrectPage(
    page,
    state.pagination.totalItems,
    state.pagination.pageSize,
  );
}

export function changeInstallViewMode(
  state: InstallManagementState,
  viewMode: InstallManagementState["viewMode"],
): void {
  state.viewMode = viewMode;
}
