import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { readEvolutionTaskOutcomes } from "../gateway/agent-growth/evolution-task-outcomes.js";
import { readOperationalMetrics } from "../gateway/agent-growth/operational-metrics-store.js";
import { assessTargetModalityAcceptance } from "./capability-modality.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { TaskOutcomeResultService } from "./result-service.js";
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
      toolsTotal: 2,
      toolsSucceeded: 2,
    });
    expect(out.record.lifecycle).toBe("awaiting_acceptance");
    expect(out.record.taskJudgement).toBe("incomplete");
    expect(out.evolution.written).toBe(false);
    expect(readEvolutionTaskOutcomes(cfg, "bot")).toHaveLength(0);

    const metrics = await readOperationalMetrics(cfg, "bot");
    expect(metrics.toolsTotal).toBe(2);
    expect(metrics.toolsSucceeded).toBe(2);
    expect(metrics.tasksTotal).toBe(0);

    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const persisted = store.loadTask("run:run-ok");
    expect(persisted?.lifecycle).toBe("awaiting_acceptance");
  });

  it("closes run failure and may publish a growth negative", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: false,
      runId: "run-fail",
      toolsTotal: 1,
      toolsSucceeded: 0,
      tenantId: "t1",
    });
    expect(out.record.lifecycle).toBe("closed");
    expect(out.record.taskJudgement).toBe("failure");
    expect(out.record.reasonCode).toBe("acceptance_failed_stop");
    expect(out.evolution.written).toBe(true);
    expect(out.evolution.reason).toBe("published");

    const rows = readEvolutionTaskOutcomes(cfg, "bot");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.succeeded).toBe(false);
    expect(rows[0]?.taskId).toBe("run:run-fail");
    expect(rows[0]?.tenantId).toBe("t1");
  });

  it("P1: executor_unwired claim reaches durable reasonDetail; chat cannot claim image success", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-unwired",
      capabilityOutcome: {
        planFailureKind: "executor_unwired",
        allowedModality: "chat_model",
        forbiddenSuccessModalities: ["image_generation", "audio_music_generation"],
        detail: "Executor image_generation is not wired",
        textReturnedAllowed: true,
        targetModalityCompleted: false,
        status: "executor_unwired",
        incompleteModalities: ["image_generation", "audio_music_generation"],
      },
    });
    expect(out.record.reasonDetail).toContain("executor_unwired");
    expect(out.record.reasonDetail).toContain("image_generation");
    expect(out.record.reasonDetail).toContain("text_returned_allowed=true");
    expect(out.record.reasonDetail).toContain("target_modality_completed=false");
    expect(out.record.reasonDetail).toContain("allowed_modality=chat_model");
    // Still not inventing task success — awaiting acceptance.
    expect(out.record.taskJudgement).toBe("incomplete");
    expect(out.record.reasonDetail).not.toMatch(/image_generation.*success/i);

    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const persisted = store.loadTask("run:run-unwired");
    expect(persisted?.reasonDetail).toContain("forbidden_success_modalities=image_generation");
    // Structured modality must survive persist+reload.
    expect(persisted?.capabilityModality?.executionStatus).toBe("executor_unwired");
    expect(persisted?.capabilityModality?.targetModalityCompleted).toBe(false);
    expect(persisted?.capabilityModality?.textReturnedAllowed).toBe(true);
    // Acceptance consumer: cannot upgrade executor_unwired into target-modality success.
    const assessed = assessTargetModalityAcceptance(persisted?.capabilityModality);
    expect(assessed.targetModalitySucceeded).toBe(false);
    expect(assessed.reason).toBe("executor_unwired");
  });

  it("P1: plan-ok routing claim persists structured incomplete modality", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-plan-ok",
      capabilityOutcome: {
        planFailureKind: "none",
        allowedModality: "chat_model",
        forbiddenSuccessModalities: [],
        textReturnedAllowed: true,
        targetModalityCompleted: false,
        status: "ok",
        incompleteModalities: [],
        detail: "routing_executable_not_completed",
      },
    });
    expect(out.record.capabilityModality?.executionStatus).toBe("routing_ok");
    expect(out.record.capabilityModality?.targetModalityCompleted).toBe(false);
    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const persisted = store.loadTask("run:run-plan-ok");
    expect(
      assessTargetModalityAcceptance(persisted?.capabilityModality).targetModalitySucceeded,
    ).toBe(false);
  });
});

describe("formal acceptance enforces capability modality (via service)", () => {
  let agentDir = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-to-accept-"));
    cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("setAcceptance(passed) refuses executor_unwired via actual transition", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-refuse-unwired",
      capabilityOutcome: {
        planFailureKind: "executor_unwired",
        allowedModality: "chat_model",
        forbiddenSuccessModalities: ["image_generation"],
        textReturnedAllowed: true,
        targetModalityCompleted: false,
        status: "executor_unwired",
        incompleteModalities: ["image_generation"],
      },
    });
    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const service = new TaskOutcomeResultService({ store });
    const chat = new ChatTaskOutcomeAdapter(service);
    const taskId = out.record.taskId;
    const ft = out.record.fencingToken;
    expect(ft).toBeTruthy();
    const refused = chat.setAcceptance(
      taskId,
      out.record.outcomeVersion,
      ft!,
      { status: "passed" },
      { allowRetry: false },
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) {
      return;
    }
    expect(refused.code).toBe("illegal_transition");
    expect(refused.message).toContain("target_modality_not_accepted");
    expect(refused.message).toContain("executor_unwired");
    // Record unchanged — still awaiting acceptance / incomplete.
    const persisted = store.loadTask(taskId);
    expect(persisted?.acceptance.status).toBe("pending");
    expect(persisted?.capabilityModality?.executionStatus).toBe("executor_unwired");
  });

  it("markTargetModalityCompleted refuses executor_unwired", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-mark-unwired",
      capabilityOutcome: {
        planFailureKind: "executor_unwired",
        allowedModality: "chat_model",
        forbiddenSuccessModalities: ["image_generation"],
        textReturnedAllowed: true,
        targetModalityCompleted: false,
        status: "executor_unwired",
        incompleteModalities: ["image_generation"],
      },
    });
    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const service = new TaskOutcomeResultService({ store });
    const chat = new ChatTaskOutcomeAdapter(service);
    const mark = chat.markTargetModalityCompleted(
      out.record.taskId,
      out.record.outcomeVersion,
      out.record.fencingToken!,
      { kind: "execution_artifact", digestOrRef: "sha256:fake" },
    );
    expect(mark.ok).toBe(false);
    if (mark.ok) {
      return;
    }
    expect(mark.message).toContain("cannot_complete_executor_unwired");
  });

  it("controlled mark + setAcceptance: routing_ok becomes target success only after evidence", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-mark-then-pass",
      capabilityOutcome: {
        planFailureKind: "none",
        allowedModality: "chat_model",
        forbiddenSuccessModalities: [],
        textReturnedAllowed: true,
        targetModalityCompleted: false,
        status: "ok",
        incompleteModalities: [],
        detail: "routing_executable_not_completed",
      },
    });
    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const service = new TaskOutcomeResultService({ store });
    const chat = new ChatTaskOutcomeAdapter(service);
    const taskId = out.record.taskId;
    const ft = out.record.fencingToken!;
    let v = out.record.outcomeVersion;

    // Before mark: formal acceptance must refuse incomplete modality.
    const early = chat.setAcceptance(taskId, v, ft, { status: "passed" }, { allowRetry: false });
    expect(early.ok).toBe(false);
    if (early.ok) {
      return;
    }
    expect(early.message).toContain("target_modality_not_accepted");

    const marked = chat.markTargetModalityCompleted(taskId, v, ft, {
      kind: "run_completed",
      digestOrRef: `run:${out.record.decisiveRunId ?? "run-mark-then-pass"}`,
      detail: "real_execution_evidence",
    });
    expect(marked.ok).toBe(true);
    if (!marked.ok) {
      return;
    }
    expect(marked.record.capabilityModality?.targetModalityCompleted).toBe(true);
    expect(marked.record.capabilityModality?.executionStatus).toBe("completed");
    v = marked.record.outcomeVersion;

    const passed = chat.setAcceptance(taskId, v, ft, { status: "passed" }, { allowRetry: false });
    expect(passed.ok).toBe(true);
    if (!passed.ok) {
      return;
    }
    expect(passed.record.acceptance.status).toBe("passed");
  });
});
