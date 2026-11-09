import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { ensureChatTurnTaskOutcome } from "../task-outcome/chat-entry.js";
import {
  chargeModelCallAgainstTip,
  recordRunnerTurnOutcome,
} from "../task-outcome/runtime-from-runner.js";
import {
  createRunCostCollector,
  createRunCostStore,
  snapshotRunCostPricing,
} from "./run-cost-collector.js";
let root = "";
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "real-run-cost-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
async function setup(on = true, capacity = 1000, ttlMs = 900000) {
  const agentDir = await fs.mkdtemp(path.join(root, "agent-"));
  const cfg: OpenBotConfig = {
    agents: { list: [{ id: "bot", agentDir }] },
    models: {
      providers: {
        test: {
          baseUrl: "https://example.invalid",
          models: [
            {
              id: "model",
              name: "Model",
              reasoning: false,
              input: ["text"],
              contextWindow: 8192,
              maxTokens: 1024,
              cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    },
  };
  const opened = ensureChatTurnTaskOutcome(cfg, {
    agentId: "bot",
    runId: "run",
    subjectRef: "subject:a",
  });
  if (!opened.ok) {
    throw new Error("open_failed");
  }
  let at = Date.now();
  const store = createRunCostStore({ enabled: () => on, now: () => at, capacity, ttlMs });
  const collector = createRunCostCollector(
    {
      cfg,
      agentId: "bot",
      taskId: opened.taskId,
      scope: opened.scope,
      runId: "run",
      provenance: "injected",
    },
    store,
  );
  const usage = { input: 10, output: 5 };
  const pricing = snapshotRunCostPricing(cfg, "test", "model");
  const charge = (callSeq: number, nowMs = at) => {
    collector.beginCall(callSeq);
    return chargeModelCallAgainstTip(cfg, "bot", {
      taskId: opened.taskId,
      scope: opened.scope,
      runId: "run",
      callSeq,
      usage,
      provider: "test",
      model: "model",
      nowMs,
    });
  };
  const capture = (receipt: ReturnType<typeof charge>, callSeq = 1, nowMs = at, p = pricing) =>
    collector.capture({
      provider: "test",
      model: "model",
      usage,
      callSeq,
      nowMs,
      pricing: p,
      receipt,
    });
  const finish = () =>
    recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run",
      taskId: opened.taskId,
      scope: opened.scope,
      skipBudgetCharge: true,
    });
  return {
    cfg,
    opened,
    store,
    collector,
    charge,
    capture,
    finish,
    at,
    advance: () => {
      at += 100;
    },
    disable: () => {
      on = false;
    },
  };
}
describe("real post-call cost capture", () => {
  it("does not attribute equal-price competing usage to the winning budget command", async () => {
    const x = await setup();
    x.collector.beginCall(1);
    chargeModelCallAgainstTip(x.cfg, "bot", {
      taskId: x.opened.taskId,
      scope: x.opened.scope,
      runId: "run",
      callSeq: 1,
      usage: { input: 20, output: 0 },
      provider: "test",
      model: "model",
      nowMs: x.at,
    });
    const loser = chargeModelCallAgainstTip(x.cfg, "bot", {
      taskId: x.opened.taskId,
      scope: x.opened.scope,
      runId: "run",
      callSeq: 1,
      usage: { input: 10, output: 5 },
      provider: "test",
      model: "model",
      nowMs: x.at,
    });
    x.capture(loser);
    const final = await x.finish();
    x.collector.bind(final.record);
    for (const row of x.store.query("bot", x.opened.scope, final.record, x.at).runCosts) {
      expect(row.cost.tokens.input.subtotal).toBeNull();
      expect(row.cost.estimatedUsd.subtotal).toBeNull();
      expect(row.cost.estimatedUsd.total).toBeNull();
    }
  });
  it("does not synthesize a charge for closed tasks and excludes correction versions", async () => {
    const x = await setup();
    x.capture(x.charge(1));
    const closed = await recordRunnerTurnOutcome(x.cfg, "bot", {
      success: false,
      failureReason: "run_failed",
      runId: "run",
      taskId: x.opened.taskId,
      scope: x.opened.scope,
      skipBudgetCharge: true,
    });
    expect(x.collector.bind({ ...closed.record, revisionKind: "correction" })).toBe(false);
    expect(closed.record.lifecycle).toBe("closed");
    expect(x.capture(x.charge(2), 2)).toBe(false);
  });
  it("expires and evicts facts without returning a total or a different version", async () => {
    const x = await setup(true, 1, 10);
    x.capture(x.charge(1));
    x.capture(x.charge(2), 2);
    const final = await x.finish();
    expect(x.collector.bind(final.record)).toBe(false);
    const y = await setup(true, 1000, 10);
    y.capture(y.charge(3), 3);
    const result = await y.finish();
    y.collector.bind(result.record);
    y.advance();
    expect(y.store.query("bot", y.opened.scope, result.record, y.at + 100).runCosts).toEqual([]);
  });
  it("captures real charge command and links only the actual final result version", async () => {
    const x = await setup();
    const receipt = x.charge(1);
    expect(x.capture(receipt)).toBe(true);
    expect(x.capture(receipt)).toBe(false);
    const final = await x.finish();
    expect(final.record.outcomeVersion).toBeGreaterThan(receipt.record.outcomeVersion);
    expect(x.collector.bind(final.record)).toBe(true);
    const result = x.store.query("bot", x.opened.scope, final.record, x.at);
    expect(result.runCosts).toHaveLength(1);
    expect(result.runCosts[0].cost.tokens.input.subtotal).toBeNull();
    expect(result.runCosts[0].cost.estimatedUsd.subtotal).toBeNull();
    expect(result.runCosts[0].cost.estimatedUsd.total).toBeNull();
    expect(result.runCosts[0].cost.completeness).toBe("partial");
    expect(result.runCosts[0].cost.procurement.subtotal).toBeNull();
    expect(result.runCosts[0].cost.credits.subtotal).toBeNull();
    expect(x.store.query("other", x.opened.scope, final.record, x.at).runCosts).toEqual([]);
  });
  it("rejects changed replay payloads and missing pricing never becomes zero", async () => {
    const x = await setup();
    const receipt = x.charge(1);
    expect(x.capture(receipt, 1, x.at, null)).toBe(true);
    x.advance();
    const replay = x.charge(1);
    expect(x.capture(replay, 1, x.at)).toBe(false);
    const final = await x.finish();
    expect(x.collector.bind(final.record)).toBe(true);
    const cost = x.store.query("bot", x.opened.scope, final.record, x.at).runCosts[0].cost;
    expect(cost.estimatedUsd.subtotal).toBeNull();
    expect(cost.tokens.input.subtotal).toBeNull();
  });
  it("does not capture when disabled or fabricate a budget receipt for an uncharged call", async () => {
    const x = await setup(false);
    expect(x.capture(x.charge(1))).toBe(false);
    const y = await setup();
    expect(y.capture(y.charge(1), 2)).toBe(false);
    expect(y.collector.bind((await y.finish()).record)).toBe(false);
  });
  it("clears on withdrawal and retains no evidence across fresh stores", async () => {
    const x = await setup();
    x.capture(x.charge(1));
    const final = await x.finish();
    x.collector.bind(final.record);
    x.disable();
    expect(x.store.query("bot", x.opened.scope, final.record, x.at).runCosts).toEqual([]);
    expect(
      createRunCostStore({ enabled: () => true }).query("bot", x.opened.scope, final.record, x.at)
        .runCosts,
    ).toEqual([]);
  });
  it("labels budget callback observations without asserting model usage occurrence", async () => {
    const x = await setup();
    const saved = vi.spyOn(x.store, "recordFact");
    expect(x.capture(x.charge(1))).toBe(true);
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({
        collector: "budget_command_association",
        occurredAt: null,
        observedAt: x.at,
      }),
    );
    const final = await x.finish();
    x.collector.bind(final.record);
    const cost = x.store.query("bot", x.opened.scope, final.record, x.at).runCosts[0].cost;
    expect(cost.observedCallCount).toBe(0);
    expect(cost.budgetAssociationCount).toBe(1);
    expect(cost.reasons).toContain("budget_association_not_usage");
  });
});
