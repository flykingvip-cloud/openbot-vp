import { html, nothing } from "lit";
import type { EnterpriseOperationalIdentityRegistrationProfile } from "../../../controllers/enterprise-operational-identity.ts";

export function renderEnterpriseIdentityCredentialEditPanel(params: {
  profile: EnterpriseOperationalIdentityRegistrationProfile;
  provider: string;
  providerLabel: string;
  variant?: "create" | "edit";
  fieldsReady?: boolean;
  externalAccountId?: string;
  credentialFields: Record<string, string>;
  credentialSecretsConfigured?: string[];
  gatewayEgressIp?: string | null;
  reauthHint?: string | null;
  busy: boolean;
  onCredentialFieldChange: (key: string, value: string) => void;
  oauth?: {
    label: string;
    disabled: boolean;
    title?: string;
    hint?: string;
    onClick: () => void;
  };
}) {
  const manualFields = params.profile.manualFields ?? [];
  if (manualFields.length === 0 && !params.oauth) {
    return nothing;
  }
  const variant = params.variant ?? "edit";
  const secretsConfigured = params.credentialSecretsConfigured ?? [];
  const resolvedAppId =
    params.credentialFields.appId?.trim() || params.externalAccountId?.trim() || "";

  if (params.fieldsReady === false) {
    return html`
      <section class="enterprise-identity-credential-edit">
        <p class="enterprise-identity-credential-edit__lead">正在加载已保存的凭证…</p>
      </section>
    `;
  }

  const wechatOfficial = params.provider === "wechat-official";
  const reauthHint = params.reauthHint?.trim() || "";
  return html`
    <section class="enterprise-identity-credential-edit">
      ${
        variant === "create"
          ? nothing
          : resolvedAppId
            ? html`<div class="enterprise-identity-credential-edit__callout" data-identity-configured-banner>
                已配置 · <span class="mono">${resolvedAppId}</span>
              </div>`
            : html`<p class="enterprise-identity-credential-edit__lead">
                更新 ${params.providerLabel} 调用凭证。密钥留空将保留已保存的值。
              </p>`
      }
      ${
        reauthHint
          ? html`<div class="enterprise-identity-credential-edit__callout">${reauthHint}</div>`
          : nothing
      }
      <div class="enterprise-identity-credential-edit__fields">
        ${manualFields.map((field) => {
          const inputType =
            field.kind === "password"
              ? "password"
              : field.kind === "email"
                ? "email"
                : field.kind === "url"
                  ? "url"
                  : field.kind === "number"
                    ? "number"
                    : "text";
          const configuredSecret = secretsConfigured.includes(field.key);
          const value =
            field.key === "appId"
              ? params.credentialFields[field.key]?.trim() || resolvedAppId
              : (params.credentialFields[field.key] ?? "");
          const wechatPlaceholder =
            wechatOfficial && field.key === "appId"
              ? "wx 开头的 AppID"
              : wechatOfficial && field.key === "appSecret"
                ? variant === "edit"
                  ? "留空则保持原凭证"
                  : "开发者密码（仅显示一次）"
                : undefined;
          const placeholder =
            wechatPlaceholder ??
            (field.kind === "password" && configuredSecret && !value.trim()
              ? "留空则保持原凭证"
              : undefined);
          return html`
            <label class="enterprise-identity-credential-edit__field">
              <span class="enterprise-identity-credential-edit__label"
                >${field.label}${field.required ? " *" : ""}</span
              >
              <input
                class="enterprise-identity-credential-edit__input${wechatOfficial ? " mono" : ""}"
                type=${inputType}
                name=${field.key}
                .value=${value}
                placeholder=${placeholder ?? ""}
                ?disabled=${params.busy}
                @input=${(event: Event) =>
                  params.onCredentialFieldChange(
                    field.key,
                    (event.target as HTMLInputElement).value,
                  )}
              />
              ${
                field.hint
                  ? html`<small class="enterprise-identity-credential-edit__hint">${field.hint}</small>`
                  : nothing
              }
            </label>
          `;
        })}
      </div>
      ${
        wechatOfficial && params.gatewayEgressIp
          ? html`<div class="enterprise-identity-credential-edit__callout" data-identity-egress-ip>
              出口 IP <span class="mono">${params.gatewayEgressIp}</span> · 加入公众号 IP 白名单后认证
            </div>`
          : wechatOfficial
            ? html`
                <div class="enterprise-identity-credential-edit__callout" data-identity-egress-ip>
                  请将网关出口 IP 加入公众号 IP 白名单后再认证
                </div>
              `
            : nothing
      }
      ${
        params.oauth
          ? html`<div class="enterprise-identity-credential-edit__oauth">
              <button
                class="btn btn--sm btn--primary"
                type="button"
                data-oauth-external="true"
                ?disabled=${params.busy || params.oauth.disabled}
                title=${params.oauth.title ?? ""}
                @click=${params.oauth.onClick}
              >
                ${params.oauth.label}
              </button>
              ${
                params.oauth.hint
                  ? html`<p class="enterprise-identity-credential-edit__oauth-hint">
                      ${params.oauth.hint}
                    </p>`
                  : nothing
              }
            </div>`
          : nothing
      }
    </section>
  `;
}
