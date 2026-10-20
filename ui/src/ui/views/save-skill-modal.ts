import { html, nothing, type TemplateResult } from "lit";
import type {
  ExtractedSkillPreview,
  QuickSaveSkillFormData,
} from "../controllers/skill-lifecycle.ts";

export type SaveSkillModalProps = {
  open: boolean;
  busy: boolean;
  error: string | null;
  formData: QuickSaveSkillFormData | null;
  extractedPreview: ExtractedSkillPreview | null;
  availableGroups: Array<{ id: string; name: string }>;
  preferEnterpriseSubmitAction?: boolean;
  showEnterpriseSubmitAction?: boolean;
  /** When true, panel stays in conversation context (drawer) instead of settings page */
  inlineMode?: boolean;
  assetIncubationLevel?:
    | import("../controllers/asset-incubation/types.ts").AssetIncubationLevel
    | null;
  autofillHint?: string | null;
  onFormChange: (patch: Partial<QuickSaveSkillFormData>) => void;
  onSave: () => void;
  onSaveAndSubmit?: () => void;
  onClose: () => void;
};

function primaryActionLabel(busy: boolean): string {
  return busy ? "整理中…" : "纳入资产草稿";
}

export function renderSaveSkillModal(props: SaveSkillModalProps): TemplateResult | typeof nothing {
  if (!props.open || !props.formData) {
    return nothing;
  }
  const form = props.formData;

  return html`
    <section
      class="employee-workbench__creator-panel quick-save-panel"
      role="region"
      aria-labelledby="quick-save-title"
    >
      <header class="employee-workbench__creator-panel-head quick-save-panel__head">
        <button type="button" class="employee-workbench__creator-panel-back" @click=${props.onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7"></path>
          </svg>
          ${props.inlineMode ? "关闭" : "返回我的资产"}
        </button>
        <h2 class="employee-workbench__creator-panel-title" id="quick-save-title">
          ${props.assetIncubationLevel === "L4" ? "整理为企业资产包" : "整理为资产草稿"}
        </h2>
      </header>
      ${
        props.error
          ? html`<div class="employee-workbench__creator-panel-error">${props.error}</div>`
          : nothing
      }
      <div class="employee-workbench__creator-body quick-save-panel__body">
        ${
          props.autofillHint
            ? html`<div class="quick-save-panel__hint quick-save-panel__hint--autofill">
                标准化建议：${props.autofillHint}
              </div>`
            : nothing
        }
        ${
          props.extractedPreview
            ? html`
                <div class="quick-save-panel__meta">
                  系统识别置信度 ${Math.round(props.extractedPreview.confidence * 100)}%
                </div>
              `
            : nothing
        }
        <label class="quick-save-panel__field">
          <span>资产名称</span>
          <input
            type="text"
            maxlength="80"
            .value=${form.name}
            placeholder="例如：自动生成周报"
            @input=${(event: Event) =>
              props.onFormChange({ name: (event.currentTarget as HTMLInputElement).value })}
          />
        </label>
        <label class="quick-save-panel__field">
          <span>一句话说明</span>
          <textarea
            rows="3"
            maxlength="180"
            .value=${form.summary}
            placeholder="简单说明这个资产能帮你完成什么"
            @input=${(event: Event) =>
              props.onFormChange({ summary: (event.currentTarget as HTMLTextAreaElement).value })}
          ></textarea>
        </label>
        <footer class="quick-save-panel__actions">
          <button type="button" class="btn btn--ghost" @click=${props.onClose}>暂不处理</button>
          ${
            props.showEnterpriseSubmitAction
              ? html`
                  <button
                    type="button"
                    class="btn ${props.preferEnterpriseSubmitAction ? "btn--primary" : ""}"
                    ?disabled=${props.busy || !form.name.trim() || !form.summary.trim()}
                    @click=${() => props.onSaveAndSubmit?.()}
                  >
                    ${props.busy ? "整理中…" : "整理完成并提交企业资产包"}
                  </button>
                `
              : nothing
          }
          <button
            type="button"
            class="btn ${props.preferEnterpriseSubmitAction ? "" : "btn--primary"}"
            ?disabled=${props.busy || !form.name.trim() || !form.summary.trim()}
            @click=${props.onSave}
          >
            ${primaryActionLabel(props.busy)}
          </button>
        </footer>
      </div>
    </section>
  `;
}
