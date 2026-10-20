import { describe, expect, it } from "vitest";
import {
  APPROVE_CARD_CTA,
  EXEC_DENIED_USER_CTA,
  stripAssistantScratchpadFromContent,
  stripAssistantScratchpadFromText,
} from "./assistant-scratchpad.js";

describe("stripAssistantScratchpadFromText", () => {
  it("keeps pure Chinese answers", () => {
    expect(stripAssistantScratchpadFromText("本机微信目录在容器里，不能直接入库。")).toBe(
      "本机微信目录在容器里，不能直接入库。",
    );
  });

  it("keeps legitimate English product answers", () => {
    const t = "Your export folder is ready. Upload the txt files next.";
    expect(stripAssistantScratchpadFromText(t)).toBe(t);
  });

  it("strips I'll-start planning for zh users", () => {
    expect(
      stripAssistantScratchpadFromText(
        "I'll start by looking at my workspace to see what's there.",
        "zh",
      ),
    ).toBe("");
  });

  it("strips Now I / Good — openers for zh users", () => {
    expect(stripAssistantScratchpadFromText("Now I check the local export folder.", "zh")).toBe("");
    expect(stripAssistantScratchpadFromText("Good — I'll fetch the matching notes.", "zh")).toBe(
      "",
    );
  });

  it("drops English work-progress narration before a Chinese answer", () => {
    const leaked =
      "I have the full paper text and OpenBot's self-evolution docs. Now writing the WeChat article.";
    expect(stripAssistantScratchpadFromText(leaked)).toBe("");
    expect(stripAssistantScratchpadFromText(leaked, "zh")).toBe("");
    expect(
      stripAssistantScratchpadFromText(
        "I have the report ready. The export folder is on your desktop.",
      ),
    ).toContain("export folder");
  });

  it("keeps I'll-start thinking for English users", () => {
    const t = "I'll start by looking at my workspace to see what's there.";
    expect(stripAssistantScratchpadFromText(t, "en")).toBe(t);
  });

  it("still strips Layer B leaks for English users", () => {
    expect(
      stripAssistantScratchpadFromText(
        "I'll clarify the situation first: the task was denied (Exec denied, gateway id=5f53b11c).",
        "en",
      ),
    ).toBe(EXEC_DENIED_USER_CTA);
  });

  it("drops English CoT when followed by Chinese user text", () => {
    const leaked = [
      "The skill is at a path outside my sandbox. Let me try to read via exec.",
      "Actually, since exec needs approval, let me guide the user.",
      "这是我的环境需要在你本机执行命令来定位微信文件夹。请点一下本机只读授权。",
    ].join("\n\n");
    const out = stripAssistantScratchpadFromText(leaked);
    expect(out).toContain("定位微信文件夹");
    expect(out).not.toMatch(/sandbox/i);
    expect(out).not.toMatch(/Let me/i);
  });

  it("strip-because-card: peels /approve and rewrites CTA in Chinese delivery", () => {
    const t = [
      "请批准本机只读查找。",
      "```",
      "/approve 92a00388 allow-once",
      "```",
      "批准后我继续。",
    ].join("\n");
    const out = stripAssistantScratchpadFromText(t);
    expect(out).not.toMatch(/\/approve/);
    expect(out).toContain("请批准本机只读查找");
    expect(out).toContain("批准后我继续");
    expect(out).toContain(APPROVE_CARD_CTA);
  });

  it("L10: does not keep English CoT that only name-drops 微信", () => {
    const leaked = [
      "Let me inspect the 微信 folder path outside my sandbox via exec.",
      "Actually, the skill metadata says I need approval first.",
    ].join("\n\n");
    expect(stripAssistantScratchpadFromText(leaked)).toBe("");
  });

  it("returns empty for pure scratchpad English", () => {
    expect(
      stripAssistantScratchpadFromText("Let me try exec to read the skill outside my sandbox."),
    ).toBe("");
  });

  it("drops leaked exec-approval follow-up prompts even when a Chinese filename appears", () => {
    const leaked = [
      "t=open('公众号文章_思维链的窗口正在关上.md',encoding='utf-8').read()",
      "strip markdown symbols & whitespace, count CJK+alnum",
      "Reply to the user in a helpful way.",
      "If it succeeded, share the relevant output. If it failed, explain what went wrong.",
    ].join("\n");
    expect(stripAssistantScratchpadFromText(leaked)).toBe("");
  });

  it("rewrites Exec-denied meta English into a Chinese CTA", () => {
    const leaked =
      "I'll clarify the situation first: the task context references a previous executive command that was denied (Exec denied, gateway id=5f53b11c). So I should not re-run it.";
    expect(stripAssistantScratchpadFromText(leaked)).toBe(EXEC_DENIED_USER_CTA);
    expect(stripAssistantScratchpadFromText(leaked)).not.toMatch(/gateway id=/i);
    expect(stripAssistantScratchpadFromText(leaked)).not.toMatch(/Exec denied/i);
  });

  it("keeps a Chinese answer after stripping an exec follow-up prefix", () => {
    const leaked = [
      "An async command the user already approved has completed.",
      "Reply to the user in a helpful way.",
      "",
      "正文约 2.4 万字，标题和结构都已写完，可以直接预览。",
    ].join("\n\n");
    const out = stripAssistantScratchpadFromText(leaked);
    expect(out).toContain("正文约 2.4 万字");
    expect(out).not.toMatch(/already approved/i);
    expect(out).not.toMatch(/Reply to the user/i);
  });
});

describe("stripAssistantScratchpadFromContent", () => {
  it("strips type:text blocks and leaves type:thinking untouched", () => {
    const content = [
      { type: "thinking", thinking: "Let me inspect the sandbox path." },
      {
        type: "text",
        text: "The skill is outside my sandbox. Let me try exec.\n\n请点本机只读授权后继续。",
      },
    ];
    const out = stripAssistantScratchpadFromContent(content) as Array<Record<string, unknown>>;
    expect(out[0]).toEqual(content[0]);
    expect(out[1]?.text).toBe("请点本机只读授权后继续。");
  });
});
