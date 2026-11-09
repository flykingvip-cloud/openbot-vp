/**
 * Isolation-only model-call identity proofs.
 * Injected transport only. No gateway and no external model call.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { retainEmbeddedFailureUsage } from "../agent-runtime/execution/runner/embedded-failure-usage.js";
import { runWithModelFallback } from "../agents/model-fallback.js";
import type { TrustedScope } from "../task-outcome/types.js";
import { runIsolatedGovernedModelCall } from "./governed-model-entry.js";
import {
  currentExecutorModelCall,
  finishModelCall,
  getModelCall,
  loadPersistedModelCalls,
  observeModelCandidate,
  resetModelCallsForTests,
  usageFingerprint,
  type ExecutorEvidenceContext,
} from "./model-call-evidence.js";

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:evidence",
  subjectRef: "user:evidence",
  authzScopeRef: "scope:isolation",
};

const roots: string[] = [];

function context(runId = "run-1"): ExecutorEvidenceContext {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "executor-evidence-call-"));
  roots.push(storeRoot);
  return {
    agentId: "bot",
    scope,
    taskId: "task-1",
    runId,
    storeRoot,
    provenance: "injected",
    collector: "isolation",
  };
}

beforeEach(() => {
  process.env.OPENBOT_EXECUTOR_EVIDENCE = "1";
});

afterEach(() => {
  resetModelCallsForTests();
  delete process.env.OPENBOT_EXECUTOR_EVIDENCE;
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("ModelCallEvidence", () => {
  it("allocates callId before the transport returns and keeps it through completion", async () => {
    const ctx = context();
    let seen = "";
    const result = await observeModelCandidate({
      context: ctx,
      attemptIndex: 0,
      provider: "local",
      model: "fake",
      run: async (identity) => {
        seen = identity?.callId ?? "";
        expect(getModelCall(seen)?.status).toBe("unknown");
        expect(getModelCall(seen)?.completedAt).toBeNull();
        return { meta: { agentMeta: { usage: { input: 3, output: 4 } } } };
      },
    });
    const evidence = getModelCall(seen);
    expect(result.meta.agentMeta.usage.input).toBe(3);
    expect(evidence?.callId).toBe(seen);
    expect(evidence?.status).toBe("completed");
    expect(evidence?.usage).toEqual({ input: 3, output: 4, cacheRead: null, cacheWrite: null });
    expect(evidence?.usageAggregation).toBe("provider_aggregate_internal_retries_unknown");
    expect(evidence?.providerRequestId).toBeNull();
    expect(evidence?.completedAt).toBeGreaterThanOrEqual(evidence?.startedAt ?? 0);
    expect(evidence?.observedAt).toBeGreaterThanOrEqual(evidence?.startedAt ?? 0);
    const persisted = loadPersistedModelCalls(ctx.storeRoot!);
    expect(persisted.some((row) => row.callId === seen)).toBe(true);
  });

  it("gives fallback candidates distinct attempt ids and does not invent provider retries", async () => {
    const ctx = context("run-fb");
    const ids: string[] = [];
    for (const index of [0, 1]) {
      await observeModelCandidate({
        context: ctx,
        attemptIndex: index,
        provider: index === 0 ? "local" : "other",
        model: "fake",
        run: async (identity) => {
          ids.push(identity?.attemptId ?? "");
          return { ok: true };
        },
      });
    }
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toContain(":fallback:0:");
    expect(ids[1]).toContain(":fallback:1:");
    expect(ids[0]).not.toBe(ctx.runId);
  });

  it("keeps the first finish when completion is repeated or out of order", async () => {
    const ctx = context("run-order");
    const started: string[] = [];
    const pending: Array<(usage: { input: number; output: number }) => void> = [];
    const runs = [0, 1].map((index) =>
      observeModelCandidate({
        context: ctx,
        attemptIndex: index,
        provider: "local",
        model: "fake",
        run: (identity) =>
          new Promise((resolve) => {
            started.push(identity?.callId ?? "");
            pending.push((usage) => {
              const call = getModelCall(identity!.callId)!;
              finishModelCall(call, {
                status: "completed",
                usage,
                usageSource: "callback",
                usageAggregation: "per_call",
              });
              finishModelCall(call, {
                status: "completed",
                usage: { input: 999, output: 999 },
                usageSource: "duplicate-callback",
              });
              resolve({ ok: true });
            });
          }),
      }),
    );
    await Promise.resolve();
    pending[1]?.({ input: 1, output: 9 });
    pending[0]?.({ input: 8, output: 1 });
    await Promise.all(runs);
    expect(usageFingerprint(getModelCall(started[0])!.usage)).not.toBe(
      usageFingerprint(getModelCall(started[1])!.usage),
    );
    expect(getModelCall(started[0])?.usage).toEqual({
      input: 8,
      output: 1,
      cacheRead: null,
      cacheWrite: null,
    });
    expect(getModelCall(started[0])?.usageSource).toBe("callback");
  });

  it("records failed, cancelled, and timed-out calls without turning missing usage into zero", async () => {
    const ctx = context("run-term");
    await expect(
      observeModelCandidate({
        context: ctx,
        attemptIndex: 0,
        provider: "local",
        model: "fake",
        classifyError: () => "error",
        run: async (identity) => {
          throw Object.assign(new Error("boom"), { callId: identity?.callId });
        },
      }),
    ).rejects.toThrow("boom");
    await expect(
      observeModelCandidate({
        context: ctx,
        attemptIndex: 1,
        provider: "local",
        model: "fake",
        classifyError: () => "cancelled",
        run: async () => {
          throw Object.assign(new Error("aborted"), { name: "AbortError" });
        },
      }),
    ).rejects.toThrow("aborted");
    await expect(
      observeModelCandidate({
        context: ctx,
        attemptIndex: 2,
        provider: "local",
        model: "fake",
        classifyError: () => "timeout",
        run: async () => {
          throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
        },
      }),
    ).rejects.toThrow("timed out");
    const persisted = loadPersistedModelCalls(ctx.storeRoot!);
    const byCause = new Map(persisted.map((row) => [row.terminalCause, row]));
    expect(byCause.get("error")?.status).toBe("failed");
    expect(byCause.get("cancelled")?.status).toBe("cancelled");
    expect(byCause.get("timeout")?.status).toBe("failed");
    for (const row of persisted) {
      expect(row.usage).toEqual({ input: null, output: null, cacheRead: null, cacheWrite: null });
    }
  });

  it("does not collect files when evidence collection is disabled", async () => {
    process.env.OPENBOT_EXECUTOR_EVIDENCE = "0";
    const ctx = context("run-off");
    const value = await observeModelCandidate({
      context: ctx,
      attemptIndex: 0,
      provider: "local",
      model: "fake",
      run: async () => "business-result",
    });
    expect(value).toBe("business-result");
    expect(fs.existsSync(path.join(ctx.storeRoot!, "executor-evidence"))).toBe(false);
  });

  it("returns the business result when evidence persistence throws", async () => {
    const ctx = context("run-throw");
    const blocker = path.join(ctx.storeRoot!, "not-a-directory");
    fs.writeFileSync(blocker, "x");
    ctx.storeRoot = blocker;
    const value = await observeModelCandidate({
      context: ctx,
      attemptIndex: 0,
      provider: "local",
      model: "fake",
      run: async () => 42,
    });
    expect(value).toBe(42);
  });

  it("threads call identity through runWithModelFallback without a network call", async () => {
    const ctx = context("run-fallback");
    const seen: string[] = [];
    const result = await runWithModelFallback({
      cfg: undefined,
      provider: "local",
      model: "fake",
      runId: "run-fallback",
      executorEvidence: ctx,
      run: async () => {
        seen.push(currentExecutorModelCall()?.callId ?? "");
        return { meta: { agentMeta: { usage: { input: 2, output: 2 } } } };
      },
    });
    expect(seen[0]).toMatch(/^call_/);
    expect(result.result.meta.agentMeta.usage.input).toBe(2);
    expect(loadPersistedModelCalls(ctx.storeRoot!).some((row) => row.callId === seen[0])).toBe(
      true,
    );
  });
});

describe("isolated governed model entry", () => {
  const base = () => ({
    purpose: "diagnosis",
    modelRef: "local/fake" as string | null,
    resolutionSource:
      "src/gateway/model-entitlement/employee-model-gate.ts#resolveEmployeeModelGate",
    configVersion: "cfg-1",
    agentId: "bot",
    scope,
    taskId: "task-gov",
    runId: "run-gov",
    storeRoot: context().storeRoot,
  });

  it("does not call transport for an unconfigured capability tag", async () => {
    let called = false;
    const result = await runIsolatedGovernedModelCall({
      ...base(),
      purpose: "high_quality_reasoning",
      resolutionSource: "high_quality_reasoning",
      admission: () => ({ allowed: true, configVersion: "cfg-1" }),
      transport: async () => {
        called = true;
        return {};
      },
    });
    expect(called).toBe(false);
    expect(result.fallback).toBe("rule_v1");
    expect(result.applied).toBe(false);
    expect(result.taskResultWritten).toBe(false);
  });

  it("falls back when admission is withdrawn before the call", async () => {
    let called = false;
    const result = await runIsolatedGovernedModelCall({
      ...base(),
      admission: () => ({ allowed: false, configVersion: "cfg-1" }),
      transport: async () => {
        called = true;
        return {};
      },
    });
    expect(called).toBe(false);
    expect(result.fallback).toBe("rule_v1");
  });

  it("falls back when admission is withdrawn while the request is waiting", async () => {
    let allowed = true;
    const result = await runIsolatedGovernedModelCall({
      ...base(),
      admission: () => ({ allowed, configVersion: "cfg-1" }),
      transport: async () => {
        allowed = false;
        return { usage: { input: 1, output: 1 } };
      },
    });
    expect(result.fallback).toBe("rule_v1");
    expect(result.evidence?.status).toBe("cancelled");
    expect(result.taskResultWritten).toBe(false);
    expect(result.applied).toBe(false);
  });

  it("falls back when the config version changes during the wait", async () => {
    let version = "cfg-1";
    const result = await runIsolatedGovernedModelCall({
      ...base(),
      admission: () => ({ allowed: true, configVersion: version }),
      transport: async () => {
        version = "cfg-2";
        return {};
      },
    });
    expect(result.fallback).toBe("rule_v1");
    expect(result.evidence?.status).toBe("cancelled");
  });

  it("falls back to rule_v1 on timeout and does not write a task result", async () => {
    const result = await runIsolatedGovernedModelCall({
      ...base(),
      timeoutMs: 20,
      admission: () => ({ allowed: true, configVersion: "cfg-1" }),
      transport: () => new Promise(() => {}),
    });
    expect(result.fallback).toBe("rule_v1");
    expect(result.evidence?.terminalCause).toBe("timeout");
    expect(result.evidence?.usage.input).toBeNull();
    expect(result.applied).toBe(false);
    expect(result.taskResultWritten).toBe(false);
  });
});

it("retains trusted failed candidate aggregate usage without claiming a single API call", async () => {
  const ctx = context();
  let id = "";
  const failure = new Error("failed candidate");
  await expect(
    observeModelCandidate({
      context: ctx,
      attemptIndex: 0,
      provider: "test",
      model: "a",
      run: async (identity) => {
        id = identity?.callId ?? "";
        throw retainEmbeddedFailureUsage(
          failure,
          { runId: ctx.runId, provider: "test", model: "a" },
          { input: 7, output: 3 },
        );
      },
    }),
  ).rejects.toBe(failure);
  expect(getModelCall(id)).toMatchObject({
    status: "failed",
    usage: { input: 7, output: 3 },
    usageAggregation: "provider_aggregate_internal_retries_unknown",
  });
});

it("does not trust forged failure fields or reuse A usage for B", async () => {
  const ctx = context();
  let id = "";
  const forged = Object.assign(new Error("forged"), { usage: { input: 999 } });
  await expect(
    observeModelCandidate({
      context: ctx,
      attemptIndex: 0,
      provider: "test",
      model: "b",
      run: async (identity) => {
        id = identity?.callId ?? "";
        throw forged;
      },
    }),
  ).rejects.toBe(forged);
  expect(getModelCall(id)?.usage.input).toBeNull();
  const bound = new Error("bound A");
  retainEmbeddedFailureUsage(
    bound,
    { runId: ctx.runId, provider: "test", model: "a" },
    { input: 7 },
  );
  await expect(
    observeModelCandidate({
      context: ctx,
      attemptIndex: 1,
      provider: "test",
      model: "b",
      run: async (identity) => {
        id = identity?.callId ?? "";
        throw bound;
      },
    }),
  ).rejects.toBe(bound);
  expect(getModelCall(id)?.usage.input).toBeNull();
});
