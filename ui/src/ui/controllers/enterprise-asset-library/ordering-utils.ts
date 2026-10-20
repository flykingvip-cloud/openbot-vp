/**
 * 企业能力中心 — 排序工具函数（Ordering Utils）
 *
 * 实现 design.md 中的两条核心不变量：
 *
 * - Property 11：默认列表排序 — 主键为成熟度降序
 *   （核心资产 > 企业标准 > 企业认证 > 多人复用 > 稳定使用 > 初步形成），
 *   次键为复用价值降序（以 valueSummary.monthlyExecutions 作为 reuseValue 度量）。
 *
 * - Property 17：时间序不变量 —
 *   - 贡献记录按提交时间正序（ascending）
 *   - 审核历史按时间倒序（descending）
 *   - 安装记录按安装时间倒序（descending）
 *   - 审核队列按提交时间正序（ascending），即"先进先审"
 *
 * 设计要点：
 * - 全部为纯函数：返回新数组，不修改输入
 * - 通过 `[...items].sort(...)` 模式实现，依赖 ECMAScript 2019 起
 *   `Array.prototype.sort` 必须稳定的规范保证（Stable Sort）
 * - 严格 TypeScript，禁止使用 any
 *
 * Validates: Requirements 1.5, 5.5, 10.1, 13.5, 13.7, 13.8, 14.1
 */

import type {
  CapabilityMaturity,
  ContributionRecord,
  EnterpriseAssetListItem,
  InstallRelation,
  ReviewQueueItem,
  ReviewRecord,
} from "../../capability/enterprise-capability/types.ts";

/**
 * 成熟度等级数值映射（1–6），用于排序比较。
 *
 * 顺序：初步形成(1) < 稳定使用(2) < 多人复用(3) < 企业认证(4) < 企业标准(5) < 核心资产(6)
 *
 * 与 ../../capability/enterprise-capability/types.ts 中
 * `CapabilityMaturity` 联合类型完全对应。
 */
export const MATURITY_ORDER: Record<CapabilityMaturity, number> = {
  初步形成: 1,
  稳定使用: 2,
  多人复用: 3,
  企业认证: 4,
  企业标准: 5,
  核心资产: 6,
};

/**
 * Property 11 — 列表默认排序比较器。
 *
 * - 主键：`MATURITY_ORDER[b.maturity] - MATURITY_ORDER[a.maturity]`（成熟度降序）
 * - 次键：`b.valueSummary.monthlyExecutions - a.valueSummary.monthlyExecutions`
 *   （同成熟度内按复用价值降序，本月调用次数越多越靠前）
 *
 * 用法：`[...items].sort(compareByDefaultSort)`
 */
export function compareByDefaultSort(
  a: EnterpriseAssetListItem,
  b: EnterpriseAssetListItem,
): number {
  const maturityDiff = MATURITY_ORDER[b.maturity] - MATURITY_ORDER[a.maturity];
  if (maturityDiff !== 0) {
    return maturityDiff;
  }
  return b.valueSummary.monthlyExecutions - a.valueSummary.monthlyExecutions;
}

/**
 * Property 17 — 贡献记录按提交时间正序（ascending）。
 *
 * 展示场景：能力详情页"贡献历史"时间线，按提交时间从早到晚排列。
 *
 * 纯函数：返回新数组，不修改输入；依赖稳定排序保留同一时间戳的相对顺序。
 */
export function sortContributionRecordsAscending(
  records: ContributionRecord[],
): ContributionRecord[] {
  return [...records].toSorted((a, b) => a.timestamp - b.timestamp);
}

/**
 * Property 17 — 审核历史按时间倒序（descending）。
 *
 * 注意：types.ts 注释说明"存储按时间正序，展示层按时间倒序渲染"，
 * 本函数即用于展示层的转换。
 *
 * 纯函数：返回新数组，不修改输入。
 */
export function sortReviewHistoryDescending(records: ReviewRecord[]): ReviewRecord[] {
  return [...records].toSorted((a, b) => b.timestamp - a.timestamp);
}

/**
 * Property 17 — 安装记录按安装时间倒序（descending）。
 *
 * 展示场景：能力详情页"安装记录"列表与安装管理页表格，
 * 最近安装的关系排在最前。
 *
 * 纯函数：返回新数组，不修改输入。
 */
export function sortInstallRecordsDescending(records: InstallRelation[]): InstallRelation[] {
  return [...records].toSorted((a, b) => b.installedAt - a.installedAt);
}

/**
 * Property 17 — 审核队列按提交时间正序（ascending），即"先进先审"。
 *
 * 展示场景：审核队列页（ReviewQueuePage），最早提交的能力优先审核，
 * 避免长期积压。
 *
 * 纯函数：返回新数组，不修改输入。
 */
export function sortReviewQueueAscending(items: ReviewQueueItem[]): ReviewQueueItem[] {
  return [...items].toSorted((a, b) => a.submittedAt - b.submittedAt);
}
