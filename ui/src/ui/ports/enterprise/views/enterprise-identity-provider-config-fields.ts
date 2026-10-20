import { html, nothing } from "lit";
import type { EnterpriseOperationalIdentityRegistrationProfile } from "../../../controllers/enterprise-operational-identity.ts";

export function renderEnterpriseIdentityProviderConfigPanel(params: {
  profile: EnterpriseOperationalIdentityRegistrationProfile | null | undefined;
  providerLabel: string;
  credentialFields: Record<string, string>;
  credentialSecretsConfigured?: string[];
  busy: boolean;
  onCredentialFieldChange: (key: string, value: string) => void;
  onSaveCredential?: () => void;
  showManualForm?: boolean;
}) {
  const {
    profile,
    providerLabel,
    credentialFields,
    credentialSecretsConfigured = [],
    busy,
    onCredentialFieldChange,
    onSaveCredential,
  } = params;
  if (!profile) {
    return nothing;
  }
  const showManualForm = params.showManualForm !== false && profile.methods.includes("manual");

  return html`
    <section class="enterprise-identity-config-panel">
      <div class="enterprise-identity-config-panel__title">AI 调用所需配置 · ${providerLabel}</div>
      <p class="enterprise-identity-config-panel__summary">${profile.summary}</p>

      ${
        profile.actionRequirements.length > 0
          ? html`<div class="enterprise-identity-config-panel__section">
              <div class="enterprise-identity-config-panel__section-title">运营动作依赖</div>
              <ul class="enterprise-identity-config-panel__list">
                ${profile.actionRequirements.map(
                  (entry) => html`
                    <li>
                      <strong>${entry.action}</strong>
                      ${
                        entry.requiredFieldKeys.length > 0
                          ? html` · 需 ${entry.requiredFieldKeys.join("、")}`
                          : html`
                              · OAuth 凭证
                            `
                      }
                    </li>
                  `,
                )}
              </ul>
            </div>`
          : nothing
      }

      ${
        profile.methods.includes("oauth")
          ? html`<div class="enterprise-identity-config-panel__hint">
              ${profile.oauthHint ?? "请使用 OAuth 完成授权，系统将自动写入调用凭证。"}
            </div>`
          : nothing
      }

      ${
        showManualForm && profile.manualFields && profile.manualFields.length > 0
          ? html`<div class="enterprise-identity-config-panel__section">
              <div class="enterprise-identity-config-panel__section-title">手动填写凭证</div>
              ${profile.manualFields.map((field) => {
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
                const configuredSecret = credentialSecretsConfigured.includes(field.key);
                const placeholder =
                  field.kind === "password" &&
                  configuredSecret &&
                  !credentialFields[field.key]?.trim()
                    ? "已保存（留空表示不修改）"
                    : undefined;
                return html`
                  <label class="enterprise-settings-field">
                    <span>${field.label}${field.required ? " *" : ""}</span>
                    <input
                      type=${inputType}
                      .value=${credentialFields[field.key] ?? ""}
                      placeholder=${placeholder ?? ""}
                      ?disabled=${busy}
                      @input=${(event: Event) =>
                        onCredentialFieldChange(
                          field.key,
                          (event.target as HTMLInputElement).value,
                        )}
                    />
                    ${
                      field.hint
                        ? html`<small>${field.hint}</small>`
                        : configuredSecret
                          ? html`
                              <small>已配置；留空将保留现有密钥。</small>
                            `
                          : nothing
                    }
                  </label>
                `;
              })}
              ${
                onSaveCredential
                  ? html`<div class="enterprise-settings-actionbar enterprise-settings-actionbar--block">
                      <button
                        class="btn btn--sm btn--primary"
                        type="button"
                        ?disabled=${busy}
                        @click=${onSaveCredential}
                      >
                        保存凭证配置
                      </button>
                    </div>`
                  : nothing
              }
            </div>`
          : nothing
      }

      ${
        profile.verifyChecks.length > 0
          ? html`<div class="enterprise-identity-config-panel__section">
              <div class="enterprise-identity-config-panel__section-title">连接测试将检查</div>
              <ul class="enterprise-identity-config-panel__checks">
                ${profile.verifyChecks.map((check) => html`<li>${check.label}</li>`)}
              </ul>
            </div>`
          : nothing
      }
    </section>
  `;
}

export function renderEnterpriseIdentityConfigChecklist(params: {
  profile: EnterpriseOperationalIdentityRegistrationProfile | null | undefined;
  externalAccountId?: string;
  readinessItems?: Array<{
    key: string;
    label: string;
    satisfied: boolean;
    scope?: "field" | "verify" | "identity";
    detail?: string;
  }>;
  probedAt?: string;
}) {
  const { profile, externalAccountId, readinessItems, probedAt } = params;
  if (!profile && !readinessItems?.length) {
    return nothing;
  }
  if (readinessItems?.length) {
    return html`
      <div class="enterprise-identity-config-panel__section">
        <div class="enterprise-identity-config-panel__section-title">配置就绪状态</div>
        <ul class="enterprise-identity-config-panel__checks">
          ${readinessItems.map(
            (item) => html`
              <li
                class=${
                  item.satisfied
                    ? "enterprise-identity-config-panel__check--ok"
                    : "enterprise-identity-config-panel__check--pending"
                }
              >
                ${item.satisfied ? "✓" : "○"} ${item.label}
                ${item.detail ? html`<span class="enterprise-identity-config-panel__check-detail">${item.detail}</span>` : nothing}
              </li>
            `,
          )}
        </ul>
        ${
          probedAt
            ? html`<p class="enterprise-identity-config-panel__hint">最近探测：${probedAt}</p>`
            : html`
                <p class="enterprise-identity-config-panel__hint">尚未执行连接测试；字段状态为静态评估。</p>
              `
        }
      </div>
    `;
  }
  const oauthOnly = profile!.methods.includes("oauth") && !profile!.methods.includes("manual");
  return html`
    <div class="enterprise-identity-config-panel__section">
      <div class="enterprise-identity-config-panel__section-title">配置项清单</div>
      <ul class="enterprise-identity-config-panel__checks">
        ${
          oauthOnly
            ? html`<li>${externalAccountId ? "✓" : "○"} OAuth 授权（${externalAccountId ? externalAccountId : "未完成"}）</li>`
            : nothing
        }
        ${(profile!.manualFields ?? []).map(
          (field) => html`<li>○ ${field.label}${field.required ? "（必填）" : "（可选）"}</li>`,
        )}
      </ul>
      <p class="enterprise-identity-config-panel__summary">${profile!.summary}</p>
    </div>
  `;
}

export function renderEnterpriseIdentityCapabilityPanel(params: {
  capabilities?: string[];
  capabilityMissing?: string[];
  capabilityDetails?: Array<{
    action: string;
    label: string;
    risk: "low" | "medium" | "high";
    enabled: boolean;
    alias?: string;
  }>;
  actionLabels?: Map<string, string>;
  providerMetadata?: Record<string, string>;
  discoveredAt?: string;
}) {
  const {
    capabilities,
    capabilityMissing,
    capabilityDetails,
    actionLabels,
    providerMetadata,
    discoveredAt,
  } = params;
  if (!capabilities?.length && !capabilityMissing?.length && !capabilityDetails?.length) {
    return nothing;
  }
  const labelFor = (action: string) => actionLabels?.get(action) ?? action;
  const rows =
    capabilityDetails && capabilityDetails.length > 0
      ? capabilityDetails
      : [
          ...(capabilities ?? []).map((action) => ({
            action,
            label: labelFor(action),
            risk: "medium" as const,
            enabled: true,
          })),
          ...(capabilityMissing ?? []).map((action) => ({
            action,
            label: labelFor(action),
            risk: "medium" as const,
            enabled: false,
          })),
        ];
  return html`
    <div class="enterprise-identity-config-panel__section">
      <div class="enterprise-identity-config-panel__section-title">Agent 可用能力</div>
      <ul class="enterprise-identity-config-panel__checks">
        ${rows.map(
          (row) => html`
            <li
              class=${
                row.enabled
                  ? "enterprise-identity-config-panel__check--ok"
                  : "enterprise-identity-config-panel__check--pending"
              }
            >
              ${row.enabled ? "✓" : "○"} ${row.label}
              ${
                row.risk === "high"
                  ? html`
                      <span class="enterprise-identity-config-panel__check-detail">高风险</span>
                    `
                  : nothing
              }
            </li>
          `,
        )}
      </ul>
      ${
        providerMetadata && Object.keys(providerMetadata).length > 0
          ? html`<dl class="enterprise-identity-detail__kv">
              ${Object.entries(providerMetadata).map(
                ([key, value]) => html`
                  <div>
                    <dt>${key}</dt>
                    <dd>${value}</dd>
                  </div>
                `,
              )}
            </dl>`
          : nothing
      }
      ${
        discoveredAt
          ? html`<p class="enterprise-identity-config-panel__hint">能力检测时间：${discoveredAt}</p>`
          : nothing
      }
    </div>
  `;
}
