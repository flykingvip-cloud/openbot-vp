/**
 * 输出与物化页 — 投影规格/绑定/运行概览（从 surface 迁出）。
 */

import { html, type TemplateResult } from "lit";
import type {
  ManagedKnowledgeFeedItemRecord,
  ManagedProjectionBindingRecord,
  ManagedProjectionSpecRecord,
} from "../../../../capability/enterprise-data-capability/types.ts";

export type ProjectionStudioModel = {
  projectionSpecs: ManagedProjectionSpecRecord[];
  projectionBindings: ManagedProjectionBindingRecord[];
  feedItems: ManagedKnowledgeFeedItemRecord[];
  feedItemsLoading: boolean;
  feedDeleteBusyObjectId: string | null;
  projectionsLoading: boolean;
  projectionsError: string | null;
  projectionsNotice: string | null;
  projectionAuditFailureCount: number | null;
  materializeBusyBindingId: string | null;
};

const PROJECTION_LIFECYCLE_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Active",
  deprecated: "Deprecated",
  frozen: "Frozen",
};

const MATERIALIZATION_MODE_LABEL: Record<string, string> = {
  on_demand: "手动物化",
  scheduled: "定时同步",
  cron: "定时同步",
  event_driven: "事件驱动（无执行器）",
};

function isScheduledMaterializationMode(mode: string): boolean {
  return mode === "scheduled" || mode === "cron";
}

function projectionLifecycleTone(lifecycle: string): "ok" | "warn" | "neutral" {
  if (lifecycle === "active") {
    return "ok";
  }
  if (lifecycle === "deprecated" || lifecycle === "frozen") {
    return "warn";
  }
  return "neutral";
}

/** Colored capsule status tag, reusing the shared mesh-badge tones (neutral = gray). */
export function renderDataStatusBadge(
  label: string,
  tone: "ok" | "warn" | "danger" | "info" | "neutral",
  withDot = false,
): TemplateResult {
  const cls =
    tone === "neutral"
      ? "enterprise-mesh-badge"
      : `enterprise-mesh-badge enterprise-mesh-badge--${tone}`;
  return html`<span class=${cls}
    >${
      withDot
        ? html`
            <span class="edc-run-dot"></span>
          `
        : html``
    }${label}</span
  >`;
}

/** Humanize an ISO timestamp: 今天 HH:MM for today, else YYYY-MM-DD HH:MM (local). */
export function formatApprovalTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  const hhmm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return `今天 ${hhmm}`;
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hhmm}`;
}

/** Decision status capsule for the approval history tab. */
export function renderApprovalStatusBadge(status: string): TemplateResult {
  switch (status) {
    case "approved":
      return renderDataStatusBadge("已批准", "ok", true);
    case "rejected":
      return renderDataStatusBadge("已拒绝", "neutral", true);
    case "cancelled":
      return renderDataStatusBadge("已取消", "neutral", true);
    case "pending":
      return renderDataStatusBadge("待审批", "info", true);
    default:
      return renderDataStatusBadge(status, "neutral", true);
  }
}

export function renderProjectionStudioSection(params: {
  state: ProjectionStudioModel;
  onMaterialize: (bindingId: string) => void;
  onOpenCreate: () => void;
  onDeleteFeedItem: (item: ManagedKnowledgeFeedItemRecord) => void;
}): TemplateResult {
  const { state, onMaterialize, onOpenCreate, onDeleteFeedItem } = params;
  const specById = new Map(state.projectionSpecs.map((spec) => [spec.projectionId, spec] as const));
  if (state.projectionsLoading) {
    return html`
      <section class="enterprise-data-capability__panel enterprise-data-capability__panel--flat">
        <div class="enterprise-data-capability__hint" aria-busy="true">加载中…</div>
      </section>
    `;
  }
  if (state.projectionsError) {
    return html`
      <section class="enterprise-data-capability__panel enterprise-data-capability__panel--flat">
        <div class="enterprise-data-capability__hint" role="alert">${state.projectionsError}</div>
      </section>
    `;
  }
  const totalSpecs = state.projectionSpecs.length;
  const activeSpecs = state.projectionSpecs.filter((spec) => spec.lifecycle === "active").length;
  const totalBindings = state.projectionBindings.length;
  const enabledBindings = state.projectionBindings.filter((binding) => binding.enabled).length;
  const failureCount = state.projectionAuditFailureCount;
  const enabledProjectionIds = new Set(
    state.projectionBindings
      .filter((binding) => binding.enabled)
      .map((binding) => binding.projectionId),
  );
  return html`
    <section class="enterprise-data-capability__panel enterprise-data-capability__panel--flat">
      ${
        state.projectionsNotice
          ? html`
              <div class="enterprise-org-modal__notice enterprise-org-modal__notice--ok">
                ${state.projectionsNotice}
              </div>
            `
          : html``
      }
      <div class="edc-metric-row" aria-label="运行概览">
        <div class="edc-metric-row__item">
          <span class="edc-metric-row__label">活动规格</span>
          <strong class="edc-metric-row__value">${activeSpecs} / ${totalSpecs}</strong>
        </div>
        <div class="edc-metric-row__item">
          <span class="edc-metric-row__label">已启用通道</span>
          <strong class="edc-metric-row__value">${enabledBindings} / ${totalBindings}</strong>
        </div>
        <div class="edc-metric-row__item">
          <span class="edc-metric-row__label">近期失败</span>
          <strong
            class="edc-metric-row__value ${
              failureCount != null && failureCount > 0 ? "edc-stat-danger" : ""
            }"
            >${failureCount ?? "—"}</strong
          >
        </div>
      </div>
      <div class="enterprise-data-capability__subsection">
        <div class="edc-list-toolbar">
          <div class="edc-section-label" style="margin:0">输出规格（${totalSpecs}）</div>
          <button class="btn btn--sm" type="button" @click=${onOpenCreate}>新建输出规格</button>
        </div>
        ${
          totalSpecs === 0
            ? html`
                <div class="enterprise-data-capability__hint">暂无输出规格。请先配置数据产品与供给绑定。</div>
              `
            : html`
                <table class="edc-console-table edc-console-table--lean">
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>生命周期</th>
                      <th>对象类型</th>
                      <th>源 Action</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${state.projectionSpecs.map(
                      (spec) => html`
                        <tr>
                          <td>${spec.displayName}</td>
                          <td>
                            ${renderDataStatusBadge(
                              PROJECTION_LIFECYCLE_LABEL[spec.lifecycle] ?? spec.lifecycle,
                              projectionLifecycleTone(spec.lifecycle),
                            )}
                          </td>
                          <td>${spec.objectKind}</td>
                          <td>${spec.sourceActionCount}</td>
                          <td>
                            ${
                              enabledProjectionIds.has(spec.projectionId)
                                ? renderDataStatusBadge("已启用", "ok")
                                : renderDataStatusBadge("未启用", "neutral")
                            }
                          </td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              `
        }
      </div>
      <div class="enterprise-data-capability__subsection">
        <div class="edc-section-label">供给绑定与调度（${totalBindings}）</div>
        <div class="enterprise-data-capability__hint">
          打开知识宇宙不会自动物化。连接器包声明的默认数据产品会在测试连接或同步成功后写成供给，触发模式为定时同步。自行新建且仍为手动物化的绑定，在还没有供给记录时显示待物化；已供给表示
          Feed 已写入，知识宇宙的新鲜度读这份记录，不是连接器实时查询。
        </div>
        ${
          totalBindings === 0
            ? html`
                <div class="enterprise-data-capability__hint">暂无绑定。</div>
              `
            : html`
                <table class="edc-console-table edc-console-table--lean">
                  <thead>
                    <tr>
                      <th>投影名称</th>
                      <th>触发模式</th>
                      <th>所属团队</th>
                      <th>运行状态</th>
                      <th class="edc-console-table__actions">调度</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${state.projectionBindings.map((binding) => {
                      const spec = specById.get(binding.projectionId);
                      const scheduled = isScheduledMaterializationMode(binding.materializationMode);
                      return html`
                        <tr>
                          <td>${spec?.displayName ?? binding.projectionId}</td>
                          <td>
                            ${renderDataStatusBadge(
                              MATERIALIZATION_MODE_LABEL[binding.materializationMode] ??
                                binding.materializationMode,
                              "neutral",
                            )}
                          </td>
                          <td>${binding.materializationTeamLabel || "—"}</td>
                          <td>
                            ${
                              !binding.enabled
                                ? renderDataStatusBadge("已停用", "neutral", true)
                                : scheduled
                                  ? renderDataStatusBadge("调度中", "ok", true)
                                  : (binding.supplyRecordCount ?? 0) > 0
                                    ? renderDataStatusBadge("已供给", "ok", true)
                                    : renderDataStatusBadge("待物化", "neutral", true)
                            }
                          </td>
                          <td class="edc-console-table__actions">
                            <button
                              class="btn btn--sm"
                              type="button"
                              ?disabled=${!binding.enabled || state.materializeBusyBindingId != null}
                              @click=${() => onMaterialize(binding.bindingId)}
                            >
                              ${
                                state.materializeBusyBindingId === binding.bindingId
                                  ? "物化中…"
                                  : "立即物化"
                              }
                            </button>
                          </td>
                        </tr>
                      `;
                    })}
                  </tbody>
                </table>
              `
        }
      </div>
      <div class="enterprise-data-capability__subsection">
        <div class="edc-section-label">知识对象（Feed）${
          state.feedItemsLoading ? " · 加载中…" : ` · ${state.feedItems.length}`
        }</div>
        <div class="enterprise-data-capability__hint">
          可删除单条已物化知识对象（软删）。删除后知识宇宙与 knowledge_search 不可见。「当前供给」表示该投影已启用绑定下的最新一条，删除需二次确认并强制执行。
        </div>
        ${
          state.feedItemsLoading && state.feedItems.length === 0
            ? html`
                <div class="enterprise-data-capability__hint">加载知识对象…</div>
              `
            : state.feedItems.length === 0
              ? html`
                  <div class="enterprise-data-capability__hint">暂无知识对象。可对手动物化绑定执行「立即物化」。</div>
                `
              : html`
                  <table class="edc-console-table edc-console-table--lean">
                    <thead>
                      <tr>
                        <th>标题</th>
                        <th>投影</th>
                        <th>生成时间</th>
                        <th>状态</th>
                        <th class="edc-console-table__actions">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${state.feedItems.map((item) => {
                        const spec = specById.get(item.projectionId);
                        const busy = state.feedDeleteBusyObjectId === item.objectId;
                        return html`
                          <tr data-feed-object-id=${item.objectId}>
                            <td>
                              <div>${item.title}</div>
                              <div class="enterprise-data-capability__hint">${item.objectId}</div>
                            </td>
                            <td>${spec?.displayName ?? item.projectionId}</td>
                            <td>${formatApprovalTimestamp(item.generatedAt)}</td>
                            <td>
                              ${
                                item.isCurrentSupplied
                                  ? renderDataStatusBadge("当前供给", "ok", true)
                                  : renderDataStatusBadge(
                                      item.freshnessStatus === "fresh"
                                        ? "可删除"
                                        : item.freshnessStatus,
                                      "neutral",
                                      true,
                                    )
                              }
                            </td>
                            <td class="edc-console-table__actions">
                              <button
                                class="btn btn--sm btn--danger"
                                type="button"
                                data-testid="feed-item-delete"
                                ?disabled=${busy || state.feedDeleteBusyObjectId != null}
                                @click=${() => onDeleteFeedItem(item)}
                              >
                                ${busy ? "删除中…" : "删除"}
                              </button>
                            </td>
                          </tr>
                        `;
                      })}
                    </tbody>
                  </table>
                `
        }
      </div>
    </section>
  `;
}
