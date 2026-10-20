/**
 * OGUI Form P0 renderer (lit/html) — single_select + submit.
 *
 * Selection only updates draft / composer preview; 「提交」 builds an
 * ogui-answer user turn and calls onSubmitForm → handleSendChat / chat.send.
 * Does not replace Interactive Choice Follow-up (#665).
 */
import { html, nothing, type TemplateResult } from "lit";
import { generateUUID } from "../uuid.ts";
import {
  buildOguiAnswerSubmitMessage,
  oguiFormDraftComplete,
  oguiFormPanelId,
  type OguiFormDefinition,
  type OguiFormField,
  type OguiFormOption,
} from "./ogui-form.ts";

export type OguiFormSubmitMeta = {
  /** UUID placed in ogui-answer fence and used as chat.send idempotencyKey. */
  submissionId: string;
};

export type OguiFormRenderOptions = {
  /** Preview selected label(s) in the composer (draft only). */
  onFillComposer?: (text: string) => void;
  /**
   * Submit → real chat turn (chat.send / handleSendChat messageOverride).
   * Caller must pass meta.submissionId as chat.send idempotencyKey.
   * When absent, the submit button is not shown (read-only / inventory).
   */
  onSubmitForm?: (text: string, meta: OguiFormSubmitMeta) => void;
};

/** Ephemeral draft answers keyed by form panel id. */
const draftByPanel = new Map<string, Record<string, string>>();

export function getOguiFormDraft(form: OguiFormDefinition): Record<string, string> {
  return { ...draftByPanel.get(oguiFormPanelId(form)) };
}

/** Test helper: clear draft map between cases. */
export function clearOguiFormDraftState(): void {
  draftByPanel.clear();
}

function setFieldDraft(form: OguiFormDefinition, fieldId: string, value: string): void {
  const panelId = oguiFormPanelId(form);
  const next = { ...draftByPanel.get(panelId) };
  next[fieldId] = value;
  draftByPanel.set(panelId, next);
}

function formatDraftPreview(form: OguiFormDefinition, draft: Record<string, string>): string {
  const lines: string[] = [];
  for (const field of form.fields) {
    const value = draft[field.id]?.trim();
    if (!value) {
      continue;
    }
    const option = field.options.find((o) => o.value === value);
    lines.push(`${field.label}：${option ? option.label : value}`);
  }
  return lines.join("\n");
}

function handleOptionClick(
  form: OguiFormDefinition,
  field: OguiFormField,
  option: OguiFormOption,
  options: OguiFormRenderOptions,
): void {
  setFieldDraft(form, field.id, option.value);
  const draft = getOguiFormDraft(form);
  const preview = formatDraftPreview(form, draft);
  if (options.onFillComposer) {
    options.onFillComposer(preview);
  }
}

function clearComposerDraft(options: OguiFormRenderOptions): void {
  if (options.onFillComposer) {
    options.onFillComposer("");
  }
}

function handleFormSubmit(form: OguiFormDefinition, options: OguiFormRenderOptions): void {
  if (!options.onSubmitForm) {
    return;
  }
  const draft = getOguiFormDraft(form);
  if (!oguiFormDraftComplete(form, draft)) {
    return;
  }
  const submissionId = generateUUID();
  const submittedAt = new Date().toISOString();
  let submitText: string;
  try {
    submitText = buildOguiAnswerSubmitMessage({
      form,
      answers: draft,
      submissionId,
      submittedAt,
    });
  } catch {
    return;
  }
  draftByPanel.delete(oguiFormPanelId(form));
  clearComposerDraft(options);
  options.onSubmitForm(submitText, { submissionId });
}

function renderField(
  form: OguiFormDefinition,
  field: OguiFormField,
  draft: Record<string, string>,
  options: OguiFormRenderOptions,
  clickable: boolean,
): TemplateResult {
  const selected = draft[field.id] ?? null;
  return html`
    <div class="ogui-form__field" data-field-id=${field.id} role="group" aria-label=${field.label}>
      <div class="ogui-form__field-label">${field.label}</div>
      <div class="ogui-form__options" role="listbox" aria-label=${field.label}>
        ${field.options.map((option) => {
          const isSelected = option.value === selected;
          const body = html`
            <span class="ogui-form__option-label">${option.label}</span>
          `;
          if (clickable) {
            return html`
              <button
                type="button"
                class="ogui-form__option ${isSelected ? "ogui-form__option--selected" : ""}"
                role="option"
                aria-selected=${isSelected ? "true" : "false"}
                data-option-value=${option.value}
                @click=${() => handleOptionClick(form, field, option, options)}
              >
                ${body}
              </button>
            `;
          }
          return html`
            <div
              class="ogui-form__option ${isSelected ? "ogui-form__option--selected" : ""}"
              role="listitem"
              data-option-value=${option.value}
            >
              ${body}
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

export function renderOguiFormView(
  form: OguiFormDefinition,
  options: OguiFormRenderOptions = {},
): TemplateResult {
  const clickable = Boolean(options.onFillComposer || options.onSubmitForm);
  const draft = getOguiFormDraft(form);
  const canSubmit = Boolean(options.onSubmitForm && oguiFormDraftComplete(form, draft));
  const submitLabel = form.submit_label?.trim() || "提交";

  return html`
    <div
      class="ogui-form"
      data-testid="ogui-form"
      data-component-id=${form.component_id}
      role="form"
      aria-label=${form.title?.trim() || "OGUI 表单"}
    >
      ${form.title ? html`<div class="ogui-form__title">${form.title}</div>` : nothing}
      ${form.fields.map((field) => renderField(form, field, draft, options, clickable))}
      ${
        options.onSubmitForm
          ? html`
              <button
                type="button"
                class="ogui-form__submit"
                data-testid="ogui-form-submit"
                ?disabled=${!canSubmit}
                @click=${() => handleFormSubmit(form, options)}
              >
                ${submitLabel}
              </button>
            `
          : nothing
      }
    </div>
  `;
}
