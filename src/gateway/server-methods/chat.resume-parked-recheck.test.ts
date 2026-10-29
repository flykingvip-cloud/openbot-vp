import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyIncomingUserMessage,
  emptySessionTaskBoard,
  writeSessionTaskBoard,
} from "../../conversation-task/session-task-board.js";
import {
  applyChatFocusSwitchGateWithResumeRecheck,
  buildResumeTaskStopActive,
  clearAuthoritativeTaskStop,
  clientIdentityOkForResume,
  isAuthoritativeTaskStopActive,
  recordAuthoritativeTaskStop,
  resetAuthoritativeTaskStopsForTest,
  resolveResumeParkedRecheck,
  sessionStopBarrierActive,
} from "./chat-resume-parked-recheck.js";

const PRICE = "调研 A 公司定价并写一页纪要";
const RESEARCH = "另外帮我做一份竞品研究提纲";

const tempDirs: string[] = [];

afterEach(() => {
  resetAuthoritativeTaskStopsForTest();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempSessionFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-resume-recheck-"));
  tempDirs.push(dir);
  return path.join(dir, "session.jsonl");
}

function parkOneTask(sessionFile: string): string {
  fs.writeFileSync(sessionFile, "", "utf8");
  const first = applyIncomingUserMessage({
    board: emptySessionTaskBoard(),
    incomingText: PRICE,
    nowMs: 1_000,
  });
  const switched = applyIncomingUserMessage({
    board: first.board,
    incomingText: RESEARCH,
    nowMs: 2_000,
  });
  writeSessionTaskBoard(sessionFile, switched.board);
  return switched.board.parked[0]?.taskId ?? "";
}

describe("resolveResumeParkedRecheck", () => {
  it("defaults to authOk true and stopActive false when signals are clean", () => {
    expect(resolveResumeParkedRecheck({})).toEqual({ authOk: true, stopActive: false });
    expect(
      resolveResumeParkedRecheck({
        sendPolicy: "allow",
        accessAuthorized: true,
        clientIdentityOk: true,
      }),
    ).toEqual({ authOk: true, stopActive: false });
  });

  it("fail-closes auth when send policy denies or identity/access is false", () => {
    expect(resolveResumeParkedRecheck({ sendPolicy: "deny" }).authOk).toBe(false);
    expect(resolveResumeParkedRecheck({ accessAuthorized: false }).authOk).toBe(false);
    expect(resolveResumeParkedRecheck({ clientIdentityOk: false }).authOk).toBe(false);
  });

  it("sets stopActive only when the barrier flag is true", () => {
    expect(resolveResumeParkedRecheck({ stopActive: true }).stopActive).toBe(true);
    expect(resolveResumeParkedRecheck({ stopActive: false }).stopActive).toBe(false);
  });
});

describe("clientIdentityOkForResume", () => {
  it("accepts missing client (internal callers) and any usable identity signal", () => {
    expect(clientIdentityOkForResume(null)).toBe(true);
    expect(clientIdentityOkForResume({ user: "u1" })).toBe(true);
    expect(clientIdentityOkForResume({ platformUserId: "p1" })).toBe(true);
    expect(clientIdentityOkForResume({ pairedDeviceId: "d1" })).toBe(true);
    expect(clientIdentityOkForResume({ sessionMembershipId: "m1" })).toBe(true);
    expect(clientIdentityOkForResume({ connect: { role: "operator" } })).toBe(true);
  });

  it("rejects an empty hydrated client shell", () => {
    expect(clientIdentityOkForResume({ connect: {} })).toBe(false);
    expect(clientIdentityOkForResume({ user: "  " })).toBe(false);
  });
});

describe("sessionStopBarrierActive + authoritative task stop", () => {
  it("is true only when a matching session controller has aborted", () => {
    const controllers = new Map<
      string,
      { sessionKey: string; controller?: { signal?: { aborted?: boolean } } }
    >([
      ["run-a", { sessionKey: "agent:main:main", controller: { signal: { aborted: true } } }],
      ["run-b", { sessionKey: "other", controller: { signal: { aborted: true } } }],
    ]);
    expect(
      sessionStopBarrierActive({
        sessionKeys: ["agent:main:main"],
        chatAbortControllers: controllers,
      }),
    ).toBe(true);
    expect(
      sessionStopBarrierActive({
        sessionKeys: ["agent:main:main"],
        chatAbortControllers: new Map([
          ["run-c", { sessionKey: "agent:main:main", controller: { signal: { aborted: false } } }],
        ]),
      }),
    ).toBe(false);
  });

  it("anti-example: abort then delete controller — live scan false, authoritative still blocks resume", () => {
    const sessionKey = "agent:main:main";
    const taskId = "task-stopped-original";
    const otherTaskId = "task-other-unrelated";

    // Simulate abortChatRunById: abort signal was true, then the Map entry is deleted.
    const controllers = new Map<
      string,
      { sessionKey: string; controller?: { signal?: { aborted?: boolean } } }
    >([["run-dying", { sessionKey, controller: { signal: { aborted: true } } }]]);
    expect(
      sessionStopBarrierActive({
        sessionKeys: [sessionKey],
        chatAbortControllers: controllers,
      }),
    ).toBe(true);

    controllers.delete("run-dying"); // record cleaned — ephemeral scan alone would lie
    expect(
      sessionStopBarrierActive({
        sessionKeys: [sessionKey],
        chatAbortControllers: controllers,
      }),
    ).toBe(false);

    const scope = { tenantId: "tenant-a", userId: "user-a", sessionKey };
    recordAuthoritativeTaskStop({
      taskId,
      ...scope,
      reason: "rpc",
      nowMs: 9_001,
    });
    expect(isAuthoritativeTaskStopActive({ taskId, ...scope })).toBe(true);
    expect(
      sessionStopBarrierActive({
        sessionKeys: [sessionKey],
        chatAbortControllers: controllers, // empty after delete
        taskId,
        tenantId: scope.tenantId,
        userId: scope.userId,
      }),
    ).toBe(true);
    // Other taskIds in the same session are not blocked by that record.
    expect(
      sessionStopBarrierActive({
        sessionKeys: [sessionKey],
        chatAbortControllers: controllers,
        taskId: otherTaskId,
        tenantId: scope.tenantId,
        userId: scope.userId,
      }),
    ).toBe(false);

    const isTaskStopActive = buildResumeTaskStopActive({
      sessionKeys: [sessionKey],
      chatAbortControllers: controllers,
      tenantId: scope.tenantId,
      userId: scope.userId,
    });
    expect(isTaskStopActive(taskId)).toBe(true);
    expect(isTaskStopActive(otherTaskId)).toBe(false);

    clearAuthoritativeTaskStop({ taskId, ...scope }); // undo / explicit clear
    expect(isTaskStopActive(taskId)).toBe(false);
  });
});

describe("applyChatFocusSwitchGateWithResumeRecheck (chat entry path)", () => {
  it("rejects resume when live auth recheck fails — unsafe path cannot resume", () => {
    const sessionFile = tempSessionFile();
    const parkedId = parkOneTask(sessionFile);
    expect(parkedId).toBeTruthy();

    const denied = applyChatFocusSwitchGateWithResumeRecheck({
      sessionFile,
      incomingText: `继续挂起 ${parkedId}`,
      nowMs: 3_000,
      recheckInputs: { clientIdentityOk: false },
    });
    expect(denied.action).toBe("continue");
    expect(denied.statusLine ?? "").toContain("授权无效");
    expect(denied.cutContext).toBe(false);
  });

  it("rejects resume when live stop barrier is active", () => {
    const sessionFile = tempSessionFile();
    const parkedId = parkOneTask(sessionFile);

    const denied = applyChatFocusSwitchGateWithResumeRecheck({
      sessionFile,
      incomingText: `继续挂起 ${parkedId}`,
      nowMs: 3_000,
      recheckInputs: { stopActive: true },
    });
    expect(denied.action).toBe("continue");
    expect(denied.statusLine ?? "").toContain("已停止");
    expect(denied.cutContext).toBe(false);
  });

  it("allows resume when live recheck passes", () => {
    const sessionFile = tempSessionFile();
    const parkedId = parkOneTask(sessionFile);

    const ok = applyChatFocusSwitchGateWithResumeRecheck({
      sessionFile,
      incomingText: `继续挂起 ${parkedId}`,
      nowMs: 3_000,
      recheckInputs: {
        sendPolicy: "allow",
        accessAuthorized: true,
        clientIdentityOk: true,
        stopActive: false,
      },
    });
    expect(ok.action).toBe("resume");
    expect(ok.cutContext).toBe(true);
  });

  it("anti-example: after abort deletes controllers, authoritative task stop still denies resume", () => {
    const sessionFile = tempSessionFile();
    const parkedId = parkOneTask(sessionFile);
    expect(parkedId).toBeTruthy();

    // Controllers already cleaned (abortChatRunById deleted the aborted entry).
    const emptyControllers = new Map<
      string,
      { sessionKey: string; controller?: { signal?: { aborted?: boolean } } }
    >();
    const scope = {
      tenantId: "tenant-a",
      userId: "user-a",
      sessionKey: "agent:main:main",
    };
    recordAuthoritativeTaskStop({
      taskId: parkedId,
      ...scope,
      reason: "user-stop",
      nowMs: 2_500,
    });

    const denied = applyChatFocusSwitchGateWithResumeRecheck({
      sessionFile,
      incomingText: `继续挂起 ${parkedId}`,
      nowMs: 3_000,
      recheckInputs: {
        sendPolicy: "allow",
        accessAuthorized: true,
        clientIdentityOk: true,
        // Broad live scan is false after cleanup — must not be the sole signal.
        stopActive: sessionStopBarrierActive({
          sessionKeys: [scope.sessionKey],
          chatAbortControllers: emptyControllers,
          tenantId: scope.tenantId,
          userId: scope.userId,
        }),
        isTaskStopActive: buildResumeTaskStopActive({
          sessionKeys: [scope.sessionKey],
          chatAbortControllers: emptyControllers,
          tenantId: scope.tenantId,
          userId: scope.userId,
        }),
      },
    });
    expect(denied.action).toBe("continue");
    expect(denied.statusLine ?? "").toContain("已停止");
    expect(denied.cutContext).toBe(false);

    clearAuthoritativeTaskStop({ taskId: parkedId, ...scope });
    const ok = applyChatFocusSwitchGateWithResumeRecheck({
      sessionFile,
      incomingText: `继续挂起 ${parkedId}`,
      nowMs: 4_000,
      recheckInputs: {
        sendPolicy: "allow",
        accessAuthorized: true,
        clientIdentityOk: true,
        stopActive: false,
        isTaskStopActive: buildResumeTaskStopActive({
          sessionKeys: [scope.sessionKey],
          chatAbortControllers: emptyControllers,
          tenantId: scope.tenantId,
          userId: scope.userId,
        }),
      },
    });
    expect(ok.action).toBe("resume");
    expect(ok.cutContext).toBe(true);
  });
});

describe("authoritative stop scope isolation (cross-session / cross-tenant)", () => {
  const emptyControllers = new Map<
    string,
    { sessionKey: string; controller?: { signal?: { aborted?: boolean } } }
  >();

  it("same-session: abort→clear controllers→resume still blocked via scoped registry", () => {
    const scope = {
      tenantId: "tenant-a",
      userId: "user-a",
      sessionKey: "agent:main:session-a",
    };
    const taskId = "task-shared-hash-销售日报";

    // Simulate abortChatRunById: controller aborted then deleted.
    const controllers = new Map<
      string,
      { sessionKey: string; controller?: { signal?: { aborted?: boolean } } }
    >([["run-a", { sessionKey: scope.sessionKey, controller: { signal: { aborted: true } } }]]);
    controllers.delete("run-a");

    recordAuthoritativeTaskStop({
      taskId,
      ...scope,
      reason: "rpc",
      nowMs: 1_000,
    });

    const isTaskStopActive = buildResumeTaskStopActive({
      sessionKeys: [scope.sessionKey],
      chatAbortControllers: emptyControllers,
      tenantId: scope.tenantId,
      userId: scope.userId,
    });
    expect(isTaskStopActive(taskId)).toBe(true);
    expect(
      sessionStopBarrierActive({
        sessionKeys: [scope.sessionKey],
        chatAbortControllers: emptyControllers,
        taskId,
        tenantId: scope.tenantId,
        userId: scope.userId,
      }),
    ).toBe(true);
  });

  it("other session / tenant with same task text is unaffected", () => {
    // Identical task text → identical taskId across sessions (hash collision by design).
    const taskId = "task-shared-hash-生成销售日报";
    const scopeA = {
      tenantId: "tenant-a",
      userId: "user-a",
      sessionKey: "agent:main:session-a",
    };
    const scopeB = {
      tenantId: "tenant-b",
      userId: "user-b",
      sessionKey: "agent:main:session-b",
    };

    recordAuthoritativeTaskStop({
      taskId,
      ...scopeA,
      reason: "user-stop",
      nowMs: 2_000,
    });

    expect(isAuthoritativeTaskStopActive({ taskId, ...scopeA })).toBe(true);
    // Session B / tenant B must not see A's stop despite identical taskId.
    expect(isAuthoritativeTaskStopActive({ taskId, ...scopeB })).toBe(false);
    expect(
      buildResumeTaskStopActive({
        sessionKeys: [scopeB.sessionKey],
        chatAbortControllers: emptyControllers,
        tenantId: scopeB.tenantId,
        userId: scopeB.userId,
      })(taskId),
    ).toBe(false);

    // Same tenant but different session still isolated.
    expect(
      isAuthoritativeTaskStopActive({
        taskId,
        tenantId: scopeA.tenantId,
        userId: scopeA.userId,
        sessionKey: "agent:main:session-other",
      }),
    ).toBe(false);
  });

  it("other session undo does not clear this session's stop", () => {
    const taskId = "task-shared-hash-生成销售日报";
    const scopeA = {
      tenantId: "tenant-a",
      userId: "user-a",
      sessionKey: "agent:main:session-a",
    };
    const scopeB = {
      tenantId: "tenant-a",
      userId: "user-a",
      sessionKey: "agent:main:session-b",
    };

    recordAuthoritativeTaskStop({ taskId, ...scopeA, reason: "rpc", nowMs: 3_000 });
    recordAuthoritativeTaskStop({ taskId, ...scopeB, reason: "rpc", nowMs: 3_001 });

    // Session B undo — must not clear session A's stop.
    expect(clearAuthoritativeTaskStop({ taskId, ...scopeB })).toBe(true);
    expect(isAuthoritativeTaskStopActive({ taskId, ...scopeB })).toBe(false);
    expect(isAuthoritativeTaskStopActive({ taskId, ...scopeA })).toBe(true);

    // taskId-only / missing-scope clear must refuse (no global wipe).
    expect(clearAuthoritativeTaskStop({ taskId, sessionKey: "" })).toBe(false);
    expect(isAuthoritativeTaskStopActive({ taskId, ...scopeA })).toBe(true);

    // Missing-scope query must not fall back to global taskId lookup.
    expect(isAuthoritativeTaskStopActive({ taskId, sessionKey: "" })).toBe(false);
    expect(isAuthoritativeTaskStopActive({ taskId } as { taskId: string })).toBe(false);
  });

  it("record without sessionKey refuses (no taskId-only fallback)", () => {
    expect(
      recordAuthoritativeTaskStop({
        taskId: "task-x",
        tenantId: "t1",
        userId: "u1",
        sessionKey: "",
      }),
    ).toBeNull();
    expect(
      recordAuthoritativeTaskStop({
        taskId: "task-x",
        tenantId: "t1",
        userId: "u1",
      }),
    ).toBeNull();
  });
});
