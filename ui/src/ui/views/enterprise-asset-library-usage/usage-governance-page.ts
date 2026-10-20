/**
 * 应用治理 — 能力中心治理摘要。
 *
 * 三个指标用企业端 KPI 卡扫读（低效 / 未使用 / 冲突），下方各有一个分区：
 * 有待处理问题时列出检测结果；某一类为 0 时给诚实空态和既有页签入口。
 * 计数与列表都来自 detectGovernance，不含会话内已「暂不处理」的项。
 *
 * 不在此页新造卸载确认、转移或阈值表单。行内「建议 / 暂不处理」沿用控制器已有动作。
 */

import { html, nothing, type TemplateResult } from "lit-html";
import type { GovernanceIssue } from "../../capability/runtime-projection/types.ts";
import type {
  GovernanceTab,
  UsageGovernanceController,
  UsageGovernanceState,
} from "../../controllers/enterprise-asset-library-usage/usage-governance.ts";
import {
  type EnterpriseKpiItem,
  type EnterpriseKpiTone,
  renderEnterpriseKpiGrid,
} from "../enterprise-kpi-card.ts";
import { formatExecutions, formatSuccessRate } from "./shared/format.ts";
import { USAGE_PAGE_CONTAINER, USAGE_TABLE_CONTAINER } from "./shared/styles.css.ts";

export type UsageGovernancePageProps = {
  state: UsageGovernanceState;
  controller: UsageGovernanceController;
  basePath: string;
  tenantId: string;
};

type GovernanceSection = {
  label: GovernanceTab;
  anchor: string;
  detail: string;
  emptyTitle: string;
  emptyBody: string;
  actionLabel: string;
  /** 能力中心已有页签。skills 对应去掉 ?tab= 的目录。 */
  actionTab: "skills" | "mcp" | "install" | "analytics";
  toneWhenPresent: Exclude<EnterpriseKpiTone, "neutral" | "ok">;
};

const SECTIONS: readonly GovernanceSection[] = [
  {
    label: "低效能力",
    anchor: "enterprise-capability-governance-low",
    detail: "调用较多，但成功率偏低",
    emptyTitle: "暂无低效能力",
    emptyBody: "近 30 天没有调用超过阈值、同时成功率偏低的能力。整体调用和成功率在效果分析里。",
    actionLabel: "查看效果分析",
    actionTab: "analytics",
    toneWhenPresent: "danger",
  },
  {
    label: "未使用能力",
    anchor: "enterprise-capability-governance-unused",
    detail: "已安装，且近 30 天没有调用",
    emptyTitle: "暂无未使用能力",
    emptyBody: "没有已安装且超过阈值天数仍零调用的能力。安装覆盖可以在安装与运行里核对。",
    actionLabel: "查看安装与运行",
    actionTab: "install",
    toneWhenPresent: "warn",
  },
  {
    label: "冲突能力",
    anchor: "enterprise-capability-governance-conflict",
    detail: "同一机器人上职责相近",
    emptyTitle: "暂无冲突能力",
    emptyBody: "没有发现同一机器人上描述相近的能力。目录里的重叠可以对照全部技能。",
    actionLabel: "查看全部技能",
    actionTab: "skills",
    toneWhenPresent: "warn",
  },
];

function visibleIssues(state: UsageGovernanceState, tab: GovernanceTab): GovernanceIssue[] {
  const source =
    tab === "低效能力" ? state.lowEfficiency : tab === "未使用能力" ? state.zombie : state.conflict;
  return source.filter((issue) => !state.acknowledgedIssues.has(issue.issueId));
}

/** 留在当前能力中心，只切换已有 ?tab=。 */
export function capabilityCenterTabHref(
  tab: GovernanceSection["actionTab"],
  location: Pick<Location, "pathname" | "search"> = globalThis.location,
): string {
  const params = new URLSearchParams(location.search);
  params.delete("view");
  if (tab === "skills") {
    params.delete("tab");
  } else {
    params.set("tab", tab);
  }
  const search = params.toString();
  const pathname = location.pathname || "/";
  return `${pathname}${search ? `?${search}` : ""}`;
}

function renderMetrics(state: UsageGovernanceState): TemplateResult {
  const items: EnterpriseKpiItem[] = SECTIONS.map((section) => {
    const count = visibleIssues(state, section.label).length;
    return {
      label: section.label,
      value: formatExecutions(count),
      detail: section.detail,
      href: `#${section.anchor}`,
      tone: count > 0 ? section.toneWhenPresent : "ok",
      drilldown: `查看${section.label}`,
    };
  });
  return renderEnterpriseKpiGrid(items);
}

function renderIssueRow(
  issue: GovernanceIssue,
  controller: UsageGovernanceController,
): TemplateResult {
  return html`
    <tr class="enterprise-governance-issue-row">
      <td class="enterprise-usage-data-table__name">${issue.description}</td>
      <td>
        ${
          issue.evidence.executions30d !== undefined
            ? formatExecutions(issue.evidence.executions30d)
            : "—"
        }
      </td>
      <td>
        ${
          issue.evidence.successRate !== undefined
            ? formatSuccessRate(issue.evidence.successRate)
            : "—"
        }
      </td>
      <td>
        <div class="enterprise-usage-row-actions">
          <button
            type="button"
            class="enterprise-usage-link-btn enterprise-usage-link-btn--primary"
            @click=${() => controller.executeSuggestion(issue)}
          >
            ${issue.suggestion}
          </button>
          <button
            type="button"
            class="enterprise-usage-link-btn enterprise-usage-link-btn--muted"
            @click=${() => controller.acknowledge(issue.issueId)}
          >
            暂不处理
          </button>
        </div>
      </td>
    </tr>
  `;
}

function renderIssueTable(
  issues: GovernanceIssue[],
  controller: UsageGovernanceController,
): TemplateResult {
  return html`
    <div
      class="${USAGE_TABLE_CONTAINER} enterprise-capability-governance__list"
      tabindex="0"
      aria-label="待处理问题"
    >
      <table class="enterprise-usage-data-table enterprise-governance-table">
        <thead>
          <tr>
            <th>问题描述</th>
            <th>调用量</th>
            <th>成功率</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${issues.map((issue) => renderIssueRow(issue, controller))}
        </tbody>
      </table>
    </div>
  `;
}

function renderSection(
  section: GovernanceSection,
  state: UsageGovernanceState,
  controller: UsageGovernanceController,
): TemplateResult {
  const issues = visibleIssues(state, section.label);
  const countLabel = formatExecutions(issues.length);
  const blocked = Boolean(state.error) && issues.length === 0;
  return html`
    <section
      id=${section.anchor}
      class="enterprise-capability-governance__section"
      aria-labelledby="${section.anchor}-title"
    >
      <div class="enterprise-capability-governance__section-head">
        <h3 id="${section.anchor}-title">${section.label}</h3>
        <span class="enterprise-capability-governance__count">${countLabel}</span>
      </div>
      ${
        blocked
          ? html`
            <p class="enterprise-capability-governance__blocked">
              这次没有读到${section.label}。上面的失败说明之后再判断有没有问题，不要把 0 当成已治理完成。
            </p>
          `
          : issues.length === 0
            ? html`
              <div class="enterprise-empty enterprise-empty--compact enterprise-capability-governance__empty">
                <p class="enterprise-empty__title">${section.emptyTitle}</p>
                <p class="enterprise-empty__description">${section.emptyBody}</p>
                <a class="btn enterprise-capability-governance__action" href=${capabilityCenterTabHref(section.actionTab)}>
                  ${section.actionLabel}
                </a>
              </div>
            `
            : renderIssueTable(issues, controller)
      }
    </section>
  `;
}

function renderSkeleton(): TemplateResult {
  return html`
    <div class="enterprise-usage-skeleton enterprise-capability-governance__skeleton" aria-hidden="true">
      <div class="enterprise-usage-skeleton__kpis">
        ${[1, 2, 3].map(
          () =>
            html`
              <div class="enterprise-usage-skeleton__block"></div>
            `,
        )}
      </div>
    </div>
  `;
}

/**
 * 渲染能力中心「应用治理」摘要。
 */
export function renderUsageGovernancePage(props: UsageGovernancePageProps): TemplateResult {
  const { state, controller } = props;
  const showSummary = !state.loading || hasAnyIssues(state);

  return html`
    <div class="${USAGE_PAGE_CONTAINER} enterprise-capability-governance" aria-label="应用治理">
      <p class="enterprise-capability-governance__intro">
        近 30 天仍待处理的低效、未使用和冲突能力。数字是检测结果，点指标可跳到对应分区。
      </p>
      ${
        state.loading && !showSummary
          ? renderSkeleton()
          : html`
            ${
              state.error
                ? html`
                  <div class="enterprise-usage-error" role="alert">
                    <span>${state.error}</span>
                    <button
                      type="button"
                      class="enterprise-usage-error__retry"
                      @click=${() => controller.load()}
                    >
                      重试
                    </button>
                  </div>
                `
                : nothing
            }
            ${renderMetrics(state)}
            <div class="enterprise-capability-governance__sections">
              ${SECTIONS.map((section) => renderSection(section, state, controller))}
            </div>
          `
      }
      <a
        class="enterprise-usage-platform-link enterprise-governance-platform-link"
        href="/platform/agents"
        target="_blank"
        rel="noopener"
      >
        前往平台资产管理中心查看技术详情
      </a>
    </div>
  `;
}

function hasAnyIssues(state: UsageGovernanceState): boolean {
  return state.lowEfficiency.length + state.zombie.length + state.conflict.length > 0;
}
