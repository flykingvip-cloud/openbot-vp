import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claimOguiDecisionResume,
  issueOguiDecisionFromText,
  recoverOguiDecisionResume,
  type OguiDecisionRunBinding,
} from "./ogui-decision-engine.js";
import { clearOguiWaitRegistryForTests } from "./ogui-decision-wait-registry.js";
import { loadSessionStore, updateSessionStore } from "./store.js";

const ENV_ON = { OPENBOT_OGUI_DECISION_LIFECYCLE: "1" };
const CHILD = path.resolve("src/config/sessions/ogui-decision-process-child.ts");

function formText(): string {
  return [
    "```ogui-form",
    JSON.stringify({
      schema_version: "ogui/v1",
      component_id: "cmp-1",
      title: "选口径",
      fields: [
        {
          id: "choice",
          label: "口径",
          type: "single_select",
          options: [
            { value: "a", label: "甲" },
            { value: "b", label: "乙" },
          ],
        },
      ],
    }),
    "```",
  ].join("\n");
}

async function seedSession(): Promise<{ dir: string; storePath: string; sessionKey: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ogui-proc-"));
  const storePath = path.join(dir, "sessions.json");
  const sessionKey = "agent:main:process";
  await updateSessionStore(storePath, (store) => {
    store[sessionKey] = { sessionId: "sid-proc", updatedAt: 1 };
  });
  return { dir, storePath, sessionKey };
}

function binding(storePath: string, sessionKey: string): OguiDecisionRunBinding {
  return {
    lifecycleEnabled: true,
    cfg: { collaboration: { task: { oguiDecisionLifecycle: true } } },
    storePath,
    sessionKey,
    userId: "user-1",
    originRunId: "run-origin",
    ingress: "chat",
    allowIssue: true,
  };
}

function spawnChild(env: Record<string, string>): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", CHILD], {
      env: { ...process.env, OPENBOT_OGUI_DECISION_LIFECYCLE: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

afterEach(() => {
  clearOguiWaitRegistryForTests();
});

describe("OGUI decision process fixtures", () => {
  it("races two processes on one store for the same answer and for different answers (Ev3)", async () => {
    const same = await seedSession();
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: binding(same.storePath, same.sessionKey),
      env: ENV_ON,
    });
    const decisionId = issued.decisionId ?? "";
    const [left, right] = await Promise.all([
      spawnChild({
        OGUI_CHILD_MODE: "consume",
        OGUI_CHILD_STORE: same.storePath,
        OGUI_CHILD_SESSION: same.sessionKey,
        OGUI_CHILD_DECISION: decisionId,
        OGUI_CHILD_VALUE: "a",
        OGUI_CHILD_SUBMISSION: "sub-proc-1",
      }),
      spawnChild({
        OGUI_CHILD_MODE: "consume",
        OGUI_CHILD_STORE: same.storePath,
        OGUI_CHILD_SESSION: same.sessionKey,
        OGUI_CHILD_DECISION: decisionId,
        OGUI_CHILD_VALUE: "a",
        OGUI_CHILD_SUBMISSION: "sub-proc-2",
      }),
    ]);
    expect(left.code, left.stderr).toBe(0);
    expect(right.code, right.stderr).toBe(0);
    const sameResults = [JSON.parse(left.stdout), JSON.parse(right.stdout)] as Array<{
      ok: boolean;
      resumeRef?: string;
      idempotent?: boolean;
    }>;
    expect(sameResults.every((item) => item.ok)).toBe(true);
    expect(sameResults.map((item) => item.resumeRef)).toEqual([issued.resumeRef, issued.resumeRef]);
    expect(sameResults.filter((item) => item.idempotent === false)).toHaveLength(1);
    const sameStored = loadSessionStore(same.storePath, { skipCache: true })[same.sessionKey]
      ?.oguiDecisions?.[decisionId];
    expect(sameStored?.answer?.value).toBe("a");
    expect(sameStored?.answer?.submissionIds.toSorted()).toEqual(["sub-proc-1", "sub-proc-2"]);
    expect(sameStored?.resumeRef).toBe(issued.resumeRef);
    expect(sameStored?.resumeStatus).toBe("pending");
    fs.rmSync(same.dir, { recursive: true, force: true });

    const diff = await seedSession();
    const diffIssued = await issueOguiDecisionFromText({
      text: formText(),
      binding: binding(diff.storePath, diff.sessionKey),
      env: ENV_ON,
    });
    const diffId = diffIssued.decisionId ?? "";
    const raced = await Promise.all([
      spawnChild({
        OGUI_CHILD_MODE: "consume",
        OGUI_CHILD_STORE: diff.storePath,
        OGUI_CHILD_SESSION: diff.sessionKey,
        OGUI_CHILD_DECISION: diffId,
        OGUI_CHILD_VALUE: "a",
        OGUI_CHILD_SUBMISSION: "sub-proc-a",
      }),
      spawnChild({
        OGUI_CHILD_MODE: "consume",
        OGUI_CHILD_STORE: diff.storePath,
        OGUI_CHILD_SESSION: diff.sessionKey,
        OGUI_CHILD_DECISION: diffId,
        OGUI_CHILD_VALUE: "b",
        OGUI_CHILD_SUBMISSION: "sub-proc-b",
      }),
    ]);
    expect(raced[0]?.code, raced[0]?.stderr).toBe(0);
    expect(raced[1]?.code, raced[1]?.stderr).toBe(0);
    const parsed = raced.map(
      (item) =>
        JSON.parse(item.stdout) as {
          ok: boolean;
          reason?: string;
          resumeRef?: string;
          answer?: { value: string };
        },
    );
    const accepted = parsed.filter((item) => item.ok);
    const conflicts = parsed.filter((item) => !item.ok);
    expect(accepted).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.reason).toBe("conflict");
    expect(accepted[0]?.resumeRef).toBe(diffIssued.resumeRef);
    expect(conflicts[0]?.resumeRef).toBe(diffIssued.resumeRef);
    const stored = loadSessionStore(diff.storePath, { skipCache: true })[diff.sessionKey]
      ?.oguiDecisions?.[diffId];
    expect(stored?.answer?.value).toBe(accepted[0]?.answer?.value);
    expect(stored?.resumeStatus).toBe("pending");
    expect(Object.keys(stored ? { [diffId]: stored } : {})).toEqual([diffId]);
    fs.rmSync(diff.dir, { recursive: true, force: true });
  }, 30_000);

  it("SIGKILLs the claim process after the running save and reclaims the same resumeRef (Ev4)", async () => {
    const session = await seedSession();
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: binding(session.storePath, session.sessionKey),
      env: ENV_ON,
    });
    const decisionId = issued.decisionId ?? "";
    const killed = await spawnChild({
      OGUI_CHILD_MODE: "consume-then-sigkill",
      OGUI_CHILD_STORE: session.storePath,
      OGUI_CHILD_SESSION: session.sessionKey,
      OGUI_CHILD_DECISION: decisionId,
      OGUI_CHILD_VALUE: "a",
      OGUI_CHILD_SUBMISSION: "sub-kill",
    });
    expect(killed.signal).toBe("SIGKILL");
    const map =
      loadSessionStore(session.storePath, { skipCache: true })[session.sessionKey]?.oguiDecisions ??
      {};
    const recovered = recoverOguiDecisionResume(map, session.sessionKey);
    expect(recovered?.resumeRef).toBe(issued.resumeRef);
    expect(recovered?.resumeStatus).toBe("running");
    const again = await claimOguiDecisionResume({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      decisionId,
      lifecycleEnabled: true,
    });
    const third = await claimOguiDecisionResume({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      decisionId,
      lifecycleEnabled: true,
    });
    expect(again.claimed).toBe(false);
    expect(again.reason).toBe("already_started");
    expect(again.resumeRef).toBe(issued.resumeRef);
    expect(third.claimed).toBe(false);
    expect(third.resumeRef).toBe(issued.resumeRef);
    const reloaded =
      loadSessionStore(session.storePath, { skipCache: true })[session.sessionKey]?.oguiDecisions ??
      {};
    expect(Object.keys(reloaded)).toEqual([decisionId]);
    expect(reloaded[decisionId]?.resumeRef).toBe(issued.resumeRef);
    expect(reloaded[decisionId]?.resumeStatus).toBe("running");
    fs.rmSync(session.dir, { recursive: true, force: true });
  }, 30_000);
});
