import { html, nothing, type TemplateResult } from "lit";
import type { QuickSavePatternHint } from "../capability/employee-capability/endpoints.ts";
import type { QuickCapabilitySaveFormData } from "../capability/employee-capability/types.ts";

export type QuickCapabilitySaveModalProps = {
  open: boolean;
  busy: boolean;
  error: string | null;
  formData: QuickCapabilitySaveFormData;
  patternHint: QuickSavePatternHint | null;
  onFormChange: (patch: Partial<QuickCapabilitySaveFormData>) => void;
  onSubmit: () => void;
  onClose: () => void;
};

function renderHint(patternHint: QuickSavePatternHint | null): TemplateResult {
  return html`
    <section class="quick-capability-save-modal__hint" aria-label="可复用能力提示">
      <strong>检测到可复用的能力</strong>
      <p>
        ${
          patternHint?.sampleTaskDescription
            ? patternHint.sampleTaskDescription
            : "系统正在帮你整理这次工作中可复用的部分。"
        }
      </p>
    </section>
  `;
}

export function renderQuickCapabilitySaveModal(
  props: QuickCapabilitySaveModalProps,
): TemplateResult | typeof nothing {
  if (!props.open) {
    return nothing;
  }

  return html`
    <div class="quick-capability-save-modal" role="dialog" aria-modal="true">
      <div class="quick-capability-save-modal__panel">
        <header class="quick-capability-save-modal__header">
          <h2>保存为我的能力积累</h2>
          <button type="button" aria-label="关闭" @click=${props.onClose}>×</button>
        </header>
        ${renderHint(props.patternHint)}
        ${
          props.error
            ? html`<p class="quick-capability-save-modal__error" role="alert">${props.error}</p>`
            : nothing
        }
        <label class="quick-capability-save-modal__field">
          <span>名称</span>
          <input
            type="text"
            .value=${props.formData.name}
            ?disabled=${props.busy}
            @input=${(event: InputEvent) =>
              props.onFormChange({ name: (event.target as HTMLInputElement).value })}
          />
        </label>
        <label class="quick-capability-save-modal__field">
          <span>一句话描述</span>
          <textarea
            .value=${props.formData.summary}
            ?disabled=${props.busy}
            @input=${(event: InputEvent) =>
              props.onFormChange({ summary: (event.target as HTMLTextAreaElement).value })}
          ></textarea>
        </label>
        <footer class="quick-capability-save-modal__actions">
          <button type="button" ?disabled=${props.busy} @click=${props.onClose}>取消</button>
          <button type="button" ?disabled=${props.busy} @click=${props.onSubmit}>
            ${props.busy ? "保存中…" : "保存"}
          </button>
        </footer>
      </div>
    </div>
  `;
}
