/**
 * Agent Growth OS — Evolution 成长报告摘要（spec: agent-growth-lifecycle, P2 任务 14.2 / R17）。
 *
 * 纯渲染组件（UI ← 状态 ← 数据）。design §9/§17：**businessImpact 优先**展示
 * （如「减少人工审核 37 次」），其次才是活动量（toolInvocations 等）。
 *
 * 自包含、无跨包导入；接线进会话 prelude 的 evolution 分支或独立 panel 由 cursor 完成。
 * 数据来自 `get-growth-status` 的 `growthStatus.growthReport`（GrowthReportSnapshot）。
 */

import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";

export type ImpactMetricView = {
  key: string;
  value: number;
  unit?: string;
  description: string;
};

export type GrowthReportView = {
  periodDays: number;
  tasksCompleted: number;
  hoursSavedEstimate?: number | null;
  learningMaterialsCount: number;
  toolInvocations: number;
  taskSuccessRate?: number | null;
  toolSuccessRate?: number | null;
  humanTakeoverRate?: number | null;
  businessImpact: ImpactMetricView[];
  topInsights?: string[];
  suggestedWorkflows?: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optNum(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** 归一化 GrowthReportSnapshot → UI 视图；非法/缺省返回 null。 */
export function normalizeGrowthReport(value: unknown): GrowthReportView | null {
  const r = asRecord(value);
  if (!r) {
    return null;
  }
  const impact = Array.isArray(r.businessImpact) ? r.businessImpact : [];
  const businessImpact: ImpactMetricView[] = impact
    .map((entry) => {
      const e = asRecord(entry);
      if (!e || typeof e.key !== "string") {
        return null;
      }
      return {
        key: e.key,
        value: num(e.value),
        ...(typeof e.unit === "string" ? { unit: e.unit } : {}),
        description: typeof e.description === "string" ? e.description : e.key,
      } satisfies ImpactMetricView;
    })
    .filter((m): m is ImpactMetricView => m !== null);
  return {
    periodDays: num(r.periodDays),
    tasksCompleted: num(r.tasksCompleted),
    hoursSavedEstimate: optNum(r.hoursSavedEstimate),
    learningMaterialsCount: num(r.learningMaterialsCount),
    toolInvocations: num(r.toolInvocations),
    taskSuccessRate: optNum(r.taskSuccessRate),
    toolSuccessRate: optNum(r.toolSuccessRate),
    humanTakeoverRate: optNum(r.humanTakeoverRate),
    businessImpact,
    ...(strList(r.topInsights).length > 0 ? { topInsights: strList(r.topInsights) } : {}),
    ...(strList(r.suggestedWorkflows).length > 0
      ? { suggestedWorkflows: strList(r.suggestedWorkflows) }
      : {}),
  };
}

function renderImpact(metrics: ImpactMetricView[]): TemplateResult | typeof nothing {
  if (metrics.length === 0) {
    return nothing;
  }
  return html`<ul class="workbench-growth-report__impact">
    ${metrics.map(
      (m) => html`<li class="workbench-growth-report__impact-item" data-impact-key=${m.key}>
        <span class="workbench-growth-report__impact-value">${m.value}${m.unit ?? ""}</span>
        <span class="workbench-growth-report__impact-desc">${m.description}</span>
      </li>`,
    )}
  </ul>`;
}

function pct(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : null;
}

/** 渲染 Evolution 成长报告摘要；无报告时渲染 nothing。 */
export function renderGrowthReportSummary(
  report: GrowthReportView | null,
): TemplateResult | typeof nothing {
  if (!report) {
    return nothing;
  }
  const taskRate = pct(report.taskSuccessRate);
  const toolRate = pct(report.toolSuccessRate);
  const businessImpact = Array.isArray(report.businessImpact) ? report.businessImpact : [];
  return html`<section class="workbench-growth-report" data-growth-report="summary">
    <header class="workbench-growth-report__head">
      <h3 class="workbench-growth-report__title">
        ${t("frontstage.workbench.growth.dossier.report.title", { days: report.periodDays })}
      </h3>
    </header>
    ${
      businessImpact.length > 0
        ? html`<div class="workbench-growth-report__impact-block">
          <p class="workbench-growth-report__section-title">
            ${t("frontstage.workbench.growth.dossier.report.businessImpact")}
          </p>
          ${renderImpact(businessImpact)}
        </div>`
        : nothing
    }
    <ul class="workbench-growth-report__stats">
      <li>
        ${t("frontstage.workbench.growth.dossier.report.tasksCompleted")}
        <strong>${report.tasksCompleted}</strong>
      </li>
      ${
        typeof report.hoursSavedEstimate === "number"
          ? html`<li>
              ${t("frontstage.workbench.growth.dossier.report.hoursSaved")}
              <strong>${report.hoursSavedEstimate}</strong>
              ${t("frontstage.workbench.growth.dossier.report.hoursUnit")}
            </li>`
          : nothing
      }
      <li>
        ${t("frontstage.workbench.growth.dossier.report.learningMaterials")}
        <strong>${report.learningMaterialsCount}</strong>
      </li>
      <li>
        ${t("frontstage.workbench.growth.dossier.report.toolInvocations")}
        <strong>${report.toolInvocations}</strong>
      </li>
      ${
        taskRate
          ? html`<li>
              ${t("frontstage.workbench.growth.dossier.report.taskSuccessRate")}
              <strong>${taskRate}</strong>
            </li>`
          : nothing
      }
      ${
        toolRate
          ? html`<li>
              ${t("frontstage.workbench.growth.dossier.report.toolSuccessRate")}
              <strong>${toolRate}</strong>
            </li>`
          : nothing
      }
    </ul>
    ${
      report.topInsights && report.topInsights.length > 0
        ? html`<div class="workbench-growth-report__insights">
          <p class="workbench-growth-report__section-title">
            ${t("frontstage.workbench.growth.dossier.report.topInsights")}
          </p>
          <ul>
            ${report.topInsights.map((s) => html`<li>${s}</li>`)}
          </ul>
        </div>`
        : nothing
    }
  </section>`;
}
