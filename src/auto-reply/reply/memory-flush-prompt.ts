/**
 * Lightweight detectors for pre-compaction memory-flush prompts that must not
 * surface as user-visible chat bubbles. Kept free of config/agent imports so
 * both gateway and Control UI can share the same filter.
 */

const MEMORY_FLUSH_PROMPT_PREFIX = /^\s*Pre-compaction memory flush\b/i;
const MEMORY_FLUSH_DURABLE_HINT = "Store durable memories only in memory/";
const MEMORY_FLUSH_READONLY_HINT = "Treat workspace bootstrap/reference files";

/** True when text is (or clearly matches) a memory-flush user prompt. */
export function isMemoryFlushPromptText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (MEMORY_FLUSH_PROMPT_PREFIX.test(trimmed)) {
    return true;
  }
  // Custom prompts still get the required safety hints injected server-side;
  // date stamps replace YYYY-MM-DD but keep the "memory/" path prefix.
  return (
    trimmed.includes(MEMORY_FLUSH_DURABLE_HINT) && trimmed.includes(MEMORY_FLUSH_READONLY_HINT)
  );
}

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
 * True when a chat.history / transcript message is a user-role memory-flush
 * prompt that should be hidden from the workbench chat UI.
 */
export function isMemoryFlushHistoryMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  const role = typeof entry.role === "string" ? entry.role.toLowerCase() : "";
  if (role !== "user") {
    return false;
  }
  const text = extractMessageText(message);
  return text !== undefined && isMemoryFlushPromptText(text);
}
