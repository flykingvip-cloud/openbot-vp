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
  AUTHORITATIVE_STOP_INTERNAL_TENANT,
  AUTHORITATIVE_STOP_INTERNAL_USER,
  AUTHORITATIVE_STOP_PERSONAL_TENANT,
  applyChatFocusSwitchGateWithResumeRecheck,
  buildResumeTaskStopActive,
  clearAuthoritativeTaskStop,
  clientIdentityOkForResume,
  isAuthoritativeTaskStopActive,
  queryAuthoritativeTaskStop,
  recordAuthoritativeTaskStop,
  resetAuthoritativeTaskStopsForTest,
  resolveAuthoritativeTaskStopScope,
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

describe("authoritative stop incomplete scope refusal (P1)", () => {
  const emptyControllers = new Map<
    string,
    { sessionKey: string; controller?: { signal?: { aborted?: boolean } } }
  >();

  it("managed: missing user refuses record; query is unverifiable; resume fails closed", () => {
    const sessionKey = "agent:main:managed-missing-user";
    const taskId = "task-managed-missing-user";

    expect(
      recordAuthoritativeTaskStop({
        taskId,
        tenantId: "tenant-a",
        userId: "",
        sessionKey,
        scopeKind: "managed",
      }),
    ).toBeNull();
    expect(
      recordAuthoritativeTaskStop({
        taskId,
        tenantId: "tenant-a",
        sessionKey,
        scopeKind: "managed",
      }),
    ).toBeNull();
    expect(
      resolveAuthoritativeTaskStopScope({
        tenantId: "tenant-a",
        userId: null,
        sessionKey,
        scopeKind: "managed",
      }),
    ).toBeNull();

    const query = queryAuthoritativeTaskStop({
      taskId,
      tenantId: "tenant-a",
      userId: null,
      sessionKey,
      scopeKind: "managed",
    });
    expect(query).toEqual({ state: "unverifiable", reason: "incomplete_scope" });
    // Boolean helper says "not active" — resume must NOT treat that as allow.
    expect(
      isAuthoritativeTaskStopActive({
        taskId,
        tenantId: "tenant-a",
        userId: null,
        sessionKey,
        scopeKind: "managed",
      }),
    ).toBe(false);

    const isTaskStopActive = buildResumeTaskStopActive({
      sessionKeys: [sessionKey],
      chatAbortControllers: emptyControllers,
      tenantId: "tenant-a",
      userId: null,
      scopeKind: "managed",
    });
    expect(isTaskStopActive(taskId)).toBe(true); // fail closed
  });

  it("managed: missing tenant refuses — taskId+sessionKey alone cannot record or query-as-inactive", () => {
    const sessionKey = "agent:main:managed-missing-tenant";
    const taskId = "task-managed-missing-tenant";

    // Reviewer anti-example: only taskId + sessionKey must NOT succeed.
    expect(
      recordAuthoritativeTaskStop({
        taskId,
        sessionKey,
      }),
    ).toBeNull();
    expect(
      recordAuthoritativeTaskStop({
        taskId,
        tenantId: "",
        userId: "user-a",
        sessionKey,
        scopeKind: "managed",
      }),
    ).toBeNull();
    expect(
      resolveAuthoritativeTaskStopScope({
        tenantId: "",
        userId: "user-a",
        sessionKey,
        scopeKind: "managed",
      }),
    ).toBeNull();

    expect(
      queryAuthoritativeTaskStop({
        taskId,
        sessionKey,
      }),
    ).toEqual({ state: "unverifiable", reason: "incomplete_scope" });

    expect(
      buildResumeTaskStopActive({
        sessionKeys: [sessionKey],
        chatAbortControllers: emptyControllers,
        // no tenant/user — identity not ready
      })(taskId),
    ).toBe(true);
  });

  it("personal: requires userId; never silently coerces missing user to empty string", () => {
    const sessionKey = "agent:main:personal";
    const taskId = "task-personal";

    expect(
      resolveAuthoritativeTaskStopScope({
        sessionKey,
        scopeKind: "personal",
      }),
    ).toBeNull();
    expect(
      recordAuthoritativeTaskStop({
        taskId,
        sessionKey,
        scopeKind: "personal",
      }),
    ).toBeNull();

    const recorded = recordAuthoritativeTaskStop({
      taskId,
      userId: "user-personal",
      sessionKey,
      scopeKind: "personal",
      reason: "rpc",
      nowMs: 5_000,
    });
    expect(recorded).toMatchObject({
      kind: "personal",
      tenantId: AUTHORITATIVE_STOP_PERSONAL_TENANT,
      userId: "user-personal",
      sessionKey,
      taskId,
    });
    expect(
      isAuthoritativeTaskStopActive({
        taskId,
        userId: "user-personal",
        sessionKey,
        scopeKind: "personal",
      }),
    ).toBe(true);
    // Different user must not see it.
    expect(
      isAuthoritativeTaskStopActive({
        taskId,
        userId: "user-other",
        sessionKey,
        scopeKind: "personal",
      }),
    ).toBe(false);
  });

  it("internal: only when scopeKind explicit — blank identity is not silently coerced", () => {
    const sessionKey = "agent:main:internal";
    const taskId = "task-internal";

    // Without explicit internal kind, blank identity refuses.
    expect(resolveAuthoritativeTaskStopScope({ sessionKey })).toBeNull();
    expect(recordAuthoritativeTaskStop({ taskId, sessionKey })).toBeNull();

    const recorded = recordAuthoritativeTaskStop({
      taskId,
      sessionKey,
      scopeKind: "internal",
      reason: "test",
      nowMs: 6_000,
    });
    expect(recorded).toMatchObject({
      kind: "internal",
      tenantId: AUTHORITATIVE_STOP_INTERNAL_TENANT,
      userId: AUTHORITATIVE_STOP_INTERNAL_USER,
      sessionKey,
      taskId,
    });
  });

  it("production entry: identity-not-ready denies resume (missing user)", async () => {
    const sessionFile = tempSessionFile();
    const parkedId = parkOneTask(sessionFile);
    expect(parkedId).toBeTruthy();

    const sessionKey = "agent:main:prod-missing-user";
    const denied = applyChatFocusSwitchGateWithResumeRecheck({
      sessionFile,
      incomingText: `继续挂起 ${parkedId}`,
      nowMs: 3_000,
      recheckInputs: {
        sendPolicy: "allow",
        accessAuthorized: true,
        clientIdentityOk: true,
        stopActive: false,
        isTaskStopActive: buildResumeTaskStopActive({
          sessionKeys: [sessionKey],
          chatAbortControllers: emptyControllers,
          tenantId: "tenant-a",
          userId: null,
          scopeKind: "managed",
        }),
      },
    });
    expect(denied.action).toBe("continue");
    expect(denied.statusLine ?? "").toContain("已停止");
    expect(denied.cutContext).toBe(false);
  });

  it("production entry: identity-not-ready denies resume (missing tenant)", () => {
    const sessionFile = tempSessionFile();
    const parkedId = parkOneTask(sessionFile);

    const sessionKey = "agent:main:prod-missing-tenant";
    const denied = applyChatFocusSwitchGateWithResumeRecheck({
      sessionFile,
      incomingText: `继续挂起 ${parkedId}`,
      nowMs: 3_000,
      recheckInputs: {
        sendPolicy: "allow",
        accessAuthorized: true,
        clientIdentityOk: true,
        stopActive: false,
        isTaskStopActive: buildResumeTaskStopActive({
          sessionKeys: [sessionKey],
          chatAbortControllers: emptyControllers,
          scopeKind: "managed",
          tenantId: null,
          userId: "user-a",
        }),
      },
    });
    expect(denied.action).toBe("continue");
    expect(denied.statusLine ?? "").toContain("已停止");
    expect(denied.cutContext).toBe(false);
  });

  it("production entry: identity-not-ready denies resume (no tenant/user at all)", () => {
    const sessionFile = tempSessionFile();
    const parkedId = parkOneTask(sessionFile);

    const denied = applyChatFocusSwitchGateWithResumeRecheck({
      sessionFile,
      incomingText: `继续挂起 ${parkedId}`,
      nowMs: 3_000,
      recheckInputs: {
        sendPolicy: "allow",
        accessAuthorized: true,
        clientIdentityOk: true,
        stopActive: false,
        isTaskStopActive: buildResumeTaskStopActive({
          sessionKeys: ["agent:main:prod-identity-blank"],
          chatAbortControllers: emptyControllers,
        }),
      },
    });
    expect(denied.action).toBe("continue");
    expect(denied.statusLine ?? "").toContain("已停止");
    expect(denied.cutContext).toBe(false);
  });
});
