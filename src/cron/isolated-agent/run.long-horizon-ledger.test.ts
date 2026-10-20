import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { finalizeCronRun, observeCronToolEvent } from "../../progress-ledger/cron-binding.js";
import { PROGRESS_LEDGER_ENABLED_ENV } from "../../progress-ledger/feature.js";
import { foldEvents } from "../../progress-ledger/fold.js";
import { createFileLedgerStore } from "../../progress-ledger/store.js";
import {
  makeIsolatedAgentTurnJob,
  makeIsolatedAgentTurnParams,
  setupRunCronIsolatedAgentTurnSuite,
} from "./run.suite-helpers.js";
import {
  isCliProviderMock,
  loadRunCronIsolatedAgentTurn,
  pickLastNonEmptyTextFromPayloadsMock,
  runCliAgentMock,
  runEmbeddedPiAgentMock,
  runWithModelFallbackMock,
} from "./run.test-harness.js";

const runCronIsolatedAgentTurn = await loadRunCronIsolatedAgentTurn();

const FIRST_RULE = "写下仓库 README 的第一行";
const SECOND_RULE = "写下该文件的第二行";

function longHorizonDescription(): string {
  return `readme\n<!--openbot-task-meta:${encodeURIComponent(
    JSON.stringify({
      goal: "补齐 README 开头",
      acceptanceRules: [FIRST_RULE, SECOND_RULE],
    }),
  )}-->`;
}

function invokeFallback() {
  runWithModelFallbackMock.mockImplementation(
    async (params: { run: (provider: string, model: string) => Promise<unknown> }) => {
      const result = await params.run("claude-cli", "claude-opus-4-6");
      return { result, provider: "claude-cli", model: "claude-opus-4-6", attempts: [] };
    },
  );
}

describe("runCronIsolatedAgentTurn long-horizon ledger ticks", () => {
  setupRunCronIsolatedAgentTurnSuite();

  let previousFlag: string | undefined;
  let storeDir: string;

  beforeEach(async () => {
    previousFlag = process.env[PROGRESS_LEDGER_ENABLED_ENV];
    delete process.env[PROGRESS_LEDGER_ENABLED_ENV];
    storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-lh-cron-"));
    isCliProviderMock.mockReturnValue(true);
    invokeFallback();
    runCliAgentMock.mockResolvedValue({
      payloads: [{ text: "cli output" }],
      meta: { agentMeta: { usage: { input: 1, output: 1 } } },
    });
    runEmbeddedPiAgentMock.mockResolvedValue({
      payloads: [{ text: "embedded output" }],
      meta: { agentMeta: { usage: { input: 1, output: 1 } } },
    });
  });

  afterEach(async () => {
    if (previousFlag === undefined) {
      delete process.env[PROGRESS_LEDGER_ENABLED_ENV];
    } else {
      process.env[PROGRESS_LEDGER_ENABLED_ENV] = previousFlag;
    }
    await fs.rm(storeDir, { recursive: true, force: true });
  });

  function paramsFor(jobId: string) {
    return makeIsolatedAgentTurnParams({
      cfg: {
        cron: { store: path.join(storeDir, "jobs.json") },
      },
      job: makeIsolatedAgentTurnJob({
        id: jobId,
        description: longHorizonDescription(),
      }),
      message: "执行当前定时步",
    });
  }

  it("runs embedded Pi for a long-horizon job when the ledger flag is unset", async () => {
    expect(process.env[PROGRESS_LEDGER_ENABLED_ENV]).toBeUndefined();
    const result = await runCronIsolatedAgentTurn(paramsFor("job-ledger-off"));
    expect(result.status).toBe("ok");
    expect(runCliAgentMock).not.toHaveBeenCalled();
    expect(runEmbeddedPiAgentMock).toHaveBeenCalledOnce();
    const store = createFileLedgerStore({
      cronStorePath: path.join(storeDir, "jobs.json"),
      taskId: "job-ledger-off",
    });
    const ledger = foldEvents(await store.loadEvents());
    expect(ledger.acceptance).toHaveLength(2);
    expect(ledger.steps.find((item) => item.id === "E1")?.status).toBe("in_progress");
  });

  it("runs embedded Pi for an ordinary cron message when the ledger flag is unset", async () => {
    expect(process.env[PROGRESS_LEDGER_ENABLED_ENV]).toBeUndefined();
    const message = [
      "## 定时说明",
      "每日拉取京东与淘宝竞品价格",
      "## 验收标准",
      "- 已写出价差表",
    ].join("\n");
    const result = await runCronIsolatedAgentTurn(
      makeIsolatedAgentTurnParams({
        cfg: {
          cron: { store: path.join(storeDir, "jobs.json") },
        },
        job: makeIsolatedAgentTurnJob({
          id: "job-ordinary",
          description: "普通定时，没有 wizard meta",
          payload: { kind: "agentTurn", message },
        }),
        message,
      }),
    );
    expect(result.status).toBe("ok");
    expect(runCliAgentMock).not.toHaveBeenCalled();
    expect(runEmbeddedPiAgentMock).toHaveBeenCalledOnce();
    const store = createFileLedgerStore({
      cronStorePath: path.join(storeDir, "jobs.json"),
      taskId: "job-ordinary",
    });
    const ledger = foldEvents(await store.loadEvents());
    expect(ledger.acceptance.map((item) => item.text)).toEqual(["已写出价差表"]);
    expect(ledger.steps.find((item) => item.id === "E1")?.status).toBe("in_progress");
  });

  it("does not create a ledger session for a non-long-horizon job when the flag is off", async () => {
    expect(process.env[PROGRESS_LEDGER_ENABLED_ENV]).toBeUndefined();
    const result = await runCronIsolatedAgentTurn(
      makeIsolatedAgentTurnParams({
        cfg: {
          cron: { store: path.join(storeDir, "jobs.json") },
        },
        job: makeIsolatedAgentTurnJob({
          id: "job-plain",
          description: "普通提醒，没有验收",
        }),
        message: "hello",
      }),
    );
    expect(result.status).toBe("ok");
    expect(runCliAgentMock).toHaveBeenCalledOnce();
    expect(runEmbeddedPiAgentMock).not.toHaveBeenCalled();
    await expect(
      fs.access(path.join(storeDir, "progress-ledger", "job-plain.jsonl")),
    ).rejects.toThrow();
  });

  it("does not give tools to a non-qualifying cron on an API provider", async () => {
    expect(process.env[PROGRESS_LEDGER_ENABLED_ENV]).toBeUndefined();
    isCliProviderMock.mockReturnValue(false);
    runWithModelFallbackMock.mockImplementation(
      async (params: { run: (provider: string, model: string) => Promise<unknown> }) => {
        const result = await params.run("api-proxy-deepseek", "deepseek-v4-flash");
        return {
          result,
          provider: "api-proxy-deepseek",
          model: "deepseek-v4-flash",
          attempts: [],
        };
      },
    );

    for (const [index, message] of ["提醒我喝水", "每天 9 点提醒站会", "hello"].entries()) {
      runCliAgentMock.mockClear();
      runEmbeddedPiAgentMock.mockClear();
      const jobId = `job-vague-api-${index}`;
      const result = await runCronIsolatedAgentTurn(
        makeIsolatedAgentTurnParams({
          cfg: {
            cron: { store: path.join(storeDir, "jobs.json") },
          },
          job: makeIsolatedAgentTurnJob({
            id: jobId,
            description: "普通提醒，没有验收",
            payload: { kind: "agentTurn", message },
          }),
          message,
        }),
      );
      expect(result.status).toBe("ok");
      expect(runCliAgentMock).not.toHaveBeenCalled();
      expect(runEmbeddedPiAgentMock).toHaveBeenCalledOnce();
      const call = runEmbeddedPiAgentMock.mock.calls[0]?.[0] as { disableTools?: boolean };
      expect(call.disableTools).toBe(true);
      await expect(
        fs.access(path.join(storeDir, "progress-ledger", `${jobId}.jsonl`)),
      ).rejects.toThrow();
    }
  });

  it("replaces HEARTBEAT_OK on an ordinary reminder and still disables tools", async () => {
    expect(process.env[PROGRESS_LEDGER_ENABLED_ENV]).toBeUndefined();
    isCliProviderMock.mockReturnValue(false);
    runWithModelFallbackMock.mockImplementation(
      async (params: { run: (provider: string, model: string) => Promise<unknown> }) => {
        const result = await params.run("api-proxy-deepseek", "deepseek-v4-flash");
        return {
          result,
          provider: "api-proxy-deepseek",
          model: "deepseek-v4-flash",
          attempts: [],
        };
      },
    );
    runEmbeddedPiAgentMock.mockResolvedValue({
      payloads: [{ text: "HEARTBEAT_OK" }],
      meta: { agentMeta: { usage: { input: 20, output: 5 } } },
    });
    pickLastNonEmptyTextFromPayloadsMock.mockImplementation(
      (payloads: Array<{ text?: string }>) => {
        for (let index = payloads.length - 1; index >= 0; index -= 1) {
          const text = payloads[index]?.text?.trim();
          if (text) {
            return text;
          }
        }
        return undefined;
      },
    );
    const message = "提醒我喝水";
    const result = await runCronIsolatedAgentTurn(
      makeIsolatedAgentTurnParams({
        cfg: {
          cron: { store: path.join(storeDir, "jobs.json") },
        },
        job: makeIsolatedAgentTurnJob({
          id: "job-reminder-heartbeat",
          description: "普通提醒，没有验收",
          payload: { kind: "agentTurn", message },
        }),
        message,
      }),
    );
    expect(result.status).toBe("ok");
    expect(result.outputText).toBe("提醒：喝水");
    expect(result.outputText).not.toContain("HEARTBEAT_OK");
    expect(runCliAgentMock).not.toHaveBeenCalled();
    const call = runEmbeddedPiAgentMock.mock.calls[0]?.[0] as {
      disableTools?: boolean;
      omitHeartbeatPrompt?: boolean;
    };
    expect(call.disableTools).toBe(true);
    expect(call.omitHeartbeatPrompt).toBe(true);
    await expect(
      fs.access(path.join(storeDir, "progress-ledger", "job-reminder-heartbeat.jsonl")),
    ).rejects.toThrow();
  });

  it("still gives tools to a qualifying cron on an API provider when the ledger flag is unset", async () => {
    expect(process.env[PROGRESS_LEDGER_ENABLED_ENV]).toBeUndefined();
    isCliProviderMock.mockReturnValue(false);
    runWithModelFallbackMock.mockImplementation(
      async (params: { run: (provider: string, model: string) => Promise<unknown> }) => {
        const result = await params.run("api-proxy-deepseek", "deepseek-v4-flash");
        return {
          result,
          provider: "api-proxy-deepseek",
          model: "deepseek-v4-flash",
          attempts: [],
        };
      },
    );
    const message = [
      "目标：把 example.com 的标题写入文件",
      "验收：文件内容包含 Example Domain",
    ].join("\n");
    const result = await runCronIsolatedAgentTurn(
      makeIsolatedAgentTurnParams({
        cfg: {
          cron: { store: path.join(storeDir, "jobs.json") },
        },
        job: makeIsolatedAgentTurnJob({
          id: "job-qualify-api",
          description: "普通定时，没有 wizard meta",
          payload: { kind: "agentTurn", message },
        }),
        message,
      }),
    );
    expect(result.status).toBe("ok");
    expect(runCliAgentMock).not.toHaveBeenCalled();
    expect(runEmbeddedPiAgentMock).toHaveBeenCalledOnce();
    const call = runEmbeddedPiAgentMock.mock.calls[0]?.[0] as { disableTools?: boolean };
    expect(call.disableTools).not.toBe(true);
    const store = createFileLedgerStore({
      cronStorePath: path.join(storeDir, "jobs.json"),
      taskId: "job-qualify-api",
    });
    const ledger = foldEvents(await store.loadEvents());
    expect(ledger.acceptance.length).toBeGreaterThan(0);
    expect(ledger.steps.find((item) => item.id === "E1")?.status).toBe("in_progress");
  });

  it("runs embedded Pi for a CLI provider and prompts only the current step", async () => {
    process.env[PROGRESS_LEDGER_ENABLED_ENV] = "1";
    runEmbeddedPiAgentMock.mockImplementation(
      async (args: {
        prompt?: string;
        onAgentEvent?: (evt: {
          stream: string;
          data: Record<string, unknown>;
        }) => Promise<void> | void;
      }) => {
        await args.onAgentEvent?.({
          stream: "assistant",
          data: { text: "助手正文不应进入账本" },
        });
        await args.onAgentEvent?.({ stream: "tool", data: { phase: "start", name: "write" } });
        await args.onAgentEvent?.({
          stream: "tool",
          data: { phase: "result", name: "write", isError: false },
        });
        return {
          payloads: [{ text: "embedded output" }],
          meta: { agentMeta: { usage: { input: 1, output: 1 } } },
        };
      },
    );

    const result = await runCronIsolatedAgentTurn(paramsFor("job-ledger-on"));
    expect(result.status).toBe("ok");
    expect(runCliAgentMock).not.toHaveBeenCalled();
    expect(runEmbeddedPiAgentMock).toHaveBeenCalledOnce();
    const call = runEmbeddedPiAgentMock.mock.calls[0]?.[0] as {
      prompt?: string;
      extraSystemPrompt?: string;
    };
    const prompt = String(call.prompt ?? "");
    const extra = String(call.extraSystemPrompt ?? "");
    expect(prompt).toContain("step id: E1");
    expect(prompt).toContain(`title: ${FIRST_RULE}`);
    expect(prompt).toContain("acceptance id: A1");
    expect(prompt).toContain("This tick does only this step.");
    expect(prompt).toContain("You must use a tool to complete this step.");
    expect(prompt).toContain("Plain text is not completion.");
    expect(prompt).toContain("Do not do later steps.");
    expect(prompt).not.toContain(SECOND_RULE);
    expect(extra).not.toContain(SECOND_RULE);
    expect(extra).toContain(FIRST_RULE);

    const store = createFileLedgerStore({
      cronStorePath: path.join(storeDir, "jobs.json"),
      taskId: "job-ledger-on",
    });
    const events = await store.loadEvents();
    const ledger = foldEvents(events);
    expect(ledger.acceptance.find((item) => item.id === "A1")?.status).toBe("met");
    expect(ledger.acceptance.find((item) => item.id === "A2")?.status).toBe("unknown");
    expect(ledger.steps.find((item) => item.id === "E1")?.status).toBe("completed");
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("cron_runtime");
    expect(serialized).not.toContain("cron-tick-v1");
    expect(serialized).not.toContain("助手正文不应进入账本");
    expect(serialized).not.toContain("cron:job-ledger-on:");
    const met = events.find((event) => event.type === "ACCEPTANCE_MET");
    expect(met?.payload.evidence).toMatchObject({
      type: "tool_result",
      source: "write",
      verification: "passed",
    });
  });

  it("does not meet acceptance when the tick returns text and no tool", async () => {
    process.env[PROGRESS_LEDGER_ENABLED_ENV] = "1";
    const result = await runCronIsolatedAgentTurn(paramsFor("job-text-only"));
    expect(result.status).toBe("ok");
    expect(runCliAgentMock).not.toHaveBeenCalled();
    expect(runEmbeddedPiAgentMock).toHaveBeenCalledOnce();
    const store = createFileLedgerStore({
      cronStorePath: path.join(storeDir, "jobs.json"),
      taskId: "job-text-only",
    });
    const ledger = foldEvents(await store.loadEvents());
    expect(ledger.acceptance.every((item) => item.status !== "met")).toBe(true);
    expect(ledger.steps.find((item) => item.id === "E1")?.status).not.toBe("completed");
  });

  it("records an error without a second embedded run when the tick times out", async () => {
    process.env[PROGRESS_LEDGER_ENABLED_ENV] = "1";
    runEmbeddedPiAgentMock.mockRejectedValue(new Error("cron timeout"));
    const result = await runCronIsolatedAgentTurn(paramsFor("job-timeout"));
    expect(result.status).toBe("error");
    expect(runEmbeddedPiAgentMock).toHaveBeenCalledOnce();
    expect(runCliAgentMock).not.toHaveBeenCalled();
    const store = createFileLedgerStore({
      cronStorePath: path.join(storeDir, "jobs.json"),
      taskId: "job-timeout",
    });
    const ledger = foldEvents(await store.loadEvents());
    expect(ledger.acceptance.every((item) => item.status !== "met")).toBe(true);
    expect(ledger.steps.every((step) => step.status !== "completed")).toBe(true);
  });

  it("does not run a model when the ledger has no writable step", async () => {
    process.env[PROGRESS_LEDGER_ENABLED_ENV] = "1";
    const job = {
      id: "job-done",
      description: longHorizonDescription(),
    };
    const store = createFileLedgerStore({
      cronStorePath: path.join(storeDir, "jobs.json"),
      taskId: job.id,
    });
    for (const atMs of [1_000, 3_000]) {
      await observeCronToolEvent({
        store,
        job,
        phase: "result",
        toolName: "write",
        atMs,
      });
      await finalizeCronRun({
        store,
        job,
        status: "ok",
        sawToolSuccess: true,
        atMs: atMs + 500,
      });
    }
    const before = foldEvents(await store.loadEvents());
    expect(before.completed).toBe(true);

    const result = await runCronIsolatedAgentTurn(paramsFor("job-done"));
    expect(result.status).toBe("ok");
    expect(runEmbeddedPiAgentMock).not.toHaveBeenCalled();
    expect(runCliAgentMock).not.toHaveBeenCalled();
  });
});
