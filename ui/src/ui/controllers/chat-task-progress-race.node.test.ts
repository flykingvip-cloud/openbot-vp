import { expect, it, vi } from "vitest";
import {
  getConversationTaskProgressEntries,
  setConversationTaskProgressEntries,
} from "../chat/conversation-task-progress.ts";
import { refreshConversationTaskProgress, type ChatHistoryState } from "./chat.ts";

it("rejects an older conversation progress response after switching sessions", async () => {
  const pending: Array<(result: unknown) => void> = [];
  const state = {
    sessionKey: "a",
    connected: true,
    conversationTaskProgress: null,
    client: { request: vi.fn(() => new Promise((resolve) => pending.push(resolve))) },
  } as unknown as ChatHistoryState;
  const first = refreshConversationTaskProgress(state);
  state.sessionKey = "b";
  const second = refreshConversationTaskProgress(state);
  pending[1]({
    progress: null,
    tasks: [{ taskId: "b", sourceMessageId: "b", goal: "B", lifecycle: "active", progress: null }],
  });
  await second;
  pending[0]({
    progress: null,
    tasks: [{ taskId: "a", sourceMessageId: "a", goal: "A", lifecycle: "active", progress: null }],
  });
  await first;
  expect(getConversationTaskProgressEntries().map((entry) => entry.taskId)).toEqual(["b"]);
  setConversationTaskProgressEntries([]);
});

it("rejects an older response even after a session switches away and back", async () => {
  const pending: Array<(result: unknown) => void> = [];
  const state = {
    sessionKey: "a",
    connected: true,
    conversationTaskProgress: null,
    client: { request: vi.fn(() => new Promise((resolve) => pending.push(resolve))) },
  } as unknown as ChatHistoryState;
  const first = refreshConversationTaskProgress(state);
  const newer = refreshConversationTaskProgress(state);
  pending[1]({ progress: null, tasks: [] });
  await newer;
  pending[0]({ progress: null, tasks: [{ taskId: "old" }] });
  await first;
  expect(getConversationTaskProgressEntries()).toEqual([]);
});
