import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROGRESS_LEDGER_ENABLED_ENV } from "../progress-ledger/feature.js";
import { createFileLedgerStore, createMemoryLedgerStore } from "../progress-ledger/store.js";
import { appendLedgerEvent, newLedgerEventId } from "../progress-ledger/writer.js";
import { CONVERSATION_TASK_ENV } from "./feature.js";
import {
  CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV,
  completeConversationTaskLedgerOnReply,
  conversationTaskLedgerId,
  conversationToolObservationKey,
  createConversationTurnToolObserver,
  ensureConversationTaskLedgerSeeded,
  flushConversationToolObservations,
  observeConversationToolEvent,
} from "./ledger-binding.js";
import { openTaskStore, type StoredConversationTask } from "./store.js";

let cronStorePath: string;

beforeEach(() => {
  cronStorePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ct-ledger-")), "cron.json");
});

afterEach(() => {
  fs.rmSync(path.dirname(cronStorePath), { recursive: true, force: true });
});

const task: StoredConversationTask = {
  id: 7,
  taskKey: "k",
  tenantId: "tenant-a",
  conversationId: "conv-1",
  normalizedGoal: "每天监控竞品价格如果异常就预警",
  goal: "每天监控竞品价格,如果异常就预警",
  sourceMessageId: "m-seed-1",
  activationEpoch: 1,
  lifecycle: "active",
  requesterId: "user-1",
  ownerId: "user-1",
  createdAtMs: 1_000,
  updatedAtMs: 1_000,
};

describe("conversation-task ledger binding", () => {
  it("uses ct-<id> as the ledger task id", () => {
    expect(conversationTaskLedgerId(task)).toBe("ct-7");
  });

  it("does not seed when evidence close and the progress ledger are both off", async () => {
    const store = createMemoryLedgerStore(conversationTaskLedgerId(task));
    const ledger = await ensureConversationTaskLedgerSeeded({
      task,
      store,
      env: { [CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV]: "0" },
      readConfig: () => false,
    });
    expect(ledger).toBeNull();
    expect(await store.loadEvents()).toHaveLength(0);
  });

  it("seeds PLAN_SEEDED with the goal as the only acceptance rule", async () => {
    const store = createMemoryLedgerStore(conversationTaskLedgerId(task));
    const ledger = await ensureConversationTaskLedgerSeeded({
      task,
      store,
      atMs: 2_000,
      env: { [PROGRESS_LEDGER_ENABLED_ENV]: "1" },
      readConfig: () => false,
    });
    expect(ledger?.goal).toBe(task.goal);
    expect(ledger?.acceptance).toEqual([expect.objectContaining({ id: "A1", text: task.goal })]);
    expect(ledger?.steps).toEqual([expect.objectContaining({ id: "E1", title: task.goal })]);
    const again = await ensureConversationTaskLedgerSeeded({
      task,
      store,
      env: { [PROGRESS_LEDGER_ENABLED_ENV]: "1" },
      readConfig: () => false,
    });
    expect(again?.goal).toBe(task.goal);
    expect(await store.loadEvents()).toHaveLength(1);
  });

  it("closes acceptance when a matching reply completes", async () => {
    await ensureConversationTaskLedgerSeeded({
      task,
      cronStorePath,
      env: { [PROGRESS_LEDGER_ENABLED_ENV]: "1" },
      readConfig: () => false,
    });
    const closed = await completeConversationTaskLedgerOnReply({
      task,
      cronStorePath,
      env: {
        [PROGRESS_LEDGER_ENABLED_ENV]: "1",
        [CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV]: "0",
      },
      readConfig: () => false,
    });
    expect(closed?.completed).toBe(true);
    expect(closed?.acceptance.find((row) => row.id === "A1")?.status).toBe("met");
    expect(
      closed?.acceptance
        .find((row) => row.id === "A1")
        ?.evidence.some(
          (row) => row.source === "conversation_reply" && row.ruleVersion === "ct-reply-v1",
        ),
    ).toBe(true);
  });
});

const ledgerEnv = {
  [PROGRESS_LEDGER_ENABLED_ENV]: "1",
} as NodeJS.ProcessEnv;

const strictEnv = {
  ...ledgerEnv,
  [CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV]: "1",
} as NodeJS.ProcessEnv;

async function ledgerEvents() {
  return await createFileLedgerStore({
    cronStorePath,
    taskId: conversationTaskLedgerId(task),
  }).loadEvents();
}

describe("conversation-task evidence close default", () => {
  it("seeds and closes on a passed tool_result when neither flag is set", async () => {
    const seeded = await ensureConversationTaskLedgerSeeded({
      task,
      cronStorePath,
      env: {},
      readConfig: () => false,
    });
    expect(seeded).not.toBeNull();
    await observeConversationToolEvent({
      task,
      cronStorePath,
      env: {},
      readConfig: () => false,
      evt: {
        stream: "tool",
        data: { phase: "result", name: "write", isError: false },
      },
    });
    const closed = await completeConversationTaskLedgerOnReply({
      task,
      cronStorePath,
      env: {},
      readConfig: () => false,
    });
    expect(closed?.acceptance.find((row) => row.id === "A1")?.status).toBe("met");
    const raw = JSON.stringify(await ledgerEvents());
    expect(raw).toContain("tool_result");
    expect(raw).not.toContain("conversation_reply");
  });
});

describe("conversation-task evidence close", () => {
  it("does not write conversation_reply or mark acceptance met without tool evidence", async () => {
    await ensureConversationTaskLedgerSeeded({
      task,
      cronStorePath,
      env: strictEnv,
      readConfig: () => false,
    });
    const closed = await completeConversationTaskLedgerOnReply({
      task,
      cronStorePath,
      env: strictEnv,
      readConfig: () => false,
    });
    expect(closed?.completed).toBe(false);
    expect(closed?.acceptance.find((row) => row.id === "A1")?.status).not.toBe("met");
    const raw = JSON.stringify(await ledgerEvents());
    expect(raw).not.toContain("conversation_reply");
    expect(raw).not.toContain("ct-reply-v1");
    expect(raw).not.toContain("ACCEPTANCE_MET");
  });

  it("closes on a passed tool_result already on the step and does not store assistant text", async () => {
    await ensureConversationTaskLedgerSeeded({
      task,
      cronStorePath,
      env: strictEnv,
      readConfig: () => false,
    });
    await observeConversationToolEvent({
      task,
      cronStorePath,
      env: strictEnv,
      readConfig: () => false,
      atMs: 3_000,
      evt: {
        stream: "assistant",
        data: { text: "SECRET_ASSISTANT_TEXT" },
      },
    });
    await observeConversationToolEvent({
      task,
      cronStorePath,
      env: strictEnv,
      readConfig: () => false,
      atMs: 3_100,
      evt: {
        stream: "tool",
        data: {
          phase: "result",
          name: "write",
          text: "SECRET_ASSISTANT_TEXT",
          isError: false,
        },
      },
    });
    const closed = await completeConversationTaskLedgerOnReply({
      task,
      cronStorePath,
      atMs: 4_000,
      env: strictEnv,
      readConfig: () => false,
    });
    expect(closed?.completed).toBe(true);
    expect(closed?.acceptance.find((row) => row.id === "A1")?.status).toBe("met");
    expect(closed?.acceptance.find((row) => row.id === "A1")?.evidence[0]).toMatchObject({
      type: "tool_result",
      source: "write",
      verification: "passed",
    });
    const raw = JSON.stringify(await ledgerEvents());
    expect(raw).not.toContain("SECRET_ASSISTANT_TEXT");
    expect(raw).not.toContain("conversation_reply");
    expect(raw).not.toContain("ct-reply-v1");
  });

  it("does not close on a failed tool result", async () => {
    await ensureConversationTaskLedgerSeeded({
      task,
      cronStorePath,
      env: strictEnv,
      readConfig: () => false,
    });
    await observeConversationToolEvent({
      task,
      cronStorePath,
      env: strictEnv,
      readConfig: () => false,
      atMs: 3_000,
      evt: { stream: "tool", data: { phase: "result", name: "write", isError: true } },
    });
    const closed = await completeConversationTaskLedgerOnReply({
      task,
      cronStorePath,
      env: strictEnv,
      readConfig: () => false,
    });
    expect(closed?.acceptance.find((row) => row.id === "A1")?.status).not.toBe("met");
    expect(JSON.stringify(await ledgerEvents())).not.toContain("conversation_reply");
  });

  it("closes on an external_receipt that already has a receiptId", async () => {
    await ensureConversationTaskLedgerSeeded({
      task,
      cronStorePath,
      env: strictEnv,
      readConfig: () => false,
    });
    const store = createFileLedgerStore({
      cronStorePath,
      taskId: conversationTaskLedgerId(task),
    });
    await appendLedgerEvent(store, {
      id: newLedgerEventId(),
      atMs: 3_000,
      type: "EVIDENCE_RECORDED",
      taskId: conversationTaskLedgerId(task),
      stepId: "E1",
      planVersion: 1,
      actor: "runtime",
      payload: {
        evidence: {
          type: "external_receipt",
          atMs: 3_000,
          source: "email_send",
          receiptId: "msg_9",
          verification: "passed",
        },
      },
    });
    const closed = await completeConversationTaskLedgerOnReply({
      task,
      cronStorePath,
      atMs: 4_000,
      env: strictEnv,
      readConfig: () => false,
    });
    expect(closed?.acceptance.find((row) => row.id === "A1")?.status).toBe("met");
    expect(closed?.acceptance.find((row) => row.id === "A1")?.evidence[0]).toMatchObject({
      type: "external_receipt",
      receiptId: "msg_9",
      source: "email_send",
    });
    expect(JSON.stringify(await ledgerEvents())).not.toContain("conversation_reply");
  });

  it("does not close on an external_receipt without receiptId or a synthetic cron id", async () => {
    await ensureConversationTaskLedgerSeeded({
      task,
      cronStorePath,
      env: strictEnv,
      readConfig: () => false,
    });
    const store = createFileLedgerStore({
      cronStorePath,
      taskId: conversationTaskLedgerId(task),
    });
    await appendLedgerEvent(store, {
      id: newLedgerEventId(),
      atMs: 3_000,
      type: "EVIDENCE_RECORDED",
      taskId: conversationTaskLedgerId(task),
      stepId: "E1",
      planVersion: 1,
      actor: "runtime",
      payload: {
        evidence: {
          type: "external_receipt",
          atMs: 3_000,
          source: "email_send",
          verification: "passed",
        },
      },
    });
    const missing = await completeConversationTaskLedgerOnReply({
      task,
      cronStorePath,
      env: strictEnv,
      readConfig: () => false,
    });
    expect(missing?.acceptance.find((row) => row.id === "A1")?.status).not.toBe("met");

    await appendLedgerEvent(store, {
      id: newLedgerEventId(),
      atMs: 3_100,
      type: "EVIDENCE_RECORDED",
      taskId: conversationTaskLedgerId(task),
      stepId: "E1",
      planVersion: 1,
      actor: "runtime",
      payload: {
        evidence: {
          type: "external_receipt",
          atMs: 3_100,
          source: "cron_runtime",
          receiptId: "cron:job:session",
          verification: "passed",
        },
      },
    });
    const synthetic = await completeConversationTaskLedgerOnReply({
      task,
      cronStorePath,
      env: strictEnv,
      readConfig: () => false,
    });
    expect(synthetic?.acceptance.find((row) => row.id === "A1")?.status).not.toBe("met");
  });

  it("returns null when the ledger flag is off, including in strict mode", async () => {
    const closed = await completeConversationTaskLedgerOnReply({
      task,
      cronStorePath,
      env: { [CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV]: "1" },
      readConfig: () => false,
    });
    expect(closed).toBeNull();
  });

  it("records only tool-stream events from the turn observer", async () => {
    const taskRoot = path.join(path.dirname(cronStorePath), "tasks");
    fs.mkdirSync(taskRoot, { recursive: true });
    const taskStore = openTaskStore({ tenantId: "local", storeRoot: taskRoot });
    const created = taskStore.createTaskIfAbsent({
      conversationId: "conv-1",
      goal: task.goal,
      activationEpoch: 1,
      requesterId: "user-1",
      ownerId: "user-1",
      sourceMessageId: "m-seed-1",
    });
    taskStore.close();
    const env = {
      [PROGRESS_LEDGER_ENABLED_ENV]: "1",
      [CONVERSATION_TASK_ENV.activation]: "1",
    };
    expect(
      createConversationTurnToolObserver({
        isHeartbeat: true,
        sessionKey: "conv-1",
        commandBody: task.goal,
        sessionCtx: { GatewayClientPlatformUserId: "user-1", MessageSid: "m-seed-1" },
        storeRoot: taskRoot,
        cronStorePath,
        env,
        readConfig: () => false,
      }),
    ).toBeNull();
    expect(
      createConversationTurnToolObserver({
        sessionKey: "conv-1",
        commandBody: task.goal,
        sessionCtx: { GatewayClientPlatformUserId: "user-1", MessageSid: "m-seed-1" },
        storeRoot: taskRoot,
        cronStorePath,
        env: { [CONVERSATION_TASK_ENV.activation]: "1" },
        readConfig: () => false,
      }),
    ).not.toBeNull();
    expect(
      createConversationTurnToolObserver({
        sessionKey: "conv-1",
        commandBody: task.goal,
        sessionCtx: { GatewayClientPlatformUserId: "user-1", MessageSid: "m-seed-1" },
        storeRoot: taskRoot,
        cronStorePath,
        env: {
          [CONVERSATION_TASK_ENV.activation]: "1",
          [CONVERSATION_TASK_CLOSE_REQUIRES_EVIDENCE_ENV]: "0",
        },
        readConfig: () => false,
      }),
    ).toBeNull();

    const observer = createConversationTurnToolObserver({
      sessionKey: "conv-1",
      commandBody: task.goal,
      sessionCtx: {
        GatewayClientPlatformUserId: "user-1",
        MessageSid: "m-seed-1",
        Body: task.goal,
      },
      storeRoot: taskRoot,
      cronStorePath,
      env,
      readConfig: () => false,
    });
    expect(observer).not.toBeNull();
    observer?.({ stream: "assistant", data: { text: "SECRET_ASSISTANT_TEXT" } });
    observer?.({
      stream: "tool",
      data: { phase: "result", name: "write", text: "SECRET_ASSISTANT_TEXT" },
    });
    await flushConversationToolObservations(
      conversationToolObservationKey({
        requesterId: "user-1",
        conversationId: "conv-1",
        sourceMessageId: "m-seed-1",
      }),
    );
    const events = await createFileLedgerStore({
      cronStorePath,
      taskId: conversationTaskLedgerId(created.task),
    }).loadEvents();
    const raw = JSON.stringify(events);
    expect(raw).toContain("write");
    expect(raw).not.toContain("SECRET_ASSISTANT_TEXT");
    expect(events.some((event) => event.type === "TOOL_SUCCEEDED")).toBe(true);
  });
});
