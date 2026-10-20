// @vitest-environment jsdom
/**
 * Chromium/browser verification: real chat composer → chat.send payload retains parentId.
 * Pending contextScope is injected via test helper (not a production window API).
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  CONTEXT_SCOPE_CHAT_MESSAGE,
  CONTEXT_SCOPE_PARENTLESS_FILE,
  CONTEXT_SCOPE_TYPED_FILE,
  expectTypedFileParentScope,
} from "../../../../src/gateway/context-scope/chat-context-scope-fixtures.ts";
import {
  mountChatComposerWithCatalogPicker,
  mountChatComposerWithPendingScope,
} from "../test-helpers/chat-context-scope-send.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("chat composer parent-scoped contextScope (browser)", () => {
  it("clicks Send and preserves typed parentId on the only chat.send request", async () => {
    const { container, captures } = await mountChatComposerWithPendingScope({
      contextScope: CONTEXT_SCOPE_TYPED_FILE,
    });

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    const sendButton = container.querySelector<HTMLButtonElement>(".chat-compose__send-btn");
    expect(textarea).not.toBeNull();
    expect(sendButton).not.toBeNull();

    textarea!.value = CONTEXT_SCOPE_CHAT_MESSAGE;
    textarea!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    sendButton!.click();

    await waitForChatSend(captures);

    expect(captures).toHaveLength(1);
    expect(captures[0]?.method).toBe("chat.send");
    expectTypedFileParentScope(captures[0]?.params.contextScope);
    expect(captures[0]?.params.message).toBe(CONTEXT_SCOPE_CHAT_MESSAGE);
    expect(captures[0]?.params.deliver).toBe(false);
    expect(typeof captures[0]?.params.idempotencyKey).toBe("string");
  });

  it("does not invent a parentId when pending scope is parentless", async () => {
    const { container, captures } = await mountChatComposerWithPendingScope({
      contextScope: CONTEXT_SCOPE_PARENTLESS_FILE,
      message: CONTEXT_SCOPE_CHAT_MESSAGE,
    });

    const sendButton = container.querySelector<HTMLButtonElement>(".chat-compose__send-btn");
    expect(sendButton).not.toBeNull();
    sendButton!.click();

    await waitForChatSend(captures);

    expect(captures).toHaveLength(1);
    const capture = captures[0];
    expect(capture.method).toBe("chat.send");
    expect(capture.params.contextScope).toEqual(CONTEXT_SCOPE_PARENTLESS_FILE);
    const sources = (capture.params.contextScope as { sources?: Array<{ parentId?: string }> })
      .sources;
    expect(sources?.[0]?.parentId).toBeUndefined();
  });

  it("selects a catalog file in the production picker and keeps parentId on chat.send", async () => {
    const { container, captures } = await mountChatComposerWithCatalogPicker({
      message: CONTEXT_SCOPE_CHAT_MESSAGE,
      catalog: [
        { type: "knowledge", id: "kb-product", label: "产品资料", visibility: "private" },
        {
          type: "file",
          id: "doc-roadmap",
          label: "roadmap.md",
          parentId: "kb-product",
          visibility: "private",
        },
      ],
    });

    const fileCheck = container.querySelector<HTMLInputElement>(
      '[data-key="file:doc-roadmap"] input[type="checkbox"]',
    );
    expect(fileCheck).not.toBeNull();
    fileCheck!.click();

    const sendButton = container.querySelector<HTMLButtonElement>(".chat-compose__send-btn");
    expect(sendButton).not.toBeNull();
    sendButton!.click();

    await waitForChatSend(captures);
    expect(captures).toHaveLength(1);
    expectTypedFileParentScope(captures[0]?.params.contextScope);
  });
});

async function waitForChatSend(
  captures: Array<{ method: string }>,
  timeoutMs = 2_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (captures.some((entry) => entry.method === "chat.send")) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for chat.send capture");
}
