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
  clientIdentityOkForResume,
  resolveResumeParkedRecheck,
  sessionStopBarrierActive,
} from "./chat-resume-parked-recheck.js";

const PRICE = "调研 A 公司定价并写一页纪要";
const RESEARCH = "另外帮我做一份竞品研究提纲";

const tempDirs: string[] = [];

afterEach(() => {
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

describe("sessionStopBarrierActive", () => {
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
});
