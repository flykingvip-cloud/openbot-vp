import { describe, expect, it } from "vitest";
import { sanitizeChatHistoryMessagesForTest } from "../../gateway/server-methods/chat.js";
import { stripInlineDirectiveTagsForDisplay } from "../../utils/directive-tags.js";
import fixtures from "./assistant-scratchpad.jd-fixtures.json" with { type: "json" };
import {
  isHiddenToolUseScratchpadMessage,
  stripAssistantScratchpadFromText,
} from "./assistant-scratchpad.js";

const preTool = fixtures["2efb0e96"].text;
const postTool = fixtures["3f1ef14e"].text;

const EXPECTED_ANSWER = [
  '云电脑的网络能访问京东（返回 200，首页标题可正常取到），但沙箱内没有浏览器可执行文件、host 浏览器控制也被策略禁用，所以没法真正"弹出页面"。',
  "",
  "如果你要的是看页面或操作（登录后台、查订单），我可以改用隔离浏览器代你打开，你只需扫码确认一次——告诉我具体要做什么就行。",
].join("\n");

describe("Chinese scratchpad from the 京东 transcript", () => {
  it("hides the pre-tool chain of thought (2efb0e96)", () => {
    expect(stripAssistantScratchpadFromText(preTool, "zh")).toBe("");
    expect(stripInlineDirectiveTagsForDisplay(preTool, "zh").text.trim()).toBe("");
    expect(
      isHiddenToolUseScratchpadMessage(
        {
          role: "assistant",
          stopReason: "toolUse",
          content: [
            { type: "text", text: preTool },
            { type: "toolCall", id: "call-1", name: "exec" },
          ],
        },
        "zh",
      ),
    ).toBe(true);
  });

  it("keeps only the answer after [[reply_to_current]] (3f1ef14e)", () => {
    expect(stripInlineDirectiveTagsForDisplay(postTool, "zh").text).toBe(EXPECTED_ANSWER);
    expect(stripAssistantScratchpadFromText(postTool, "zh")).not.toContain("给回复");
    expect(stripAssistantScratchpadFromText(postTool, "zh")).not.toContain("用户希望我");
  });

  it("history reload matches the live cleaner and drops the tool-use bubble", () => {
    const sanitized = sanitizeChatHistoryMessagesForTest([
      { role: "user", content: [{ type: "text", text: "在云电脑上打开京东" }] },
      {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          { type: "text", text: preTool },
          { type: "toolCall", id: "call-1", name: "exec" },
        ],
      },
      {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: postTool }],
      },
    ]) as Array<{ role?: string; replyLanguage?: string; content?: Array<{ text?: string }> }>;

    expect(sanitized.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(sanitized[1]?.replyLanguage).toBe("zh");
    expect(sanitized[1]?.content?.[0]?.text).toBe(EXPECTED_ANSWER);
  });

  it("does not hide an ordinary Chinese answer", () => {
    const samples = [
      "今天的风险有三项：排期、依赖、验收。",
      "京东首页返回了 200，标题也能取到。",
      "请保持接口稳定，我先把结果发给你。",
      "结论已经写在上面的文档里。",
    ];
    for (const sample of samples) {
      expect(stripInlineDirectiveTagsForDisplay(sample, "zh").text).toBe(sample);
    }
  });

  it("keeps English planning when the turn language is English", () => {
    const text = "I'll start by looking at my workspace to see what's there.";
    expect(stripAssistantScratchpadFromText(text, "en")).toBe(text);
    expect(stripInlineDirectiveTagsForDisplay(preTool, "en").text).toContain("用户希望我");
  });
});
