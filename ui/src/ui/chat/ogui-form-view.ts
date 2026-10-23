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

/**
 * Same vocabulary as the session DecisionRecord status the server strip uses.
 * UI does not import `src/`. `unauthoritative` is view-only: a lifecycle card
 * carries decision refs but the session map has no matching record.
 * Absent or `waiting` keeps the existing submit operable.
 */
export type OguiFormDecisionStatus =
  | "waiting"
  | "answered"
  | "rejected"
  | "expired"
  | "superseded"
  | "unauthoritative";

const OGUI_FORM_CLOSED_DECISION_STATUSES = new Set<OguiFormDecisionStatus>([
  "answered",
  "rejected",
  "expired",
  "superseded",
]);

export type OguiFormRenderOptions = {
  /** Preview selected label(s) in the composer (draft only). */
  onFillComposer?: (text: string) => void;
  /**
   * Submit → real chat turn (chat.send / handleSendChat messageOverride).
   * Caller must pass meta.submissionId as chat.send idempotencyKey.
   * When absent, the submit button is not shown (read-only / inventory).
   */
  onSubmitForm?: (text: string, meta: OguiFormSubmitMeta) => void;
  /**
   * Server decision status. Closed statuses disable the existing submit
   * button and refuse the submit handler. No new chrome.
   */
  decisionStatus?: OguiFormDecisionStatus;
};

/** Closed decisions cannot submit. Omitted and waiting stay operable. */
export function oguiFormSubmitOperable(options: OguiFormRenderOptions): boolean {
  const status = options.decisionStatus;
  if (!status || status === "waiting") {
    return true;
  }
  if (status === "unauthoritative") {
    return false;
  }
  return !OGUI_FORM_CLOSED_DECISION_STATUSES.has(status);
}

const OGUI_FORM_DECISION_STATUS_SET = new Set<string>([
  "waiting",
  "answered",
  "rejected",
  "expired",
  "superseded",
]);

/** Session-authority slice the chat shell may pass. No identity or resume fields. */
export type OguiDecisionStatusRef = {
  decisionStatus: OguiFormDecisionStatus;
  version?: number;
};

export type OguiDecisionStatusLookup = Readonly<Record<string, OguiDecisionStatusRef>>;

function isOguiFormDecisionStatus(value: string): value is OguiFormDecisionStatus {
  return OGUI_FORM_DECISION_STATUS_SET.has(value);
}

/** Drop anything that is not decisionId → status (+ optional version). */
export function parseOguiDecisionStatusLookup(
  value: unknown,
): OguiDecisionStatusLookup | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const lookup: Record<string, OguiDecisionStatusRef> = {};
  for (const [key, raw] of Object.entries(value)) {
    const id = key.trim();
    if (!id || !raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }
    const status = (raw as { decisionStatus?: unknown }).decisionStatus;
    if (typeof status !== "string" || !isOguiFormDecisionStatus(status)) {
      continue;
    }
    const version = (raw as { version?: unknown }).version;
    lookup[id] = {
      decisionStatus: status,
      ...(typeof version === "number" && Number.isInteger(version) && version > 0
        ? { version }
        : {}),
    };
  }
  return Object.keys(lookup).length > 0 ? lookup : undefined;
}

/**
 * Client patch after an accepted lifecycle ogui-answer.
 * Same map the shell already passes; closed status disables the existing submit.
 */
export function mergeOguiDecisionAnsweredStatus(
  lookup: OguiDecisionStatusLookup | null | undefined,
  ref: { decision_id: string; decision_version: number },
): OguiDecisionStatusLookup {
  const decisionId = ref.decision_id.trim();
  const version = ref.decision_version;
  const next: Record<string, OguiDecisionStatusRef> = {};
  if (lookup) {
    for (const [key, value] of Object.entries(lookup)) {
      next[key] = value;
    }
  }
  next[decisionId] = { decisionStatus: "answered", version };
  return next;
}

/**
 * Match the form's decision_id to the session map. A fence with no decision
 * fields stays omitted so plain legacy OGUI remains operable. A lifecycle
 * card that carries a decision ref but has no authority record is
 * unauthoritative and cannot submit. A version mismatch is superseded.
 */
export function resolveOguiFormDecisionStatus(
  form: OguiFormDefinition,
  lookup: OguiDecisionStatusLookup | undefined,
): OguiFormDecisionStatus | undefined {
  const decisionId = form.decision_id?.trim() ?? "";
  const hasVersion = typeof form.decision_version === "number";
  if (!decisionId && !hasVersion) {
    return undefined;
  }
  if (!decisionId || !lookup) {
    return "unauthoritative";
  }
  const ref = lookup[decisionId];
  if (!ref) {
    return "unauthoritative";
  }
  if (hasVersion && typeof ref.version === "number" && form.decision_version !== ref.version) {
    return "superseded";
  }
  return ref.decisionStatus;
}

/** Ephemeral draft answers keyed by form panel id. */
const draftByPanel = new Map<string, Record<string, string>>();
/** option = a listed value; custom = the explicit custom field. */
const draftModeByPanel = new Map<string, "option" | "custom">();

export function getOguiFormDraft(form: OguiFormDefinition): Record<string, string> {
  return { ...draftByPanel.get(oguiFormPanelId(form)) };
}

/** Test helper: clear draft map between cases. */
export function clearOguiFormDraftState(): void {
  draftByPanel.clear();
  draftModeByPanel.clear();
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
  draftModeByPanel.set(oguiFormPanelId(form), "option");
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

function handleCustomInput(
  form: OguiFormDefinition,
  value: string,
  options: OguiFormRenderOptions,
): void {
  const panelId = oguiFormPanelId(form);
  const field = form.fields[0];
  const text = value.trim();
  if (!field || !text) {
    draftModeByPanel.delete(panelId);
    draftByPanel.delete(panelId);
    clearComposerDraft(options);
    return;
  }
  draftModeByPanel.set(panelId, "custom");
  draftByPanel.set(panelId, { [field.id]: text });
  const preview = formatDraftPreview(form, getOguiFormDraft(form));
  if (options.onFillComposer) {
    options.onFillComposer(preview);
  }
}

function readInputValue(event: Event): string {
  const target = event.currentTarget;
  if (!(target instanceof HTMLInputElement)) {
    return "";
  }
  return target.value;
}

function handleFormSubmit(form: OguiFormDefinition, options: OguiFormRenderOptions): void {
  if (!options.onSubmitForm || !oguiFormSubmitOperable(options)) {
    return;
  }
  const draft = getOguiFormDraft(form);
  if (!oguiFormDraftComplete(form, draft)) {
    return;
  }
  const panelId = oguiFormPanelId(form);
  const answerMode = draftModeByPanel.get(panelId) ?? "option";
  const submissionId = generateUUID();
  const submittedAt = new Date().toISOString();
  let submitText: string;
  try {
    submitText = buildOguiAnswerSubmitMessage({
      form,
      answers: draft,
      submissionId,
      submittedAt,
      answerMode,
      ...(form.decision_id && typeof form.decision_version === "number"
        ? { decisionId: form.decision_id, decisionVersion: form.decision_version }
        : {}),
    });
  } catch {
    return;
  }
  draftByPanel.delete(panelId);
  draftModeByPanel.delete(panelId);
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
  const operable = oguiFormSubmitOperable(options);
  const clickable = Boolean(operable && (options.onFillComposer || options.onSubmitForm));
  const draft = getOguiFormDraft(form);
  const canSubmit = Boolean(operable && options.onSubmitForm && oguiFormDraftComplete(form, draft));
  const submitLabel = form.submit_label?.trim() || "提交";
  const showCustom = Boolean(form.decision_id?.trim() && form.allowCustom);
  const customMode = draftModeByPanel.get(oguiFormPanelId(form)) === "custom";
  const customValue = showCustom && customMode ? (draft[form.fields[0]?.id ?? ""] ?? "") : "";

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
        showCustom
          ? html`
              <label class="ogui-form__custom">
                <span class="ogui-form__custom-label">自定义回答</span>
                <input
                  type="text"
                  class="ogui-form__custom-input"
                  data-testid="ogui-form-custom"
                  placeholder="输入自定义回答"
                  ?disabled=${!clickable}
                  .value=${customValue}
                  @input=${(event: Event) => {
                    if (!clickable) {
                      return;
                    }
                    handleCustomInput(form, readInputValue(event), options);
                  }}
                />
              </label>
            `
          : nothing
      }
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
