import { html, nothing } from "lit";
import { renderIcon } from "../../../icons.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import {
  countUnreadBindingActivity,
  isBindingActivityUnread,
  readBindingActivitySeenAt,
  writeBindingActivitySeenAt,
} from "./enterprise-identity-binding-activity-prefs.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";

function formatRelativeZh(value: string | undefined): string {
  if (!value?.trim()) {
    return "—";
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  const deltaMs = Date.now() - parsed;
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days} 天前`;
  }
  return new Date(parsed).toLocaleDateString("zh-CN");
}

function departmentLeafLabel(path: string | null | undefined): string {
  const parts = path?.split("/").filter(Boolean) ?? [];
  return parts.length > 0 ? parts[parts.length - 1] : "未分配部门";
}

function applyBindingOverviewFilters(root: HTMLElement) {
  const search = (root.querySelector<HTMLInputElement>("[data-binding-search-input]")?.value ?? "")
    .trim()
    .toLowerCase();
  const seatFilter =
    root.querySelector<HTMLSelectElement>("[data-binding-seat-filter]")?.value ?? "all";
  const departmentFilter =
    root.querySelector<HTMLSelectElement>("[data-binding-department-filter]")?.value ?? "all";
  const unreadOnly = Boolean(
    root.querySelector<HTMLInputElement>("[data-binding-unread-only]")?.checked,
  );
  const seenAt = root.dataset.bindingSeenAt ?? "";

  for (const row of root.querySelectorAll<HTMLElement>("[data-binding-row]")) {
    const haystack = row.dataset.bindingSearch ?? "";
    const seatTitle = row.dataset.bindingSeat ?? "";
    const departmentPath = row.dataset.bindingDepartment ?? "";
    const updatedAt = row.dataset.bindingUpdatedAt ?? "";
    const unread = isBindingActivityUnread(updatedAt, seenAt);
    const matchesSearch = !search || haystack.includes(search);
    const matchesSeat = seatFilter === "all" || seatTitle === seatFilter;
    const matchesDepartment = departmentFilter === "all" || departmentPath === departmentFilter;
    const matchesUnread = !unreadOnly || unread;
    row.hidden = !(matchesSearch && matchesSeat && matchesDepartment && matchesUnread);
  }

  for (const item of root.querySelectorAll<HTMLElement>("[data-binding-activity-item]")) {
    const createdAt = item.dataset.bindingCreatedAt ?? "";
    const unread = isBindingActivityUnread(createdAt, seenAt);
    item.hidden = unreadOnly && !unread;
  }
}

function markBindingActivityRead(
  root: HTMLElement,
  tenantId: string | null,
  onMarked?: () => void,
) {
  const seenAt = writeBindingActivitySeenAt(tenantId) ?? new Date().toISOString();
  root.dataset.bindingSeenAt = seenAt;
  applyBindingOverviewFilters(root);
  onMarked?.();
}

export function renderEnterpriseIdentityEmployeeBindingsPanel(params: {
  readModel: EnterprisePortReadModel;
  editor: EnterpriseSurfaceProps["identityManagementEditor"];
  tenantId: string | null;
  standalone?: boolean;
  onMarkBindingActivityRead?: () => void;
  onOpenIdentity?: (identityId: string) => void;
}) {
  const { readModel, editor, tenantId, standalone, onMarkBindingActivityRead, onOpenIdentity } =
    params;
  const rows = readModel.employeeIdentityBindingRows ?? [];
  const activity = readModel.recentIdentityBindingActivity ?? [];
  const recentActivity = activity.slice(0, 12);
  const seenAt = readBindingActivitySeenAt(tenantId);
  const unreadCount = countUnreadBindingActivity(activity, seenAt);
  const openIdentity = onOpenIdentity ?? editor.onSelectDetailIdentity;

  const seatOptions = [...new Set(rows.map((row) => row.seatTitle).filter(Boolean))].toSorted(
    (left, right) => left!.localeCompare(right!, "zh-CN"),
  ) as string[];
  const departmentOptions = [
    ...new Set(rows.map((row) => row.departmentPath).filter(Boolean)),
  ].toSorted((left, right) => left!.localeCompare(right!, "zh-CN")) as string[];

  return html`
    <article
      class="${standalone ? "enterprise-settings-panel enterprise-settings-panel--flat" : "enterprise-card enterprise-settings-panel"} enterprise-identity-bindings-overview"
      data-employee-binding-overview
      data-binding-seen-at=${seenAt ?? ""}
    >
      ${
        standalone
          ? nothing
          : html`
              <div class="enterprise-settings-panel__head">
                <span class="enterprise-settings-panel__icon">${renderIcon("users", "enterprise-settings-panel__icon-svg")}</span>
                <div>
                  <div class="enterprise-settings-panel__title">
                    员工绑定总览
                    ${unreadCount > 0 ? html`<span class="enterprise-identity-bindings-unread-badge">${unreadCount} 条未读</span>` : nothing}
                  </div>
                  <div class="enterprise-settings-panel__sub">
                    员工绑定或解绑企业身份后，变更会自动同步至此；可按岗位、部门筛选并标记已读。
                  </div>
                </div>
                ${
                  unreadCount > 0
                    ? html`
                        <button
                          type="button"
                          class="btn btn--sm"
                          @click=${(event: Event) =>
                            markBindingActivityRead(
                              (event.currentTarget as HTMLElement).closest(
                                "[data-employee-binding-overview]",
                              ) as HTMLElement,
                              tenantId,
                              onMarkBindingActivityRead,
                            )}
                        >
                          全部标为已读
                        </button>
                      `
                    : nothing
                }
              </div>
            `
      }

      ${
        recentActivity.length > 0
          ? html`
              <div class="enterprise-identity-bindings-activity">
                <div class="enterprise-identity-bindings-activity__title">最近变更</div>
                <ul class="enterprise-identity-bindings-activity__list">
                  ${recentActivity.map((entry) => {
                    const unread = isBindingActivityUnread(entry.createdAt, seenAt);
                    return html`
                      <li
                        class="enterprise-identity-bindings-activity__item ${unread ? "is-unread" : ""}"
                        data-binding-activity-item
                        data-binding-created-at=${entry.createdAt}
                      >
                        <span
                          class="enterprise-identity-bindings-activity__pill enterprise-identity-bindings-activity__pill--${entry.kind}"
                        >
                          ${entry.kind === "bound" ? "已绑定" : "已解绑"}
                        </span>
                        <button
                          type="button"
                          class="enterprise-identity-bindings-activity__link"
                          @click=${() => openIdentity(entry.identityId)}
                        >
                          ${entry.identityDisplayName}
                        </button>
                        <span class="enterprise-identity-bindings-activity__meta">
                          ${entry.employeeLabel} · ${entry.agentLabel}
                          ${entry.seatTitle ? html` · ${entry.seatTitle}` : nothing}
                          · ${formatRelativeZh(entry.createdAt)}
                        </span>
                      </li>
                    `;
                  })}
                </ul>
              </div>
            `
          : nothing
      }

      ${
        rows.length > 0
          ? html`
              <div class="enterprise-identity-bindings-toolbar">
                <input
                  class="enterprise-identity-bindings-search"
                  type="search"
                  placeholder="筛选员工、机器人或身份…"
                  data-binding-search-input
                  @input=${(event: Event) => {
                    const root = (event.currentTarget as HTMLElement).closest(
                      "[data-employee-binding-overview]",
                    ) as HTMLElement;
                    applyBindingOverviewFilters(root);
                  }}
                />
                <select
                  class="enterprise-identity-bindings-filter"
                  data-binding-seat-filter
                  @change=${(event: Event) => {
                    const root = (event.currentTarget as HTMLElement).closest(
                      "[data-employee-binding-overview]",
                    ) as HTMLElement;
                    applyBindingOverviewFilters(root);
                  }}
                >
                  <option value="all">全部岗位</option>
                  ${seatOptions.map(
                    (seatTitle) => html`<option value=${seatTitle}>${seatTitle}</option>`,
                  )}
                </select>
                <select
                  class="enterprise-identity-bindings-filter"
                  data-binding-department-filter
                  @change=${(event: Event) => {
                    const root = (event.currentTarget as HTMLElement).closest(
                      "[data-employee-binding-overview]",
                    ) as HTMLElement;
                    applyBindingOverviewFilters(root);
                  }}
                >
                  <option value="all">全部部门</option>
                  ${departmentOptions.map(
                    (departmentPath) => html`
                      <option value=${departmentPath}>${departmentLeafLabel(departmentPath)}</option>
                    `,
                  )}
                </select>
                <label class="enterprise-identity-bindings-unread-toggle">
                  <input
                    type="checkbox"
                    data-binding-unread-only
                    ?checked=${!standalone && unreadCount > 0}
                    @change=${(event: Event) => {
                      const root = (event.currentTarget as HTMLElement).closest(
                        "[data-employee-binding-overview]",
                      ) as HTMLElement;
                      applyBindingOverviewFilters(root);
                    }}
                  />
                  仅看未读
                </label>
                <span class="enterprise-identity-bindings-count">${rows.length} 条绑定</span>
              </div>
              <div class="enterprise-identity-bindings-table" role="table">
                <div class="enterprise-identity-bindings-table__head" role="row">
                  <span role="columnheader">员工</span>
                  <span role="columnheader">岗位</span>
                  <span role="columnheader">机器人</span>
                  <span role="columnheader">身份</span>
                  <span role="columnheader">更新时间</span>
                </div>
                ${rows.map((row) => {
                  const unread = isBindingActivityUnread(row.updatedAt, seenAt);
                  return html`
                    <button
                      type="button"
                      class="enterprise-identity-bindings-table__row ${unread ? "is-unread" : ""}"
                      role="row"
                      data-binding-row
                      data-binding-search=${`${row.employeeLabel} ${row.agentLabel} ${row.identityDisplayName} ${row.providerLabel} ${row.seatTitle ?? ""} ${row.departmentPath ?? ""}`.toLowerCase()}
                      data-binding-seat=${row.seatTitle ?? ""}
                      data-binding-department=${row.departmentPath ?? ""}
                      data-binding-updated-at=${row.updatedAt}
                      @click=${() => openIdentity(row.identityId)}
                    >
                      <span role="cell">${row.employeeLabel}</span>
                      <span role="cell">${row.seatTitle ?? "—"}</span>
                      <span role="cell">${row.agentLabel}</span>
                      <span role="cell">${row.providerLabel} · ${row.identityDisplayName}</span>
                      <span role="cell">${formatRelativeZh(row.updatedAt)}</span>
                    </button>
                  `;
                })}
              </div>
            `
          : html`
              <div class="enterprise-settings-empty">暂无员工绑定记录。</div>
            `
      }
    </article>
  `;
}
