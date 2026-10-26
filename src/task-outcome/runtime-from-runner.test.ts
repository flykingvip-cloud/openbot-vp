import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { readEvolutionTaskOutcomes } from "../gateway/agent-growth/evolution-task-outcomes.js";
import { readOperationalMetrics } from "../gateway/agent-growth/operational-metrics-store.js";
import {
  CHAT_TURN_CONTRACT_V1,
  resolveChatTurnCloseGates,
  resolveTurnTaskContract,
} from "./chat-entry.js";
import { TASK_OUTCOME_STORE_DIRNAME, recordRunnerTurnOutcome } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";

describe("recordRunnerTurnOutcome", () => {
  let agentDir = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-to-agent-"));
    cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("does not invent task success or evolution sample on bare run success", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-ok",
      taskId: "chat:bot:sess:run-ok",
      toolsTotal: 2,
      toolsSucceeded: 2,
    });
    expect(out.record.taskId).toBe("chat:bot:sess:run-ok");
    expect(out.record.lifecycle).not.toBe("closed");
    expect(out.record.taskJudgement).toBe("incomplete");
    expect(out.evolution.written).toBe(false);
    expect(readEvolutionTaskOutcomes(cfg, "bot")).toHaveLength(0);

    const metrics = await readOperationalMetrics(cfg, "bot");
    expect(metrics.toolsTotal).toBe(2);
    expect(metrics.toolsSucceeded).toBe(2);
    expect(metrics.tasksTotal).toBe(0);

    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const persisted = store.loadTask("chat:bot:sess:run-ok");
    expect(persisted?.lifecycle).not.toBe("closed");
    expect(persisted?.taskJudgement).toBe("incomplete");
    expect(persisted?.acceptance.status).toBe("pending");
    expect(persisted?.delivery.status).toBe("pending");
  });

  it("process placeholder does not close success or publish positive", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-ph",
      taskId: "chat:bot:sess:run-ph",
      processPlaceholder: true,
    });
    expect(out.record.lifecycle).not.toBe("closed");
    expect(out.record.taskJudgement).toBe("incomplete");
    expect(out.evolution.written).toBe(false);
    expect(readEvolutionTaskOutcomes(cfg, "bot")).toHaveLength(0);
  });

  it("closes success when contract waives acceptance and delivery has receipt", async () => {
    const gates = resolveChatTurnCloseGates({
      deliveryId: "delivery:run-ok-final",
      contract: resolveTurnTaskContract({
        explicitChatTurn: true,
        contractId: CHAT_TURN_CONTRACT_V1,
      }),
      deliveryPhase: "delivered",
    });
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-ok-final",
      taskId: "chat:bot:sess:run-ok-final",
      acceptance: gates.acceptance,
      delivery: gates.delivery,
      deliveryId: gates.deliveryId,
    });
    expect(out.record.lifecycle).toBe("closed");
    expect(out.record.taskJudgement).toBe("success");
    expect(out.record.acceptance.status).toBe("not_required");
    expect(out.record.delivery.status).toBe("delivered");
  });

  it("closes run failure and may publish a growth negative", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: false,
      runId: "run-fail",
      taskId: "chat:bot:sess:run-fail",
      toolsTotal: 1,
      toolsSucceeded: 0,
      tenantId: "t1",
      failureReason: "run_failed",
    });
    expect(out.record.lifecycle).toBe("closed");
    expect(out.record.taskJudgement).toBe("failure");
    expect(out.record.reasonCode).toBe("run_failed");
    expect(out.evolution.written).toBe(true);
    expect(out.evolution.reason).toBe("published");

    const rows = readEvolutionTaskOutcomes(cfg, "bot");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.succeeded).toBe(false);
    expect(rows[0]?.taskId).toBe("chat:bot:sess:run-fail");
    expect(rows[0]?.tenantId).toBe("t1");
  });

  it("user_cancelled does not count as capability failure sample", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: false,
      runId: "run-cancel",
      taskId: "chat:bot:sess:run-cancel",
      failureReason: "user_cancelled",
      tenantId: "t1",
    });
    expect(out.record.lifecycle).toBe("closed");
    expect(out.record.taskJudgement).toBe("cancelled");
    expect(out.record.reasonCode).toBe("user_cancelled");
    expect(out.evolution.written).toBe(false);
  });
});
