/**
 * 企业端模块标准抬头
 *
 * ## 规范（主导航模块）
 * - 使用 `renderEnterpriseModuleHeader`
 * - 标题与侧栏 `nav.items.*` 一致，20px 单行
 * - 不渲染副标题（标题栏下不再显示释义文字，保持统一简洁）
 * - 右侧 `trailing` 放指标、刷新、主操作
 * - 底部分割线，无渐变卡片、无英文眉题
 *
 * ## 规范（子页面 / 深链）
 * - 使用 `renderEnterpriseSubpageHeader`（返回 + 标题 + 可选 trailing）
 * - 子页面不重复主导航级长说明
 */

import { html, nothing, type TemplateResult } from "lit";
import { renderIcon } from "../icons.ts";

/** 标准刷新动作配置（页眉右侧统一渲染 `refreshCw` 图标按钮 + pending 态）。 */
export type EnterpriseModuleHeaderRefresh = {
  onRefresh: () => unknown;
  /** 刷新进行中：禁用按钮并显示「刷新中…」。 */
  pending?: boolean;
};

export type EnterpriseModuleHeaderProps = {
  title: string;
  /**
   * @deprecated 模块页眉不再渲染副标题（统一移除标题栏下的释义文字，保持简洁）；
   * 保留该字段以兼容既有调用方，传入将被忽略。子页面说明请用 `renderEnterpriseSubpageHeader`。
   */
  subtitle?: string;
  /** 标准刷新动作；未传则不渲染刷新按钮（向后兼容）。 */
  refresh?: EnterpriseModuleHeaderRefresh;
  /** 标题右侧区域：指标、导出等额外操作；与刷新按钮叠加渲染。 */
  trailing?: TemplateResult;
  /**
   * 当提供时，模块标题变为可点击（例如从二级/三级页面回到模块首页）。
   * 首页态不要传，避免无意义自链。
   */
  onTitleClick?: () => void;
};

/**
 * 标准刷新按钮：`btn btn--sm` + `refreshCw` 图标 + pending 禁用态。
 * 与平台端 `platform-surfaces` 刷新按钮保持一致的文案与交互。
 */
function renderRefreshButton(refresh: EnterpriseModuleHeaderRefresh): TemplateResult {
  const pending = refresh.pending ?? false;
  return html`
    <button
      type="button"
      class="btn btn--sm"
      ?disabled=${pending}
      @click=${() => refresh.onRefresh()}
    >
      ${renderIcon("refreshCw", "btn__icon")} ${pending ? "刷新中…" : "刷新"}
    </button>
  `;
}

export type EnterpriseSubpageHeaderProps = {
  title: string;
  subtitle?: string;
  onBack: () => void;
  trailing?: TemplateResult;
};

/**
 * 主导航模块页眉（企业总览、能力中心、组织、机巢、应用管理、系统设置等）。
 */
export function renderEnterpriseModuleHeader(props: EnterpriseModuleHeaderProps): TemplateResult {
  const refreshButton = props.refresh ? renderRefreshButton(props.refresh) : nothing;
  const hasTrailing = props.refresh || props.trailing;
  const title = props.onTitleClick
    ? html`
        <button
          type="button"
          class="enterprise-page__title enterprise-page__title--link"
          @click=${props.onTitleClick}
        >
          ${props.title}
        </button>
      `
    : html`<h1 class="enterprise-page__title">${props.title}</h1>`;
  return html`
    <header class="enterprise-module-header" aria-label=${props.title}>
      <div class="enterprise-module-header__copy">${title}</div>
      ${
        hasTrailing
          ? html`<div class="enterprise-module-header__trailing">${refreshButton}${props.trailing ?? nothing}</div>`
          : nothing
      }
    </header>
  `;
}

/**
 * 子路由 / 深链页眉（审核队列、贡献绩效等带返回的页面）。
 */
export function renderEnterpriseSubpageHeader(props: EnterpriseSubpageHeaderProps): TemplateResult {
  return html`
    <header
      class="enterprise-module-header enterprise-module-header--subpage"
      aria-label=${props.title}
    >
      <button type="button" class="enterprise-back-btn" @click=${props.onBack}>← 返回</button>
      <div class="enterprise-module-header__copy">
        <h1 class="enterprise-page__title">${props.title}</h1>
        ${props.subtitle ? html`<p class="enterprise-page__subtitle">${props.subtitle}</p>` : nothing}
      </div>
      ${
        props.trailing
          ? html`<div class="enterprise-module-header__trailing">${props.trailing}</div>`
          : nothing
      }
    </header>
  `;
}
