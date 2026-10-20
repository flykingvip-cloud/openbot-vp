import { html, nothing } from "lit";
import { IDENTITY_PROVIDER_CATEGORY_LABELS } from "../semantic/enterprise-identity-inventory.ts";
import type { EnterprisePortReadModel } from "../semantic/enterprise-read-model.ts";

export function renderIdentityRegisterProviderPicker(params: {
  catalog: EnterprisePortReadModel["identityProviderCatalog"];
  busy: boolean;
  onSelect: (provider: string) => void;
}) {
  const categories = ["official", "communication", "business"] as const;
  return html`
    <p class="enterprise-settings-panel__sub">选择要接入的平台通道，再绑定凭证。</p>
    ${categories.map((category) => {
      const entries = params.catalog.filter((entry) => entry.category === category);
      if (entries.length === 0) {
        return nothing;
      }
      return html`
        <div class="enterprise-identity-register-category">
          <div class="enterprise-identity-register-category__title">
            ${IDENTITY_PROVIDER_CATEGORY_LABELS[category]}
          </div>
          <div class="enterprise-identity-register-provider-grid">
            ${entries.map(
              (entry) => html`
                <button
                  class="enterprise-identity-register-provider${!entry.registrationReady ? " enterprise-identity-register-provider--disabled" : ""}"
                  type="button"
                  ?disabled=${params.busy || !entry.registrationReady}
                  title=${
                    entry.registrationReady
                      ? (entry.degradedHint ?? "")
                      : (entry.degradedHint ?? "暂未开放注册")
                  }
                  @click=${() => params.onSelect(entry.provider)}
                >
                  <span class="enterprise-identity-register-provider__name">${entry.label}</span>
                  ${
                    entry.registrationReady
                      ? nothing
                      : html`
                          <span class="enterprise-identity-register-provider__hint">暂未开放</span>
                        `
                  }
                </button>
              `,
            )}
          </div>
        </div>
      `;
    })}
  `;
}
