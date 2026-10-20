// @vitest-environment jsdom
import { html, render } from "lit";
import { describe, expect, it } from "vitest";
import type { ProgressView } from "../../../../src/progress-ledger/types.ts";
import {
  matchConversationTaskProgressEntry,
  renderConversationTaskInlineProgress,
  type ConversationTaskProgressEntry,
} from "./conversation-task-progress.ts";

function progressView(overrides: Partial<ProgressView> = {}): ProgressView {
  return {
    projectionKind: "canonical",
    taskId: "ct-1",
    goal: "分三步完成竞品监控",
    headline: "0/1 项验收已满足 · 正在执行",
    focus: "分三步完成竞品监控",
    acceptanceProgress: { met: 0, total: 1 },
    executionProgress: { completed: 0, total: 1, inProgress: 1, remaining: 0 },
    mode: "deliver",
    stale: false,
    lastMeaningfulChangeAtMs: 1_000,
    lastUpdatedAtMs: 1_000,
    emitToChat: true,
    emitNotification: false,
    nodes: [],
    taskCompleted: false,
    planVersion: 1,
    replans: [],
    ...overrides,
  };
}

function entry(
  overrides: Partial<ConversationTaskProgressEntry> = {},
): ConversationTaskProgressEntry {
  return {
    taskId: "1",
    sourceMessageId: "m-user-1",
    goal: "分三步完成竞品监控",
    lifecycle: "active",
    progress: progressView(),
    ...overrides,
  };
}

describe("conversation-task-progress", () => {
  it("matches by sourceMessageId first", () => {
    expect(
      matchConversationTaskProgressEntry(entry(), {
        messageId: "m-user-1",
        userText: "other text",
      }),
    ).toBe(true);
  });

  it("falls back to goal text when message id is missing", () => {
    expect(
      matchConversationTaskProgressEntry(entry({ sourceMessageId: "" }), {
        messageId: "",
        userText: "分三步完成竞品监控",
      }),
    ).toBe(true);
  });

  it("does not occupy chat when emitToChat is true", () => {
    const container = document.createElement("div");
    render(html`${renderConversationTaskInlineProgress(entry())}`, container);
    expect(container.querySelector(".chat-conversation-task-progress")).toBeNull();
    expect(container.textContent?.trim()).toBe("");
  });

  it("renders nothing when emitToChat is false", () => {
    const container = document.createElement("div");
    render(
      html`${renderConversationTaskInlineProgress(
        entry({ progress: progressView({ emitToChat: false }) }),
      )}`,
      container,
    );
    expect(container.textContent?.trim()).toBe("");
  });
});
