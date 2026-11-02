import { html, nothing } from "lit";
import type {
  ControlUiPlatformAuthMode,
  ControlUiPlatformAuthState,
  ControlUiPlatformTenantCreationMode,
  ControlUiTrustedProxySession,
} from "../../../../src/gateway/control-ui-contract.js";
import {
  ADMIN_SCOPE,
  APPROVALS_SCOPE,
  PAIRING_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
} from "../../../../src/gateway/method-scopes.js";
import { t } from "../../i18n/index.ts";
import { pathForTab } from "../navigation.ts";

export type PlatformAuthPanelProps = {
  basePath?: string;
  state: ControlUiPlatformAuthState | null;
  session: ControlUiTrustedProxySession | null;
  mode: ControlUiPlatformAuthMode;
  busy: boolean;
  error: string | null;
  notice: string | null;
  email: string;
  password: string;
  displayName: string;
  platformAdminDisplayName: string;
  tenantName: string;
  seatTitle: string;
  inviteCode: string;
  currentPassword: string;
  newPassword: string;
  policyTrialDays: string;
  policySeatCount: string;
  policyUpgradeUrl: string;
  policyContactAdvisorUrl: string;
  instanceEnterpriseId: string;
  instanceTrialDays: string;
  instanceSeatCount: string;
  instanceUpgradeUrl: string;
  instanceContactAdvisorUrl: string;
  platformAdminEmail: string;
  platformAdminPassword: string;
  platformAdminScopes: string[];
  creationMode?: ControlUiPlatformTenantCreationMode;
  compact?: boolean;
  onModeChange: (mode: ControlUiPlatformAuthMode) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onPlatformAdminDisplayNameChange: (value: string) => void;
  onTenantNameChange: (value: string) => void;
  onSeatTitleChange: (value: string) => void;
  onInviteCodeChange: (value: string) => void;
  onCurrentPasswordChange: (value: string) => void;
  onNewPasswordChange: (value: string) => void;
  onPolicyTrialDaysChange: (value: string) => void;
  onPolicySeatCountChange: (value: string) => void;
  onPolicyUpgradeUrlChange: (value: string) => void;
  onPolicyContactAdvisorUrlChange: (value: string) => void;
  onInstanceEnterpriseIdChange: (value: string) => void;
  onInstanceTrialDaysChange: (value: string) => void;
  onInstanceSeatCountChange: (value: string) => void;
  onInstanceUpgradeUrlChange: (value: string) => void;
  onInstanceContactAdvisorUrlChange: (value: string) => void;
  onPlatformAdminEmailChange: (value: string) => void;
  onPlatformAdminPasswordChange: (value: string) => void;
  onPlatformAdminScopesChange: (value: string[]) => void;
  onCreationModeChange?: (value: ControlUiPlatformTenantCreationMode) => void;
  onSubmit: () => void;
  onCreatePlatformAdmin?: () => void;
  onRemovePlatformAdmin?: (user: string) => void;
  onLogout?: () => void;
  onSetMfaPolicy?: (requireMfa: boolean) => void;
  onCreateInvite?: () => void;
  onRevokeInvite?: (code: string) => void;
  onRemoveMember?: (user: string) => void;
  onChangePassword?: () => void;
  onUpdateTrialPolicy?: () => void;
  onUpdateTrialInstance?: () => void;
};

function shouldProceed(message: string): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return true;
  }
  return window.confirm(message);
}

function modeLabel(mode: ControlUiPlatformAuthMode): string {
  switch (mode) {
    case "platform-bootstrap":
      return t("overview.platformAuth.modes.platformBootstrap.tab");
    case "platform-super-admin-login":
      return t("overview.platformAuth.modes.platformSuperAdminLogin.tab");
    case "platform-admin-login":
      return t("overview.platformAuth.modes.platformAdminLogin.tab");
    case "enterprise-create":
      return t("overview.platformAuth.modes.enterpriseCreate.tab");
    case "employee-register":
      return t("overview.platformAuth.modes.employeeRegister.tab");
    case "enterprise-activate":
      return t("overview.platformAuth.modes.enterpriseActivate.tab");
    case "login":
      return t("overview.platformAuth.modes.login.tab");
    case "forgot-password":
      return t("overview.platformAuth.modes.forgotPassword.tab");
    case "password-reset":
      return t("overview.platformAuth.modes.passwordReset.tab");
    case "platform-enterprise-create":
      return t("overview.platformAuth.modes.platformEnterpriseCreate.tab");
    default:
      return mode;
  }
}

function modeTitle(mode: ControlUiPlatformAuthMode): string {
  switch (mode) {
    case "platform-bootstrap":
      return t("overview.platformAuth.modes.platformBootstrap.title");
    case "platform-super-admin-login":
      return t("overview.platformAuth.modes.platformSuperAdminLogin.title");
    case "platform-admin-login":
      return t("overview.platformAuth.modes.platformAdminLogin.title");
    case "enterprise-create":
      return t("overview.platformAuth.modes.enterpriseCreate.title");
    case "employee-register":
      return t("overview.platformAuth.modes.employeeRegister.title");
    case "enterprise-activate":
      return t("overview.platformAuth.modes.enterpriseActivate.title");
    case "login":
      return t("overview.platformAuth.modes.login.title");
    case "forgot-password":
      return t("overview.platformAuth.modes.forgotPassword.title");
    case "password-reset":
      return t("overview.platformAuth.modes.passwordReset.title");
    case "platform-enterprise-create":
      return t("overview.platformAuth.modes.platformEnterpriseCreate.title");
    default:
      return "";
  }
}

function modeSubtitle(mode: ControlUiPlatformAuthMode): string {
  switch (mode) {
    case "platform-bootstrap":
      return t("overview.platformAuth.modes.platformBootstrap.subtitle");
    case "platform-super-admin-login":
      return t("overview.platformAuth.modes.platformSuperAdminLogin.subtitle");
    case "platform-admin-login":
      return t("overview.platformAuth.modes.platformAdminLogin.subtitle");
    case "enterprise-create":
      return t("overview.platformAuth.modes.enterpriseCreate.subtitle");
    case "employee-register":
      return t("overview.platformAuth.modes.employeeRegister.subtitle");
    case "enterprise-activate":
      return t("overview.platformAuth.modes.enterpriseActivate.subtitle");
    case "login":
      return t("overview.platformAuth.modes.login.subtitle");
    case "forgot-password":
      return t("overview.platformAuth.modes.forgotPassword.subtitle");
    case "password-reset":
      return t("overview.platformAuth.modes.passwordReset.subtitle");
    case "platform-enterprise-create":
      return t("overview.platformAuth.modes.platformEnterpriseCreate.subtitle");
    default:
      return "";
  }
}

function submitLabel(mode: ControlUiPlatformAuthMode, busy: boolean): string {
  if (busy) {
    return t("overview.platformAuth.submitting");
  }
  switch (mode) {
    case "platform-bootstrap":
      return t("overview.platformAuth.modes.platformBootstrap.submit");
    case "platform-super-admin-login":
      return t("overview.platformAuth.modes.platformSuperAdminLogin.submit");
    case "platform-admin-login":
      return t("overview.platformAuth.modes.platformAdminLogin.submit");
    case "enterprise-create":
      return t("overview.platformAuth.modes.enterpriseCreate.submit");
    case "employee-register":
      return t("overview.platformAuth.modes.employeeRegister.submit");
    case "enterprise-activate":
      return t("overview.platformAuth.modes.enterpriseActivate.submit");
    case "login":
      return t("overview.platformAuth.modes.login.submit");
    case "forgot-password":
      return t("overview.platformAuth.modes.forgotPassword.submit");
    case "password-reset":
      return t("overview.platformAuth.modes.passwordReset.submit");
    case "platform-enterprise-create":
      return t("overview.platformAuth.modes.platformEnterpriseCreate.submit");
    default:
      return t("overview.platformAuth.submitting");
  }
}

function renderPendingCodes(state: ControlUiPlatformAuthState) {
  const entries = [state.pendingActivation, state.pendingPasswordReset].filter(Boolean);
  if (entries.length === 0) {
    return nothing;
  }
  return html`
    <div style="display:grid; gap:10px; margin-top: 12px;">
      ${entries.map(
        (entry) => html`
          <div class="callout success" style="margin:0;">
            <div><strong>${t(`overview.platformAuth.pending.${entry!.kind}.title`)}</strong></div>
            ${
              entry?.enterpriseName
                ? html`<div style="margin-top: 6px;">${entry.enterpriseName}</div>`
                : nothing
            }
            <div class="muted" style="margin-top: 6px;">${entry?.email}</div>
            <div style="margin-top: 8px;">
              <span class="mono">${entry?.code}</span>
            </div>
            <div class="muted" style="margin-top: 6px;">
              ${t("overview.platformAuth.pending.expiresAt", { time: entry?.expiresAt ?? "" })}
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderModeSwitcher(
  availableModes: ControlUiPlatformAuthMode[],
  activeMode: ControlUiPlatformAuthMode,
  busy: boolean,
  onModeChange: (mode: ControlUiPlatformAuthMode) => void,
) {
  if (availableModes.length <= 1) {
    return nothing;
  }
  return html`
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top: 14px;">
      ${availableModes.map(
        (mode) => html`
          <button
            class="btn ${mode === activeMode ? "btn--primary" : ""}"
            type="button"
            ?disabled=${busy}
            @click=${() => onModeChange(mode)}
          >
            ${modeLabel(mode)}
          </button>
        `,
      )}
    </div>
  `;
}

function renderField(params: {
  label: string;
  value: string;
  type?: "email" | "password" | "text";
  autocomplete?: string;
  disabled: boolean;
  onInput: (value: string) => void;
}) {
  return html`
    <label class="field">
      <span>${params.label}</span>
      <input
        .value=${params.value}
        type=${params.type ?? "text"}
        autocomplete=${params.autocomplete ?? "off"}
        ?disabled=${params.disabled}
        @input=${(event: Event) => params.onInput((event.target as HTMLInputElement).value)}
      />
    </label>
  `;
}

function renderModeFields(props: PlatformAuthPanelProps, mode: ControlUiPlatformAuthMode) {
  switch (mode) {
    case "platform-bootstrap":
      return html`
        ${renderField({
          label: t("overview.platformAuth.fields.displayName"),
          value: props.displayName,
          disabled: props.busy,
          autocomplete: "name",
          onInput: props.onDisplayNameChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.email"),
          value: props.email,
          type: "email",
          autocomplete: "username",
          disabled: props.busy,
          onInput: props.onEmailChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.password"),
          value: props.password,
          type: "password",
          autocomplete: "new-password",
          disabled: props.busy,
          onInput: props.onPasswordChange,
        })}
      `;
    case "enterprise-create":
      return html`
        ${renderField({
          label: t("overview.platformAuth.fields.enterpriseName"),
          value: props.tenantName,
          disabled: props.busy,
          autocomplete: "organization",
          onInput: props.onTenantNameChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.fields.adminName"),
          value: props.displayName,
          disabled: props.busy,
          autocomplete: "name",
          onInput: props.onDisplayNameChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.fields.adminEmail"),
          value: props.email,
          type: "email",
          autocomplete: "username",
          disabled: props.busy,
          onInput: props.onEmailChange,
        })}
      `;
    case "platform-enterprise-create":
      return html`
        ${renderField({
          label: t("overview.platformAuth.fields.enterpriseName"),
          value: props.tenantName,
          disabled: props.busy,
          autocomplete: "organization",
          onInput: props.onTenantNameChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.fields.adminName"),
          value: props.displayName,
          disabled: props.busy,
          autocomplete: "name",
          onInput: props.onDisplayNameChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.fields.adminEmail"),
          value: props.email,
          type: "email",
          autocomplete: "username",
          disabled: props.busy,
          onInput: props.onEmailChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.platform.instanceTrialDays"),
          value: props.instanceTrialDays,
          disabled: props.busy,
          onInput: props.onInstanceTrialDaysChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.platform.instanceSeatCount"),
          value: props.instanceSeatCount,
          disabled: props.busy,
          onInput: props.onInstanceSeatCountChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.platform.upgradeUrl"),
          value: props.instanceUpgradeUrl,
          disabled: props.busy,
          onInput: props.onInstanceUpgradeUrlChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.platform.contactAdvisorUrl"),
          value: props.instanceContactAdvisorUrl,
          disabled: props.busy,
          onInput: props.onInstanceContactAdvisorUrlChange,
        })}
      `;
    case "employee-register":
      return html`
        ${renderField({
          label: t("overview.platformAuth.employee.name"),
          value: props.displayName,
          disabled: props.busy,
          autocomplete: "name",
          onInput: props.onDisplayNameChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.employee.email"),
          value: props.email,
          type: "email",
          autocomplete: "username",
          disabled: props.busy,
          onInput: props.onEmailChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.fields.code"),
          value: props.inviteCode,
          disabled: props.busy,
          onInput: props.onInviteCodeChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.password"),
          value: props.password,
          type: "password",
          autocomplete: "new-password",
          disabled: props.busy,
          onInput: props.onPasswordChange,
        })}
      `;
    case "enterprise-activate":
      return html`
        ${renderField({
          label: t("overview.platformAuth.email"),
          value: props.email,
          type: "email",
          autocomplete: "username",
          disabled: props.busy,
          onInput: props.onEmailChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.fields.displayName"),
          value: props.displayName,
          disabled: props.busy,
          autocomplete: "name",
          onInput: props.onDisplayNameChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.fields.code"),
          value: props.inviteCode,
          disabled: props.busy,
          onInput: props.onInviteCodeChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.password"),
          value: props.password,
          type: "password",
          autocomplete: "new-password",
          disabled: props.busy,
          onInput: props.onPasswordChange,
        })}
      `;
    case "login":
    case "platform-super-admin-login":
    case "platform-admin-login":
      return html`
        ${renderField({
          label: t("overview.platformAuth.email"),
          value: props.email,
          type: "email",
          autocomplete: "username",
          disabled: props.busy,
          onInput: props.onEmailChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.password"),
          value: props.password,
          type: "password",
          autocomplete: "current-password",
          disabled: props.busy,
          onInput: props.onPasswordChange,
        })}
      `;
    case "forgot-password":
      return html`
        ${renderField({
          label: t("overview.platformAuth.email"),
          value: props.email,
          type: "email",
          autocomplete: "username",
          disabled: props.busy,
          onInput: props.onEmailChange,
        })}
      `;
    case "password-reset":
      return html`
        ${renderField({
          label: t("overview.platformAuth.email"),
          value: props.email,
          type: "email",
          autocomplete: "username",
          disabled: props.busy,
          onInput: props.onEmailChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.fields.code"),
          value: props.inviteCode,
          disabled: props.busy,
          onInput: props.onInviteCodeChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.fields.newPassword"),
          value: props.password,
          type: "password",
          autocomplete: "new-password",
          disabled: props.busy,
          onInput: props.onPasswordChange,
        })}
      `;
    default:
      return nothing;
  }
}

function isSubmitDisabled(props: PlatformAuthPanelProps, mode: ControlUiPlatformAuthMode): boolean {
  if (props.busy) {
    return true;
  }
  switch (mode) {
    case "platform-bootstrap":
      return !props.displayName.trim() || !props.email.trim() || !props.password.trim();
    case "enterprise-create":
    case "platform-enterprise-create":
      return !props.tenantName.trim() || !props.displayName.trim() || !props.email.trim();
    case "employee-register":
      return (
        !props.displayName.trim() ||
        !props.email.trim() ||
        !props.inviteCode.trim() ||
        !props.password.trim()
      );
    case "enterprise-activate":
      return !props.email.trim() || !props.inviteCode.trim() || !props.password.trim();
    case "login":
    case "platform-super-admin-login":
    case "platform-admin-login":
      return !props.email.trim() || !props.password.trim();
    case "forgot-password":
      return !props.email.trim();
    case "password-reset":
      return !props.email.trim() || !props.inviteCode.trim() || !props.password.trim();
    default:
      return true;
  }
}

function renderEnterpriseSummary(state: ControlUiPlatformAuthState) {
  if (!state.enterprise) {
    return nothing;
  }
  return html`
    <div class="callout" style="margin-top: 10px;">
      <div><strong>${state.enterprise.name}</strong></div>
      <div class="muted" style="margin-top: 6px;">
        ${t("overview.platformAuth.enterprise.status", {
          status: state.enterprise.status,
          seats: `${state.enterprise.seatUsed}/${state.enterprise.seatQuota}`,
        })}
      </div>
      ${
        state.enterprise.trialEndsAt
          ? html`
              <div class="muted" style="margin-top: 6px;">
                ${t("overview.platformAuth.enterprise.trialEndsAt", {
                  time: state.enterprise.trialEndsAt,
                })}
              </div>
            `
          : nothing
      }
      ${
        state.enterprise.upgradeUrl || state.enterprise.contactAdvisorUrl
          ? html`
              <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top: 10px;">
                ${
                  state.enterprise.upgradeUrl
                    ? html`
                        <a class="btn btn--sm" href=${state.enterprise.upgradeUrl} target="_blank" rel="noreferrer">
                          ${t("overview.platformAuth.enterprise.upgrade")}
                        </a>
                      `
                    : nothing
                }
                ${
                  state.enterprise.contactAdvisorUrl
                    ? html`
                        <a class="btn btn--sm" href=${state.enterprise.contactAdvisorUrl} target="_blank" rel="noreferrer">
                          ${t("overview.platformAuth.enterprise.contactAdvisor")}
                        </a>
                      `
                    : nothing
                }
              </div>
            `
          : nothing
      }
    </div>
  `;
}

function platformEnterpriseAttentionReason(
  enterprise: NonNullable<ControlUiPlatformAuthState["platformEnterprises"]>[number],
): string | null {
  if (enterprise.status === "expired") {
    return t("overview.platformAuth.platform.attentionExpired");
  }
  if (enterprise.status === "suspended") {
    return t("overview.platformAuth.platform.attentionSuspended");
  }
  if (enterprise.status === "trial" && enterprise.seatUsed >= enterprise.seatQuota) {
    return t("overview.platformAuth.platform.attentionSeatLimit");
  }
  return null;
}

function applyPlatformInstancePreset(
  props: PlatformAuthPanelProps,
  enterprise: NonNullable<ControlUiPlatformAuthState["platformEnterprises"]>[number],
  overrides?: {
    trialDays?: string;
    seatCount?: string;
  },
) {
  props.onInstanceEnterpriseIdChange(enterprise.id);
  props.onInstanceTrialDaysChange(
    overrides?.trialDays ??
      (enterprise.trialDaysSnapshot ? String(enterprise.trialDaysSnapshot) : ""),
  );
  props.onInstanceSeatCountChange(overrides?.seatCount ?? String(enterprise.seatQuota));
  props.onInstanceUpgradeUrlChange(enterprise.upgradeUrl ?? "");
  props.onInstanceContactAdvisorUrlChange(enterprise.contactAdvisorUrl ?? "");
}

function recommendedExpiredTrialDays(
  props: PlatformAuthPanelProps,
  enterprise: NonNullable<ControlUiPlatformAuthState["platformEnterprises"]>[number],
): string {
  return String(
    enterprise.trialDaysSnapshot ?? props.state?.platformPolicy?.defaultTrialDays ?? "",
  );
}

function recommendedExpandedSeatCount(
  enterprise: NonNullable<ControlUiPlatformAuthState["platformEnterprises"]>[number],
): string {
  return String(Math.max(enterprise.seatQuota + 1, enterprise.seatUsed + 1));
}

function buildEmployeeRegisterHref(props: PlatformAuthPanelProps): string | null {
  const code = props.inviteCode.trim();
  if (!code) {
    return null;
  }
  const homePath = pathForTab("me", props.basePath ?? "");
  const url =
    typeof window === "undefined"
      ? new URL(`https://openbot.local${homePath}`)
      : new URL(homePath, window.location.origin);
  url.searchParams.set("authMode", "employee-register");
  if (props.displayName.trim()) {
    url.searchParams.set("name", props.displayName.trim());
  }
  if (props.email.trim()) {
    url.searchParams.set("email", props.email.trim());
  }
  url.searchParams.set("code", code);
  url.hash = "auth";
  return `${url.pathname}${url.search}${url.hash}`;
}

function renderPlatformEnterpriseCard(
  props: PlatformAuthPanelProps,
  enterprise: NonNullable<ControlUiPlatformAuthState["platformEnterprises"]>[number],
) {
  const attentionReason = platformEnterpriseAttentionReason(enterprise);
  const isSelected = props.instanceEnterpriseId.trim() === enterprise.id;
  return html`
    <div
      class="callout"
      style=${
        isSelected
          ? "margin:0; border-color: rgba(37, 99, 235, 0.5); box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.25);"
          : "margin:0;"
      }
    >
      <div>
        ${enterprise.name}
        ${
          isSelected
            ? html`<span class="muted" style="margin-left: 8px;">${t("overview.platformAuth.platform.selectedBadge")}</span>`
            : nothing
        }
      </div>
      <div class="muted" style="margin-top: 4px;">
        ${enterprise.status} · ${enterprise.seatUsed}/${enterprise.seatQuota}
      </div>
      ${
        attentionReason
          ? html`
              <div style="margin-top: 4px;">
                <strong>${attentionReason}</strong>
              </div>
            `
          : nothing
      }
      ${
        enterprise.trialEndsAt
          ? html`
              <div class="muted" style="margin-top: 4px;">
                ${t("overview.platformAuth.enterprise.trialEndsAt", {
                  time: enterprise.trialEndsAt,
                })}
              </div>
            `
          : nothing
      }
      <div class="muted" style="margin-top: 4px;">
        <span class="mono">${enterprise.id}</span>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top: 8px;">
        <button
          class="btn btn--sm"
          type="button"
          ?disabled=${props.busy}
          @click=${() => {
            applyPlatformInstancePreset(props, enterprise);
          }}
        >
          ${t("overview.platformAuth.platform.prefillInstance")}
        </button>
        ${
          enterprise.status === "expired"
            ? html`
                <button
                  class="btn btn--sm btn--primary"
                  type="button"
                  ?disabled=${props.busy}
                  @click=${() => {
                    applyPlatformInstancePreset(props, enterprise, {
                      trialDays: recommendedExpiredTrialDays(props, enterprise),
                    });
                  }}
                >
                  ${t("overview.platformAuth.platform.quickRestoreTrial")}
                </button>
              `
            : nothing
        }
        ${
          enterprise.status === "trial" && enterprise.seatUsed >= enterprise.seatQuota
            ? html`
                <button
                  class="btn btn--sm btn--primary"
                  type="button"
                  ?disabled=${props.busy}
                  @click=${() => {
                    applyPlatformInstancePreset(props, enterprise, {
                      seatCount: recommendedExpandedSeatCount(enterprise),
                    });
                  }}
                >
                  ${t("overview.platformAuth.platform.quickIncreaseSeats")}
                </button>
              `
            : nothing
        }
      </div>
    </div>
  `;
}

function renderPlatformSummary(props: PlatformAuthPanelProps) {
  const state = props.state;
  if (!state?.canManagePlatform) {
    return nothing;
  }
  const enterprises = state.platformEnterprises ?? [];
  const attentionEnterprises = enterprises.filter((enterprise) =>
    Boolean(platformEnterpriseAttentionReason(enterprise)),
  );
  return html`
    <div class="callout" style="margin-top: 10px;">
      <div><strong>${t("overview.platformAuth.platform.title")}</strong></div>
      ${
        state.platformPolicy
          ? html`
              <div class="muted" style="margin-top: 6px;">
                ${t("overview.platformAuth.platform.policy", {
                  days: String(state.platformPolicy.defaultTrialDays),
                  seats: String(state.platformPolicy.defaultTrialSeatCount),
                })}
              </div>
            `
          : nothing
      }
      ${
        enterprises.length > 0
          ? html`
              ${
                attentionEnterprises.length > 0
                  ? html`
                      <div style="margin-top: 10px;">
                        <strong>${t("overview.platformAuth.platform.attentionTitle")}</strong>
                      </div>
                      <div style="margin-top: 8px; display:grid; gap:8px;">
                        ${attentionEnterprises.map((enterprise) =>
                          renderPlatformEnterpriseCard(props, enterprise),
                        )}
                      </div>
                    `
                  : html`
                      <div class="muted" style="margin-top: 10px;">
                        ${t("overview.platformAuth.platform.attentionEmpty")}
                      </div>
                    `
              }
              <div style="margin-top: 10px;">
                <strong>${t("overview.platformAuth.platform.allTitle")}</strong>
              </div>
              <div style="margin-top: 8px; display:grid; gap:8px;">
                ${enterprises.map((enterprise) => renderPlatformEnterpriseCard(props, enterprise))}
              </div>
            `
          : html`<div class="muted" style="margin-top: 8px;">${t("overview.platformAuth.platform.noEnterprises")}</div>`
      }
      ${
        props.mode !== "platform-enterprise-create"
          ? html`
              <div style="margin-top: 10px;">
                <button
                  class="btn"
                  type="button"
                  ?disabled=${props.busy}
                  @click=${() => props.onModeChange("platform-enterprise-create")}
                >
                  ${t("overview.platformAuth.modes.platformEnterpriseCreate.submit")}
                </button>
              </div>
            `
          : nothing
      }
    </div>
  `;
}

function renderPasswordChangeSection(props: PlatformAuthPanelProps) {
  if (!props.session || !props.onChangePassword) {
    return nothing;
  }
  return html`
    <div class="callout" style="margin-top: 10px;">
      <div><strong>${t("overview.platformAuth.passwordChangeTitle")}</strong></div>
      <div class="form-grid" style="margin-top: 12px;">
        ${renderField({
          label: t("overview.platformAuth.fields.currentPassword"),
          value: props.currentPassword,
          type: "password",
          autocomplete: "current-password",
          disabled: props.busy,
          onInput: props.onCurrentPasswordChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.fields.newPassword"),
          value: props.newPassword,
          type: "password",
          autocomplete: "new-password",
          disabled: props.busy,
          onInput: props.onNewPasswordChange,
        })}
      </div>
      <div style="margin-top: 10px;">
        <button
          class="btn btn--sm"
          type="button"
          ?disabled=${props.busy || !props.currentPassword.trim() || !props.newPassword.trim()}
          @click=${props.onChangePassword}
        >
          ${t("overview.platformAuth.passwordChangeSubmit")}
        </button>
      </div>
    </div>
  `;
}

function renderPlatformPolicySection(props: PlatformAuthPanelProps) {
  const state = props.state;
  if (!state?.canManagePlatform || !props.onUpdateTrialPolicy) {
    return nothing;
  }
  const policy = state.platformPolicy;
  return html`
    <div class="callout" style="margin-top: 10px;">
      <div><strong>${t("overview.platformAuth.platform.policyEditorTitle")}</strong></div>
      <div class="form-grid" style="margin-top: 12px;">
        ${renderField({
          label: t("overview.platformAuth.platform.defaultTrialDays"),
          value: props.policyTrialDays || String(policy?.defaultTrialDays ?? ""),
          disabled: props.busy,
          onInput: props.onPolicyTrialDaysChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.platform.defaultSeatCount"),
          value: props.policySeatCount || String(policy?.defaultTrialSeatCount ?? ""),
          disabled: props.busy,
          onInput: props.onPolicySeatCountChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.platform.upgradeUrl"),
          value: props.policyUpgradeUrl || policy?.upgradeUrl || "",
          disabled: props.busy,
          onInput: props.onPolicyUpgradeUrlChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.platform.contactAdvisorUrl"),
          value: props.policyContactAdvisorUrl || policy?.contactAdvisorUrl || "",
          disabled: props.busy,
          onInput: props.onPolicyContactAdvisorUrlChange,
        })}
      </div>
      <div style="margin-top: 10px;">
        <button class="btn btn--sm" type="button" ?disabled=${props.busy} @click=${props.onUpdateTrialPolicy}>
          ${t("overview.platformAuth.platform.policyEditorSubmit")}
        </button>
      </div>
    </div>
  `;
}

function renderPlatformInstanceSection(props: PlatformAuthPanelProps) {
  const state = props.state;
  if (!state?.canManagePlatform || !props.onUpdateTrialInstance) {
    return nothing;
  }
  const selectedEnterprise =
    state.platformEnterprises?.find(
      (enterprise) => enterprise.id === props.instanceEnterpriseId.trim(),
    ) ?? null;
  return html`
    <div class="callout" style="margin-top: 10px;">
      <div><strong>${t("overview.platformAuth.platform.instanceEditorTitle")}</strong></div>
      ${
        selectedEnterprise
          ? html`
              <div class="callout" style="margin-top: 10px; margin-bottom: 0;">
                <div>
                  <strong>${selectedEnterprise.name}</strong>
                  <span class="muted" style="margin-left: 8px;">${t("overview.platformAuth.platform.selectedBadge")}</span>
                </div>
                <div class="muted" style="margin-top: 4px;">
                  ${selectedEnterprise.status} · ${selectedEnterprise.seatUsed}/${selectedEnterprise.seatQuota}
                </div>
                ${
                  selectedEnterprise.trialEndsAt
                    ? html`
                        <div class="muted" style="margin-top: 4px;">
                          ${t("overview.platformAuth.enterprise.trialEndsAt", {
                            time: selectedEnterprise.trialEndsAt,
                          })}
                        </div>
                      `
                    : nothing
                }
              </div>
            `
          : nothing
      }
      <div class="form-grid" style="margin-top: 12px;">
        ${renderField({
          label: t("overview.platformAuth.platform.enterpriseId"),
          value: props.instanceEnterpriseId,
          disabled: props.busy,
          onInput: props.onInstanceEnterpriseIdChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.platform.instanceTrialDays"),
          value: props.instanceTrialDays,
          disabled: props.busy,
          onInput: props.onInstanceTrialDaysChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.platform.instanceSeatCount"),
          value: props.instanceSeatCount,
          disabled: props.busy,
          onInput: props.onInstanceSeatCountChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.platform.upgradeUrl"),
          value: props.instanceUpgradeUrl,
          disabled: props.busy,
          onInput: props.onInstanceUpgradeUrlChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.platform.contactAdvisorUrl"),
          value: props.instanceContactAdvisorUrl,
          disabled: props.busy,
          onInput: props.onInstanceContactAdvisorUrlChange,
        })}
      </div>
      <div style="margin-top: 10px;">
        <button
          class="btn btn--sm"
          type="button"
          ?disabled=${props.busy || !props.instanceEnterpriseId.trim()}
          @click=${props.onUpdateTrialInstance}
        >
          ${t("overview.platformAuth.platform.instanceEditorSubmit")}
        </button>
      </div>
    </div>
  `;
}

const PLATFORM_ADMIN_SCOPE_OPTIONS = [
  { scope: READ_SCOPE, label: "overview.platformAuth.platform.adminManager.scopes.read" },
  { scope: WRITE_SCOPE, label: "overview.platformAuth.platform.adminManager.scopes.write" },
  { scope: ADMIN_SCOPE, label: "overview.platformAuth.platform.adminManager.scopes.admin" },
  {
    scope: APPROVALS_SCOPE,
    label: "overview.platformAuth.platform.adminManager.scopes.approvals",
  },
  { scope: PAIRING_SCOPE, label: "overview.platformAuth.platform.adminManager.scopes.pairing" },
] as const;

function renderPlatformAdminManagement(props: PlatformAuthPanelProps) {
  const state = props.state;
  if (!state?.canManagePlatformAdmins) {
    return nothing;
  }
  const selectedScopes = new Set(props.platformAdminScopes);
  return html`
    <div class="callout" style="margin-top: 10px;">
      <div><strong>${t("overview.platformAuth.platform.adminManager.title")}</strong></div>
      <div class="muted" style="margin-top: 6px;">
        ${t("overview.platformAuth.platform.adminManager.subtitle")}
      </div>
      ${
        state.platformAdmins && state.platformAdmins.length > 0
          ? html`
              <div style="margin-top: 12px; display:grid; gap:8px;">
                ${state.platformAdmins.map(
                  (admin) => html`
                    <div class="callout" style="margin:0;">
                      <div>
                        ${admin.displayName?.trim() || admin.user}
                        ${
                          admin.isCurrentUser
                            ? html`<span class="muted" style="margin-left: 6px;">${t("overview.platformAuth.members.current")}</span>`
                            : nothing
                        }
                      </div>
                      <div class="muted" style="margin-top: 4px;">${admin.user}</div>
                      <div class="muted" style="margin-top: 4px;">
                        ${t(`overview.platformAuth.sessionKind.platform-${admin.platformRole}`)}
                      </div>
                      ${
                        admin.scopes && admin.scopes.length > 0
                          ? html`
                              <div class="muted" style="margin-top: 4px;">
                                ${admin.scopes.join(" · ")}
                              </div>
                            `
                          : nothing
                      }
                    </div>
                  `,
                )}
              </div>
            `
          : html`
              <div class="muted" style="margin-top: 10px;">
                ${t("overview.platformAuth.platform.adminManager.empty")}
              </div>
            `
      }
      <div style="margin-top: 14px;">
        <strong>${t("overview.platformAuth.platform.adminManager.formTitle")}</strong>
      </div>
      <div class="form-grid" style="margin-top: 12px;">
        ${renderField({
          label: t("overview.platformAuth.platform.adminManager.fields.displayName"),
          value: props.platformAdminDisplayName,
          disabled: props.busy,
          autocomplete: "name",
          onInput: props.onPlatformAdminDisplayNameChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.platform.adminManager.fields.email"),
          value: props.platformAdminEmail,
          type: "email",
          autocomplete: "username",
          disabled: props.busy,
          onInput: props.onPlatformAdminEmailChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.platform.adminManager.fields.password"),
          value: props.platformAdminPassword,
          type: "password",
          autocomplete: "new-password",
          disabled: props.busy,
          onInput: props.onPlatformAdminPasswordChange,
        })}
      </div>
      <div class="muted" style="margin-top: 8px;">
        ${t("overview.platformAuth.platform.adminManager.passwordHandoff")}
      </div>
      <div style="margin-top: 12px;">
        <div class="muted">${t("overview.platformAuth.platform.adminManager.scopeLabel")}</div>
        <div style="display:grid; gap:8px; margin-top: 8px;">
          ${PLATFORM_ADMIN_SCOPE_OPTIONS.map(
            (option) => html`
              <label style="display:flex; gap:8px; align-items:center;">
                <input
                  type="checkbox"
                  ?checked=${selectedScopes.has(option.scope)}
                  ?disabled=${props.busy}
                  @change=${(event: Event) => {
                    const next = new Set(props.platformAdminScopes);
                    if ((event.target as HTMLInputElement).checked) {
                      next.add(option.scope);
                    } else {
                      next.delete(option.scope);
                    }
                    props.onPlatformAdminScopesChange([...next]);
                  }}
                />
                <span>${t(option.label)}</span>
              </label>
            `,
          )}
        </div>
      </div>
      <div style="margin-top: 10px;">
        <button
          class="btn btn--sm"
          type="button"
          ?disabled=${
            !props.onCreatePlatformAdmin ||
            props.busy ||
            !props.platformAdminDisplayName.trim() ||
            !props.platformAdminEmail.trim() ||
            !props.platformAdminPassword.trim()
          }
          @click=${() => props.onCreatePlatformAdmin?.()}
        >
          ${t("overview.platformAuth.platform.adminManager.create")}
        </button>
      </div>
    </div>
  `;
}

function renderMemberList(props: PlatformAuthPanelProps) {
  const state = props.state;
  if (!state?.members || state.members.length === 0) {
    return nothing;
  }
  return html`
    <div style="margin-top: 10px;">
      <strong>${t("overview.platformAuth.members.title")}</strong>
    </div>
    <div style="margin-top: 8px; display:grid; gap:8px;">
      ${state.members.map(
        (member) => html`
          <div class="callout" style="margin:0;">
            <div>
              ${member.displayName?.trim() || member.user}
              ${
                member.isCurrentUser
                  ? html`<span class="muted" style="margin-left: 6px;">${t("overview.platformAuth.members.current")}</span>`
                  : nothing
              }
            </div>
            <div class="muted" style="margin-top: 4px;">${member.user}</div>
            <div class="muted" style="margin-top: 4px;">
              ${t(`overview.platformAuth.membership.${member.membershipRole}`)}
            </div>
            ${
              state.membershipRole === "enterprise-admin" &&
              !member.isCurrentUser &&
              member.membershipRole !== "enterprise-admin" &&
              props.onRemoveMember
                ? html`
                    <div style="margin-top: 8px;">
                      <button
                        class="btn btn--sm"
                        type="button"
                        ?disabled=${props.busy}
                        @click=${() => {
                          if (
                            !shouldProceed(
                              t("overview.platformAuth.members.removeConfirm", {
                                user: member.displayName?.trim() || member.user,
                              }),
                            )
                          ) {
                            return;
                          }
                          props.onRemoveMember?.(member.user);
                        }}
                      >
                        ${t("overview.platformAuth.members.remove")}
                      </button>
                    </div>
                  `
                : nothing
            }
          </div>
        `,
      )}
    </div>
  `;
}

function renderEmployeeInviteSection(props: PlatformAuthPanelProps) {
  const state = props.state;
  if (state?.sessionKind !== "enterprise-admin" || !props.onCreateInvite) {
    return nothing;
  }
  const employeeRegisterHref = buildEmployeeRegisterHref(props);
  return html`
    <div class="callout" style="margin-top: 10px;">
      <div><strong>${t("overview.platformAuth.employee.title")}</strong></div>
      <div class="muted" style="margin-top: 6px;">${t("overview.platformAuth.employee.subtitle")}</div>
      <div class="form-grid" style="margin-top: 12px;">
        ${renderField({
          label: t("overview.platformAuth.employee.name"),
          value: props.displayName,
          disabled: props.busy,
          autocomplete: "name",
          onInput: props.onDisplayNameChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.employee.email"),
          value: props.email,
          type: "email",
          autocomplete: "username",
          disabled: props.busy,
          onInput: props.onEmailChange,
        })}
        ${renderField({
          label: t("overview.platformAuth.employee.seatTitle"),
          value: props.seatTitle,
          disabled: props.busy,
          autocomplete: "organization-title",
          onInput: props.onSeatTitleChange,
        })}
      </div>
      <div style="margin-top: 10px;">
        <button
          class="btn btn--sm"
          type="button"
          ?disabled=${props.busy || !props.displayName.trim() || !props.email.trim() || !props.seatTitle?.trim()}
          @click=${props.onCreateInvite}
        >
          ${t("overview.platformAuth.employee.issue")}
        </button>
      </div>
      ${
        props.inviteCode.trim()
          ? html`
              <div class="callout success" style="margin-top: 10px; margin-bottom: 0;">
                <div><strong>${t("overview.platformAuth.employee.codeReady")}</strong></div>
                <div class="muted" style="margin-top: 6px;">${props.email}</div>
                <div style="margin-top: 8px;"><span class="mono">${props.inviteCode}</span></div>
                <div class="muted" style="margin-top: 6px;">
                  ${t("overview.platformAuth.employee.homepageHint")}
                </div>
                ${
                  employeeRegisterHref
                    ? html`
                        <div style="margin-top: 10px;">
                          <a class="btn btn--sm btn--primary" href=${employeeRegisterHref}>
                            ${t("overview.platformAuth.employee.openHomepage")}
                          </a>
                        </div>
                      `
                    : nothing
                }
              </div>
            `
          : nothing
      }
    </div>
  `;
}

export function renderPlatformAuthPanel(props: PlatformAuthPanelProps) {
  const state = props.state;
  const compactClass = props.compact ? " platform-auth-panel--compact" : "";
  if (!state?.enabled) {
    return nothing;
  }

  if (props.session) {
    const activeMode =
      (state.sessionKind === "platform-super-admin" || state.sessionKind === "platform-admin") &&
      props.mode === "platform-enterprise-create"
        ? "platform-enterprise-create"
        : null;
    return html`
      <section class="card platform-auth-panel platform-auth-panel--active${compactClass}">
        <div class="card-title">${t("overview.platformAuth.active", { user: props.session.user })}</div>
        ${
          state.sessionKind
            ? html`<div class="card-sub">${t(`overview.platformAuth.sessionKind.${state.sessionKind}`)}</div>`
            : nothing
        }
        ${renderPendingCodes(state)}
        ${
          activeMode
            ? html`
                <div class="form-grid" style="margin-top: 16px;">
                  ${renderModeFields(props, activeMode)}
                </div>
                <div style="display:flex; gap:8px; margin-top: 16px;">
                  <button
                    class="btn btn--primary"
                    type="button"
                    ?disabled=${isSubmitDisabled(props, activeMode)}
                    @click=${props.onSubmit}
                  >
                    ${submitLabel(activeMode, props.busy)}
                  </button>
                  <button
                    class="btn"
                    type="button"
                    ?disabled=${props.busy}
                    @click=${() => props.onModeChange("login")}
                  >
                    ${t("overview.platformAuth.actions.cancel")}
                  </button>
                </div>
                ${renderPlatformSummary(props)}
                ${renderPlatformAdminManagement(props)}
                ${renderPlatformPolicySection(props)}
                ${renderPlatformInstanceSection(props)}
                ${renderPasswordChangeSection(props)}
              `
            : html`
                ${renderEnterpriseSummary(state)}
                ${renderPlatformSummary(props)}
                ${renderPlatformAdminManagement(props)}
                ${renderPlatformPolicySection(props)}
                ${renderPlatformInstanceSection(props)}
                ${renderEmployeeInviteSection(props)}
                ${renderMemberList(props)}
                ${renderPasswordChangeSection(props)}
                ${
                  props.onLogout
                    ? html`
                        <div style="margin-top: 10px;">
                          <button class="btn" type="button" ?disabled=${props.busy} @click=${props.onLogout}>
                            ${t("overview.platformAuth.logout")}
                          </button>
                        </div>
                      `
                    : nothing
                }
              `
        }
        ${props.notice ? html`<div class="callout success" style="margin-top: 12px;">${props.notice}</div>` : nothing}
        ${props.error ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>` : nothing}
      </section>
    `;
  }

  const availableModes = state.availableModes?.length ? state.availableModes : [props.mode];
  const activeMode = availableModes.includes(props.mode) ? props.mode : availableModes[0];

  return html`
    <section
      class="card platform-auth-panel${compactClass}"
      style="margin-top: ${props.compact ? "0" : "16px"};"
    >
      <div class="card-title">${modeTitle(activeMode)}</div>
      <div class="card-sub">${modeSubtitle(activeMode)}</div>
      ${renderPendingCodes(state)}
      ${renderModeSwitcher(availableModes, activeMode, props.busy, props.onModeChange)}
      <div class="form-grid" style="margin-top: 16px;">
        ${renderModeFields(props, activeMode)}
      </div>
      <div style="display:flex; gap:8px; margin-top: 16px;">
        <button
          class="btn btn--primary"
          type="button"
          ?disabled=${isSubmitDisabled(props, activeMode)}
          @click=${props.onSubmit}
        >
          ${submitLabel(activeMode, props.busy)}
        </button>
      </div>
      ${props.notice ? html`<div class="callout success" style="margin-top: 12px;">${props.notice}</div>` : nothing}
      ${props.error ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>` : nothing}
    </section>
  `;
}
