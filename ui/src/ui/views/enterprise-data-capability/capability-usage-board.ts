/**
 * 企业数据能力中心 — 数据能力目录（CapabilityUsageBoard，Top Usage）。
 *
 * 行：能力名 / 来源 / 使用目标 / 知识对象数 / 状态。不含「最近运行」（待 Phase 4）。
 * 「查看全部能力」**不跳企业能力中心**（决策 2），指向本模块数据能力目录二级页（Phase 4）。
 *
 * @module enterprise-data-capability/capability-usage-board
 */

import { html, nothing, type TemplateResult } from "lit";
import type { CapabilityUsageRow } from "../../capability/enterprise-data-capability/types.ts";

export type CapabilityUsageBoardProps = {
  rows: CapabilityUsageRow[] | null;
  loading: boolean;
  error: string | null;
  /** 仅展示前 N 行（首页紧凑视图）；不传则展示全部（数据能力目录）。 */
  maxRows?: number;
  /** 「查看全部能力」回调（切到数据能力目录子页）；不传则不渲染入口。 */
  onViewAll?: () => void;
  /** 标题覆盖（数据能力目录用「全部数据能力」）。 */
  title?: string;
};

function formatLastRun(iso: string | null): string {
  if (!iso) {
    return "最近运行 —";
  }
  // 仅取日期+分钟，避免时区/秒级噪音。
  const trimmed = iso.replace("T", " ").slice(0, 16);
  return `最近运行 ${trimmed}`;
}

function renderRow(row: CapabilityUsageRow): TemplateResult {
  const sources = row.sourceNames.length > 0 ? row.sourceNames.join(" + ") : "—";
  const targetCount = row.targetLabels.length;
  // 降噪：使用目标完整列表移到能力名 hover；表内只留核心列。
  const targetsFull =
    targetCount > 0 ? `使用目标（${targetCount}）：${row.targetLabels.join("、")}` : "无使用目标";
  const statusMeta = row.enabled
    ? { label: "正常", tone: "ok" as const }
    : { label: "已停用", tone: "neutral" as const };
  return html`
    <tr>
      <td>
        <strong title=${targetsFull}>${row.displayName}</strong>
        <div class="edc-cell-sub">
          知识供给 ${row.knowledgeObjectCount} · ${formatLastRun(row.lastRunAt)}
        </div>
      </td>
      <td>${sources}</td>
      <td class="edc-console-table__actions">
        <span class="enterprise-mesh-badge enterprise-mesh-badge--${statusMeta.tone}">
          <span class="edc-run-dot"></span>${statusMeta.label}
        </span>
      </td>
    </tr>
  `;
}

export function renderCapabilityUsageBoard(props: CapabilityUsageBoardProps): TemplateResult {
  const allRows = props.rows ?? [];
  const rows = typeof props.maxRows === "number" ? allRows.slice(0, props.maxRows) : allRows;
  let body: TemplateResult;
  if (props.error && !props.rows) {
    body = html`<div class="enterprise-data-capability__hint" role="alert">${props.error}</div>`;
  } else if (props.loading && !props.rows) {
    body = html`
      <div class="enterprise-data-capability__hint" aria-busy="true">加载中…</div>
    `;
  } else if (rows.length === 0) {
    body = html`
      <div class="enterprise-data-capability__empty">
        <div class="enterprise-data-capability__empty-title">暂无数据产品</div>
        <div class="enterprise-data-capability__hint">
          在「数据产品」中基于数据源编排产品后，将在此展示供给与使用情况。
        </div>
      </div>
    `;
  } else {
    body = html`
      <table class="edc-console-table">
        <thead>
          <tr>
            <th>产品名称</th>
            <th>来源</th>
            <th class="edc-console-table__actions">状态</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => renderRow(row))}
        </tbody>
      </table>
    `;
  }

  return html`
    <section
      class="enterprise-card enterprise-data-capability__panel enterprise-data-capability__usage-board"
      aria-label="数据产品运行榜"
    >
      <div class="edc-panel-head">
        <div class="enterprise-data-capability__panel-title">
          ${props.title ?? "数据产品运行榜"}${allRows.length > 0 ? html`<span class="enterprise-data-capability__count">${allRows.length}</span>` : nothing}
        </div>
        ${
          props.onViewAll
            ? html`
                <button type="button" class="btn btn--sm" @click=${() => props.onViewAll?.()}>
                  查看全部产品${allRows.length > rows.length ? `（共 ${allRows.length}）` : ""}
                </button>
              `
            : nothing
        }
      </div>
      ${body}
    </section>
  `;
}
