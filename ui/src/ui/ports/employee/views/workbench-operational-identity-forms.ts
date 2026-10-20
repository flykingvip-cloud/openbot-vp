import { html, nothing, type TemplateResult } from "lit";
import { resolvePersonalEmailBrowserGuide } from "../../../wiring/personal-email-browser-guide.ts";
import {
  findPersonalEmailPreset,
  resolvePersonalEmailEditorFields,
} from "../../../wiring/personal-email-presets.ts";
import type { SettingsContract } from "./workbench-stage-contracts.ts";

type CatalogEntry = NonNullable<
  NonNullable<SettingsContract["userOperationalIdentitySnapshot"]>["providerCatalog"]
>[number];

type SocialFormCopy = {
  handleLabel: string;
  handlePlaceholder: string;
  secretLabel: string;
  secretPlaceholder: string;
  hint: string;
};

const SOCIAL_FORM_COPY: Record<string, SocialFormCopy> = {
  weibo: {
    handleLabel: "微博账号",
    handlePlaceholder: "UID / 昵称 / 主页链接",
    secretLabel: "Access Token / Cookie",
    secretPlaceholder: "开放平台 Token 或登录 Cookie",
    hint: "",
  },
  zhihu: {
    handleLabel: "知乎账号",
    handlePlaceholder: "用户名 / 主页 Token",
    secretLabel: "Cookie / Token",
    secretPlaceholder: "登录 Cookie 或开放平台 Token",
    hint: "",
  },
  douyin: {
    handleLabel: "抖音号",
    handlePlaceholder: "抖音号 / OpenID",
    secretLabel: "Access Token",
    secretPlaceholder: "开放平台 Access Token",
    hint: "",
  },
  xiaohongshu: {
    handleLabel: "小红书号",
    handlePlaceholder: "小红书号 / 主页链接",
    secretLabel: "Cookie / 密钥",
    secretPlaceholder: "Cookie 或开放平台密钥",
    hint: "",
  },
  kuaishou: {
    handleLabel: "快手号",
    handlePlaceholder: "快手号 / User ID",
    secretLabel: "Access Token",
    secretPlaceholder: "开放平台 Access Token",
    hint: "",
  },
};

function renderField(params: {
  label: string;
  value: string;
  placeholder?: string;
  type?: "text" | "password";
  mono?: boolean;
  onChange: (value: string) => void;
  hint?: string;
}): TemplateResult {
  return html`
    <label class="employee-workbench__settings-field">
      <span class="employee-workbench__settings-field-label">${params.label}</span>
      <input
        class="employee-workbench__settings-input ${params.mono ? "mono" : ""}"
        type=${params.type ?? "text"}
        .value=${params.value}
        placeholder=${params.placeholder ?? ""}
        @input=${(event: Event) => params.onChange((event.currentTarget as HTMLInputElement).value)}
      />
      ${
        params.hint
          ? html`<span class="employee-workbench__settings-field-hint">${params.hint}</span>`
          : nothing
      }
    </label>
  `;
}

/** Lean meta for bind forms: skip catalog blurbs; only surface reauth when editing. */
function renderCatalogMeta(
  entry: CatalogEntry | null,
  opts?: { editing?: boolean },
): TemplateResult | typeof nothing {
  if (!entry?.reauthHint || !opts?.editing) {
    return nothing;
  }
  return html`<div class="employee-workbench__auth-config-tip">${entry.reauthHint}</div>`;
}

function renderConfiguredIdentityBanner(
  settings: SettingsContract,
): TemplateResult | typeof nothing {
  const identityId = settings.userOperationalIdentityEditorIdentityId?.trim();
  if (!identityId) {
    return nothing;
  }
  const identity = (settings.userOperationalIdentitySnapshot?.identities ?? []).find(
    (item) => item.identityId === identityId,
  );
  if (!identity) {
    return nothing;
  }
  const account = identity.externalAccountId?.trim();
  return html`
    <div class="employee-workbench__auth-config-callout" data-identity-configured-banner>
      已配置${account ? html` · <span class="mono">${account}</span>` : nothing}
    </div>
  `;
}

function secretPlaceholder(editing: boolean, freshPlaceholder: string): string {
  return editing ? "留空则保持原凭证" : freshPlaceholder;
}

function renderFormActions(params: {
  submitLabel: string;
  busy: boolean;
  disabled?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}): TemplateResult {
  // Footer rail aligns with the input column; actions end-align (cancel → primary).
  return html`
    <div class="employee-workbench__auth-config-footer">
      <div class="employee-workbench__auth-config-footer-rail">
        <div
          class="employee-workbench__settings-password-actions employee-workbench__auth-config-actions"
        >
          <button
            type="button"
            class="btn"
            ?disabled=${params.busy}
            @click=${() => params.onCancel()}
          >
            取消
          </button>
          <button
            type="button"
            class="btn btn--primary"
            ?disabled=${params.busy || Boolean(params.disabled)}
            @click=${() => params.onSubmit()}
          >
            ${params.submitLabel}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderDisplayNameField(settings: SettingsContract): TemplateResult {
  return renderField({
    label: "显示名称",
    value: settings.userOperationalIdentityEditorDisplayName ?? "",
    onChange: (value) => settings.onUserOperationalIdentityEditorDisplayNameChange?.(value),
  });
}

function renderWechatOfficialForm(
  settings: SettingsContract,
  entry: CatalogEntry | null,
): TemplateResult {
  const snapshot = settings.userOperationalIdentitySnapshot;
  const busy = Boolean(settings.userOperationalIdentityBusy);
  const editing = Boolean(settings.userOperationalIdentityEditorIdentityId);
  const submitLabel = editing ? "更新并认证" : "添加并认证";
  return html`
    <div class="employee-workbench__auth-pane-head">
      <div class="employee-workbench__settings-section-title">
        ${entry?.label ?? "微信公众号"}
      </div>
    </div>
    <div class="employee-workbench__settings-control employee-workbench__auth-config-form">
      ${renderConfiguredIdentityBanner(settings)}
      ${renderCatalogMeta(entry, { editing })}
      ${renderDisplayNameField(settings)}
      ${renderField({
        label: "AppID",
        value: settings.userOperationalIdentityEditorAppId ?? "",
        placeholder: "wx 开头的 AppID",
        mono: true,
        onChange: (value) => settings.onUserOperationalIdentityEditorAppIdChange?.(value),
      })}
      ${renderField({
        label: "AppSecret",
        value: settings.userOperationalIdentityEditorAppSecret ?? "",
        placeholder: secretPlaceholder(editing, "开发者密码（仅显示一次）"),
        type: "password",
        mono: true,
        onChange: (value) => settings.onUserOperationalIdentityEditorAppSecretChange?.(value),
      })}
      ${
        snapshot?.gatewayEgressIp
          ? html`
              <div class="employee-workbench__auth-config-callout">
                出口 IP <span class="mono">${snapshot.gatewayEgressIp}</span> · 加入公众号 IP 白名单后认证
              </div>
            `
          : nothing
      }
      ${renderFormActions({
        submitLabel,
        busy,
        onSubmit: () => settings.onSubmitUserOperationalIdentityEditor?.(),
        onCancel: () => settings.onUserOperationalIdentityNavChange?.("bound"),
      })}
    </div>
  `;
}

function renderPersonalEmailBrowserAssist(
  settings: SettingsContract,
): TemplateResult | typeof nothing {
  const email = settings.userOperationalIdentityEditorCredentialHandleId?.trim() ?? "";
  const guide = resolvePersonalEmailBrowserGuide(email);
  if (!guide) {
    return nothing;
  }
  return html`
    <div class="employee-workbench__auth-config-footer" data-personal-email-browser-assist>
      <div class="employee-workbench__auth-config-footer-rail">
        <div class="employee-workbench__settings-password-actions">
          <button
            type="button"
            class="btn btn--sm"
            @click=${() => settings.onOpenPersonalEmailWebmail?.()}
          >
            打开邮箱网页
          </button>
          ${
            guide.settingsUrl
              ? html`
                  <button
                    type="button"
                    class="btn btn--sm"
                    @click=${() => settings.onOpenPersonalEmailAuthCodeSettings?.()}
                  >
                    获取授权码
                  </button>
                `
              : nothing
          }
        </div>
      </div>
    </div>
  `;
}

function renderPersonalEmailForm(
  settings: SettingsContract,
  entry: CatalogEntry | null,
): TemplateResult {
  const snapshot = settings.userOperationalIdentitySnapshot;
  const platformSmtpConfigured = Boolean(snapshot?.platformSmtpConfigured);
  const usePlatformSmtp = Boolean(settings.userOperationalIdentityEditorUsePlatformSmtp);
  const busy = Boolean(settings.userOperationalIdentityBusy);
  const editing = Boolean(settings.userOperationalIdentityEditorIdentityId);
  const submitLabel = editing ? "更新并认证" : "添加并认证";
  const email = settings.userOperationalIdentityEditorCredentialHandleId?.trim() ?? "";
  const resolved = resolvePersonalEmailEditorFields({
    email,
    usePlatformSmtp,
    smtpHost: settings.userOperationalIdentityEditorSmtpHost ?? "",
    smtpPort: settings.userOperationalIdentityEditorSmtpPort ?? "587",
    smtpUser: settings.userOperationalIdentityEditorSmtpUser ?? "",
    imapHost: settings.userOperationalIdentityEditorImapHost ?? "",
    imapPort: settings.userOperationalIdentityEditorImapPort ?? "993",
    imapUser: settings.userOperationalIdentityEditorImapUser ?? "",
  });
  const hasPreset = Boolean(findPersonalEmailPreset(email));
  const showCustomServers = !(usePlatformSmtp && platformSmtpConfigured);
  const showManualServers = showCustomServers && !hasPreset;
  return html`
    <div class="employee-workbench__auth-pane-head">
      <div class="employee-workbench__settings-section-title">
        ${entry?.label ?? "个人邮箱"}
      </div>
    </div>
    <div class="employee-workbench__settings-control employee-workbench__auth-config-form">
      ${renderConfiguredIdentityBanner(settings)}
      ${renderDisplayNameField(settings)}
      ${renderField({
        label: "发件邮箱",
        value: settings.userOperationalIdentityEditorCredentialHandleId ?? "",
        placeholder: "name@example.com",
        mono: true,
        onChange: (value) =>
          settings.onUserOperationalIdentityEditorCredentialHandleIdChange?.(value),
      })}
      ${renderPersonalEmailBrowserAssist(settings)}
      ${
        platformSmtpConfigured
          ? html`
              <label class="employee-workbench__settings-field employee-workbench__settings-field--inline">
                <span class="employee-workbench__settings-field-label">
                  <input
                    type="checkbox"
                    .checked=${usePlatformSmtp}
                    @change=${(event: Event) =>
                      settings.onUserOperationalIdentityEditorUsePlatformSmtpChange?.(
                        (event.currentTarget as HTMLInputElement).checked,
                      )}
                  />
                  平台代发
                </span>
              </label>
            `
          : nothing
      }
      ${
        showCustomServers && hasPreset
          ? html`
              <div class="employee-workbench__auth-config-footer">
                <div class="employee-workbench__auth-config-footer-rail">
                  <div class="employee-workbench__settings-hint mono">
                    ${resolved.smtpHost}:${resolved.smtpPort} · ${resolved.imapHost}:${resolved.imapPort}
                  </div>
                </div>
              </div>
            `
          : nothing
      }
      ${
        showManualServers
          ? html`
              ${renderField({
                label: "SMTP 主机",
                value: resolved.smtpHost,
                placeholder: "smtp.example.com",
                mono: true,
                onChange: (value) =>
                  settings.onUserOperationalIdentityEditorSmtpHostChange?.(value),
              })}
              ${renderField({
                label: "SMTP 端口",
                value: resolved.smtpPort,
                placeholder: "587 / 465",
                mono: true,
                onChange: (value) =>
                  settings.onUserOperationalIdentityEditorSmtpPortChange?.(value),
              })}
              ${renderField({
                label: "SMTP 用户名",
                value: resolved.smtpUser,
                placeholder: "默认同发件邮箱",
                mono: true,
                onChange: (value) =>
                  settings.onUserOperationalIdentityEditorSmtpUserChange?.(value),
              })}
              ${renderField({
                label: "IMAP 主机",
                value: resolved.imapHost,
                placeholder: "imap.example.com",
                mono: true,
                onChange: (value) =>
                  settings.onUserOperationalIdentityEditorImapHostChange?.(value),
              })}
              ${renderField({
                label: "IMAP 端口",
                value: resolved.imapPort,
                placeholder: "993",
                mono: true,
                onChange: (value) =>
                  settings.onUserOperationalIdentityEditorImapPortChange?.(value),
              })}
              ${renderField({
                label: "IMAP 用户名",
                value: resolved.imapUser,
                placeholder: "默认同发件邮箱",
                mono: true,
                onChange: (value) =>
                  settings.onUserOperationalIdentityEditorImapUserChange?.(value),
              })}
            `
          : nothing
      }
      ${
        showCustomServers
          ? renderField({
              label: "SMTP 授权码",
              value: settings.userOperationalIdentityEditorAppSecret ?? "",
              placeholder: secretPlaceholder(editing, "应用专用密码 / 客户端授权码"),
              type: "password",
              mono: true,
              onChange: (value) => settings.onUserOperationalIdentityEditorAppSecretChange?.(value),
            })
          : nothing
      }
      ${renderFormActions({
        submitLabel,
        busy,
        onSubmit: () => settings.onSubmitUserOperationalIdentityEditor?.(),
        onCancel: () => settings.onUserOperationalIdentityNavChange?.("bound"),
      })}
    </div>
  `;
}

const OAUTH_HANDLE_COPY: Record<string, { label: string; placeholder: string }> = {
  "github-personal": {
    label: "GitHub 用户名",
    placeholder: "OAuth 可留空；模拟绑定时填写",
  },
  "x-twitter": {
    label: "X 用户名",
    placeholder: "OAuth 可留空（回调后写入 @handle）；模拟绑定时填写",
  },
};

function renderOauthPersonalForm(
  settings: SettingsContract,
  entry: CatalogEntry | null,
  provider: string,
): TemplateResult {
  const busy = Boolean(settings.userOperationalIdentityBusy);
  const editing = Boolean(settings.userOperationalIdentityEditorIdentityId);
  const handleCopy =
    OAUTH_HANDLE_COPY[provider] ??
    ({
      label: "账号标识",
      placeholder: editing ? "已绑定账号（重新认证时可改）" : "OAuth 可留空；模拟绑定时填写",
    } as const);
  return html`
    <div class="employee-workbench__auth-pane-head">
      <div class="employee-workbench__settings-section-title">
        ${entry?.label ?? provider}
      </div>
    </div>
    <div class="employee-workbench__settings-control employee-workbench__auth-config-form">
      ${renderConfiguredIdentityBanner(settings)}
      ${renderCatalogMeta(entry, { editing })}
      ${
        entry?.degradedHint
          ? html`<div class="employee-workbench__auth-config-tip">${entry.degradedHint}</div>`
          : nothing
      }
      ${renderDisplayNameField(settings)}
      ${renderField({
        label: handleCopy.label,
        value: settings.userOperationalIdentityEditorCredentialHandleId ?? "",
        placeholder: editing ? "已绑定账号（重新认证时可改）" : handleCopy.placeholder,
        mono: true,
        onChange: (value) =>
          settings.onUserOperationalIdentityEditorCredentialHandleIdChange?.(value),
      })}
      ${renderFormActions({
        submitLabel: editing ? "重新认证" : "授权绑定",
        busy,
        onSubmit: () => settings.onSubmitUserOperationalIdentityEditor?.(),
        onCancel: () => settings.onUserOperationalIdentityNavChange?.("bound"),
      })}
    </div>
  `;
}

function renderSocialAccountForm(
  settings: SettingsContract,
  entry: CatalogEntry | null,
  provider: string,
): TemplateResult {
  const copy =
    SOCIAL_FORM_COPY[provider] ??
    ({
      handleLabel: "账号标识",
      handlePlaceholder: "用户名 / UID / 主页链接",
      secretLabel: "访问凭证",
      secretPlaceholder: "Access Token / Cookie / 开放平台密钥",
      hint: "请填写该平台账号标识与访问凭证。",
    } satisfies SocialFormCopy);
  const busy = Boolean(settings.userOperationalIdentityBusy);
  const editing = Boolean(settings.userOperationalIdentityEditorIdentityId);
  const submitLabel = editing ? "更新并认证" : "添加并认证";
  return html`
    <div class="employee-workbench__auth-pane-head">
      <div class="employee-workbench__settings-section-title">
        ${entry?.label ?? provider}
      </div>
    </div>
    <div class="employee-workbench__settings-control employee-workbench__auth-config-form">
      ${renderConfiguredIdentityBanner(settings)}
      ${renderCatalogMeta(entry, { editing })}
      ${renderDisplayNameField(settings)}
      ${renderField({
        label: copy.handleLabel,
        value: settings.userOperationalIdentityEditorCredentialHandleId ?? "",
        placeholder: copy.handlePlaceholder,
        mono: true,
        onChange: (value) =>
          settings.onUserOperationalIdentityEditorCredentialHandleIdChange?.(value),
      })}
      ${renderField({
        label: copy.secretLabel,
        value: settings.userOperationalIdentityEditorAppSecret ?? "",
        placeholder: secretPlaceholder(editing, copy.secretPlaceholder),
        type: "password",
        mono: true,
        onChange: (value) => settings.onUserOperationalIdentityEditorAppSecretChange?.(value),
      })}
      ${renderFormActions({
        submitLabel,
        busy,
        onSubmit: () => settings.onSubmitUserOperationalIdentityEditor?.(),
        onCancel: () => settings.onUserOperationalIdentityNavChange?.("bound"),
      })}
    </div>
  `;
}

function ownedAgentLabel(agent: NonNullable<SettingsContract["ownedAgents"]>[number]): string {
  return agent.identity?.name?.trim() || agent.name?.trim() || agent.id;
}

function renderOwnedBotGrantPicker(settings: SettingsContract): TemplateResult {
  const agents = settings.ownedAgents ?? [];
  if (agents.length === 0) {
    return html`
      <div class="employee-workbench__settings-hint">
        绑定后会创建个人微信身份。若要让数字人接管此号，请先创建自有数字人再回来选择。
      </div>
    `;
  }
  const selected = settings.userOperationalIdentityEditorGrantAgentId?.trim() ?? "";
  return html`
    <label class="employee-workbench__settings-field">
      <span class="employee-workbench__settings-field-label">接管的数字人</span>
      <select
        class="employee-workbench__settings-input"
        .value=${selected}
        @change=${(event: Event) =>
          settings.onUserOperationalIdentityEditorGrantAgentIdChange?.(
            (event.currentTarget as HTMLSelectElement).value,
          )}
      >
        <option value="">先选择数字人再绑定</option>
        ${agents.map(
          (agent) => html`
            <option value=${agent.id} ?selected=${agent.id === selected}>
              ${ownedAgentLabel(agent)}
            </option>
          `,
        )}
      </select>
    </label>
  `;
}

function wechatPersonalNativeStatus(
  settings: SettingsContract,
): "offline" | "logged_out" | "logged_in" | "probing" {
  const workerOnline = settings.wechatPersonalQrWorkerOnline;
  const status = settings.wechatPersonalQrStatus ?? "idle";
  if (workerOnline === false || status === "offline") {
    return "offline";
  }
  if (workerOnline && status === "logged_in" && settings.wechatPersonalQrWxid?.trim()) {
    return "logged_in";
  }
  if (workerOnline) {
    return "logged_out";
  }
  return "probing";
}

function wechatPersonalNativeStatusCopy(
  settings: SettingsContract,
  nativeStatus: ReturnType<typeof wechatPersonalNativeStatus>,
): string {
  if (settings.wechatPersonalQrMessage?.trim()) {
    return settings.wechatPersonalQrMessage.trim();
  }
  if (nativeStatus === "offline") {
    return "本机微信通道未连接。请先打开本机 OpenBot 桌面端，再点重新检测。";
  }
  if (nativeStatus === "logged_in") {
    const wxid = settings.wechatPersonalQrWxid?.trim() ?? "";
    return wxid ? `已检测到本机微信：${wxid}` : "已检测到本机微信。";
  }
  if (nativeStatus === "logged_out") {
    return "本机通道已接通，但还没有可用的微信登录态。请先打开并登录本机微信，再点重新检测。";
  }
  return "正在探测本机微信通道…";
}

function wechatPersonalSetupSteps(
  nativeStatus: ReturnType<typeof wechatPersonalNativeStatus>,
): Array<{ key: string; label: string; state: string }> {
  const channelReady = nativeStatus === "logged_out" || nativeStatus === "logged_in";
  const sessionReady = nativeStatus === "logged_in";
  return [
    {
      key: "channel",
      label: "本机通道",
      state: channelReady ? "已接通" : nativeStatus === "probing" ? "检测中" : "未连接",
    },
    {
      key: "session",
      label: "微信登录态",
      state: sessionReady ? "已检测到" : channelReady ? "未就绪" : "待通道就绪",
    },
    {
      key: "bind",
      label: "绑定数字人",
      state: sessionReady ? "可绑定" : "待登录后开放",
    },
  ];
}

function renderWechatPersonalSetupGuide(
  settings: SettingsContract,
  nativeStatus: ReturnType<typeof wechatPersonalNativeStatus>,
): TemplateResult {
  const busy = Boolean(settings.userOperationalIdentityBusy);
  const steps = wechatPersonalSetupSteps(nativeStatus);
  const guide =
    nativeStatus === "offline"
      ? [
          "打开本机 OpenBot 桌面端并保持运行。",
          "点「重新检测」。",
          "仍未接通时，改用公众号或邮箱，或联系已配置本机通道的人。",
        ]
      : [
          "打开并登录本机微信。",
          "保持 OpenBot 桌面端在运行。",
          "点「重新检测」。出现「已检测到本机微信」后再绑定。",
          "多次检测仍未就绪时，改用公众号或邮箱，或联系已配置本机通道的人。",
        ];
  return html`
    <ol class="employee-workbench__wechat-native-steps" data-wechat-personal-setup-steps>
      ${steps.map(
        (step) => html`
          <li class="employee-workbench__wechat-native-step" data-wechat-personal-setup-step=${step.key}>
            <span class="employee-workbench__wechat-native-step-label">${step.label}</span>
            <span class="employee-workbench__wechat-native-step-state">${step.state}</span>
          </li>
        `,
      )}
    </ol>
    <ol class="employee-workbench__wechat-native-guide" data-wechat-personal-setup-guide>
      ${guide.map((item) => html`<li>${item}</li>`)}
    </ol>
    <div class="employee-workbench__auth-config-footer">
      <div class="employee-workbench__auth-config-footer-rail">
        <div
          class="employee-workbench__settings-password-actions employee-workbench__auth-config-actions"
        >
          <button
            type="button"
            class="btn"
            data-wechat-personal-recheck
            ?disabled=${busy}
            @click=${() => settings.onRecheckWechatPersonalChannel?.()}
          >
            ${busy ? "检测中…" : "重新检测"}
          </button>
          <button
            type="button"
            class="btn"
            @click=${() => settings.onUserOperationalIdentityNavChange?.("bound")}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderWechatPersonalQrForm(
  settings: SettingsContract,
  entry: CatalogEntry | null,
): TemplateResult {
  const busy = Boolean(settings.userOperationalIdentityBusy);
  const nativeStatus = wechatPersonalNativeStatus(settings);
  const loggedIn = nativeStatus === "logged_in";
  return html`
    <div class="employee-workbench__auth-pane-head">
      <div class="employee-workbench__settings-section-title">
        ${entry?.label ?? "微信个人号"}
      </div>
    </div>
    <div
      class="employee-workbench__settings-control employee-workbench__auth-config-form"
      data-wechat-personal-native-mode
    >
      ${renderConfiguredIdentityBanner(settings)}
      ${renderCatalogMeta(entry, { editing: Boolean(settings.userOperationalIdentityEditorIdentityId) })}
      <div
        class="employee-workbench__auth-config-callout"
        data-wechat-personal-worker-status=${nativeStatus}
      >
        ${wechatPersonalNativeStatusCopy(settings, nativeStatus)}
      </div>
      <div class="employee-workbench__settings-section-subtitle">
        这是微信个人号本机登录态绑定，不是公众号或企微。通道进程跑在你的电脑上，会话不会写入云端 Gateway。
      </div>
      ${
        loggedIn
          ? html`
              ${renderDisplayNameField(settings)}
              ${renderOwnedBotGrantPicker(settings)}
              ${renderFormActions({
                submitLabel: "绑定当前已登录微信",
                busy,
                disabled:
                  (settings.ownedAgents?.length ?? 0) > 0 &&
                  !settings.userOperationalIdentityEditorGrantAgentId?.trim(),
                onSubmit: () => settings.onSubmitUserOperationalIdentityEditor?.(),
                onCancel: () => settings.onUserOperationalIdentityNavChange?.("bound"),
              })}
            `
          : renderWechatPersonalSetupGuide(settings, nativeStatus)
      }
    </div>
  `;
}

function renderUnsupportedProviderForm(providerLabel: string): TemplateResult {
  return html`
    <div class="employee-workbench__auth-pane-head">
      <div class="employee-workbench__settings-section-title">${providerLabel || "添加身份"}</div>
    </div>
    <div class="employee-workbench__settings-section-subtitle">
      该身份暂无可用配置表单，请从左侧选择其他身份。
    </div>
  `;
}

/** Render the right-pane identity editor using provider-specific configuration UX. */
export function renderProviderIdentityEditorForm(settings: SettingsContract): TemplateResult {
  const snapshot = settings.userOperationalIdentitySnapshot;
  const catalog = snapshot?.providerCatalog ?? [];
  const selectedProvider = settings.userOperationalIdentityEditorProvider ?? "";
  const entry = catalog.find((item) => item.provider === selectedProvider) ?? null;
  const manualKind =
    entry?.manualKind ??
    (selectedProvider === "wechat-official"
      ? "wechat_oa"
      : selectedProvider === "personal-email"
        ? "smtp"
        : null);
  const authMode =
    entry?.authMode ??
    (selectedProvider === "wechat-official" || selectedProvider === "personal-email"
      ? "manual"
      : "oauth");

  if (!selectedProvider) {
    return renderUnsupportedProviderForm("");
  }
  if (authMode === "qr_channel" || selectedProvider === "wechat-personal") {
    return renderWechatPersonalQrForm(settings, entry);
  }
  if (manualKind === "wechat_oa" || selectedProvider === "wechat-official") {
    return renderWechatOfficialForm(settings, entry);
  }
  if (manualKind === "smtp" || selectedProvider === "personal-email") {
    return renderPersonalEmailForm(settings, entry);
  }
  if (selectedProvider === "github-personal" || (authMode === "oauth" && !manualKind)) {
    if (selectedProvider === "github-personal" || selectedProvider === "x-twitter") {
      return renderOauthPersonalForm(settings, entry, selectedProvider);
    }
    return renderUnsupportedProviderForm(entry?.label ?? selectedProvider);
  }
  if (manualKind === "social_account") {
    return renderSocialAccountForm(settings, entry, selectedProvider);
  }
  return renderUnsupportedProviderForm(entry?.label ?? selectedProvider);
}
