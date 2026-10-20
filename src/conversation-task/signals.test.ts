import { describe, expect, it } from "vitest";
import { analyzeTurn, classifySideEffect, extractSignals } from "./signals.js";

function sig(text: string) {
  return extractSignals({ messageId: "m", text });
}

describe("strong-signal extraction", () => {
  it("treats 今天/本周/昨天 as current or past, not future", () => {
    expect(sig("查一下今天华东区销售额").hasFutureIntent).toBe(false);
    expect(sig("查一下本周新增用户数").hasFutureIntent).toBe(false);
    expect(sig("看看昨天的订单总数").hasFutureIntent).toBe(false);
  });

  it("detects explicit future timing", () => {
    expect(sig("下周一提醒我提交报销").hasFutureIntent).toBe(true);
    expect(sig("明早生成一次日报").hasFutureIntent).toBe(true);
    expect(sig("每天早上九点发天气").hasRecurringIntent).toBe(true);
  });

  it("detects persistent state for monitoring but not for a plain daily send", () => {
    expect(sig("持续监控服务器错误率").hasPersistentState).toBe(true);
    expect(sig("每天早上九点给我发一条天气").hasPersistentState).toBe(false);
  });

  it("does not fire monitor intent on weak 留意/关注", () => {
    const weak = analyzeTurn({ messageId: "m", text: "这个竞品最近老是变价，你多留意一下" });
    expect(weak.monitorIntent).toBe(false);
    const strong = analyzeTurn({ messageId: "m", text: "持续监控竞品价格" });
    expect(strong.monitorIntent).toBe(true);
  });

  it("does not treat a 怎么算 question as an immediate action", () => {
    const question = analyzeTurn({ messageId: "m", text: "SaaS 的 LTV 一般是怎么算的？" });
    expect(question.leadImmediateAction).toBe(false);
    const command = analyzeTurn({ messageId: "m", text: "算一下 1284 乘以 37" });
    expect(command.leadImmediateAction).toBe(true);
  });

  it("flags cross-turn dependency from prior turns or reference words", () => {
    expect(sig("把 Q2 改成 Q3").hasCrossTurnDependency).toBe(true);
    expect(
      extractSignals({ messageId: "m", text: "继续", priorTurns: ["帮我做复盘"] })
        .hasCrossTurnDependency,
    ).toBe(true);
  });

  it("recognizes explicit acceptance conditions", () => {
    expect(sig("如果连续三天下降就预警").hasExplicitAcceptance).toBe(true);
  });

  it("treats explicit multi-step / multi-flow language as multiple stages", () => {
    expect(sig("这是一个多步骤任务：先调研再出方案").hasMultipleStages).toBe(true);
    expect(sig("第一步收集资料，第二步写纪要").hasMultipleStages).toBe(true);
    expect(analyzeTurn({ messageId: "m", text: "按多流程帮我做完这个方案" }).explicitWorkflow).toBe(
      true,
    );
    expect(analyzeTurn({ messageId: "m", text: "先查一下再发给我" }).explicitWorkflow).toBe(false);
  });
});

describe("side-effect classification precedence", () => {
  it("prioritizes broadcast over other classes", () => {
    expect(classifySideEffect("整理后发给全部销售")).toBe("broadcast");
    expect(classifySideEffect("给这三个客户群都发一下通知")).toBe("broadcast");
  });

  it("detects external writes", () => {
    expect(classifySideEffect("把这个方案同步到 CRM 里")).toBe("external_write");
  });

  it("detects outbound delivery to an external channel", () => {
    expect(classifySideEffect("后天把周报发到我邮箱")).toBe("outbound_message");
    expect(classifySideEffect("每天给我发一条天气")).toBe("outbound_message");
  });

  it("treats in-conversation notify as no external side effect", () => {
    expect(classifySideEffect("异常时分析并通知我")).toBe("none");
    expect(classifySideEffect("整理成简报发我")).toBe("none");
  });
});
