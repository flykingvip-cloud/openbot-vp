/**
 * 数据资产页 — 接入方式、能力验证、数据范围和分开的时间事实。
 */

import { html, type TemplateResult } from "lit";
import type { ManagedDataSourceRecord } from "../../../../capability/enterprise-data-capability/types.ts";
import type { DataConnectorCatalogEntry } from "../../../../capability/enterprise-data-capability/types.ts";
import {
  createDefaultAssetFilters,
  filterAssetSources,
  uniqueAssetCategories,
  type AssetListFilters,
  type AssetStatusFilter,
} from "./asset-filters.ts";
import {
  accessMethodLabel,
  assetLinkedCapabilityLabel,
  connectionHealthLabel,
  freshnessLabel,
  observationTimeLabel,
  verificationLabel,
  type DataAssetLinkageView,
  type DataAssetStatsView,
} from "./asset-linkage.ts";

export type AssetsPageHandlers = {
  onOpenCreate: () => void;
  onEdit: (source: ManagedDataSourceRecord) => void;
  onReconnect: (source: ManagedDataSourceRecord) => void;
  onTestConnection: (source: ManagedDataSourceRecord) => void;
  onArchive: (source: ManagedDataSourceRecord) => void;
  onOpenLogs: (source: ManagedDataSourceRecord) => void;
  onSync: (source: ManagedDataSourceRecord) => void;
  onFiltersChange: (patch: Partial<AssetListFilters>) => void;
  onSelectSource: (sourceId: string) => void;
};

export type AssetsPageModel = {
  sources: ManagedDataSourceRecord[];
  assetFilters: AssetListFilters;
  connectorCatalog: DataConnectorCatalogEntry[];
  sourcesLoading: boolean;
  sourcesError: string | null;
  sourcesNotice: string | null;
  linkageBySourceId: ReadonlyMap<string, DataAssetLinkageView>;
  stats: DataAssetStatsView | null;
  selectedSourceId: string | null;
  capabilityHref: (skillId: string) => string;
};

export { createDefaultAssetFilters };

export type AssetsStatusTone = "ok" | "warn" | "danger" | "neutral";

export type AssetsPageFormatters = {
  formatCategory: (category: string) => string;
  formatStatus: (status: string) => string;
  formatTimestamp: (iso: string) => string;
  statusTone: (status: ManagedDataSourceRecord["status"]) => AssetsStatusTone;
  renderStatusBadge: (label: string, tone: AssetsStatusTone, withDot?: boolean) => TemplateResult;
};

function toneForVerification(
  status: DataAssetLinkageView["verification"]["status"],
): AssetsStatusTone {
  if (status === "passed") {
    return "ok";
  }
  if (status === "failed") {
    return "danger";
  }
  if (status === "unknown" || status === "unverified") {
    return "neutral";
  }
  return "warn";
}

function toneForFreshness(status: DataAssetLinkageView["freshness"]["status"]): AssetsStatusTone {
  if (status === "fresh") {
    return "ok";
  }
  if (status === "stale") {
    return "warn";
  }
  return "neutral";
}

function renderDetail(
  source: ManagedDataSourceRecord,
  linkage: DataAssetLinkageView | undefined,
  formatters: AssetsPageFormatters,
  capabilityHref: (skillId: string) => string,
): TemplateResult {
  const checked = observationTimeLabel(
    linkage?.connection.lastCheckedAt,
    formatters.formatTimestamp,
  );
  const succeeded = observationTimeLabel(
    linkage?.freshness.lastSucceededAt,
    formatters.formatTimestamp,
  );
  const materialized = observationTimeLabel(
    linkage?.freshness.lastMaterializedAt,
    formatters.formatTimestamp,
  );
  const capabilities = linkage?.verification.capabilities ?? [];
  const scope = linkage?.scope.known ? linkage.scope.supportedScopeTypes.join("、") : "范围未知";
  const skillId = linkage?.links.capabilityCenter?.skillId;
  return html`
    <tr>
      <td colspan="8">
        <div class="edc-asset-detail">
          <div>接入方式：${accessMethodLabel(linkage?.accessMethod ?? "credential")}</div>
          <div>数据范围：${scope}</div>
          <div>最近检查：${checked}</div>
          <div>最近成功读取：${succeeded}</div>
          <div>最近入库：${materialized}</div>
          <div>生产验证次数：${linkage?.verification.productionVerificationCount ?? 0}</div>
          <div>入库次数：${linkage?.freshness.materializationCount ?? 0}</div>
          <div>记录修改：${formatters.formatTimestamp(source.updatedAt)}（不是同步证据）</div>
          ${
            linkage?.freshness.status === "live_query"
              ? html`
                  <div>实时查询，未入库。这次读取没有写成知识对象。</div>
                `
              : html``
          }
          ${
            capabilities.length === 0 && (linkage?.products.length ?? 0) === 0
              ? html`
                  <div>关联能力：无。验证未知，不计入健康。</div>
                `
              : linkage && linkage.products.length > 0
                ? html`
                    <div>关联数据产品：${linkage.products.map((product) => product.displayName).join("、")}</div>
                  `
                : html``
          }
          ${
            capabilities.length === 0
              ? html``
              : html`
                  <ul>
                    ${capabilities.map(
                      (capability) => html`
                        <li>
                          ${capability.capabilityId}@${capability.version}
                          · ${verificationLabel(capability.verification)}
                          ${capability.demoCapability ? "· 演示" : ""}
                          ${
                            capability.dataCapabilityId
                              ? html` · 数据产品 ${capability.dataCapabilityId}`
                              : html``
                          }
                        </li>
                      `,
                    )}
                  </ul>
                `
          }
          ${
            skillId
              ? html`<a href=${capabilityHref(skillId)}>在能力中心查看 ${skillId}</a>`
              : html`
                  <div>能力中心链接留到技能资产绑定之后。当前只展示 SAR 能力标识。</div>
                `
          }
          ${
            linkage?.account.bindingId
              ? html`<div>
                  授权 ${linkage.account.bindingId}
                  ${linkage.account.selectable ? "· 可选择" : "· 需账户所有者授权"}
                </div>`
              : html``
          }
        </div>
      </td>
    </tr>
  `;
}

/** 数据资产页完整渲染（筛选 + 分开的统计 + 表格）。 */
export function renderAssetsPageContent(
  model: AssetsPageModel,
  handlers: AssetsPageHandlers,
  formatters: AssetsPageFormatters,
): TemplateResult {
  const connectorLabelById = new Map(
    model.connectorCatalog.map((entry) => [entry.connectorId, entry.label] as const),
  );
  const filtered = filterAssetSources(model.sources, model.assetFilters, connectorLabelById);
  const categories = uniqueAssetCategories(model.sources);
  const stats = model.stats;

  const renderRow = (source: ManagedDataSourceRecord): TemplateResult => {
    const linkage = model.linkageBySourceId.get(source.sourceId);
    const connectorLabel = connectorLabelById.get(source.connectorId);
    const categoryLabel = formatters.formatCategory(source.category);
    const meta = connectorLabel ? `${categoryLabel} · ${connectorLabel}` : categoryLabel;
    const capabilityText = assetLinkedCapabilityLabel(linkage);
    const scopeText = linkage?.scope.known ? linkage.scope.supportedScopeTypes.join("、") : "未知";
    const selected = model.selectedSourceId === source.sourceId;
    return html`
      <tr>
        <td>
          <button
            class="btn btn--sm btn--ghost"
            type="button"
            @click=${() => handlers.onSelectSource(source.sourceId)}
          >
            <span class="edc-asset-name" title=${source.sourceKey}>${source.displayName}</span>
          </button>
          <div class="edc-cell-sub">
            ${meta}
            ${linkage?.demo ? " · 演示" : ""}
          </div>
        </td>
        <td>${accessMethodLabel(linkage?.accessMethod ?? "credential")}</td>
        <td>${capabilityText}</td>
        <td>
          ${formatters.renderStatusBadge(
            verificationLabel(linkage?.verification.status ?? "unknown"),
            toneForVerification(linkage?.verification.status ?? "unknown"),
            true,
          )}
        </td>
        <td>${scopeText}</td>
        <td>
          ${formatters.renderStatusBadge(
            freshnessLabel(linkage?.freshness.status ?? "unknown"),
            toneForFreshness(linkage?.freshness.status ?? "unknown"),
          )}
          <div class="edc-cell-sub">
            检查 ${observationTimeLabel(linkage?.connection.lastCheckedAt, formatters.formatTimestamp)}
            · 成功 ${observationTimeLabel(linkage?.freshness.lastSucceededAt, formatters.formatTimestamp)}
            · 入库 ${observationTimeLabel(linkage?.freshness.lastMaterializedAt, formatters.formatTimestamp)}
          </div>
        </td>
        <td>
          ${formatters.renderStatusBadge(
            connectionHealthLabel(linkage?.connection.health ?? "unknown"),
            linkage?.connection.health === "healthy"
              ? "ok"
              : linkage?.connection.health === "unhealthy"
                ? "danger"
                : "neutral",
            true,
          )}
        </td>
        <td class="edc-console-table__actions">
          <div class="edc-row-actions">
            <button
              class="btn btn--sm btn--ghost"
              type="button"
              @click=${() => handlers.onEdit(source)}
            >
              编辑
            </button>
            <details class="edc-row-menu">
              <summary class="edc-row-menu__trigger" title="更多操作" aria-label="更多操作">
                ···
              </summary>
              <div class="edc-row-menu__list" role="menu">
                <button
                  class="edc-row-menu__item"
                  type="button"
                  role="menuitem"
                  @click=${(event: Event) => {
                    (event.currentTarget as HTMLElement)
                      .closest("details")
                      ?.removeAttribute("open");
                    handlers.onTestConnection(source);
                  }}
                >
                  测试连接
                </button>
                <button
                  class="edc-row-menu__item"
                  type="button"
                  role="menuitem"
                  @click=${(event: Event) => {
                    (event.currentTarget as HTMLElement)
                      .closest("details")
                      ?.removeAttribute("open");
                    handlers.onReconnect(source);
                  }}
                >
                  重连
                </button>
                ${
                  source.connectorId === "erp-yonyou-tplus"
                    ? html`
                        <button
                          class="edc-row-menu__item"
                          type="button"
                          role="menuitem"
                          @click=${(event: Event) => {
                            (event.currentTarget as HTMLElement)
                              .closest("details")
                              ?.removeAttribute("open");
                            handlers.onSync(source);
                          }}
                        >
                          同步
                        </button>
                      `
                    : html``
                }
                <button
                  class="edc-row-menu__item"
                  type="button"
                  role="menuitem"
                  @click=${(event: Event) => {
                    (event.currentTarget as HTMLElement)
                      .closest("details")
                      ?.removeAttribute("open");
                    handlers.onOpenLogs(source);
                  }}
                >
                  查看同步日志
                </button>
                <button
                  class="edc-row-menu__item edc-row-menu__item--danger"
                  type="button"
                  role="menuitem"
                  @click=${(event: Event) => {
                    (event.currentTarget as HTMLElement)
                      .closest("details")
                      ?.removeAttribute("open");
                    handlers.onArchive(source);
                  }}
                >
                  停用
                </button>
              </div>
            </details>
          </div>
        </td>
      </tr>
      ${selected ? renderDetail(source, linkage, formatters, model.capabilityHref) : html``}
    `;
  };

  return html`
    <section class="enterprise-data-capability__panel enterprise-data-capability__panel--flat">
      ${
        model.sourcesError && !model.sourcesLoading
          ? html`<div class="enterprise-data-capability__hint" role="alert">${model.sourcesError}</div>`
          : model.sourcesLoading
            ? html`
                <div class="enterprise-data-capability__hint" aria-busy="true">加载中…</div>
              `
            : html`
                <div class="edc-metric-row" aria-label="资产概览">
                  <div class="edc-metric-row__item">
                    <span class="edc-metric-row__label">连接健康</span>
                    <strong class="edc-metric-row__value">${stats?.connection.healthy ?? 0}</strong>
                    <span class="edc-cell-sub">未知 ${stats?.connection.unknown ?? 0}</span>
                  </div>
                  <div class="edc-metric-row__item">
                    <span class="edc-metric-row__label">能力验证</span>
                    <strong class="edc-metric-row__value">${stats?.verification.passed ?? 0}</strong>
                    <span class="edc-cell-sub">
                      失败 ${stats?.verification.failed ?? 0} · 未知 ${stats?.verification.unknown ?? 0}
                    </span>
                  </div>
                  <div class="edc-metric-row__item">
                    <span class="edc-metric-row__label">数据新鲜度</span>
                    <strong class="edc-metric-row__value">${stats?.freshness.fresh ?? 0}</strong>
                    <span class="edc-cell-sub">
                      实时 ${stats?.freshness.liveQuery ?? 0} · 未知 ${stats?.freshness.unknown ?? 0}
                    </span>
                  </div>
                  <div class="edc-metric-row__item">
                    <span class="edc-metric-row__label">演示</span>
                    <strong class="edc-metric-row__value">${stats?.demo ?? 0}</strong>
                  </div>
                </div>
                <div class="edc-list-toolbar">
                  <div class="edc-filter-bar edc-filter-bar--inline">
                    <input
                      class="edc-filter-input"
                      aria-label="搜索资产"
                      .value=${model.assetFilters.query}
                      placeholder="搜索名称 / 标识 / 连接器"
                      @input=${(event: Event) =>
                        handlers.onFiltersChange({
                          query: (event.target as HTMLInputElement).value,
                        })}
                    />
                    <select
                      class="edc-filter-select"
                      aria-label="连接状态"
                      .value=${model.assetFilters.status}
                      @change=${(event: Event) =>
                        handlers.onFiltersChange({
                          status: (event.target as HTMLSelectElement).value as AssetStatusFilter,
                        })}
                    >
                      <option value="all">全部状态</option>
                      <option value="connected">已连接</option>
                      <option value="error">异常</option>
                      <option value="disconnected">已断开</option>
                      <option value="other">其他</option>
                    </select>
                    <select
                      class="edc-filter-select"
                      aria-label="分类"
                      .value=${model.assetFilters.category}
                      @change=${(event: Event) =>
                        handlers.onFiltersChange({
                          category: (event.target as HTMLSelectElement).value,
                        })}
                    >
                      <option value="">全部分类</option>
                      ${categories.map(
                        (category) => html`
                          <option value=${category}>${formatters.formatCategory(category)}</option>
                        `,
                      )}
                    </select>
                  </div>
                  <button class="btn btn--sm" type="button" @click=${handlers.onOpenCreate}>
                    新增数据资产
                  </button>
                </div>
                ${
                  model.sources.length === 0
                    ? html`
                        <div class="edc-empty">
                          <strong>暂无数据资产</strong>
                          <p class="muted">接入连接器并完成连通性测试后，将在此展示。测试连接不会记成已入库。</p>
                          <button class="btn btn--sm" type="button" @click=${handlers.onOpenCreate}>
                            新增数据资产
                          </button>
                        </div>
                      `
                    : filtered.length === 0
                      ? html`
                          <div class="enterprise-data-capability__hint">无匹配资产，请调整筛选条件。</div>
                        `
                      : html`
                          <table class="edc-console-table edc-console-table--lean edc-console-table--menus">
                            <thead>
                              <tr>
                                <th>资产</th>
                                <th>接入方式</th>
                                <th>关联能力</th>
                                <th>验证</th>
                                <th>数据范围</th>
                                <th>检查 / 成功 / 入库</th>
                                <th>连接</th>
                                <th class="edc-console-table__actions">操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              ${filtered.map((source) => renderRow(source))}
                            </tbody>
                          </table>
                        `
                }
              `
      }
      ${
        model.sourcesNotice
          ? html`<div class="enterprise-org-modal__notice enterprise-org-modal__notice--ok">
              ${model.sourcesNotice}
            </div>`
          : html``
      }
    </section>
  `;
}

/** 页面外壳：单内容区。 */
export function renderAssetsPage(sections: TemplateResult[]): TemplateResult {
  return html`<div class="edc-page edc-page--assets">${sections}</div>`;
}
