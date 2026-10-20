/**
 * Move chat-scoped run failures out of the top danger rail and into the thread.
 * Gateway disconnect copy and send/attachment limits stay on their own rails.
 */
import { isChatScopedRunFailure } from "../../../../src/auto-reply/reply/chat-run-error-policy.ts";
import { sanitizeUserFacingChatError } from "../chat-error-sanitize.ts";
import { extractText } from "./message-extract.ts";

export function chatRunFailureVisibleText(error: string | null | undefined): string | null {
  const raw = error?.trim() ?? "";
  if (!raw || !isChatScopedRunFailure(raw)) {
    return null;
  }
  const visible = String(sanitizeUserFacingChatError(raw)).trim();
  return visible || raw;
}

export function transcriptContainsChatError(
  messages: readonly unknown[] | null | undefined,
  error: string,
): boolean {
  const raw = error.trim();
  const visible = String(sanitizeUserFacingChatError(raw)).trim();
  if (!raw && !visible) {
    return false;
  }
  const rows = Array.isArray(messages) ? messages : [];
  return rows.some((message) => {
    const text = extractText(message)?.trim() ?? "";
    if (!text) {
      return false;
    }
    if (text === raw || text === visible) {
      return true;
    }
    if (raw.length >= 12 && text.includes(raw)) {
      return true;
    }
    return visible.length >= 12 && visible !== raw && text.includes(visible);
  });
}

export function presentChatScopedRunFailure<
  T extends { error: string | null; messages: unknown[] },
>(props: T): T {
  const error = props.error?.trim() ?? "";
  if (!error || !isChatScopedRunFailure(error)) {
    return props;
  }
  const visible = chatRunFailureVisibleText(error);
  if (!visible) {
    return { ...props, error: null };
  }
  const messages = Array.isArray(props.messages) ? props.messages : [];
  if (transcriptContainsChatError(messages, error)) {
    return { ...props, error: null };
  }
  return {
    ...props,
    error: null,
    messages: [
      ...messages,
      {
        id: "local-run-failure",
        role: "assistant",
        content: [{ type: "text", text: visible }],
        timestamp: Date.now(),
      },
    ],
  };
}
