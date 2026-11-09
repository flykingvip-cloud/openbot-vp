import { describe, expect, it } from "vitest";
import { titleFromGoal } from "../agent-runtime/context/sources/task-title.js";
import * as policy from "../agent-runtime/policy/index.js";
import {
  applyFocusCancelFence,
  applyFocusParkFence,
  FOCUS_CANCELLED_SENTINEL,
  FOCUS_PARKED_SENTINEL,
  omitParkedPriorTurns,
  readLastFocusTextFromTranscript,
  readLastUserTextFromTranscript,
  readUserTurnTextsFromTranscript,
  stripFocusParkFence,
  stripInboundStamp,
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

describe("focus switch (P2 acceptance)", () => {
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

  it("uses the policy stamp strip and context title, and keeps transcript parsing local", () => {
    const samples = [
      "",
      "hello",
      "[Sat 2026-09-19 15:07 GMT+8] 请先出清单",
      "[Wed 2026-01-01 00:00:00 GMT-5] body",
      "not a stamp [Sat 2026-09-19 15:07 GMT+8]",
      "[Sat 2026-09-19 15:07 GMT+8] 请先出技能来源基线清单 v1",
    ];
    for (const sample of samples) {
      expect(stripInboundStamp(sample)).toBe(policy.stripInboundStamp(sample));
      expect(titleFromTaskText(sample)).toBe(titleFromGoal(sample));
    }
    expect(stripInboundStamp).toBe(policy.stripInboundStamp);
    expect(
      readUserTurnTextsFromTranscript(
        JSON.stringify({
          message: { role: "user", content: "[Sat 2026-09-19 15:07 GMT+8] 交接给skill" },
        }),
      ),
    ).toEqual(["交接给skill"]);
    expect(policy).not.toHaveProperty("classifyTurnRelation");
    expect(policy).not.toHaveProperty("isLikelyNewTask");
    expect(policy).not.toHaveProperty("incomingRejectsFocus");
    expect(policy).not.toHaveProperty("tokenOverlapRatio");
  });
});
