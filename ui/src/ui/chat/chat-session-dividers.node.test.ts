// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { MessageGroup } from "../types/chat-types.ts";
import {
  formatChatSessionDividerLabel,
  insertChatSessionDividers,
} from "./chat-session-dividers.ts";

describe("insertChatSessionDividers", () => {
  it("inserts one session divider before the first message group", () => {
    const group: MessageGroup = {
      kind: "group",
      key: "group-1",
      role: "assistant",
      timestamp: Date.UTC(2026, 6, 15, 1, 13, 0),
      isStreaming: false,
      messages: [{ key: "m-1", message: { role: "assistant", content: "hi" } }],
    };
    const result = insertChatSessionDividers([group]);
    expect(result).toHaveLength(2);
    expect(result[0]?.kind).toBe("divider");
    if (result[0]?.kind === "divider") {
      expect(result[0].variant).toBe("session");
    }
    expect(result[1]).toBe(group);
  });

  it("inserts a new divider when the calendar day changes", () => {
    const first: MessageGroup = {
      kind: "group",
      key: "group-1",
      role: "user",
      timestamp: Date.UTC(2026, 6, 15, 1, 0, 0),
      isStreaming: false,
      messages: [{ key: "m-1", message: { role: "user", content: "a" } }],
    };
    const second: MessageGroup = {
      kind: "group",
      key: "group-2",
      role: "assistant",
      timestamp: Date.UTC(2026, 6, 16, 2, 0, 0),
      isStreaming: false,
      messages: [{ key: "m-2", message: { role: "assistant", content: "b" } }],
    };
    const result = insertChatSessionDividers([first, second]);
    const dividers = result.filter((item) => item.kind === "divider");
    expect(dividers).toHaveLength(2);
  });
});

describe("formatChatSessionDividerLabel", () => {
  it("formats a zh-CN style session label", () => {
    const label = formatChatSessionDividerLabel(Date.UTC(2026, 5, 15, 1, 13, 0), "zh-CN");
    expect(label).toMatch(/6月15日/);
    expect(label).toMatch(/9:13|09:13/);
  });
});
