import { describe, expect, it } from "vitest";
import {
  isCollaborationEchoConfirmationText,
  shouldHideCollaborationAssistantMessage,
} from "./collaboration-message-filter.ts";

describe("collaboration message filter", () => {
  it("hides NO_REPLY assistant messages", () => {
    expect(
      shouldHideCollaborationAssistantMessage({
        role: "assistant",
        content: [{ type: "text", text: "NO_REPLY" }],
      }),
    ).toBe(true);
  });

  it("hides echo confirmation assistant messages", () => {
    expect(
      isCollaborationEchoConfirmationText("收到！老大明确了执行方向，条件齐了，可以开工。"),
    ).toBe(true);
    expect(
      shouldHideCollaborationAssistantMessage({
        role: "assistant",
        text: "收到！老大明确了执行方向，条件齐了，可以开工。",
      }),
    ).toBe(true);
  });

  it("keeps substantive assistant replies visible", () => {
    expect(
      shouldHideCollaborationAssistantMessage({
        role: "assistant",
        text: "我将整理端午民俗资料并写入 festival-knowledge。",
      }),
    ).toBe(false);
  });
});
