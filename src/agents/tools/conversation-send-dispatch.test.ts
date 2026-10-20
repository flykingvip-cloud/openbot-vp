import { describe, expect, it } from "vitest";
import {
  detectSecondUserConfirmRisk,
  looksLikeDispatchTicket,
  validateConversationDispatch,
} from "./conversation-send-dispatch.js";

describe("conversation_send dispatch validation (P2)", () => {
  it("allows casual 1:1 chat without ticket fields", () => {
    const result = validateConversationDispatch({
      target: "大白管家",
      message: "你好，进度怎么样？",
    });
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("requires success criteria, single owner, and forbidden zones for dispatch tickets", () => {
    expect(
      looksLikeDispatchTicket({
        message: "帮我处理一下",
        taskId: "task-1",
      }),
    ).toBe(true);
    const incomplete = validateConversationDispatch({
      target: "分析师",
      message: "请处理报表",
      taskId: "task-1",
    });
    expect(incomplete.ok).toBe(false);
    expect(incomplete.missing).toEqual(["successCriteria", "forbiddenZones"]);

    const complete = validateConversationDispatch({
      target: "分析师",
      message: "请处理报表",
      taskId: "task-1",
      successCriteria: "输出上周汇总 CSV",
      forbiddenZones: "不要对外发送；不要付款",
    });
    expect(complete.ok).toBe(true);
    expect(complete.normalizedOwner).toBe("分析师");
  });

  it("accepts inline markers in the message body", () => {
    const result = validateConversationDispatch({
      target: "分析师",
      message: "目标：汇总\n成功标准：CSV\n禁区：勿群发\n主责：分析师",
      taskId: "task-2",
    });
    expect(result.ok).toBe(true);
  });

  it("warns when the payload asks the receiver to re-confirm with the user", () => {
    expect(detectSecondUserConfirmRisk("请先请用户确认再继续")).toMatch(/receiver_would_prompt/);
    const result = validateConversationDispatch({
      target: "分析师",
      message: "成功标准：完成\n禁区：无\n请用户确认后再做",
      taskId: "task-3",
      successCriteria: "完成",
      forbiddenZones: "无",
    });
    expect(result.ok).toBe(true);
    expect(result.secondUserConfirmWarning).toMatch(/single user-facing confirm/);
  });
});
