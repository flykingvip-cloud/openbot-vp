import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROGRESS_LEDGER_ENABLED_ENV } from "../progress-ledger/feature.js";
import { resolveRequiredDeliveryConfirmStatus } from "../task-outcome/delivery-confirm.js";
import { CONVERSATION_TASK_ENV } from "./feature.js";
import {
  CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV,
  ensureConversationTaskLedgerSeeded,
  observeConversationToolEvent,
} from "./ledger-binding.js";
import * as ledgerBinding from "./ledger-binding.js";
import { observeConversationTaskReplyCompleted } from "./reply-completion.js";
import * as runtimeBootstrap from "./runtime-bootstrap.js";
import {
  readSessionTaskBoard,
  seedSessionTaskBoard,
  type TaskCompletionBinding,
} from "./session-task-board.js";
import * as sessionTaskBoard from "./session-task-board.js";
import { openTaskStore, type StoredConversationTask } from "./store.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-reply-window-"));
  vi.spyOn(runtimeBootstrap, "defaultShadowStoreRoot").mockReturnValue(root);
  process.env[CONVERSATION_TASK_ENV.activation] = "1";
  process.env[PROGRESS_LEDGER_ENABLED_ENV] = "1";
  process.env[CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV] = "0";
});

afterEach(() => {
  delete process.env[CONVERSATION_TASK_ENV.activation];
  delete process.env[PROGRESS_LEDGER_ENABLED_ENV];
  delete process.env[CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV];
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

const GOAL = "分三步完成竞品监控";

async function seedActiveTask(sourceMessageId: string): Promise<StoredConversationTask> {
  const store = openTaskStore({ tenantId: "local", storeRoot: root });
  const { task } = store.createTaskIfAbsent({
    conversationId: "agent:main:main",
    goal: GOAL,
    activationEpoch: 1,
    requesterId: "user-1",
    ownerId: "user-1",
    sourceMessageId,
  });
  await ensureConversationTaskLedgerSeeded({ task, cronStorePath: path.join(root, "cron.json") });
  store.close();
  return task;
}

function seedBoard(sessionFile: string, currentOverrides: Record<string, unknown> = {}) {
  fs.writeFileSync(sessionFile, "", "utf8");
  seedSessionTaskBoard(sessionFile, {
    current: {
      taskId: "live",
      title: "竞品监控",
      goalText: GOAL,
      unfinished: true,
      stop: { summary: "未完成：竞品监控", workspacePaths: [] },
      createdAtMs: 1,
      executionAttempt: "run-1",
      deliverableVersion: "draft-1",
      ...currentOverrides,
    },
    parked: [],
    focusRevision: 0,
  });
}

function binding(overrides: Partial<TaskCompletionBinding> = {}): TaskCompletionBinding {
  return {
    taskId: "live",
    executionAttempt: "run-1",
    deliverableVersion: "draft-1",
    constraints: [],
    ...overrides,
  };
}

async function lifecycleOf(taskId: number) {
  const reopened = openTaskStore({ tenantId: "local", storeRoot: root });
  try {
    return reopened.getTaskById(taskId)?.lifecycle;
  } finally {
    reopened.close();
  }
}

async function complete(params: {
  sourceMessageId: string;
  sessionFile?: string;
  completionBinding?: TaskCompletionBinding;
  assistantReplyText?: string;
}) {
  return observeConversationTaskReplyCompleted({
    tenantId: "local",
    requesterId: "user-1",
    conversationId: "agent:main:main",
    sourceMessageId: params.sourceMessageId,
    text: GOAL,
    cronStorePath: path.join(root, "cron.json"),
    sessionFile: params.sessionFile,
    completionBinding: params.completionBinding,
    assistantReplyText: params.assistantReplyText,
  });
}

describe("reply completion partial-success window", () => {
  it("does not close the conversation task or announce success when the binding mismatches", async () => {
    const task = await seedActiveTask("m-mismatch");
    const sessionFile = path.join(root, "mismatch.jsonl");
    seedBoard(sessionFile, { taskId: "other-task" });
    const notice = await complete({
      sourceMessageId: "m-mismatch",
      sessionFile,
      completionBinding: binding(),
    });
    expect(notice).toBeUndefined();
    expect(await lifecycleOf(task.id)).toBe("active");
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);
    expect(readSessionTaskBoard(sessionFile).current?.deliverableChecked).not.toBe(true);
    expect(fs.readFileSync(sessionFile, "utf8")).not.toContain("当前任务已完成");
  });

  it("keeps the conversation task active when the session board write throws", async () => {
    const task = await seedActiveTask("m-board-throw");
    const sessionFile = path.join(root, "throw.jsonl");
    seedBoard(sessionFile);
    vi.spyOn(sessionTaskBoard, "recordCheckedTaskCompletion").mockImplementation(() => {
      throw new Error("injected session board write failure");
    });
    const notice = await complete({
      sourceMessageId: "m-board-throw",
      sessionFile,
      completionBinding: binding(),
    });
    expect(notice).toBeUndefined();
    expect(await lifecycleOf(task.id)).toBe("active");
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);
  });

  it("does not close either domain when the ledger write throws", async () => {
    const task = await seedActiveTask("m-ledger-throw");
    const sessionFile = path.join(root, "ledger.jsonl");
    seedBoard(sessionFile);
    vi.spyOn(ledgerBinding, "completeConversationTaskLedgerOnReplyOutcome").mockRejectedValue(
      new Error("injected ledger write failure"),
    );
    const notice = await complete({
      sourceMessageId: "m-ledger-throw",
      sessionFile,
      completionBinding: binding(),
    });
    expect(notice).toBeUndefined();
    expect(await lifecycleOf(task.id)).toBe("active");
    expect(readSessionTaskBoard(sessionFile).current?.deliverableChecked).not.toBe(true);
  });

  it("retries a rejected board close on the next delivered reply", async () => {
    const task = await seedActiveTask("m-retry");
    const sessionFile = path.join(root, "retry.jsonl");
    seedBoard(sessionFile, { taskId: "other-task" });
    const rejected = await complete({
      sourceMessageId: "m-retry",
      sessionFile,
      completionBinding: binding(),
    });
    expect(rejected).toBeUndefined();
    expect(await lifecycleOf(task.id)).toBe("active");

    seedBoard(sessionFile);
    const notice = await complete({
      sourceMessageId: "m-retry",
      sessionFile,
      completionBinding: binding(),
    });
    expect(notice).toContain("当前任务已完成，交付已核对。");
    expect(await lifecycleOf(task.id)).toBe("closed");
    expect(readSessionTaskBoard(sessionFile).current?.deliverableChecked).toBe(true);
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(false);
  });

  it("does not reopen or announce again after a completed close", async () => {
    const task = await seedActiveTask("m-dup");
    const sessionFile = path.join(root, "dup.jsonl");
    seedBoard(sessionFile);
    const first = await complete({
      sourceMessageId: "m-dup",
      sessionFile,
      completionBinding: binding(),
    });
    expect(first).toContain("当前任务已完成，交付已核对。");
    const second = await complete({
      sourceMessageId: "m-dup",
      sessionFile,
      completionBinding: binding(),
    });
    expect(second).toBeUndefined();
    expect(await lifecycleOf(task.id)).toBe("closed");
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(false);
    const transcript = fs.readFileSync(sessionFile, "utf8");
    expect(transcript.match(/当前任务已完成，交付已核对。/g)).toHaveLength(1);
  });

  it("rejects a stale execution attempt without closing the conversation task", async () => {
    const task = await seedActiveTask("m-stale");
    const sessionFile = path.join(root, "stale.jsonl");
    seedBoard(sessionFile, { executionAttempt: "run-2" });
    const notice = await complete({
      sourceMessageId: "m-stale",
      sessionFile,
      completionBinding: binding({ executionAttempt: "run-1" }),
    });
    expect(notice).toBeUndefined();
    expect(await lifecycleOf(task.id)).toBe("active");
    expect(readSessionTaskBoard(sessionFile).current?.executionAttempt).toBe("run-2");
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);
  });

  it("does not close or announce when acceptance alignment fails", async () => {
    const task = await seedActiveTask("m-accept");
    const sessionFile = path.join(root, "accept.jsonl");
    seedBoard(sessionFile);
    const notice = await complete({
      sourceMessageId: "m-accept",
      sessionFile,
      completionBinding: binding(),
      assistantReplyText: "我检索了知识库中关于中医诊断学的笔记，没有找到完整的望闻问切章节摘要。",
    });
    expect(notice).toBeUndefined();
    expect(await lifecycleOf(task.id)).toBe("active");
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);
    expect(fs.readFileSync(sessionFile, "utf8")).toBe("");
  });

  it("does not treat silence or a placeholder reply as completion", async () => {
    process.env[CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV] = "1";
    const task = await seedActiveTask("m-silent");
    await observeConversationToolEvent({
      task: task as never,
      cronStorePath: path.join(root, "cron.json"),
      env: process.env,
      readConfig: () => false,
      evt: {
        stream: "tool",
        data: { phase: "result", name: "write", isError: false, text: "wrote prices" },
      },
    });
    const sessionFile = path.join(root, "silent.jsonl");
    seedBoard(sessionFile);
    for (const assistantReplyText of ["NO_REPLY", "  NO_REPLY  ", "……", "..."]) {
      const notice = await complete({
        sourceMessageId: "m-silent",
        sessionFile,
        completionBinding: binding(),
        assistantReplyText,
      });
      expect(notice, assistantReplyText).toBeUndefined();
    }
    expect(await lifecycleOf(task.id)).toBe("active");
    expect(readSessionTaskBoard(sessionFile).current?.deliverableChecked).not.toBe(true);
  });

  it("closes the conversation task without a second notice when the board was already checked", async () => {
    const task = await seedActiveTask("m-reconcile");
    const sessionFile = path.join(root, "reconcile.jsonl");
    seedBoard(sessionFile, { unfinished: false, deliverableChecked: true });
    const notice = await complete({
      sourceMessageId: "m-reconcile",
      sessionFile,
      completionBinding: binding(),
    });
    expect(notice).toBeUndefined();
    expect(await lifecycleOf(task.id)).toBe("closed");
    expect(readSessionTaskBoard(sessionFile).current?.deliverableChecked).toBe(true);
    expect(fs.readFileSync(sessionFile, "utf8")).toBe("");
  });

  it("does not announce success when strict close lacks canonical evidence", async () => {
    process.env[CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV] = "1";
    const task = await seedActiveTask("m-noncanonical");
    const sessionFile = path.join(root, "noncanonical.jsonl");
    seedBoard(sessionFile);
    vi.spyOn(ledgerBinding, "completeConversationTaskLedgerOnReplyOutcome").mockResolvedValue({
      ledger: { acceptance: [], completed: true } as never,
      closedNow: true,
    });
    const notice = await complete({
      sourceMessageId: "m-noncanonical",
      sessionFile,
      completionBinding: binding(),
      assistantReplyText: `${GOAL}。价格表已经写好并核对了三家店铺的结果。`,
    });
    expect(notice).toBeUndefined();
    expect(await lifecycleOf(task.id)).toBe("active");
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);
    expect(fs.readFileSync(sessionFile, "utf8")).toBe("");
  });

  it("does not confirm delivery from the reply-completion observer", () => {
    expect(
      resolveRequiredDeliveryConfirmStatus([
        { source: "deliver", ok: true },
        { source: "enqueue_only", ok: true },
      ]),
    ).toBe("delivery_unknown");
    const dispatch = fs.readFileSync(
      path.join(import.meta.dirname, "../auto-reply/reply/dispatch-from-config.ts"),
      "utf8",
    );
    const gate = dispatch.slice(
      dispatch.indexOf(
        'resolveRequiredDeliveryConfirmStatus(requiredDeliveryAttempts) === "delivered"',
      ),
      dispatch.indexOf('recordProcessed("completed")'),
    );
    expect(gate).toContain("observeConversationTaskReplyCompleted");
    expect(gate).not.toContain("confirmPendingTurnDelivery");
    const reply = fs.readFileSync(new URL("./reply-completion.ts", import.meta.url), "utf8");
    expect(reply).not.toContain("confirmPendingTurnDelivery");
  });
});
