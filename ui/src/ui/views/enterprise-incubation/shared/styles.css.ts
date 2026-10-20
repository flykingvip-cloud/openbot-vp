/**
 * Enterprise CSS class composition constants for the「企业孵化中心」模块。
 *
 * 所有子页共用的布局 / 间距 / 响应式 / 颜色 class 组合集中在此处。
 * 当前项目没有 Tailwind 构建链路，因此这里必须使用已落地的 enterprise-* CSS 类。
 *
 * 视觉风格约束（Requirement 9.6）：
 * 采用与企业能力中心一致的视觉风格 — 主题 token 背景、蓝色主色调。
 *
 * CSS 命名前缀约束（Requirement 13.1）：
 * 自定义 class 使用 `enterprise-incubation-*` 前缀。
 * 禁止 `platform-*` / `agent-*` / `runtime-*`。
 *
 * 本文件同时引用 `enterprise-foundation.css` 提供的基础 class
 * （如 `.enterprise-page`、`.enterprise-card` 等），
 * 在此基础上定义孵化中心特有的组合常量。
 */

// ─── 颜色常量 ────────────────────────────────────────────────────────────────

/** 蓝色主色调（按钮、链接、选中态） */
export const COLOR_PRIMARY = "enterprise-incubation-text-link";

/** 蓝色主色调背景（按钮填充） */
export const COLOR_PRIMARY_BG = "enterprise-btn--primary";

/** 蓝色主色调 hover */
export const COLOR_PRIMARY_HOVER = "enterprise-btn--primary";

/** 蓝色浅背景（卡片高亮、选中态背景） */
export const COLOR_PRIMARY_LIGHT_BG = "enterprise-incubation-surface-tint";

/** 蓝色边框（选中态） */
export const COLOR_PRIMARY_BORDER = "enterprise-incubation-border-accent";

// ─── 页面布局 ────────────────────────────────────────────────────────────────

/** 页面内容区域（最大宽度 1280px，水平居中，水平内边距 24px） */
export const INCUBATION_PAGE_CONTENT =
  "enterprise-page__content enterprise-page__content--wide enterprise-incubation-page__content";

/** 页面头部容器（标题 + 操作按钮） */
export const INCUBATION_PAGE_HEADER = "enterprise-page__header enterprise-incubation-page__header";

/** 页面大标题 */
export const INCUBATION_PAGE_TITLE = "enterprise-page__title enterprise-incubation-page__title";

/** 页面副标题 */
export const INCUBATION_PAGE_SUBTITLE = "enterprise-page__subtitle";

/** 页面操作按钮区域 */
export const INCUBATION_PAGE_ACTIONS = "enterprise-page__actions";

/** 区段容器（区段间距 32px） */
export const INCUBATION_SECTIONS = "enterprise-page__sections enterprise-incubation-sections";

// ─── 区段标题 ────────────────────────────────────────────────────────────────

/** 区域标题 */
export const INCUBATION_SECTION_TITLE =
  "enterprise-section__title enterprise-incubation-section-title";

/** 区域描述 */
export const INCUBATION_SECTION_DESCRIPTION =
  "enterprise-section__description enterprise-incubation-section-description";

// ─── 卡片样式 ────────────────────────────────────────────────────────────────

/** 通用卡片（白色背景 + 圆角 + 边框 + 阴影） */
export const INCUBATION_CARD = "enterprise-card enterprise-incubation-card";

/** 紧凑卡片 */
export const INCUBATION_CARD_COMPACT =
  "enterprise-card enterprise-card--compact enterprise-incubation-card";

/** 扁平卡片（无阴影） */
export const INCUBATION_CARD_FLAT =
  "enterprise-card enterprise-card--flat enterprise-incubation-card-flat";

/** 统计卡片 */
export const INCUBATION_STAT_CARD = "enterprise-stat-card enterprise-incubation-stat-card";

/** 统计卡片标签 */
export const INCUBATION_STAT_LABEL = "enterprise-stat-card__label";

/** 统计卡片数值 */
export const INCUBATION_STAT_VALUE = "enterprise-stat-card__value";

/** 统计卡片变化（正向） */
export const INCUBATION_STAT_CHANGE_POSITIVE =
  "enterprise-stat-card__change enterprise-stat-card__change--positive";

/** 统计卡片变化（负向） */
export const INCUBATION_STAT_CHANGE_NEGATIVE =
  "enterprise-stat-card__change enterprise-stat-card__change--negative";

// ─── 统计网格 ────────────────────────────────────────────────────────────────

/** KPI 统计卡片网格（4 列响应式） */
export const INCUBATION_STATS_GRID = "enterprise-stats-grid enterprise-incubation-stats-grid";

// ─── 徽章/状态样式 ──────────────────────────────────────────────────────────

/** 徽章基础样式 */
export const INCUBATION_BADGE_BASE = "enterprise-status-badge";

/** 灰色徽章（待审批） */
export const INCUBATION_BADGE_GRAY = "enterprise-status-badge enterprise-status-badge--neutral";

/** 蓝色徽章（审批中） */
export const INCUBATION_BADGE_BLUE = "enterprise-status-badge enterprise-status-badge--info";

/** 绿色徽章（已通过） */
export const INCUBATION_BADGE_GREEN = "enterprise-status-badge enterprise-status-badge--success";

/** 红色徽章（已拒绝） */
export const INCUBATION_BADGE_RED = "enterprise-status-badge enterprise-status-badge--danger";

/** 橙色徽章（需补充材料） */
export const INCUBATION_BADGE_ORANGE = "enterprise-status-badge enterprise-status-badge--warning";

/** 提案状态到徽章样式的映射 */
export const PROPOSAL_STATUS_BADGE: Record<string, string> = {
  pending: INCUBATION_BADGE_GRAY,
  reviewing: INCUBATION_BADGE_BLUE,
  approved: INCUBATION_BADGE_GREEN,
  rejected: INCUBATION_BADGE_RED,
  supplement_required: INCUBATION_BADGE_ORANGE,
};

// ─── 按钮样式 ────────────────────────────────────────────────────────────────

/** 主要按钮（蓝色填充） */
export const INCUBATION_BTN_PRIMARY = "enterprise-btn enterprise-btn--primary";

/** 次要按钮（蓝色边框） */
export const INCUBATION_BTN_SECONDARY = "enterprise-btn enterprise-btn--secondary";

/** 警告按钮（红色边框） */
export const INCUBATION_BTN_WARNING = "enterprise-btn enterprise-btn--danger";

/** 幽灵按钮（无边框） */
export const INCUBATION_BTN_GHOST = "enterprise-btn enterprise-btn--ghost";

// ─── 排版 ────────────────────────────────────────────────────────────────────

/** 正文文本 */
export const INCUBATION_TEXT_BODY = "enterprise-incubation-text-body";

/** 辅助文本 */
export const INCUBATION_TEXT_MUTED = "enterprise-incubation-text-muted";

/** 强调文本 */
export const INCUBATION_TEXT_STRONG = "enterprise-incubation-text-strong";

/** 链接文本 */
export const INCUBATION_TEXT_LINK = "enterprise-incubation-text-link";

// ─── 布局辅助 ────────────────────────────────────────────────────────────────

/** Flex 行（水平排列，垂直居中） */
export const INCUBATION_FLEX_ROW = "enterprise-incubation-flex-row";

/** Flex 行（两端对齐） */
export const INCUBATION_FLEX_BETWEEN = "enterprise-incubation-flex-between";

/** Flex 列 */
export const INCUBATION_FLEX_COL = "enterprise-incubation-flex-col";

/** 网格布局（2 列） */
export const INCUBATION_GRID_2 = "enterprise-incubation-grid enterprise-incubation-grid--2";

/** 网格布局（3 列） */
export const INCUBATION_GRID_3 = "enterprise-incubation-grid enterprise-incubation-grid--3";

/** 网格布局（4 列） */
export const INCUBATION_GRID_4 = "enterprise-incubation-grid enterprise-incubation-grid--4";

// ─── 筛选栏与工具栏 ─────────────────────────────────────────────────────────

/** 筛选栏容器 */
export const INCUBATION_FILTER_BAR = "enterprise-filter-bar enterprise-incubation-filter-bar";

/** 搜索输入框 */
export const INCUBATION_SEARCH_INPUT = "enterprise-filter-bar__input enterprise-toolbar__search";

/** 筛选下拉 */
export const INCUBATION_FILTER_SELECT = "enterprise-filter-bar__select";

// ─── 表格 ────────────────────────────────────────────────────────────────────

/** 表格容器（水平滚动） */
export const INCUBATION_TABLE_CONTAINER = "enterprise-table-wrap";

/** 表格 */
export const INCUBATION_TABLE = "enterprise-table";

/** 表头单元格 */
export const INCUBATION_TABLE_TH = "enterprise-incubation-table-th";

/** 表格单元格 */
export const INCUBATION_TABLE_TD = "enterprise-incubation-table-td";

// ─── Tab 切换 ────────────────────────────────────────────────────────────────

/** Tab 容器 */
export const INCUBATION_TABS_CONTAINER = "contribution-performance-page__tabs";

/** Tab 按钮（未选中） */
export const INCUBATION_TAB_BUTTON = "contribution-performance-page__tab";

/** Tab 按钮（选中，蓝色主色调） */
export const INCUBATION_TAB_BUTTON_ACTIVE = "contribution-performance-page__tab is-active";

// ─── 弹窗 ────────────────────────────────────────────────────────────────────

/** 弹窗遮罩 */
export const INCUBATION_MODAL_BACKDROP = "enterprise-incubation-modal-backdrop";

/** 弹窗内容 */
export const INCUBATION_MODAL_DIALOG = "enterprise-incubation-modal-dialog";

/** 弹窗头部 */
export const INCUBATION_MODAL_HEADER = "enterprise-incubation-modal-header";

/** 弹窗主体 */
export const INCUBATION_MODAL_BODY = "enterprise-incubation-modal-body";

/** 弹窗底部 */
export const INCUBATION_MODAL_FOOTER = "enterprise-incubation-modal-footer";

// ─── 分页 ────────────────────────────────────────────────────────────────────

/** 分页容器 */
export const INCUBATION_PAGINATION = "enterprise-incubation-pagination";

// ─── 空状态 ──────────────────────────────────────────────────────────────────

/** 空状态容器 */
export const INCUBATION_EMPTY_STATE = "enterprise-empty enterprise-incubation-empty";

/** 空状态图标 */
export const INCUBATION_EMPTY_ICON = "enterprise-empty__icon";

/** 空状态标题 */
export const INCUBATION_EMPTY_TITLE = "enterprise-empty__title";

/** 空状态描述 */
export const INCUBATION_EMPTY_DESCRIPTION = "enterprise-empty__description";

// ─── 骨架屏 ──────────────────────────────────────────────────────────────────

/** 骨架屏基础（动画闪烁） */
export const INCUBATION_SKELETON = "enterprise-skeleton";

/** 骨架屏 — 文本行 */
export const INCUBATION_SKELETON_TEXT = "enterprise-skeleton enterprise-skeleton--text";

/** 骨架屏 — 标题 */
export const INCUBATION_SKELETON_TITLE = "enterprise-skeleton enterprise-skeleton--title";

/** 骨架屏 — 卡片 */
export const INCUBATION_SKELETON_CARD = "enterprise-skeleton enterprise-skeleton--card";
