/**
 * 企业孵化（Enterprise Incubation）控制器层公共导出索引。
 *
 * 此文件是 `controllers/enterprise-incubation/` 包的唯一对外入口：
 * 调用方应仅从此 index 引入符号，不要直接深入子模块路径。
 *
 * 模块分层：
 * - `./incubation-score.ts` — 孵化评分（复合评分计算 + 维度权重）
 * - `./candidate-pool.ts` — 候选池（筛选 / 排序 / 准入判定）
 * - `./promotion-decision.ts` — 晋升决策（校验 / 历史 / 快照）
 * - `./effect-tracking.ts` — 效果追踪（下降率 / 预警判定）
 * - `./upstream-report.ts` — 上报状态展示（状态标签 / 颜色）
 * - `./marketplace.ts` — 能力市场（投影 / 搜索 / 安装标记）
 */

export * from "./incubation-score.ts";
export * from "./candidate-pool.ts";
export * from "./promotion-decision.ts";
export * from "./effect-tracking.ts";
export * from "./upstream-report.ts";
export * from "./marketplace.ts";
