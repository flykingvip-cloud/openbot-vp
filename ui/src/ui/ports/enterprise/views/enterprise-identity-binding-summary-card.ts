import { html, nothing } from "lit";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";
import {
  countUnreadBindingActivity,
  isBindingActivityUnread,
  readBindingActivitySeenAt,
  writeBindingActivitySeenAt,
} from "./enterprise-identity-binding-activity-prefs.ts";

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

function summarizeBindingActivity(entry: {
  kind: "bound" | "unbound";
  identityDisplayName: string;
  employeeLabel: string;
  agentLabel: string;
  seatTitle: string | null;
}): string {
  const verb = entry.kind === "bound" ? "绑定了" : "解绑了";
  const seat = entry.seatTitle ? `（${entry.seatTitle}）` : "";
  return `${entry.employeeLabel}${seat} ${verb} ${entry.identityDisplayName} · ${entry.agentLabel}`;
}

export function renderEnterpriseIdentityBindingSummaryCard(params: {
  readModel: EnterprisePortReadModel;
  tenantId: string | null;
  detailHref: string;
  onRefresh?: () => void;
  onMarkRead?: () => void;
  refreshing?: boolean;
}) {
  const { readModel, tenantId, detailHref, onRefresh, onMarkRead, refreshing } = params;
  const rows = readModel.employeeIdentityBindingRows ?? [];
  const activity = readModel.recentIdentityBindingActivity ?? [];
  const recentActivity = activity.slice(0, 3);
  const seenAt = readBindingActivitySeenAt(tenantId);
  const unreadCount = countUnreadBindingActivity(activity, seenAt);
  const bindingCount = rows.length;

  if (bindingCount === 0 && recentActivity.length === 0) {
    return nothing;
  }

  const headlineCount = unreadCount > 0 ? unreadCount : bindingCount;

  return html`
    <section
      class="enterprise-overview-section enterprise-card enterprise-identity-binding-summary-card ${unreadCount > 0 ? "has-unread" : ""}"
      data-identity-binding-summary
    >
      <div class="enterprise-overview-section__head">
        <div class="enterprise-overview-section__title">员工身份绑定</div>
        <span class="enterprise-command-card__count">${headlineCount}</span>
        ${
          unreadCount > 0
            ? html`<span class="enterprise-identity-bindings-unread-badge">${unreadCount} 条未读</span>`
            : nothing
        }
      </div>

      ${
        readModel.operationalIdentityNotice && unreadCount > 0
          ? html`
              <div class="enterprise-identity-binding-summary-card__notice">
                ${readModel.operationalIdentityNotice}
              </div>
            `
          : nothing
      }

      ${
        recentActivity.length > 0
          ? html`
              <ul class="enterprise-identity-binding-summary-card__list">
                ${recentActivity.map((entry) => {
                  const unread = isBindingActivityUnread(entry.createdAt, seenAt);
                  return html`
                    <li
                      class="enterprise-identity-binding-summary-card__row ${unread ? "is-unread" : ""}"
                    >
                      <span
                        class="enterprise-identity-bindings-activity__pill enterprise-identity-bindings-activity__pill--${entry.kind}"
                      >
                        ${entry.kind === "bound" ? "已绑定" : "已解绑"}
                      </span>
                      <span class="enterprise-identity-binding-summary-card__label">
                        ${summarizeBindingActivity(entry)}
                      </span>
                      <span class="enterprise-identity-binding-summary-card__time">
                        ${formatRelativeZh(entry.createdAt)}
                      </span>
                    </li>
                  `;
                })}
              </ul>
            `
          : html`
              <div class="enterprise-empty enterprise-empty--compact">
                暂无最近变更，当前共 ${bindingCount} 条员工绑定。
              </div>
            `
      }

      <div class="enterprise-identity-binding-summary-card__footer">
        ${
          unreadCount > 0
            ? html`
                <button
                  class="btn btn--sm"
                  type="button"
                  @click=${() => {
                    writeBindingActivitySeenAt(tenantId);
                    onMarkRead?.();
                  }}
                >
                  全部标为已读
                </button>
              `
            : nothing
        }
        <button
          class="btn btn--sm btn--ghost"
          type="button"
          ?disabled=${refreshing || readModel.operationalIdentityBusy}
          @click=${() => onRefresh?.()}
        >
          ${refreshing || readModel.operationalIdentityBusy ? "同步中…" : "同步绑定"}
        </button>
        <a class="enterprise-command-status__link" href=${detailHref}>查看绑定总览</a>
      </div>
    </section>
  `;
}
