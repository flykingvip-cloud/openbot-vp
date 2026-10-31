/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { diagnoseCheckpointListVisibility } from "../chat/checkpoint-visibility-diagnostics.ts";
import type { SessionsListResult } from "../types.ts";
import { renderChat, type ChatProps } from "./chat.ts";

function createSessions(): SessionsListResult {
  return {
    ts: 0,
    path: "",
    count: 0,
    defaults: { model: null, contextTokens: null },
    sessions: [],
  };
}

function createProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
    sessionKey: "main",
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    loading: false,
    sending: false,
    canAbort: false,
    compactionStatus: null,
    fallbackStatus: null,
    messages: [],
    toolMessages: [],
    streamSegments: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions: createSessions(),
    focusMode: false,
    assistantName: "OpenBot",
    assistantAvatar: null,
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
    ...overrides,
  };
}

describe("checkpoint diagnostics agree with DOM placement", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("tip line visible ⇒ diagnostics.inlineVisible true (shared placement)", () => {
    const container = document.createElement("div");
    const messages = [
      { id: "u1", role: "user", content: "first" },
      { id: "a1", role: "assistant", content: "ok" },
    ];
    const checkpoints = [
      {
        checkpointId: "cp-tip",
        boundaryMessageId: "a1",
        createdAt: "2026-10-31T00:00:00Z",
        summary: "s",
        restorable: { files: true, transcript: true },
        externalEffects: { present: false, kinds: [] },
      },
    ];
    render(renderChat(createProps({ messages, checkpoints })), container);
    const actual = container.querySelectorAll(".chat-checkpoint").length > 0;
    const diag = diagnoseCheckpointListVisibility(checkpoints, messages)[0];
    expect(actual).toBe(true);
    expect(diag.inlineVisible).toBe(true);
    expect(diag.sourceBoundaryState).toBe("tip");
    expect(diag.reasonCodes).toContain("tip_noop");
  });
});
