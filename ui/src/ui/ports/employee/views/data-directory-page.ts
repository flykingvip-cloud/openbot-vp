import { html, nothing } from "lit";
import { t } from "../../../../i18n/index.ts";
import type { SettingsContract } from "./workbench-stage-contracts.ts";
import "./employee-data-retention-summary-card.ts";

export type DataDirectoryAccessGrantRow = {
  id: string;
  agentId: string;
  resourceType: string;
  resourcePath: string;
  grantedAt: string;
};

export type DataDirectoryPanelState = {
  loading?: boolean;
  error?: string | null;
  mode?: "local" | "managed";
  displayRoot?: string;
  volumeName?: string;
  usedBytesLabel?: string;
  previousRoot?: string;
  migrationOpen?: boolean;
  migrationBusy?: boolean;
  migrationMessage?: string | null;
  migrationTargetDraft?: string;
  exportBusy?: boolean;
  exportPath?: string | null;
  showFinderReveal?: boolean;
  accessGrants?: DataDirectoryAccessGrantRow[];
  accessGrantsLoading?: boolean;
  forgetMemoryAgentId?: string;
  forgetMemoryKey?: string;
  forgetMemoryBusy?: boolean;
  forgetMemoryMessage?: string | null;
};

export function renderDataDirectoryPanel(
  settings: SettingsContract,
  state: DataDirectoryPanelState,
) {
  if (state.mode === "managed") {
    return html`
      <section
        class="employee-workbench__settings-section employee-workbench__settings-section--personal-tab"
      >
        <div class="employee-workbench__settings-section-title">
          ${t("frontstage.workbench.settings.personalModules.data.title")}
        </div>
        <div class="employee-workbench__settings-section-subtitle">
          当前为云端托管：数据由平台加密保存。导出备份与目录迁移仅适用于本机部署。
        </div>
      </section>
    `;
  }

  return html`
    <section class="employee-workbench__settings-section employee-workbench__settings-section--personal-tab">
      <div class="employee-workbench__settings-section-head">
        <div class="employee-workbench__settings-section-title">
          ${t("frontstage.workbench.settings.personalModules.data.title")}
        </div>
        <div class="employee-workbench__settings-section-subtitle">
          ${t("frontstage.workbench.settings.personalModules.data.subtitle")}
        </div>
      </div>
      ${
        state.loading
          ? html`
              <div class="employee-workbench__settings-status-copy">正在加载…</div>
            `
          : html`
              <div class="employee-workbench__settings-status-grid employee-workbench__settings-status-grid--flat">
                <div class="employee-workbench__settings-status-card">
                  <div class="employee-workbench__settings-field-label">当前磁盘</div>
                  <div class="employee-workbench__settings-title">${state.volumeName ?? "本机磁盘"}</div>
                </div>
                <div class="employee-workbench__settings-status-card">
                  <div class="employee-workbench__settings-field-label">数据根目录</div>
                  <div class="employee-workbench__settings-title mono">${state.displayRoot ?? "~/OpenBot"}</div>
                  <div class="employee-workbench__settings-status-copy">
                    已用 ${state.usedBytesLabel ?? "—"}（可迁移数据包估算）
                  </div>
                </div>
              </div>
              <div class="employee-workbench__auth-config-callout">
                换机或备份时先「导出备份」；需要改存放位置时用「迁移数据位置」。迁移完成后需重启网关。
              </div>
              <div
                class="employee-workbench__settings-password-actions employee-workbench__settings-password-actions--personal"
              >
                <button
                  type="button"
                  class="btn btn--primary"
                  ?disabled=${state.migrationBusy || state.exportBusy}
                  @click=${() => void settings.onExportOpenBotData?.()}
                >
                  ${state.exportBusy ? "导出中…" : "导出备份"}
                </button>
                <button
                  type="button"
                  class="btn"
                  ?disabled=${state.migrationBusy || state.exportBusy}
                  @click=${() => settings.onOpenDataMigrationWizard?.()}
                >
                  迁移数据位置
                </button>
                ${
                  state.showFinderReveal
                    ? html`
                        <button
                          type="button"
                          class="btn"
                          ?disabled=${state.migrationBusy || state.exportBusy}
                          @click=${() => void settings.onRevealDataDirectoryInFinder?.()}
                        >
                          在 Finder 中显示
                        </button>
                      `
                    : nothing
                }
              </div>
              ${
                state.exportPath
                  ? html`
                      <div class="callout employee-workbench__settings-callout">
                        备份已导出：<span class="mono">${state.exportPath}</span>
                      </div>
                    `
                  : nothing
              }
              ${
                state.migrationOpen
                  ? html`
                      <section class="employee-workbench__settings-workspace-panel employee-workbench__settings-workspace-panel--flat">
                        <div class="employee-workbench__settings-section-title">迁移数据位置</div>
                        <div class="employee-workbench__settings-section-subtitle">
                          将本机 OpenBot 数据目录整体搬到新位置；完成后需重启网关才会生效。
                        </div>
                        <label class="employee-workbench__settings-field">
                          <span class="employee-workbench__settings-field-label">目标位置</span>
                          <div class="employee-workbench__settings-input-row">
                            <input
                              class="employee-workbench__settings-input mono"
                              .value=${state.migrationTargetDraft ?? ""}
                              placeholder="选择迁移目标目录"
                              title="迁移完成后需重启网关生效"
                              @input=${(event: Event) =>
                                settings.onDataMigrationTargetDraftChange?.(
                                  (event.currentTarget as HTMLInputElement).value,
                                )}
                            />
                            <button
                              type="button"
                              class="btn btn--sm"
                              ?disabled=${state.migrationBusy}
                              @click=${() => void settings.onChooseDataMigrationTarget?.()}
                            >
                              选择…
                            </button>
                          </div>
                        </label>
                        <div class="employee-workbench__settings-password-actions">
                          <button
                            type="button"
                            class="btn btn--primary"
                            ?disabled=${state.migrationBusy}
                            @click=${() => void settings.onStartDataMigration?.()}
                          >
                            ${state.migrationBusy ? "迁移中…" : "开始迁移"}
                          </button>
                          <button
                            type="button"
                            class="btn"
                            ?disabled=${state.migrationBusy}
                            @click=${() => settings.onCloseDataMigrationWizard?.()}
                          >
                            取消
                          </button>
                        </div>
                        ${
                          state.migrationMessage
                            ? html`
                                <div class="callout employee-workbench__settings-callout">
                                  ${state.migrationMessage}
                                </div>
                              `
                            : nothing
                        }
                      </section>
                    `
                  : nothing
              }
            `
      }
      ${
        state.error
          ? html`<div class="callout callout--danger employee-workbench__settings-callout">${state.error}</div>`
          : nothing
      }
      <section class="employee-workbench__settings-section employee-workbench__settings-section--personal-tab">
        <employee-data-retention-summary-card
          .client=${settings.client ?? null}
        ></employee-data-retention-summary-card>
      </section>
      <section class="employee-workbench__settings-section employee-workbench__settings-section--personal-tab">
        <div class="employee-workbench__settings-section-title">数据隐私</div>
        <div class="employee-workbench__settings-section-subtitle">
          管理记忆条目与 Agent 数据授权记录。
        </div>
        <label class="employee-workbench__settings-field">
          <span class="employee-workbench__settings-field-label">删除记忆文件（Agent ID）</span>
          <input
            class="employee-workbench__settings-input mono"
            .value=${state.forgetMemoryAgentId ?? ""}
            placeholder="main"
            @input=${(event: Event) =>
              settings.onForgetMemoryAgentIdChange?.(
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
        <label class="employee-workbench__settings-field">
          <span class="employee-workbench__settings-field-label">记忆路径或文件名</span>
          <input
            class="employee-workbench__settings-input mono"
            .value=${state.forgetMemoryKey ?? ""}
            placeholder="memory/agent/example.md"
            @input=${(event: Event) =>
              settings.onForgetMemoryKeyChange?.((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <div class="employee-workbench__settings-password-actions">
          <button
            type="button"
            class="btn"
            title="仅删除所选文件，不会清除其他来源中的相同内容，也不保证立即停止相关召回"
            ?disabled=${state.forgetMemoryBusy}
            @click=${() => void settings.onForgetMemoryEntry?.()}
          >
            ${state.forgetMemoryBusy ? "处理中…" : "删除此记忆文件"}
          </button>
        </div>
        ${
          state.forgetMemoryMessage
            ? html`
                <div class="callout employee-workbench__settings-callout">
                  ${state.forgetMemoryMessage}
                </div>
              `
            : nothing
        }
        <div class="employee-workbench__settings-section-subtitle" style="margin-top: 1rem;">
          此 Agent 可访问的数据
        </div>
        ${
          state.accessGrantsLoading
            ? html`
                <div class="employee-workbench__settings-status-copy">正在加载授权记录…</div>
              `
            : (state.accessGrants?.length ?? 0) === 0
              ? html`
                  <div class="employee-workbench__settings-status-copy">暂无授权记录。</div>
                `
              : html`
                  <div class="employee-workbench__settings-status-grid employee-workbench__settings-status-grid--flat">
                    ${(state.accessGrants ?? []).map(
                      (grant) => html`
                        <div class="employee-workbench__settings-status-card">
                          <div class="employee-workbench__settings-field-label">${grant.agentId}</div>
                          <div class="employee-workbench__settings-title mono">${grant.resourcePath}</div>
                          <div class="employee-workbench__settings-status-copy">
                            ${grant.resourceType} · ${grant.grantedAt}
                          </div>
                          <button
                            type="button"
                            class="btn btn--danger"
                            @click=${() => void settings.onRevokeAccessGrant?.(grant.id)}
                          >
                            撤销授权
                          </button>
                        </div>
                      `,
                    )}
                  </div>
                `
        }
      </section>
    </section>
  `;
}
