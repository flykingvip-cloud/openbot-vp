import { html, nothing } from "lit";
import type { ProgressView } from "../../../../src/progress-ledger/types.ts";
import {
  formatExecutionSummary,
  shouldRenderChatStrip,
} from "../../../../src/progress-ledger/view-copy.ts";

export type ConversationTaskProgressEntry = {
  taskId: string;
  sourceMessageId: string;
  goal: string;
  lifecycle: string;
  progress: ProgressView;
};

let activeConversationTaskProgressEntries: ConversationTaskProgressEntry[] = [];

export function setConversationTaskProgressEntries(entries: ConversationTaskProgressEntry[]): void {
  activeConversationTaskProgressEntries = entries;
}

export function getConversationTaskProgressEntries(): ConversationTaskProgressEntry[] {
  return activeConversationTaskProgressEntries;
}

export function matchConversationTaskProgressEntry(
  entry: ConversationTaskProgressEntry,
  params: { messageId: string; userText: string },
): boolean {
  const messageId = params.messageId.trim();
  if (messageId && entry.sourceMessageId.trim() === messageId) {
    return true;
  }
  const userText = params.userText.trim();
  if (!userText) {
    return false;
  }
  return entry.goal.trim() === userText || userText.startsWith(entry.goal.trim());
}

export function renderConversationTaskInlineProgress(entry: ConversationTaskProgressEntry) {
  const view = entry.progress;
  if (!view || !shouldRenderChatStrip(view)) {
    return nothing;
  }
  const stale =
    view.stale && view.lastMeaningfulChangeAtMs > 0
      ? `已 ${Math.max(
          1,
          Math.floor((Date.now() - view.lastMeaningfulChangeAtMs) / (60 * 60 * 1000)),
        )} 小时无进展`
      : null;
  return html`
    <aside class="chat-conversation-task-progress" data-task-id=${entry.taskId} aria-live="polite">
      <div class="chat-conversation-task-progress__headline">${view.headline}</div>
      <div class="chat-conversation-task-progress__focus">${view.focus}</div>
      ${stale ? html`<div class="chat-conversation-task-progress__stale">${stale}</div>` : nothing}
      <div class="chat-conversation-task-progress__exec">${formatExecutionSummary(view)}</div>
    </aside>
  `;
}
