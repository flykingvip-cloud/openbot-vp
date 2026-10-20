/** Pending deep-link focus for collaboration human @mention notifications. */

export type PendingChatFocusMessage = {
  sessionKey: string;
  messageId: string;
};

let pending: PendingChatFocusMessage | null = null;

export function setPendingChatFocusMessage(next: PendingChatFocusMessage | null): void {
  const sessionKey = next?.sessionKey.trim() ?? "";
  const messageId = next?.messageId.trim() ?? "";
  pending = sessionKey && messageId ? { sessionKey, messageId } : null;
}

export function peekPendingChatFocusMessage(): PendingChatFocusMessage | null {
  return pending;
}

export function consumePendingChatFocusMessage(sessionKey: string): string | null {
  const expected = sessionKey.trim();
  if (!pending || !expected || pending.sessionKey !== expected) {
    return null;
  }
  const messageId = pending.messageId;
  pending = null;
  return messageId;
}

export function resolveMessageDomId(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const row = message as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (id) {
    return id;
  }
  const messageId = typeof row.messageId === "string" ? row.messageId.trim() : "";
  return messageId;
}

export type ChatFocusHost = {
  updateComplete?: Promise<unknown>;
  querySelector: (selectors: string) => Element | null;
};

/**
 * Scroll a rendered chat message into view and briefly highlight it.
 * Returns false when the message node is not yet in the DOM.
 */
export async function focusChatMessageInView(
  host: ChatFocusHost,
  messageId: string,
): Promise<boolean> {
  const targetId = messageId.trim();
  if (!targetId) {
    return false;
  }
  await host.updateComplete;
  // Avoid CSS.escape — unavailable in jsdom / some embeds. Message ids are opaque
  // strings; quote-escape is enough for an attribute selector.
  const safeId = targetId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const node = host.querySelector(`[data-message-id="${safeId}"]`) as HTMLElement | null;
  if (!node) {
    return false;
  }
  node.scrollIntoView({ block: "center", behavior: "smooth" });
  node.classList.add("is-mention-focus");
  window.setTimeout(() => {
    node.classList.remove("is-mention-focus");
  }, 2400);
  return true;
}

export async function applyPendingChatFocusMessage(
  host: ChatFocusHost & { sessionKey?: string },
): Promise<boolean> {
  const sessionKey = host.sessionKey?.trim() ?? "";
  const messageId = consumePendingChatFocusMessage(sessionKey);
  if (!messageId) {
    return false;
  }
  // History may still be hydrating; retry a few frames.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await focusChatMessageInView(host, messageId)) {
      return true;
    }
    await host.updateComplete;
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 50 * (attempt + 1));
    });
  }
  // Restore pending so a later render can still try.
  setPendingChatFocusMessage({ sessionKey, messageId });
  return false;
}
