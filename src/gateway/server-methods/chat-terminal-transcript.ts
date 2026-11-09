/** Shown when a run is aborted before any partial assistant text was buffered. */
export const BLANK_ABORT_ASSISTANT_TEXT = "这一轮已中止，没有生成可展示的回复。";

/** Shown when an embedded run ends with no assistant text in the transcript. */
export const EMPTY_FINAL_ASSISTANT_TEXT =
  "这一轮没有完成回复（助手在给出结果前结束或返回了空内容）。请再试一次。";

/** Abort persistence must keep a visible bubble when the partial buffer is blank. */
export function assistantTextForAbortPartial(partial: string | null | undefined): string {
  const trimmed = partial?.trim() ?? "";
  return trimmed || BLANK_ABORT_ASSISTANT_TEXT;
}

function messageRecord(entry: unknown): Record<string, unknown> | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const row = entry as Record<string, unknown>;
  const nested = row.message;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return row;
}

function assistantText(message: Record<string, unknown>): string {
  if (message.role !== "assistant") {
    return "";
  }
  const content = message.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        const row = part as { type?: string; text?: string };
        return row.type === "text" && typeof row.text === "string" ? row.text.trim() : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return typeof message.text === "string" ? message.text.trim() : "";
}

/**
 * True when this user turn already has a non-empty assistant bubble after it.
 * Reconnect then has something to paint; an empty final must not add a second one.
 */
export function transcriptHasVisibleAssistantAfterUser(
  messages: readonly unknown[],
  userIdempotencyKey: string,
): boolean {
  const userKey = userIdempotencyKey.trim();
  if (!userKey) {
    return false;
  }
  let seenUser = false;
  for (const entry of messages) {
    const message = messageRecord(entry);
    if (!message) {
      continue;
    }
    const key = typeof message.idempotencyKey === "string" ? message.idempotencyKey : "";
    if (!seenUser && (key === userKey || key === `${userKey}:user`)) {
      seenUser = true;
      continue;
    }
    if (seenUser && assistantText(message)) {
      return true;
    }
  }
  return false;
}
