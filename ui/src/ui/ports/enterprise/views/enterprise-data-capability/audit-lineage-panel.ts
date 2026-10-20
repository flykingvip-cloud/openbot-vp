/**
 * 权限与治理 → 审计血缘面板。
 */

import { html, type TemplateResult } from "lit";
import type {
  AuditLineageOverview,
  AuditLineageReverseRole,
} from "../../../../capability/enterprise-data-capability/types.ts";

const REVERSE_ROLE_LABEL: Record<AuditLineageReverseRole, string> = {
  insight: "洞察",
  metric: "指标",
  projection: "投影",
  connector_action: "连接动作",
  source_data: "源数据",
};

export type AuditLineagePanelProps = {
  overview: AuditLineageOverview | null;
  loading: boolean;
  error: string | null;
  projectionFailureCount: number | null;
};

export function renderAuditLineagePanel(props: AuditLineagePanelProps): TemplateResult {
  if (props.error && !props.overview) {
    return html`
      <section class="enterprise-data-capability__panel enterprise-data-capability__panel--flat">
        <div class="enterprise-data-capability__hint" role="alert">${props.error}</div>
      </section>
    `;
  }
  if (props.loading && !props.overview) {
    return html`
      <section class="enterprise-data-capability__panel enterprise-data-capability__panel--flat">
        <div class="enterprise-data-capability__hint" aria-busy="true">加载中…</div>
      </section>
    `;
  }

  const overview = props.overview;
  const lineageCount = overview?.lineageCount ?? 0;
  const supplyAuditCount = overview?.supplyAuditCount ?? 0;
  const materializationFailureCount =
    overview?.materializationFailureCount ?? props.projectionFailureCount ?? 0;
  const reverseChain = overview?.recentReverseChain ?? [];

  return html`
    <section class="enterprise-data-capability__panel enterprise-data-capability__panel--flat">
      <div class="edc-metric-row" aria-label="审计血缘概览">
        <div class="edc-metric-row__item">
          <span class="edc-metric-row__label">血缘记录</span>
          <strong class="edc-metric-row__value">${lineageCount}</strong>
        </div>
        <div class="edc-metric-row__item">
          <span class="edc-metric-row__label">供给审计</span>
          <strong class="edc-metric-row__value">${supplyAuditCount}</strong>
        </div>
        <div class="edc-metric-row__item">
          <span class="edc-metric-row__label">物化失败</span>
          <strong
            class="edc-metric-row__value ${materializationFailureCount > 0 ? "edc-stat-danger" : ""}"
          >
            ${materializationFailureCount}
          </strong>
        </div>
      </div>
      ${
        reverseChain.length > 0
          ? html`
              <div class="edc-lineage-chain" data-testid="audit-lineage-reverse-chain">
                <div class="edc-lineage-chain__title">最近一条反向血缘</div>
                <dl class="edc-kv-stack">
                  ${reverseChain.map(
                    (node) => html`
                      <div class="edc-kv-stack__row" data-role=${node.role}>
                        <dt>${REVERSE_ROLE_LABEL[node.role]}</dt>
                        <dd class=${node.role === "connector_action" ? "edc-kv-stack__code" : ""}>
                          ${node.label}
                        </dd>
                      </div>
                    `,
                  )}
                </dl>
              </div>
            `
          : html``
      }
    </section>
  `;
}
