import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { FollowupRun } from "../../auto-reply/reply/queue.js";
import { emptyControlSnapshot } from "../command/rule-adaptation/index.js";
import { loadRuleLibrary } from "../command/rule-adaptation/index.js";
import { buildShadowResult } from "../command/rule-adaptation/index.js";
import { createBudgetTracker } from "../model/rule-adaptation/index.js";
import { sessionTaskState } from "../state/index.js";
import { resolveDynamicExecutionConstraints } from "./dynamic-rule-constraints.js";
import type { recordNormalTaskRuleAdvice } from "./interaction-turn.js";

const dirs: string[] = [];

function tempSession(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rule-agent-decision-"));
  dirs.push(dir);
  return path.join(dir, "session.jsonl");
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function runFor(file: string): FollowupRun["run"] {
  return {
    agentId: "fixture",
    agentDir: path.dirname(file),
    sessionId: "session",
    sessionFile: file,
    workspaceDir: path.dirname(file),
    config: {},
    provider: "fixture",
    model: "fixture",
    timeoutMs: 1_000,
    executionAdmitted: true,
    taskCompletionBinding: { taskId: "task-1" },
  } as FollowupRun["run"];
}

function advise(): typeof recordNormalTaskRuleAdvice {
  return async () => {
    const budget = createBudgetTracker(undefined, Date.now);
    return {
      result: buildShadowResult({
        outcomeCode: "no_change_needed",
        reasons: [],
        usage: budget.usage(),
        limits: budget.limits,
        exhausted: [],
        preEnforcedExhausted: [],
        postAccountedExhausted: [],
        deadlineCleanupFailed: false,
        sessionDisposeFailed: false,
        usageKnown: true,
        underlyingRequestStopped: true,
        usageAccountingAttempted: false,
        usageAccountingStatus: "not_attempted",
        governanceOccupancyReady: false,
        controlBefore: emptyControlSnapshot(),
        controlAfter: emptyControlSnapshot(),
        controlUnchanged: true,
        toolsInvoked: [],
        rejectedTools: [],
        businessAttempts: [],
        candidateToolInvoked: false,
        diagnosedBeforeRetrieval: false,
      }),
      currentTokens: 32_000,
      ruleVersion: "inventory:test",
    };
  };
}

it("updates the library on a gap and the next admitted decision uses it", async () => {
  const file = tempSession();
  vi.spyOn(sessionTaskState, "bindingCurrent").mockReturnValue(true);
  const stub = vi.fn(advise());
  const input = {
    run: runFor(file),
    fallback: "legacy" as const,
    input: {
      runId: "run-1",
      sessionFile: file,
      provider: "fixture",
      modelId: "fixture",
    },
    advise: stub,
  };
  const first = await resolveDynamicExecutionConstraints({
    ...input,
    commandBody: "上下文太大，请收紧窗口",
  });
  expect(first.snapshot?.effectiveTokens).toBe(24_000);
  expect(first.snapshot?.originalTokens).toBe(32_000);
  expect(loadRuleLibrary(file).entries[0]).toMatchObject({
    problem: "gap",
    parameter: 24_000,
  });

  const second = await resolveDynamicExecutionConstraints({
    ...input,
    commandBody: "上下文太大，再看一次",
    input: { ...input.input, runId: "run-2" },
  });
  expect(second.snapshot?.effectiveTokens).toBe(24_000);
  expect(loadRuleLibrary(file).revision).toBe(1);
  expect(second.snapshot?.policyHash).not.toBe(first.snapshot?.policyHash);
  expect(stub).toHaveBeenCalledTimes(2);
});

it("writes an inapplicable ordinary-task rule instead of reusing the pressure cap", async () => {
  const file = tempSession();
  vi.spyOn(sessionTaskState, "bindingCurrent").mockReturnValue(true);
  const stub = advise();
  await resolveDynamicExecutionConstraints({
    run: runFor(file),
    commandBody: "上下文太大",
    fallback: "legacy",
    input: { runId: "run-1", sessionFile: file, provider: "fixture", modelId: "fixture" },
    advise: stub,
  });
  const ordinary = await resolveDynamicExecutionConstraints({
    run: runFor(file),
    commandBody: "请回复这封短消息",
    fallback: "legacy",
    input: { runId: "run-2", sessionFile: file, provider: "fixture", modelId: "fixture" },
    advise: stub,
  });
  expect(ordinary.snapshot?.effectiveTokens).toBe(32_000);
  const again = await resolveDynamicExecutionConstraints({
    run: runFor(file),
    commandBody: "请再回复一句",
    fallback: "legacy",
    input: { runId: "run-3", sessionFile: file, provider: "fixture", modelId: "fixture" },
    advise: stub,
  });
  expect(again.snapshot?.effectiveTokens).toBe(32_000);
  expect(loadRuleLibrary(file).revision).toBe(2);
  expect(loadRuleLibrary(file).entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sceneClass: "ordinary_task", disposition: "keep_resolved" }),
      expect.objectContaining({ sceneClass: "context_pressure", parameter: 24_000 }),
    ]),
  );
});

it("does not open the library when the turn has no admitted binding", async () => {
  const file = tempSession();
  const stub = vi.fn(advise());
  const run = runFor(file);
  run.taskCompletionBinding = undefined;
  const decision = await resolveDynamicExecutionConstraints({
    run,
    commandBody: "上下文太大",
    fallback: "legacy",
    input: { runId: "run-1", sessionFile: file, provider: "fixture", modelId: "fixture" },
    advise: stub,
  });
  expect(decision.snapshot).toBeUndefined();
  expect(decision).toEqual({ mode: "dynamic", fallback: "legacy" });
  expect(stub).not.toHaveBeenCalled();
  expect(fs.existsSync(`${file}.rule-library.json`)).toBe(false);
});
