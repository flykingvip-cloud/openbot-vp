/**
 * MCP 映射引导模态框：预填 key/name/desc/mcp://，仅显式保存才写入。
 */
import { html, nothing, type TemplateResult } from "lit";
import { validateMcpMappingWizardDraft, type McpMappingWizardDraft } from "./mcp-mapping-wizard.ts";

export type McpMappingWizardEditorState = McpMappingWizardDraft & {
  open: boolean;
  busy: boolean;
  error: string | null;
};

export function renderMcpMappingWizardModal(
  state: McpMappingWizardEditorState,
  onClose: () => void,
  onSubmit: () => void,
  onUpdate: (patch: Partial<McpMappingWizardEditorState>) => void,
): TemplateResult {
  if (!state.open) {
    return html`${nothing}`;
  }
  const validation = validateMcpMappingWizardDraft(state);
  return html`
    <div
      class="enterprise-org-modal-overlay"
      @click=${(event: MouseEvent) => {
        if (event.target === event.currentTarget && !state.busy) {
          onClose();
        }
      }}
    >
      <section
        class="enterprise-org-modal"
        role="dialog"
        aria-modal="true"
        aria-label="MCP 工具映射"
      >
        <div class="enterprise-org-modal__header">
          <div>
            <div class="enterprise-org-modal__title">映射为数据能力</div>
            <div class="enterprise-org-modal__sub">
              将 MCP 工具登记为连接器动作与数据能力。打开本引导不会写入；仅点击「保存映射」后才会创建绑定。不会自动授权席位。
            </div>
          </div>
          <button class="btn btn--sm" type="button" ?disabled=${state.busy} @click=${onClose}>
            取消
          </button>
        </div>
        <div class="enterprise-org-modal__body">
          <div class="edc-form-section">
            <div class="edc-form-section__title">MCP 上下文</div>
            <div class="form-grid">
              <label class="field">
                <span>MCP 服务</span>
                <input .value=${state.mcpServer} readonly disabled />
              </label>
              <label class="field">
                <span>工具名</span>
                <input .value=${state.mcpTool} readonly disabled />
              </label>
              <label class="field full">
                <span>处理器 (mcp://)</span>
                <input .value=${state.handlerRef} readonly disabled />
              </label>
            </div>
          </div>
          <div class="edc-form-section">
            <div class="edc-form-section__title">能力定义</div>
            <div class="form-grid">
              <label class="field">
                <span>能力标识</span>
                <input
                  .value=${state.capabilityKey}
                  ?disabled=${state.busy}
                  @input=${(event: Event) =>
                    onUpdate({ capabilityKey: (event.target as HTMLInputElement).value })}
                />
              </label>
              <label class="field">
                <span>显示名称</span>
                <input
                  .value=${state.displayName}
                  ?disabled=${state.busy}
                  @input=${(event: Event) =>
                    onUpdate({ displayName: (event.target as HTMLInputElement).value })}
                />
              </label>
              <label class="field full">
                <span>描述</span>
                <textarea
                  class="enterprise-org-modal__textarea"
                  .value=${state.description}
                  ?disabled=${state.busy}
                  @input=${(event: Event) =>
                    onUpdate({ description: (event.target as HTMLTextAreaElement).value })}
                ></textarea>
              </label>
            </div>
          </div>
          ${
            state.error
              ? html`<p class="enterprise-org-modal__error" role="alert">${state.error}</p>`
              : nothing
          }
          ${
            !validation.ok && !state.error
              ? html`<p class="enterprise-org-modal__hint">${validation.message}</p>`
              : nothing
          }
        </div>
        <div class="enterprise-org-modal__footer">
          <button class="btn" type="button" ?disabled=${state.busy} @click=${onClose}>取消</button>
          <button
            class="btn primary"
            type="button"
            ?disabled=${state.busy || !validation.ok}
            @click=${onSubmit}
          >
            ${state.busy ? "保存中…" : "保存映射"}
          </button>
        </div>
      </section>
    </div>
  `;
}
