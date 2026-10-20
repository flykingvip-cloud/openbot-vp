import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { readEvolutionTaskOutcomes } from "./evolution-task-outcomes.js";
import {
  deriveOperationalSignals,
  readOperationalMetrics,
  recordFeedbackObservation,
  recordRunOutcome,
  recordTaskOutcome,
  recordToolOutcome,
  recordToolOutcomes,
} from "./operational-metrics-store.js";
import { computeOperationalScore } from "./operational-score.js";

const AGENT_ID = "growth-bot";

let tmpDir = "";
let cfg: OpenBotConfig;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-op-metrics-"));
  cfg = {
    agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] },
  } as unknown as OpenBotConfig;
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("operational metrics store", () => {
  it("starts empty and derives no signals", async () => {
    const metrics = await readOperationalMetrics(cfg, AGENT_ID);
    expect(metrics.tasksTotal).toBe(0);
    expect(metrics.takeoverObservations).toBe(0);
    expect(deriveOperationalSignals(metrics)).toBeUndefined();
  });

  it("does NOT fabricate a takeover rate from task outcomes alone", async () => {
    // Regression guard: the old implementation used tasksTotal as the takeover denominator,
    // so every agent silently scored full marks on the 0.10 takeover weight.
    await recordTaskOutcome(cfg, AGENT_ID, { success: true });
    await recordTaskOutcome(cfg, AGENT_ID, { success: false });

    const metrics = await readOperationalMetrics(cfg, AGENT_ID);
    expect(metrics.tasksTotal).toBe(2);
    expect(metrics.takeoverObservations).toBe(0);

    const signals = deriveOperationalSignals(metrics);
    expect(signals?.taskSuccessRate).toBe(0.5);
    expect(signals?.humanTakeoverRate).toBeUndefined();
    // Only the task weight participates → score is exactly the task success rate.
    expect(computeOperationalScore(signals)).toBe(50);
  });

  it("counts a takeover observation when the caller actually observed one", async () => {
    await recordTaskOutcome(cfg, AGENT_ID, { success: true, humanTakeover: false });
    await recordTaskOutcome(cfg, AGENT_ID, { success: false, humanTakeover: true });

    const signals = deriveOperationalSignals(await readOperationalMetrics(cfg, AGENT_ID));
    expect(signals?.humanTakeoverRate).toBe(0.5);
  });

  it("writes a windowed evolution task outcome without inventing experiment IDs", async () => {
    await recordTaskOutcome(cfg, AGENT_ID, {
      success: true,
      tenantId: "tenant-a",
      runId: "run-metrics",
      humanTakeover: false,
      occurredAt: Date.parse("2026-09-06T10:00:00.000Z"),
      evolutionPersistDir: path.join(tmpDir, "no-evolution-control"),
    });
    const rows = readEvolutionTaskOutcomes(cfg, AGENT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agentId: AGENT_ID,
      succeeded: true,
      tenantId: "tenant-a",
      runId: "run-metrics",
      humanTakeover: false,
    });
    expect(rows[0]?.experimentId).toBeUndefined();
    expect(rows[0]?.applicationId).toBeUndefined();
  });

  it("records tool outcomes (single + batched)", async () => {
    await recordToolOutcome(cfg, AGENT_ID, { success: true });
    await recordToolOutcomes(cfg, AGENT_ID, { total: 3, succeeded: 1 });

    const metrics = await readOperationalMetrics(cfg, AGENT_ID);
    expect(metrics.toolsTotal).toBe(4);
    expect(metrics.toolsSucceeded).toBe(2);
    expect(deriveOperationalSignals(metrics)?.toolSuccessRate).toBe(0.5);
  });

  it("inspects a chat-only runner turn as security zero without inventing IDs", async () => {
    await recordRunOutcome(cfg, AGENT_ID, {
      success: true,
      toolsTotal: 0,
      runId: "run-chat-only",
      latencyMs: 1_200,
      tenantId: "tenant-a",
      occurredAt: Date.parse("2026-09-06T10:00:00.000Z"),
      evolutionPersistDir: path.join(tmpDir, "no-evolution-control"),
    });
    expect(readEvolutionTaskOutcomes(cfg, AGENT_ID)[0]).toMatchObject({
      runId: "run-chat-only",
      toolsObserved: 0,
      latencyMs: 1_200,
      tenantId: "tenant-a",
      securityViolation: false,
    });
    expect(readEvolutionTaskOutcomes(cfg, AGENT_ID)[0]?.experimentId).toBeUndefined();
  });

  it("leaves security unset when the runner recorded tools but no inspection sources", async () => {
    await recordRunOutcome(cfg, AGENT_ID, {
      success: true,
      toolsTotal: 4,
      runId: "run-tools-uninspected",
      latencyMs: 800,
      occurredAt: Date.parse("2026-09-06T10:00:00.000Z"),
      evolutionPersistDir: path.join(tmpDir, "no-evolution-control"),
    });
    const row = readEvolutionTaskOutcomes(cfg, AGENT_ID)[0];
    expect(row?.toolsObserved).toBe(4);
    expect(row?.securityViolation).toBeUndefined();
  });

  it("records a completed run and its tools atomically", async () => {
    await recordRunOutcome(cfg, AGENT_ID, {
      success: true,
      toolsTotal: 4,
      toolsSucceeded: 3,
      runId: "run-complete",
    });
    expect(readEvolutionTaskOutcomes(cfg, AGENT_ID)[0]?.runId).toBe("run-complete");

    expect(await readOperationalMetrics(cfg, AGENT_ID)).toMatchObject({
      tasksTotal: 1,
      tasksSucceeded: 1,
      toolsTotal: 4,
      toolsSucceeded: 3,
    });
  });

  it("ignores empty batches and clamps succeeded to total", async () => {
    await recordToolOutcomes(cfg, AGENT_ID, { total: 0, succeeded: 5 });
    expect((await readOperationalMetrics(cfg, AGENT_ID)).toolsTotal).toBe(0);

    await recordToolOutcomes(cfg, AGENT_ID, { total: 2, succeeded: 9 });
    const metrics = await readOperationalMetrics(cfg, AGENT_ID);
    expect(metrics.toolsTotal).toBe(2);
    expect(metrics.toolsSucceeded).toBe(2);
  });

  it("derives satisfaction from inbound feedback observations", async () => {
    await recordFeedbackObservation(cfg, AGENT_ID, { sentiment: "positive" });
    await recordFeedbackObservation(cfg, AGENT_ID, { sentiment: "positive" });
    await recordFeedbackObservation(cfg, AGENT_ID, { sentiment: "negative" });

    const signals = deriveOperationalSignals(await readOperationalMetrics(cfg, AGENT_ID));
    expect(signals?.satisfaction).toBeCloseTo(2 / 3, 10);
  });

  it("derives takeover rate from feedback observations", async () => {
    await recordFeedbackObservation(cfg, AGENT_ID, { humanTakeover: false });
    await recordFeedbackObservation(cfg, AGENT_ID, { humanTakeover: false });
    await recordFeedbackObservation(cfg, AGENT_ID, { humanTakeover: true });

    const metrics = await readOperationalMetrics(cfg, AGENT_ID);
    expect(metrics.takeoverObservations).toBe(3);
    expect(metrics.humanTakeovers).toBe(1);
    expect(deriveOperationalSignals(metrics)?.humanTakeoverRate).toBeCloseTo(1 / 3, 10);
  });

  it("skips writes when there is nothing to observe", async () => {
    await recordFeedbackObservation(cfg, AGENT_ID, {});
    expect(await readOperationalMetrics(cfg, AGENT_ID)).toMatchObject({
      takeoverObservations: 0,
      satisfactionPositive: 0,
      satisfactionNegative: 0,
    });
  });

  it("normalizes legacy metric files that lack the new counters", async () => {
    await fs.writeFile(
      path.join(tmpDir, "operational-metrics.json"),
      JSON.stringify({
        tasksTotal: 4,
        tasksSucceeded: 3,
        toolsTotal: 0,
        toolsSucceeded: 0,
        humanTakeovers: 0,
        updatedAtMs: 1,
      }),
      "utf-8",
    );

    const metrics = await readOperationalMetrics(cfg, AGENT_ID);
    expect(metrics.takeoverObservations).toBe(0);
    expect(metrics.satisfactionPositive).toBe(0);
    const signals = deriveOperationalSignals(metrics);
    expect(signals?.taskSuccessRate).toBe(0.75);
    expect(signals?.humanTakeoverRate).toBeUndefined();
  });
});
