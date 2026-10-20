/**
 * Presentation helpers for chat-delivery bubbles (lit/html).
 * Aesthetic: delivery-presentation.md — modern, minimal, strong hierarchy.
 * No 【】 walls, no heavy chrome; whitespace separators only.
 *
 * Interactive Choice Follow-up MVP: select a choice, then 「确认并继续」
 * submits a natural-language summary as a real chat turn via onSubmitChoice.
 */
import { html, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import { detectTextDirection } from "../text-direction.ts";
import {
  buildInteractiveChoiceSubmitMessage,
  formatChoiceComposerText,
  interactiveChoicePanelId,
  type ChatDelivery,
  type ChatDeliveryChoice,
} from "./chat-delivery.ts";

export type ChatDeliveryRenderOptions = {
  /** When true, omit the choices block even if present (Supplement / policy). */
  hideChoices?: boolean;
  /**
   * Click fills composer when provided (preview / edit before send).
   * Prefer this over onChoiceSelect when the host owns composer state.
   */
  onFillComposer?: (text: string) => void;
  /** Low-level choice click; used when onFillComposer is absent. */
  onChoiceSelect?: (choice: ChatDeliveryChoice) => void;
  /**
   * Interactive Choice Follow-up: 「确认并继续」 submits a readable summary
   * as a new user turn (chat.send / handleSendChat messageOverride).
   * When absent, the confirm button is not shown (fill-composer only).
   */
  onSubmitChoice?: (text: string) => void;
  /**
   * Optional task goal / follow-up instruction baked into the submit message.
   * Agents/skills may pass these; defaults are fine for single-group MVP.
   */
  submitTaskGoal?: string;
  submitFollowUpInstruction?: string;
  /** Override the single-group question title (default 「你选」). */
  choiceQuestionName?: string;
};

/** Ephemeral selection keyed by choice-panel id (survives lit re-renders). */
const selectedChoiceByPanel = new Map<string, string>();

export function getSelectedChoiceKey(choices: ChatDeliveryChoice[]): string | null {
  if (!choices.length) {
    return null;
  }
  return selectedChoiceByPanel.get(interactiveChoicePanelId(choices)) ?? null;
}

/** Test helper: clear selection map between cases. */
export function clearInteractiveChoiceSelectionState(): void {
  selectedChoiceByPanel.clear();
}

function renderInlineMarkdown(markdown: string): TemplateResult {
  return html`${unsafeHTML(toSanitizedMarkdownHtml(markdown))}`;
}

/**
 * Best-effort: put choice label into the visible chat composer.
 * Returns false when no textarea/contenteditable is found.
 */
export function tryFillChatComposer(text: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  const el = document.querySelector(
    "textarea.chat-compose__input, .chat-compose textarea, .composer textarea, textarea, [contenteditable='true']",
  );
  if (!el) {
    return false;
  }
  if (el instanceof HTMLTextAreaElement) {
    const proto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    proto?.set?.call(el, text);
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    return true;
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    return true;
  }
  return false;
}

function selectChoice(choice: ChatDeliveryChoice, choices: ChatDeliveryChoice[]): void {
  selectedChoiceByPanel.set(interactiveChoicePanelId(choices), choice.key);
}

function handleChoiceClick(
  choice: ChatDeliveryChoice,
  choices: ChatDeliveryChoice[],
  options: ChatDeliveryRenderOptions,
): void {
  selectChoice(choice, choices);
  const text = formatChoiceComposerText(choice);
  if (options.onFillComposer) {
    options.onFillComposer(text);
    return;
  }
  if (options.onChoiceSelect) {
    options.onChoiceSelect(choice);
    return;
  }
  tryFillChatComposer(text);
}

function buildSubmitText(choice: ChatDeliveryChoice, options: ChatDeliveryRenderOptions): string {
  return buildInteractiveChoiceSubmitMessage({
    taskGoal: options.submitTaskGoal,
    questions: [
      {
        name: options.choiceQuestionName?.trim() || "你选",
        choice,
      },
    ],
    followUpInstruction: options.submitFollowUpInstruction,
  });
}

function clearComposerDraft(options: ChatDeliveryRenderOptions): void {
  if (options.onFillComposer) {
    options.onFillComposer("");
    return;
  }
  tryFillChatComposer("");
}

function handleConfirmSubmit(
  choices: ChatDeliveryChoice[],
  options: ChatDeliveryRenderOptions,
): void {
  if (!options.onSubmitChoice) {
    return;
  }
  const selectedKey = getSelectedChoiceKey(choices);
  const choice = choices.find((c) => c.key === selectedKey);
  if (!choice) {
    return;
  }
  const submitText = buildSubmitText(choice, options);
  // Clear highlight / selection Map and composer draft before/after submit so
  // the preview text from choice click does not linger after the real turn.
  selectedChoiceByPanel.delete(interactiveChoicePanelId(choices));
  clearComposerDraft(options);
  options.onSubmitChoice(submitText);
}

export function renderChatDeliveryView(
  delivery: ChatDelivery,
  options: ChatDeliveryRenderOptions = {},
): TemplateResult {
  const showChoices =
    !options.hideChoices && Array.isArray(delivery.choices) && delivery.choices.length > 0;
  const dir = detectTextDirection(
    [delivery.conclusion, delivery.detail, delivery.next].filter(Boolean).join("\n"),
  );
  const choices = delivery.choices ?? [];
  const clickable = Boolean(
    options.onFillComposer || options.onChoiceSelect || options.onSubmitChoice,
  );
  const selectedKey = showChoices ? getSelectedChoiceKey(choices) : null;
  const canConfirm = Boolean(options.onSubmitChoice && selectedKey);

  return html`
    <div class="chat-delivery" dir=${dir}>
      <div class="chat-delivery__conclusion">${renderInlineMarkdown(delivery.conclusion)}</div>
      ${
        delivery.detail
          ? html`<div class="chat-delivery__detail">${renderInlineMarkdown(delivery.detail)}</div>`
          : nothing
      }
      ${
        delivery.next
          ? html`
              <div class="chat-delivery__next-label">下一步</div>
              <div class="chat-delivery__next">${renderInlineMarkdown(delivery.next)}</div>
            `
          : nothing
      }
      ${
        showChoices
          ? html`
              <div class="chat-delivery__choices" role="listbox" aria-label="你选">
                <div class="chat-delivery__choices-label">你选</div>
                ${choices.map((choice) => {
                  const selected = choice.key === selectedKey;
                  const body = html`
                    <span class="chat-delivery__choice-key">${choice.key}</span>
                    <span class="chat-delivery__choice-label">${choice.label}</span>
                  `;
                  if (clickable) {
                    return html`
                      <button
                        type="button"
                        class="chat-delivery__choice ${selected ? "chat-delivery__choice--selected" : ""}"
                        role="option"
                        aria-selected=${selected ? "true" : "false"}
                        data-choice-key=${choice.key}
                        @click=${() => handleChoiceClick(choice, choices, options)}
                      >
                        ${body}
                      </button>
                    `;
                  }
                  return html`
                    <div class="chat-delivery__choice" role="listitem" data-choice-key=${choice.key}>
                      ${body}
                    </div>
                  `;
                })}
                ${
                  options.onSubmitChoice
                    ? html`
                        <button
                          type="button"
                          class="chat-delivery__confirm"
                          data-testid="chat-delivery-confirm"
                          ?disabled=${!canConfirm}
                          @click=${() => handleConfirmSubmit(choices, options)}
                        >
                          确认并继续
                        </button>
                      `
                    : nothing
                }
              </div>
            `
          : nothing
      }
    </div>
  `;
}

/** Alias matching the protocol helper name. */
export const renderChatDelivery = renderChatDeliveryView;
