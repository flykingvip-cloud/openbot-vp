import { describe, expect, it } from "vitest";
import {
  isControlChannelOnlyText,
  isInternalContinuePromptText,
  stripAbsoluteWorkspacePaths,
  stripControlChannelForDisplay,
  stripDeliverableEnvelopeTags,
  stripToolDigestLines,
  stripTurnCompletionMarkers,
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

  it("strips tool-digest lines", () => {
    const raw = "稍等。\n[tool-digest] exec ls -l\nNO 10-30 DIR\n好了。";
    const out = stripToolDigestLines(raw);
    expect(out).not.toContain("[tool-digest]");
    expect(out).toContain("稍等。");
    expect(out).toContain("好了。");
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

  it("detects internal continue prompts", () => {
    expect(isInternalContinuePromptText("Internal task-board continue:\nContinue")).toBe(true);
    expect(isInternalContinuePromptText("Internal execution continue:\nx")).toBe(true);
    expect(isInternalContinuePromptText("请继续任务")).toBe(false);
  });

  it("redacts absolute tenant paths", () => {
    const raw =
      "文件：/root/openbot-tenants/001/users/90fed19a/OpenBot/agents/bot-2/workspace/a.md";
    const out = stripAbsoluteWorkspacePaths(raw);
    expect(out).not.toContain("/root/openbot-tenants");
    expect(out).toContain("workspace");
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

  it("combined strip keeps PLAN_SPEAK CTA while removing markers", () => {
    const raw = [
      "[turn_completion state=true_fork options=option_a|option_b]",
      "任务还没做完。请确认下一步（选哪个价/规格/支付方式），或点「接管」在电脑里自己操作；也可以回我「继续」。",
    ].join("\n");
    const out = stripControlChannelForDisplay(raw);
    expect(out).toContain("任务还没做完");
    expect(out).not.toMatch(/turn_completion|state=true_fork/);
  });
});
