/**
 * 高价值能力卡片流（HighValueCapabilityCards）— 第三屏
 *
 * 展示按成熟度与复用数据排序的重点企业能力资产，以卡片网格形式呈现。
 * 每张卡片包含：能力名称、成熟度指示器、领域标签、价值摘要（业务语言）、
 * "查看详情"链接按钮。
 *
 * 附带功能：
 * - "查看全部能力"按钮（导航至 AllCapabilitiesPage）
 * - "本月活跃贡献者 Top 5"快捷入口
 *
 * 样式：使用 enterprise-components.css 的 .high-value-* 类体系。
 * 领域颜色通过 CSS variable `--domain-color` 注入到 inline style。
 *
 * 验证需求：11.9, 19.7, 19.8, 20.5
 *
 * @module high-value-capability-cards
 */

import { html, type TemplateResult } from "lit";
import type {
  CapabilityDomain,
  CredibilityIndicators,
  ContributionPerformanceItem,
  EnterpriseAssetListItem,
} from "../../capability/enterprise-capability/types.ts";
import { renderCredibilityBadge } from "./credibility-badge.ts";
import { renderMaturityIndicator } from "./maturity-indicator.ts";
import { renderValueSummaryCard } from "./value-summary-card.ts";

export type HighValueCapabilityCardItem = EnterpriseAssetListItem & {
  credibilityIndicators?: CredibilityIndicators;
};

export type HighValueCapabilityCardsProps = {
  capabilities: HighValueCapabilityCardItem[];
  loading: boolean;
  error: string | null;
  monthlyTopContributors: ContributionPerformanceItem[];
  onViewAllCapabilities: () => void;
  onViewCapabilityDetail: (capabilityId: string) => void;
  onViewContributionPerformance: () => void;
};

/**
 * 领域标签颜色映射：每个业务领域对应一个品牌色。
 * 通过 CSS custom property `--domain-color` 注入到组件，
 * CSS 用 `color-mix()` 派生背景透明度，避免拼接 alpha 字符串。
 */
const DOMAIN_CHIP_COLORS: Record<CapabilityDomain, string> = {
  销售: "#3B82F6",
  HR: "#8B5CF6",
  客服: "#10B981",
  财务: "#F59E0B",
  法务: "#6366F1",
  数据分析: "#EC4899",
};

/** 骨架卡片占位数量 */
const SKELETON_CARD_COUNT = 3;

/**
 * 渲染领域标签 chip。
 * 通过 `--domain-color` CSS 变量注入颜色，CSS 派生背景透明度。
 */
function renderDomainChip(domain: CapabilityDomain): TemplateResult {
  const color = DOMAIN_CHIP_COLORS[domain];
  return html`<span
    class="high-value-card__domain-chip"
    style="--domain-color:${color};color:${color}"
    >${domain}</span
  >`;
}

/**
 * 渲染单张高价值能力卡片。
 */
function renderCapabilityCard(
  item: HighValueCapabilityCardItem,
  onViewDetail: (capabilityId: string) => void,
): TemplateResult {
  return html`
    <article class="high-value-card">
      <h3 class="high-value-card__name">${item.name}</h3>
      ${renderMaturityIndicator({ maturity: item.maturity, variant: "compact" })}
      ${renderDomainChip(item.domain)}
      ${renderValueSummaryCard({ summary: item.valueSummary, variant: "inline" })}
      ${
        item.credibilityIndicators
          ? renderCredibilityBadge({
              credibility: item.credibilityIndicators,
              variant: "inline",
            })
          : html``
      }
      <button
        class="high-value-card__detail-btn"
        @click=${() => onViewDetail(item.id)}
        type="button"
      >
        查看详情
      </button>
    </article>
  `;
}

/**
 * 渲染骨架卡片（加载态占位）。
 */
function renderSkeletonCard(): TemplateResult {
  return html`
    <div class="high-value-card high-value-card--skeleton" aria-hidden="true">
      <div class="high-value-card__skeleton-line high-value-card__skeleton-line--title"></div>
      <div class="high-value-card__skeleton-line high-value-card__skeleton-line--meta"></div>
      <div class="high-value-card__skeleton-line high-value-card__skeleton-line--chip"></div>
      <div class="high-value-card__skeleton-line high-value-card__skeleton-line--summary"></div>
      <div class="high-value-card__skeleton-line high-value-card__skeleton-line--btn"></div>
    </div>
  `;
}

/**
 * 渲染"本月活跃贡献者 Top 5"侧边栏迷你区块。
 */
function renderTopContributors(
  contributors: ContributionPerformanceItem[],
  onViewPerformance: () => void,
): TemplateResult {
  const top5 = contributors.slice(0, 5);

  return html`
    <aside class="high-value-contributors">
      <h4 class="high-value-contributors__title">本月活跃贡献者 Top 5</h4>
      ${
        top5.length === 0
          ? html`
              <p class="high-value-contributors__empty">暂无贡献数据</p>
            `
          : html`
            <ul class="high-value-contributors__list">
              ${top5.map(
                (c) => html`
                  <li class="high-value-contributors__item">
                    <div>
                      <span class="high-value-contributors__name">${c.employeeName}</span>
                      <span class="high-value-contributors__dept"> · ${c.department}</span>
                    </div>
                    <span class="high-value-contributors__count"
                      >${c.totalContributions} 次贡献</span
                    >
                  </li>
                `,
              )}
            </ul>
          `
      }
      <a
        class="high-value-contributors__link"
        @click=${(e: Event) => {
          e.preventDefault();
          onViewPerformance();
        }}
        href="#"
      >
        查看贡献绩效 →
      </a>
    </aside>
  `;
}

/**
 * 渲染高价值能力卡片流（第三屏）。
 *
 * 验证需求：11.9, 19.7, 19.8, 20.5
 */
export function renderHighValueCapabilityCards(
  props: HighValueCapabilityCardsProps,
): TemplateResult {
  const {
    capabilities,
    loading,
    error,
    monthlyTopContributors,
    onViewAllCapabilities,
    onViewCapabilityDetail,
    onViewContributionPerformance,
  } = props;

  let gridContent: TemplateResult;

  if (loading) {
    gridContent = html`
      <div class="high-value-cards__grid">
        ${Array.from({ length: SKELETON_CARD_COUNT }, () => renderSkeletonCard())}
      </div>
    `;
  } else if (error) {
    gridContent = html`
      <div class="high-value-cards__error">
        <p class="high-value-cards__error-text">${error}</p>
        <button
          type="button"
          class="enterprise-btn enterprise-btn--primary"
          @click=${onViewAllCapabilities}
        >
          重试
        </button>
      </div>
    `;
  } else if (capabilities.length === 0) {
    gridContent = html`
      <div class="high-value-cards__empty">
        <p>暂无可展示的企业能力资产。员工提交并通过审核后，会在这里按成熟度与复用价值出现。</p>
      </div>
    `;
  } else {
    gridContent = html`
      <div class="high-value-cards__grid">
        ${capabilities.map((item) => renderCapabilityCard(item, onViewCapabilityDetail))}
      </div>
    `;
  }

  return html`
    <section class="high-value-capability-cards" aria-label="高价值能力">
      <header class="high-value-capability-cards__header">
        <h2 class="high-value-capability-cards__title">高价值能力</h2>
        <p class="high-value-capability-cards__subtitle">
          按成熟度、复用范围与近 30 天增长排序的重点能力资产
        </p>
      </header>

      <div class="high-value-capability-cards__content">
        <div class="high-value-capability-cards__main">${gridContent}</div>
        ${renderTopContributors(monthlyTopContributors, onViewContributionPerformance)}
      </div>

      <footer class="high-value-capability-cards__footer">
        <button
          class="high-value-capability-cards__view-all-btn enterprise-btn enterprise-btn--secondary"
          type="button"
          @click=${onViewAllCapabilities}
        >
          查看全部能力
        </button>
      </footer>
    </section>
  `;
}
