import { describe, expect, it } from "vitest";
import {
  isCronProgressQuiet,
  shouldNotifyHumanGate,
  toHumanGatePendingItem,
} from "./human-gate.js";
import type { ProgressView } from "./types.js";

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
    nodes: [
      { id: "E1", title: "拉取竞品价格", tone: "done" },
      { id: "E2", title: "计算内部价差", tone: "current" },
    ],
    taskCompleted: false,
    planVersion: 1,
    replans: [],
    ...overrides,
  };
}

describe("human gates", () => {
  it("maps only user/authorization gates into pending-tasks items", () => {
    const item = toHumanGatePendingItem(view(), { sessionKey: "agent:main:cron:job-1" });
    expect(item).toMatchObject({
      id: "ledger-gate:job-1",
      title: "价差按含税价还是活动价？",
      reason: "blocked_user",
      ackRequired: true,
      sessionKey: "agent:main:cron:job-1",
    });
    expect(item?.title).not.toContain("拉取竞品价格");
    expect(
      toHumanGatePendingItem(
        view({
          blockingGate: { type: "data", reason: "blocked_data", question: "等待 CRM" },
        }),
      ),
    ).toBeNull();
  });

  it("notifies only non-quiet blocked_user", () => {
    expect(shouldNotifyHumanGate(view())).toBe(true);
    expect(shouldNotifyHumanGate(view({ emitNotification: false, mode: "quiet" }))).toBe(false);
    expect(
      shouldNotifyHumanGate(
        view({
          blockingGate: {
            type: "authorization",
            reason: "blocked_authorization",
            question: "需要财务授权",
          },
        }),
      ),
    ).toBe(false);
  });

  it("treats notify.inApp=false as quiet", () => {
    expect(
      isCronProgressQuiet({
        description: `巡检\n<!--openbot-task-meta:${encodeURIComponent(
          JSON.stringify({ notify: { inApp: false }, goal: "g", acceptanceRules: ["a"] }),
        )}-->`,
      }),
    ).toBe(true);
    expect(isCronProgressQuiet({ description: "plain" })).toBe(false);
  });
});
