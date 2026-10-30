/**
 * Detectors for internal auto-continue injectors that must not surface as
 * user-visible chat bubbles. Shared by gateway history sanitize and Control UI.
 */
import { isInternalContinuePromptText } from "../../shared/text/control-channel-visibility.js";

export { isInternalContinuePromptText };

function extractMessageText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const entry = message as Record<string, unknown>;
  if (typeof entry.text === "string") {
    return entry.text;
  }
  if (typeof entry.content === "string") {
    return entry.content;
  }
  if (!Array.isArray(entry.content) || entry.content.length === 0) {
    return undefined;
  }
  const texts: string[] = [];
  for (const block of entry.content) {
    if (!block || typeof block !== "object") {
      return undefined;
    }
    const typed = block as { type?: unknown; text?: unknown };
    if (typed.type !== "text" || typeof typed.text !== "string") {
      return undefined;
    }
    texts.push(typed.text);
  }
  return texts.length > 0 ? texts.join("\n") : undefined;
}

/**
 * True when a chat.history / transcript message is a user-role internal
 * task-board / execution continue prompt that should be hidden from the UI.
 */
export function isInternalContinueHistoryMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  const role = typeof entry.role === "string" ? entry.role.toLowerCase() : "";
  // Injectors are persisted as role=user; also hide if they land as system.
  if (role !== "user" && role !== "system") {
    return false;
  }
  const text = extractMessageText(message);
  return text !== undefined && isInternalContinuePromptText(text);
}
