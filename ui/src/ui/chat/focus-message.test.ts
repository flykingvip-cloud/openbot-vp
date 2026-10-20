// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyPendingChatFocusMessage,
  consumePendingChatFocusMessage,
  focusChatMessageInView,
  peekPendingChatFocusMessage,
  resolveMessageDomId,
  setPendingChatFocusMessage,
} from "./focus-message.ts";

afterEach(() => {
  setPendingChatFocusMessage(null);
});

describe("chat focus-message helpers", () => {
  it("stores and consumes pending focus for the matching session only", () => {
    setPendingChatFocusMessage({
      sessionKey: "agent:main:space:g1",
      messageId: "msg-1",
    });
    expect(peekPendingChatFocusMessage()?.messageId).toBe("msg-1");
    expect(consumePendingChatFocusMessage("agent:main:space:other")).toBeNull();
    expect(consumePendingChatFocusMessage("agent:main:space:g1")).toBe("msg-1");
    expect(peekPendingChatFocusMessage()).toBeNull();
  });

  it("resolves message DOM ids from id or messageId", () => {
    expect(resolveMessageDomId({ id: "a" })).toBe("a");
    expect(resolveMessageDomId({ messageId: "b" })).toBe("b");
    expect(resolveMessageDomId({})).toBe("");
  });

  it("scrolls and highlights a rendered message node", async () => {
    const node = document.createElement("div");
    node.setAttribute("data-message-id", "msg-focus");
    const scrollIntoView = vi.fn();
    node.scrollIntoView = scrollIntoView;
    document.body.append(node);
    const host = {
      updateComplete: Promise.resolve(),
      querySelector: (sel: string) => document.querySelector(sel),
    };
    await expect(focusChatMessageInView(host, "msg-focus")).resolves.toBe(true);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(node.classList.contains("is-mention-focus")).toBe(true);
    node.remove();
  });

  it("applies pending focus after session switch", async () => {
    setPendingChatFocusMessage({
      sessionKey: "space:g1",
      messageId: "msg-pending",
    });
    const node = document.createElement("div");
    node.setAttribute("data-message-id", "msg-pending");
    const scrollIntoView = vi.fn();
    node.scrollIntoView = scrollIntoView;
    document.body.append(node);
    const ok = await applyPendingChatFocusMessage({
      sessionKey: "space:g1",
      updateComplete: Promise.resolve(),
      querySelector: (sel: string) => document.querySelector(sel),
    });
    expect(ok).toBe(true);
    expect(scrollIntoView).toHaveBeenCalled();
    node.remove();
  });
});
