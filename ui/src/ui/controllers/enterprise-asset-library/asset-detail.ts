/**
 * 企业能力中心 — 资产详情 Controller
 *
 * 为 `AssetDetailPage` 提供单个能力资产的完整业务视图状态管理。
 *
 * 状态管理：纯函数 + 可变 state 对象 + async 方法
 * （与 `my-accumulation.ts` / `statistics.ts` 一致）。
 *
 * 行为要点：
 * - 详情数据来自 `gateway.detail({ capabilityId })`，返回值已经过
 *   `EnterpriseCapabilityProjection` 投影，不含任何运行时字段。
 * - 错误发生时保留之前的 `capability` 不被清空，便于展示层在保留已加载
 *   区域的同时呈现错误提示与重试入口（需求 13.10）。
 * - `trendRange` 控制复用趋势图的时间窗口，切换时不触发新的 API 请求，
 *   折线图基于已加载的 `reuseData.trend30Days` 等数据在客户端重新渲染
 *   （需求 13.6 中 7/30/90/180 天切换属于展示侧操作）。
 * - `clearAssetDetail` 用于离开详情页时清理状态，避免下次进入时短暂
 *   闪现旧能力数据。
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8
 */

import type { EnterpriseCapabilityGateway } from "../../capability/enterprise-capability/gateway-client.ts";
import type { EnterpriseCapabilityAsset } from "../../capability/enterprise-capability/types.ts";
import type { StandardAssetDetailTabId } from "../../views/asset-detail-tabs.ts";

/** 复用趋势图支持的时间窗口（天） */
export type TrendRange = 7 | 30 | 90 | 180;

export type AssetDetailState = {
  gateway: EnterpriseCapabilityGateway | null;
  loading: boolean;
  error: string | null;
  capability: EnterpriseCapabilityAsset | null;
  /** Time range for the reuse trend chart */
  trendRange: TrendRange;
  /** 当前激活的详情子标签（overview/definition/files/versions/runtime/install） */
  detailTab: StandardAssetDetailTabId;
};

export function createInitialAssetDetailState(): AssetDetailState {
  return {
    gateway: null,
    loading: false,
    error: null,
    capability: null,
    trendRange: 30,
    detailTab: "overview",
  };
}

/**
 * 加载某能力资产的完整详情。
 *
 * 成功路径：写入 `state.capability`，清空 `state.error`。
 * 失败路径：写入业务语言错误信息，保留先前 `state.capability`（可能为 null
 * 或上一次加载成功的数据），由展示层呈现错误提示 + 重试入口（需求 13.10）。
 */
export async function loadAssetDetail(
  state: AssetDetailState,
  capabilityId: string,
): Promise<void> {
  if (state.gateway === null) {
    state.error = "暂时无法加载能力详情，请稍后再试";
    return;
  }

  state.loading = true;
  state.error = null;
  try {
    const response = await state.gateway.detail({ capabilityId });
    state.capability = response.capability;
  } catch {
    state.error = "加载能力详情失败";
    // 需求 13.10：保留已加载成功的区域；不清空 capability。
  } finally {
    state.loading = false;
  }
}

/**
 * 切换复用趋势图的时间窗口。
 *
 * 同步操作，不触发 API 请求 —— 折线图基于已加载的 `capability.reuseData`
 * 在客户端重新渲染。
 */
export function changeTrendRange(state: AssetDetailState, range: TrendRange): void {
  state.trendRange = range;
}

/**
 * 切换详情页子标签。
 *
 * 同步操作，不触发 API 请求 —— 各标签内容均基于已加载的 `capability` 渲染。
 */
export function changeDetailTab(state: AssetDetailState, tab: StandardAssetDetailTabId): void {
  state.detailTab = tab;
}

/**
 * 离开详情页时清理状态。
 *
 * 重置 `capability` 与 `error`，但保留 `gateway` 与 `trendRange`（用户的
 * 时间窗口偏好在同一会话内保持）。
 */
export function clearAssetDetail(state: AssetDetailState): void {
  state.capability = null;
  state.error = null;
  state.detailTab = "overview";
}
