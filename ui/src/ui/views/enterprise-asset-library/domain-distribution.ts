/**
 * 能力领域分布（DomainDistribution）— 第二屏
 *
 * 以网格卡片形式展示"企业能力版图"：按业务领域聚合的 AI 能力分布。
 * 每张卡片对应一个 {@link CapabilityDomain}，展示领域图标、能力数量、
 * 代表性能力列表（最多 3 项）及覆盖率。
 *
 * 布局：
 * - 桌面端 3 列、平板 2 列、移动端 1 列
 * - 卡片按 capabilityCount DESC 排序（由 Controller 预排序）
 *
 * 状态：
 * - Loading：6 张骨架卡片（灰色动画占位）
 * - Error：错误信息 + 重试按钮
 * - 领域能力数为 0：卡片展示"暂无能力"并使用 muted 样式
 *
 * 样式：使用 enterprise-components.css 的 .domain-distribution 类体系。
 * 每个领域通过 data-domain 属性应用颜色（CSS attribute selector）。
 *
 * 验证需求：19.4、19.5、19.6
 */

import { html, nothing, type TemplateResult } from "lit";
import {
  CAPABILITY_DOMAINS,
  type CapabilityDomain,
  type DomainDistribution,
} from "../../capability/enterprise-capability/types.ts";

// ─── Props ───────────────────────────────────────────────────────────────────

export type DomainDistributionProps = {
  domains: DomainDistribution[];
  loading: boolean;
  error: string | null;
  onSelectDomain: (domain: CapabilityDomain) => void;
};

// ─── Domain Visual Config ────────────────────────────────────────────────────

/** 领域 → emoji 图标映射 */
const DOMAIN_ICON: Record<CapabilityDomain, string> = {
  销售: "💼",
  HR: "👥",
  客服: "🎧",
  财务: "💰",
  法务: "⚖️",
  数据分析: "📊",
};

function completeDomainDistribution(domains: readonly DomainDistribution[]): DomainDistribution[] {
  const byDomain = new Map<CapabilityDomain, DomainDistribution>(
    domains.map((item) => [item.domain, item]),
  );
  const presentDomains = domains
    .filter((item) => CAPABILITY_DOMAINS.includes(item.domain))
    .map((item) => item.domain);
  const missingDomains = CAPABILITY_DOMAINS.filter((domain) => !byDomain.has(domain));

  return [...presentDomains, ...missingDomains].map(
    (domain) =>
      byDomain.get(domain) ?? {
        domain,
        capabilityCount: 0,
        representativeCapabilities: [],
        coverageRate: 0,
      },
  );
}

// ─── Render Helpers ──────────────────────────────────────────────────────────

/**
 * 渲染单张领域卡片。
 *
 * 卡片内容：
 * 1. 领域图标（emoji 圆形背景）+ 领域名称
 * 2. 能力数量："N 项能力"
 * 3. 代表性能力列表（最多 3 项）
 * 4. 覆盖率："覆盖率 N%"
 *
 * 点击整张卡片触发 `onSelectDomain(domain)`。
 *
 * 颜色通过 data-domain="销售|HR|..." 属性应用，CSS 通过属性选择器配色。
 */
function renderDomainCard(
  item: DomainDistribution,
  onSelectDomain: (domain: CapabilityDomain) => void,
): TemplateResult {
  const { domain, capabilityCount, representativeCapabilities, coverageRate } = item;
  const isEmpty = capabilityCount === 0;
  const icon = DOMAIN_ICON[domain];

  const capabilities = isEmpty
    ? nothing
    : html`
        <ul class="domain-distribution__list" aria-label="代表性能力">
          ${representativeCapabilities
            .slice(0, 3)
            .map((name) => html`<li class="domain-distribution__item">${name}</li>`)}
        </ul>
      `;

  const countText = isEmpty ? "暂无能力" : `${capabilityCount} 项能力`;
  const cardClass = isEmpty
    ? "domain-distribution__card domain-distribution__card--empty"
    : "domain-distribution__card";

  return html`
    <article
      class=${cardClass}
      data-domain=${domain}
      style=${isEmpty ? "opacity:0.6" : ""}
      role="button"
      tabindex="0"
      aria-label="领域：${domain}，${countText}"
      @click=${() => onSelectDomain(domain)}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelectDomain(domain);
        }
      }}
    >
      <div class="domain-distribution__header">
        <span class="domain-distribution__icon" data-domain=${domain} aria-hidden="true">
          ${icon}
        </span>
        <h3 class="domain-distribution__name">${domain}</h3>
      </div>
      <p
        class="domain-distribution__count ${isEmpty ? "domain-distribution__count--empty" : ""}"
      >
        ${countText}
      </p>
      ${capabilities}
      ${
        isEmpty
          ? nothing
          : html`<p class="domain-distribution__coverage">覆盖率 ${coverageRate}%</p>`
      }
    </article>
  `;
}

/** 渲染 6 张骨架卡片（加载态） */
function renderSkeletonGrid(): TemplateResult {
  const skeletons = Array.from(
    { length: 6 },
    (_, i) => html`
      <div
        class="domain-distribution__skeleton enterprise-skeleton"
        aria-hidden="true"
        key=${`skeleton-${i}`}
      ></div>
    `,
  );

  return html`<div class="domain-distribution__grid">${skeletons}</div>`;
}

/** 渲染错误状态 */
function renderError(error: string): TemplateResult {
  return html`
    <div class="domain-distribution__error" role="alert">
      <p class="domain-distribution__error-text">${error}</p>
      <button
        class="domain-distribution__retry-btn enterprise-btn enterprise-btn--primary"
        type="button"
      >
        重试
      </button>
    </div>
  `;
}

// ─── Main Render ─────────────────────────────────────────────────────────────

/**
 * 渲染"能力领域分布"区块（第二屏）。
 *
 * 验证需求：19.4（领域分布视图）、19.5（领域卡片交互）、19.6（领域覆盖率展示）
 */
export function renderDomainDistribution(props: DomainDistributionProps): TemplateResult {
  const { domains, loading, error, onSelectDomain } = props;

  let content: TemplateResult;

  if (loading) {
    content = renderSkeletonGrid();
  } else if (error) {
    content = renderError(error);
  } else {
    const completeDomains = completeDomainDistribution(domains);
    content = html`
      <div class="domain-distribution__grid">
        ${completeDomains.map((item) => renderDomainCard(item, onSelectDomain))}
      </div>
    `;
  }

  return html`
    <section class="domain-distribution" aria-labelledby="domain-distribution-title">
      <h2 id="domain-distribution-title" class="domain-distribution__title">能力领域分布</h2>
      <p class="domain-distribution__subtitle">按业务领域聚合的企业 AI 能力版图</p>
      ${content}
    </section>
  `;
}
