/**
 * Supervisor rounds and the TaskOutcome tip share one budget.
 * The worker port counts dispatches: exhaustion must not call it again.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAgentDir } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import type { ExecutionContext } from "../fabric/worker/types.js";
import {
  superviseTick,
  type SupervisorPorts,
  type WorkerPort,
} from "../gateway/supervisor/engine.js";
import type { SupervisedTask } from "../gateway/supervisor/types.js";
import { DEFAULT_SUPERVISOR_BUDGET } from "../gateway/supervisor/types.js";
import { chargeModelCallAgainstTip, TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
import {
  prepareSupervisorRoundBudget,
  resolveSupervisorLedgerTaskId,
  supervisorLedgerAgentId,
} from "./supervisor-tip-budget.js";

function makeTask(taskId: string, maxIterations: number): SupervisedTask {
  const now = new Date().toISOString();
  return {
    taskId,
    goal: "ship the fix",
    repoRoot: `/repo/${taskId}`,
    agentId: "bot",
    worker: { backendId: "openai", model: "gpt-test" },
    workspace: { id: `ws-${taskId}`, root: `/ws/${taskId}`, kind: "directory" },
    acceptance: {
      steps: [{ id: "test", argv: ["npm", "test"], required: true }],
      source: "repo-detected",
    },
    state: "planned",
    iterations: [],
    budget: { ...DEFAULT_SUPERVISOR_BUDGET, maxIterations, spentCostUsd: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

function ports(dispatch: WorkerPort["dispatch"]): SupervisorPorts {
  const context: ExecutionContext = {
    identity: { policy: "enterprise_shared", status: "validated" },
    placement: { placement: "gateway", executor: "gateway", fallback: "escalate" },
    attribution: { workerId: "openai" },
  };
  return {
    executionContext: { resolve: async () => context },
    worker: { dispatch },
    validator: {
      validate: async () => ({
        passed: false,
        at: new Date().toISOString(),
        steps: [{ id: "test", argv: ["npm", "test"], exitCode: 1, ok: false, durationMs: 1 }],
      }),
    },
    workspace: {
      ensure: async (task) => ({
        id: `ws-${task.taskId}`,
        root: `/ws/${task.taskId}`,
        kind: "directory" as const,
      }),
    },
  };
}

describe("supervisor tip ledger", () => {
  let agentDir = "";

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "sup-tip-"));
  });

  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  function cfg(): OpenBotConfig {
    return { agents: { list: [{ id: "bot", agentDir }] } } as OpenBotConfig;
  }

  function tickOpts(config: OpenBotConfig) {
    return {
      env: { OPENBOT_SUPERVISOR_ENABLED: "1" },
      readConfig: () => false,
      config,
    };
  }

  it("charges the tip once and does not dispatch the next round after the shared limit", async () => {
    const config = cfg();
    let calls = 0;
    const task = makeTask("sup-one-ledger", 1);
    const first = await superviseTick(
      task,
      ports(async () => {
        calls += 1;
        return { summary: "round", exitCode: 1, usage: { input: 20, output: 10 } };
      }),
      tickOpts(config),
    );
    expect(calls).toBe(1);
    expect(first.state).toBe("fixing");
    expect(first.budget.iterationCount).toBe(1);
    expect(first.budget.spentCostUsd).toBe(0);

    const store = new DurableTaskOutcomeStore(
      path.join(resolveAgentDir(config, "bot"), TASK_OUTCOME_STORE_DIRNAME),
    );
    const tip = store.loadTask(resolveSupervisorLedgerTaskId(config, task));
    expect(tip?.entrypoint).toBe("supervisor");
    expect(tip?.budget?.iterationCount).toBe(1);
    expect(tip?.budget?.unknownCostCharges).toBe(1);
    expect(tip?.budget?.spentCostUsd).toBe(0);
    expect(first.budget.spentCostUsd).toBe(tip?.budget?.spentCostUsd);

    const second = await superviseTick(
      first,
      ports(async () => {
        calls += 1;
        return { summary: "should-not-run", exitCode: 1 };
      }),
      tickOpts(config),
    );
    expect(calls).toBe(1);
    expect(second.state).toBe("max_iterations");
    expect(
      store.loadTask(resolveSupervisorLedgerTaskId(config, task))?.budget?.iterationCount,
    ).toBe(1);
  });

  it("a tip charge outside the supervisor blocks the worker before dispatch", async () => {
    const config = cfg();
    const task = makeTask("sup-external-charge", 1);
    const prepared = prepareSupervisorRoundBudget(config, task);
    expect(prepared.stop).toBeUndefined();
    const ledgerId = resolveSupervisorLedgerTaskId(config, task);
    chargeModelCallAgainstTip(config, supervisorLedgerAgentId(task), {
      taskId: ledgerId,
      scope: {
        kind: "personal",
        personalDomainId: "personal:subject:supervisor",
        subjectRef: "subject:supervisor",
        authzScopeRef: "supervisor-entry",
      },
      runId: task.taskId,
      callSeq: 0,
      provider: "openai",
      model: "gpt-test",
    });

    let calls = 0;
    const result = await superviseTick(
      task,
      ports(async () => {
        calls += 1;
        return { summary: "nope", exitCode: 1 };
      }),
      tickOpts(config),
    );
    expect(calls).toBe(0);
    expect(result.state).toBe("max_iterations");
    expect(result.budget.iterationCount).toBe(1);
    expect(result.budget.spentCostUsd).toBe(0);
  });
});
