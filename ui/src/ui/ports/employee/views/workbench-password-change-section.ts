import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { t } from "../../../../i18n/index.ts";

const MIN_PASSWORD_LENGTH = 8;

@customElement("workbench-password-change-section")
export class WorkbenchPasswordChangeSection extends LitElement {
  protected createRenderRoot() {
    return this;
  }

  @property({ type: String }) currentPassword = "";
  @property({ type: String }) newPassword = "";
  @property({ type: Boolean }) busy = false;
  @property({ type: String }) error: string | null = null;
  @property({ type: String }) notice: string | null = null;

  @property({ attribute: false })
  onCurrentPasswordChange: ((value: string) => void) | null = null;

  @property({ attribute: false })
  onNewPasswordChange: ((value: string) => void) | null = null;

  @property({ attribute: false })
  onSubmit: (() => void | Promise<void>) | null = null;

  @property({ attribute: false })
  onForgotPassword: (() => void | Promise<void>) | null = null;

  @state() private confirmPassword = "";
  @state() private showCurrentPassword = false;
  @state() private showNewPassword = false;
  @state() private showConfirmPassword = false;
  @state() private validationError: string | null = null;

  private renderPasswordField(params: {
    id: string;
    label: string;
    value: string;
    visible: boolean;
    autocomplete: string;
    onInput: (value: string) => void;
    onToggleVisible: () => void;
  }) {
    return html`
      <label class="employee-workbench__settings-field employee-workbench__settings-field--password">
        <span class="employee-workbench__settings-field-label">${params.label}</span>
        <div class="employee-workbench__settings-password-input-wrap">
          <input
            id=${params.id}
            class="employee-workbench__settings-input employee-workbench__settings-input--password"
            type=${params.visible ? "text" : "password"}
            autocomplete=${params.autocomplete}
            .value=${params.value}
            ?disabled=${this.busy}
            @input=${(event: Event) =>
              params.onInput((event.currentTarget as HTMLInputElement).value)}
          />
          <button
            type="button"
            class="employee-workbench__settings-password-toggle"
            ?disabled=${this.busy}
            aria-label=${
              params.visible
                ? t("frontstage.workbench.settings.personalModules.security.password.hide")
                : t("frontstage.workbench.settings.personalModules.security.password.show")
            }
            @click=${params.onToggleVisible}
          >
            ${
              params.visible
                ? t("frontstage.workbench.settings.personalModules.security.password.hide")
                : t("frontstage.workbench.settings.personalModules.security.password.show")
            }
          </button>
        </div>
      </label>
    `;
  }

  private validate(): string | null {
    if (!this.currentPassword.trim()) {
      return t("frontstage.workbench.settings.personalModules.security.password.currentRequired");
    }
    if (!this.newPassword.trim()) {
      return t("frontstage.workbench.settings.personalModules.security.password.newRequired");
    }
    if (this.newPassword.length < MIN_PASSWORD_LENGTH) {
      return t("frontstage.workbench.settings.personalModules.security.password.tooShort");
    }
    if (this.newPassword !== this.confirmPassword) {
      return t("frontstage.workbench.settings.personalModules.security.password.mismatch");
    }
    if (this.currentPassword === this.newPassword) {
      return t("frontstage.workbench.settings.personalModules.security.password.sameAsCurrent");
    }
    return null;
  }

  private async handleSubmit() {
    const validationError = this.validate();
    this.validationError = validationError;
    if (validationError || !this.onSubmit) {
      return;
    }
    await this.onSubmit();
  }

  render() {
    const blockingError = this.validationError ?? this.error;
    const canSubmit =
      !this.busy &&
      this.currentPassword.trim().length > 0 &&
      this.newPassword.trim().length > 0 &&
      this.confirmPassword.trim().length > 0;

    return html`
      <div class="employee-workbench__settings-password-change">
        <div
          class="employee-workbench__settings-form-grid employee-workbench__settings-form-grid--personal employee-workbench__settings-form-grid--password"
        >
          ${this.renderPasswordField({
            id: "workbench-password-current",
            label: t("overview.platformAuth.fields.currentPassword"),
            value: this.currentPassword,
            visible: this.showCurrentPassword,
            autocomplete: "current-password",
            onInput: (value) => {
              this.validationError = null;
              this.onCurrentPasswordChange?.(value);
            },
            onToggleVisible: () => {
              this.showCurrentPassword = !this.showCurrentPassword;
            },
          })}
          <label
            class="employee-workbench__settings-field employee-workbench__settings-field--password"
            title=${t("frontstage.workbench.settings.personalModules.security.password.requirements")}
          >
            <span class="employee-workbench__settings-field-label">
              ${t("overview.platformAuth.fields.newPassword")}
            </span>
            <div class="employee-workbench__settings-password-input-wrap">
              <input
                id="workbench-password-new"
                class="employee-workbench__settings-input employee-workbench__settings-input--password"
                type=${this.showNewPassword ? "text" : "password"}
                autocomplete="new-password"
                placeholder=${t(
                  "frontstage.workbench.settings.personalModules.security.password.requirements",
                )}
                .value=${this.newPassword}
                ?disabled=${this.busy}
                @input=${(event: Event) => {
                  this.validationError = null;
                  this.onNewPasswordChange?.((event.currentTarget as HTMLInputElement).value);
                }}
              />
              <button
                type="button"
                class="employee-workbench__settings-password-toggle"
                ?disabled=${this.busy}
                aria-label=${
                  this.showNewPassword
                    ? t("frontstage.workbench.settings.personalModules.security.password.hide")
                    : t("frontstage.workbench.settings.personalModules.security.password.show")
                }
                @click=${() => {
                  this.showNewPassword = !this.showNewPassword;
                }}
              >
                ${
                  this.showNewPassword
                    ? t("frontstage.workbench.settings.personalModules.security.password.hide")
                    : t("frontstage.workbench.settings.personalModules.security.password.show")
                }
              </button>
            </div>
          </label>
          ${this.renderPasswordField({
            id: "workbench-password-confirm",
            label: t("frontstage.workbench.settings.personalModules.security.password.confirm"),
            value: this.confirmPassword,
            visible: this.showConfirmPassword,
            autocomplete: "new-password",
            onInput: (value) => {
              this.validationError = null;
              this.confirmPassword = value;
            },
            onToggleVisible: () => {
              this.showConfirmPassword = !this.showConfirmPassword;
            },
          })}
        </div>
        <div class="employee-workbench__settings-password-actions employee-workbench__settings-password-actions--personal">
          <button
            type="button"
            class="btn btn--primary"
            ?disabled=${!canSubmit}
            @click=${() => void this.handleSubmit()}
          >
            ${this.busy ? t("common.loading") : t("overview.platformAuth.passwordChangeSubmit")}
          </button>
          ${
            this.onForgotPassword
              ? html`
                <button
                  type="button"
                  class="btn btn--ghost employee-workbench__settings-password-forgot"
                  ?disabled=${this.busy}
                  @click=${() => void this.onForgotPassword?.()}
                >
                  ${t("authHome.authLinks.forgotPassword")}
                </button>
              `
              : nothing
          }
        </div>
        ${
          blockingError
            ? html`
              <div class="callout callout--danger employee-workbench__settings-callout">
                ${blockingError}
              </div>
            `
            : nothing
        }
        ${
          this.notice
            ? html`
              <div class="callout employee-workbench__settings-callout">${this.notice}</div>
            `
            : nothing
        }
      </div>
    `;
  }
}
