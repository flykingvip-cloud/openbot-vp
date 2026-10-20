import { html, type TemplateResult } from "lit";

export type WebsiteAccessBindingOption = {
  bindingId: string;
};

export type WebsiteAccessWizardState = {
  outcome: "select_existing" | "owner_must_authorize" | null;
  selectable: WebsiteAccessBindingOption[];
  bindingId: string;
  draftBindingId: string;
  busy: boolean;
};

export function renderWebsiteAccessWizard(
  state: WebsiteAccessWizardState,
  handlers: {
    onSelectBinding: (bindingId: string) => void;
    onDraftBinding: (bindingId: string) => void;
    onRegisterOwnedBinding: () => void;
  },
): TemplateResult {
  const guidance = state.outcome !== "select_existing";
  return html`
    <div class="edc-form-section">
      <div class="edc-form-section__title">网站授权</div>
      <p class="muted">
        选择本账户已经登记的 AccountBinding。私人账户不会因为企业管理员身份自动共享，这里不导出 Cookie。
      </p>
      ${
        state.selectable.length > 0
          ? html`
              <label class="field full">
                <span>已有授权</span>
                <select
                  .value=${state.bindingId}
                  ?disabled=${state.busy}
                  @change=${(event: Event) =>
                    handlers.onSelectBinding((event.target as HTMLSelectElement).value)}
                >
                  <option value="">请选择授权</option>
                  ${state.selectable.map(
                    (binding) => html`
                      <option value=${binding.bindingId}>${binding.bindingId}</option>
                    `,
                  )}
                </select>
              </label>
            `
          : html``
      }
      ${
        guidance
          ? html`
              <div class="enterprise-data-capability__hint" role="status">
                当前没有可选择的授权。请账户所有者本人登录后登记自己的
                AccountBinding。管理员不能改用他人的私人账户。
              </div>
            `
          : html``
      }
      <label class="field">
        <span>我是账户所有者，登记已有授权</span>
        <input
          .value=${state.draftBindingId}
          ?disabled=${state.busy}
          placeholder="AccountBinding.bindingId"
          @input=${(event: Event) =>
            handlers.onDraftBinding((event.target as HTMLInputElement).value)}
        />
      </label>
      <button
        class="btn btn--sm"
        type="button"
        ?disabled=${state.busy || state.draftBindingId.trim().length === 0}
        @click=${handlers.onRegisterOwnedBinding}
      >
        登记我的授权
      </button>
    </div>
  `;
}
