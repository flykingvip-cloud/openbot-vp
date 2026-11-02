/**
 * Required delivery evidence: one continuous event sequence through real inbound
 * board + claim paths (not a second controller).
 *
 * A running → B progress answered → amend once → owner pause → stale wake dead.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateContext } from "../templating.js";
import type { FollowupRun, QueueSettings } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const queueEmbeddedPiMessageMock = vi.fn();
const enqueueFollowupRunMock = vi.fn();

vi.mock("../../agents/pi-embedded.js", async () => {
  const actual = await vi.importActual<typeof import("../../agents/pi-embedded.js")>(
    "../../agents/pi-embedded.js",
  );
  return {
    ...actual,
    queueEmbeddedPiMessage: (...args: unknown[]) => queueEmbeddedPiMessageMock(...args),
  };
});

vi.mock("./queue.js", async () => {
  const actual = await vi.importActual<typeof import("./queue.js")>("./queue.js");
  return {
    ...actual,
    enqueueFollowupRun: (...args: unknown[]) => enqueueFollowupRunMock(...args),
    scheduleFollowupDrain: vi.fn(),
  };
});

vi.mock("../../agents/model-fallback.js", () => ({
  runWithModelFallback: vi.fn(),
}));

import {
  applyIncomingUserMessage,
  emptySessionTaskBoard,
  readSessionTaskBoard,
  writeSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import { claimTaskBoardContinue } from "../../conversation-task/task-board-continue.js";
import { runReplyAgent } from "./agent-runner.js";

describe("slice2 mid-task event sequence", () => {
  let tmpDir = "";
  let sessionFile = "";
  let steerCount = 0;

  beforeEach(() => {
    steerCount = 0;
    queueEmbeddedPiMessageMock.mockReset();
    enqueueFollowupRunMock.mockReset();
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
    writeSessionTaskBoard(sessionFile, board);
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

  it("A→B progress answer→amend once→pause→stale wake dead", async () => {
    const events: string[] = [];

    // A is active (board unfinished + isActive streaming).
    events.push("A_active");
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);

    // B progress query — answered immediately (回答已产生), no followup.
    const progress = await runReplyAgent(buildParams("进度如何"));
    events.push("B_progress_answered");
    expect(progress?.[0]?.text).toMatch(/手机调研/);
    expect(enqueueFollowupRunMock).not.toHaveBeenCalled();

    // Amend constraint — steer once, no followup re-exec (约束已应用).
    enqueueFollowupRunMock.mockClear();
    const amend = await runReplyAgent(buildParams("补充：只要国内安卓机型"));
    events.push("amend_applied_once");
    expect(amend?.[0]?.text).toContain("仅一次");
    expect(steerCount).toBe(1);
    expect(enqueueFollowupRunMock).not.toHaveBeenCalled();
    expect(readSessionTaskBoard(sessionFile).current?.stop.summary).toContain("约束：");

    // Owner pause via real inbound path.
    const paused = applyIncomingUserMessage({
      board: readSessionTaskBoard(sessionFile),
      incomingText: "暂停",
    });
    writeSessionTaskBoard(sessionFile, paused.board);
    events.push("owner_pause");
    expect(paused.board.current?.wakeSuppress).toBe(true);
    expect(paused.board.focusRevision).toBe(1);

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
      "B_progress_answered",
      "amend_applied_once",
      "owner_pause",
      "stale_wake_rejected",
    ]);
  });
});
