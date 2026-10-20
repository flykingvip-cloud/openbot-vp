import { describe, expect, test } from "vitest";
import {
  applyContextExpansionToScope,
  extractLatestUserText,
  parseContextExpansionAgentEvent,
} from "./context-expansion.ts";
import { DEFAULT_CHAT_CONTEXT_SCOPE } from "./context-scope.ts";

describe("context expansion confirmation", () => {
  test("parses an authorized suggestion and ignores junk", () => {
    const parsed = parseContextExpansionAgentEvent({
      runId: "run-1",
      sessionKey: "main",
      data: {
        event: "chat.context_expansion_suggested",
        reason: "empty",
        proposedSources: [
          { type: "knowledge", id: "kb-product", label: "产品资料库" },
          { type: "file", id: "  ", label: "bad" },
          { type: "secret", id: "kb-finance", label: "财务" },
        ],
      },
    });
    expect(parsed).toEqual({
      runId: "run-1",
      sessionKey: "main",
      reason: "empty",
      proposedSources: [{ type: "knowledge", id: "kb-product", label: "产品资料库" }],
    });
    expect(
      parseContextExpansionAgentEvent({
        runId: "run-1",
        data: { event: "chat.knowledge_finished", proposedSources: [] },
      }),
    ).toBeNull();
  });

  test("confirm merges proposed sources into focused custom scope", () => {
    const next = applyContextExpansionToScope(DEFAULT_CHAT_CONTEXT_SCOPE, [
      { type: "knowledge", id: "kb-product", label: "产品资料库" },
    ]);
    expect(next.preset).toBe("custom");
    expect(next.selectedSources).toEqual([
      { type: "knowledge", id: "kb-product", label: "产品资料库" },
    ]);
    const ignored = applyContextExpansionToScope(
      { ...DEFAULT_CHAT_CONTEXT_SCOPE, preset: "conversation" },
      [],
    );
    expect(ignored.preset).toBe("conversation");
    expect(ignored.selectedSources).toEqual([]);
  });

  test("retry uses the last user message and does not invent sources", () => {
    expect(
      extractLatestUserText([
        { role: "user", content: "查差旅政策" },
        { role: "assistant", content: "目前资料不够。" },
      ]),
    ).toBe("查差旅政策");
  });
});
