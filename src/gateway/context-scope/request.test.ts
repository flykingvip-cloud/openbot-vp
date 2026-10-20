import { describe, expect, test } from "vitest";
import { parseChatContextScopeRequest } from "./request.js";

describe("parseChatContextScopeRequest", () => {
  test("maps protocol ids onto typed sources", () => {
    expect(
      parseChatContextScopeRequest({
        mode: "focused",
        lifetime: "turn",
        sources: [
          { type: "group", id: "alpha" },
          { type: "file", id: "doc-1", parentId: "kb-1" },
          { type: "knowledge", id: "authorized" },
        ],
      }),
    ).toEqual({
      mode: "focused",
      lifetime: "turn",
      sources: [
        { type: "group", groupId: "alpha" },
        { type: "file", fileId: "doc-1", parentId: "kb-1" },
        { type: "knowledge", knowledgeBaseId: "authorized" },
      ],
    });
  });

  test("ignores empty or unknown payloads", () => {
    expect(parseChatContextScopeRequest(undefined)).toBeUndefined();
    expect(parseChatContextScopeRequest({ mode: "rag" })).toBeUndefined();
    expect(parseChatContextScopeRequest({ sources: [{ type: "file", id: "  " }] })).toBeUndefined();
  });
});
