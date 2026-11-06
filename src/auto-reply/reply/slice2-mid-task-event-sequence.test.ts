/**
 * Required delivery evidence: one continuous event sequence through real inbound
 * reply + board + claim paths (not a second controller).
 *
 * A running → long constraint once → progress answered → owner pause aborts
 * activity → stale wake dead.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateContext } from "../templating.js";
import type { FollowupRun, QueueSettings } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const queueEmbeddedPiMessageMock = vi.fn();
const abortEmbeddedPiRunMock = vi.fn();
const enqueueFollowupRunMock = vi.fn();
const clearSessionQueuesMock = vi.fn();

vi.mock("../../agents/pi-embedded.js", async () => {
  const actual = await vi.importActual<typeof import("../../agents/pi-embedded.js")>(
    "../../agents/pi-embedded.js",
  );
  return {
    ...actual,
    queueEmbeddedPiMessage: (...args: unknown[]) => queueEmbeddedPiMessageMock(...args),
    abortEmbeddedPiRun: (...args: unknown[]) => abortEmbeddedPiRunMock(...args),
  };
});

vi.mock("./queue.js", async () => {
  const actual = await vi.importActual<typeof import("./queue.js")>("./queue.js");
  return {
    ...actual,
    enqueueFollowupRun: (...args: unknown[]) => enqueueFollowupRunMock(...args),
    clearSessionQueues: (...args: unknown[]) => clearSessionQueuesMock(...args),
    scheduleFollowupDrain: vi.fn(),
  };
});

vi.mock("../../agents/model-fallback.js", () => ({
  runWithModelFallback: vi.fn(),
}));

import {
  activeConstraintTexts,
  emptySessionTaskBoard,
  readSessionTaskBoard,
  seedSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import { claimTaskBoardContinue } from "../../conversation-task/task-board-continue.js";
import { runReplyAgent } from "./agent-runner.js";

describe("slice2 mid-task event sequence", () => {
  let tmpDir = "";
  let sessionFile = "";
  let steerCount = 0;

  const LONG_CONSTRAINT =
    "补充：只要国内安卓机型，并且本次调研的关键限制条件必须完整保留；下列限制必须出现在第四十八个字符之后才能生效——禁止引用任何海外评测站点的份额数据";
  const CRITICAL_TAIL = "禁止引用任何海外评测站点的份额数据";

  beforeEach(() => {
    steerCount = 0;
    queueEmbeddedPiMessageMock.mockReset();
    abortEmbeddedPiRunMock.mockReset();
    enqueueFollowupRunMock.mockReset();
    clearSessionQueuesMock.mockReset();
    abortEmbeddedPiRunMock.mockReturnValue(true);
    clearSessionQueuesMock.mockReturnValue({
      followupCleared: 0,
      laneCleared: 0,
      keys: [],
    });
    queueEmbeddedPiMessageMock.mockImplementation(() => {
      steerCount += 1;
      return true;
    });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "slice2-seq-"));
    sessionFile = path.join(tmpDir, "session.jsonl");
    fs.writeFileSync(sessionFile, "", "utf8");
    const board = emptySessionTaskBoard();
    board.focusRevision = 1;
    board.current = {
      taskId: "task-a",
      title: "手机调研",
      goalText: "调研国内手机市场并写报告",
      unfinished: true,
      stop: { summary: "正在抓取评测站点", workspacePaths: [] },
      createdAtMs: Date.now(),
    };
    seedSessionTaskBoard(sessionFile, board);
    expect(LONG_CONSTRAINT.length).toBeGreaterThan(48);
    expect(LONG_CONSTRAINT.indexOf(CRITICAL_TAIL)).toBeGreaterThan(47);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function buildParams(prompt: string) {
    const typing = createMockTypingController();
    const sessionCtx = {
      Provider: "webchat",
      OriginatingTo: "session:1",
      AccountId: "primary",
      MessageSid: `msg-${prompt.slice(0, 8)}`,
    } as unknown as TemplateContext;
    const followupRun = {
      prompt,
      summaryLine: prompt,
      enqueuedAt: Date.now(),
      run: {
        sessionId: "session-a",
        sessionKey: "main",
        messageProvider: "webchat",
        sessionFile,
        workspaceDir: tmpDir,
        config: {},
        skillsSnapshot: {},
        provider: "anthropic",
        model: "claude",
        thinkLevel: "low",
        verboseLevel: "off",
        elevatedLevel: "off",
        bashElevated: { enabled: false, allowed: false, defaultLevel: "off" },
        timeoutMs: 1_000,
        blockReplyBreak: "message_end",
      },
    } as unknown as FollowupRun;
    return {
      commandBody: prompt,
      followupRun,
      queueKey: "main",
      resolvedQueue: { mode: "collect" } as QueueSettings,
      shouldSteer: false,
      shouldFollowup: true,
      isActive: true,
      isStreaming: true,
      typing,
      sessionCtx,
      defaultModel: "anthropic/claude",
      resolvedVerboseLevel: "off" as const,
      isNewSession: false,
      blockStreamingEnabled: false,
      resolvedBlockStreamingBreak: "message_end" as const,
      shouldInjectGroupIntro: false,
      typingMode: "instant" as const,
    };
  }

  it("A→long constraint once→progress answer→pause aborts→stale wake dead", async () => {
    const events: string[] = [];

    // A is active (board unfinished + isActive streaming).
    events.push("A_active");
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);

    // Long amend — steer once, full constraint persisted (约束已应用 / 消息已送达).
    enqueueFollowupRunMock.mockClear();
    const amend = await runReplyAgent(buildParams(LONG_CONSTRAINT));
    events.push("amend_applied_once");
    expect((Array.isArray(amend) ? amend[0] : amend)?.text).toContain("仅一次");
    expect(steerCount).toBe(1);
    expect(enqueueFollowupRunMock).not.toHaveBeenCalled();
    const afterAmend = readSessionTaskBoard(sessionFile);
    expect(activeConstraintTexts(afterAmend.current).join("\n")).toContain(CRITICAL_TAIL);
    expect(afterAmend.current?.stop.summary).toContain("约束：");

    // B progress query — answered immediately (回答已产生), no followup, no internals.
    const progress = await runReplyAgent(buildParams("进度如何"));
    events.push("B_progress_answered");
    expect((Array.isArray(progress) ? progress[0] : progress)?.text).toMatch(/手机调研/);
    expect((Array.isArray(progress) ? progress[0] : progress)?.text).toContain("任务板最近记录");
    expect((Array.isArray(progress) ? progress[0] : progress)?.text).not.toContain("wakeSuppress");
    expect(enqueueFollowupRunMock).not.toHaveBeenCalled();

    // Owner pause via real reply entry — aborts activity (活动已停).
    abortEmbeddedPiRunMock.mockClear();
    clearSessionQueuesMock.mockClear();
    const paused = await runReplyAgent(buildParams("暂停"));
    events.push("owner_pause_aborts_activity");
    expect((Array.isArray(paused) ? paused[0] : paused)?.text).toMatch(/暂停|停止新增业务动作/);
    expect(abortEmbeddedPiRunMock).toHaveBeenCalledWith("session-a");
    expect(clearSessionQueuesMock).toHaveBeenCalled();
    expect(readSessionTaskBoard(sessionFile).current?.wakeSuppress).toBe(true);
    expect(enqueueFollowupRunMock).not.toHaveBeenCalled();

    // Stale continue ticket (same revision) arrives → claim rejects.
    const claim = claimTaskBoardContinue({
      sessionFile,
      taskId: "task-a",
      focusRevision: 1,
    });
    events.push("stale_wake_rejected");
    expect(claim.ok).toBe(false);
    if (!claim.ok) {
      expect(claim.reason).toBe("wake_suppress");
    }

    expect(events).toEqual([
      "A_active",
      "amend_applied_once",
      "B_progress_answered",
      "owner_pause_aborts_activity",
      "stale_wake_rejected",
    ]);
  });
});
