import { describe, expect, it } from "vitest";
import {
  holdBackIncompleteControlSuffix,
  isControlChannelOnlyText,
  isInternalContinuePromptText,
  stripAbsoluteWorkspacePaths,
  stripControlChannelForDisplay,
  stripDeliverableEnvelopeTags,
  stripToolDigestLines,
  stripTurnCompletionMarkers,
  TOOL_DIGEST_CLOSE_SENTINEL,
  TOOL_DIGEST_OPEN_SENTINEL,
} from "./control-channel-visibility.js";

describe("control-channel-visibility", () => {
  it("strips turn_completion markers from visible text", () => {
    const raw = [
      "[turn_completion state=true_fork options=option_a|option_b]",
      "有两种规格，请选 A 还是 B。",
    ].join("\n");
    const out = stripTurnCompletionMarkers(raw);
    expect(out).toBe("有两种规格，请选 A 还是 B。");
    expect(out).not.toMatch(/turn_completion|state=true_fork/);
  });

  it("strips tool-digest units including preview body", () => {
    const raw = [
      "稍等。",
      TOOL_DIGEST_OPEN_SENTINEL,
      "[tool-digest] exec ls -l",
      "NO 10-30 DIR",
      "",
      "extra para inside digest",
      TOOL_DIGEST_CLOSE_SENTINEL,
      "好了。",
    ].join("\n");
    const out = stripToolDigestLines(raw);
    expect(out).not.toContain("[tool-digest]");
    expect(out).not.toContain("NO 10-30 DIR");
    expect(out).not.toContain("extra para inside digest");
    expect(out).toContain("稍等。");
    expect(out).toContain("好了。");
  });

  it("strips pure digest header+preview with no leftover body", () => {
    const raw = "[tool-digest] exec command=ls\n内部工具返回：PRIVATE_DIGEST_OUTPUT";
    const out = stripToolDigestLines(raw);
    expect(out).toBe("");
    expect(out).not.toContain("PRIVATE_DIGEST_OUTPUT");
  });

  it("strips multi-paragraph legacy digest through end of text", () => {
    const raw =
      "[tool-digest] exec command=cat\n工具输出第一段\n\n内部工具第二段：PRIVATE_SECOND_PARAGRAPH";
    expect(stripToolDigestLines(raw)).toBe("");
    expect(isControlChannelOnlyText(raw)).toBe(true);
  });

  it("strips DELIVERABLE tags and keeps body", () => {
    const raw = [
      "完成啦！",
      '<<DELIVERABLE title="简报" file="deliverables/brief.html">>',
      "正文摘要",
      "<</DELIVERABLE>>",
      "还需要补充吗？",
    ].join("\n");
    const out = stripDeliverableEnvelopeTags(raw);
    expect(out).not.toMatch(/<<\s*DELIVERABLE/i);
    expect(out).toContain("完成啦！");
    expect(out).toContain("正文摘要");
    expect(out).toContain("还需要补充吗？");
  });

  it("hides unclosed DELIVERABLE fragments while streaming", () => {
    const raw = '已完成。\n<<DELIVERABLE title="内部路径';
    const out = stripControlChannelForDisplay(raw);
    expect(out).not.toContain("<<DELIVERABLE");
    expect(out).toContain("已完成。");
  });

  it("detects internal continue prompts", () => {
    expect(isInternalContinuePromptText("Internal task-board continue:\nContinue")).toBe(true);
    expect(isInternalContinuePromptText("Internal execution continue:\nx")).toBe(true);
    expect(isInternalContinuePromptText("请继续任务")).toBe(false);
  });

  it("redacts absolute tenant paths only", () => {
    const raw =
      "文件：/root/openbot-tenants/001/users/90fed19a/OpenBot/agents/bot-2/workspace/a.md";
    const out = stripAbsoluteWorkspacePaths(raw);
    expect(out).not.toContain("/root/openbot-tenants");
    expect(out).toContain("workspace");
  });

  it("preserves ordinary user-facing file links under /tmp and /Users", () => {
    expect(stripControlChannelForDisplay("报告：[打开报告](/tmp/report.md)")).toBe(
      "报告：[打开报告](/tmp/report.md)",
    );
    expect(
      stripControlChannelForDisplay(
        "见附件：[/Users/daniel/Documents/notes.md](/Users/daniel/Documents/notes.md)",
      ),
    ).toContain("/Users/daniel/Documents/notes.md");
    expect(stripControlChannelForDisplay("示例路径 `/tmp/cache.bin` 不要改")).toContain(
      "/tmp/cache.bin",
    );
  });

  it("marks control-only bubbles as hideable", () => {
    expect(
      isControlChannelOnlyText(
        "[turn_completion state=permanent_block reason=x degradation=y required_user_action=z]",
      ),
    ).toBe(true);
    expect(isControlChannelOnlyText("Internal task-board continue:\nGo")).toBe(true);
    expect(isControlChannelOnlyText("任务还没做完。请确认下一步。")).toBe(false);
    expect(isControlChannelOnlyText("[tool-digest] exec ls -l\nNO 10-30 DIR")).toBe(true);
  });

  it("does not hide mixed digest + real reply when sentinel-bounded", () => {
    const mixed = [
      TOOL_DIGEST_OPEN_SENTINEL,
      "[tool-digest] exec ls",
      "工具结果",
      "",
      "digest second para",
      TOOL_DIGEST_CLOSE_SENTINEL,
      "最终答复：已经处理完成。",
    ].join("\n");
    expect(isControlChannelOnlyText(mixed)).toBe(false);
    expect(stripControlChannelForDisplay(mixed)).toBe("最终答复：已经处理完成。");
  });

  it("combined strip keeps PLAN_SPEAK CTA while removing markers", () => {
    const raw = [
      "[turn_completion state=true_fork options=option_a|option_b]",
      "任务还没做完。请确认下一步（选哪个价/规格/支付方式），或点「接管」在电脑里自己操作；也可以回我「继续」。",
    ].join("\n");
    const out = stripControlChannelForDisplay(raw);
    expect(out).toContain("任务还没做完");
    expect(out).not.toMatch(/turn_completion|state=true_fork/);
  });

  it("streaming hold-back drops incomplete control suffixes", () => {
    expect(
      stripControlChannelForDisplay("处理完成。\n[turn_completion state=delivered path=x", {
        streaming: true,
      }),
    ).toBe("处理完成。");
    expect(holdBackIncompleteControlSuffix('正文\n<<DELIVERABLE title="x')).toBe("正文\n");
  });

  it("streaming hold-back drops proper prefixes mid-line and at line-start", () => {
    expect(holdBackIncompleteControlSuffix("处理完成。\n[turn_")).toBe("处理完成。\n");
    expect(holdBackIncompleteControlSuffix("处理完成。\n[turn_completio")).toBe("处理完成。\n");
    expect(holdBackIncompleteControlSuffix("正文<<DELIV")).toBe("正文");
    expect(holdBackIncompleteControlSuffix("body<</DELIVERABL")).toBe("body");
    expect(holdBackIncompleteControlSuffix("x<<deliv")).toBe("x");
    expect(holdBackIncompleteControlSuffix("Hi\nInternal task-board cont")).toBe("Hi\n");
    // Ordinary Markdown / comparison text is not swallowed.
    expect(holdBackIncompleteControlSuffix("报告：[打开报告](/tmp/report.md)")).toBe(
      "报告：[打开报告](/tmp/report.md)",
    );
    expect(holdBackIncompleteControlSuffix("a << b")).toBe("a << b");
    expect(holdBackIncompleteControlSuffix("见 <div>ok</div>")).toBe("见 <div>ok</div>");
  });
});
