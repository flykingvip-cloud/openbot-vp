/**
 * 企业数据能力中心 — 数据源健康面板（DataSourceHealthPanel）。
 *
 * 5 态：正常 / 同步延迟 / Token 即将过期 / 异常 / 已断开（Phase 4.1）。
 * 「查看详情」复用既有源治理详情入口（系统设置 > 企业身份与数据源），见 tasks.md 1.5。
 *
 * @module enterprise-data-capability/data-source-health-panel
 */

import { html, nothing, type TemplateResult } from "lit";
import type {
  DataSourceHealthRow,
  DataSourceHealthStatus,
} from "../../capability/enterprise-data-capability/types.ts";

export type DataSourceHealthPanelProps = {
  rows: DataSourceHealthRow[] | null;
  loading: boolean;
  error: string | null;
  /** 深链。总览内应改用 onViewDetails 切到数据资产，避免跳到身份页。 */
  detailHref?: string;
  onViewDetails?: () => void;
};

const STATUS_META: Record<
  DataSourceHealthStatus,
  { label: string; tone: "ok" | "warn" | "danger" | "neutral" }
> = {
  normal: { label: "连接正常", tone: "ok" },
  sync_delayed: { label: "同步延迟", tone: "warn" },
  token_expiring: { label: "Token 即将过期", tone: "warn" },
  error: { label: "异常", tone: "danger" },
  disconnected: { label: "已断开", tone: "danger" },
};

export function renderDataSourceHealthPanel(props: DataSourceHealthPanelProps): TemplateResult {
  const rows = props.rows ?? [];
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
        <div class="enterprise-data-capability__empty-title">暂无数据源</div>
        <div class="enterprise-data-capability__hint">
          在「数据资产」中接入 CRM / ERP / OA 等系统后，这里将展示其连接健康状态。
        </div>
      </div>
    `;
  } else {
    body = html`
      <table class="edc-console-table">
        <thead>
          <tr>
            <th>数据源</th>
            <th class="edc-console-table__actions">状态</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => {
            const meta = STATUS_META[row.status];
            return html`
              <tr>
                <td>
                  <strong>${row.displayName}</strong>
                  ${row.category ? html`<div class="edc-cell-sub">${row.category}</div>` : nothing}
                </td>
                <td class="edc-console-table__actions">
                  <span class="enterprise-mesh-badge enterprise-mesh-badge--${meta.tone}">
                    <span class="edc-run-dot"></span>${meta.label}
                  </span>
                </td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    `;
  }

  return html`
    <section
      class="enterprise-card enterprise-data-capability__panel enterprise-data-capability__health"
      aria-label="数据源健康状态"
    >
      <div class="edc-panel-head">
        <div class="enterprise-data-capability__panel-title">
          数据源健康状态${rows.length > 0 ? html`<span class="enterprise-data-capability__count">${rows.length}</span>` : nothing}
        </div>
        ${
          props.onViewDetails
            ? html`<button class="btn btn--sm" type="button" @click=${props.onViewDetails}>查看详情</button>`
            : props.detailHref
              ? html`<a class="btn btn--sm" href=${props.detailHref}>查看详情</a>`
              : nothing
        }
      </div>
      ${body}
    </section>
  `;
}
