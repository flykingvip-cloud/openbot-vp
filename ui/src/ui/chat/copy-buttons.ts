import { html, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import { runCopyWithFeedback } from "./copy-feedback.ts";

type CopyButtonOptions = {
  text: () => string;
  label: string;
  contextId?: string | null;
  /** Extra class for placement variants (e.g. turn footer, code block). */
  variantClass?: string;
};

function createCopyButton(options: CopyButtonOptions): TemplateResult {
  const idleLabel = options.label;
  const classes = ["chat-copy-btn", options.variantClass ?? ""].filter(Boolean).join(" ");
  return html`
    <button
      class=${classes}
      type="button"
      title=${idleLabel}
      aria-label=${idleLabel}
      @click=${async (e: Event) => {
        const btn = e.currentTarget as HTMLButtonElement | null;
        if (!btn) {
          return;
        }
        await runCopyWithFeedback({
          button: btn,
          text: options.text,
          labels: {
            idle: idleLabel,
            done: t("chat.copyDone"),
            error: t("chat.copyFailed"),
          },
          contextId: options.contextId ?? null,
        });
      }}
    >
      <span class="chat-copy-btn__icon" aria-hidden="true">
        <span class="chat-copy-btn__icon-copy">${icons.copy}</span>
        <span class="chat-copy-btn__icon-check">${icons.check}</span>
      </span>
    </button>
  `;
}

/** Copy the completed assistant turn. Sits with Quote in the message footer. */
export function renderTurnCopyButton(markdown: string, contextId?: string | null): TemplateResult {
  return createCopyButton({
    text: () => markdown,
    label: t("chat.copy"),
    contextId,
    variantClass: "chat-msg-action-btn",
  });
}
