/**
 * 快捷入口侧边栏（QuickEntrySidebar）
 *
 * 企业能力中心左侧固定宽度侧边栏，提供三个快捷入口：
 *   1. "我的安装能力"  → entry: "my-installed"
 *   2. "我贡献的能力"  → entry: "my-contributed"
 *   3. "全部能力"      → entry: "all"
 *
 * 该组件为纯渲染函数（pure render function）：
 * - 不持有内部状态（activeEntry 由调用方传入）
 * - 通过 `onEntryChange` 回调向调用方上报切换
 *
 * 样式：使用 enterprise-components.css 的 .quick-entry-sidebar 类体系，
 * 响应主题切换。
 *
 * 渲染契约：
 * - 同一时刻仅一个入口处于激活态（蓝色左边框 + 蓝色文字 + 浅蓝背景）
 * - 非激活入口为灰色文字 + 透明背景，hover 时浅灰背景
 * - 点击非激活入口触发 `onEntryChange(entry)`；
 *   调用方将 `"all"` 解释为进入完整能力库视图
 *
 * 验证需求：2.7, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6
 */

import { html, type TemplateResult } from "lit";
import type { SidebarEntry } from "../../capability/enterprise-capability/types.ts";

export type QuickEntrySidebarProps = {
  /** 当前激活的侧边栏入口 */
  activeEntry: SidebarEntry;
  /** 入口切换回调 */
  onEntryChange: (entry: SidebarEntry) => void;
};

/** 侧边栏入口配置：label 与对应的 SidebarEntry 值 */
const SIDEBAR_ITEMS: readonly { label: string; entry: SidebarEntry }[] = [
  { label: "我的安装能力", entry: "my-installed" },
  { label: "我贡献的能力", entry: "my-contributed" },
  { label: "全部能力", entry: "all" },
] as const;

/**
 * 渲染单个侧边栏入口按钮。
 */
function renderEntry(
  item: { label: string; entry: SidebarEntry },
  isActive: boolean,
  onEntryChange: (entry: SidebarEntry) => void,
): TemplateResult {
  const cls = isActive
    ? "quick-entry-sidebar__entry quick-entry-sidebar__entry--active"
    : "quick-entry-sidebar__entry";

  return html`
    <button
      type="button"
      class=${cls}
      aria-current=${isActive ? "true" : "false"}
      @click=${() => onEntryChange(item.entry)}
    >
      ${item.label}
    </button>
  `;
}

/**
 * 渲染快捷入口侧边栏。
 */
export function renderQuickEntrySidebar(props: QuickEntrySidebarProps): TemplateResult {
  return html`
    <aside class="quick-entry-sidebar" aria-label="快捷入口">
      <h3 class="quick-entry-sidebar__title">快捷入口</h3>
      <nav class="quick-entry-sidebar__entries">
        ${SIDEBAR_ITEMS.map((item) =>
          renderEntry(item, item.entry === props.activeEntry, props.onEntryChange),
        )}
      </nav>
    </aside>
  `;
}
