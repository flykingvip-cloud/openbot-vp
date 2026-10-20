/**
 * 贡献绩效页面（ContributionPerformancePage）
 *
 * 展示按员工维度聚合的贡献数据与排行榜。
 *
 * 验证需求：11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9
 *
 * 样式：使用 enterprise-foundation.css + enterprise-components.css 体系。
 */

import { html, nothing, type TemplateResult } from "lit";
import type { ContributionPerformanceItem } from "../../capability/enterprise-capability/types.ts";

export type ContributionPerformanceSubView = "performance" | "records";

export type ContributionPerformancePageProps = {
  items: ContributionPerformanceItem[];
  loading: boolean;
  error: string | null;
  leaderboardView: "quantity" | "quality";
  filters: { department: string | null; rangeStart: number | null; rangeEnd: number | null };
  /** 二级子视图：绩效明细 / 贡献流水。 */
  subView: ContributionPerformanceSubView;
  onSubViewChange: (view: ContributionPerformanceSubView) => void;
  /** 贡献流水子视图内容（嵌入式贡献记录表，由上层注入）。 */
  recordsPanel: TemplateResult;
  onFilterDepartment: (dept: string | null) => void;
  onSetTimeRange: (range: "week" | "month" | "quarter") => void;
  onChangeLeaderboardView: (view: "quantity" | "quality") => void;
  onExportCsv: () => void;
  onBack: () => void;
};

function renderPerformanceDetail(props: ContributionPerformancePageProps): TemplateResult {
  const {
    items,
    loading,
    error,
    leaderboardView,
    filters,
    onFilterDepartment,
    onSetTimeRange,
    onChangeLeaderboardView,
  } = props;
  return html`
    <div class="enterprise-filter-bar">
      <input
        type="text"
        class="enterprise-filter-bar__input"
        placeholder="按部门筛选"
        .value=${filters.department ?? ""}
        @input=${(e: Event) => onFilterDepartment((e.target as HTMLInputElement).value || null)}
      />
      <button
        type="button"
        class="enterprise-btn enterprise-btn--ghost"
        @click=${() => onSetTimeRange("week")}
      >
        本周
      </button>
      <button
        type="button"
        class="enterprise-btn enterprise-btn--ghost"
        @click=${() => onSetTimeRange("month")}
      >
        本月
      </button>
      <button
        type="button"
        class="enterprise-btn enterprise-btn--ghost"
        @click=${() => onSetTimeRange("quarter")}
      >
        本季度
      </button>
      <div class="contribution-performance-page__sort" role="group" aria-label="排序方式">
        <span class="contribution-performance-page__sort-label">排序</span>
        <button
          type="button"
          class="contribution-performance-page__sort-btn ${
            leaderboardView === "quantity" ? "is-active" : ""
          }"
          aria-pressed=${String(leaderboardView === "quantity")}
          @click=${() => onChangeLeaderboardView("quantity")}
        >
          贡献数量
        </button>
        <button
          type="button"
          class="contribution-performance-page__sort-btn ${
            leaderboardView === "quality" ? "is-active" : ""
          }"
          aria-pressed=${String(leaderboardView === "quality")}
          @click=${() => onChangeLeaderboardView("quality")}
        >
          质量评分
        </button>
      </div>
    </div>

    ${
      loading
        ? html`
            <div class="enterprise-empty-message">加载中...</div>
          `
        : error
          ? html`<div class="enterprise-empty-message">${error}</div>`
          : items.length === 0
            ? html`
                <div class="enterprise-empty-message">暂无贡献绩效数据</div>
              `
            : html`
              <table class="contribution-performance-page__table">
                <thead>
                  <tr>
                    <th>排名</th>
                    <th>员工</th>
                    <th>部门</th>
                    <th>贡献数</th>
                    <th>通过数</th>
                    <th>通过率</th>
                    <th>平均成熟度</th>
                    <th>机器人数</th>
                    <th>复用员工数</th>
                    <th>成功率</th>
                  </tr>
                </thead>
                <tbody>
                  ${items.map(
                    (item, i) => html`
                      <tr>
                        <td>${i + 1}</td>
                        <td>${item.employeeName}</td>
                        <td>${item.department}</td>
                        <td>${item.totalContributions}</td>
                        <td>${item.approvedCount}</td>
                        <td>${item.approvalRate.toFixed(1)}%</td>
                        <td>${item.averageMaturityLevel.toFixed(1)}</td>
                        <td>${item.totalReuseRobots}</td>
                        <td>${item.totalReuseEmployees}</td>
                        <td>${item.averageSuccessRate.toFixed(1)}%</td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            `
    }
  `;
}

export function renderContributionPerformancePage(
  props: ContributionPerformancePageProps,
): TemplateResult {
  const { subView, onSubViewChange, recordsPanel, onExportCsv, onBack } = props;

  const subTabs: Array<{ id: ContributionPerformanceSubView; label: string }> = [
    { id: "performance", label: "绩效明细" },
    { id: "records", label: "贡献流水" },
  ];

  return html`
    <div class="contribution-performance-page enterprise-page">
      <div class="enterprise-page__content">
        <header class="enterprise-page-header-row">
          <button type="button" class="enterprise-back-btn" @click=${onBack}>← 返回</button>
          <h1 class="enterprise-page-header-row__title">贡献绩效</h1>
          ${
            subView === "performance"
              ? html`<button
                  type="button"
                  class="enterprise-btn enterprise-btn--secondary"
                  @click=${onExportCsv}
                >
                  导出 CSV
                </button>`
              : nothing
          }
        </header>

        <div
          class="enterprise-usage-subtabs contribution-performance-page__subtabs"
          role="tablist"
          aria-label="贡献绩效子视图"
        >
          ${subTabs.map(
            (tab) => html`
              <button
                type="button"
                role="tab"
                aria-selected=${String(subView === tab.id)}
                class="enterprise-usage-subtab ${subView === tab.id ? "enterprise-usage-subtab--active" : ""}"
                @click=${() => onSubViewChange(tab.id)}
              >
                ${tab.label}
              </button>
            `,
          )}
        </div>

        ${subView === "performance" ? renderPerformanceDetail(props) : recordsPanel}
      </div>
    </div>
  `;
}
