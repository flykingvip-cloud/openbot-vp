import { html, nothing, type TemplateResult } from "lit";
import type {
  UserOperationalIdentitySnapshot,
  UserOperationalIdentityUsageEventSummary,
} from "../semantic/view-controller-facade.ts";
import {
  filterUsageHistoryByRange,
  formatOperationalIdentityTimestamp,
  formatOperationalIdentityUsageResult,
  operationalIdentityActionLabel,
  operationalIdentityRobotLabel,
  usageEventHeadline,
  usagePublishKindLabel,
  USER_OPERATIONAL_IDENTITY_USAGE_RANGES,
} from "./workbench-operational-identity-shared.ts";
import type { SettingsContract } from "./workbench-stage-contracts.ts";

type IdentitySummary = NonNullable<UserOperationalIdentitySnapshot>["identities"][number];

function kvRow(
  label: string,
  value: string | number | undefined | null,
): TemplateResult | typeof nothing {
  if (value === undefined || value === null || value === "") {
    return nothing;
  }
  return html`
    <div class="employee-workbench__identity-usage-kv">
      <span class="employee-workbench__identity-usage-kv-label">${label}</span>
      <span class="employee-workbench__identity-usage-kv-value">${String(value)}</span>
    </div>
  `;
}

function renderUsageDetail(
  event: UserOperationalIdentityUsageEventSummary,
  params: {
    settings: SettingsContract;
    catalog: NonNullable<UserOperationalIdentitySnapshot>["providerCatalog"];
    identity?: IdentitySummary;
    showIdentity: boolean;
  },
): TemplateResult {
  const actionLabel = operationalIdentityActionLabel(params.catalog, event.provider, event.action);
  const summary = event.summary;
  const metrics = event.metrics;
  const publishKind = usagePublishKindLabel(summary?.publishKind);
  return html`
    <div class="employee-workbench__identity-usage-detail" data-usage-event-id=${event.eventId}>
      <div class="employee-workbench__identity-usage-detail-head">
        <div class="employee-workbench__settings-section-title">
          ${usageEventHeadline(event, actionLabel)}
        </div>
        <button
          type="button"
          class="btn btn--sm"
          @click=${() => params.settings.onSelectUserOperationalIdentityUsageEvent?.(null)}
        >
          关闭
        </button>
      </div>
      <div class="employee-workbench__identity-usage-kv-stack">
        ${kvRow("动作", actionLabel)}
        ${kvRow("数字人", operationalIdentityRobotLabel(params.settings, event.agentId))}
        ${
          params.showIdentity
            ? kvRow(
                "身份",
                params.identity?.displayName ?? params.identity?.providerLabel ?? event.provider,
              )
            : nothing
        }
        ${kvRow("结果", formatOperationalIdentityUsageResult(event.result))}
        ${kvRow("时间", formatOperationalIdentityTimestamp(event.createdAt))}
        ${event.denialCode ? kvRow("原因", event.denialCode) : nothing}
        ${kvRow("收件人", summary?.recipients?.join("、"))}
        ${kvRow("主题", summary?.subject)}
        ${kvRow("核心观点", summary?.excerpt && summary.excerpt !== summary.headline ? summary.excerpt : "")}
        ${kvRow("字数", summary?.wordCount)}
        ${kvRow("附件", summary?.attachmentCount)}
        ${kvRow("发布形态", publishKind)}
        ${kvRow("仓库", summary?.repository)}
        ${kvRow("编号", summary?.issueNumber)}
        ${kvRow("话题", summary?.tags?.join("、"))}
        ${kvRow("阅读", metrics?.readCount)}
        ${kvRow("转发", metrics?.shareCount)}
        ${kvRow("评论", metrics?.commentCount)}
        ${kvRow("点赞", metrics?.likeCount)}
        ${kvRow("粉丝", metrics?.followerCount)}
        ${
          metrics?.refreshedAt
            ? kvRow("效果更新", formatOperationalIdentityTimestamp(metrics.refreshedAt))
            : nothing
        }
      </div>
    </div>
  `;
}

export function renderOperationalIdentityUsageRecords(params: {
  settings: SettingsContract;
  events: UserOperationalIdentityUsageEventSummary[];
  catalog: NonNullable<UserOperationalIdentitySnapshot>["providerCatalog"];
  identityById: Map<string, IdentitySummary>;
  scoped: boolean;
}): TemplateResult {
  const range = params.settings.userOperationalIdentityUsageRange ?? "30d";
  const visible = filterUsageHistoryByRange(params.events, range);
  const selectedId = params.settings.userOperationalIdentityUsageEventId ?? null;
  const selected =
    visible.find((event) => event.eventId === selectedId) ??
    (selectedId ? params.events.find((event) => event.eventId === selectedId) : undefined);
  const emptyCopy =
    params.events.length === 0 ? "该身份还没有使用记录。" : "该时间范围内没有使用记录。";

  return html`
    <div class="employee-workbench__auth-subpane employee-workbench__identity-usage">
      <div class="employee-workbench__identity-usage-head">
        <div class="employee-workbench__settings-section-title">使用记录</div>
        <div class="employee-workbench__identity-usage-ranges" role="tablist" aria-label="使用记录时间范围">
          ${USER_OPERATIONAL_IDENTITY_USAGE_RANGES.map(
            (entry) => html`
              <button
                type="button"
                role="tab"
                class="employee-workbench__identity-usage-chip ${entry.id === range ? "is-active" : ""}"
                aria-selected=${entry.id === range}
                @click=${() => params.settings.onUserOperationalIdentityUsageRangeChange?.(entry.id)}
              >
                ${entry.label}
              </button>
            `,
          )}
        </div>
      </div>
      ${
        visible.length === 0
          ? html`<div class="employee-workbench__settings-section-subtitle">${emptyCopy}</div>`
          : html`
              <table class="employee-workbench__identity-usage-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>数字人</th>
                    ${
                      params.scoped
                        ? nothing
                        : html`
                            <th>身份</th>
                          `
                    }
                    <th>动作</th>
                    <th>任务</th>
                    <th>结果</th>
                  </tr>
                </thead>
                <tbody>
                  ${visible.slice(0, 20).map((event) => {
                    const identity = params.identityById.get(event.identityId);
                    const actionLabel = operationalIdentityActionLabel(
                      params.catalog,
                      event.provider,
                      event.action,
                    );
                    const selectedRow = event.eventId === selected?.eventId;
                    return html`
                      <tr
                        class=${selectedRow ? "is-selected" : ""}
                        role="button"
                        tabindex="0"
                        aria-selected=${selectedRow}
                        data-usage-event-id=${event.eventId}
                        @click=${() =>
                          params.settings.onSelectUserOperationalIdentityUsageEvent?.(
                            selectedRow ? null : event.eventId,
                          )}
                        @keydown=${(keyboardEvent: KeyboardEvent) => {
                          if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
                            keyboardEvent.preventDefault();
                            params.settings.onSelectUserOperationalIdentityUsageEvent?.(
                              selectedRow ? null : event.eventId,
                            );
                          }
                        }}
                      >
                        <td>${formatOperationalIdentityTimestamp(event.createdAt)}</td>
                        <td>${operationalIdentityRobotLabel(params.settings, event.agentId)}</td>
                        ${
                          params.scoped
                            ? nothing
                            : html`
                                <td>
                                  ${
                                    identity?.displayName ??
                                    identity?.providerLabel ??
                                    event.provider
                                  }
                                </td>
                              `
                        }
                        <td>${actionLabel}</td>
                        <td>${usageEventHeadline(event, actionLabel)}</td>
                        <td>${formatOperationalIdentityUsageResult(event.result)}</td>
                      </tr>
                    `;
                  })}
                </tbody>
              </table>
            `
      }
      ${
        selected
          ? renderUsageDetail(selected, {
              settings: params.settings,
              catalog: params.catalog,
              identity: params.identityById.get(selected.identityId),
              showIdentity: !params.scoped,
            })
          : nothing
      }
    </div>
  `;
}
