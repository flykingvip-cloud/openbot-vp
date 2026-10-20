import { describe, expect, it, vi } from "vitest";
import {
  buildCronCurrentStepPrompt,
  buildCronSeedEvent,
  createCronLedgerSession,
  ensureCronLedgerSeeded,
  finalizeCronRun,
  isCanonicalClosingEvidence,
  isLongHorizonCronJob,
  observeCronRunTick,
  observeCronToolEvent,
  parseLongHorizonCronMeta,
  recordCanonicalValidation,
  recordHumanGate,
  recordReplan,
  selectExistingClosingEvidence,
} from "./cron-binding.js";
import { PROGRESS_LEDGER_ENABLED_ENV } from "./feature.js";
import { foldEvents } from "./fold.js";
import { createMemoryLedgerStore } from "./store.js";
import { validationEvidence } from "./test-helpers.js";
import { assertNotLegacyProgressSource } from "./writer.js";

const longHorizonJob = {
  id: "job-q2",
  name: "Q2 巡检",
  description: `巡检\n<!--openbot-task-meta:${encodeURIComponent(
    JSON.stringify({
      goal: "Q2 竞品价格巡检",
      acceptanceRules: ["已拉取竞品价格", "已计算内部价差"],
    }),
  )}-->`,
};

describe("cron ledger binding", () => {
  it("treats goal + acceptanceRules as long-horizon", () => {
    expect(isLongHorizonCronJob(longHorizonJob)).toBe(true);
    expect(isLongHorizonCronJob({ id: "plain", name: "普通任务", description: "没有验收" })).toBe(
      false,
    );
  });

  it("qualifies an ordinary cron message with 定时说明 and 验收标准", () => {
    const message = [
      "## 定时说明",
      "每日拉取京东与淘宝竞品价格",
      "## 验收标准",
      "- 已写出价差表",
    ].join("\n");
    const meta = parseLongHorizonCronMeta({
      id: "ordinary",
      name: "竞品",
      description: "普通定时，没有 wizard meta",
      payload: { kind: "agentTurn", message },
    });
    expect(meta).toEqual({
      goal: "每日拉取京东与淘宝竞品价格",
      acceptanceRules: ["已写出价差表"],
    });
  });

  it("qualifies colon sections and a legacy command body", () => {
    expect(
      parseLongHorizonCronMeta({
        id: "colon",
        payload: { kind: "systemEvent", text: "定时说明：巡检价格\n验收标准：已写出价差表" },
      }),
    ).toEqual({
      goal: "巡检价格",
      acceptanceRules: ["已写出价差表"],
    });
    expect(
      parseLongHorizonCronMeta({
        id: "legacy-command",
        command: "定时说明：补齐 README\n验收：写下第一行",
      })?.acceptanceRules,
    ).toEqual(["写下第一行"]);
  });

  it("derives one acceptance line from a stated deliverable", () => {
    const meta = parseLongHorizonCronMeta({
      id: "report",
      name: "周报",
      payload: {
        kind: "agentTurn",
        message: "把昨日销售整理成一份日报并保存为 reports/daily.md",
      },
    });
    expect(meta?.goal).toContain("日报");
    expect(meta?.acceptanceRules).toEqual(["把昨日销售整理成一份日报并保存为 reports/daily.md"]);
  });

  it("leaves vague reminders on the non-long-horizon path", () => {
    expect(
      isLongHorizonCronJob({
        id: "water",
        name: "喝水提醒",
        description: "普通提醒，没有验收",
        payload: { kind: "agentTurn", message: "提醒我喝水" },
        commandBody: "hello",
      }),
    ).toBe(false);
    expect(
      isLongHorizonCronJob({
        id: "standup",
        payload: { kind: "agentTurn", message: "每天 9 点提醒站会" },
      }),
    ).toBe(false);
    expect(
      parseLongHorizonCronMeta({
        id: "placeholder",
        payload: {
          kind: "agentTurn",
          message: [
            "## 定时说明",
            "提醒喝水",
            "## 验收标准",
            "（未设置显式验收规则，请确保输出满足定时说明。）",
          ].join("\n"),
        },
      }),
    ).toBeNull();
  });

  it("keeps personal-task meta ahead of a non-qualifying payload", () => {
    const meta = parseLongHorizonCronMeta({
      ...longHorizonJob,
      payload: { kind: "agentTurn", message: "提醒我喝水" },
    });
    expect(meta?.goal).toBe("Q2 竞品价格巡检");
    expect(meta?.acceptanceRules).toEqual(["已拉取竞品价格", "已计算内部价差"]);
  });

  it("seeds ledger under conversationTaskId when the job is bound (EA-B4)", () => {
    const meta = parseLongHorizonCronMeta(longHorizonJob);
    expect(meta).not.toBeNull();
    const event = buildCronSeedEvent({
      job: { ...longHorizonJob, conversationTaskId: "ct-market-1" },
      meta: meta!,
      atMs: 1,
    });
    expect(event.taskId).toBe("ct-market-1");
  });

  it("binds a long-horizon job when the ledger flag and config are unset", () => {
    const session = createCronLedgerSession({
      job: longHorizonJob,
      env: {},
      readConfig: () => false,
      store: createMemoryLedgerStore(longHorizonJob.id),
    });
    expect(session).not.toBeNull();
    expect(
      createCronLedgerSession({
        job: longHorizonJob,
        env: { [PROGRESS_LEDGER_ENABLED_ENV]: "0" },
        readConfig: () => false,
        store: createMemoryLedgerStore(longHorizonJob.id),
      }),
    ).not.toBeNull();
  });

  it("does not bind a non-long-horizon job when the flag is off", () => {
    expect(
      createCronLedgerSession({
        job: { id: "plain", name: "普通任务", description: "没有验收" },
        env: {},
        readConfig: () => false,
        store: createMemoryLedgerStore("plain"),
      }),
    ).toBeNull();
  });

  it("does not bind ordinary cron jobs even when enabled", () => {
    expect(
      createCronLedgerSession({
        job: { id: "plain", description: "hello" },
        env: { [PROGRESS_LEDGER_ENABLED_ENV]: "1" },
        store: createMemoryLedgerStore("plain"),
      }),
    ).toBeNull();
  });

  it("writes STEP / EVIDENCE from tools but never completes from a run summary", async () => {
    const store = createMemoryLedgerStore(longHorizonJob.id);
    const seeded = await ensureCronLedgerSeeded({ store, job: longHorizonJob, atMs: 1_000 });
    expect(seeded.acceptance).toHaveLength(2);
    expect(seeded.steps).toHaveLength(2);
    expect(seeded.completed).toBe(false);

    await observeCronToolEvent({
      store,
      job: longHorizonJob,
      phase: "start",
      toolName: "crm_query",
      atMs: 2_000,
    });
    const afterTool = await observeCronToolEvent({
      store,
      job: longHorizonJob,
      phase: "result",
      toolName: "crm_query",
      atMs: 2_100,
    });
    const step = afterTool?.steps.find((item) => item.id === "E1");
    expect(step?.status).toBe("executed");
    expect(step?.verified).toBe(false);
    expect(step?.evidence[0]?.type).toBe("tool_result");
    expect(afterTool?.acceptance.find((item) => item.id === "A1")?.status).toBe("unknown");
    expect(afterTool?.completed).toBe(false);

    expect(() => assertNotLegacyProgressSource({ source: "run_summary" })).toThrow(
      /not canonical progress/,
    );

    const verified = await recordCanonicalValidation({
      store,
      taskId: longHorizonJob.id,
      stepId: "E1",
      acceptanceId: "A1",
      evidence: validationEvidence(3_000),
      atMs: 3_000,
    });
    expect(verified.steps.find((item) => item.id === "E1")?.status).toBe("completed");
    expect(verified.acceptance.find((item) => item.id === "A1")?.status).toBe("met");
    expect(verified.completed).toBe(false);
    expect(foldEvents(await store.loadEvents())).toEqual(verified);
  });

  it("continues a tool-less tick without closing acceptance", async () => {
    const store = createMemoryLedgerStore(longHorizonJob.id);
    const started = await observeCronRunTick({ store, job: longHorizonJob, atMs: 4_000 });
    expect(started.steps.find((item) => item.id === "E1")?.status).toBe("in_progress");
    expect(started.lastMeaningfulChangeAtMs).toBeGreaterThanOrEqual(4_000);

    const finished = await finalizeCronRun({
      store,
      job: longHorizonJob,
      status: "ok",
      delivered: false,
      atMs: 5_000,
    });
    expect(finished.steps.find((item) => item.id === "E1")?.status).toBe("in_progress");
    expect(finished.acceptance.find((item) => item.id === "A1")?.status).toBe("unknown");
    expect(finished.completed).toBe(false);
    expect(finished.lastMeaningfulChangeAtMs).toBeGreaterThanOrEqual(5_000);
    expect(finished.staleAfterMs).toBeGreaterThan(0);
  });

  it("retries a failed last step and closes acceptance from delivery receipt", async () => {
    const store = createMemoryLedgerStore(longHorizonJob.id);
    await ensureCronLedgerSeeded({ store, job: longHorizonJob, atMs: 1_000 });
    await observeCronToolEvent({
      store,
      job: longHorizonJob,
      phase: "start",
      toolName: "crm_query",
      atMs: 2_000,
    });
    await observeCronToolEvent({
      store,
      job: longHorizonJob,
      phase: "result",
      toolName: "crm_query",
      atMs: 2_100,
    });
    await observeCronToolEvent({
      store,
      job: longHorizonJob,
      phase: "result",
      toolName: "web_fetch",
      isError: true,
      atMs: 2_200,
    });
    const failed = foldEvents(await store.loadEvents());
    expect(failed.steps.find((item) => item.id === "E1")?.status).toBe("failed");

    await observeCronRunTick({ store, job: longHorizonJob, atMs: 8_000 });
    const retried = foldEvents(await store.loadEvents());
    expect(retried.steps.find((item) => item.id === "E1")?.status).toBe("in_progress");

    const fabricated = await finalizeCronRun({
      store,
      job: longHorizonJob,
      status: "ok",
      delivered: true,
      receiptId: "cron:job-q2:run-1",
      receiptSource: "cron_delivery",
      sawToolSuccess: true,
      atMs: 9_000,
    });
    expect(fabricated.steps.find((item) => item.id === "E1")?.status).not.toBe("completed");
    expect(fabricated.acceptance.find((item) => item.id === "A1")?.status).not.toBe("met");

    const closed = await finalizeCronRun({
      store,
      job: longHorizonJob,
      status: "ok",
      delivered: true,
      receiptId: "provider_message_id=msg_9",
      receiptSource: "email_send",
      sawToolSuccess: true,
      atMs: 9_100,
    });
    expect(closed.steps.find((item) => item.id === "E1")?.status).toBe("completed");
    expect(closed.acceptance.find((item) => item.id === "A1")?.status).toBe("met");
    expect(closed.acceptance.find((item) => item.id === "A1")?.evidence[0]?.type).toBe(
      "external_receipt",
    );
    expect(closed.acceptance.find((item) => item.id === "A1")?.evidence[0]?.source).toBe(
      "email_send",
    );
    expect(closed.acceptance.find((item) => item.id === "A2")?.status).toBe("unknown");
    expect(closed.completed).toBe(false);
    const events = await store.loadEvents();
    expect(JSON.stringify(events)).not.toContain("cron_runtime");
    expect(JSON.stringify(events)).not.toContain("cron-tick-v1");
  });

  it("does not close acceptance from a run summary or undelivered text-only finish", async () => {
    const store = createMemoryLedgerStore(longHorizonJob.id);
    await observeCronRunTick({ store, job: longHorizonJob, atMs: 1_000 });
    expect(() => assertNotLegacyProgressSource({ source: "run_summary" })).toThrow(
      /not canonical progress/,
    );
    const finished = await finalizeCronRun({
      store,
      job: longHorizonJob,
      status: "ok",
      delivered: false,
      sawToolSuccess: false,
      atMs: 2_000,
    });
    expect(finished.acceptance.every((item) => item.status === "unknown")).toBe(true);
    expect(finished.completed).toBe(false);
  });

  it("session start/finish closes the live step after tool success plus delivery", async () => {
    const store = createMemoryLedgerStore(longHorizonJob.id);
    const session = createCronLedgerSession({
      job: longHorizonJob,
      env: { [PROGRESS_LEDGER_ENABLED_ENV]: "1" },
      store,
    });
    expect(session).not.toBeNull();
    await session?.observeRunStart(10_000);
    await session?.observeAgentEvent({
      stream: "tool",
      data: { phase: "start", name: "crm_query" },
    });
    await session?.observeAgentEvent({
      stream: "tool",
      data: { phase: "result", name: "crm_query", isError: false },
    });
    await session?.observeRunFinish({
      status: "ok",
      delivered: true,
      receiptId: "cron:job-q2:sess-1",
      atMs: 11_000,
    });
    const events = await store.loadEvents();
    const ledger = foldEvents(events);
    expect(ledger.steps.find((item) => item.id === "E1")?.status).toBe("completed");
    expect(ledger.acceptance.find((item) => item.id === "A1")?.status).toBe("met");
    expect(ledger.acceptance.find((item) => item.id === "A2")?.status).toBe("unknown");
    const met = events.find((event) => event.type === "ACCEPTANCE_MET");
    expect(met?.payload.evidence).toMatchObject({
      type: "tool_result",
      source: "crm_query",
      verification: "passed",
    });
    expect(JSON.stringify(events)).not.toContain("cron_runtime");
    expect(JSON.stringify(events)).not.toContain("cron:job-q2:sess-1");
  });

  it("lets the session observe agent tool events when enabled", async () => {
    const store = createMemoryLedgerStore(longHorizonJob.id);
    const session = createCronLedgerSession({
      job: longHorizonJob,
      env: { [PROGRESS_LEDGER_ENABLED_ENV]: "1" },
      store,
    });
    expect(session).not.toBeNull();
    await session?.ensureSeeded();
    await session?.observeAgentEvent({
      stream: "tool",
      data: { phase: "start", name: "web_search" },
    });
    await session?.observeAgentEvent({
      stream: "tool",
      data: { phase: "result", name: "web_search", isError: false },
    });
    const ledger = foldEvents(await store.loadEvents());
    expect(ledger.steps.find((item) => item.id === "E1")?.status).toBe("executed");
  });

  it("names only the current writable step in the tick prompt", () => {
    const prompt = buildCronCurrentStepPrompt({
      id: "E1",
      title: "写下仓库 README 的第一行",
      acceptanceIds: ["A1"],
    });
    expect(prompt).toContain("step id: E1");
    expect(prompt).toContain("title: 写下仓库 README 的第一行");
    expect(prompt).toContain("acceptance id: A1");
    expect(prompt).toContain("This tick does only this step.");
    expect(prompt).toContain("You must use a tool to complete this step.");
    expect(prompt).toContain("Plain text is not completion.");
    expect(prompt).toContain("Do not do later steps.");
    expect(prompt).not.toContain("E2");
    expect(prompt).not.toContain("第二行");
  });

  it("closes only the current acceptance from an existing passed tool_result", async () => {
    const store = createMemoryLedgerStore(longHorizonJob.id);
    await observeCronToolEvent({
      store,
      job: longHorizonJob,
      phase: "start",
      toolName: "write",
      atMs: 2_000,
    });
    await observeCronToolEvent({
      store,
      job: longHorizonJob,
      phase: "result",
      toolName: "write",
      atMs: 2_100,
    });
    const closed = await finalizeCronRun({
      store,
      job: longHorizonJob,
      status: "ok",
      delivered: true,
      sawToolSuccess: true,
      atMs: 3_000,
    });
    expect(closed.acceptance.find((item) => item.id === "A1")?.status).toBe("met");
    expect(closed.steps.find((item) => item.id === "E1")?.status).toBe("completed");
    expect(closed.acceptance.find((item) => item.id === "A2")?.status).toBe("unknown");
    expect(closed.steps.find((item) => item.id === "E2")?.status).toBe("pending");
    const met = (await store.loadEvents()).find((event) => event.type === "ACCEPTANCE_MET");
    expect(met?.payload.evidence).toMatchObject({
      type: "tool_result",
      source: "write",
      verification: "passed",
    });
    expect(JSON.stringify(await store.loadEvents())).not.toContain("cron_runtime");
    expect(JSON.stringify(await store.loadEvents())).not.toContain("assistant");
  });

  it("does not close from assistant-less text, delivered:true, or system_observation", async () => {
    const store = createMemoryLedgerStore(longHorizonJob.id);
    await observeCronRunTick({ store, job: longHorizonJob, atMs: 1_000 });
    const finished = await finalizeCronRun({
      store,
      job: longHorizonJob,
      status: "ok",
      delivered: true,
      sawToolSuccess: false,
      atMs: 2_000,
    });
    expect(finished.acceptance.every((item) => item.status === "unknown")).toBe(true);
    expect(finished.steps.find((item) => item.id === "E1")?.status).not.toBe("completed");
    expect(JSON.stringify(await store.loadEvents())).not.toContain("ACCEPTANCE_MET");
  });

  it("does not close acceptance on error even after a passed tool_result", async () => {
    const store = createMemoryLedgerStore(longHorizonJob.id);
    await observeCronToolEvent({
      store,
      job: longHorizonJob,
      phase: "result",
      toolName: "write",
      atMs: 2_000,
    });
    const finished = await finalizeCronRun({
      store,
      job: longHorizonJob,
      status: "error",
      sawToolSuccess: true,
      atMs: 3_000,
    });
    expect(finished.acceptance.find((item) => item.id === "A1")?.status).not.toBe("met");
    expect(finished.steps.find((item) => item.id === "E1")?.status).not.toBe("completed");
  });

  it("closes the next step on a later tick and ignores a synthetic receipt", async () => {
    const store = createMemoryLedgerStore(longHorizonJob.id);
    await observeCronToolEvent({
      store,
      job: longHorizonJob,
      phase: "result",
      toolName: "write",
      atMs: 2_000,
    });
    await finalizeCronRun({
      store,
      job: longHorizonJob,
      status: "ok",
      sawToolSuccess: true,
      atMs: 3_000,
    });
    await observeCronToolEvent({
      store,
      job: longHorizonJob,
      phase: "result",
      toolName: "write",
      atMs: 4_000,
    });
    const second = await finalizeCronRun({
      store,
      job: longHorizonJob,
      status: "ok",
      delivered: true,
      receiptId: "cron:job-q2:sess-2",
      receiptSource: "cron:job-q2:sess-2",
      sawToolSuccess: true,
      atMs: 5_000,
    });
    expect(second.acceptance.find((item) => item.id === "A1")?.status).toBe("met");
    expect(second.acceptance.find((item) => item.id === "A2")?.status).toBe("met");
    expect(second.completed).toBe(true);
    const met = (await store.loadEvents()).filter((event) => event.type === "ACCEPTANCE_MET");
    expect(met.map((event) => event.acceptanceId)).toEqual(["A1", "A2"]);
    expect(
      met.every((event) => (event.payload.evidence as { type?: string }).type === "tool_result"),
    ).toBe(true);
  });

  it("accepts a model proposal as REPLAN_APPENDED without rewriting history", async () => {
    const store = createMemoryLedgerStore(longHorizonJob.id);
    await ensureCronLedgerSeeded({ store, job: longHorizonJob, atMs: 1_000 });
    const ledger = await recordReplan({
      store,
      proposal: {
        taskId: longHorizonJob.id,
        reason: "missing_data",
        proposedBy: "model",
        retiredStepIds: ["E2"],
        addedSteps: [{ id: "E2b", title: "改走内部价表", acceptanceIds: ["A2"] }],
      },
      atMs: Date.parse("2026-08-22T01:32:00.000Z"),
    });
    expect(ledger.currentPlanVersion).toBe(2);
    expect(ledger.steps.find((item) => item.id === "E2")?.retired).toBe(true);
    expect(ledger.steps.find((item) => item.id === "E2")?.status).toBe("pending");
    expect(ledger.replans[0]?.reason).toBe("missing_data");
    const events = await store.loadEvents();
    expect(events.at(-1)?.actor).toBe("runtime");
    expect(events.at(-1)?.type).toBe("REPLAN_APPENDED");
  });

  it("does not notify while quiet, and does notify blocked_user otherwise", async () => {
    const store = createMemoryLedgerStore(longHorizonJob.id);
    await ensureCronLedgerSeeded({ store, job: longHorizonJob, atMs: 1_000 });
    const quietNotify = vi.fn();
    await recordHumanGate({
      store,
      taskId: longHorizonJob.id,
      stepId: "E1",
      reason: "blocked_user",
      question: "价差按含税价还是活动价？",
      atMs: 2_000,
      quiet: true,
      notify: quietNotify,
    });
    expect(quietNotify).not.toHaveBeenCalled();

    const liveNotify = vi.fn();
    await recordHumanGate({
      store,
      taskId: longHorizonJob.id,
      stepId: "E1",
      reason: "blocked_user",
      question: "价差按含税价还是活动价？",
      atMs: 3_000,
      notify: liveNotify,
    });
    expect(liveNotify).toHaveBeenCalledWith({
      taskId: longHorizonJob.id,
      question: "价差按含税价还是活动价？",
      reason: "blocked_user",
    });
  });
});

describe("canonical closing evidence", () => {
  it("accepts only a passed tool_result or a real external_receipt", () => {
    expect(
      isCanonicalClosingEvidence({
        type: "tool_result",
        atMs: 1,
        source: "write",
        verification: "passed",
      }),
    ).toBe(true);
    expect(
      isCanonicalClosingEvidence({
        type: "tool_result",
        atMs: 1,
        source: "write",
        verification: "failed",
      }),
    ).toBe(false);
    expect(
      isCanonicalClosingEvidence({
        type: "external_receipt",
        atMs: 1,
        source: "email_send",
        receiptId: "msg_9",
        verification: "passed",
      }),
    ).toBe(true);
    expect(
      isCanonicalClosingEvidence({
        type: "external_receipt",
        atMs: 1,
        source: "email_send",
        receiptId: "cron:job-q2:run-1",
        verification: "passed",
      }),
    ).toBe(false);
    expect(
      isCanonicalClosingEvidence({
        type: "external_receipt",
        atMs: 1,
        source: "email_send",
        verification: "passed",
      }),
    ).toBe(false);
    expect(
      isCanonicalClosingEvidence({
        type: "validation_result",
        atMs: 1,
        source: "conversation_reply",
        ruleVersion: "ct-reply-v1",
        verification: "passed",
      }),
    ).toBe(false);
    expect(
      isCanonicalClosingEvidence({
        type: "system_observation",
        atMs: 1,
        source: "cron_tick",
        verification: "passed",
        note: "cron_run_finished",
      }),
    ).toBe(false);
    const selected = selectExistingClosingEvidence({
      evidence: [
        {
          type: "tool_result",
          atMs: 1,
          source: "write",
          verification: "passed",
        },
        {
          type: "validation_result",
          atMs: 2,
          source: "conversation_reply",
          verification: "passed",
        },
        {
          type: "tool_result",
          atMs: 3,
          source: "write",
          verification: "failed",
        },
      ],
    });
    expect(selected?.type).toBe("tool_result");
    expect(selected?.verification).toBe("passed");
  });
});
