import { describe, expect, it } from "vitest";
import { isMemoryFlushHistoryMessage, isMemoryFlushPromptText } from "./memory-flush-prompt.js";

describe("isMemoryFlushPromptText", () => {
  it("matches the default pre-compaction prompt", () => {
    expect(
      isMemoryFlushPromptText(
        "Pre-compaction memory flush. Store durable memories only in memory/2026-08-11.md (create memory/ if needed). Treat workspace bootstrap/reference files such as MEMORY.md, SOUL.md, TOOLS.md, and AGENTS.md as read-only during this flush; never overwrite, replace, or edit them. If memory/2026-08-11.md already exists, APPEND new content only and do not overwrite existing entries. Do NOT create timestamped variant files (e.g., 2026-08-11-HHMM.md); always use the canonical 2026-08-11.md filename. If nothing to store, reply with NO_REPLY.\nCurrent time: Tuesday, August 11th, 2026 — 3:05 AM (UTC)",
      ),
    ).toBe(true);
  });

  it("matches custom prompts that still carry required safety hints", () => {
    expect(
      isMemoryFlushPromptText(
        "Please distill notes.\n\nStore durable memories only in memory/2026-08-11.md (create memory/ if needed).\n\nTreat workspace bootstrap/reference files such as MEMORY.md as read-only during this flush.",
      ),
    ).toBe(true);
  });

  it("does not match ordinary user chat", () => {
    expect(isMemoryFlushPromptText("帮我看看今天的日程")).toBe(false);
    expect(isMemoryFlushPromptText("Store durable memories in Notion")).toBe(false);
  });
});

describe("isMemoryFlushHistoryMessage", () => {
  it("hides user-role flush prompts and keeps normal user/assistant messages", () => {
    expect(
      isMemoryFlushHistoryMessage({
        role: "user",
        content: [
          {
            type: "text",
            text: "Pre-compaction memory flush. Store durable memories only in memory/2026-08-11.md",
          },
        ],
      }),
    ).toBe(true);
    expect(
      isMemoryFlushHistoryMessage({
        role: "assistant",
        content: [{ type: "text", text: "Pre-compaction memory flush." }],
      }),
    ).toBe(false);
    expect(
      isMemoryFlushHistoryMessage({
        role: "user",
        content: [{ type: "text", text: "你好" }],
      }),
    ).toBe(false);
  });
});
