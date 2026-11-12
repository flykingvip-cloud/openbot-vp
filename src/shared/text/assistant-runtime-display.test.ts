import { describe, expect, it } from "vitest";
import { projectAssistantReplyForDisplay } from "./assistant-runtime-display.js";

describe("assistant runtime display", () => {
  it("projects the actual private-message routing failure without exposing RPC parameters", () => {
    const text = projectAssistantReplyForDisplay(
      "sessions_send：Either sessionKey or label is required；Session not visible from this sandboxed agent session。请提供sessionKey。",
    );
    expect(text).not.toMatch(/sessions_send|sessionKey|sandboxed/);
    expect(text).toContain("尚未确定");
    expect(text).toContain("无权访问");
    expect(
      projectAssistantReplyForDisplay(
        "高密度分析（agentId=bot--agent）的agent:bot--agent:main尚未就绪",
      ),
    ).toBe("高密度分析的会话尚未就绪");
  });
  it("projects the observed legacy receipt without its task id or boolean matrix", () => {
    const text =
      "任务草案已写入。 （d2t-abc；任务已建立=是；工作项已发布=否；责任已接受=否；计划已提出=否；计划已确认=否）";
    expect(projectAssistantReplyForDisplay(text)).toBe("任务草案已写入。");
    expect(projectAssistantReplyForDisplay("尚未发布：source_message_not_bound。")).toBe(
      "尚未发布：这条消息尚未正确关联到任务。",
    );
  });

  it("retains failure facts and code examples rather than claiming success", () => {
    const raw =
      "团队成果未完成（execution_binding_required）。\n```ts\nconst reason = 'source_message_not_bound';\n```\n报告：[打开](/tmp/report.md)";
    const text = projectAssistantReplyForDisplay(raw);
    expect(text).toContain("暂不能交付");
    expect(text).toContain("const reason = 'source_message_not_bound'");
    expect(text).toContain("[打开](/tmp/report.md)");
    expect(text).not.toContain("已交付");
  });

  it("never leaks a partially streamed reason and converges to the final view", () => {
    const raw = "发布受阻：source_message_not_bound。";
    for (let i = 0; i <= raw.length; i++) {
      const text = projectAssistantReplyForDisplay(raw.slice(0, i), { streaming: true });
      expect(text).not.toMatch(/source_|source_message|not_bound/);
    }
    expect(projectAssistantReplyForDisplay(raw, { streaming: true })).toBe(
      projectAssistantReplyForDisplay(raw),
    );
  });
});
