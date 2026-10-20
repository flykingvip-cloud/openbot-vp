import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  armCompletionHold,
  buildExecutionPreflight,
  readExecutionTraces,
  resetCompletionHoldsForTest,
  resetDeliveryArtifactsForTest,
  resetExecutionTraceForTest,
  resetValidationStateForTest,
} from "../agents/execution-preflight/index.js";
import { PROGRESS_LEDGER_ENABLED_ENV } from "../progress-ledger/feature.js";
import * as ledgerFeature from "../progress-ledger/feature.js";
import { createFileLedgerStore } from "../progress-ledger/store.js";
import { CONVERSATION_TASK_ENV } from "./feature.js";
import {
  CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV,
  conversationTaskLedgerId,
  ensureConversationTaskLedgerSeeded,
  observeConversationToolEvent,
} from "./ledger-binding.js";
import {
  CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV,
  observeConversationTaskReplyCompleted,
  readConversationTaskDeliveryCloseConsults,
  resetConversationTaskDeliveryCloseConsultsForTest,
} from "./reply-completion.js";
import * as runtimeBootstrap from "./runtime-bootstrap.js";
import { openTaskStore } from "./store.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-reply-completion-"));
  vi.spyOn(runtimeBootstrap, "defaultShadowStoreRoot").mockReturnValue(root);
  process.env[CONVERSATION_TASK_ENV.activation] = "1";
  process.env[PROGRESS_LEDGER_ENABLED_ENV] = "1";
  // Legacy alignment close. Evidence-required is the product default; these
  // tests opt out unless a nested case turns it back on.
  process.env[CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV] = "0";
});

afterEach(() => {
  delete process.env[CONVERSATION_TASK_ENV.activation];
  delete process.env[PROGRESS_LEDGER_ENABLED_ENV];
  delete process.env[CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV];
  delete process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV];
  resetConversationTaskDeliveryCloseConsultsForTest();
  resetCompletionHoldsForTest();
  resetDeliveryArtifactsForTest();
  resetExecutionTraceForTest();
  resetValidationStateForTest();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

const blockingSkill = {
  name: "sample-primary",
  frontmatter: {
    aliases: "sample-alias",
    "primary-engine": "sample-engine",
    "forbidden-final-engines": "legacy-engine",
    "required-artifacts": "output.bin",
    "required-validators": "sample-validator",
    "delivery-blocked-until": "validator_passed",
    triggers: "sample-task",
    "allowed-tools": "read,write,edit,message,sessions_send",
    "generation-stage-tools": "write,edit",
    "delivery-stage-tools": "message,sessions_send",
  },
};

async function seedActiveTask(goal: string, sourceMessageId: string) {
  const store = openTaskStore({ tenantId: "local", storeRoot: root });
  const { task } = store.createTaskIfAbsent({
    conversationId: "agent:main:main",
    goal,
    activationEpoch: 1,
    requesterId: "user-1",
    ownerId: "user-1",
    sourceMessageId,
  });
  await ensureConversationTaskLedgerSeeded({ task, cronStorePath: path.join(root, "cron.json") });
  store.close();
  return task;
}

function armBlockingHold(taskId: string) {
  const preflight = buildExecutionPreflight({
    taskId,
    sessionId: "session-fc02",
    message: "run sample-task",
    skills: [blockingSkill],
    policyToolNames: ["read", "write", "edit", "message", "sessions_send"],
    qualify: () => ({ kind: "short_action", reasons: ["test"] }),
  });
  armCompletionHold({
    keys: ["agent:main:main"],
    preflight,
  });
  resetExecutionTraceForTest();
  return preflight;
}

async function expectLifecycle(taskId: number, lifecycle: "active" | "closed") {
  await vi.waitFor(() => {
    const reopened = openTaskStore({ tenantId: "local", storeRoot: root });
    try {
      expect(reopened.getTaskById(taskId)?.lifecycle).toBe(lifecycle);
    } finally {
      reopened.close();
    }
  });
}

describe("observeConversationTaskReplyCompleted", () => {
  it("closes a matching active task after a successful reply", async () => {
    const store = openTaskStore({ tenantId: "local", storeRoot: root });
    const goal = "分三步完成竞品监控";
    const { task } = store.createTaskIfAbsent({
      conversationId: "agent:main:main",
      goal,
      activationEpoch: 1,
      requesterId: "user-1",
      ownerId: "user-1",
      sourceMessageId: "m-user-1",
    });
    await ensureConversationTaskLedgerSeeded({ task, cronStorePath: path.join(root, "cron.json") });
    store.close();

    void observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "user-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-user-1",
      text: goal,
      cronStorePath: path.join(root, "cron.json"),
    });

    await vi.waitFor(() => {
      const reopened = openTaskStore({ tenantId: "local", storeRoot: root });
      try {
        expect(reopened.findActiveTasksByConversation("agent:main:main")).toHaveLength(0);
        const closed = reopened.getTaskById(task.id);
        expect(closed?.lifecycle).toBe("closed");
      } finally {
        reopened.close();
      }
    });
  });

  it("does not close when assistant reply drifts from task goal", async () => {
    const store = openTaskStore({ tenantId: "local", storeRoot: root });
    const goal = "抓取 361 飞然 4.5 在京东与淘宝的价格并生成比价表";
    const { task } = store.createTaskIfAbsent({
      conversationId: "agent:main:main",
      goal,
      activationEpoch: 1,
      requesterId: "user-1",
      ownerId: "user-1",
      sourceMessageId: "m-user-drift",
    });
    await ensureConversationTaskLedgerSeeded({ task, cronStorePath: path.join(root, "cron.json") });
    store.close();

    void observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "user-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-user-drift",
      text: goal,
      assistantReplyText: "我检索了知识库中关于中医诊断学的笔记，没有找到完整的望闻问切章节摘要。",
      cronStorePath: path.join(root, "cron.json"),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const reopened = openTaskStore({ tenantId: "local", storeRoot: root });
    try {
      expect(reopened.findActiveTasksByConversation("agent:main:main")).toHaveLength(1);
      expect(reopened.getTaskById(task.id)?.lifecycle).toBe("active");
    } finally {
      reopened.close();
    }
  });

  it("no-ops when activation is disabled", async () => {
    delete process.env[CONVERSATION_TASK_ENV.activation];
    const store = openTaskStore({ tenantId: "local", storeRoot: root });
    const { task } = store.createTaskIfAbsent({
      conversationId: "agent:main:main",
      goal: "监控任务",
      activationEpoch: 1,
      requesterId: "user-1",
      sourceMessageId: "m-user-2",
    });
    store.close();

    void observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "user-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-user-2",
      text: "监控任务",
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    const reopened = openTaskStore({ tenantId: "local", storeRoot: root });
    try {
      expect(reopened.getTaskById(task.id)?.lifecycle).toBe("active");
    } finally {
      reopened.close();
    }
  });
});

describe("delivery close consult", () => {
  const goal = "分三步完成竞品监控";

  it("keeps today's close when the consult flag is off, even if delivery would block a claim", async () => {
    const task = await seedActiveTask(goal, "m-fc02-off");
    const preflight = armBlockingHold("preflight-fc02-off");

    void observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "user-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-fc02-off",
      text: goal,
      assistantReplyText: "任务已完成",
      cronStorePath: path.join(root, "cron.json"),
    });

    await expectLifecycle(task.id, "closed");
    expect(readConversationTaskDeliveryCloseConsults()).toEqual([]);
    expect(readExecutionTraces(preflight.taskId)).toEqual([]);
  });

  it("records an observe consult when the flag is on and still closes", async () => {
    process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV] = "1";
    const task = await seedActiveTask(goal, "m-fc02-on");
    const preflight = armBlockingHold("preflight-fc02-on");

    void observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "user-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-fc02-on",
      text: goal,
      assistantReplyText: "任务已完成",
      cronStorePath: path.join(root, "cron.json"),
    });

    await expectLifecycle(task.id, "closed");
    expect(readConversationTaskDeliveryCloseConsults()).toEqual([
      expect.objectContaining({
        conversationTaskId: String(task.id),
        sessionKey: "agent:main:main",
        mode: "observe",
        closeDeferred: false,
        hasDeliveryContext: true,
        sessionHoldAmbiguous: false,
        completionClaimBlocked: true,
        deliveryBlocksCompletionClaims: true,
        holds: [
          expect.objectContaining({
            preflightTaskId: preflight.taskId,
            outcome: "completion_blocked",
            decisionCode: "completion_claim_blocked_pending_validation",
            latestReceiptResult: "absent",
          }),
        ],
      }),
    ]);
    expect(readExecutionTraces(preflight.taskId)).toEqual([]);
  });

  it("records a no-hold observe consult and still closes", async () => {
    process.env[CONVERSATION_TASK_DELIVERY_CLOSE_CONSULT_ENV] = "on";
    const task = await seedActiveTask(goal, "m-fc02-empty");

    void observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "user-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-fc02-empty",
      text: goal,
      cronStorePath: path.join(root, "cron.json"),
    });

    await expectLifecycle(task.id, "closed");
    expect(readConversationTaskDeliveryCloseConsults()).toEqual([
      expect.objectContaining({
        conversationTaskId: String(task.id),
        mode: "observe",
        closeDeferred: false,
        hasDeliveryContext: false,
        completionClaimBlocked: false,
        deliveryBlocksCompletionClaims: false,
        holds: [],
      }),
    ]);
  });
});

async function recordTool(task: { id: number }, name = "write", isError = false) {
  await observeConversationToolEvent({
    task: task as never,
    cronStorePath: path.join(root, "cron.json"),
    env: process.env,
    readConfig: () => false,
    evt: {
      stream: "tool",
      data: {
        phase: "result",
        name,
        isError,
        text: "SECRET_ASSISTANT_TEXT",
      },
    },
  });
}

async function acceptanceStatus(taskId: number) {
  const ledger = await createFileLedgerStore({
    cronStorePath: path.join(root, "cron.json"),
    taskId: conversationTaskLedgerId({ id: taskId }),
  }).loadEvents();
  return JSON.stringify(ledger);
}

describe("evidence required to close", () => {
  const goal = "分三步完成竞品监控并写出价格对照";

  beforeEach(() => {
    process.env[CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV] = "1";
  });

  it("does not close on aligned text alone", async () => {
    const task = await seedActiveTask(goal, "m-align-only");
    void observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "user-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-align-only",
      text: goal,
      assistantReplyText: `${goal}。价格表已经写好并核对了三家店铺的结果。`,
      cronStorePath: path.join(root, "cron.json"),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expectLifecycle(task.id, "active");
    const raw = await acceptanceStatus(task.id);
    expect(raw).not.toContain("ACCEPTANCE_MET");
    expect(raw).not.toContain("conversation_reply");
  });

  it("does not close on an empty assistant reply even when a tool passed", async () => {
    const task = await seedActiveTask(goal, "m-empty");
    await recordTool(task);
    void observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "user-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-empty",
      text: goal,
      cronStorePath: path.join(root, "cron.json"),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expectLifecycle(task.id, "active");
    expect(await acceptanceStatus(task.id)).not.toContain("ACCEPTANCE_MET");
  });

  it("does not close when alignment vetoes, even with passed tool evidence", async () => {
    const commerce = "抓取 361 飞然 4.5 在京东与淘宝的价格并生成比价表";
    const task = await seedActiveTask(commerce, "m-veto");
    await recordTool(task);
    void observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "user-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-veto",
      text: commerce,
      assistantReplyText: "我检索了知识库中关于中医诊断学的笔记，没有找到完整的望闻问切章节摘要。",
      cronStorePath: path.join(root, "cron.json"),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expectLifecycle(task.id, "active");
    expect(await acceptanceStatus(task.id)).not.toContain("ACCEPTANCE_MET");
  });

  it("closes only after a passed tool_result when alignment does not veto", async () => {
    const task = await seedActiveTask(goal, "m-tool-close");
    await recordTool(task);
    void observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "user-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-tool-close",
      text: goal,
      assistantReplyText: `${goal}。价格表已经写好并核对了三家店铺的结果。`,
      cronStorePath: path.join(root, "cron.json"),
    });
    await expectLifecycle(task.id, "closed");
    const raw = await acceptanceStatus(task.id);
    expect(raw).toContain("ACCEPTANCE_MET");
    expect(raw).toContain("tool_result");
    expect(raw).not.toContain("conversation_reply");
    expect(raw).not.toContain("SECRET_ASSISTANT_TEXT");
  });

  it("does not close on text alone when the ledger flag is unset", async () => {
    delete process.env[PROGRESS_LEDGER_ENABLED_ENV];
    delete process.env[CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV];
    vi.spyOn(ledgerFeature, "isProgressLedgerEnabled").mockReturnValue(false);
    const task = await seedActiveTask(goal, "m-ledger-off");
    void observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "user-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-ledger-off",
      text: goal,
      assistantReplyText: `${goal}。价格表已经写好并核对了三家店铺的结果。`,
      cronStorePath: path.join(root, "cron.json"),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expectLifecycle(task.id, "active");
  });

  it("closes on a passed tool_result when close and ledger flags are unset", async () => {
    delete process.env[PROGRESS_LEDGER_ENABLED_ENV];
    delete process.env[CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV];
    vi.spyOn(ledgerFeature, "isProgressLedgerEnabled").mockReturnValue(false);
    const task = await seedActiveTask(goal, "m-default-close");
    await recordTool(task);
    void observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "user-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-default-close",
      text: goal,
      assistantReplyText: `${goal}。价格表已经写好并核对了三家店铺的结果。`,
      cronStorePath: path.join(root, "cron.json"),
    });
    await expectLifecycle(task.id, "closed");
    const raw = await acceptanceStatus(task.id);
    expect(raw).toContain("tool_result");
    expect(raw).not.toContain("conversation_reply");
  });
});

describe("session task completion notice", () => {
  it("tells the user after a real reply close and lists parked tasks", async () => {
    const store = openTaskStore({ tenantId: "local", storeRoot: root });
    const goal = "分三步完成竞品监控";
    const { task } = store.createTaskIfAbsent({
      conversationId: "agent:main:main",
      goal,
      activationEpoch: 1,
      requesterId: "user-1",
      ownerId: "user-1",
      sourceMessageId: "m-notice",
    });
    await ensureConversationTaskLedgerSeeded({ task, cronStorePath: path.join(root, "cron.json") });
    store.close();
    const sessionFile = path.join(root, "session.jsonl");
    fs.writeFileSync(sessionFile, "", "utf8");
    const { writeSessionTaskBoard, readSessionTaskBoard } = await import("./session-task-board.js");
    writeSessionTaskBoard(sessionFile, {
      current: {
        taskId: "live",
        title: "竞品监控",
        goalText: goal,
        unfinished: true,
        stop: { summary: "未完成：竞品监控", workspacePaths: [] },
        createdAtMs: 1,
      },
      parked: [
        {
          taskId: "parked-1",
          title: "价格表",
          goalText: "价格表",
          unfinished: true,
          stop: { summary: "写到第二节", workspacePaths: ["/tmp/price.md"] },
          parkedAtMs: Date.parse("2026-10-03T02:00:00Z"),
          createdAtMs: 1,
        },
      ],
    });
    const notice = await observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "user-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-notice",
      text: goal,
      cronStorePath: path.join(root, "cron.json"),
      sessionFile,
    });
    expect(notice).toContain("当前任务已完成，交付已核对。");
    expect(notice).toContain("价格表");
    expect(notice).toContain("写到第二节");
    expect(notice).toContain("/tmp/price.md");
    expect(notice).toContain("继续挂起 parked-1");
    expect(notice).toContain("取消挂起 parked-1");
    expect(fs.readFileSync(sessionFile, "utf8")).toContain("当前任务已完成，交付已核对。");
    expect(readSessionTaskBoard(sessionFile).current?.deliverableChecked).toBe(true);
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(false);
  });

  it("does not announce when the reply is only a drifted claim", async () => {
    const store = openTaskStore({ tenantId: "local", storeRoot: root });
    const goal = "抓取 361 飞然 4.5 在京东与淘宝的价格并生成比价表";
    store.createTaskIfAbsent({
      conversationId: "agent:main:main",
      goal,
      activationEpoch: 1,
      requesterId: "user-1",
      ownerId: "user-1",
      sourceMessageId: "m-claim",
    });
    store.close();
    const sessionFile = path.join(root, "claim.jsonl");
    fs.writeFileSync(sessionFile, "keep\n", "utf8");
    const notice = await observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "user-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-claim",
      text: goal,
      assistantReplyText: "我检索了知识库中关于中医诊断学的笔记，没有找到完整的望闻问切章节摘要。",
      cronStorePath: path.join(root, "cron.json"),
      sessionFile,
    });
    expect(notice).toBeUndefined();
    expect(fs.readFileSync(sessionFile, "utf8")).toBe("keep\n");
  });
});
