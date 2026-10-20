/**
 * 企业能力中心 — 贡献绩效 Controller
 *
 * 状态管理：纯函数 + 可变 state 对象 + async 方法
 * （与 asset-list.ts / contribution-records.ts / review-queue.ts 对齐）。
 *
 * 行为要点：
 * - 默认 filters：`department: null` / 时间窗口为空 / `sortField: "totalContributions"` /
 *   `sortDirection: "desc"`（需求 11.3：默认按贡献数量降序排列）
 * - 默认 leaderboardView 为 "quantity"（数量贡献维度，需求 11.6）
 * - `loadContributionPerformance`：调用 `gateway.contributionPerformance`，成功后
 *   写入 items；并基于响应数据派生 `monthlyTopContributors` —— 按
 *   `totalContributions` 降序取前 5（需求 11.9：本月活跃贡献者 Top 5）。
 *   "本月"语义由 `setTimeRange("month")` 写入 filters 决定，gateway 据此聚合。
 * - `changeLeaderboardView`：在不重新发起请求的前提下切换排行榜视图；
 *   "quality" 视图按业务约定的复合评分（成熟度 × 0.4 + 成功率 × 0.4 +
 *   复用机器人数缩放 × 0.2）就地重排（需求 11.6：质量贡献维度）。
 * - `exportToCsv`：纯函数，不修改 state；导出当前 `state.items`，
 *   含表头与每条记录字段（需求 11.8：导出 CSV 报表）。
 * - `setTimeRange`：按预设时间区间快速切换 `filters.rangeStart` 与
 *   `filters.rangeEnd`（需求 11.4：本周 / 本月 / 本季度筛选）。
 * - mutation 函数本身不触发网络请求；调用方负责在 mutation 之后调用
 *   `loadContributionPerformance()`。
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9
 */

import type { ContributionPerformanceFilters } from "../../capability/enterprise-capability/endpoints.ts";
import type { EnterpriseCapabilityGateway } from "../../capability/enterprise-capability/gateway-client.ts";
import type { ContributionPerformanceItem } from "../../capability/enterprise-capability/types.ts";

/** 排行榜视图类型：数量贡献 vs 质量贡献（需求 11.6） */
export type LeaderboardView = "quantity" | "quality";

/** 预设时间区间：本周 / 本月 / 本季度（需求 11.4） */
export type TimeRange = "week" | "month" | "quarter";

/** "本月活跃贡献者"快捷入口展示条数（需求 11.9） */
const MONTHLY_TOP_CONTRIBUTORS_LIMIT = 5;

/**
 * 质量贡献复合评分权重：
 * - 平均成熟度等级（1-6）× 0.4
 * - 平均成功率（百分比）× 0.4
 * - 复用机器人数缩放至百分位（/ 100）× 0.2
 * 业务侧需求 11.6：质量贡献按"贡献能力的平均成熟度与复用价值综合排序"。
 */
const QUALITY_SCORE_WEIGHTS = {
  maturity: 0.4,
  successRate: 0.4,
  reuseScale: 0.2,
} as const;

/** 复用机器人数到 0-1 区间的缩放因子（与 QUALITY_SCORE_WEIGHTS.reuseScale 配套） */
const REUSE_ROBOTS_SCALE_DENOMINATOR = 100;

/**
 * CSV 表头：员工 / 部门 / 各项贡献指标（需求 11.8）。
 * 顺序与 `ContributionPerformanceItem` 字段保持一一对应，便于导出函数稳定。
 */
const CSV_HEADERS = [
  "员工",
  "部门",
  "贡献能力数",
  "审核通过数",
  "通过率",
  "平均成熟度",
  "使用机器人数",
  "复用员工数",
  "平均成功率",
] as const;

const DEFAULT_FILTERS: ContributionPerformanceFilters = {
  department: null,
  rangeStart: null,
  rangeEnd: null,
  sortField: "totalContributions",
  sortDirection: "desc",
};

export type ContributionPerformanceState = {
  gateway: EnterpriseCapabilityGateway | null;
  loading: boolean;
  error: string | null;
  items: ContributionPerformanceItem[];
  filters: ContributionPerformanceFilters;
  /** Active leaderboard view: 数量贡献 vs 质量贡献（需求 11.6） */
  leaderboardView: LeaderboardView;
  /** "本月活跃贡献者" Top 5（基于 items 派生，需求 11.9） */
  monthlyTopContributors: ContributionPerformanceItem[];
};

export function createInitialContributionPerformanceState(): ContributionPerformanceState {
  return {
    gateway: null,
    loading: false,
    error: null,
    items: [],
    // Spread 后赋值新对象，避免外部 mutation 污染默认常量对象。
    filters: { ...DEFAULT_FILTERS },
    leaderboardView: "quantity",
    monthlyTopContributors: [],
  };
}

/**
 * 加载贡献绩效数据。
 *
 * 成功路径：写入 `items`，并派生 `monthlyTopContributors`（按 totalContributions
 * 降序取前 5）。`monthlyTopContributors` 的"月"语义来自调用方先行通过
 * `setTimeRange("month")` 设置好的 `filters.rangeStart/rangeEnd`，
 * 由 gateway 根据筛选条件返回当月数据，本函数仅做派生计算。
 *
 * 失败路径：仅写入业务语言错误信息，不清空 `items` / `monthlyTopContributors`，
 * 由展示层选择是否覆盖现有 UI（与其它 controller 一致的失败语义）。
 */
export async function loadContributionPerformance(
  state: ContributionPerformanceState,
): Promise<void> {
  if (state.gateway === null) {
    state.error = "暂时无法加载贡献绩效数据，请稍后再试";
    return;
  }

  state.loading = true;
  state.error = null;
  try {
    const response = await state.gateway.contributionPerformance({
      filters: state.filters,
    });
    state.items = response.items;
    state.monthlyTopContributors = computeMonthlyTopContributors(response.items);
  } catch {
    // 错误细节不透传至业务视图层（需求 12 投影边界），统一以业务语言提示。
    // 保留 items / monthlyTopContributors —— 失败不抹除已展示的内容。
    state.error = "加载贡献绩效数据失败";
  } finally {
    state.loading = false;
  }
}

/**
 * 修改单个筛选字段（部门 / 时间窗口 / 排序字段或方向）。
 *
 * 不触发网络请求；调用方在 UI 防抖后调用 `loadContributionPerformance()`
 * 以重新拉取数据。
 */
export function updatePerformanceFilter<K extends keyof ContributionPerformanceFilters>(
  state: ContributionPerformanceState,
  key: K,
  value: ContributionPerformanceFilters[K],
): void {
  state.filters[key] = value;
}

/**
 * 切换排行榜视图（数量 / 质量）。
 *
 * "quality" 视图按复合评分降序就地重排 `items`（需求 11.6）；
 * "quantity" 视图保持后端返回顺序（即 `filters.sortField/Direction` 决定）。
 *
 * 不发起网络请求：业务约定质量评分是客户端纯计算字段，避免来回往返。
 */
export function changeLeaderboardView(
  state: ContributionPerformanceState,
  view: LeaderboardView,
): void {
  state.leaderboardView = view;
  if (view === "quality") {
    state.items.sort((a, b) => qualityScore(b) - qualityScore(a));
  }
}

/**
 * 将当前贡献绩效数据导出为 CSV 字符串（需求 11.8）。
 *
 * 纯函数：不修改 state；调用方负责通过 Blob URL 触发浏览器下载。
 * 字段顺序与 {@link CSV_HEADERS} 严格一致，保证表头-列对齐。
 *
 * CSV 转义规则：当字段包含逗号、双引号或换行时，使用双引号包裹，
 * 字段内的双引号转义为两个双引号（RFC 4180）。通过率 / 平均成功率为
 * 业务百分比，序列化为带 % 后缀的字符串以保留语义；平均成熟度保留 1 位
 * 小数（成熟度等级为 1-6 的小数均值）。
 */
export function exportToCsv(state: ContributionPerformanceState): string {
  const lines: string[] = [];
  lines.push(CSV_HEADERS.map(escapeCsvField).join(","));
  for (const item of state.items) {
    const row = [
      item.employeeName,
      item.department,
      String(item.totalContributions),
      String(item.approvedCount),
      formatPercentage(item.approvalRate),
      item.averageMaturityLevel.toFixed(1),
      String(item.totalReuseRobots),
      String(item.totalReuseEmployees),
      formatPercentage(item.averageSuccessRate),
    ];
    lines.push(row.map(escapeCsvField).join(","));
  }
  // RFC 4180 推荐使用 CRLF 作为行分隔符；CSV 末尾不强制换行符。
  return lines.join("\r\n");
}

/**
 * 按预设时间区间快速设置筛选窗口（需求 11.4）。
 *
 * - "week"：最近 7 天（含今日，截止 `now`）
 * - "month"：本月 1 日 0:00 起，截止 `now`
 * - "quarter"：本季度首月 1 日 0:00 起，截止 `now`
 *
 * 仅修改 `filters.rangeStart/rangeEnd`；调用方需在之后调用
 * `loadContributionPerformance()` 以重新加载。
 */
export function setTimeRange(state: ContributionPerformanceState, range: TimeRange): void {
  const now = new Date();
  const end = now.getTime();
  let start: number;
  switch (range) {
    case "week": {
      // 最近 7 天，按毫秒回退，保持自然时段（含今日）。
      const MS_PER_DAY = 24 * 60 * 60 * 1000;
      start = end - 7 * MS_PER_DAY;
      break;
    }
    case "month": {
      // 本月 1 日 00:00（本地时区）作为起点。
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
      break;
    }
    case "quarter": {
      // 本季度首月 1 日 00:00（本地时区）作为起点。
      // Q1: 0–2 月；Q2: 3–5 月；Q3: 6–8 月；Q4: 9–11 月。
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      start = new Date(now.getFullYear(), quarterStartMonth, 1, 0, 0, 0, 0).getTime();
      break;
    }
  }
  state.filters.rangeStart = start;
  state.filters.rangeEnd = end;
}

// ---------------------------------------------------------------------------
// 内部辅助函数
// ---------------------------------------------------------------------------

/**
 * 派生"本月活跃贡献者" Top 5：按 `totalContributions` 降序取前
 * {@link MONTHLY_TOP_CONTRIBUTORS_LIMIT} 条。使用 `slice()` 复制后排序，
 * 不修改输入数组，避免污染 `state.items` 的展示顺序。
 */
function computeMonthlyTopContributors(
  items: readonly ContributionPerformanceItem[],
): ContributionPerformanceItem[] {
  return items
    .toSorted((a, b) => b.totalContributions - a.totalContributions)
    .slice(0, MONTHLY_TOP_CONTRIBUTORS_LIMIT);
}

/**
 * 质量贡献复合评分（需求 11.6）：
 * `averageMaturityLevel * 0.4 + averageSuccessRate * 0.4 +
 *  (totalReuseRobots / 100) * 0.2`
 * 数值越大代表质量贡献越突出。
 */
function qualityScore(item: ContributionPerformanceItem): number {
  return (
    item.averageMaturityLevel * QUALITY_SCORE_WEIGHTS.maturity +
    item.averageSuccessRate * QUALITY_SCORE_WEIGHTS.successRate +
    (item.totalReuseRobots / REUSE_ROBOTS_SCALE_DENOMINATOR) * QUALITY_SCORE_WEIGHTS.reuseScale
  );
}

/** 将 0-100 的百分比数值序列化为业务可读的 "+N%" / "N%" 字符串。 */
function formatPercentage(value: number): string {
  // 保留 1 位小数以兼顾可读性与精度；负值原样保留符号。
  return `${value.toFixed(1)}%`;
}

/**
 * RFC 4180 风格的 CSV 字段转义：当字段包含 `,`、`"`、`\n`、`\r` 时用双引号包裹，
 * 字段内双引号双写转义。
 */
function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
