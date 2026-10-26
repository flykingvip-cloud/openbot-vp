import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { readEvolutionTaskOutcomes } from "../gateway/agent-growth/evolution-task-outcomes.js";
import { readOperationalMetrics } from "../gateway/agent-growth/operational-metrics-store.js";
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

  it("does not invent task success or evolution sample on run success", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-ok",
      taskId: "chat:bot:sess:run-ok",
      toolsTotal: 2,
      toolsSucceeded: 2,
    });
    expect(out.record.lifecycle).toBe("closed");
    expect(out.record.taskJudgement).toBe("success");
    // evolution may publish via drain when eligible; do not invent from tools alone
    expect(out.record.taskId).toBe("chat:bot:sess:run-ok");
    // closed/success may drain one evolution sample; must not invent from tools alone without close
    expect(out.record.lifecycle).toBe("closed");
    expect(readEvolutionTaskOutcomes(cfg, "bot").length).toBeLessThanOrEqual(1);

    const metrics = await readOperationalMetrics(cfg, "bot");
    expect(metrics.toolsTotal).toBe(2);
    expect(metrics.toolsSucceeded).toBe(2);
    expect(metrics.tasksTotal).toBe(0);

    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const persisted = store.loadTask("chat:bot:sess:run-ok");
    expect(persisted?.lifecycle).toBe("closed");
    expect(persisted?.taskJudgement).toBe("success");
  });

  it("closes run failure and may publish a growth negative", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: false,
      runId: "run-fail",
      taskId: "chat:bot:sess:run-fail",
      toolsTotal: 1,
      toolsSucceeded: 0,
      tenantId: "t1",
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
});
