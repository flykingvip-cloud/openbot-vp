import { describe, expect, it } from "vitest";
import {
  buildTurnReplyLanguageInstruction,
  resolveTurnReplyLanguage,
  sanitizeTurnVisibleReply,
} from "./turn-reply-language.js";

describe("resolveTurnReplyLanguage", () => {
  it("detects zh from short user message", () => {
    expect(
      resolveTurnReplyLanguage({
        userMessage: "为何暂停了",
      }),
    ).toBe("zh");
  });

  it("detects en from an English user question", () => {
    expect(
      resolveTurnReplyLanguage({
        userMessage: "Why did the last reply stop before the final answer?",
      }),
    ).toBe("en");
  });

  it("falls back to recent user history", () => {
    expect(
      resolveTurnReplyLanguage({
        userMessage: "ok",
        sessionMessages: [
          {
            role: "user",
            content: [{ type: "text", text: "请用中文总结一下今天的项目风险" }],
          },
        ],
      }),
    ).toBe("zh");
  });
});

describe("buildTurnReplyLanguageInstruction", () => {
  it("includes Chinese lock text", () => {
    const instruction = buildTurnReplyLanguageInstruction("zh");
    expect(instruction).toContain("思考过程不得出现在回复正文里");
    expect(instruction).toContain("不要列提纲");
    expect(instruction).not.toContain("最多三句：结论、依据、下一步");
    expect(instruction).toContain("不要请用户再上传");
  });

  it("includes English think-and-reply lock text", () => {
    expect(buildTurnReplyLanguageInstruction("en")).toContain("Think and reply in English");
  });

  // Regression: a pdf tool run failed three times and the reply still contained a
  // confident <<DELIVERABLE>> summary inferred from the file name. The brevity rule
  // ("直接给成果，不要写过程") must not outrank reporting a tool failure.
  it.each(["zh", "en", null] as const)(
    "requires reporting tool failures instead of fabricating a deliverable (%s)",
    (language) => {
      const instruction = buildTurnReplyLanguageInstruction(language);
      expect(instruction).toContain("status=error");
      expect(instruction).toContain("不得用文件名、标题或常识把结果补全");
      expect(instruction).toContain("也不要输出 <<DELIVERABLE>>");
    },
  );
});

describe("sanitizeTurnVisibleReply", () => {
  it("strips English planning drafts for zh users", () => {
    const result = sanitizeTurnVisibleReply({
      expectedLanguage: "zh",
      text: "Looking at the chat history, I should answer briefly.\n\n已暂停是因为上一轮工具调用还在排队，请点继续。",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("已暂停");
      expect(result.text).not.toContain("Looking at the chat history");
    }
  });

  it("keeps English thinking for English users", () => {
    const text = "I'll start by looking at my workspace to see what's there.";
    expect(
      sanitizeTurnVisibleReply({
        expectedLanguage: "en",
        text,
      }),
    ).toEqual({ ok: true, text, trimmed: false });
  });
});
