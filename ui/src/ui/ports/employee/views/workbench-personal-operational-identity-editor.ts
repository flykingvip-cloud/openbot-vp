import { html } from "lit";
import type { SettingsContract } from "./workbench-stage-contracts.ts";

export function renderPersonalOperationalIdentityEditor(
  settings: SettingsContract,
  catalog: NonNullable<SettingsContract["userOperationalIdentitySnapshot"]>["providerCatalog"],
  busy: boolean,
) {
  return html`
    <div class="employee-workbench__identity-editor">
      <div class="employee-workbench__identity-editor-fields">
        <label class="employee-workbench__settings-field">
          <span class="employee-workbench__settings-field-label">显示名称</span>
          <input
            class="employee-workbench__settings-input"
            .value=${settings.userOperationalIdentityEditorDisplayName ?? ""}
            @input=${(event: Event) =>
              settings.onUserOperationalIdentityEditorDisplayNameChange?.(
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
        <label class="employee-workbench__settings-field">
          <span class="employee-workbench__settings-field-label">Provider</span>
          <select
            class="employee-workbench__settings-input"
            .value=${settings.userOperationalIdentityEditorProvider ?? ""}
            @change=${(event: Event) =>
              settings.onUserOperationalIdentityEditorProviderChange?.(
                (event.currentTarget as HTMLSelectElement).value,
              )}
          >
            <option value="">选择 Provider</option>
            ${catalog.map(
              (entry) => html`
                <option value=${entry.provider} ?disabled=${!entry.registrationReady}>
                  ${entry.label}${entry.registrationReady ? "" : "（暂不支持）"}
                </option>
              `,
            )}
          </select>
        </label>
        <label class="employee-workbench__settings-field">
          <span class="employee-workbench__settings-field-label">外部账号标识</span>
          <input
            class="employee-workbench__settings-input mono"
            .value=${settings.userOperationalIdentityEditorCredentialHandleId ?? ""}
            placeholder="GitHub 用户名 / 邮箱地址（模拟 OAuth）"
            @input=${(event: Event) =>
              settings.onUserOperationalIdentityEditorCredentialHandleIdChange?.(
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
      </div>
      <div class="employee-workbench__identity-editor-footer">
        <button
          type="button"
          class="btn btn--primary"
          ?disabled=${busy}
          @click=${() => void settings.onSubmitUserOperationalIdentityEditor?.()}
        >
          OAuth 绑定
        </button>
        <button
          type="button"
          class="btn"
          ?disabled=${busy}
          @click=${() => settings.onCloseUserOperationalIdentityEditor?.()}
        >
          取消
        </button>
      </div>
    </div>
  `;
}
