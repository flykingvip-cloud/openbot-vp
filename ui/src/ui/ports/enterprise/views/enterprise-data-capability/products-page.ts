/**
 * 数据产品页 — 产品目录、详情与新建向导的页面编排入口。
 */

import { html, type TemplateResult } from "lit";
import type { ManagedCapabilityRecord } from "../../../../capability/enterprise-data-capability/types.ts";
import type { ManagedCapabilityGovernanceView } from "../../../../capability/enterprise-data-capability/types.ts";
import { renderProductDetailPanel, type ProductDetailPanelProps } from "./product-detail-panel.ts";
import { renderCapabilityEditorModal, type CapabilityEditorState } from "./product-editor-modal.ts";

export type ProductsCatalogModel = {
  capabilities: ManagedCapabilityRecord[];
  capabilitiesLoading: boolean;
  capabilitiesError: string | null;
  capabilitiesNotice: string | null;
  capabilityDetailId: string | null;
  capabilityDetail: ManagedCapabilityGovernanceView | null;
};

export type ProductsCatalogHandlers = {
  onOpenCreate: () => void;
  onEdit: (capability: ManagedCapabilityRecord) => void;
  onArchive: (capability: ManagedCapabilityRecord) => void;
  onOpenDetail: (capability: ManagedCapabilityRecord) => void;
};

export {
  renderCapabilityEditorModal,
  renderProductDetailPanel,
  type CapabilityEditorState,
  type ProductDetailPanelProps,
};

/** 产品目录列表（不含详情面板）。 */
export function renderProductsCatalog(
  model: ProductsCatalogModel,
  handlers: ProductsCatalogHandlers,
): TemplateResult {
  return html`
    <section class="enterprise-data-capability__panel enterprise-data-capability__panel--flat">
      <div class="edc-matrix-toolbar">
        <button class="btn btn--sm" type="button" @click=${handlers.onOpenCreate}>
          新建数据产品
        </button>
      </div>
      ${
        model.capabilitiesError && !model.capabilitiesLoading
          ? html`<div class="enterprise-data-capability__hint" role="alert">${model.capabilitiesError}</div>`
          : model.capabilitiesLoading
            ? html`
                <div class="enterprise-data-capability__hint" aria-busy="true">加载中…</div>
              `
            : model.capabilities.length === 0
              ? html`
                  <div class="edc-empty">
                    <strong>暂无数据产品</strong>
                    <p class="muted">基于数据源编排产品后，将在此展示供给与使用情况。</p>
                    <button class="btn btn--sm" type="button" @click=${handlers.onOpenCreate}>
                      新建数据产品
                    </button>
                  </div>
                `
              : html`
                <ul class="enterprise-settings-row-list edc-policy-list">
                  ${model.capabilities.map(
                    (capability) => html`
                      <li class="enterprise-settings-row edc-policy-row">
                        <div class="enterprise-settings-row__main">
                          <div class="enterprise-settings-row__title">${capability.displayName}</div>
                          <div class="enterprise-settings-row__meta">
                            <span>${capability.capabilityKey}</span>
                            <span>·</span>
                            <span
                              >${capability.sourceIds.length} 个数据源 ·
                              ${capability.actionRefs.length} 个动作</span
                            >
                            ${
                              model.capabilityDetailId === capability.capabilityId &&
                              model.capabilityDetail
                                ? html`
                                    <span>·</span>
                                    <span
                                      >映射
                                      ${
                                        model.capabilityDetail.sourceMappings
                                          .map((mapping) => mapping.source.displayName)
                                          .join(" / ") || "—"
                                      }</span
                                    >
                                  `
                                : html``
                            }
                          </div>
                        </div>
                        <div class="enterprise-settings-row__actions edc-row-actions">
                          <span
                            class="enterprise-mesh-badge enterprise-mesh-badge--${
                              capability.enabled ? "ok" : "neutral"
                            }"
                          >
                            ${capability.enabled ? "启用" : "停用"}
                          </span>
                          <button
                            class="btn btn--sm btn--ghost"
                            type="button"
                            @click=${() => handlers.onOpenDetail(capability)}
                          >
                            ${
                              model.capabilityDetailId === capability.capabilityId ? "收起" : "详情"
                            }
                          </button>
                          <button
                            class="btn btn--sm btn--ghost"
                            type="button"
                            @click=${() => handlers.onEdit(capability)}
                          >
                            编辑
                          </button>
                          <button
                            class="btn btn--sm btn--ghost"
                            type="button"
                            @click=${() => handlers.onArchive(capability)}
                          >
                            ${capability.enabled ? "停用" : "归档"}
                          </button>
                        </div>
                      </li>
                    `,
                  )}
                </ul>
              `
      }
      ${
        model.capabilitiesNotice
          ? html`<div class="enterprise-org-modal__notice enterprise-org-modal__notice--ok">${model.capabilitiesNotice}</div>`
          : html``
      }
    </section>
  `;
}

/** 目录 + 六段详情的产品页主体。 */
export function renderProductsPageContent(params: {
  catalog: TemplateResult;
  detail: TemplateResult | null;
}): TemplateResult {
  return html`
    <div class="edc-products-content">
      ${params.catalog}
      ${params.detail ?? html``}
    </div>
  `;
}

/** 页面外壳。 */
export function renderProductsPage(sections: TemplateResult[]): TemplateResult {
  return html`<div class="edc-page edc-page--products">${sections}</div>`;
}
