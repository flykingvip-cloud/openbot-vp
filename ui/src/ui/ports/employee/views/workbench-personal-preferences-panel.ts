import { html } from "lit";
import { t } from "../../../../i18n/index.ts";
import "../../../capability/user-modeling/user-learned-preferences-panel.ts";
import "../../../capability/seat-exec-preference/seat-exec-preference-panel.ts";
import "../../../capability/seat-ai-rules/seat-ai-rules-panel.ts";
import "../../../capability/seat-exec-preference/seat-drill-panel.ts";
import {
  personalThemeLabel,
  renderPersonalPanel,
  renderPersonalPreferenceField,
  renderPersonalSegmentRail,
  renderPersonalSettingsSection,
  renderPersonalTabIntro,
  renderPersonalToggleRow,
} from "./workbench-personal-settings-layout.ts";
import type { SettingsContract } from "./workbench-stage-contracts.ts";

export function renderPersonalPreferencesPanel(settings: SettingsContract) {
  const locale = settings.currentLocale ?? "zh-CN";
  const currentThemeLabel = personalThemeLabel(settings.currentTheme ?? "system", locale);

  return renderPersonalSettingsSection(html`
    ${renderPersonalTabIntro(
      t("frontstage.workbench.settings.personalModules.preferences.title"),
      t("frontstage.workbench.settings.personalModules.preferences.subtitle"),
    )}
    <div class="employee-workbench__settings-personal-stack">
      ${renderPersonalPanel({
        title: t(
          "frontstage.workbench.settings.personalModules.preferences.groups.interface.title",
        ),
        subtitle: t(
          "frontstage.workbench.settings.personalModules.preferences.groups.interface.subtitle",
        ),
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
                label: personalThemeLabel("light", locale),
                onClick: () => settings.onThemeChange("light"),
              },
              {
                active: settings.currentTheme === "dark",
                label: personalThemeLabel("dark", locale),
                onClick: () => settings.onThemeChange("dark"),
              },
              {
                active: settings.currentTheme === "system",
                label: currentThemeLabel,
                onClick: () => settings.onThemeChange("system"),
              },
            ]),
          )}
        `,
      })}
      ${renderPersonalPanel({
        title: t("frontstage.workbench.settings.personalModules.preferences.groups.chat.title"),
        subtitle: t(
          "frontstage.workbench.settings.personalModules.preferences.groups.chat.subtitle",
        ),
        content: html`
          <div
            class="employee-workbench__settings-toggle-group employee-workbench__settings-toggle-group--flat"
          >
            ${renderPersonalToggleRow({
              title: t("frontstage.workbench.settings.fields.chatShowThinking"),
              description: t("frontstage.workbench.settings.fieldHints.chatShowThinking"),
              checked: settings.chatShowThinking,
              onToggle: settings.onChatShowThinkingChange,
            })}
            ${renderPersonalToggleRow({
              title: t("frontstage.workbench.settings.fields.chatFocusMode"),
              description: t("frontstage.workbench.settings.fieldHints.chatFocusMode"),
              checked: settings.chatFocusMode,
              onToggle: settings.onChatFocusModeChange,
            })}
          </div>
        `,
      })}
      ${renderPersonalPanel({
        title: t("execApprovalsPage.ask.title"),
        subtitle: "在企业执行天花板内收紧询问与安全级别（不能放宽，不能改执行位置）。",
        modifier: "employee-workbench__settings-personal-panel--seat-exec",
        content: html`
          <seat-exec-preference-panel
            .client=${settings.client ?? null}
          ></seat-exec-preference-panel>
        `,
      })}
      ${renderPersonalPanel({
        title: "席位 AI 规则",
        subtitle:
          "本席位绑定机器人的短规则（最多 8 条 / 单条 500 / 合计 2000）；只作指导，不放宽审批。",
        modifier: "employee-workbench__settings-personal-panel--seat-ai-rules",
        content: html`
          <seat-ai-rules-panel .client=${settings.client ?? null}></seat-ai-rules-panel>
        `,
      })}
      ${renderPersonalPanel({
        title: "策略演练",
        subtitle:
          "只裁决、不执行：查看允许/拒绝/收紧与是否构成放宽；用同一天花板估算若真执行是否要审批（不弹审批、不作预授权）。",
        modifier: "employee-workbench__settings-personal-panel--seat-drill",
        content: html`
          <seat-drill-panel .client=${settings.client ?? null}></seat-drill-panel>
        `,
      })}
      ${renderPersonalPanel({
        title: t("frontstage.workbench.settings.personalModules.preferences.userModeling.title"),
        subtitle: t(
          "frontstage.workbench.settings.personalModules.preferences.userModeling.subtitle",
        ),
        modifier: "employee-workbench__settings-personal-panel--user-modeling",
        content: html`
          <user-learned-preferences-panel
            .client=${settings.client ?? null}
          ></user-learned-preferences-panel>
        `,
      })}
    </div>
  `);
}
