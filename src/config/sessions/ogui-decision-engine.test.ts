import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  admitOguiDecisionTurn,
  applyOguiDecisionToVisibleText,
  applyOguiPromiseCardGate,
  claimOguiDecisionResume,
  classifyOguiWaitInbound,
  consumeOguiDecisionAnswer,
  issueOguiDecisionFromText,
  recoverOguiDecisionResume,
  type OguiDecisionRunBinding,
} from "./ogui-decision-engine.js";
import { clearOguiWaitRegistryForTests } from "./ogui-decision-wait-registry.js";
import { loadSessionStore, updateSessionStore } from "./store.js";

const ENV_ON = { OPENBOT_OGUI_DECISION_LIFECYCLE: "1" };
const ENV_OFF = { OPENBOT_OGUI_DECISION_LIFECYCLE: "0" };

function formText(extra?: Record<string, unknown>): string {
  const payload = {
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
    ...extra,
  };
  return ["请确认。", "", "```ogui-form", JSON.stringify(payload), "```"].join("\n");
}

function answerText(input: {
  decisionId: string;
  version: number;
  value: string;
  submissionId: string;
}): string {
  const payload = {
    schema_version: "ogui/v1",
    component_id: "cmp-1",
    submission_id: input.submissionId,
    decision_id: input.decisionId,
    decision_version: input.version,
    answers: { choice: input.value },
  };
  return ["```ogui-answer", JSON.stringify(payload), "```"].join("\n");
}

async function seedSession(): Promise<{ dir: string; storePath: string; sessionKey: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ogui-dec-"));
  const storePath = path.join(dir, "sessions.json");
  const sessionKey = "agent:main:decision";
  await updateSessionStore(storePath, (store) => {
    store[sessionKey] = { sessionId: "sid-1", updatedAt: 1 };
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
    agentId: "main",
    ingress: "chat",
    allowIssue: true,
  };
}

function readDecisions(storePath: string, sessionKey: string) {
  const store = loadSessionStore(storePath, { skipCache: true });
  return store[sessionKey]?.oguiDecisions;
}

afterEach(() => {
  clearOguiWaitRegistryForTests();
});

describe("OGUI decision engine S1–S5", () => {
  it("stays off and does not rewrite or write when the flag is off", async () => {
    const session = await seedSession();
    const text = `已签发\n${formText({ user_id: "from-fence" })}`;
    let writes = 0;
    const outcome = await issueOguiDecisionFromText({
      text,
      binding: binding(session.storePath, session.sessionKey),
      env: ENV_OFF,
      updateStore: () => {
        writes += 1;
        throw new Error("should not write");
      },
    });
    expect(outcome.kind).toBe("flag_off");
    expect(writes).toBe(0);
    const visible = await applyOguiDecisionToVisibleText({
      text,
      binding: binding(session.storePath, session.sessionKey),
      env: ENV_OFF,
    });
    expect(visible.text).toBe(text);
    expect(visible.oguiWaitActive).toBe(false);
    const admission = await admitOguiDecisionTurn({
      env: ENV_OFF,
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      inboundText: "继续做独立的部分",
      ingress: "heartbeat",
    });
    expect(admission.action).toBe("proceed");
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("issues only after updateSessionStore succeeds and ends the turn", async () => {
    const session = await seedSession();
    const bound = binding(session.storePath, session.sessionKey);
    const visible = await applyOguiDecisionToVisibleText({
      text: formText({ user_id: "from-fence" }),
      binding: bound,
      env: ENV_ON,
      nowMs: 50,
    });
    expect(visible.oguiWaitActive).toBe(true);
    expect(visible.text).toContain('"decision_id"');
    expect(visible.text).toContain('"decision_version": 1');
    const map = readDecisions(session.storePath, session.sessionKey);
    const record = Object.values(map ?? {})[0];
    expect(record?.decisionStatus).toBe("waiting");
    expect(record?.resumeStatus).toBe("pending");
    expect(record?.version).toBe(1);
    expect(record?.multiSelect).toBe(false);
    expect(record?.scope.userId).toBe("user-1");
    expect(record?.scope.originRunId).toBe("run-origin");
    expect(record?.scope.userId).not.toBe("from-fence");
    expect(record?.resumeRef.startsWith("ogr_")).toBe(true);
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("does not present an issued card when persist fails (Ev9)", async () => {
    const session = await seedSession();
    const text = `决策已签发，请操作卡片。\n${formText()}`;
    const visible = await applyOguiDecisionToVisibleText({
      text,
      binding: binding(session.storePath, session.sessionKey),
      env: ENV_ON,
      updateStore: () => {
        throw new Error("disk full");
      },
    });
    expect(visible.text).not.toContain("已签发");
    expect(visible.text).not.toContain("ogui-form");
    expect(visible.text).toContain("未签发");
    expect(visible.oguiWaitActive).toBe(true);
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("rejects multi_select explicitly and does not mint a card", async () => {
    const session = await seedSession();
    const text = formText({
      fields: [
        {
          id: "choice",
          label: "口径",
          type: "multi_select",
          options: [
            { value: "a", label: "甲" },
            { value: "b", label: "乙" },
          ],
        },
      ],
    });
    const outcome = await issueOguiDecisionFromText({
      text,
      binding: binding(session.storePath, session.sessionKey),
      env: ENV_ON,
    });
    expect(outcome.kind).toBe("failed");
    expect(outcome.reason).toBe("multi_select_rejected");
    expect(outcome.endTurn).toBe(true);
    expect(readDecisions(session.storePath, session.sessionKey)).toBeUndefined();
    const gated = applyOguiPromiseCardGate(text, outcome);
    expect(gated).not.toContain("ogui-form");
    expect(gated).toContain("未签发");
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("leaves discussion, quotes, and unexecuted plans unissued (Ev9)", () => {
    const discussion = "我们只是讨论一下口径，还没定。";
    expect(applyOguiPromiseCardGate(discussion, { kind: "not_proposal" })).toBe(discussion);
    const plan = "下一步计划是先看数据，尚未执行。";
    expect(applyOguiPromiseCardGate(plan, { kind: "not_proposal" })).toBe(plan);
    const quoted = `例如：\n> ${formText()}`;
    const stripped = applyOguiPromiseCardGate(quoted, { kind: "not_proposal" });
    expect(stripped).not.toContain("ogui-form");
    expect(stripped).not.toContain("未签发");
    const claimed = applyOguiPromiseCardGate("引用里写了已签发。", { kind: "not_proposal" });
    expect(claimed).toContain("未签发");
    expect(claimed).not.toContain("已签发");
  });

  it("reuses the same decisionId for the same proposal (D23)", async () => {
    const session = await seedSession();
    const bound = binding(session.storePath, session.sessionKey);
    const first = await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
      nowMs: 10,
    });
    const second = await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
      nowMs: 20,
    });
    expect(first.kind).toBe("issued");
    expect(second.kind).toBe("issued");
    expect(second.decisionId).toBe(first.decisionId);
    expect(second.resumeRef).toBe(first.resumeRef);
    expect(Object.keys(readDecisions(session.storePath, session.sessionKey) ?? {})).toEqual([
      first.decisionId,
    ]);
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("pauses heartbeat, queue, and retry instead of continuing the task (Ev10)", async () => {
    const session = await seedSession();
    const bound = binding(session.storePath, session.sessionKey);
    await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
    });
    for (const ingress of ["heartbeat", "queue", "retry"] as const) {
      expect(
        classifyOguiWaitInbound({
          inboundText: "继续做后面独立的部分",
          hasActiveWait: true,
          ingress,
        }),
      ).toBe("pause");
      const admission = await admitOguiDecisionTurn({
        binding: bound,
        env: ENV_ON,
        inboundText: "继续做后面独立的部分",
        ingress,
        phase: "run",
      });
      expect(admission.action).toBe("pause");
      expect(admission.text).not.toContain("已签发");
    }
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("consumes the same answer once and conflicts a different answer (Ev3)", async () => {
    const session = await seedSession();
    const bound = binding(session.storePath, session.sessionKey);
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
    });
    expect(issued.decisionId).toBeTruthy();
    const first = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        schema_version: "ogui/v1",
        component_id: "cmp-1",
        submission_id: "sub-1",
        decision_id: issued.decisionId,
        decision_version: 1,
        answers: { choice: "a" },
      },
    });
    const replay = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        schema_version: "ogui/v1",
        component_id: "cmp-1",
        submission_id: "sub-2",
        decision_id: issued.decisionId,
        decision_version: 1,
        answers: { choice: "a" },
      },
    });
    const conflict = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        schema_version: "ogui/v1",
        component_id: "cmp-1",
        submission_id: "sub-3",
        decision_id: issued.decisionId,
        decision_version: 1,
        answers: { choice: "b" },
      },
    });
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (first.ok && replay.ok) {
      expect(replay.idempotent).toBe(true);
      expect(replay.resumeRef).toBe(first.resumeRef);
      expect(replay.answer.submissionIds).toEqual(["sub-1", "sub-2"]);
    }
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.reason).toBe("conflict");
      expect(conflict.resumeRef).toBe(issued.resumeRef);
    }
    const stored = readDecisions(session.storePath, session.sessionKey)?.[issued.decisionId ?? ""];
    expect(stored?.answer?.value).toBe("a");
    expect(stored?.decisionStatus).toBe("answered");
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("keeps one resumeRef across consume-before-start and start-before-result (Ev4)", async () => {
    const session = await seedSession();
    const bound = binding(session.storePath, session.sessionKey);
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
    });
    const consumed = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        submission_id: "sub-crash",
        decision_id: issued.decisionId,
        decision_version: 1,
        answers: { choice: "a" },
      },
    });
    expect(consumed.ok).toBe(true);
    const pendingMap = readDecisions(session.storePath, session.sessionKey) ?? {};
    const pending = recoverOguiDecisionResume(pendingMap, session.sessionKey);
    expect(pending?.resumeRef).toBe(issued.resumeRef);
    expect(pending?.resumeStatus).toBe("pending");
    expect(Object.keys(pendingMap)).toHaveLength(1);
    const claimed = await claimOguiDecisionResume({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      decisionId: issued.decisionId ?? "",
      lifecycleEnabled: true,
    });
    const again = await claimOguiDecisionResume({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      decisionId: issued.decisionId ?? "",
      lifecycleEnabled: true,
    });
    expect(claimed.claimed).toBe(true);
    expect(again.claimed).toBe(false);
    expect(again.resumeRef).toBe(claimed.resumeRef);
    const running = recoverOguiDecisionResume(
      readDecisions(session.storePath, session.sessionKey) ?? {},
      session.sessionKey,
    );
    expect(running?.resumeRef).toBe(issued.resumeRef);
    expect(running?.resumeStatus).toBe("running");
    const historical = await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
    });
    expect(historical.kind).toBe("historical");
    expect(historical.decisionId).toBe(issued.decisionId);
    expect(Object.keys(readDecisions(session.storePath, session.sessionKey) ?? {})).toEqual([
      issued.decisionId,
    ]);
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("lets cancel and a new goal retire the old card (Ev5, Ev8)", async () => {
    const session = await seedSession();
    const bound = binding(session.storePath, session.sessionKey);
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
    });
    const cancelled = await admitOguiDecisionTurn({
      binding: bound,
      env: ENV_ON,
      inboundText: "取消",
      ingress: "chat",
      phase: "run",
    });
    expect(cancelled.action).toBe("ack");
    const stored = readDecisions(session.storePath, session.sessionKey)?.[issued.decisionId ?? ""];
    expect(stored?.decisionStatus).toBe("superseded");
    const late = await admitOguiDecisionTurn({
      binding: bound,
      env: ENV_ON,
      inboundText: answerText({
        decisionId: issued.decisionId ?? "",
        version: 1,
        value: "a",
        submissionId: "sub-late",
      }),
      ingress: "chat",
      phase: "run",
    });
    expect(late.action).toBe("ack");
    expect(late.action).not.toBe("resume");
    const again = await issueOguiDecisionFromText({
      text: `已签发\n${formText()}`,
      binding: bound,
      env: ENV_ON,
    });
    const gated = applyOguiPromiseCardGate(`已签发\n${formText()}`, again);
    expect(gated).not.toContain("ogui-form");
    expect(gated).toContain("不能重新操作");
    expect(gated).not.toContain("已签发");
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("supersedes the old card when the user starts a new goal", async () => {
    const session = await seedSession();
    const bound = binding(session.storePath, session.sessionKey);
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
    });
    const next = await admitOguiDecisionTurn({
      binding: bound,
      env: ENV_ON,
      inboundText: "开始新目标：改做周报",
      ingress: "chat",
      phase: "run",
    });
    expect(next.action).toBe("proceed");
    expect(
      readDecisions(session.storePath, session.sessionKey)?.[issued.decisionId ?? ""]
        ?.decisionStatus,
    ).toBe("superseded");
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("does not treat a legacy answer as a waiting-task resume", async () => {
    const session = await seedSession();
    const bound = binding(session.storePath, session.sessionKey);
    await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
    });
    const legacy = [
      "```ogui-answer",
      JSON.stringify({
        schema_version: "ogui/v1",
        component_id: "cmp-1",
        submission_id: "legacy-sub",
        answers: { choice: "a" },
      }),
      "```",
    ].join("\n");
    const paused = await admitOguiDecisionTurn({
      binding: bound,
      env: ENV_ON,
      inboundText: legacy,
      ingress: "chat",
      phase: "run",
    });
    expect(paused.action).toBe("pause");
    const idle = await admitOguiDecisionTurn({
      env: ENV_ON,
      cfg: bound.cfg,
      storePath: session.storePath,
      sessionKey: "other-session",
      inboundText: legacy,
      ingress: "chat",
      phase: "run",
    });
    expect(idle.action).toBe("proceed");
    fs.rmSync(session.dir, { recursive: true, force: true });
  });
});
