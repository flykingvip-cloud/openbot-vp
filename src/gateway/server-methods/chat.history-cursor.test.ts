import { describe, expect, it } from "vitest";
import { decodeHistoryCursor } from "../../conversations/history-cursor.js";
import { boundChatHistoryMessages } from "./chat.js";

function userMsg(label: string, timestamp: number) {
  return {
    role: "user",
    content: [{ type: "text", text: label }],
    timestamp,
  };
}

function extractText(message: unknown): string {
  const content = (message as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}

describe("chat.history cursor (CL-P1-02)", () => {
  it("returns newest page with nextBefore and hasMore for live sessions", () => {
    const raw = Array.from({ length: 25 }, (_, i) => userMsg(`m${i}`, i));
    const page1 = boundChatHistoryMessages({
      rawMessages: raw,
      limit: 10,
      includeTools: false,
      sessionId: "sess-hist-1",
    });
    expect(page1.messages).toHaveLength(10);
    expect(extractText(page1.messages[0])).toBe("m15");
    expect(extractText(page1.messages[9])).toBe("m24");
    expect(page1.hasMore).toBe(true);
    expect(page1.nextBefore).toBeTruthy();
    expect(page1.nextBefore).not.toContain(".jsonl");

    const decoded = decodeHistoryCursor(page1.nextBefore!);
    expect(decoded?.beforeIndex).toBe(15);
  });

  it("loads older messages when before cursor is supplied", () => {
    const raw = Array.from({ length: 25 }, (_, i) => userMsg(`m${i}`, i));
    const page1 = boundChatHistoryMessages({
      rawMessages: raw,
      limit: 10,
      includeTools: false,
      sessionId: "sess-hist-1",
    });
    const page2 = boundChatHistoryMessages({
      rawMessages: raw,
      limit: 10,
      includeTools: false,
      sessionId: "sess-hist-1",
      before: page1.nextBefore,
    });
    expect(page2.messages).toHaveLength(10);
    expect(extractText(page2.messages[0])).toBe("m5");
    expect(extractText(page2.messages[9])).toBe("m14");
    expect(page2.hasMore).toBe(true);
  });

  it("rejects invalid or mismatched cursors", () => {
    const raw = [userMsg("m0", 0)];
    expect(() =>
      boundChatHistoryMessages({
        rawMessages: raw,
        limit: 5,
        includeTools: false,
        sessionId: "sess-hist-1",
        before: "not-a-cursor",
      }),
    ).toThrow(/cursor/i);
  });

  it("keeps archive-style limit-only slice when sessionId is omitted", () => {
    const raw = Array.from({ length: 25 }, (_, i) => userMsg(`m${i}`, i));
    const bounded = boundChatHistoryMessages({
      rawMessages: raw,
      limit: 10,
      includeTools: false,
    });
    expect(bounded.messages).toHaveLength(10);
    expect(extractText(bounded.messages[0])).toBe("m15");
    expect(bounded.nextBefore).toBeUndefined();
    expect(bounded.hasMore).toBeUndefined();
  });
});
