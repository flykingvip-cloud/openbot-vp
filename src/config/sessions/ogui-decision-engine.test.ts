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
  continueRecoveredOguiDecisionResume,
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
  answerMode?: "option" | "custom";
}): string {
  const payload = {
    schema_version: "ogui/v1",
    component_id: "cmp-1",
    submission_id: input.submissionId,
    decision_id: input.decisionId,
    decision_version: input.version,
    ...(input.answerMode ? { answer_mode: input.answerMode } : {}),
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
    const stored = Object.values(readDecisions(session.storePath, session.sessionKey) ?? {})[0];
    expect(stored?.decisionStatus).toBe("waiting");
    expect(stored?.resumeStatus).toBe("pending");
    expect(stored?.answer).toBeUndefined();
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
        component_id: "cmp-1",
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

  it("rejects an old card after the session task switches (D20)", async () => {
    const session = await seedSession();
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: { ...binding(session.storePath, session.sessionKey), taskContextId: "task_old" },
      env: ENV_ON,
    });
    expect(issued.kind).toBe("issued");
    await updateSessionStore(session.storePath, (store) => {
      const entry = store[session.sessionKey];
      if (entry) {
        entry.taskContextId = "task_new";
      }
    });
    const rejected = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        component_id: "cmp-1",
        submission_id: "sub-task-switch",
        decision_id: issued.decisionId,
        decision_version: 1,
        answers: { choice: "a" },
      },
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.reason).toBe("task_mismatch");
    }
    const stale = readDecisions(session.storePath, session.sessionKey)?.[issued.decisionId ?? ""];
    expect(stale?.decisionStatus).toBe("waiting");
    expect(stale?.answer).toBeUndefined();
    expect(stale?.scope.taskContextId).toBe("task_old");
    await updateSessionStore(session.storePath, (store) => {
      const entry = store[session.sessionKey];
      if (entry) {
        entry.taskContextId = "task_old";
      }
    });
    const accepted = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        component_id: "cmp-1",
        submission_id: "sub-task-same",
        decision_id: issued.decisionId,
        decision_version: 1,
        answers: { choice: "a" },
      },
    });
    expect(accepted.ok).toBe(true);
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("rejects a forged option and accepts an explicit custom answer (D18)", async () => {
    const session = await seedSession();
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: binding(session.storePath, session.sessionKey),
      env: ENV_ON,
    });
    const forged = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        component_id: "cmp-1",
        submission_id: "sub-forged",
        decision_id: issued.decisionId,
        decision_version: 1,
        answers: { choice: "not-an-option" },
      },
    });
    expect(forged.ok).toBe(false);
    if (!forged.ok) {
      expect(forged.reason).toBe("invalid_answer");
    }
    const untouched = readDecisions(session.storePath, session.sessionKey)?.[
      issued.decisionId ?? ""
    ];
    expect(untouched?.decisionStatus).toBe("waiting");
    expect(untouched?.answer).toBeUndefined();
    const many = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        component_id: "cmp-1",
        submission_id: "sub-many",
        decision_id: issued.decisionId,
        decision_version: 1,
        answers: { choice: "a", extra: "b" },
      },
    });
    expect(many.ok).toBe(false);
    const custom = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        component_id: "cmp-1",
        submission_id: "sub-custom",
        decision_id: issued.decisionId,
        decision_version: 1,
        answer_mode: "custom",
        answers: { choice: "我的口径" },
      },
    });
    expect(custom.ok).toBe(true);
    if (custom.ok) {
      expect(custom.answer.kind).toBe("custom");
      expect(custom.answer.value).toBe("我的口径");
    }
    const stored = readDecisions(session.storePath, session.sessionKey)?.[issued.decisionId ?? ""];
    expect(stored?.decisionStatus).toBe("answered");
    expect(stored?.answer?.kind).toBe("custom");
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("does not adopt a running resume while its owner pid is alive", async () => {
    const session = await seedSession();
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: binding(session.storePath, session.sessionKey),
      env: ENV_ON,
    });
    await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        component_id: "cmp-1",
        submission_id: "sub-live",
        decision_id: issued.decisionId,
        decision_version: 1,
        answers: { choice: "a" },
      },
    });
    const claimed = await claimOguiDecisionResume({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      decisionId: issued.decisionId ?? "",
      lifecycleEnabled: true,
    });
    expect(claimed.claimed).toBe(true);
    const continued = await continueRecoveredOguiDecisionResume({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      decisionId: issued.decisionId ?? "",
      lifecycleEnabled: true,
    });
    expect(continued.continued).toBe(false);
    expect(continued.reason).toBe("already_started");
    expect(continued.resumeRef).toBe(issued.resumeRef);
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
    const late = await admitOguiDecisionTurn({
      binding: bound,
      env: ENV_ON,
      inboundText: answerText({
        decisionId: issued.decisionId ?? "",
        version: 1,
        value: "a",
        submissionId: "sub-old-card",
      }),
      ingress: "chat",
      phase: "run",
    });
    expect(late.action).toBe("ack");
    expect(late.action).not.toBe("resume");
    expect(
      readDecisions(session.storePath, session.sessionKey)?.[issued.decisionId ?? ""]
        ?.decisionStatus,
    ).toBe("superseded");
    const again = await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
    });
    const gated = applyOguiPromiseCardGate(`已签发\n${formText()}`, again);
    expect(gated).not.toContain("ogui-form");
    expect(gated).not.toContain("decision_id");
    expect(gated).toContain("不能重新操作");
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

  it("lets a legacy answer submit when no decision is waiting (Ev1)", async () => {
    const session = await seedSession();
    const bound = binding(session.storePath, session.sessionKey);
    const legacy = [
      "```ogui-answer",
      JSON.stringify({
        schema_version: "ogui/v1",
        component_id: "cmp-1",
        submission_id: "legacy-ok",
        answers: { choice: "a" },
      }),
      "```",
    ].join("\n");
    const admission = await admitOguiDecisionTurn({
      binding: bound,
      env: ENV_ON,
      inboundText: legacy,
      ingress: "chat",
      phase: "run",
    });
    expect(admission.action).toBe("proceed");
    const consumed = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        schema_version: "ogui/v1",
        component_id: "cmp-1",
        submission_id: "legacy-ok",
        answers: { choice: "a" },
      },
    });
    expect(consumed.ok).toBe(false);
    if (!consumed.ok) {
      expect(consumed.reason).toBe("legacy");
    }
    expect(readDecisions(session.storePath, session.sessionKey)).toBeUndefined();
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("rejects consume when a lifecycle answer drops decision_id or decision_version (Ev2)", async () => {
    const session = await seedSession();
    const bound = binding(session.storePath, session.sessionKey);
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
    });
    const decisionId = issued.decisionId ?? "";
    const missingVersion = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        component_id: "cmp-1",
        submission_id: "sub-half-id",
        decision_id: decisionId,
        answers: { choice: "a" },
      },
    });
    const missingId = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        component_id: "cmp-1",
        submission_id: "sub-half-ver",
        decision_version: 1,
        answers: { choice: "a" },
      },
    });
    expect(missingVersion.ok).toBe(false);
    expect(missingId.ok).toBe(false);
    if (!missingVersion.ok && !missingId.ok) {
      expect(missingVersion.reason).toBe("missing_decision_version");
      expect(missingId.reason).toBe("missing_decision_id");
      expect(missingVersion.text).not.toContain("已签发");
      expect(missingId.text).not.toContain("已签发");
    }
    const halfFence = await admitOguiDecisionTurn({
      binding: bound,
      env: ENV_ON,
      inboundText: [
        "```ogui-answer",
        JSON.stringify({
          schema_version: "ogui/v1",
          component_id: "cmp-1",
          submission_id: "sub-half-fence",
          decision_id: decisionId,
          answers: { choice: "a" },
        }),
        "```",
      ].join("\n"),
      ingress: "chat",
      phase: "run",
    });
    expect(halfFence.action).toBe("ack");
    expect(halfFence.action).not.toBe("resume");
    const stored = readDecisions(session.storePath, session.sessionKey)?.[decisionId];
    expect(stored?.decisionStatus).toBe("waiting");
    expect(stored?.answer).toBeUndefined();
    expect(stored?.resumeStatus).toBe("pending");
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("accepts one concurrent same answer and conflicts a concurrent different answer (Ev3)", async () => {
    const same = await seedSession();
    const sameBound = binding(same.storePath, same.sessionKey);
    const sameIssued = await issueOguiDecisionFromText({
      text: formText(),
      binding: sameBound,
      env: ENV_ON,
    });
    const sameId = sameIssued.decisionId ?? "";
    const [firstSame, secondSame] = await Promise.all([
      consumeOguiDecisionAnswer({
        storePath: same.storePath,
        sessionKey: same.sessionKey,
        userId: "user-1",
        lifecycleEnabled: true,
        env: ENV_ON,
        answer: {
          component_id: "cmp-1",
          submission_id: "sub-concurrent-1",
          decision_id: sameId,
          decision_version: 1,
          answers: { choice: "a" },
        },
      }),
      consumeOguiDecisionAnswer({
        storePath: same.storePath,
        sessionKey: same.sessionKey,
        userId: "user-1",
        lifecycleEnabled: true,
        env: ENV_ON,
        answer: {
          component_id: "cmp-1",
          submission_id: "sub-concurrent-2",
          decision_id: sameId,
          decision_version: 1,
          answers: { choice: "a" },
        },
      }),
    ]);
    expect(firstSame.ok && secondSame.ok).toBe(true);
    if (firstSame.ok && secondSame.ok) {
      expect(firstSame.resumeRef).toBe(sameIssued.resumeRef);
      expect(secondSame.resumeRef).toBe(sameIssued.resumeRef);
      expect([firstSame.idempotent, secondSame.idempotent].filter((item) => !item)).toHaveLength(1);
    }
    const sameStored = readDecisions(same.storePath, same.sessionKey)?.[sameId];
    expect(sameStored?.answer?.submissionIds.toSorted()).toEqual([
      "sub-concurrent-1",
      "sub-concurrent-2",
    ]);
    expect(sameStored?.answer?.value).toBe("a");
    expect(sameStored?.resumeStatus).toBe("pending");
    expect(Object.keys(readDecisions(same.storePath, same.sessionKey) ?? {})).toEqual([sameId]);
    fs.rmSync(same.dir, { recursive: true, force: true });

    const diff = await seedSession();
    const diffBound = binding(diff.storePath, diff.sessionKey);
    const diffIssued = await issueOguiDecisionFromText({
      text: formText(),
      binding: diffBound,
      env: ENV_ON,
    });
    const diffId = diffIssued.decisionId ?? "";
    const raced = await Promise.all([
      consumeOguiDecisionAnswer({
        storePath: diff.storePath,
        sessionKey: diff.sessionKey,
        userId: "user-1",
        lifecycleEnabled: true,
        env: ENV_ON,
        answer: {
          component_id: "cmp-1",
          submission_id: "sub-race-a",
          decision_id: diffId,
          decision_version: 1,
          answers: { choice: "a" },
        },
      }),
      consumeOguiDecisionAnswer({
        storePath: diff.storePath,
        sessionKey: diff.sessionKey,
        userId: "user-1",
        lifecycleEnabled: true,
        env: ENV_ON,
        answer: {
          component_id: "cmp-1",
          submission_id: "sub-race-b",
          decision_id: diffId,
          decision_version: 1,
          answers: { choice: "b" },
        },
      }),
    ]);
    const accepted = raced.filter((item) => item.ok);
    const conflicts = raced.filter((item) => !item.ok);
    expect(accepted).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    const winner = accepted[0];
    const loser = conflicts[0];
    expect(winner?.ok).toBe(true);
    if (winner?.ok && loser && !loser.ok) {
      expect(winner.resumeRef).toBe(diffIssued.resumeRef);
      expect(loser.reason).toBe("conflict");
      expect(loser.resumeRef).toBe(diffIssued.resumeRef);
      const stored = readDecisions(diff.storePath, diff.sessionKey)?.[diffId];
      expect(stored?.answer?.value).toBe(winner.answer.value);
      expect(stored?.decisionStatus).toBe("answered");
      expect(stored?.resumeStatus).toBe("pending");
      expect(Object.keys(readDecisions(diff.storePath, diff.sessionKey) ?? {})).toEqual([diffId]);
    }
    fs.rmSync(diff.dir, { recursive: true, force: true });
  });

  it("reloads the same resumeRef after a process exit before and after claim (Ev4)", async () => {
    const session = await seedSession();
    const bound = binding(session.storePath, session.sessionKey);
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
    });
    const decisionId = issued.decisionId ?? "";
    await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        component_id: "cmp-1",
        submission_id: "sub-exit",
        decision_id: decisionId,
        decision_version: 1,
        answers: { choice: "a" },
      },
    });
    clearOguiWaitRegistryForTests();
    const afterConsume = readDecisions(session.storePath, session.sessionKey) ?? {};
    const pending = recoverOguiDecisionResume(afterConsume, session.sessionKey);
    expect(pending?.resumeRef).toBe(issued.resumeRef);
    expect(pending?.resumeStatus).toBe("pending");
    expect(Object.keys(afterConsume)).toEqual([decisionId]);

    await expect(
      claimOguiDecisionResume({
        storePath: session.storePath,
        sessionKey: session.sessionKey,
        decisionId,
        lifecycleEnabled: true,
        updateStore: async (storePath, mutator) => {
          await updateSessionStore(storePath, mutator);
          throw new Error("exit after start persisted");
        },
      }),
    ).rejects.toThrow(/exit after start persisted/);

    clearOguiWaitRegistryForTests();
    const afterStart = readDecisions(session.storePath, session.sessionKey) ?? {};
    const running = recoverOguiDecisionResume(afterStart, session.sessionKey);
    expect(running?.resumeRef).toBe(issued.resumeRef);
    expect(running?.resumeStatus).toBe("running");
    const second = await claimOguiDecisionResume({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      decisionId,
      lifecycleEnabled: true,
    });
    expect(second.claimed).toBe(false);
    expect(second.reason).toBe("already_started");
    expect(second.resumeRef).toBe(issued.resumeRef);
    const replay = await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
    });
    expect(replay.kind).toBe("historical");
    expect(replay.decisionId).toBe(decisionId);
    expect(Object.keys(readDecisions(session.storePath, session.sessionKey) ?? {})).toEqual([
      decisionId,
    ]);
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("does not make an expired or consumed fence operable again (Ev8)", async () => {
    const session = await seedSession();
    const bound = binding(session.storePath, session.sessionKey);
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
    });
    const decisionId = issued.decisionId ?? "";
    await updateSessionStore(session.storePath, (store) => {
      const record = store[session.sessionKey]?.oguiDecisions?.[decisionId];
      if (record) {
        record.decisionStatus = "expired";
      }
    });
    const expiredIssue = await issueOguiDecisionFromText({
      text: `已签发\n${formText()}`,
      binding: bound,
      env: ENV_ON,
    });
    const expiredGate = applyOguiPromiseCardGate(`已签发\n${formText()}`, expiredIssue);
    expect(expiredIssue.kind).toBe("historical");
    expect(expiredGate).not.toContain("ogui-form");
    expect(expiredGate).not.toContain("decision_id");
    expect(expiredGate).toContain("不能重新操作");
    expect(expiredGate).not.toContain("已签发");
    const expiredConsume = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        component_id: "cmp-1",
        submission_id: "sub-expired",
        decision_id: decisionId,
        decision_version: 1,
        answers: { choice: "b" },
      },
    });
    expect(expiredConsume.ok).toBe(false);
    if (!expiredConsume.ok) {
      expect(expiredConsume.reason).toBe("historical");
    }
    expect(readDecisions(session.storePath, session.sessionKey)?.[decisionId]?.decisionStatus).toBe(
      "expired",
    );
    expect(
      readDecisions(session.storePath, session.sessionKey)?.[decisionId]?.answer,
    ).toBeUndefined();

    const consumed = await seedSession();
    const consumedBound = binding(consumed.storePath, consumed.sessionKey);
    const consumedIssued = await issueOguiDecisionFromText({
      text: formText(),
      binding: consumedBound,
      env: ENV_ON,
    });
    const consumedId = consumedIssued.decisionId ?? "";
    const accepted = await consumeOguiDecisionAnswer({
      storePath: consumed.storePath,
      sessionKey: consumed.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        component_id: "cmp-1",
        submission_id: "sub-consumed",
        decision_id: consumedId,
        decision_version: 1,
        answers: { choice: "a" },
      },
    });
    expect(accepted.ok).toBe(true);
    const replay = await issueOguiDecisionFromText({
      text: formText(),
      binding: consumedBound,
      env: ENV_ON,
    });
    const replayGate = applyOguiPromiseCardGate(formText(), replay);
    expect(replay.kind).toBe("historical");
    expect(replay.decisionId).toBe(consumedId);
    expect(replayGate).not.toContain("ogui-form");
    expect(replayGate).not.toContain('"decision_id"');
    expect(replayGate).toContain("不能重新操作");
    fs.rmSync(session.dir, { recursive: true, force: true });
    fs.rmSync(consumed.dir, { recursive: true, force: true });
  });

  it("does not issue discussion, a quote, or an unexecuted plan (Ev9)", async () => {
    const session = await seedSession();
    const bound = binding(session.storePath, session.sessionKey);
    const discussion = "我们只是讨论一下口径，还没定。下一步计划是先看数据，尚未执行。";
    const discussed = await applyOguiDecisionToVisibleText({
      text: discussion,
      binding: bound,
      env: ENV_ON,
    });
    expect(discussed.text).toBe(discussion);
    expect(discussed.oguiWaitActive).toBe(false);
    const quoted = `例如：\n> ${formText()}`;
    const quote = await applyOguiDecisionToVisibleText({
      text: quoted,
      binding: bound,
      env: ENV_ON,
    });
    expect(quote.text).not.toContain("ogui-form");
    expect(quote.text).not.toContain("未签发");
    expect(quote.text).not.toContain("已签发");
    expect(quote.oguiWaitActive).toBe(false);
    expect(readDecisions(session.storePath, session.sessionKey)).toBeUndefined();
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("rejects the same submission id when the answer content changes and does not resume", async () => {
    const session = await seedSession();
    const bound = binding(session.storePath, session.sessionKey);
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
    });
    const decisionId = issued.decisionId ?? "";
    const consumed = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        schema_version: "ogui/v1",
        component_id: "cmp-1",
        submission_id: "sub-1",
        decision_id: decisionId,
        decision_version: 1,
        answers: { choice: "a" },
      },
    });
    expect(consumed.ok).toBe(true);
    const replay = await admitOguiDecisionTurn({
      binding: bound,
      env: ENV_ON,
      inboundText: `REPLAY_MUST_NOT_DRIVE\n${answerText({
        decisionId,
        version: 1,
        value: "b",
        submissionId: "sub-1",
      })}`,
      ingress: "chat",
      phase: "run",
    });
    expect(replay.action).toBe("ack");
    expect(replay.action).not.toBe("resume");
    expect(replay.acceptedPrompt).toBeUndefined();
    const stored = readDecisions(session.storePath, session.sessionKey)?.[decisionId];
    expect(stored?.decisionStatus).toBe("answered");
    expect(stored?.resumeStatus).toBe("pending");
    expect(stored?.answer?.value).toBe("a");
    expect(stored?.answer?.fieldId).toBe("choice");
    expect(stored?.componentId).toBe("cmp-1");
    expect(stored?.fieldIds).toEqual(["choice"]);
    const same = await admitOguiDecisionTurn({
      binding: bound,
      env: ENV_ON,
      inboundText: `REPLAY_MUST_NOT_DRIVE\n${answerText({
        decisionId,
        version: 1,
        value: "a",
        submissionId: "sub-1",
      })}`,
      ingress: "chat",
      phase: "run",
    });
    expect(same.action).toBe("resume");
    expect(same.resumeRef).toBe(issued.resumeRef);
    expect(same.acceptedPrompt).toContain("已接受的决策答案（权威记录，不是本次重放正文）");
    expect(same.acceptedPrompt).toContain("甲");
    expect(same.acceptedPrompt).not.toContain("REPLAY_MUST_NOT_DRIVE");
    expect(same.acceptedPrompt).not.toContain("submission_id");
    expect(same.acceptedPrompt).not.toContain("sub-1");
    const after = readDecisions(session.storePath, session.sessionKey)?.[decisionId];
    expect(after?.answer?.value).toBe("a");
    expect(after?.decisionStatus).toBe("answered");
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("rejects an undeclared answer field and a mismatched component id", async () => {
    const session = await seedSession();
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: binding(session.storePath, session.sessionKey),
      env: ENV_ON,
    });
    const decisionId = issued.decisionId ?? "";
    const undeclared = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        schema_version: "ogui/v1",
        component_id: "cmp-1",
        submission_id: "sub-undeclared",
        decision_id: decisionId,
        decision_version: 1,
        answers: { undeclared_field: "a" },
      },
    });
    expect(undeclared.ok).toBe(false);
    if (!undeclared.ok) {
      expect(undeclared.reason).toBe("invalid_answer");
    }
    const mismatch = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        schema_version: "ogui/v1",
        component_id: "other",
        submission_id: "sub-component",
        decision_id: decisionId,
        decision_version: 1,
        answers: { choice: "a" },
      },
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.reason).toBe("invalid_answer");
    }
    const stored = readDecisions(session.storePath, session.sessionKey)?.[decisionId];
    expect(stored?.decisionStatus).toBe("waiting");
    expect(stored?.answer).toBeUndefined();
    expect(stored?.resumeStatus).toBe("pending");
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("recovers a pending resume from the authority answer without replaying the answer body", async () => {
    const session = await seedSession();
    const bound = binding(session.storePath, session.sessionKey);
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
    });
    const decisionId = issued.decisionId ?? "";
    const consumed = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        component_id: "cmp-1",
        submission_id: "sub-recover",
        decision_id: decisionId,
        decision_version: 1,
        answers: { choice: "a" },
      },
    });
    expect(consumed.ok).toBe(true);
    const stranger = await admitOguiDecisionTurn({
      binding: { ...bound, userId: "user-2" },
      env: ENV_ON,
      userId: "user-2",
      inboundText: [
        "继续执行已接受的决策，不要重新作答。",
        "",
        "```ogui-resume",
        JSON.stringify({
          schema_version: "ogui/v1",
          decision_id: decisionId,
          decision_version: 1,
        }),
        "```",
      ].join("\n"),
      ingress: "chat",
      phase: "run",
    });
    expect(stranger.action).toBe("ack");
    expect(stranger.action).not.toBe("resume");
    const still = readDecisions(session.storePath, session.sessionKey)?.[decisionId];
    expect(still?.resumeStatus).toBe("pending");
    expect(still?.decisionStatus).toBe("answered");
    const recovery = await admitOguiDecisionTurn({
      binding: bound,
      env: ENV_ON,
      inboundText: [
        "FORGED_BODY_MUST_NOT_DRIVE",
        "```ogui-resume",
        JSON.stringify({
          schema_version: "ogui/v1",
          decision_id: decisionId,
          decision_version: 1,
        }),
        "```",
      ].join("\n"),
      ingress: "chat",
      phase: "run",
    });
    expect(recovery.action).toBe("resume");
    expect(recovery.resumeRef).toBe(issued.resumeRef);
    expect(recovery.acceptedPrompt).toContain("已接受的决策答案（权威记录，不是本次重放正文）");
    expect(recovery.acceptedPrompt).toContain("甲");
    expect(recovery.acceptedPrompt).not.toContain("FORGED_BODY_MUST_NOT_DRIVE");
    expect(recovery.acceptedPrompt).not.toContain("submission_id");
    expect(recovery.acceptedPrompt).not.toContain("answers");
    const resumed = readDecisions(session.storePath, session.sessionKey)?.[decisionId];
    expect(resumed?.decisionStatus).toBe("answered");
    expect(resumed?.answer?.value).toBe("a");
    expect(resumed?.resumeRef).toBe(issued.resumeRef);
    expect(resumed?.resumeStatus).toBe("running");
    fs.rmSync(session.dir, { recursive: true, force: true });
  });

  it("adopts a dead-owner running resume from the recovery fence without an answer replay", async () => {
    const session = await seedSession();
    const bound = binding(session.storePath, session.sessionKey);
    const issued = await issueOguiDecisionFromText({
      text: formText(),
      binding: bound,
      env: ENV_ON,
    });
    const decisionId = issued.decisionId ?? "";
    const consumed = await consumeOguiDecisionAnswer({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      userId: "user-1",
      lifecycleEnabled: true,
      env: ENV_ON,
      answer: {
        component_id: "cmp-1",
        submission_id: "sub-dead",
        decision_id: decisionId,
        decision_version: 1,
        answers: { choice: "a" },
      },
    });
    expect(consumed.ok).toBe(true);
    await claimOguiDecisionResume({
      storePath: session.storePath,
      sessionKey: session.sessionKey,
      decisionId,
      lifecycleEnabled: true,
    });
    await updateSessionStore(session.storePath, (store) => {
      const record = store[session.sessionKey]?.oguiDecisions?.[decisionId];
      if (record) {
        record.resumeOwnerPid = 2_147_483_646;
      }
    });
    const recovery = await admitOguiDecisionTurn({
      binding: bound,
      env: ENV_ON,
      inboundText: [
        "```ogui-resume",
        JSON.stringify({
          schema_version: "ogui/v1",
          decision_id: decisionId,
          decision_version: 1,
        }),
        "```",
      ].join("\n"),
      ingress: "chat",
      phase: "run",
    });
    expect(recovery.action).toBe("resume");
    expect(recovery.resumeRef).toBe(issued.resumeRef);
    expect(recovery.acceptedPrompt).toContain("甲");
    expect(recovery.acceptedPrompt).not.toContain("sub-dead");
    const stored = readDecisions(session.storePath, session.sessionKey)?.[decisionId];
    expect(stored?.decisionStatus).toBe("answered");
    expect(stored?.answer?.value).toBe("a");
    expect(stored?.resumeRef).toBe(issued.resumeRef);
    expect(stored?.resumeStatus).toBe("running");
    expect(stored?.resumeOwnerPid).toBe(process.pid);
    fs.rmSync(session.dir, { recursive: true, force: true });
  });
});
