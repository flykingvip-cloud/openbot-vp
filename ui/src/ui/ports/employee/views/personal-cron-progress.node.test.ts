// @vitest-environment jsdom
import { html, render } from "lit";
import { describe, expect, it } from "vitest";
import type { ProgressView } from "../../../../../../src/progress-ledger/types.ts";
import type { CronJob } from "../../../types.ts";
import {
  findProgressForSession,
  readJobProgress,
  renderProgressLedgerChatStrip,
  renderProgressLedgerDetail,
  renderProgressLedgerListLine,
} from "./personal-cron-progress.ts";

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
    nodes: [{ id: "E1", title: "拉取竞品价格", tone: "done" }],
    taskCompleted: false,
    planVersion: 1,
    replans: [],
    ...overrides,
  };
}

function job(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "job-1",
    name: "Q2 巡检",
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    schedule: { kind: "cron", expr: "0 9 * * *" },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "run" },
    ...overrides,
  };
}

describe("personal-cron-progress", () => {
  it("renders nothing when the job has no canonical projection", () => {
    const container = document.createElement("div");
    render(html`${renderProgressLedgerListLine(job())}`, container);
    expect(container.textContent?.trim()).toBe("");
  });

  it("renders acceptance progress, not a bare step fraction", () => {
    const container = document.createElement("div");
    render(html`${renderProgressLedgerListLine(job({ progress: view() }))}`, container);
    expect(container.textContent).toContain("2/5 项验收已满足");
    expect(container.textContent).not.toMatch(/即将完成/);
  });

  it("does not push a chat strip while quiet", () => {
    const container = document.createElement("div");
    render(
      html`${renderProgressLedgerChatStrip(view({ emitToChat: false, mode: "quiet" }))}`,
      container,
    );
    expect(container.textContent?.trim()).toBe("");
  });

  it("renders replan history in the task detail, not the chat strip", () => {
    const replanView = view({
      planVersion: 2,
      replans: [
        {
          atMs: Date.parse("2026-08-22T01:32:00.000Z"),
          fromVersion: 1,
          toVersion: 2,
          reason: "missing_data",
          triggeredBy: "runtime",
        },
      ],
    });
    const strip = document.createElement("div");
    render(html`${renderProgressLedgerChatStrip(replanView)}`, strip);
    expect(strip.textContent).not.toContain("重新规划");

    const detail = document.createElement("div");
    render(html`${renderProgressLedgerDetail(job({ progress: replanView }))}`, detail);
    expect(detail.textContent).toContain("重新规划");
    expect(detail.textContent).toContain("CRM 数据缺失");
  });

  it("does not project cron ledger onto conversation chat even for the isolated cron session", () => {
    const matched = findProgressForSession(
      [job({ progress: view(), sessionKey: "agent:main:cron:job-1" })],
      "agent:main:cron:job-1",
    );
    expect(readJobProgress(job({ progress: view() }))?.headline).toContain("项验收已满足");
    expect(matched).toBeNull();
  });

  it("does not project unbound cron ledger onto the main conversation (EA-I6)", () => {
    expect(
      findProgressForSession(
        [job({ progress: view(), sessionKey: "agent:market:main", sessionTarget: "main" })],
        "agent:market:main",
      ),
    ).toBeNull();
  });
});
