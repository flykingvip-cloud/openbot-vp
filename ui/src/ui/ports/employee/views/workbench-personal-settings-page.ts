import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../../../i18n/index.ts";
import { formatIsoTimestamp } from "../../../format.ts";
import "../../../capability/user-modeling/user-learned-preferences-panel.ts";
import { renderDataDirectoryPanel } from "./data-directory-page.ts";
import { renderMemoryCenterPanel } from "./memory-center-page.ts";
import { renderPersonalDevicesPanel } from "./personal-devices-page.ts";
import { renderPersonalAuthorizationPanel } from "./workbench-personal-authorization-panel.ts";
import {
  renderPersonalSettingsPanel,
  renderPersonalSettingsTabIntro,
} from "./workbench-personal-settings-layout.ts";
import type { SettingsContract } from "./workbench-stage-contracts.ts";
import type { WorkbenchPersonalSettingsTab } from "./workbench-types.ts";
import "./workbench-password-change-section.ts";

function themeLabel(theme: string, locale: string) {
  if (locale === "en") {
    if (theme === "system") {
      return "System";
    }
    return theme === "dark" ? "Dark" : "Light";
  }
  if (theme === "system") {
    return "跟随系统";
  }
  return theme === "dark" ? "深色" : "浅色";
}

function renderSegmentButton(params: {
  active: boolean;
  label: string;
  description?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return html`
    <button
      type="button"
      class="employee-workbench__settings-segment ${params.active ? "is-active" : ""}"
      ?aria-pressed=${params.active}
      ?disabled=${Boolean(params.disabled)}
      title=${params.description ?? params.label}
      @click=${params.onClick}
    >
      <span class="employee-workbench__settings-segment-label">${params.label}</span>
      ${
        params.description
          ? html`
            <span class="employee-workbench__settings-segment-copy">${params.description}</span>
          `
          : nothing
      }
    </button>
  `;
}

function renderToggleRow(params: {
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return html`
    <button
      type="button"
      class="employee-workbench__settings-toggle ${params.checked ? "is-active" : ""}"
      role="switch"
      aria-checked=${String(params.checked)}
      title=${params.description?.trim() || ""}
      ?disabled=${Boolean(params.disabled)}
      @click=${() => params.onToggle(!params.checked)}
    >
      <span class="employee-workbench__settings-toggle-copy">
        <span class="employee-workbench__settings-toggle-title">${params.title}</span>
      </span>
      <span class="employee-workbench__settings-toggle-track" aria-hidden="true">
        <span class="employee-workbench__settings-toggle-thumb"></span>
      </span>
    </button>
  `;
}

function renderSettingsRow(label: string, value: unknown, className = "") {
  return html`
    <div class="employee-workbench__settings-row">
      <div class="employee-workbench__settings-label">${label}</div>
      <div class="employee-workbench__settings-value ${className}">${value}</div>
    </div>
  `;
}

function renderSettingsChipRow(label: string, items: string[], emptyLabel: string) {
  const chips = items.map((item) => item.trim()).filter(Boolean);
  return html`
    <div class="employee-workbench__settings-row employee-workbench__settings-row--chips">
      <div class="employee-workbench__settings-label">${label}</div>
      <div class="employee-workbench__settings-value">
        ${
          chips.length > 0
            ? html`
              <div class="employee-workbench__settings-chip-list">
                ${chips.map(
                  (item) => html`
                    <span class="employee-workbench__settings-chip">${item}</span>
                  `,
                )}
              </div>
            `
            : emptyLabel
        }
      </div>
    </div>
  `;
}

function joinDisplayLabels(labels: string[] | undefined, fallbackIds: string[] | undefined) {
  const resolved = (labels ?? []).map((item) => item.trim()).filter(Boolean);
  if (resolved.length > 0) {
    return resolved;
  }
  return (fallbackIds ?? []).map((item) => item.trim()).filter(Boolean);
}

function renderPersonalTabIntro(title: string) {
  // Keep personal settings lean: titles only, no explanatory subtitles.
  return renderPersonalSettingsTabIntro(title);
}

function renderPersonalPanel(params: {
  title: string;
  subtitle?: string;
  modifier?: string;
  content: TemplateResult;
}) {
  return renderPersonalSettingsPanel(params);
}

function renderPersonalPreferenceField(label: string, content: TemplateResult) {
  return html`
    <div class="employee-workbench__settings-personal-field">
      <div class="employee-workbench__settings-personal-field-label">${label}</div>
      <div class="employee-workbench__settings-personal-field-control">${content}</div>
    </div>
  `;
}

function renderPersonalSegmentRail(segments: Array<Parameters<typeof renderSegmentButton>[0]>) {
  return html`
    <div class="employee-workbench__settings-segments employee-workbench__settings-segments--rail">
      ${segments.map((segment) => renderSegmentButton(segment))}
    </div>
  `;
}

function renderPersonalSettingsTab(
  tab: WorkbenchPersonalSettingsTab,
  activeTab: WorkbenchPersonalSettingsTab,
  label: string,
  onSelect: (tab: WorkbenchPersonalSettingsTab) => void,
) {
  return html`
    <button
      type="button"
      class="employee-workbench__settings-tab ${activeTab === tab ? "is-active" : ""}"
      role="tab"
      aria-selected=${String(activeTab === tab)}
      @click=${() => onSelect(tab)}
    >
      ${label}
    </button>
  `;
}

function renderPersonalMetaList(rows: TemplateResult[]) {
  return html`
    <div class="employee-workbench__settings-list employee-workbench__settings-list--meta">
      ${rows}
    </div>
  `;
}

function renderPendingSeatOfferPanel(
  settings: SettingsContract,
  pendingSeatOffer: NonNullable<SettingsContract["pendingSeatOffer"]>,
) {
  return renderPersonalPanel({
    title: t("frontstage.workbench.settings.pendingSeatOffer.title"),
    modifier: "employee-workbench__settings-personal-panel--pending-offer",
    content: html`
      ${renderPersonalMetaList([
        renderSettingsRow(
          t("frontstage.workbench.settings.pendingSeatOffer.fields.seat"),
          pendingSeatOffer.seatTitle,
        ),
        renderSettingsRow(
          t("frontstage.workbench.settings.pendingSeatOffer.fields.defaultAgent"),
          pendingSeatOffer.defaultAgentLabel?.trim() ||
            pendingSeatOffer.defaultAgentId?.trim() ||
            t("frontstage.workbench.settings.noDefaultAgent"),
        ),
        renderSettingsChipRow(
          t("frontstage.workbench.settings.pendingSeatOffer.fields.robotTeam"),
          joinDisplayLabels(pendingSeatOffer.agentToolLabels, pendingSeatOffer.agentIds),
          t("frontstage.workbench.settings.noDefaultAgent"),
        ),
        renderSettingsChipRow(
          t("frontstage.workbench.settings.pendingSeatOffer.fields.defaultSpaces"),
          joinDisplayLabels(pendingSeatOffer.defaultSpaceLabels, pendingSeatOffer.defaultSpaceIds),
          t("frontstage.workbench.settings.noDefaultSpaces"),
        ),
        renderSettingsRow(
          t("frontstage.workbench.settings.pendingSeatOffer.fields.offeredAt"),
          formatIsoTimestamp(
            pendingSeatOffer.offeredAt,
            settings.currentLocale === "en" ? "en" : "zh-CN",
          ),
        ),
        ...(pendingSeatOffer.reauthorizationRequired
          ? [
              renderSettingsRow(
                settings.currentLocale === "zh-CN" ? "接手提醒" : "Handover note",
                settings.currentLocale === "zh-CN"
                  ? "接手后部分企业能力需要你重新确认或授权。"
                  : "Some enterprise capabilities will need your confirmation after you accept.",
              ),
            ]
          : []),
      ])}
      ${(() => {
        const omittedLabels = pendingSeatOffer.omittedAgentToolLabels ?? [];
        if (omittedLabels.length === 0) {
          return nothing;
        }
        return html`
          ${renderPersonalMetaList([
            renderSettingsChipRow(
              settings.currentLocale === "zh-CN" ? "未纳入机器人团队" : "Robot team not included",
              omittedLabels,
              settings.currentLocale === "zh-CN" ? "无" : "None",
            ),
          ])}
          <div class="employee-workbench__settings-personal-hint">
            ${
              settings.currentLocale === "zh-CN"
                ? "每个岗位最多 5 个机器人；接受后按上表顺序保留前 5 个。"
                : "Each seat keeps at most 5 robots (first 5 listed above)."
            }
          </div>
        `;
      })()}
      <div
        class="employee-workbench__settings-password-actions employee-workbench__settings-password-actions--personal"
      >
        <button
          type="button"
          class="btn btn--primary"
          ?disabled=${settings.pendingSeatOfferBusy}
          @click=${() => void settings.onAcceptPendingSeatOffer(pendingSeatOffer.offerId)}
        >
          ${
            settings.pendingSeatOfferBusy
              ? t("common.loading")
              : t("frontstage.workbench.settings.pendingSeatOffer.accept")
          }
        </button>
        <button
          type="button"
          class="btn"
          ?disabled=${settings.pendingSeatOfferBusy}
          @click=${() => void settings.onDeclinePendingSeatOffer(pendingSeatOffer.offerId)}
        >
          ${t("frontstage.workbench.settings.pendingSeatOffer.decline")}
        </button>
      </div>
      ${
        settings.pendingSeatOfferError
          ? html`
            <div class="callout callout--danger employee-workbench__settings-callout">
              ${settings.pendingSeatOfferError}
            </div>
          `
          : nothing
      }
      ${
        settings.pendingSeatOfferNotice
          ? html`
            <div class="callout employee-workbench__settings-callout">
              ${settings.pendingSeatOfferNotice}
            </div>
          `
          : nothing
      }
    `,
  });
}

function renderPersonalAccountPanel(settings: SettingsContract) {
  const displayName = settings.userProfileName.trim() || "OpenBot";
  const profileNote = settings.userProfileSignature.trim() || "";
  const tenantLabel =
    settings.tenantLabel.trim() || t("frontstage.workbench.settings.localWorkspace");
  const statusLabel = settings.connected ? t("common.ok") : t("common.offline");
  const currentSeatLabel =
    settings.currentSeatTitle?.trim() || t("frontstage.workbench.settings.noSeatBound");
  const currentSeatStatusLabel =
    settings.currentSeatStatusLabel?.trim() || t("frontstage.workbench.settings.seatStatusUnbound");
  const pendingSeatOffer = settings.pendingSeatOffer ?? null;
  const defaultAgentLabel =
    settings.defaultAgentLabel?.trim() ||
    settings.defaultAgentId?.trim() ||
    t("frontstage.workbench.settings.noDefaultAgent");
  const robotTeamLabels = joinDisplayLabels(settings.robotTeamLabels, settings.agentIds);
  const defaultSpaceLabels = joinDisplayLabels(
    settings.defaultSpaceLabels,
    settings.defaultSpaceIds,
  );

  return html`
    <div
      class="employee-workbench__settings-section employee-workbench__settings-section--personal-tab"
    >
      ${renderPersonalTabIntro(t("frontstage.workbench.settings.personalModules.account.title"))}
      <div class="employee-workbench__settings-personal-stack">
        ${renderPersonalPanel({
          title: t("frontstage.workbench.settings.personalModules.account.profile.title"),
          modifier: "employee-workbench__settings-personal-panel--profile",
          content: html`
            <div
              class="employee-workbench__settings-form-grid employee-workbench__settings-form-grid--personal"
            >
              <label class="employee-workbench__settings-field">
                <span class="employee-workbench__settings-field-label">
                  ${t("frontstage.workbench.settings.fields.displayName")}
                </span>
                <span class="employee-workbench__settings-field-control">
                  <input
                    class="employee-workbench__settings-input"
                    type="text"
                    maxlength="60"
                    .value=${displayName}
                    @input=${(event: Event) =>
                      settings.onUserProfileNameChange(
                        (event.currentTarget as HTMLInputElement).value,
                      )}
                  />
                </span>
              </label>
              <label class="employee-workbench__settings-field">
                <span class="employee-workbench__settings-field-label">
                  ${t("frontstage.workbench.settings.fields.profileNote")}
                </span>
                <span class="employee-workbench__settings-field-control">
                  <input
                    class="employee-workbench__settings-input"
                    type="text"
                    maxlength="120"
                    .value=${profileNote}
                    placeholder=${t("frontstage.workbench.settings.profileNotePlaceholder")}
                    @input=${(event: Event) =>
                      settings.onUserProfileSignatureChange(
                        (event.currentTarget as HTMLInputElement).value,
                      )}
                  />
                </span>
              </label>
            </div>
          `,
        })}
        ${renderPersonalPanel({
          title: t("frontstage.workbench.settings.personalModules.account.enterprise.title"),
          modifier: "employee-workbench__settings-personal-panel--enterprise",
          content: renderPersonalMetaList([
            renderSettingsRow(t("frontstage.workbench.settings.fields.tenant"), tenantLabel),
            renderSettingsRow(t("frontstage.workbench.settings.fields.status"), statusLabel),
            renderSettingsRow(
              t("frontstage.workbench.settings.fields.currentSeat"),
              currentSeatLabel,
            ),
            renderSettingsRow(
              t("frontstage.workbench.settings.fields.seatStatus"),
              currentSeatStatusLabel,
            ),
          ]),
        })}
        ${renderPersonalPanel({
          title: t("frontstage.workbench.settings.personalModules.account.resources.title"),
          modifier: "employee-workbench__settings-personal-panel--resources",
          content: renderPersonalMetaList([
            renderSettingsRow(
              t("frontstage.workbench.settings.fields.defaultAgent"),
              defaultAgentLabel,
            ),
            renderSettingsChipRow(
              t("frontstage.workbench.settings.fields.robotTeam"),
              robotTeamLabels,
              t("frontstage.workbench.settings.noDefaultAgent"),
            ),
            renderSettingsChipRow(
              t("frontstage.workbench.settings.fields.defaultSpaces"),
              defaultSpaceLabels,
              t("frontstage.workbench.settings.noDefaultSpaces"),
            ),
          ]),
        })}
        ${pendingSeatOffer ? renderPendingSeatOfferPanel(settings, pendingSeatOffer) : nothing}
      </div>
      ${
        settings.workspaceNotice
          ? html`
            <div class="callout employee-workbench__settings-callout">
              ${settings.workspaceNotice}
            </div>
          `
          : nothing
      }
    </div>
  `;
}

function renderPersonalPreferencesPanel(settings: SettingsContract) {
  const locale = settings.currentLocale ?? "zh-CN";

  return html`
    <div
      class="employee-workbench__settings-section employee-workbench__settings-section--personal-tab"
    >
      ${renderPersonalTabIntro(
        t("frontstage.workbench.settings.personalModules.preferences.title"),
      )}
      <div
        class="employee-workbench__settings-personal-stack employee-workbench__settings-personal-stack--prefs"
      >
        ${renderPersonalPanel({
          title: t(
            "frontstage.workbench.settings.personalModules.preferences.groups.interface.title",
          ),
          modifier: "employee-workbench__settings-personal-panel--prefs-interface",
          content: html`
            ${renderPersonalPreferenceField(
              t("frontstage.workbench.settings.fields.language"),
              renderPersonalSegmentRail([
                {
                  active: settings.currentLocale === "zh-CN",
                  label: "简体中文",
                  onClick: () => settings.onLocaleChange("zh-CN"),
                },
                {
                  active: settings.currentLocale === "en",
                  label: "English",
                  onClick: () => settings.onLocaleChange("en"),
                },
              ]),
            )}
            ${renderPersonalPreferenceField(
              t("frontstage.workbench.settings.fields.theme"),
              renderPersonalSegmentRail([
                {
                  active: settings.currentTheme === "light",
                  label: themeLabel("light", locale),
                  onClick: () => settings.onThemeChange("light"),
                },
                {
                  active: settings.currentTheme === "dark",
                  label: themeLabel("dark", locale),
                  onClick: () => settings.onThemeChange("dark"),
                },
                {
                  active: settings.currentTheme === "system",
                  label: themeLabel("system", locale),
                  onClick: () => settings.onThemeChange("system"),
                },
              ]),
            )}
          `,
        })}
        ${renderPersonalPanel({
          title: t("frontstage.workbench.settings.personalModules.preferences.groups.chat.title"),
          modifier: "employee-workbench__settings-personal-panel--prefs-chat",
          content: html`
            <div
              class="employee-workbench__settings-toggle-group employee-workbench__settings-toggle-group--flat"
            >
              ${renderToggleRow({
                title: t("frontstage.workbench.settings.fields.chatShowThinking"),
                description: t("frontstage.workbench.settings.fieldHints.chatShowThinking"),
                checked: settings.chatShowThinking,
                onToggle: settings.onChatShowThinkingChange,
              })}
              ${renderToggleRow({
                title: t("frontstage.workbench.settings.fields.chatFocusMode"),
                description: t("frontstage.workbench.settings.fieldHints.chatFocusMode"),
                checked: settings.chatFocusMode,
                onToggle: settings.onChatFocusModeChange,
              })}
            </div>
          `,
        })}
        ${renderPersonalPanel({
          title: t("frontstage.workbench.settings.personalModules.preferences.userModeling.title"),
          modifier: "employee-workbench__settings-personal-panel--user-modeling",
          content: html`
            <user-learned-preferences-panel
              .client=${settings.client ?? null}
            ></user-learned-preferences-panel>
          `,
        })}
      </div>
    </div>
  `;
}

function renderPersonalSecurityPanel(settings: SettingsContract) {
  return html`
    <div
      class="employee-workbench__settings-section employee-workbench__settings-section--personal-tab"
    >
      ${renderPersonalTabIntro(t("frontstage.workbench.settings.personalModules.security.title"))}
      ${
        settings.platformAuthEnabled
          ? renderPersonalPanel({
              title: t("frontstage.workbench.settings.personalModules.security.password.title"),
              modifier: "employee-workbench__settings-personal-panel--security",
              content: html`
                <workbench-password-change-section
                  .currentPassword=${settings.passwordCurrentValue}
                  .newPassword=${settings.passwordNewValue}
                  .busy=${settings.passwordChangeBusy}
                  .error=${settings.passwordChangeError}
                  .notice=${settings.passwordChangeNotice}
                  .onCurrentPasswordChange=${settings.onPasswordCurrentChange}
                  .onNewPasswordChange=${settings.onPasswordNewChange}
                  .onSubmit=${settings.onChangePassword}
                  .onForgotPassword=${settings.onOpenForgotPassword}
                ></workbench-password-change-section>
              `,
            })
          : renderPersonalPanel({
              title: t("frontstage.workbench.settings.personalModules.security.password.title"),
              modifier: "employee-workbench__settings-personal-panel--security-unavailable",
              content: html`
                <div class="employee-workbench__settings-personal-empty">
                  ${t("frontstage.workbench.settings.securityPasswordUnavailable")}
                </div>
              `,
            })
      }
      ${renderPersonalPanel({
        title: "隐私与记忆",
        subtitle: "查看机器人记住了什么，并按需忘记。云端托管模式下不可用。",
        modifier: "employee-workbench__settings-personal-panel--privacy-memory",
        content: renderMemoryCenterPanel(settings, settings.memoryCenterPanel ?? {}, {
          embedded: true,
        }),
      })}
    </div>
  `;
}

/** Legacy `memory` deep-links land on Security (privacy & memory). */
function resolvePersonalSettingsTab(
  tab: WorkbenchPersonalSettingsTab | undefined,
): Exclude<WorkbenchPersonalSettingsTab, "memory"> {
  if (!tab || tab === "memory") {
    return tab === "memory" ? "security" : "account";
  }
  return tab;
}

export function renderPersonalSettingsPage(
  settings: SettingsContract,
  _itemTitle: string,
  _subtitle: string,
) {
  const activeTab = resolvePersonalSettingsTab(settings.personalTab);

  return html`
    <section
      class="employee-workbench__module-page employee-workbench__module-page--settings employee-workbench__module-page--personal-settings"
    >
      <div class="employee-workbench__personal-settings-shell">
        <div class="employee-workbench__personal-settings-head">
          <nav
            class="employee-workbench__settings-tabs employee-workbench__personal-settings-tabs"
            role="tablist"
            aria-label=${t("frontstage.workbench.profileMenu.personalSettings")}
          >
            ${renderPersonalSettingsTab(
              "account",
              activeTab,
              t("frontstage.workbench.settings.personalModules.account.tab"),
              settings.onPersonalTabChange,
            )}
            ${renderPersonalSettingsTab(
              "authorization",
              activeTab,
              t("frontstage.workbench.settings.personalModules.authorization.tab"),
              settings.onPersonalTabChange,
            )}
            ${renderPersonalSettingsTab(
              "preferences",
              activeTab,
              t("frontstage.workbench.settings.personalModules.preferences.tab"),
              settings.onPersonalTabChange,
            )}
            ${renderPersonalSettingsTab(
              "security",
              activeTab,
              t("frontstage.workbench.settings.personalModules.security.tab"),
              settings.onPersonalTabChange,
            )}
            ${renderPersonalSettingsTab(
              "devices",
              activeTab,
              t("frontstage.workbench.settings.personalModules.devices.tab"),
              settings.onPersonalTabChange,
            )}
            ${renderPersonalSettingsTab(
              "data",
              activeTab,
              t("frontstage.workbench.settings.personalModules.data.tab"),
              settings.onPersonalTabChange,
            )}
          </nav>
        </div>

        <div
          class="employee-workbench__personal-settings-main"
          role="tabpanel"
          aria-live="polite"
        >
          ${activeTab === "account" ? renderPersonalAccountPanel(settings) : nothing}
          ${activeTab === "authorization" ? renderPersonalAuthorizationPanel(settings) : nothing}
          ${activeTab === "preferences" ? renderPersonalPreferencesPanel(settings) : nothing}
          ${activeTab === "security" ? renderPersonalSecurityPanel(settings) : nothing}
          ${activeTab === "devices" ? renderPersonalDevicesPanel() : nothing}
          ${
            activeTab === "data"
              ? renderDataDirectoryPanel(settings, settings.dataDirectoryPanel ?? {})
              : nothing
          }
        </div>
      </div>
    </section>
  `;
}
