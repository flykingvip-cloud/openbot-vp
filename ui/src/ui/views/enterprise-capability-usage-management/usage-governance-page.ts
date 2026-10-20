/**
 * Usage Governance Page — 「使用治理」子页外框。
 *
 * 编排：Page Header → 三个 Tabs（低效 / 未使用 / 冲突，含数量徽章）→ 阈值配置面板 → Tab 内容 → 平台跳转链接
 *
 * 落实需求：Requirements 7.1–7.10, 9.6
 */

import { html, nothing, type TemplateResult } from "lit-html";
import type { GovernanceIssue } from "../../capability/runtime-projection/types.ts";
import type {
  GovernanceTab,
  UsageGovernanceController,
  UsageGovernanceState,
} from "../../controllers/enterprise-capability-usage-management/usage-governance.ts";
import { renderEmptyState } from "./shared/empty-state.ts";
import { formatExecutions, formatSuccessRate } from "./shared/format.ts";
import {
  USAGE_PAGE_CONTAINER,
  USAGE_SECTION_TITLE,
  USAGE_TABLE_CONTAINER,
  USAGE_TAB_BUTTON,
  USAGE_TAB_BUTTON_ACTIVE,
  USAGE_TABS_CONTAINER,
} from "./shared/styles.css.ts";

export type UsageGovernancePageProps = {
  state: UsageGovernanceState;
  controller: UsageGovernanceController;
  basePath: string;
  tenantId: string;
};

const TABS: { label: GovernanceTab; emptyMessage: string }[] = [
  { label: "低效能力", emptyMessage: "暂无低效能力" },
  { label: "未使用能力", emptyMessage: "暂无未使用能力" },
  { label: "冲突能力", emptyMessage: "暂无冲突能力" },
];

function getTabCount(state: UsageGovernanceState, tab: GovernanceTab): number {
  switch (tab) {
    case "低效能力":
      return state.lowEfficiency.filter((i) => !state.acknowledgedIssues.has(i.issueId)).length;
    case "未使用能力":
      return state.zombie.filter((i) => !state.acknowledgedIssues.has(i.issueId)).length;
    case "冲突能力":
      return state.conflict.filter((i) => !state.acknowledgedIssues.has(i.issueId)).length;
  }
}

function renderTabs(
  state: UsageGovernanceState,
  controller: UsageGovernanceController,
): TemplateResult {
  return html`
    <div class="${USAGE_TABS_CONTAINER}">
      ${TABS.map(
        (tab) => html`
          <button
            class="${state.activeTab === tab.label ? USAGE_TAB_BUTTON_ACTIVE : USAGE_TAB_BUTTON}"
            style="min-width: 32px; min-height: 32px;"
            @click=${() => controller.changeTab(tab.label)}
          >
            ${tab.label}
            <span class="enterprise-governance-badge ml-1 inline-flex items-center justify-center w-5 h-5 text-xs rounded-full bg-gray-200 text-gray-600">${getTabCount(state, tab.label)}</span>
          </button>
        `,
      )}
    </div>
  `;
}

function renderIssueRow(
  issue: GovernanceIssue,
  controller: UsageGovernanceController,
): TemplateResult {
  return html`
    <tr class="enterprise-governance-issue-row hover:bg-gray-50 text-sm">
      <td class="px-4 py-3 font-medium text-gray-900">${issue.description}</td>
      <td class="px-4 py-3">
        ${issue.evidence.executions30d !== undefined ? formatExecutions(issue.evidence.executions30d) : "—"}
      </td>
      <td class="px-4 py-3">
        ${issue.evidence.successRate !== undefined ? formatSuccessRate(issue.evidence.successRate) : "—"}
      </td>
      <td class="px-4 py-3">
        <div class="flex gap-2">
          <button
            class="text-blue-600 hover:text-blue-800 text-xs font-medium"
            style="min-width: 32px; min-height: 32px;"
            @click=${() => controller.executeSuggestion(issue)}
          >${issue.suggestion}</button>
          <button
            class="text-gray-400 hover:text-gray-600 text-xs"
            style="min-width: 32px; min-height: 32px;"
            @click=${() => controller.acknowledge(issue.issueId)}
          >暂不处理</button>
        </div>
      </td>
    </tr>
  `;
}

function renderIssueTable(
  issues: GovernanceIssue[],
  controller: UsageGovernanceController,
  emptyMessage: string,
): TemplateResult {
  if (issues.length === 0) {
    return renderEmptyState(emptyMessage);
  }

  return html`
    <div class="${USAGE_TABLE_CONTAINER}">
      <table class="enterprise-governance-table w-full text-sm text-left">
        <thead class="text-xs text-gray-500 uppercase bg-gray-50 border-b">
          <tr>
            <th class="px-4 py-3">问题描述</th>
            <th class="px-4 py-3">调用量</th>
            <th class="px-4 py-3">成功率</th>
            <th class="px-4 py-3">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          ${issues.map((issue) => renderIssueRow(issue, controller))}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * 渲染「使用治理」子页。
 */
export function renderUsageGovernancePage(props: UsageGovernancePageProps): TemplateResult {
  const { state, controller } = props;
  const currentTab = TABS.find((t) => t.label === state.activeTab) ?? TABS[0];
  const visibleIssues = controller.getVisibleIssues(state.activeTab);

  return html`
    <div class="${USAGE_PAGE_CONTAINER}">
      <div class="mb-6">
        <h1 class="${USAGE_SECTION_TITLE}">使用治理</h1>
      </div>

      ${renderTabs(state, controller)}

      ${
        state.loading
          ? html`<div class="animate-pulse space-y-3">${[1, 2, 3].map(
              () =>
                html`
                  <div class="h-12 bg-gray-100 rounded"></div>
                `,
            )}</div>`
          : html`
          ${state.error ? html`<div class="bg-red-50 border border-red-200 rounded p-3 mb-4 text-sm text-red-700">${state.error}</div>` : nothing}
          ${renderIssueTable(visibleIssues, controller, currentTab.emptyMessage)}
        `
      }

      <div class="mt-6 pt-4 border-t border-gray-200">
        <a
          class="enterprise-governance-platform-link text-sm text-gray-500 hover:text-blue-600"
          href="/platform/agents"
          target="_blank"
          rel="noopener"
        >前往平台资产管理中心查看技术详情 →</a>
      </div>
    </div>
  `;
}
