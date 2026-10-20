/**
 * CSS class composition constants for the「能力应用管理」module.
 *
 * 所有子页共用的布局 / 间距 / 响应式 / 颜色 class 组合集中在此处，
 * 避免各子页文件中重复硬编码 class 字符串。
 *
 * 实施说明（2026-05-27 修复）：
 * 本模块最初使用 Tailwind utility class 字符串（text-2xl、flex、mb-6 等），
 * 但 `ui/` 工作区没有 Tailwind 构建链路，导致这些类全部失效，模块出现大面积
 * 布局错乱。修复方式是在 `ui/src/styles/enterprise-usage-management.css`
 * 中以普通 CSS 方式实现 `enterprise-usage-*` 系列类名，并将本文件下面的常量
 * 切换为这些已落地的类名。命名前缀遵循 Requirement 8.8（`enterprise-usage-*`、
 * `enterprise-robot-*`、`enterprise-install-*`、`enterprise-governance-*`）。
 */

/** 模块头部容器（模块大标题区域，位于 Tab 行之上） */
export const USAGE_MODULE_HEADER = "enterprise-usage-module-header";

/** 模块大标题（"能力使用管理"，h1，标题字体） */
export const USAGE_MODULE_TITLE = "enterprise-usage-module-title";

/** 页面最外层容器 */
export const USAGE_PAGE_CONTAINER = "enterprise-usage-page-container";

/** KPI 卡片网格（4 列响应式） */
export const USAGE_KPI_GRID = "enterprise-usage-kpi-grid";

/** 表格容器（< 1280px 水平滚动，Requirement 11.6/11.7） */
export const USAGE_TABLE_CONTAINER = "enterprise-usage-table-container";

/** 区域标题 */
export const USAGE_SECTION_TITLE = "enterprise-usage-section-title";

/** 筛选栏容器 */
export const USAGE_FILTER_BAR = "enterprise-usage-filter-bar";

/** 分页容器 */
export const USAGE_PAGINATION_CONTAINER = "enterprise-usage-pagination";

/** Tab 切换容器（与模块头部之间无 margin-top，与下方内容保留 mb） */
export const USAGE_TABS_CONTAINER = "enterprise-usage-tabs";

/** Tab 按钮（未选中） */
export const USAGE_TAB_BUTTON = "enterprise-usage-tab";

/** Tab 按钮（选中） */
export const USAGE_TAB_BUTTON_ACTIVE = "enterprise-usage-tab enterprise-usage-tab--active";

/** 详情弹窗遮罩（modal backdrop） */
export const USAGE_DETAIL_BACKDROP = "enterprise-usage-detail-backdrop";

/** 详情弹窗内容（modal dialog） */
export const USAGE_DETAIL_DIALOG = "enterprise-usage-detail-dialog";

/** @deprecated 兼容旧引用，等同于 USAGE_DETAIL_DIALOG。请改用 USAGE_DETAIL_BACKDROP + USAGE_DETAIL_DIALOG */
export const USAGE_DETAIL_PANEL = USAGE_DETAIL_DIALOG;

/** 空状态容器 */
export const USAGE_EMPTY_STATE = "enterprise-usage-empty-state";
