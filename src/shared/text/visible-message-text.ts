/**
 * Shared visible-text contract for collaboration round delivery and chat UI.
 * Every bot and every message shape uses this. A missing list or a non-text
 * block must not erase sibling text or throw `reading 'length'`.
 */

/** Transcript and round payloads are arrays. A missing list is empty. */
export function asMessageList(messages: unknown): unknown[] {
  return Array.isArray(messages) ? messages : [];
}

/** Text of one content block. Null, non-objects, and non-text parts are skipped. */
export function readTextBlock(block: unknown): string | undefined {
  if (!block || typeof block !== "object") {
    return undefined;
  }
  const typed = block as { type?: unknown; text?: unknown };
  if (typed.type !== "text" || typeof typed.text !== "string") {
    return undefined;
  }
  return typed.text;
}

/**
 * Visible body of one chat message.
 *
 * String `text` or string `content` is the body. A content array keeps every
 * text block and skips null holes, non-objects, and non-text parts (tool,
 * thinking, image). The message is empty only when no text block remains.
 * Pass `role` to ignore other speakers.
 */
export function extractMessageVisibleText(
  message: unknown,
  options?: { role?: string },
): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const entry = message as Record<string, unknown>;
  if (options?.role && entry.role !== options.role) {
    return undefined;
  }
  if (typeof entry.text === "string") {
    return entry.text;
  }
  if (typeof entry.content === "string") {
    return entry.content;
  }
  if (!Array.isArray(entry.content)) {
    return undefined;
  }
  const texts: string[] = [];
  for (const block of entry.content) {
    const text = readTextBlock(block);
    if (text !== undefined) {
      texts.push(text);
    }
  }
  return texts.length > 0 ? texts.join("\n") : undefined;
}
