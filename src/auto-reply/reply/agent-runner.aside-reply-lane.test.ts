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
const runEmbeddedPiAgentMock = vi.fn();

vi.mock("../../agents/pi-embedded.js", async () => {
  const actual = await vi.importActual<typeof import("../../agents/pi-embedded.js")>(
    "../../agents/pi-embedded.js",
  );
  return {
    ...actual,
    queueEmbeddedPiMessage: (...args: unknown[]) => queueEmbeddedPiMessageMock(...args),
    abortEmbeddedPiRun: (...args: unknown[]) => abortEmbeddedPiRunMock(...args),
    runEmbeddedPiAgent: (...args: unknown[]) => runEmbeddedPiAgentMock(...args),
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
  activeConstraintTexts,
  emptySessionTaskBoard,
  readSessionTaskBoard,
  seedSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import { runReplyAgent } from "./agent-runner.js";
import { resetMidTaskAsideLaneRegistryForTests } from "./mid-task-aside-reply-lane.js";

describe("runReplyAgent aside reply_lane timely path", () => {
  let tmpDir = "";
  let sessionFile = "";

  beforeEach(() => {
    resetMidTaskAsideLaneRegistryForTests();
    queueEmbeddedPiMessageMock.mockReset();
    abortEmbeddedPiRunMock.mockReset().mockReturnValue(true);
    enqueueFollowupRunMock.mockReset();
    runEmbeddedPiAgentMock.mockReset();
    runEmbeddedPiAgentMock.mockImplementation(async (args: Record<string, unknown>) => {
      expect(args.disableTools).toBe(true);
      expect(String(args.sessionId)).toMatch(/^aside-reply-/);
      expect(args.runId).toBe("run-b-msg");
      expect(args.sessionFile).not.toBe(sessionFile);
      return {
        payloads: [{ text: "插问即时答：可以，两份回复互不覆盖。" }],
        meta: { durationMs: 2 },
      };
    });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-runner-aside-lane-"));
    sessionFile = path.join(tmpDir, "session.jsonl");
    fs.writeFileSync(sessionFile, "", "utf8");
    const board = emptySessionTaskBoard();
    board.current = {
      taskId: "task-a",
      title: "手机调研",
      goalText: "调研国内手机市场并写报告",
      unfinished: true,
      effectiveConstraints: ["只要国内安卓机型"],
      stop: { summary: "进行中", workspacePaths: [] },
      createdAtMs: Date.now(),
    };
    seedSessionTaskBoard(sessionFile, board);
  });

  afterEach(() => {
    resetMidTaskAsideLaneRegistryForTests();
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
        agentDir: tmpDir,
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
      opts: { runId: "run-b-msg" },
    };
  }

  it("answers ordinary aside immediately without followup or board write", async () => {
    const before = readSessionTaskBoard(sessionFile);
    const epoch = before.writeEpoch ?? 0;
    const constraints = activeConstraintTexts(before.current).join("|");

    const payloads = await runReplyAgent(buildParams("今天北京天气怎么样"));
    expect(payloads).toEqual([{ text: "插问即时答：可以，两份回复互不覆盖。" }]);
    expect(enqueueFollowupRunMock).not.toHaveBeenCalled();
    expect(queueEmbeddedPiMessageMock).not.toHaveBeenCalled();
    expect(runEmbeddedPiAgentMock).toHaveBeenCalledTimes(1);

    const after = readSessionTaskBoard(sessionFile);
    expect(after.writeEpoch ?? 0).toBe(epoch);
    expect(activeConstraintTexts(after.current).join("|")).toBe(constraints);
  });

  it("owner pause aborts parent and registered aside lanes", async () => {
    // Pre-register a live aside as if a concurrent reply_lane were in flight.
    const { registerMidTaskAsideLane, listMidTaskAsideLanesForTests } =
      await import("./mid-task-aside-reply-lane.js");
    registerMidTaskAsideLane("session-a", "aside-live-1");
    expect(listMidTaskAsideLanesForTests("session-a")).toEqual(["aside-live-1"]);

    const payloads = await runReplyAgent(buildParams("暂停当前任务"));
    expect(Array.isArray(payloads)).toBe(true);
    expect(abortEmbeddedPiRunMock).toHaveBeenCalledWith("session-a");
    expect(abortEmbeddedPiRunMock).toHaveBeenCalledWith("aside-live-1");
    expect(listMidTaskAsideLanesForTests("session-a")).toEqual([]);
    expect(enqueueFollowupRunMock).not.toHaveBeenCalled();
  });
});
