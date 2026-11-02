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
  writeSessionTaskBoard,
  emptySessionTaskBoard,
  readSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import { runReplyAgent } from "./agent-runner.js";

describe("runReplyAgent collect amend steer inject", () => {
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collect-amend-steer-"));
    sessionFile = path.join(tmpDir, "session.jsonl");
    fs.writeFileSync(sessionFile, "", "utf8");
    const board = emptySessionTaskBoard();
    board.current = {
      taskId: "task-a",
      title: "手机调研",
      goalText: "调研国内手机市场并写报告",
      unfinished: true,
      stop: { summary: "进行中", workspacePaths: [] },
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
      MessageSid: "msg-b",
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

  it("P1: steer success applies constraint once — no followup re-exec", async () => {
    const result = await runReplyAgent(buildParams("补充：只要国内安卓机型"));
    expect(result).toEqual([expect.objectContaining({ text: expect.stringContaining("仅一次") })]);
    expect(steerCount).toBe(1);
    expect(queueEmbeddedPiMessageMock).toHaveBeenCalledTimes(1);
    expect(enqueueFollowupRunMock).not.toHaveBeenCalled();
    const board = readSessionTaskBoard(sessionFile);
    expect(board.current?.stop.summary).toContain("约束：");
  });

  it("does not inject new_work into the active run (followup only)", async () => {
    const result = await runReplyAgent(buildParams("现在改做供应商合同审查"));
    expect(result).toBeUndefined();
    expect(queueEmbeddedPiMessageMock).not.toHaveBeenCalled();
    expect(enqueueFollowupRunMock).toHaveBeenCalledTimes(1);
  });

  it("P1: steer failure keeps followup — constraint not dropped", async () => {
    queueEmbeddedPiMessageMock.mockImplementation(() => {
      steerCount += 1;
      return false;
    });
    const result = await runReplyAgent(buildParams("补充：改成英文摘要"));
    expect(result).toBeUndefined();
    expect(steerCount).toBe(1);
    expect(enqueueFollowupRunMock).toHaveBeenCalledTimes(1);
  });

  it("P3: progress query answers from board without followup wait", async () => {
    const result = await runReplyAgent(buildParams("进度如何"));
    expect(result).toEqual([
      expect.objectContaining({
        text: expect.stringMatching(/手机调研|进行中|进行中/),
      }),
    ]);
    expect(queueEmbeddedPiMessageMock).not.toHaveBeenCalled();
    expect(enqueueFollowupRunMock).not.toHaveBeenCalled();
  });
});
