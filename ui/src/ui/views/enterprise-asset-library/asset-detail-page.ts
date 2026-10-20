/**
 * 能力资产详情页（AssetDetailPage）
 *
 * 展示单个 {@link EnterpriseCapabilityAsset} 的完整详情，垂直分区排列：
 *   1. 返回按钮
 *   2. 基本信息（名称、描述、场景标签、适用对象、成熟度、健康状态、创建/更新时间）
 *   3. 价值摘要（ValueSummaryCard card 变体）
 *   4. 可信度（CredibilityBadge detail 变体）
 *   5. 溯源信息（来源员工/机器人/任务、贡献时间线按 timestamp 正序）
 *   6. 复用数据（机器人/员工/部门数 + MiniTrendChart + 时间范围切换按钮组）
 *   7. 审核历史（按 timestamp 倒序：时间、审核人、结果标签、意见）
 *   8. 安装记录（占位提示 — EnterpriseCapabilityAsset 无 installRecords 字段）
 *   9. 外部链接（前往平台治理台查看技术详情）
 *
 * 空状态各区域展示对应提示。Loading 骨架屏，Error 错误 + 重试。
 *
 * 验证需求：12.5, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8
 *
 * 样式：使用 enterprise-foundation.css + enterprise-components.css 体系。
 *
 * @module enterprise-asset-library/asset-detail-page
 */

import { html, nothing, type TemplateResult } from "lit";
import type {
  ContributionRecord,
  EnterpriseCapabilityAsset,
  InstallRelation,
  ReviewRecord,
} from "../../capability/enterprise-capability/types.ts";
import { renderCredibilityBadge } from "./credibility-badge.ts";
import { renderEnterpriseHealthBadge } from "./health-badge.ts";
import { renderMaturityIndicator } from "./maturity-indicator.ts";
import { renderMiniTrendChart } from "./mini-trend-chart.ts";
import { renderValueSummaryCard } from "./value-summary-card.ts";

// ─── Public Types ────────────────────────────────────────────────────────────

export type AssetDetailPageProps = {
  capability: EnterpriseCapabilityAsset | null;
  installRelations?: InstallRelation[];
  loading: boolean;
  error: string | null;
  trendRange: 7 | 30 | 90 | 180;
  onChangeTrendRange: (range: 7 | 30 | 90 | 180) => void;
  onBack: () => void;
  onInstallToRobot: (capabilityId: string) => void;
};

// ─── Trend Range Options ─────────────────────────────────────────────────────

type TrendRangeOption = 7 | 30 | 90 | 180;

const TREND_RANGE_OPTIONS: readonly TrendRangeOption[] = [7, 30, 90, 180] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** 审核结果 → 语义 badge tone 映射 */
const REVIEW_RESULT_TONE: Record<ReviewRecord["result"], "success" | "danger" | "warning"> = {
  通过: "success",
  拒绝: "danger",
  需修改: "warning",
};

/**
 * 格式化时间戳为 YYYY-MM-DD HH:mm 格式。
 */
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * 格式化适用对象为业务语言。
 */
function formatApplicableScope(scope: EnterpriseCapabilityAsset["applicableScope"]): string {
  switch (scope.kind) {
    case "enterprise":
      return "全企业";
    case "department":
      return `部门：${scope.name}`;
    case "group":
      return `小组：${scope.name}`;
    case "role":
      return `角色：${scope.name}`;
  }
}

// ─── Section Renderers ───────────────────────────────────────────────────────

/** 渲染骨架屏占位行 */
function renderSkeletonRow(width = "100%"): TemplateResult {
  return html`<div class="enterprise-skeleton asset-detail-page__skeleton-row" style="width:${width}"></div>`;
}

/** 渲染骨架屏加载状态 */
function renderLoadingSkeleton(): TemplateResult {
  return html`
    <div class="asset-detail-page__skeleton">
      ${renderSkeletonRow()}
      ${renderSkeletonRow("60%")}
      ${renderSkeletonRow("80%")}
      ${renderSkeletonRow("40%")}
      ${renderSkeletonRow("90%")}
      ${renderSkeletonRow("70%")}
      ${renderSkeletonRow("50%")}
      ${renderSkeletonRow("85%")}
    </div>
  `;
}

/** 渲染错误状态 + 重试 */
function renderErrorState(error: string, onBack: () => void): TemplateResult {
  return html`
    <div class="asset-detail-page enterprise-page">
      <div class="enterprise-page__content enterprise-page__content--narrow">
        <button
          type="button"
          class="asset-detail-page__back-btn enterprise-back-btn"
          @click=${onBack}
          aria-label="返回"
        >
          ← 返回
        </button>
        <div class="asset-detail-page__error">
          <span class="asset-detail-page__error-text">${error}</span>
          <button
            type="button"
            class="enterprise-btn enterprise-btn--secondary"
            @click=${onBack}
          >
            返回重试
          </button>
        </div>
      </div>
    </div>
  `;
}

/** 渲染单个 label-value 行 */
function renderInfoRow(label: string, value: TemplateResult | string): TemplateResult {
  return html`
    <div class="asset-detail-page__row">
      <span class="asset-detail-page__label">${label}</span>
      <span class="asset-detail-page__value">${value}</span>
    </div>
  `;
}

/** 区段 2：基本信息 */
function renderBasicInfo(cap: EnterpriseCapabilityAsset): TemplateResult {
  return html`
    <section class="asset-detail-page__section">
      <h2 class="asset-detail-page__section-title">基本信息</h2>

      ${renderInfoRow("名称", cap.name)}
      ${renderInfoRow("描述", cap.description || "暂无描述")}

      <div class="asset-detail-page__row">
        <span class="asset-detail-page__label">场景标签</span>
        <span class="asset-detail-page__value">
          ${
            cap.usageScenarios.length > 0
              ? cap.usageScenarios.map(
                  (s) => html`<span class="asset-detail-page__tag">${s}</span>`,
                )
              : html`
                  <span class="asset-detail-page__empty">暂无场景标签</span>
                `
          }
        </span>
      </div>

      ${renderInfoRow("适用对象", formatApplicableScope(cap.applicableScope))}

      <div class="asset-detail-page__row">
        <span class="asset-detail-page__label">成熟度</span>
        <span class="asset-detail-page__value">
          ${renderMaturityIndicator({ maturity: cap.maturity, variant: "with-label" })}
        </span>
      </div>

      <div class="asset-detail-page__row">
        <span class="asset-detail-page__label">健康状态</span>
        <span class="asset-detail-page__value">
          ${renderEnterpriseHealthBadge({
            status: cap.healthStatus,
            noTelemetry: cap.healthNoTelemetry,
            variant: "detail",
          })}
        </span>
      </div>

      ${renderInfoRow("创建时间", formatTimestamp(cap.createdAt))}
      ${renderInfoRow("更新时间", formatTimestamp(cap.updatedAt))}
    </section>
  `;
}

/** 区段 3：价值摘要 */
function renderValueSection(cap: EnterpriseCapabilityAsset): TemplateResult {
  return html`
    <section class="asset-detail-page__section">
      <h2 class="asset-detail-page__section-title">价值摘要</h2>
      ${renderValueSummaryCard({ summary: cap.valueSummary, variant: "card" })}
    </section>
  `;
}

/** 区段 4：可信度 */
function renderCredibilitySection(cap: EnterpriseCapabilityAsset): TemplateResult {
  return html`
    <section class="asset-detail-page__section">
      ${renderCredibilityBadge({ credibility: cap.credibilityIndicators, variant: "detail" })}
    </section>
  `;
}

/** 区段 5：溯源信息 */
function renderSourceSection(cap: EnterpriseCapabilityAsset): TemplateResult {
  const sortedContributions = cap.contributionHistory.toSorted((a, b) => a.timestamp - b.timestamp);

  return html`
    <section class="asset-detail-page__section">
      <h2 class="asset-detail-page__section-title">溯源信息</h2>

      ${renderInfoRow("来源员工", cap.source.employee.name)}
      ${renderInfoRow("来源机器人", cap.source.robot.name)}
      ${renderInfoRow("来源任务", cap.source.task.summary)}

      <h3 class="asset-detail-page__subsection-title">贡献时间线</h3>
      ${
        sortedContributions.length > 0
          ? sortedContributions.map(
              (record: ContributionRecord) => html`
              <div class="asset-detail-page__timeline-item">
                <span class="asset-detail-page__timeline-time">
                  ${formatTimestamp(record.timestamp)}
                </span>
                <span class="asset-detail-page__timeline-author">${record.employeeName}</span>
                <span class="asset-detail-page__tag">${record.type}</span>
                <span class="asset-detail-page__timeline-summary">${record.summary}</span>
              </div>
            `,
            )
          : html`
              <p class="asset-detail-page__empty">暂无贡献记录</p>
            `
      }
    </section>
  `;
}

/** 区段 6：复用数据 */
function renderReuseSection(
  cap: EnterpriseCapabilityAsset,
  trendRange: TrendRangeOption,
  onChangeTrendRange: (range: TrendRangeOption) => void,
): TemplateResult {
  const { reuseData } = cap;

  return html`
    <section class="asset-detail-page__section">
      <h2 class="asset-detail-page__section-title">复用数据</h2>

      <div class="asset-detail-page__reuse-stats">
        <div class="asset-detail-page__reuse-stat">
          <span class="asset-detail-page__reuse-value">${reuseData.robotCount}</span>
          <span class="asset-detail-page__reuse-label">使用机器人数</span>
        </div>
        <div class="asset-detail-page__reuse-stat">
          <span class="asset-detail-page__reuse-value">${reuseData.employeeCount}</span>
          <span class="asset-detail-page__reuse-label">使用员工数</span>
        </div>
        <div class="asset-detail-page__reuse-stat">
          <span class="asset-detail-page__reuse-value">${reuseData.departmentCount}</span>
          <span class="asset-detail-page__reuse-label">覆盖部门数</span>
        </div>
      </div>

      <div class="asset-detail-page__chart-wrap">
        ${renderMiniTrendChart({
          trend: reuseData.trend30Days,
          growthPercentage: reuseData.growthPercentage,
          width: 160,
          height: 40,
        })}
      </div>

      <div class="asset-detail-page__range-row">
        <span class="asset-detail-page__range-label">时间范围：</span>
        <div class="asset-detail-page__range-group">
          ${TREND_RANGE_OPTIONS.map(
            (range) => html`
              <button
                type="button"
                class="asset-detail-page__range-btn ${trendRange === range ? "is-active" : ""}"
                @click=${() => onChangeTrendRange(range)}
                aria-pressed=${trendRange === range ? "true" : "false"}
              >
                ${range}天
              </button>
            `,
          )}
        </div>
      </div>
    </section>
  `;
}

/** 区段 7：审核历史 */
function renderReviewHistorySection(cap: EnterpriseCapabilityAsset): TemplateResult {
  const sortedReviews = cap.reviewHistory.toSorted((a, b) => b.timestamp - a.timestamp);

  return html`
    <section class="asset-detail-page__section">
      <h2 class="asset-detail-page__section-title">审核历史</h2>
      ${
        sortedReviews.length > 0
          ? sortedReviews.map(
              (record: ReviewRecord) => html`
              <div class="asset-detail-page__timeline-item">
                <span class="asset-detail-page__timeline-time">
                  ${formatTimestamp(record.timestamp)}
                </span>
                <span class="asset-detail-page__timeline-author">${record.reviewerName}</span>
                <span
                  class="enterprise-status-badge enterprise-status-badge--${
                    REVIEW_RESULT_TONE[record.result]
                  }"
                >
                  ${record.result}
                </span>
                <span class="asset-detail-page__timeline-summary">${record.opinion || "—"}</span>
              </div>
            `,
            )
          : html`
              <p class="asset-detail-page__empty">暂无审核记录</p>
            `
      }
    </section>
  `;
}

/** 区段 8：安装记录（占位） */
function renderInstallRecordsSection(installRelations: readonly InstallRelation[]): TemplateResult {
  return html`
    <section class="asset-detail-page__section">
      <h2 class="asset-detail-page__section-title">安装记录</h2>
      ${
        installRelations.length === 0
          ? html`
              <p class="asset-detail-page__empty">暂无安装记录</p>
            `
          : installRelations.map(
              (relation) => html`
                <div class="asset-detail-page__timeline-item">
                  <span class="asset-detail-page__timeline-time">
                    ${formatTimestamp(relation.installedAt)}
                  </span>
                  <span class="asset-detail-page__timeline-author">${relation.robotName}</span>
                  <span class="asset-detail-page__tag">${relation.source}</span>
                  <span class="asset-detail-page__timeline-summary">${relation.status}</span>
                </div>
              `,
            )
      }
    </section>
  `;
}

/** 区段 9：外部链接 */
function renderExternalLink(): TemplateResult {
  return html`
    <a
      class="asset-detail-page__external-link"
      href="/governance"
      target="_blank"
      rel="noopener noreferrer"
    >
      前往平台治理台查看技术详情 →
    </a>
  `;
}

// ─── Main Render Function ────────────────────────────────────────────────────

/**
 * 渲染能力资产详情页。
 *
 * 页面区段垂直排列，展示 {@link EnterpriseCapabilityAsset} 的完整业务视图。
 * 不包含任何运行时字段（prompt/workflow/toolchain/routing/provider/memory）。
 *
 * 状态处理：
 * - loading=true 且 capability=null：展示骨架屏
 * - error 非空：展示错误信息 + 返回重试按钮
 * - capability 非空：展示完整详情
 *
 * **Validates: Requirements 12.5, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8**
 */
export function renderAssetDetailPage(props: AssetDetailPageProps): TemplateResult {
  const {
    capability,
    installRelations = [],
    loading,
    error,
    trendRange,
    onChangeTrendRange,
    onBack,
    onInstallToRobot,
  } = props;

  // 错误状态
  if (error !== null) {
    return renderErrorState(error, onBack);
  }

  // 加载状态（无缓存数据时展示骨架屏）
  if (loading && capability === null) {
    return html`
      <div class="asset-detail-page enterprise-page">
        <div class="enterprise-page__content enterprise-page__content--narrow">
          <button
            type="button"
            class="asset-detail-page__back-btn enterprise-back-btn"
            @click=${onBack}
            aria-label="返回"
          >
            ← 返回
          </button>
          ${renderLoadingSkeleton()}
        </div>
      </div>
    `;
  }

  // 无数据（非加载、非错误）
  if (capability === null) {
    return html`
      <div class="asset-detail-page enterprise-page">
        <div class="enterprise-page__content enterprise-page__content--narrow">
          <button
            type="button"
            class="asset-detail-page__back-btn enterprise-back-btn"
            @click=${onBack}
            aria-label="返回"
          >
            ← 返回
          </button>
          <p class="asset-detail-page__empty">未找到能力资产信息</p>
        </div>
      </div>
    `;
  }

  // 正常展示
  return html`
    <div class="asset-detail-page enterprise-page">
      <div class="enterprise-page__content enterprise-page__content--narrow">
        <!-- 1. 返回按钮 -->
        <button
          type="button"
          class="asset-detail-page__back-btn enterprise-back-btn"
          @click=${onBack}
          aria-label="返回"
        >
          ← 返回
        </button>

        <!-- 操作按钮 -->
        <div class="asset-detail-page__action-row">
          <button
            type="button"
            class="asset-detail-page__install-btn enterprise-btn enterprise-btn--primary"
            @click=${() => onInstallToRobot(capability.id)}
          >
            推送到岗位
          </button>
        </div>

        <!-- 2. 基本信息 -->
        ${renderBasicInfo(capability)}

        <!-- 3. 价值摘要 -->
        ${renderValueSection(capability)}

        <!-- 4. 可信度 -->
        ${renderCredibilitySection(capability)}

        <!-- 5. 溯源信息 -->
        ${renderSourceSection(capability)}

        <!-- 6. 复用数据 -->
        ${renderReuseSection(capability, trendRange, onChangeTrendRange)}

        <!-- 7. 审核历史 -->
        ${renderReviewHistorySection(capability)}

        <!-- 8. 安装记录 -->
        ${renderInstallRecordsSection(installRelations)}

        <!-- 9. 外部链接 -->
        ${renderExternalLink()}

        <!-- 加载中覆盖层（有缓存数据时的刷新指示） -->
        ${
          loading
            ? html`
                <div class="asset-detail-page__refresh-toast">刷新中...</div>
              `
            : nothing
        }
      </div>
    </div>
  `;
}
