import { html } from "lit";
import type {
  ControlUiAuthMode,
  ControlUiPlatformAuthMode,
  ControlUiPlatformAuthState,
  ControlUiTrustedProxySession,
} from "../../../../src/gateway/control-ui-contract.js";
import { ConnectErrorDetailCodes } from "../../../../src/gateway/protocol/connect-error-details.js";
import { t, i18n, SUPPORTED_LOCALES, type Locale } from "../../i18n/index.ts";
import { isCurrentControlUiGatewayTarget } from "../controllers/control-ui-bootstrap.ts";
import { formatRelativeTimestamp, formatDurationHuman } from "../format.ts";
import type { GatewayHelloOk } from "../gateway.ts";
import { formatNextRun } from "../presenter.ts";
import type { UiSettings } from "../storage.ts";
import { shouldShowPairingHint } from "./overview-hints.ts";
import { renderPlatformAuthPanel } from "./platform-auth-panel.ts";

export type OverviewProps = {
  basePath?: string;
  connected: boolean;
  hello: GatewayHelloOk | null;
  settings: UiSettings;
  password: string;
  bootstrapAuthMode: ControlUiAuthMode | null;
  bootstrapAuthSession: ControlUiTrustedProxySession | null;
  platformAuthState: ControlUiPlatformAuthState | null;
  lastError: string | null;
  lastErrorCode: string | null;
  presenceCount: number;
  sessionsCount: number | null;
  cronEnabled: boolean | null;
  cronNext: number | null;
  lastChannelsRefresh: number | null;
  onSettingsChange: (next: UiSettings) => void;
  onPasswordChange: (next: string) => void;
  onSessionKeyChange: (next: string) => void;
  onConnect: () => void;
  onRefresh: () => void;
  onPlatformAuthModeChange: (next: ControlUiPlatformAuthMode) => void;
  onPlatformAuthEmailChange: (next: string) => void;
  onPlatformAuthPasswordChange: (next: string) => void;
  onPlatformAuthDisplayNameChange: (next: string) => void;
  onPlatformAuthPlatformAdminDisplayNameChange: (next: string) => void;
  onPlatformAuthTenantNameChange: (next: string) => void;
  onPlatformAuthSeatTitleChange: (next: string) => void;
  onPlatformAuthInviteCodeChange: (next: string) => void;
  onPlatformAuthSubmit: () => void;
  onPlatformAuthLogout: () => void;
  onPlatformAuthCreateInvite: () => void;
  onPlatformAuthRevokeInvite: (code: string) => void;
  onPlatformAuthRemoveMember: (user: string) => void;
  platformAuthMode: ControlUiPlatformAuthMode;
  platformAuthBusy: boolean;
  platformAuthError: string | null;
  platformAuthNotice: string | null;
  platformAuthEmail: string;
  platformAuthPassword: string;
  platformAuthDisplayName: string;
  platformAuthPlatformAdminDisplayName: string;
  platformAuthTenantName: string;
  platformAuthSeatTitle: string;
  platformAuthInviteCode: string;
  platformAuthCurrentPassword: string;
  platformAuthNewPassword: string;
  platformAuthPolicyTrialDays: string;
  platformAuthPolicySeatCount: string;
  platformAuthPolicyUpgradeUrl: string;
  platformAuthPolicyContactAdvisorUrl: string;
  platformAuthInstanceEnterpriseId: string;
  platformAuthInstanceTrialDays: string;
  platformAuthInstanceSeatCount: string;
  platformAuthInstanceUpgradeUrl: string;
  platformAuthInstanceContactAdvisorUrl: string;
  platformAuthPlatformAdminEmail: string;
  platformAuthPlatformAdminPassword: string;
  platformAuthPlatformAdminScopes: string[];
  onPlatformAuthCurrentPasswordChange: (next: string) => void;
  onPlatformAuthNewPasswordChange: (next: string) => void;
  onPlatformAuthPolicyTrialDaysChange: (next: string) => void;
  onPlatformAuthPolicySeatCountChange: (next: string) => void;
  onPlatformAuthPolicyUpgradeUrlChange: (next: string) => void;
  onPlatformAuthPolicyContactAdvisorUrlChange: (next: string) => void;
  onPlatformAuthInstanceEnterpriseIdChange: (next: string) => void;
  onPlatformAuthInstanceTrialDaysChange: (next: string) => void;
  onPlatformAuthInstanceSeatCountChange: (next: string) => void;
  onPlatformAuthInstanceUpgradeUrlChange: (next: string) => void;
  onPlatformAuthInstanceContactAdvisorUrlChange: (next: string) => void;
  onPlatformAuthPlatformAdminEmailChange: (next: string) => void;
  onPlatformAuthPlatformAdminPasswordChange: (next: string) => void;
  onPlatformAuthPlatformAdminScopesChange: (next: string[]) => void;
  onPlatformAuthChangePassword: () => void;
  onPlatformAuthUpdateTrialPolicy: () => void;
  onPlatformAuthUpdateTrialInstance: () => void;
  onPlatformAuthCreatePlatformAdmin: () => void;
};

export function renderOverview(props: OverviewProps) {
  const useBootstrapAuth = isCurrentControlUiGatewayTarget({
    gatewayUrl: props.settings.gatewayUrl,
  });
  const snapshot = props.hello?.snapshot as
    | {
        uptimeMs?: number;
        policy?: { tickIntervalMs?: number };
        authMode?: "none" | "token" | "password" | "trusted-proxy";
      }
    | undefined;
  const uptime = snapshot?.uptimeMs ? formatDurationHuman(snapshot.uptimeMs) : t("common.na");
  const tick = snapshot?.policy?.tickIntervalMs
    ? `${snapshot.policy.tickIntervalMs}ms`
    : t("common.na");
  const authMode =
    snapshot?.authMode ?? (useBootstrapAuth ? (props.bootstrapAuthMode ?? undefined) : undefined);
  const isTrustedProxy = authMode === "trusted-proxy";
  const platformAuthState = useBootstrapAuth ? props.platformAuthState : null;
  const helloAuth = props.hello?.auth;
  const helloTrustedProxySession =
    helloAuth?.provider === "trusted-proxy" && helloAuth.user
      ? {
          provider: "trusted-proxy" as const,
          user: helloAuth.user,
          displayName: helloAuth.displayName,
          tenantId: helloAuth.tenantId,
          role: helloAuth.role,
          scopes: helloAuth.scopes,
        }
      : null;
  const trustedProxySession =
    helloTrustedProxySession ??
    platformAuthState?.session ??
    (useBootstrapAuth ? props.bootstrapAuthSession : null);

  const pairingHint = (() => {
    if (!shouldShowPairingHint(props.connected, props.lastError, props.lastErrorCode)) {
      return null;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.pairing.hint")}
        <div style="margin-top: 6px">
          <span class="mono">openbot devices list</span><br />
          <span class="mono">openbot devices approve &lt;requestId&gt;</span>
        </div>
        <div style="margin-top: 6px; font-size: 12px;">
          ${t("overview.pairing.mobileHint")}
        </div>
      </div>
    `;
  })();

  const authHint = (() => {
    if (props.connected || !props.lastError) {
      return null;
    }
    const lower = props.lastError.toLowerCase();
    const authRequiredCodes = new Set<string>([
      ConnectErrorDetailCodes.AUTH_REQUIRED,
      ConnectErrorDetailCodes.AUTH_TOKEN_MISSING,
      ConnectErrorDetailCodes.AUTH_PASSWORD_MISSING,
      ConnectErrorDetailCodes.AUTH_TOKEN_NOT_CONFIGURED,
      ConnectErrorDetailCodes.AUTH_PASSWORD_NOT_CONFIGURED,
    ]);
    const authFailureCodes = new Set<string>([
      ...authRequiredCodes,
      ConnectErrorDetailCodes.AUTH_UNAUTHORIZED,
      ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH,
      ConnectErrorDetailCodes.AUTH_PASSWORD_MISMATCH,
      ConnectErrorDetailCodes.AUTH_DEVICE_TOKEN_MISMATCH,
      ConnectErrorDetailCodes.AUTH_RATE_LIMITED,
      ConnectErrorDetailCodes.AUTH_TAILSCALE_IDENTITY_MISSING,
      ConnectErrorDetailCodes.AUTH_TAILSCALE_PROXY_MISSING,
      ConnectErrorDetailCodes.AUTH_TAILSCALE_WHOIS_FAILED,
      ConnectErrorDetailCodes.AUTH_TAILSCALE_IDENTITY_MISMATCH,
    ]);
    const authFailed = props.lastErrorCode
      ? authFailureCodes.has(props.lastErrorCode)
      : lower.includes("unauthorized") || lower.includes("connect failed");
    if (!authFailed) {
      return null;
    }
    if (isTrustedProxy) {
      if (platformAuthState?.enabled) {
        return null;
      }
      return html`
        <div class="muted" style="margin-top: 8px">${t("overview.auth.proxyRequired")}</div>
      `;
    }
    const hasToken = Boolean(props.settings.token.trim());
    const hasPassword = Boolean(props.password.trim());
    const isAuthRequired = props.lastErrorCode
      ? authRequiredCodes.has(props.lastErrorCode)
      : !hasToken && !hasPassword;
    if (isAuthRequired) {
      return html`
        <div class="muted" style="margin-top: 8px">
          ${t("overview.auth.required")}
          <div style="margin-top: 6px">
            <span class="mono">openbot dashboard --no-open</span> → tokenized URL<br />
            <span class="mono">openbot doctor --generate-gateway-token</span> → set token
          </div>
        </div>
      `;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.auth.failed", { command: "openbot dashboard --no-open" })}
      </div>
    `;
  })();

  const insecureContextHint = (() => {
    if (props.connected || !props.lastError) {
      return null;
    }
    const isSecureContext = typeof window !== "undefined" ? window.isSecureContext : true;
    if (isSecureContext) {
      return null;
    }
    const lower = props.lastError.toLowerCase();
    const insecureContextCode =
      props.lastErrorCode === ConnectErrorDetailCodes.CONTROL_UI_DEVICE_IDENTITY_REQUIRED ||
      props.lastErrorCode === ConnectErrorDetailCodes.DEVICE_IDENTITY_REQUIRED;
    if (
      !insecureContextCode &&
      !lower.includes("secure context") &&
      !lower.includes("device identity required")
    ) {
      return null;
    }
    return html`
      <div class="muted" style="margin-top: 8px">
        ${t("overview.insecure.hint", { url: "http://127.0.0.1:18789" })}
        <div style="margin-top: 6px">
          ${t("overview.insecure.stayHttp", { config: "gateway.controlUi.allowInsecureAuth: true" })}
        </div>
      </div>
    `;
  })();

  const currentLocale = i18n.getLocale();

  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="card-title">${t("overview.access.title")}</div>
        <div class="card-sub">${t("overview.access.subtitle")}</div>
        <div class="form-grid" style="margin-top: 16px;">
          <label class="field">
            <span>${t("overview.access.wsUrl")}</span>
            <input
              .value=${props.settings.gatewayUrl}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                props.onSettingsChange({
                  ...props.settings,
                  gatewayUrl: v,
                  token: v.trim() === props.settings.gatewayUrl.trim() ? props.settings.token : "",
                });
              }}
              placeholder="ws://100.x.y.z:18789"
            />
          </label>
          ${
            isTrustedProxy
              ? html`
                  <div class="field">
                    <span>${t("overview.access.trustedProxy")}</span>
                    <div class="muted">
                      ${
                        trustedProxySession
                          ? t("overview.access.trustedProxySession", {
                              user: trustedProxySession.displayName ?? trustedProxySession.user,
                            })
                          : t("overview.access.trustedProxyPending")
                      }
                    </div>
                    ${
                      trustedProxySession?.tenantId
                        ? html`<div class="muted" style="margin-top: 6px;">
                            ${t("overview.access.trustedProxyTenant", {
                              tenant: trustedProxySession.tenantId,
                            })}
                          </div>`
                        : ""
                    }
                    ${
                      trustedProxySession?.role
                        ? html`<div class="muted" style="margin-top: 6px;">
                            ${t("overview.access.trustedProxyRole", {
                              role: trustedProxySession.role,
                            })}
                          </div>`
                        : ""
                    }
                    ${
                      trustedProxySession?.scopes && trustedProxySession.scopes.length > 0
                        ? html`<div class="muted" style="margin-top: 6px;">
                            ${t("overview.access.trustedProxyScopes", {
                              scopes: trustedProxySession.scopes.join(", "),
                            })}
                          </div>`
                        : ""
                    }
                  </div>
                `
              : html`
                <label class="field">
                  <span>${t("overview.access.token")}</span>
                  <input
                    .value=${props.settings.token}
                    @input=${(e: Event) => {
                      const v = (e.target as HTMLInputElement).value;
                      props.onSettingsChange({ ...props.settings, token: v });
                    }}
                    placeholder="OPENCLAW_GATEWAY_TOKEN"
                  />
                </label>
                <label class="field">
                  <span>${t("overview.access.password")}</span>
                  <input
                    type="password"
                    .value=${props.password}
                    @input=${(e: Event) => {
                      const v = (e.target as HTMLInputElement).value;
                      props.onPasswordChange(v);
                    }}
                    placeholder="system or shared password"
                  />
                </label>
              `
          }
          <label class="field">
            <span>${t("overview.access.sessionKey")}</span>
            <input
              .value=${props.settings.sessionKey}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                props.onSessionKeyChange(v);
              }}
            />
          </label>
          <label class="field">
            <span>${t("overview.access.language")}</span>
            <select
              .value=${currentLocale}
              @change=${(e: Event) => {
                const v = (e.target as HTMLSelectElement).value as Locale;
                void i18n.setLocale(v);
                props.onSettingsChange({ ...props.settings, locale: v });
              }}
            >
              ${SUPPORTED_LOCALES.map((loc) => {
                const key = loc.replace(/-([a-zA-Z])/g, (_, c) => c.toUpperCase());
                return html`<option value=${loc}>${t(`languages.${key}`)}</option>`;
              })}
            </select>
          </label>
        </div>
        <div class="row" style="margin-top: 14px;">
          <button class="btn" @click=${() => props.onConnect()}>${t("common.connect")}</button>
          <button class="btn" @click=${() => props.onRefresh()}>${t("common.refresh")}</button>
          <span class="muted">${
            isTrustedProxy ? t("overview.access.trustedProxy") : t("overview.access.connectHint")
          }</span>
        </div>
        ${
          platformAuthState?.enabled
            ? renderPlatformAuthPanel({
                basePath: props.basePath,
                state: platformAuthState,
                session: trustedProxySession,
                mode: props.platformAuthMode,
                busy: props.platformAuthBusy,
                error: props.platformAuthError,
                notice: props.platformAuthNotice,
                email: props.platformAuthEmail,
                password: props.platformAuthPassword,
                displayName: props.platformAuthDisplayName,
                platformAdminDisplayName: props.platformAuthPlatformAdminDisplayName,
                tenantName: props.platformAuthTenantName,
                seatTitle: props.platformAuthSeatTitle,
                inviteCode: props.platformAuthInviteCode,
                currentPassword: props.platformAuthCurrentPassword,
                newPassword: props.platformAuthNewPassword,
                policyTrialDays: props.platformAuthPolicyTrialDays,
                policySeatCount: props.platformAuthPolicySeatCount,
                policyUpgradeUrl: props.platformAuthPolicyUpgradeUrl,
                policyContactAdvisorUrl: props.platformAuthPolicyContactAdvisorUrl,
                instanceEnterpriseId: props.platformAuthInstanceEnterpriseId,
                instanceTrialDays: props.platformAuthInstanceTrialDays,
                instanceSeatCount: props.platformAuthInstanceSeatCount,
                instanceUpgradeUrl: props.platformAuthInstanceUpgradeUrl,
                instanceContactAdvisorUrl: props.platformAuthInstanceContactAdvisorUrl,
                platformAdminEmail: props.platformAuthPlatformAdminEmail,
                platformAdminPassword: props.platformAuthPlatformAdminPassword,
                platformAdminScopes: props.platformAuthPlatformAdminScopes,
                onModeChange: props.onPlatformAuthModeChange,
                onEmailChange: props.onPlatformAuthEmailChange,
                onPasswordChange: props.onPlatformAuthPasswordChange,
                onDisplayNameChange: props.onPlatformAuthDisplayNameChange,
                onPlatformAdminDisplayNameChange:
                  props.onPlatformAuthPlatformAdminDisplayNameChange,
                onTenantNameChange: props.onPlatformAuthTenantNameChange,
                onSeatTitleChange: props.onPlatformAuthSeatTitleChange,
                onInviteCodeChange: props.onPlatformAuthInviteCodeChange,
                onCurrentPasswordChange: props.onPlatformAuthCurrentPasswordChange,
                onNewPasswordChange: props.onPlatformAuthNewPasswordChange,
                onPolicyTrialDaysChange: props.onPlatformAuthPolicyTrialDaysChange,
                onPolicySeatCountChange: props.onPlatformAuthPolicySeatCountChange,
                onPolicyUpgradeUrlChange: props.onPlatformAuthPolicyUpgradeUrlChange,
                onPolicyContactAdvisorUrlChange: props.onPlatformAuthPolicyContactAdvisorUrlChange,
                onInstanceEnterpriseIdChange: props.onPlatformAuthInstanceEnterpriseIdChange,
                onInstanceTrialDaysChange: props.onPlatformAuthInstanceTrialDaysChange,
                onInstanceSeatCountChange: props.onPlatformAuthInstanceSeatCountChange,
                onInstanceUpgradeUrlChange: props.onPlatformAuthInstanceUpgradeUrlChange,
                onInstanceContactAdvisorUrlChange:
                  props.onPlatformAuthInstanceContactAdvisorUrlChange,
                onPlatformAdminEmailChange: props.onPlatformAuthPlatformAdminEmailChange,
                onPlatformAdminPasswordChange: props.onPlatformAuthPlatformAdminPasswordChange,
                onPlatformAdminScopesChange: props.onPlatformAuthPlatformAdminScopesChange,
                onSubmit: props.onPlatformAuthSubmit,
                onCreatePlatformAdmin: props.onPlatformAuthCreatePlatformAdmin,
                onLogout: props.onPlatformAuthLogout,
                onCreateInvite: props.onPlatformAuthCreateInvite,
                onRevokeInvite: props.onPlatformAuthRevokeInvite,
                onRemoveMember: props.onPlatformAuthRemoveMember,
                onChangePassword: props.onPlatformAuthChangePassword,
                onUpdateTrialPolicy: props.onPlatformAuthUpdateTrialPolicy,
                onUpdateTrialInstance: props.onPlatformAuthUpdateTrialInstance,
              })
            : html``
        }
      </div>

      <div class="card">
        <div class="card-title">${t("overview.snapshot.title")}</div>
        <div class="card-sub">${t("overview.snapshot.subtitle")}</div>
        <div class="stat-grid" style="margin-top: 16px;">
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.status")}</div>
            <div class="stat-value ${props.connected ? "ok" : "warn"}">
              ${props.connected ? t("common.ok") : t("common.offline")}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.uptime")}</div>
            <div class="stat-value">${uptime}</div>
          </div>
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.tickInterval")}</div>
            <div class="stat-value">${tick}</div>
          </div>
          <div class="stat">
            <div class="stat-label">${t("overview.snapshot.lastChannelsRefresh")}</div>
            <div class="stat-value">
              ${props.lastChannelsRefresh ? formatRelativeTimestamp(props.lastChannelsRefresh) : t("common.na")}
            </div>
          </div>
        </div>
        ${
          props.lastError
            ? html`<div class="callout danger" style="margin-top: 14px;">
              <div>${props.lastError}</div>
              ${pairingHint ?? ""}
              ${authHint ?? ""}
              ${insecureContextHint ?? ""}
            </div>`
            : html`
                <div class="callout" style="margin-top: 14px">
                  ${t("overview.snapshot.channelsHint")}
                </div>
              `
        }
      </div>
    </section>

    <section class="grid grid-cols-3" style="margin-top: 18px;">
      <div class="card stat-card">
        <div class="stat-label">${t("overview.stats.instances")}</div>
        <div class="stat-value">${props.presenceCount}</div>
        <div class="muted">${t("overview.stats.instancesHint")}</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">${t("overview.stats.sessions")}</div>
        <div class="stat-value">${props.sessionsCount ?? t("common.na")}</div>
        <div class="muted">${t("overview.stats.sessionsHint")}</div>
      </div>
      <div class="card stat-card">
        <div class="stat-label">${t("overview.stats.cron")}</div>
        <div class="stat-value">
          ${props.cronEnabled == null ? t("common.na") : props.cronEnabled ? t("common.enabled") : t("common.disabled")}
        </div>
        <div class="muted">${t("overview.stats.cronNext", { time: formatNextRun(props.cronNext) })}</div>
      </div>
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="card-title">${t("overview.notes.title")}</div>
      <div class="card-sub">${t("overview.notes.subtitle")}</div>
      <div class="note-grid" style="margin-top: 14px;">
        <div>
          <div class="note-title">${t("overview.notes.tailscaleTitle")}</div>
          <div class="muted">
            ${t("overview.notes.tailscaleText")}
          </div>
        </div>
        <div>
          <div class="note-title">${t("overview.notes.sessionTitle")}</div>
          <div class="muted">${t("overview.notes.sessionText")}</div>
        </div>
        <div>
          <div class="note-title">${t("overview.notes.cronTitle")}</div>
          <div class="muted">${t("overview.notes.cronText")}</div>
        </div>
      </div>
    </section>
  `;
}
