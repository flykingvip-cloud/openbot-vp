import { html, nothing } from "lit";
import type { PlatformModelAddInput } from "../../render-actions.ts";
import type { PlatformPortRenderModel } from "../../view-types.ts";
import type { LegacyPlatformModelsVM as PlatformModelsVM } from "../view-model.ts";

function formText(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Empty / invalid → null (unknown). Never invent 128000 / 8192. */
function formOptionalNumber(form: FormData, name: string): number | null {
  const raw = formText(form, name);
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formModelInput(form: HTMLFormElement): PlatformModelAddInput | null {
  const data = new FormData(form);
  const providerId = formText(data, "providerId");
  const modelId = formText(data, "modelId");
  if (!providerId || !modelId) {
    return null;
  }
  const inputModesRaw = formText(data, "inputModes");
  const inputModes = inputModesRaw
    ? inputModesRaw
        .split(",")
        .map((item) => item.trim())
        .filter((item): item is "text" | "image" => item === "text" || item === "image")
    : [];
  return {
    providerId,
    apiKey: formText(data, "apiKey"),
    baseUrl: formText(data, "baseUrl"),
    modelId,
    name: formText(data, "name") || modelId,
    api: formText(data, "api") || "openai-responses",
    contextWindow: formOptionalNumber(data, "contextWindow"),
    maxTokens: formOptionalNumber(data, "maxTokens"),
    inputModes,
    reasoning: data.get("reasoning") === "on",
  };
}

function formModelUpdateInput(form: HTMLFormElement): PlatformModelAddInput | null {
  return formModelInput(form);
}

function costTierLabel(value: PlatformModelsVM["standardModels"][number]["costTier"]) {
  switch (value) {
    case "low":
      return "低成本";
    case "medium":
      return "中成本";
    case "high":
      return "高成本";
    default:
      return "未归因";
  }
}

export function renderModelPoolSection(
  vm: PlatformModelsVM,
  actions: PlatformPortRenderModel["surfaceActions"],
) {
  const onAddModel = (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
    if (!form) {
      return;
    }
    const input = formModelInput(form);
    if (input) {
      actions.models.onAddModel(input);
      form.reset();
    }
  };
  const onRemoveModel = (providerId: string, modelId: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`确认从平台模型池删除 ${providerId}/${modelId}？`)
    ) {
      return;
    }
    actions.models.onRemoveModel(providerId, modelId);
  };
  const onUpdateModel = (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
    if (!form) {
      return;
    }
    const input = formModelUpdateInput(form);
    if (input) {
      actions.models.onUpdateModel(input);
    }
  };

  return html`
    <section class="card card-follow">
      <div class="row row--split">
        <div>
          <div class="card-title">平台标准模型配置</div>
        </div>
        <div class="row row--tight">
          ${
            vm.configDirty
              ? html`
                  <span class="chip">有未保存配置</span>
                `
              : html`
                  <span class="chip">配置已同步</span>
                `
          }
          <button class="btn" @click=${() => actions.models.onRefreshPool()}>刷新</button>
          <button
            class="btn primary"
            ?disabled=${!vm.canManage || !vm.configDirty || vm.configSaving}
            @click=${() => actions.models.onSaveConfig()}
          >
            ${vm.configSaving ? "保存中" : "保存配置"}
          </button>
        </div>
      </div>
      ${
        vm.canManage
          ? nothing
          : html`
              <div class="callout card-follow">当前会话没有平台配置写入权限，只能查看模型池。</div>
            `
      }
      <form class="card-follow" @submit=${onAddModel}>
        <div class="grid grid-cols-3">
          <label class="field">
            <span>Provider ID</span>
            <input
              name="providerId"
              placeholder="openai / anthropic / openrouter"
              ?disabled=${!vm.canManage}
            />
          </label>
          <label class="field">
            <span>Model ID</span>
            <input name="modelId" placeholder="gpt-5.4" ?disabled=${!vm.canManage} />
          </label>
          <label class="field">
            <span>显示名称</span>
            <input name="name" placeholder="GPT 5.4" ?disabled=${!vm.canManage} />
          </label>
          <label class="field">
            <span>API 类型</span>
            <select name="api" ?disabled=${!vm.canManage}>
              <option value="openai-responses">openai-responses</option>
              <option value="openai-completions">openai-completions</option>
              <option value="anthropic-messages">anthropic-messages</option>
              <option value="google-generative-ai">google-generative-ai</option>
              <option value="bedrock-converse-stream">bedrock-converse-stream</option>
              <option value="ollama">ollama</option>
            </select>
          </label>
          <label class="field">
            <span>Base URL</span>
            <input
              name="baseUrl"
              placeholder="已有 provider 可留空继承"
              ?disabled=${!vm.canManage}
            />
          </label>
          <label class="field">
            <span>输入类型（待确认）</span>
            <input
              name="inputModes"
              value=""
              placeholder="未知，例如 text 或 text,image"
              ?disabled=${!vm.canManage}
            />
          </label>
          <label class="field">
            <span>上下文窗口（待确认）</span>
            <input
              name="contextWindow"
              type="number"
              min="1"
              value=""
              placeholder="未知，勿填臆造默认"
              ?disabled=${!vm.canManage}
            />
          </label>
          <label class="field">
            <span>最大输出（待确认）</span>
            <input
              name="maxTokens"
              type="number"
              min="1"
              value=""
              placeholder="未知"
              ?disabled=${!vm.canManage}
            />
          </label>
          <label class="field">
            <span>推理能力</span>
            <span class="row row--field-height">
              <input name="reasoning" type="checkbox" ?disabled=${!vm.canManage} />
              <span class="muted">支持 reasoning / thinking</span>
            </span>
          </label>
        </div>
        <div class="row row--end card-follow--sm">
          <button class="btn primary" type="submit" ?disabled=${!vm.canManage}>加入模型池</button>
        </div>
      </form>
      <div class="list card-follow">
        ${
          vm.standardModels.length === 0
            ? html`
                <div class="muted">当前没有平台显式配置模型。请通过新增模型接入 provider/model。</div>
              `
            : vm.standardModels.map(
                (model) => html`
                  <details class="list-item list-item--details">
                    <summary>
                      <div class="row row--split">
                        <div class="list-main">
                          <div class="list-title">${model.providerId}/${model.modelId}</div>
                          <div class="list-sub">
                            ${model.name} · ${model.api} · ${model.baseUrl}
                          </div>
                          <div class="chip-row card-follow--sm">
                            <span class="chip">鉴权 ${model.auth}</span>
                            <span class="chip">上下文 ${model.contextWindow}</span>
                            <span class="chip">输出 ${model.maxTokens}</span>
                            <span class="chip">${costTierLabel(model.costTier)}</span>
                            <span class="chip"
                              >输入
                              ${model.inputs.length > 0 ? model.inputs.join(", ") : "未声明"}</span
                            >
                            <span class="chip"
                              >Reasoning
                              ${model.reasoning === null ? "未声明" : model.reasoning ? "支持" : "不支持"}</span
                            >
                            <span class="chip"
                              >Tools
                              ${model.supportsTools === null ? "未声明" : model.supportsTools ? "支持" : "不支持"}</span
                            >
                          </div>
                        </div>
                        <div class="list-meta">展开编辑</div>
                      </div>
                    </summary>
                    <form class="card-follow" @submit=${onUpdateModel}>
                      <input type="hidden" name="providerId" .value=${model.providerId} />
                      <input type="hidden" name="modelId" .value=${model.modelId} />
                      <div class="grid grid-cols-3">
                        <label class="field">
                          <span>显示名称</span>
                          <input name="name" .value=${model.name} ?disabled=${!vm.canManage} />
                        </label>
                        <label class="field">
                          <span>API 类型</span>
                          <select name="api" .value=${model.api} ?disabled=${!vm.canManage}>
                            <option value="openai-responses">openai-responses</option>
                            <option value="openai-completions">openai-completions</option>
                            <option value="anthropic-messages">anthropic-messages</option>
                            <option value="google-generative-ai">google-generative-ai</option>
                            <option value="bedrock-converse-stream">bedrock-converse-stream</option>
                            <option value="ollama">ollama</option>
                          </select>
                        </label>
                        <label class="field">
                          <span>Base URL</span>
                          <input
                            name="baseUrl"
                            .value=${model.baseUrlRaw}
                            ?disabled=${!vm.canManage}
                          />
                        </label>
                        <label class="field">
                          <span>输入类型</span>
                          <input
                            name="inputModes"
                            .value=${model.inputs.join(",")}
                            ?disabled=${!vm.canManage}
                          />
                        </label>
                        <label class="field">
                          <span>上下文窗口</span>
                          <input
                            name="contextWindow"
                            type="number"
                            min="1"
                            .value=${model.contextWindowRaw ? String(model.contextWindowRaw) : ""}
                            ?disabled=${!vm.canManage}
                          />
                        </label>
                        <label class="field">
                          <span>最大输出</span>
                          <input
                            name="maxTokens"
                            type="number"
                            min="1"
                            .value=${model.maxTokensRaw ? String(model.maxTokensRaw) : ""}
                            ?disabled=${!vm.canManage}
                          />
                        </label>
                        <label class="field">
                          <span>推理能力</span>
                          <span class="row row--field-height">
                            <input
                              name="reasoning"
                              type="checkbox"
                              ?checked=${model.reasoning === true}
                              ?disabled=${!vm.canManage}
                            />
                            <span class="muted">支持 reasoning / thinking</span>
                          </span>
                        </label>
                      </div>
                      <div class="row row--end row--tight card-follow--sm">
                        <button
                          class="btn"
                          type="button"
                          ?disabled=${!vm.canManage}
                          @click=${() => onRemoveModel(model.providerId, model.modelId)}
                        >
                          删除
                        </button>
                        <button class="btn primary" type="submit" ?disabled=${!vm.canManage}>
                          更新模型
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
