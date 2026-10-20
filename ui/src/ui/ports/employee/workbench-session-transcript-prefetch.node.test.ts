import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readWorkbenchSessionTranscript,
  resetWorkbenchSessionTranscriptCacheForTests,
  writeWorkbenchSessionTranscript,
} from "./workbench-session-transcript-cache.ts";
import {
  cancelWorkbenchTranscriptPrefetch,
  listWorkbenchTranscriptPrefetchKeys,
  prefetchWorkbenchSessionTranscripts,
} from "./workbench-session-transcript-prefetch.ts";

function readSessionKey(params: unknown): string {
  if (!params || typeof params !== "object" || !("sessionKey" in params)) {
    return "";
  }
  const sessionKey = (params as { sessionKey?: unknown }).sessionKey;
  return typeof sessionKey === "string" ? sessionKey : "";
}

describe("workbench-session-transcript-prefetch", () => {
  beforeEach(() => {
    resetWorkbenchSessionTranscriptCacheForTests();
    cancelWorkbenchTranscriptPrefetch();
  });

  it("prefers recent assistant mains and group lanes, skipping cron and 1:1 children", () => {
    const keys = listWorkbenchTranscriptPrefetchKeys(
      [
        { key: "agent:bot-a:main", updatedAt: 30 },
        { key: "agent:bot-a:telegram:direct:alice", updatedAt: 90 },
        { key: "cron:nightly", updatedAt: 80 },
        { key: "space:alpha", updatedAt: 40 },
        { key: "agent:main:space:alpha", updatedAt: 41 },
        { key: "agent:bot-b:main", updatedAt: 10 },
      ],
      "agent:bot-a:main",
    );

    expect(keys).toEqual(["space:alpha", "agent:bot-b:main"]);
  });

  it("writes neighbor history into the cache without touching the open thread", async () => {
    const request = vi.fn(async (_method: string, params?: unknown) => {
      const sessionKey = readSessionKey(params);
      return {
        messages: [{ role: "assistant", content: [{ type: "text", text: sessionKey }] }],
        nextBefore: null,
        hasMore: false,
      };
    });

    await prefetchWorkbenchSessionTranscripts({
      client: { request },
      connected: true,
      sessions: [
        { key: "agent:bot-a:main", updatedAt: 2 },
        { key: "agent:bot-b:main", updatedAt: 1 },
      ],
      currentSessionKey: "agent:bot-a:main",
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(readWorkbenchSessionTranscript("agent:bot-b:main")?.messages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "agent:bot-b:main" }] },
    ]);
  });

  it("skips sessions that already have a cache slot", async () => {
    writeWorkbenchSessionTranscript("agent:bot-b:main", {
      messages: [{ role: "assistant", content: [{ type: "text", text: "cached" }] }],
    });
    const request = vi.fn(async () => ({ messages: [] }));

    await prefetchWorkbenchSessionTranscripts({
      client: { request },
      connected: true,
      sessions: [{ key: "agent:bot-b:main", updatedAt: 1 }],
      currentSessionKey: "agent:bot-a:main",
    });

    expect(request).not.toHaveBeenCalled();
  });
});
