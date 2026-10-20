import { describe, expect, it } from "vitest";
import type { ProgressView } from "./types.js";
import {
  formatAcceptanceBadge,
  formatExecutionSummary,
  formatLatestReplanLine,
  formatListProgressLine,
  formatReplanHistoryLine,
  formatStaleLabel,
  listHumanGates,
  shouldRenderChatStrip,
  shouldRenderProgressChrome,
} from "./view-copy.js";

function view(overrides: Partial<ProgressView> = {}): ProgressView {
  return {
    projectionKind: "canonical",
    taskId: "job-1",
    goal: "Q2 竞品价格巡检",
    headline: "2/5 项验收已满足 · 等你确认",
    focus: "价差按含税价还是活动价？",
    acceptanceProgress: { met: 2, total: 5 },
    executionProgress: { completed: 7, total: 11, inProgress: 1, remaining: 3 },
    mode: "ask",
    blockingGate: {
      type: "user_confirmation",
      reason: "blocked_user",
      question: "价差按含税价还是活动价？",
    },
    stale: false,
    lastMeaningfulChangeAtMs: 1_000,
    lastUpdatedAtMs: 1_000,
    emitToChat: true,
    emitNotification: true,
    nodes: [],
    taskCompleted: false,
    planVersion: 1,
    replans: [],
    ...overrides,
  };
}

describe("progress view copy", () => {
  it("labels acceptance and execution separately", () => {
    expect(formatAcceptanceBadge(view())).toBe("2/5 项验收已满足");
    expect(formatExecutionSummary(view())).toBe("已完成 7 · 进行中 1 · 剩余 3");
    expect(formatListProgressLine(view())).toContain("项验收已满足");
  });

  it("uses meaningful-change age for stale copy", () => {
    expect(formatStaleLabel(view({ stale: true }), 1_000 + 3 * 60 * 60 * 1000)).toBe(
      "已 3 小时无进展",
    );
    expect(formatStaleLabel(view({ stale: false }), 1_000 + 3 * 60 * 60 * 1000)).toBeNull();
  });

  it("only exposes human gates for user/authorization blocks", () => {
    expect(listHumanGates(view()).map((gate) => gate.reason)).toEqual(["blocked_user"]);
    expect(
      listHumanGates(
        view({
          blockingGate: {
            type: "external",
            reason: "blocked_external",
            question: "等待 CRM",
          },
        }),
      ),
    ).toEqual([]);
  });

  it("formats replan history without overwriting the reason clock", () => {
    const line = formatReplanHistoryLine(
      {
        atMs: Date.parse("2026-08-22T01:32:00.000Z"),
        fromVersion: 1,
        toVersion: 2,
        reason: "missing_data",
        triggeredBy: "runtime",
      },
      { timeZone: "Asia/Shanghai" },
    );
    expect(line).toBe("任务曾于 09:32 重新规划（CRM 数据缺失）");
    expect(
      formatLatestReplanLine(
        view({
          replans: [
            {
              atMs: Date.parse("2026-08-22T01:32:00.000Z"),
              fromVersion: 1,
              toVersion: 2,
              reason: "missing_data",
              triggeredBy: "runtime",
            },
          ],
        }),
        { timeZone: "Asia/Shanghai" },
      ),
    ).toBe(line);
  });

  it("does not occupy conversation chat even when emitToChat is true", () => {
    expect(shouldRenderChatStrip(view())).toBe(false);
    expect(shouldRenderChatStrip(view({ emitToChat: false, mode: "quiet" }))).toBe(false);
  });

  it("still allows cron and task-center chrome while not quiet", () => {
    expect(shouldRenderProgressChrome(view({ emitToChat: false, mode: "quiet" }))).toBe(false);
    expect(shouldRenderProgressChrome(view())).toBe(true);
  });
});
