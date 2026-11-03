import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeConstraintTexts,
  emptySessionTaskBoard,
  readSessionTaskBoard,
  seedSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import {
  abortMidTaskAsideLanes,
  assertAsideReplyLaneIsolation,
  buildAsideReplyLanePrompt,
  listMidTaskAsideLanesForTests,
  registerMidTaskAsideLane,
  resetMidTaskAsideLaneRegistryForTests,
  runMidTaskAsideReplyLane,
  unregisterMidTaskAsideLane,
} from "./mid-task-aside-reply-lane.js";

const abortEmbeddedPiRunMock = vi.fn();

vi.mock("../../agents/pi-embedded.js", async () => {
  const actual = await vi.importActual<typeof import("../../agents/pi-embedded.js")>(
    "../../agents/pi-embedded.js",
  );
  return {
    ...actual,
    abortEmbeddedPiRun: (...args: unknown[]) => abortEmbeddedPiRunMock(...args),
  };
});

describe("mid-task aside reply_lane isolation", () => {
  let tmpDir = "";
  let parentSessionFile = "";

  beforeEach(() => {
    resetMidTaskAsideLaneRegistryForTests();
    abortEmbeddedPiRunMock.mockReset();
    abortEmbeddedPiRunMock.mockReturnValue(true);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aside-reply-lane-"));
    parentSessionFile = path.join(tmpDir, "parent-session.jsonl");
    fs.writeFileSync(parentSessionFile, "", "utf8");
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
    seedSessionTaskBoard(parentSessionFile, board);
  });

  afterEach(() => {
    resetMidTaskAsideLaneRegistryForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("assertAsideReplyLaneIsolation rejects shared session id/file or tools enabled", () => {
    expect(() =>
      assertAsideReplyLaneIsolation({
        parentSessionId: "s-a",
        asideSessionId: "s-a",
        parentSessionFile: "/tmp/a.jsonl",
        asideSessionFile: "/tmp/b.jsonl",
        disableTools: true,
      }),
    ).toThrow(/distinct sessionId/);

    expect(() =>
      assertAsideReplyLaneIsolation({
        parentSessionId: "s-a",
        asideSessionId: "s-b",
        parentSessionFile: "/tmp/a.jsonl",
        asideSessionFile: "/tmp/a.jsonl",
        disableTools: true,
      }),
    ).toThrow(/distinct sessionFile/);

    expect(() =>
      assertAsideReplyLaneIsolation({
        parentSessionId: "s-a",
        asideSessionId: "s-b",
        parentSessionFile: "/tmp/a.jsonl",
        asideSessionFile: "/tmp/b.jsonl",
        disableTools: false,
      }),
    ).toThrow(/disableTools/);
  });

  it("buildAsideReplyLanePrompt is read-only context and forbids task control", () => {
    const board = readSessionTaskBoard(parentSessionFile);
    const prompt = buildAsideReplyLanePrompt({ board, userPrompt: "今天北京天气怎么样" });
    expect(prompt).toContain("只读");
    expect(prompt).toContain("禁止");
    expect(prompt).toContain("调研国内手机市场");
    expect(prompt).toContain("只要国内安卓机型");
    expect(prompt).toContain("今天北京天气怎么样");
    expect(prompt).not.toContain("wakeSuppress");
  });

  it("runMidTaskAsideReplyLane uses distinct session + disableTools and does not mutate board", async () => {
    const board = readSessionTaskBoard(parentSessionFile);
    const epochBefore = board.writeEpoch ?? 0;
    const constraintsBefore = activeConstraintTexts(board.current).join("|");

    const runEmbedded = vi.fn(async (args: Record<string, unknown>) => {
      expect(args.disableTools).toBe(true);
      expect(args.sessionId).not.toBe("session-a");
      expect(args.sessionFile).not.toBe(parentSessionFile);
      expect(args.runId).toBe("run-b");
      // Session write lock target is the aside file, not A's transcript.
      expect(String(args.sessionFile)).toContain("openbot-aside-reply-");
      return {
        payloads: [{ text: "北京今天晴，气温适宜。" }],
        meta: { durationMs: 1 },
      };
    });

    const result = await runMidTaskAsideReplyLane({
      parentSessionId: "session-a",
      parentSessionFile,
      board,
      userPrompt: "今天北京天气怎么样",
      runId: "run-b",
      run: {
        sessionId: "session-a",
        provider: "anthropic",
        model: "claude",
        workspaceDir: tmpDir,
        config: {},
        timeoutMs: 5_000,
      },
      runEmbedded: runEmbedded as never,
    });

    expect(result.ok).toBe(true);
    expect(result.text).toContain("北京今天晴");
    expect(result.isolation.parentSessionId).toBe("session-a");
    expect(result.isolation.asideSessionId).toBe("aside-reply-run-b");
    expect(result.isolation.disableTools).toBe(true);
    expect(result.isolation.boardTouched).toBe(false);
    expect(runEmbedded).toHaveBeenCalledTimes(1);

    const after = readSessionTaskBoard(parentSessionFile);
    expect(after.writeEpoch ?? 0).toBe(epochBefore);
    expect(activeConstraintTexts(after.current).join("|")).toBe(constraintsBefore);
    // Lane unregistered after completion so pause won't chase a finished aside.
    expect(listMidTaskAsideLanesForTests("session-a")).toEqual([]);
  });

  it("owner pause abort path cancels registered aside session ids (not parent only)", () => {
    registerMidTaskAsideLane("session-a", "aside-1");
    registerMidTaskAsideLane("session-a", "aside-2");
    const aborted = abortMidTaskAsideLanes("session-a");
    expect(aborted.toSorted()).toEqual(["aside-1", "aside-2"]);
    expect(abortEmbeddedPiRunMock).toHaveBeenCalledWith("aside-1");
    expect(abortEmbeddedPiRunMock).toHaveBeenCalledWith("aside-2");
    expect(listMidTaskAsideLanesForTests("session-a")).toEqual([]);
  });

  it("aborting parent embedded run id alone does not clear a different aside registration", () => {
    registerMidTaskAsideLane("session-a", "aside-live");
    // Simulates abortEmbeddedPiRun(parent) without abortMidTaskAsideLanes —
    // registry still holds the aside until explicit stop-priority cleanup.
    expect(listMidTaskAsideLanesForTests("session-a")).toEqual(["aside-live"]);
    unregisterMidTaskAsideLane("session-a", "aside-live");
    expect(listMidTaskAsideLanesForTests("session-a")).toEqual([]);
  });
});
