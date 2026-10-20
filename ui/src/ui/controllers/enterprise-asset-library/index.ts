/**
 * 企业能力中心（Enterprise Capability Center）控制器层公共导出索引。
 *
 * 此文件是 `controllers/enterprise-asset-library/` 包的唯一对外入口（sole
 * public face）：调用方应仅从此 index 引入 controller / 规则 / 工具相关符号，
 * 不要直接深入子模块路径。这样后续在不破坏外部 API 的前提下可以重组内部
 * 文件结构，例如拆分大文件、合并近似职责的工具模块。
 *
 * 模块分层：
 * - **Controllers**（页面级状态机）
 *   - `./asset-list.ts` — 全部能力列表（侧边栏 + 分页 + 排序 + 筛选）
 *   - `./asset-detail.ts` — 能力详情页（含趋势时间窗口）
 *   - `./statistics.ts` — 企业能力概览（4 个核心指标卡片）
 *   - `./domain-distribution.ts` — 业务领域版图（聚合视图）
 *   - `./review-queue.ts` — 审核队列（通过 / 拒绝 / 需修改）
 *   - `./install-management.ts` — 推送安装与卸载管理
 *   - `./contribution-records.ts` — 贡献记录列表
 *   - `./contribution-performance.ts` — 贡献绩效（排行榜 + CSV 导出）
 *
 * - **Rules**（领域规则 / 状态机）
 *   - `./lifecycle-rules.ts` — 生命周期校验（溯源完整性 / 不可变性）
 *   - `./review-rules.ts` — 审核校验（意见长度、重复任务、通过载荷）
 *   - `./visibility-rules.ts` — 员工可见性判定（按 ApplicableScope）
 *   - `./install-rules.ts` — 安装合法性 + 安装目标校验
 *   - `./maturity-state-machine.ts` — 成熟度自动 / 手动晋升判定
 *   - `./health-mapping.ts` — 遥测 → 业务健康状态映射
 *
 * - **Utils**（纯函数工具）
 *   - `./filter-utils.ts` — 列表筛选与搜索高亮判定
 *   - `./pagination-utils.ts` — 分页计算（自动修正越界页码）
 *   - `./ordering-utils.ts` — 排序比较器（成熟度 / 时间）
 *   - `./domain-aggregation.ts` — 按领域聚合（含空集合占位）
 */

export * from "./asset-list.ts";
export * from "./asset-detail.ts";
export * from "./statistics.ts";
export * from "./domain-distribution.ts";
export * from "./review-queue.ts";
export * from "./install-management.ts";
export * from "./contribution-records.ts";
export * from "./contribution-performance.ts";

export * from "./lifecycle-rules.ts";
export * from "./review-rules.ts";
export * from "./visibility-rules.ts";
export * from "./install-rules.ts";
export * from "./maturity-state-machine.ts";
export * from "./health-mapping.ts";

export * from "./filter-utils.ts";
export * from "./pagination-utils.ts";
export * from "./ordering-utils.ts";
export * from "./domain-aggregation.ts";
