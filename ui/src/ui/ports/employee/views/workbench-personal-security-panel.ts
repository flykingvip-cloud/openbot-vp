import { html } from "lit";
import { t } from "../../../../i18n/index.ts";
import {
  renderPersonalPanel,
  renderPersonalSettingsSection,
  renderPersonalTabIntro,
} from "./workbench-personal-settings-layout.ts";
import type { SettingsContract } from "./workbench-stage-contracts.ts";
import "./workbench-password-change-section.ts";

export function renderPersonalSecurityPanel(settings: SettingsContract) {
  return renderPersonalSettingsSection(html`
    ${renderPersonalTabIntro(
      t("frontstage.workbench.settings.personalModules.security.title"),
      t("frontstage.workbench.settings.personalModules.security.subtitle"),
    )}
    ${
      settings.platformAuthEnabled
        ? renderPersonalPanel({
            title: t("frontstage.workbench.settings.personalModules.security.password.title"),
            subtitle: t("frontstage.workbench.settings.personalModules.security.password.subtitle"),
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
            subtitle: t("frontstage.workbench.settings.personalModules.security.password.subtitle"),
            modifier: "employee-workbench__settings-personal-panel--security-unavailable",
            content: html`
              <div class="employee-workbench__settings-personal-empty">
                ${t("frontstage.workbench.settings.securityPasswordUnavailable")}
              </div>
            `,
          })
    }
  `);
}
