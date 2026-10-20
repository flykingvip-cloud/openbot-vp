import { html, nothing, type TemplateResult } from "lit";
import type { RobotCapabilityItem, RobotCapabilityState } from "../controllers/robot-capability.ts";
import { toFriendlyLabel } from "../controllers/skill-health.ts";
import type { SkillHealthSummary } from "../controllers/skill-health.ts";
import type { SkillRecommendation } from "../controllers/skill-recommendations.ts";
import type { MarketplaceSectionProps } from "./enterprise-incubation/marketplace-section.ts";
import { renderMarketplaceSection } from "./enterprise-incubation/marketplace-section.ts";
import { renderSkillHealthBadge } from "./skill-health-badge.ts";

export type RobotCapabilityTabProps = Pick<
  RobotCapabilityState,
  "loading" | "items" | "error" | "busyRelationId" | "expandedSkillId" | "messages"
> & {
  recommendations?: SkillRecommendation[];
  /** Per-capability next step when install is blocked (employee language). */
  installHints?: Record<string, string>;
  busyInstallId?: string | null;
  /** 员工能力市场区段属性（传入时展示"探索更多能力"入口） */
  marketplace?: MarketplaceSectionProps;
  /** 是否展开员工能力市场区段 */
  marketplaceExpanded?: boolean;
  /** "探索更多能力"按钮点击回调 */
  onToggleMarketplace?: () => void;
  onExpand: (skillId: string | null) => void;
  onToggleEnabled: (relationId: string, enabled: boolean) => void;
  onSwitchVersion: (relationId: string, targetVersion: string) => void;
  onRemove: (relationId: string) => void;
  onInstallRecommended?: (skillId: string) => void;
  onRefresh: () => void;
};

/**
 * Adapts the RobotCapabilityItem.health (SkillHealth from skill-models)
 * to the SkillHealthSummary shape expected by renderSkillHealthBadge.
 */
function toHealthBadgeSummary(health: RobotCapabilityItem["health"]): SkillHealthSummary {
  return {
    status: health.status,
    successRate: health.successRate,
    avgLatencyMs: health.avgLatency,
    lastVerifiedAt: health.lastVerifiedAt,
    friendlyStatusLabel: toFriendlyLabel(health.status),
  };
}

function renderLoadingState(): TemplateResult {
  return html`
    <div class="robot-capability-tab__loading" aria-busy="true">
      <span class="robot-capability-tab__spinner" aria-hidden="true"></span>
      <span>加载中…</span>
    </div>
  `;
}

function renderErrorState(error: string, onRefresh: () => void): TemplateResult {
  return html`
    <div class="robot-capability-tab__error">
      <p class="robot-capability-tab__error-message">${error}</p>
      <button type="button" class="btn btn--sm" @click=${onRefresh}>重试</button>
    </div>
  `;
}

function renderEmptyState(): TemplateResult {
  return html`
    <div class="robot-capability-tab__empty">
      <p>能力将从机器人日常工作中自然积累</p>
    </div>
  `;
}

function renderMoreMenu(item: RobotCapabilityItem, props: RobotCapabilityTabProps): TemplateResult {
  const busy = props.busyRelationId === item.relationId;
  return html`
    <details class="robot-capability-tab__more-menu">
      <summary class="robot-capability-tab__more-trigger" aria-label="更多操作">…</summary>
      <div class="robot-capability-tab__more-dropdown">
        <button
          type="button"
          class="robot-capability-tab__more-action"
          ?disabled=${busy}
          @click=${() => props.onToggleEnabled(item.relationId, !item.enabled)}
        >
          ${item.enabled ? "禁用" : "启用"}
        </button>
        ${
          item.hasNewerVersion && item.secondary.latestVersion
            ? html`
              <button
                type="button"
                class="robot-capability-tab__more-action"
                ?disabled=${busy}
                @click=${() => props.onSwitchVersion(item.relationId, item.secondary.latestVersion!)}
              >
                切换到新版本
              </button>
            `
            : nothing
        }
        <button
          type="button"
          class="robot-capability-tab__more-action robot-capability-tab__more-action--danger"
          ?disabled=${busy}
          @click=${() => props.onRemove(item.relationId)}
        >
          移除
        </button>
      </div>
    </details>
  `;
}

function renderExpandedDetail(
  item: RobotCapabilityItem,
  props: RobotCapabilityTabProps,
): TemplateResult {
  return html`
    <div class="robot-capability-tab__detail">
      <div class="robot-capability-tab__detail-section">
        ${renderSkillHealthBadge({ summary: toHealthBadgeSummary(item.health), variant: "detail" })}
      </div>
      ${
        item.hasNewerVersion
          ? html`
              <div class="robot-capability-tab__version-hint">有更新的版本可切换</div>
            `
          : nothing
      }
      ${renderMoreMenu(item, props)}
    </div>
  `;
}

function renderCapabilityListItem(
  item: RobotCapabilityItem,
  props: RobotCapabilityTabProps,
): TemplateResult {
  const isExpanded = props.expandedSkillId === item.skillId;
  return html`
    <article class="robot-capability-tab__item ${isExpanded ? "is-expanded" : ""}">
      <button
        type="button"
        class="robot-capability-tab__item-main"
        aria-expanded=${String(isExpanded)}
        @click=${() => props.onExpand(isExpanded ? null : item.skillId)}
      >
        <span class="robot-capability-tab__item-name">${item.name || "未命名能力"}</span>
        <span class="robot-capability-tab__item-summary">
          ${item.summary || "这个能力还在积累描述。"}
        </span>
        <span class="robot-capability-tab__item-health">
          ${renderSkillHealthBadge({ summary: toHealthBadgeSummary(item.health), variant: "inline" })}
        </span>
      </button>
      ${isExpanded ? renderExpandedDetail(item, props) : nothing}
    </article>
  `;
}

function healthStatusIcon(health: SkillRecommendation["health"]): string {
  switch (health) {
    case "warning":
      return "⚠️";
    case "broken":
      return "❌";
    default:
      return "✅";
  }
}

function renderRecommendationItem(
  recommendation: SkillRecommendation,
  props: RobotCapabilityTabProps,
): TemplateResult {
  const hint = props.installHints?.[recommendation.skillId]?.trim() ?? "";
  const busy = props.busyInstallId === recommendation.skillId;
  return html`
    <article class="robot-capability-tab__recommendation-item">
      <div class="robot-capability-tab__recommendation-info">
        <span class="robot-capability-tab__recommendation-name">${recommendation.name}</span>
        <span class="robot-capability-tab__recommendation-summary">${recommendation.summary}</span>
        <span class="robot-capability-tab__recommendation-source">${recommendation.sourceLabel}</span>
        ${hint ? html`<p class="robot-capability-tab__recommendation-next">${hint}</p>` : nothing}
      </div>
      <div class="robot-capability-tab__recommendation-actions">
        <span class="robot-capability-tab__recommendation-health" aria-label="${toFriendlyLabel(recommendation.health)}">
          ${healthStatusIcon(recommendation.health)}
        </span>
        ${
          hint
            ? nothing
            : html`
                <button
                  type="button"
                  class="btn btn--sm btn--primary"
                  ?disabled=${busy}
                  @click=${() => props.onInstallRecommended?.(recommendation.skillId)}
                >
                  ${busy ? "处理中…" : "安装"}
                </button>
              `
        }
      </div>
    </article>
  `;
}

function renderRecommendationsSection(
  props: RobotCapabilityTabProps,
): TemplateResult | typeof nothing {
  const recommendations = props.recommendations;
  if (!recommendations || recommendations.length === 0) {
    return nothing;
  }
  return html`
    <section class="robot-capability-tab__recommendations">
      <h3 class="robot-capability-tab__recommendations-header">可为这个机器人增强的能力</h3>
      <div class="robot-capability-tab__recommendations-list">
        ${recommendations.map((rec) => renderRecommendationItem(rec, props))}
      </div>
    </section>
  `;
}

/**
 * 渲染"探索更多能力"入口按钮与市场区段。
 * 点击按钮展开/收起员工能力市场（Req 7.1）。
 */
function renderMarketplaceEntry(props: RobotCapabilityTabProps): TemplateResult | typeof nothing {
  if (!props.onToggleMarketplace) {
    return nothing;
  }

  const expanded = props.marketplaceExpanded ?? false;

  return html`
    <div class="robot-capability-tab__marketplace-entry" style="margin-top:16px">
      <button
        type="button"
        class="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-blue-600 bg-white border border-blue-200 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors cursor-pointer min-h-[32px] min-w-[32px]"
        aria-expanded=${String(expanded)}
        aria-controls="marketplace-section"
        @click=${() => props.onToggleMarketplace?.()}
      >
        <span class="mr-1.5" aria-hidden="true">${expanded ? "▾" : "▸"}</span>
        探索更多能力
      </button>

      ${
        expanded && props.marketplace
          ? html`<div id="marketplace-section">${renderMarketplaceSection(props.marketplace)}</div>`
          : nothing
      }
    </div>
  `;
}

export function renderRobotCapabilityTab(props: RobotCapabilityTabProps): TemplateResult {
  const rootClass =
    "robot-capability-tab robot-capability-tab--flat employee-workbench__module-page employee-workbench__module-page--governance";
  if (props.loading) {
    return html`
      <section class=${rootClass}>
        ${renderLoadingState()}
      </section>
    `;
  }

  if (props.error) {
    return html`
      <section class=${rootClass}>
        ${renderErrorState(props.error, props.onRefresh)}
      </section>
    `;
  }

  if (props.items.length === 0) {
    return html`
      <section class=${rootClass}>
        ${renderEmptyState()}
        ${renderRecommendationsSection(props)}
        ${renderMarketplaceEntry(props)}
      </section>
    `;
  }

  return html`
    <section class=${rootClass}>
      <header class="robot-capability-tab__header">
        <div>
          <h2 class="robot-capability-tab__title">机器人能力</h2>
          <p class="robot-capability-tab__subtitle">这里展示这个机器人会做什么</p>
        </div>
        <button type="button" class="btn btn--sm" @click=${props.onRefresh}>刷新</button>
      </header>
      <div class="robot-capability-tab__list">
        ${props.items.map((item) => renderCapabilityListItem(item, props))}
      </div>
      ${renderRecommendationsSection(props)}
      ${renderMarketplaceEntry(props)}
    </section>
  `;
}
