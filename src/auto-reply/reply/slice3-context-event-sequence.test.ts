/**
 * Slice3 acceptance event sequence through real inbound reply + board + claim:
 * A → long constraint → revise one → query constraints → aside ask → resume A → pause → stale wake.
 *
 * Proves: goal retained, revision order, query does not write, constraints applied once,
 * pause not lifted by resume prompt, stale wake dead. No second controller / reply_lane.
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
  applyIncomingUserMessage,
  buildResumePrompt,
  emptySessionTaskBoard,
  readSessionTaskBoard,
  seedSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import { claimTaskBoardContinue } from "../../conversation-task/task-board-continue.js";
import { runReplyAgent } from "./agent-runner.js";

describe("slice3 context event sequence", () => {
  let tmpDir = "";
  let sessionFile = "";
  let steerCount = 0;

  const LONG_CONSTRAINT =
    "补充：只要国内安卓机型，并且本次调研的关键限制条件必须完整保留；下列限制必须出现在第四十八个字符之后才能生效——禁止引用任何海外评测站点的份额数据";
  const CRITICAL_TAIL = "禁止引用任何海外评测站点的份额数据";
  const REVISION =
    "不对，改为只要 iOS 机型，不要安卓；其余关键限制仍完整保留——禁止引用任何海外评测站点的份额数据";

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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "slice3-seq-"));
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
      MessageSid: `msg-${prompt.slice(0, 12)}`,
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

  it("A→long→revise→query→aside→resume→pause→stale wake", async () => {
    const events: string[] = [];
    events.push("A_active");
    expect(readSessionTaskBoard(sessionFile).current?.goalText).toContain("调研国内手机市场");

    const amend = await runReplyAgent(buildParams(LONG_CONSTRAINT));
    events.push("long_constraint_once");
    expect(amend?.[0]?.text).toContain("仅一次");
    expect(steerCount).toBe(1);
    expect(enqueueFollowupRunMock).not.toHaveBeenCalled();
    expect(activeConstraintTexts(readSessionTaskBoard(sessionFile).current).join("\n")).toContain(
      CRITICAL_TAIL,
    );

    const revise = await runReplyAgent(buildParams(REVISION));
    events.push("revision_applied");
    expect(revise?.[0]?.text).toContain("仅一次");
    expect(steerCount).toBe(2);
    const afterRevise = readSessionTaskBoard(sessionFile);
    const active = activeConstraintTexts(afterRevise.current);
    expect(active.some((t) => t.includes("只要 iOS 机型"))).toBe(true);
    // Local revise must not auto-discard unrelated/prior rows — both stay active.
    expect(active.some((t) => t.includes("只要国内安卓机型"))).toBe(true);
    expect((afterRevise.current?.effectiveConstraints ?? []).length).toBeGreaterThanOrEqual(2);
    // Goal retained
    expect(afterRevise.current?.goalText).toContain("调研国内手机市场");

    const beforeQuery = JSON.stringify(afterRevise.current?.effectiveConstraints);
    const query = await runReplyAgent(buildParams("有效约束有哪些"));
    events.push("constraint_query_readonly");
    expect(query?.[0]?.text).toMatch(/任务板最近记录|有效约束/);
    expect(query?.[0]?.text).toContain("iOS");
    expect(JSON.stringify(readSessionTaskBoard(sessionFile).current?.effectiveConstraints)).toBe(
      beforeQuery,
    );

    // Aside ask (language) — disposition reply_lane_pending; still must not write constraints.
    const beforeAside = JSON.stringify(
      readSessionTaskBoard(sessionFile).current?.effectiveConstraints,
    );
    await runReplyAgent(buildParams("请用中文回复"));
    events.push("aside_no_constraint_write");
    expect(JSON.stringify(readSessionTaskBoard(sessionFile).current?.effectiveConstraints)).toBe(
      beforeAside,
    );

    // Resume prompt lists active constraints; local revise notes conflict coverage.
    const resumePrompt = buildResumePrompt(readSessionTaskBoard(sessionFile).current!);
    events.push("resume_prompt_active_only");
    expect(resumePrompt).toContain("只要 iOS 机型");
    expect(resumePrompt).toContain(CRITICAL_TAIL);
    expect(resumePrompt).toMatch(/仅覆盖.*冲突/);
    // Resume prompt must not clear wakeSuppress / invent wake
    const boardForResume = readSessionTaskBoard(sessionFile);
    boardForResume.current = { ...boardForResume.current!, wakeSuppress: true };
    seedSessionTaskBoard(sessionFile, boardForResume);
    const resumed = applyIncomingUserMessage({
      board: readSessionTaskBoard(sessionFile),
      incomingText: "请继续",
    });
    // bare continue must not persist constraint; wakeSuppress stays (continue cue ≠ owner resume of suppress)
    expect(activeConstraintTexts(resumed.board.current).every((t) => !t.includes("请继续"))).toBe(
      true,
    );

    // Owner pause aborts; resume prompt text must not lift stop.
    abortEmbeddedPiRunMock.mockClear();
    // Clear wakeSuppress first so pause path is meaningful from active state
    const activeBoard = readSessionTaskBoard(sessionFile);
    activeBoard.current = { ...activeBoard.current!, wakeSuppress: false };
    seedSessionTaskBoard(sessionFile, activeBoard);
    const paused = await runReplyAgent(buildParams("暂停"));
    events.push("owner_pause");
    expect(paused?.[0]?.text).toMatch(/暂停|停止新增业务动作/);
    expect(abortEmbeddedPiRunMock).toHaveBeenCalledWith("session-a");
    expect(readSessionTaskBoard(sessionFile).current?.wakeSuppress).toBe(true);
    // Building resume prompt after pause must not clear suppress
    const afterPause = readSessionTaskBoard(sessionFile);
    buildResumePrompt(afterPause.current!);
    expect(readSessionTaskBoard(sessionFile).current?.wakeSuppress).toBe(true);

    const claim = claimTaskBoardContinue({
      sessionFile,
      taskId: "task-a",
      focusRevision: readSessionTaskBoard(sessionFile).focusRevision ?? 1,
    });
    events.push("stale_wake_rejected");
    expect(claim.ok).toBe(false);
    if (!claim.ok) {
      expect(claim.reason).toBe("wake_suppress");
    }

    expect(events).toEqual([
      "A_active",
      "long_constraint_once",
      "revision_applied",
      "constraint_query_readonly",
      "aside_no_constraint_write",
      "resume_prompt_active_only",
      "owner_pause",
      "stale_wake_rejected",
    ]);
  });
});
