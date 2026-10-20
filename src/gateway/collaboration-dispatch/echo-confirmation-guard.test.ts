import { describe, expect, it } from "vitest";
import { classifyEchoConfirmationReply } from "./echo-confirmation-guard.js";

describe("echo confirmation guard", () => {
  it("flags coordinator-style echo confirmations", () => {
    expect(classifyEchoConfirmationReply("收到！老大明确了执行方向，条件齐了，可以开工。")).toBe(
      true,
    );
  });

  it("allows substantive execution replies", () => {
    expect(
      classifyEchoConfirmationReply(
        "我将创建 festival-knowledge 条目，整理端午民俗资料并输出 Markdown 摘要。",
      ),
    ).toBe(false);
  });
});
