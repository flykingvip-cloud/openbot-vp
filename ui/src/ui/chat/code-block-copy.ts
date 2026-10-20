import { t } from "../../i18n/index.ts";
import { runCopyWithFeedback } from "./copy-feedback.ts";

/**
 * Per-code-block copy affordance for chat markdown.
 *
 * Chat markdown reaches the DOM through `unsafeHTML`, so lit cannot interleave real buttons into the
 * rendered output. Instead every sanitized `<pre>` block is wrapped in a positioned container with a
 * static copy button, and clicks are handled by one delegated listener on the chat bubble.
 *
 * The wrapper + button markup is injected AFTER DOMPurify has run (button/svg are not in the sanitize
 * allow-list) and is entirely constant: the sanitized code content itself is moved verbatim and never
 * re-parsed, so this cannot reintroduce untrusted markup.
 */

const BLOCK_CLASS = "chat-code-block";
const BUTTON_CLASS = "chat-copy-btn";
const BUTTON_VARIANT_CLASS = "chat-copy-btn--code";

// `<pre>` cannot nest, so a non-greedy match per block is unambiguous.
const PRE_BLOCK_RE = /<pre(?:\s[^>]*)?>[\s\S]*?<\/pre>/g;

const COPY_ICON_SVG =
  '<svg viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>' +
  '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>';
const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"></path></svg>';

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function codeCopyButtonMarkup(): string {
  const label = escapeAttribute(t("chat.copyCodeBlock"));
  return (
    `<button class="${BUTTON_CLASS} ${BUTTON_VARIANT_CLASS}" type="button" title="${label}" aria-label="${label}">` +
    `<span class="${BUTTON_CLASS}__icon" aria-hidden="true">` +
    `<span class="${BUTTON_CLASS}__icon-copy">${COPY_ICON_SVG}</span>` +
    `<span class="${BUTTON_CLASS}__icon-check">${CHECK_ICON_SVG}</span>` +
    `</span></button>`
  );
}

/** Wrap each code block in the sanitized markdown HTML with its own copy button. */
export function withCodeBlockCopyButtons(sanitizedHtml: string): string {
  if (!sanitizedHtml.includes("<pre")) {
    return sanitizedHtml;
  }
  const button = codeCopyButtonMarkup();
  return sanitizedHtml.replace(
    PRE_BLOCK_RE,
    (block) => `<div class="${BLOCK_CLASS}">${block}${button}</div>`,
  );
}

/**
 * Delegated click handler for the injected code-block copy buttons.
 * Returns true when the click was consumed, so callers can skip their own handling.
 */
export function handleCodeBlockCopyClick(event: Event): boolean {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest(`.${BUTTON_VARIANT_CLASS}`);
  if (!(button instanceof HTMLButtonElement)) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  const block = button.closest(`.${BLOCK_CLASS}`);
  const pre = block?.querySelector("pre");
  void runCopyWithFeedback({
    button,
    text: () => pre?.textContent ?? "",
    labels: {
      idle: t("chat.copyCodeBlock"),
      done: t("chat.copyDone"),
      error: t("chat.copyFailed"),
    },
  });
  return true;
}
