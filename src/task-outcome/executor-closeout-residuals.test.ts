/**
 * Executor closeout: budget gate blocks the next model call, unknown cost is
 * not stored as zero, parent attribution does not double-count, subagent
 * persists its own entrypoint, external observations are not task judgements.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { recordRunOutcome } from "../gateway/agent-growth/operational-metrics-store.js";
import { readOperationalMetrics } from "../gateway/agent-growth/operational-metrics-store.js";
import { ensureChatTurnTaskOutcome } from "./chat-entry.js";
import { ensureSubagentTurnTaskOutcome } from "./entrypoint-ensure.js";
import {
  clearAwaitingDeliveriesForTests,
  listStaleAwaitingDeliveries,
  registerAwaitingDelivery,
} from "./pending-delivery.js";
import { TaskOutcomeResultService } from "./result-service.js";
import {
  assertRunnerTurnBudgetAllowsModelCall,
  chargeModelCallAgainstTip,
  classifyTipBudgetCostFromUsage,
  TaskBudgetExceededError,
} from "./runtime-from-runner.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";

function cfgFor(agentDir: string): OpenBotConfig {
  return {
    agents: { list: [{ id: "bot", agentDir }] },
  } as OpenBotConfig;
}

describe("executor closeout cost evidence", () => {
  it("prices explicit zero separately from missing cost config", () => {
    const unknown = classifyTipBudgetCostFromUsage({
      usage: { input: 100, output: 50 },
      provider: "openai",
      model: "gpt-4o",
    });
    expect(unknown).toEqual({ evidence: "unknown" });

    const knownZero = classifyTipBudgetCostFromUsage({
      usage: { input: 1_000, output: 1_000 },
      provider: "openai",
      model: "free-test",
      config: {
        models: {
          providers: {
            openai: {
              models: [
                {
                  id: "free-test",
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                },
              ],
            },
          },
        },
      } as never,
    });
    expect(knownZero.evidence).toBe("known");
    expect(knownZero.costUsd).toBe(0);
  });
});

describe("executor closeout budget gate", () => {
  let agentDir = "";
  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "exec-closeout-"));
  });
  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
    clearAwaitingDeliveriesForTests();
  });

  it("unknown cost does not become spent zero, and the next call is not invoked", () => {
    const cfg = cfgFor(agentDir);
    const opened = ensureChatTurnTaskOutcome(cfg, {
      agentId: "bot",
      runId: "run-1",
      subjectRef: "subject:closeout",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const service = new TaskOutcomeResultService({ store, submittedBy: "test" });
    const seeded = store.loadTask(opened.taskId);
    expect(seeded?.budget).toBeTruthy();
    service.submit(
      opened.taskId,
      {
        type: "set_budget",
        budget: { ...seeded!.budget!, maxIterations: 1 },
        expectedVersion: seeded!.outcomeVersion,
        fencingToken: opened.fencingToken,
      },
      { requiredScope: opened.scope },
    );
    let modelCalls = 0;
    const invoke = () => {
      assertRunnerTurnBudgetAllowsModelCall(cfg, "bot", {
        taskId: opened.taskId,
        scope: opened.scope,
      });
      modelCalls += 1;
      chargeModelCallAgainstTip(cfg, "bot", {
        taskId: opened.taskId,
        scope: opened.scope,
        runId: "run-1",
        callSeq: modelCalls,
        usage: { input: 10, output: 10 },
        provider: "openai",
        model: "no-price",
      });
    };
    invoke();
    expect(modelCalls).toBe(1);
    const after = store.loadTask(opened.taskId);
    expect(after?.budget?.spentCostUsd).toBe(0);
    expect(after?.budget?.unknownCostCharges).toBe(1);
    expect(after?.budget?.iterationCount).toBe(1);
    expect(() => invoke()).toThrow(TaskBudgetExceededError);
    expect(modelCalls).toBe(1);
  });

  it("known zero is not counted as unknown and does not inflate spentCostUsd", () => {
    const cfg = cfgFor(agentDir);
    const opened = ensureChatTurnTaskOutcome(cfg, {
      agentId: "bot",
      runId: "run-zero",
      subjectRef: "subject:closeout",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    const priced = {
      models: {
        providers: {
          openai: {
            models: [
              { id: "free-test", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
            ],
          },
        },
      },
    };
    chargeModelCallAgainstTip({ ...cfg, ...priced } as unknown as OpenBotConfig, "bot", {
      taskId: opened.taskId,
      scope: opened.scope,
      runId: "run-zero",
      callSeq: 1,
      usage: { input: 5, output: 5 },
      provider: "openai",
      model: "free-test",
    });
    const tip = new DurableTaskOutcomeStore(
      path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME),
    ).loadTask(opened.taskId);
    expect(tip?.budget?.spentCostUsd).toBe(0);
    expect(tip?.budget?.knownZeroCostCharges).toBe(1);
    expect(tip?.budget?.unknownCostCharges ?? 0).toBe(0);
  });

  it("attributes a child call once onto the parent and blocks the next child call", () => {
    const cfg = cfgFor(agentDir);
    const parent = ensureChatTurnTaskOutcome(cfg, {
      agentId: "bot",
      runId: "parent-run",
      subjectRef: "subject:closeout",
    });
    const child = ensureSubagentTurnTaskOutcome(cfg, {
      agentId: "bot",
      runId: "child-run",
      subjectRef: "subject:closeout",
      parentTaskId: parent.ok ? parent.taskId : undefined,
    });
    expect(parent.ok && child.ok).toBe(true);
    if (!parent.ok || !child.ok) {
      return;
    }
    expect(child.record.entrypoint).toBe("subagent");
    expect(child.record.parentTaskId).toBe(parent.taskId);
    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const service = new TaskOutcomeResultService({ store, submittedBy: "test" });
    const parentTip = store.loadTask(parent.taskId);
    expect(parentTip?.budget).toBeTruthy();
    const tightened = service.submit(
      parent.taskId,
      {
        type: "set_budget",
        budget: { ...parentTip!.budget!, maxIterations: 1 },
        expectedVersion: parentTip!.outcomeVersion,
        fencingToken: parent.fencingToken,
      },
      { requiredScope: parent.scope },
    );
    expect(tightened.ok).toBe(true);
    let calls = 0;
    const invoke = () => {
      assertRunnerTurnBudgetAllowsModelCall(cfg, "bot", {
        taskId: child.taskId,
        scope: child.scope,
        parentTaskId: parent.taskId,
        parentAgentId: "bot",
      });
      calls += 1;
      chargeModelCallAgainstTip(cfg, "bot", {
        taskId: child.taskId,
        scope: child.scope,
        runId: "child-run",
        callSeq: calls,
        usage: { input: 1, output: 1 },
        provider: "openai",
        model: "no-price",
        parentTaskId: parent.taskId,
        parentAgentId: "bot",
      });
    };
    invoke();
    chargeModelCallAgainstTip(cfg, "bot", {
      taskId: child.taskId,
      scope: child.scope,
      runId: "child-run",
      callSeq: 1,
      usage: { input: 1, output: 1 },
      provider: "openai",
      model: "no-price",
      parentTaskId: parent.taskId,
      parentAgentId: "bot",
    });
    const parentAfter = store.loadTask(parent.taskId);
    const childAfter = store.loadTask(child.taskId);
    expect(childAfter?.budget?.iterationCount).toBe(1);
    expect(parentAfter?.budget?.iterationCount ?? 0).toBe(0);
    expect(parentAfter?.budget?.childAttributedIterations).toBe(1);
    expect(parentAfter?.budget?.spentCostUsd ?? 0).toBe(0);
    expect(() => invoke()).toThrow(TaskBudgetExceededError);
    expect(calls).toBe(1);
  });

  it("does not count an external observation as a task success", async () => {
    const cfg = cfgFor(agentDir);
    await recordRunOutcome(cfg, "bot", {
      success: true,
      runId: "canary-obs",
      countsAsTaskJudgement: false,
    });
    const metrics = await readOperationalMetrics(cfg, "bot");
    expect(metrics?.tasksTotal ?? 0).toBe(0);
    expect(metrics?.tasksSucceeded ?? 0).toBe(0);
  });

  it("lists stale pending deliveries without clearing them", () => {
    registerAwaitingDelivery({
      taskId: "task-old",
      deliveryId: "delivery-old",
      agentId: "bot",
      runId: "run-old",
    });
    const stale = listStaleAwaitingDeliveries(Date.now() + 60 * 60 * 1000, 1_000);
    expect(stale.map((row) => row.taskId)).toContain("task-old");
    expect(listStaleAwaitingDeliveries(Date.now(), 60 * 60 * 1000)).toEqual([]);
    expect(listStaleAwaitingDeliveries(Date.now() + 60 * 60 * 1000, 1_000)).toHaveLength(1);
  });
});

describe("executor closeout CLI entry blocks the next model call", () => {
  const runtime = {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(() => {
      throw new Error("exit");
    }),
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("agentCommand does not invoke the embedded runner once the tip iteration budget is spent", async () => {
    vi.resetModules();
    vi.doMock("../agent-runtime/execution/runner/embedded-run.js", () => ({
      runEmbeddedPiAgent: vi.fn(async () => ({
        payloads: [{ text: "ok" }],
        meta: {
          durationMs: 5,
          agentMeta: {
            sessionId: "s",
            provider: "openai",
            model: "gpt-4o",
            usage: { input: 1, output: 1 },
          },
        },
      })),
    }));
    vi.doMock("../agents/cli-runner.js", () => ({ runCliAgent: vi.fn() }));
    vi.doMock("../agents/model-catalog.js", () => ({ loadModelCatalog: vi.fn(async () => []) }));
    vi.doMock("../gateway/billing/agent-run-governance.js", () => ({
      tryAcquireEnterpriseAgentRun: vi.fn(async () => ({ acquired: false, skipped: true })),
      releaseEnterpriseAgentRun: vi.fn(async () => {}),
    }));
    const embedded = await import("../agent-runtime/execution/runner/embedded-run.js");
    const { agentCommand } = await import("../commands/agent.js");
    const configModule = await import("../config/config.js");
    const { withTempHome } = await import("../../test/helpers/temp-home.js");
    const { cliTurnTaskId } = await import("./entrypoint-ensure.js");

    await withTempHome(
      async (home) => {
        const agentDir = path.join(home, "agent-main");
        fs.mkdirSync(agentDir, { recursive: true });
        const cfg = {
          agents: {
            defaults: {
              model: { primary: "openai/gpt-4o" },
              models: { "openai/gpt-4o": {} },
              workspace: path.join(home, "workspace"),
            },
            list: [{ id: "main", default: true, agentDir }],
          },
          session: { store: path.join(home, "sessions.json"), mainKey: "main" },
        } as OpenBotConfig;
        vi.spyOn(configModule, "loadConfig").mockReturnValue(cfg);
        vi.spyOn(configModule, "readConfigFileSnapshotForWrite").mockResolvedValue({
          snapshot: { valid: false, resolved: {} as OpenBotConfig },
          writeOptions: {},
        } as Awaited<ReturnType<typeof configModule.readConfigFileSnapshotForWrite>>);
        const modelSelection = await import("../agents/model-selection.js");
        vi.spyOn(modelSelection, "isCliProvider").mockReturnValue(false);

        const runId = "cli-budget-block";
        await agentCommand(
          {
            message: "hello",
            to: "+15550001",
            agentId: "main",
            runId,
            gatewayClientUser: "ops@example.com",
          },
          runtime,
        );
        expect(vi.mocked(embedded.runEmbeddedPiAgent)).toHaveBeenCalledTimes(1);

        const taskId = cliTurnTaskId({ agentId: "main", runId });
        const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
        const tip = store.loadTask(taskId);
        expect(tip?.entrypoint).toBe("cli");
        expect(tip?.budget?.iterationCount).toBeGreaterThanOrEqual(1);
        expect(tip?.budget?.unknownCostCharges).toBeGreaterThanOrEqual(1);
        expect(tip?.budget?.spentCostUsd).toBe(0);
        const service = new TaskOutcomeResultService({ store, submittedBy: "test" });
        const tightened = service.submit(
          taskId,
          {
            type: "set_budget",
            budget: {
              ...tip!.budget!,
              maxIterations: tip!.budget!.iterationCount,
            },
            expectedVersion: tip!.outcomeVersion,
            fencingToken: tip!.fencingToken ?? "",
          },
          { requiredScope: tip!.scope },
        );
        expect(tightened.ok).toBe(true);

        await expect(
          agentCommand(
            {
              message: "again",
              to: "+15550001",
              agentId: "main",
              runId,
              gatewayClientUser: "ops@example.com",
            },
            runtime,
          ),
        ).rejects.toMatchObject({ name: "TaskBudgetExceededError" });
        expect(vi.mocked(embedded.runEmbeddedPiAgent)).toHaveBeenCalledTimes(1);
      },
      { prefix: "exec-cli-budget-" },
    );
  });
});
