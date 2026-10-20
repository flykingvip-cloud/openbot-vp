import { describe, expect, it } from "vitest";
import { extractRawText, extractText, extractThinking } from "./message-extract.ts";

describe("extractRawText delivery channel", () => {
  it("keeps type:thinking out of the text join and strips CoT from type:text", () => {
    const message = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Let me inspect the sandbox path." },
        {
          type: "text",
          text: [
            "The skill is outside my sandbox. Let me try exec.",
            "",
            "请点本机只读授权后继续。",
          ].join("\n"),
        },
      ],
    };
    const raw = extractRawText(message);
    expect(raw).toContain("请点本机只读授权");
    expect(raw).not.toMatch(/sandbox/i);
    expect(raw).not.toMatch(/Let me/i);
    // Thinking stays on the independent type:thinking channel.
    expect(extractThinking(message)).toContain("sandbox path");
  });

  it("final bubble/history delivery body is C-only via extractText", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "text",
          text: [
            "The skill is at a path outside my sandbox. Let me try to read via exec.",
            "",
            "这是我的环境需要在你本机执行命令来定位微信文件夹。请点一下本机只读授权。",
            "```",
            "/approve 92a00388 allow-once",
            "```",
            "批准后我继续。",
          ].join("\n"),
        },
      ],
    };
    const body = extractText(message);
    expect(body).toContain("定位微信文件夹");
    expect(body).toContain("批准后我继续");
    expect(body).toContain("请批准下面这条命令");
    expect(body).not.toMatch(/\/approve/);
    expect(body).not.toMatch(/sandbox/i);
    expect(body).not.toMatch(/Let me/i);
  });

  it("smoke: CoT+Chinese → Chinese; /approve strip-because-card; English kept; pure scratchpad empty", () => {
    expect(
      extractText({
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Actually, since exec needs approval, let me guide the user.\n\n请继续授权。",
          },
        ],
      }),
    ).toBe("请继续授权。");

    expect(
      extractText({
        role: "assistant",
        content: [
          {
            type: "text",
            text: "请批准。\n```\n/approve 92a00388 allow-once\n```\n谢谢。",
          },
        ],
      }),
    ).toContain("请批准下面这条命令");
    expect(
      extractText({
        role: "assistant",
        content: [
          {
            type: "text",
            text: "请批准。\n```\n/approve 92a00388 allow-once\n```\n谢谢。",
          },
        ],
      }),
    ).not.toMatch(/\/approve/);

    expect(
      extractText({
        role: "assistant",
        content: [
          { type: "text", text: "Your export folder is ready. Upload the txt files next." },
        ],
      }),
    ).toBe("Your export folder is ready. Upload the txt files next.");

    expect(
      extractRawText({
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Let me try exec to read the skill outside my sandbox.",
          },
        ],
      }),
    ).toBeNull();
  });

  it("keeps sibling text when a content part is null", () => {
    const essay = "这一轮的可见回复已经写好。";
    const message = {
      role: "assistant",
      content: [
        null,
        { type: "thinking", thinking: "plan" },
        { type: "text", text: essay },
        { type: "toolCall", name: "search" },
      ],
    };
    expect(extractRawText(message)).toBe(essay);
    expect(extractText(message)).toBe(essay);
    expect(extractThinking(message)).toContain("plan");
  });
});
