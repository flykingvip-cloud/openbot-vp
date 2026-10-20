/**
 * 企业能力中心 — 统计概览 Controller
 *
 * 状态管理：纯函数 + 可变 state 对象 + async 方法（与 my-accumulation.ts 对齐）。
 *
 * 行为要点：
 * - 加载时 3 秒超时（需求 15.4）
 * - 失败时回退到缓存数据，展示「数据更新时间」（需求 15.5）
 * - 无缓存可用时清空 stats，由展示层呈现「暂无数据」+ 手动刷新（需求 15.6）
 * - 仅暴露业务能力视图字段（需求 2.3-2.6）
 *
 * Validates: Requirements 2.3, 2.4, 2.5, 2.6, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */

import type { EnterpriseCapabilityGateway } from "../../capability/enterprise-capability/gateway-client.ts";
import type { StatisticsDashboardData } from "../../capability/enterprise-capability/types.ts";

/** 统计概览 3 秒超时（需求 15.4） */
const STATISTICS_LOAD_TIMEOUT_MS = 3000;

export type StatisticsState = {
  gateway: EnterpriseCapabilityGateway | null;
  loading: boolean;
  error: string | null;
  stats: StatisticsDashboardData | null;
  /** Cached data from previous successful load, used as fallback on error */
  cachedStats: StatisticsDashboardData | null;
  /** Timestamp of last successful load (for "数据更新时间" display) */
  lastSuccessfulLoadAt: number | null;
};

export function createInitialStatisticsState(): StatisticsState {
  return {
    gateway: null,
    loading: false,
    error: null,
    stats: null,
    cachedStats: null,
    lastSuccessfulLoadAt: null,
  };
}

/**
 * 将一个 Promise 与超时计时器竞速，超过 timeoutMs 则以错误 reject。
 * 用于满足"统计数据 3 秒内加载完成，否则视为加载失败"的需求 15.4。
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`加载超时（${timeoutMs} 毫秒）`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * 加载统计概览数据。
 *
 * 成功路径：写入 stats、cachedStats、lastSuccessfulLoadAt。
 * 失败路径：error 非空；若有缓存则 stats 回退至缓存（需求 15.5），
 * 否则 stats = null 由展示层呈现「暂无数据」占位（需求 15.6）。
 */
export async function loadStatistics(state: StatisticsState): Promise<void> {
  if (state.gateway === null) {
    state.error = "暂时无法加载统计数据，请稍后再试";
    return;
  }

  state.loading = true;
  state.error = null;
  try {
    const response = await withTimeout(state.gateway.stats({}), STATISTICS_LOAD_TIMEOUT_MS);
    state.stats = response.stats;
    state.cachedStats = response.stats;
    state.lastSuccessfulLoadAt = Date.now();
  } catch {
    // 错误细节不需要透传至业务视图层（需求 12 投影边界），统一以业务语言提示。
    state.error = "加载统计数据失败";
    // 需求 15.5：失败时回退到缓存；15.6：无缓存则清空，由展示层显示「暂无数据」+ 手动刷新。
    state.stats = state.cachedStats;
  } finally {
    state.loading = false;
  }
}

/**
 * 手动刷新触发（错误重试按钮、用户点击刷新时调用）。
 * 行为与 loadStatistics 一致；保留独立命名以便展示层与初次加载区分埋点/语义。
 */
export function refreshStatistics(state: StatisticsState): Promise<void> {
  return loadStatistics(state);
}
