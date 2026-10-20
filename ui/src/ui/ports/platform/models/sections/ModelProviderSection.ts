import { html } from "lit";
import type { PlatformModelProviderUpdateInput } from "../../render-actions.ts";
import type { PlatformPortRenderModel } from "../../view-types.ts";
import type { LegacyPlatformModelsVM as PlatformModelsVM } from "../view-model.ts";

function formText(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function formProviderInput(form: HTMLFormElement): PlatformModelProviderUpdateInput | null {
  const data = new FormData(form);
  const providerId = formText(data, "providerId");
  if (!providerId) {
    return null;
  }
  return {
    providerId,
    baseUrl: formText(data, "baseUrl"),
    api: formText(data, "api") || "openai-responses",
    auth: formText(data, "auth") || "api-key",
    apiKey: formText(data, "apiKey"),
  };
}

export function renderModelProviderSection(
  vm: PlatformModelsVM,
  actions: PlatformPortRenderModel["surfaceActions"],
) {
  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
    if (!form) {
      return;
    }
    const input = formProviderInput(form);
    if (input) {
      actions.models.onUpdateProvider(input);
    }
  };

  const onRemoveProvider = (providerId: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`确认删除 provider ${providerId} 及其全部模型？`)
    ) {
      return;
    }
    actions.models.onRemoveProvider(providerId);
  };

  return html`
    <section class="card card-follow">
      <div class="card-title">Provider 管理</div>
      <div class="list card-follow">
        ${
          vm.providerEntries.length === 0
            ? html`
                <div class="muted">当前没有已配置 provider。先在下方模型池中新增 provider/model。</div>
              `
            : vm.providerEntries.map(
                (provider) => html`
                  <details class="list-item list-item--details">
                    <summary>
                      <div class="row row--split">
                        <div class="list-main">
                          <div class="list-title">${provider.providerId}</div>
                          <div class="list-sub">
                            ${provider.baseUrl} · ${provider.api} · ${provider.auth}
                          </div>
                        </div>
                        <div class="list-meta">${provider.modelCount} 个模型</div>
                      </div>
                    </summary>
                    <form class="card-follow" @submit=${onSubmit}>
                      <input type="hidden" name="providerId" .value=${provider.providerId} />
                      <div class="grid grid-cols-3">
                        <label class="field">
                          <span>Provider ID</span>
                          <input .value=${provider.providerId} disabled />
                        </label>
                        <label class="field">
                          <span>Base URL</span>
                          <input
                            name="baseUrl"
                            .value=${provider.baseUrlRaw}
                            ?disabled=${!vm.canManage}
                          />
                        </label>
                        <label class="field">
                          <span>API 类型</span>
                          <select name="api" .value=${provider.api} ?disabled=${!vm.canManage}>
                            <option value="openai-responses">openai-responses</option>
                            <option value="openai-completions">openai-completions</option>
                            <option value="anthropic-messages">anthropic-messages</option>
                            <option value="google-generative-ai">google-generative-ai</option>
                            <option value="bedrock-converse-stream">bedrock-converse-stream</option>
                            <option value="ollama">ollama</option>
                          </select>
                        </label>
                        <label class="field">
                          <span>鉴权模式</span>
                          <select name="auth" .value=${provider.auth} ?disabled=${!vm.canManage}>
                            <option value="api-key">api-key</option>
                            <option value="oauth">oauth</option>
                            <option value="token">token</option>
                            <option value="aws-sdk">aws-sdk</option>
                          </select>
                        </label>
                        <label class="field">
                          <span>API 密钥</span>
                          <input
                            type="password"
                            name="apiKey"
                            autocomplete="off"
                            placeholder="留空表示保留现有密钥"
                            ?disabled=${!vm.canManage}
                          />
                        </label>
                      </div>
                      <div class="row row--end row--tight card-follow--sm">
                        <button
                          class="btn"
                          type="button"
                          ?disabled=${!vm.canManage}
                          @click=${() => onRemoveProvider(provider.providerId)}
                        >
                          删除 Provider
                        </button>
                        <button class="btn primary" type="submit" ?disabled=${!vm.canManage}>
                          更新 Provider
                        </button>
                      </div>
                    </form>
                  </details>
                `,
              )
        }
      </div>
    </section>
  `;
}
