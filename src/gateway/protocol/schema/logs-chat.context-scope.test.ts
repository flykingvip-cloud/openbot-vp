import { describe, expect, it } from "vitest";
import { validateChatSendParams } from "../index.js";

describe("chat.send typed context scope", () => {
  it("accepts parent-scoped knowledge child sources", () => {
    expect(
      validateChatSendParams({
        sessionKey: "agent:main:main",
        message: "只看路线图",
        idempotencyKey: "run-typed-scope",
        contextScope: {
          mode: "focused",
          lifetime: "turn",
          sources: [{ type: "file", id: "doc-roadmap", parentId: "kb-product" }],
        },
      }),
    ).toBe(true);
  });
});
