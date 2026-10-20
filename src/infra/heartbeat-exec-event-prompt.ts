/** Browser-safe markers. Do not import Node-only heartbeat modules from UI. */

export const EXEC_EVENT_PROMPT_PREFIX = "An async command you ran earlier has completed.";
export const EXEC_EVENT_INTERNAL_HANDLE_MARKER = "Handle the result internally.";

export function isExecEventPromptText(text: string): boolean {
  return text.includes(EXEC_EVENT_PROMPT_PREFIX);
}

export function isInternalExecEventPromptText(text: string): boolean {
  return isExecEventPromptText(text) && text.includes(EXEC_EVENT_INTERNAL_HANDLE_MARKER);
}

function extractMessageRole(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" ? role.toLowerCase() : "";
}

function extractMessageText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && "text" in block) {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") {
        parts.push(text);
      }
    }
  }
  return parts.join("\n");
}

/** True when a transcript / chat.history user turn is an exec-event heartbeat prompt. */
export function isExecEventPromptMessage(message: unknown): boolean {
  return (
    extractMessageRole(message) === "user" && isExecEventPromptText(extractMessageText(message))
  );
}

export function isInternalExecEventPromptMessage(message: unknown): boolean {
  return (
    extractMessageRole(message) === "user" &&
    isInternalExecEventPromptText(extractMessageText(message))
  );
}

/**
 * Drop internal exec-event prompts (and the assistant turn they induced) so a
 * background command completion cannot become the "current topic".
 */
export function omitInternalExecEventTurns<T>(messages: readonly T[]): T[] {
  const kept: T[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const current = messages[index];
    if (!isInternalExecEventPromptMessage(current)) {
      kept.push(current);
      continue;
    }
    const next = messages[index + 1];
    if (next && extractMessageRole(next) === "assistant") {
      index += 1;
    }
  }
  return kept;
}
