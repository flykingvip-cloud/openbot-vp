import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeConstraintTexts,
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
  seedSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import {
  abortMidTaskAsideLanes,
  appendAsideDialogueTurn,
  assertAsideReplyLaneIsolation,
  buildAsideReplyLanePrompt,
  isMidTaskAsideLaneCancelled,
  listMidTaskAsideLanesForTests,
  readAsideDialogueTurns,
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
      effectiveConstraints: [
        "只要国内安卓机型，并且必须覆盖电池续航、影像样张与售后政策这三大维度的完整对比材料；同时禁止引用任何海外评测站点的份额数据，所有结论须标注公开可核验来源；报告结构需包含摘要、机型清单、维度对比表、风险与不确定性、以及可执行建议清单，字数与口径以主人后续补充为准但不得擅自删减已登记约束。补充说明：完整约束文本不得在旁路提示中截断为省略号。完整约束文本不得在旁路提示中截断为省略号。完整约束文本不得在旁路提示中截断为省略号。完整约束文本不得在旁路提示中截断为省略号。完整约束文本不得在旁路提示中截断为省略号。完整约束文本不得在旁路提示中截断为省略号。",
      ],
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

  it("buildAsideReplyLanePrompt keeps full constraints and related history", () => {
    const board = readSessionTaskBoard(parentSessionFile);
    const longConstraint = activeConstraintTexts(board.current)[0] ?? "";
    expect(longConstraint.length).toBeGreaterThan(200);
    const prompt = buildAsideReplyLanePrompt({
      board,
      userPrompt: "为什么刚才那一点？",
      history: [
        { atMs: 1, runId: "r1", role: "user", text: "今天北京天气怎么样" },
        { atMs: 2, runId: "r1", role: "assistant", text: "北京今天晴。" },
      ],
    });
    expect(prompt).toContain("只读");
    expect(prompt).toContain("禁止");
    expect(prompt).toContain(longConstraint);
    expect(prompt).not.toContain(`${longConstraint.slice(0, 200)}…`);
    expect(prompt).toContain("北京今天晴");
    expect(prompt).toContain("为什么刚才那一点");
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
      expect(String(args.sessionFile)).toContain("openbot-aside-reply-");
      expect(String(args.prompt)).toContain("只要国内安卓机型");
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
    expect(listMidTaskAsideLanesForTests("session-a")).toEqual([]);

    const turns = readAsideDialogueTurns(parentSessionFile);
    expect(turns.some((t) => t.role === "user" && t.text.includes("北京天气"))).toBe(true);
    expect(turns.some((t) => t.role === "assistant" && t.text.includes("北京今天晴"))).toBe(true);
  });

  it("A board update/completion while B runs does not discard B answer", async () => {
    const board = readSessionTaskBoard(parentSessionFile);
    const runEmbedded = vi.fn(async () => {
      mutateSessionTaskBoard(parentSessionFile, (live) => {
        if (!live.current) {
          return { board: live, value: undefined };
        }
        return {
          board: {
            ...live,
            current: {
              ...live.current,
              unfinished: false,
              stop: { summary: "A 已完成", workspacePaths: [] },
              effectiveConstraints: [
                ...(live.current.effectiveConstraints ?? []),
                {
                  text: "补充：主人中途加的约束很长很长很长很长很长很长很长很长很长",
                  atMs: Date.now(),
                  kind: "supplement" as const,
                },
              ],
            },
          },
          value: undefined,
        };
      });
      return {
        payloads: [{ text: "插问有效回答：仍应交付。" }],
        meta: { durationMs: 1 },
      };
    });

    const result = await runMidTaskAsideReplyLane({
      parentSessionId: "session-a",
      parentSessionFile,
      board,
      userPrompt: "解释一下刚才的结论",
      runId: "run-b-while-a",
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
    expect(result.text).toContain("仍应交付");
    const after = readSessionTaskBoard(parentSessionFile);
    expect(after.current?.unfinished).toBe(false);
    expect(after.writeEpoch ?? 0).toBeGreaterThan(board.writeEpoch ?? 0);
  });

  it("cancel signal blocks start before embedded run and keeps registration until cleanup", async () => {
    registerMidTaskAsideLane("session-a", "aside-reply-run-early");
    const aborted = abortMidTaskAsideLanes("session-a");
    expect(aborted).toContain("aside-reply-run-early");
    expect(isMidTaskAsideLaneCancelled("session-a", "aside-reply-run-early")).toBe(true);
    // Must NOT drop registration — late start observes cancelled.
    expect(listMidTaskAsideLanesForTests("session-a")).toContain("aside-reply-run-early");

    const runEmbedded = vi.fn(async () => {
      throw new Error("must not start after cancel");
    });
    // Pre-cancel the exact aside id this run will use.
    registerMidTaskAsideLane("session-a", "aside-reply-run-b-cancel");
    abortMidTaskAsideLanes("session-a");

    const result = await runMidTaskAsideReplyLane({
      parentSessionId: "session-a",
      parentSessionFile,
      board: readSessionTaskBoard(parentSessionFile),
      userPrompt: "迟到插问",
      runId: "run-b-cancel",
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
    expect(result.ok).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(runEmbedded).not.toHaveBeenCalled();
  });

  it("cancel during run discards late answer", async () => {
    let resolveRun: ((value: unknown) => void) | undefined;
    const runEmbedded = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveRun = resolve;
        }),
    );

    const pending = runMidTaskAsideReplyLane({
      parentSessionId: "session-a",
      parentSessionFile,
      board: readSessionTaskBoard(parentSessionFile),
      userPrompt: "运行中插问",
      runId: "run-b-inflight",
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

    // Wait until registered + embedded started.
    for (let i = 0; i < 50 && !resolveRun; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(resolveRun).toBeTypeOf("function");
    expect(listMidTaskAsideLanesForTests("session-a")).toContain("aside-reply-run-b-inflight");

    abortMidTaskAsideLanes("session-a");
    expect(isMidTaskAsideLaneCancelled("session-a", "aside-reply-run-b-inflight")).toBe(true);
    resolveRun?.({
      payloads: [{ text: "迟到回答不应交付" }],
      meta: { durationMs: 1 },
    });

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.text).not.toContain("迟到回答不应交付");
  });

  it("refresh/reconnect recovers aside Q&A for follow-up prompt", async () => {
    appendAsideDialogueTurn(parentSessionFile, {
      atMs: 1,
      runId: "run-b1",
      role: "user",
      text: "今天北京天气怎么样",
    });
    appendAsideDialogueTurn(parentSessionFile, {
      atMs: 2,
      runId: "run-b1",
      role: "assistant",
      text: "北京今天晴，气温适宜。",
    });

    // Simulate refresh: only durable log remains (ephemeral jsonl already gone).
    const recovered = readAsideDialogueTurns(parentSessionFile);
    expect(recovered).toHaveLength(2);

    const runEmbedded = vi.fn(async (args: Record<string, unknown>) => {
      expect(String(args.prompt)).toContain("北京今天晴");
      expect(String(args.prompt)).toContain("解释刚才那一点");
      return {
        payloads: [{ text: "刚才是指气温适宜、适合出行。" }],
        meta: { durationMs: 1 },
      };
    });

    const result = await runMidTaskAsideReplyLane({
      parentSessionId: "session-a",
      parentSessionFile,
      board: readSessionTaskBoard(parentSessionFile),
      userPrompt: "解释刚才那一点",
      runId: "run-b2",
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
    expect(result.text).toContain("气温适宜");
    expect(readAsideDialogueTurns(parentSessionFile).length).toBeGreaterThanOrEqual(4);
  });

  it("owner pause abort path marks registered asides cancelled without dropping the signal", () => {
    registerMidTaskAsideLane("session-a", "aside-1");
    registerMidTaskAsideLane("session-a", "aside-2");
    const aborted = abortMidTaskAsideLanes("session-a");
    expect(aborted.toSorted()).toEqual(["aside-1", "aside-2"]);
    expect(abortEmbeddedPiRunMock).toHaveBeenCalledWith("aside-1");
    expect(abortEmbeddedPiRunMock).toHaveBeenCalledWith("aside-2");
    expect(isMidTaskAsideLaneCancelled("session-a", "aside-1")).toBe(true);
    expect(listMidTaskAsideLanesForTests("session-a").toSorted()).toEqual(["aside-1", "aside-2"]);
    unregisterMidTaskAsideLane("session-a", "aside-1");
    unregisterMidTaskAsideLane("session-a", "aside-2");
  });

  it("aborting parent embedded run id alone does not clear a different aside registration", () => {
    registerMidTaskAsideLane("session-a", "aside-live");
    expect(listMidTaskAsideLanesForTests("session-a")).toEqual(["aside-live"]);
    unregisterMidTaskAsideLane("session-a", "aside-live");
    expect(listMidTaskAsideLanesForTests("session-a")).toEqual([]);
  });
});
