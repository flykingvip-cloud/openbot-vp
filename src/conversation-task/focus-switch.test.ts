import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyFocusCancelFence,
  applyFocusParkFence,
  applyFocusSwitchGate,
  evaluateFocusSwitch,
  FOCUS_CANCELLED_SENTINEL,
  FOCUS_PARKED_SENTINEL,
  isLikelyContinuation,
  isLikelyNewTask,
  omitParkedPriorTurns,
  readFocusSwitchDecisionCount,
  readLastFocusTextFromTranscript,
  readLastUserTextFromTranscript,
  resetFocusSwitchDecisionCountsForTest,
  stripFocusParkFence,
  titleFromTaskText,
} from "./focus-switch.js";

const PRICE_CHECK = [
  "## 任务目标",
  "生成今日竞品价格检查结果",
  "## 验收标准",
  "已获取至少一个竞品价格",
].join("\n");

const RESEARCH = [
  "请使用 web-research 做一次标准深度联网调研。",
  "",
  "调研问题：2026 年开源智能体平台在企业落地时的产品形态、收费方式和主要差异是什么？",
].join("\n");

const RESEARCH_FOLLOW_UP =
  "Brave Search Key 已配置，请补一轮第三方数据源交叉验证，把份额和客户案例补上，然后输出一版终稿";

describe("focus switch (P2 acceptance)", () => {
  it("EA-B1: a new research task against an occupied price-check focus requires a choice", () => {
    expect(
      evaluateFocusSwitch({
        currentFocusText: PRICE_CHECK,
        incomingText: RESEARCH,
      }),
    ).toMatchObject({
      action: "auto_park",
      cutContext: true,
      currentTitle: titleFromTaskText(PRICE_CHECK),
      incomingTitle: titleFromTaskText(RESEARCH),
    });
    const switched = evaluateFocusSwitch({
      currentFocusText: PRICE_CHECK,
      incomingText: RESEARCH,
    });
    expect(switched.action).toBe("auto_park");
    if (switched.action === "auto_park") {
      expect(switched.statusLine).toContain("已挂起");
      expect(switched.statusLine).toContain("开始");
    }
  });

  it("treats a follow-up on the same research as continuation", () => {
    expect(
      evaluateFocusSwitch({
        currentFocusText: RESEARCH,
        incomingText: RESEARCH_FOLLOW_UP,
      }),
    ).toMatchObject({ action: "continue", cutContext: false });
    expect(isLikelyContinuation(RESEARCH_FOLLOW_UP, RESEARCH)).toBe(true);
  });

  it("asks before switching to a parked article even if the owner says do not ask", () => {
    expect(
      evaluateFocusSwitch({
        currentFocusText: RESEARCH,
        incomingText:
          "请不要先问我。直接把阅读数字人记忆生命体长文并输出100字总结交接给Skill孵化。不要做刚才的调研。",
      }),
    ).toMatchObject({ action: "auto_park" });
  });

  it("does not block chit-chat", () => {
    expect(
      evaluateFocusSwitch({
        currentFocusText: RESEARCH,
        incomingText: "晚上好",
      }),
    ).toMatchObject({ action: "continue", cutContext: false });
    expect(isLikelyNewTask("晚上好")).toBe(false);
  });

  it("proceed skips the gate", () => {
    expect(
      evaluateFocusSwitch({
        currentFocusText: PRICE_CHECK,
        incomingText: RESEARCH,
        proceed: true,
      }),
    ).toMatchObject({ action: "continue", cutContext: false });
  });

  it("skips quote-only lines so titles are not「", () => {
    expect(
      titleFromTaskText(
        ["「", "**100 字总结**", "", "数字人是活着还是仅被调用，取决于四特征。"].join("\n"),
      ),
    ).toBe("100 字总结");
    expect(titleFromTaskText("[Sat 2026-09-19 15:07 GMT+8] 「\n请先出技能来源基线清单 v1")).toBe(
      "请先出技能来源基线清单 v1",
    );
  });

  it("reads the last user turn from a transcript", () => {
    const text = [
      JSON.stringify({
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "定时任务结果" }] },
      }),
      JSON.stringify({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: RESEARCH }] },
      }),
    ].join("\n");
    expect(readLastUserTextFromTranscript(text)).toContain("web-research");
  });

  it("session-file adapter blocks a new task and fails open on slash commands", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "focus-switch-"));
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      file,
      `${JSON.stringify({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: PRICE_CHECK }] },
      })}\n`,
    );
    expect(applyFocusSwitchGate({ sessionFile: file, incomingText: PRICE_CHECK })).toMatchObject({
      action: "continue",
      cutContext: false,
      decisionCode: "focus_clear",
    });
    const switched = applyFocusSwitchGate({ sessionFile: file, incomingText: RESEARCH });
    expect(switched).toMatchObject({
      action: "auto_park",
      cutContext: true,
      decisionCode: "focus_switched",
      currentTitle: titleFromTaskText(PRICE_CHECK),
    });
    if (switched.action === "auto_park") {
      expect(switched.statusLine).toContain("已挂起");
      expect(switched.statusLine).toContain("开始");
    }
    expect(applyFocusSwitchGate({ sessionFile: file, incomingText: "/new" })).toMatchObject({
      action: "continue",
      decisionCode: "focus_clear",
      cutContext: false,
    });
    expect(
      applyFocusSwitchGate({
        sessionFile: file,
        incomingText: RESEARCH,
        proceed: true,
      }),
    ).toMatchObject({ action: "continue", decisionCode: "focus_proceed", cutContext: false });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("degrades when focus state is missing and blocks a confirmed conflict", () => {
    resetFocusSwitchDecisionCountsForTest();
    const missing = applyFocusSwitchGate({ incomingText: RESEARCH });
    expect(missing).toMatchObject({
      action: "continue",
      decisionCode: "focus_state_unavailable",
      cutContext: false,
    });
    expect(readFocusSwitchDecisionCount("focus_state_unavailable")).toBe(1);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "focus-switch-"));
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      file,
      `${JSON.stringify({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: PRICE_CHECK }] },
      })}\n`,
    );
    applyFocusSwitchGate({ sessionFile: file, incomingText: PRICE_CHECK });
    const conflict = applyFocusSwitchGate({ sessionFile: file, incomingText: RESEARCH });
    expect(conflict.action).toBe("auto_park");
    expect(conflict.decisionCode).toBe("focus_switched");
    expect(conflict.cutContext).toBe(true);
    expect(readFocusSwitchDecisionCount("focus_switched")).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("omits turns before a parked-focus fence (EA-B6 / §5.3)", () => {
    const fenced = applyFocusParkFence(RESEARCH);
    expect(fenced.startsWith(FOCUS_PARKED_SENTINEL)).toBe(true);
    expect(stripFocusParkFence(fenced)).toBe(RESEARCH);
    const kept = omitParkedPriorTurns([
      { role: "user", content: [{ type: "text", text: PRICE_CHECK }] },
      { role: "assistant", content: [{ type: "text", text: "竞品价格已出" }] },
      { role: "user", content: [{ type: "text", text: fenced }] },
    ]);
    expect(kept).toHaveLength(3);
    const cut = omitParkedPriorTurns([
      { role: "user", content: [{ type: "text", text: PRICE_CHECK }] },
      { role: "assistant", content: [{ type: "text", text: "竞品价格已出" }] },
      { role: "user", content: [{ type: "text", text: fenced }], contextCut: true },
    ]);
    expect(cut).toHaveLength(1);
    expect(cut[0]).toMatchObject({ role: "user" });
  });

  it("treats「当前这个工作」as continuation of the current FOCUS", () => {
    expect(isLikelyContinuation("我认为当前你做的这个工作可以交接给skill孵化", RESEARCH)).toBe(
      true,
    );
  });

  it("strips inbound timestamps and does not treat「当前这个工作」as a new FOCUS", () => {
    const text = [
      JSON.stringify({
        type: "message",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: "[Sat 2026-09-19 13:18 GMT+8] 请先出技能来源基线清单 v1，确认工作区有没有相关的技能来源清单基础",
            },
          ],
        },
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: "[Sat 2026-09-19 13:22 GMT+8] 我认为当前你做的这个工作可以交接给skill孵化",
            },
          ],
        },
      }),
    ].join("\n");
    expect(readLastFocusTextFromTranscript(text)).toContain("技能来源基线清单");
    expect(readLastFocusTextFromTranscript(text)).not.toContain("当前你做的这个工作");
  });

  it("does not treat a bare A2A first-person or injected 100-word summary as owner FOCUS", () => {
    const text = [
      JSON.stringify({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: PRICE_CHECK }] },
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: "我先查一下记忆和当前工作区，确认有没有相关的技能来源清单基础。",
            },
          ],
        },
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: "「\n**100 字总结**\n\n数字人是活着还是仅被调用。",
            },
          ],
        },
      }),
    ].join("\n");
    expect(readLastFocusTextFromTranscript(text)).toContain("竞品价格");
  });

  it("does not treat a headerless A2A skill-list dump as owner FOCUS", () => {
    const text = [
      JSON.stringify({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: PRICE_CHECK }] },
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: "[Sat 2026-09-19 16:21 GMT+8] 已完成核对。以下是「技能来源基线清单 v1」——只列可核对来源。",
            },
          ],
        },
      }),
    ].join("\n");
    expect(readLastFocusTextFromTranscript(text)).toContain("竞品价格");
  });

  it("asks when the owner rejects the parked summary and returns to the skill list", () => {
    expect(
      evaluateFocusSwitch({
        currentFocusText: [
          "「",
          "**100 字总结**",
          "",
          "数字人是活着还是仅被调用，取决于四特征。",
        ].join("\n"),
        incomingText: "请先出技能来源基线清单 v1，只列可核对来源。不要输出100字总结。",
      }),
    ).toMatchObject({ action: "auto_park" });
  });

  it("reads FOCUS from the last owner task, not an A2A inject", () => {
    const text = [
      JSON.stringify({
        type: "message",
        message: { role: "user", content: [{ type: "text", text: PRICE_CHECK }] },
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: "来自 bot-skill（1:1 会话，不是协作小组）。\n对象会话：agent:bot-skill:main\n我先查一下记忆",
            },
          ],
        },
      }),
    ].join("\n");
    expect(readLastUserTextFromTranscript(text)).toContain("我先查一下记忆");
    expect(readLastFocusTextFromTranscript(text)).toContain("竞品价格");
  });

  it("omits turns before a cancelled-focus fence (user consent)", () => {
    const fenced = applyFocusCancelFence(RESEARCH);
    expect(fenced.startsWith(FOCUS_CANCELLED_SENTINEL)).toBe(true);
    expect(stripFocusParkFence(fenced)).toBe(RESEARCH);
    const kept = omitParkedPriorTurns([
      { role: "user", content: [{ type: "text", text: PRICE_CHECK }] },
      { role: "assistant", content: [{ type: "text", text: "竞品价格已出" }] },
      { role: "user", content: [{ type: "text", text: fenced }] },
    ]);
    expect(kept).toHaveLength(3);
    const cut = omitParkedPriorTurns([
      { role: "user", content: [{ type: "text", text: PRICE_CHECK }] },
      { role: "assistant", content: [{ type: "text", text: "竞品价格已出" }] },
      { role: "user", content: [{ type: "text", text: fenced }], contextCut: true },
    ]);
    expect(cut).toHaveLength(1);
    expect(cut[0]).toMatchObject({ role: "user" });
  });
});
