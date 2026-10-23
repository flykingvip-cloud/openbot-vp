// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  readWorkbenchSessionTranscript,
  reloadWorkbenchSessionTranscriptCacheFromStorageForTests,
  resetWorkbenchSessionTranscriptCacheForTests,
  writeWorkbenchSessionTranscript,
} from "./workbench-session-transcript-cache.ts";

describe("workbench-session-transcript-cache", () => {
  beforeEach(() => {
    resetWorkbenchSessionTranscriptCacheForTests();
  });

  it("returns a cloned snapshot so later mutations do not dirty the cache", () => {
    const messages = [{ role: "assistant", content: [{ type: "text", text: "cached" }] }];
    writeWorkbenchSessionTranscript("agent:bot-a:main", {
      messages,
      chatHistoryNextBefore: "cursor-1",
      chatHistoryHasMore: true,
    });
    messages.push({ role: "user", content: [{ type: "text", text: "mutated" }] });

    const read = readWorkbenchSessionTranscript("agent:bot-a:main");
    expect(read?.messages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "cached" }] },
    ]);
    expect(read?.chatHistoryNextBefore).toBe("cursor-1");
    expect(read?.chatHistoryHasMore).toBe(true);
  });

  it("evicts the oldest session after the LRU cap", () => {
    for (let index = 0; index < 25; index += 1) {
      writeWorkbenchSessionTranscript(`agent:bot-${index}:main`, {
        messages: [{ role: "assistant", content: [{ type: "text", text: String(index) }] }],
      });
    }

    expect(readWorkbenchSessionTranscript("agent:bot-0:main")).toBeNull();
    expect(readWorkbenchSessionTranscript("agent:bot-24:main")?.messages).toHaveLength(1);
  });

  it("does not let an empty in-flight snapshot erase a painted transcript", () => {
    writeWorkbenchSessionTranscript("agent:bot-a:main", {
      messages: [{ role: "assistant", content: [{ type: "text", text: "keep" }] }],
    });
    writeWorkbenchSessionTranscript("agent:bot-a:main", {
      messages: [],
      chatHistoryNextBefore: null,
      chatHistoryHasMore: false,
    });

    expect(readWorkbenchSessionTranscript("agent:bot-a:main")?.messages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "keep" }] },
    ]);
  });

  it("rehydrates transcripts after a refresh", () => {
    writeWorkbenchSessionTranscript("agent:bot-a:main", {
      messages: [{ role: "assistant", content: [{ type: "text", text: "durable" }] }],
      chatHistoryNextBefore: "cursor-9",
      chatHistoryHasMore: true,
    });

    reloadWorkbenchSessionTranscriptCacheFromStorageForTests();

    expect(readWorkbenchSessionTranscript("agent:bot-a:main")).toEqual({
      messages: [{ role: "assistant", content: [{ type: "text", text: "durable" }] }],
      chatHistoryNextBefore: "cursor-9",
      chatHistoryHasMore: true,
      chatRunId: null,
      chatStream: null,
      chatStreamStartedAt: null,
      chatStreamSessionKey: null,
      chatThinkingProgress: null,
    });
  });

  it("keeps a painted transcript when an empty snapshot is not an intentional rewind", () => {
    writeWorkbenchSessionTranscript("agent:bot-a:main", {
      messages: [{ role: "assistant", content: [{ type: "text", text: "kept" }] }],
    });
    writeWorkbenchSessionTranscript("agent:bot-a:main", { messages: [] });
    expect(readWorkbenchSessionTranscript("agent:bot-a:main")?.messages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "kept" }] },
    ]);
  });

  it("replaces a painted transcript when restore rewinds to an empty thread", () => {
    writeWorkbenchSessionTranscript("agent:bot-a:main", {
      messages: [{ role: "user", content: [{ type: "text", text: "你好" }] }],
    });
    writeWorkbenchSessionTranscript("agent:bot-a:main", { messages: [] }, { allowEmpty: true });
    expect(readWorkbenchSessionTranscript("agent:bot-a:main")?.messages).toEqual([]);
  });

  it("keeps in-memory run occupancy and does not persist it across refresh", () => {
    writeWorkbenchSessionTranscript("agent:bot-a:main", {
      messages: [{ role: "user", content: [{ type: "text", text: "task" }] }],
      chatRunId: "run-1",
      chatStream: "working",
      chatStreamStartedAt: 9,
      chatStreamSessionKey: "agent:bot-a:main",
    });

    expect(readWorkbenchSessionTranscript("agent:bot-a:main")?.chatRunId).toBe("run-1");

    reloadWorkbenchSessionTranscriptCacheFromStorageForTests();

    expect(readWorkbenchSessionTranscript("agent:bot-a:main")?.chatRunId).toBeNull();
    expect(readWorkbenchSessionTranscript("agent:bot-a:main")?.messages).toHaveLength(1);
  });

  it("shares one cache slot across space aliases and scoped group mirrors", () => {
    writeWorkbenchSessionTranscript("agent:main:main:space:alpha", {
      messages: [{ role: "assistant", content: [{ type: "text", text: "group" }] }],
    });

    expect(readWorkbenchSessionTranscript("space:alpha")?.messages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "group" }] },
    ]);
    expect(readWorkbenchSessionTranscript("agent:main:space:alpha")?.messages).toHaveLength(1);
  });

  it("keeps a decision status slice across refresh and does not let an empty snapshot erase it", () => {
    writeWorkbenchSessionTranscript("agent:bot-a:main", {
      messages: [{ role: "assistant", content: [{ type: "text", text: "form" }] }],
      oguiDecisions: {
        ogd_cache: { decisionStatus: "answered", version: 2 },
      },
    });
    writeWorkbenchSessionTranscript("agent:bot-a:main", { messages: [] });

    expect(readWorkbenchSessionTranscript("agent:bot-a:main")?.oguiDecisions).toEqual({
      ogd_cache: { decisionStatus: "answered", version: 2 },
    });

    reloadWorkbenchSessionTranscriptCacheFromStorageForTests();

    expect(readWorkbenchSessionTranscript("agent:bot-a:main")?.oguiDecisions).toEqual({
      ogd_cache: { decisionStatus: "answered", version: 2 },
    });
  });

  it("lets an explicit null status slice clear a painted decision map", () => {
    writeWorkbenchSessionTranscript("agent:bot-a:main", {
      messages: [{ role: "assistant", content: [{ type: "text", text: "form" }] }],
      oguiDecisions: {
        ogd_cache: { decisionStatus: "waiting", version: 1 },
      },
    });
    writeWorkbenchSessionTranscript("agent:bot-a:main", {
      messages: [{ role: "assistant", content: [{ type: "text", text: "form" }] }],
      oguiDecisions: null,
    });

    expect(readWorkbenchSessionTranscript("agent:bot-a:main")?.oguiDecisions).toBeNull();
  });

  it("collapses extra robot aliases onto the bot main transcript slot", () => {
    writeWorkbenchSessionTranscript("agent:bot-a:main", {
      messages: [{ role: "assistant", content: [{ type: "text", text: "main" }] }],
    });
    writeWorkbenchSessionTranscript("agent:bot-a:telegram:direct:alice", {
      messages: [{ role: "assistant", content: [{ type: "text", text: "telegram" }] }],
    });

    expect(readWorkbenchSessionTranscript("agent:bot-a:main")?.messages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "telegram" }] },
    ]);
  });
});
