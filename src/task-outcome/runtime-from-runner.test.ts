import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { readEvolutionTaskOutcomes } from "../gateway/agent-growth/evolution-task-outcomes.js";
import { readOperationalMetrics } from "../gateway/agent-growth/operational-metrics-store.js";
import { assessTargetModalityAcceptance } from "./capability-modality.js";
import {
  CHAT_TURN_CONTRACT_V1,
  resolveChatTurnCloseGates,
  resolveTurnTaskContract,
} from "./chat-entry.js";
import { ChatTaskOutcomeAdapter } from "./entrypoints/chat.js";
import { TaskOutcomeResultService } from "./result-service.js";
import {
  TASK_OUTCOME_STORE_DIRNAME,
  recordRunnerTurnOutcome,
  runnerExecutorEvidenceContext,
} from "./runtime-from-runner.js";
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

  it("P1: executor_unwired claim reaches durable reasonDetail; chat cannot claim image success", async () => {
    const taskId = "chat:bot:sess:run-unwired";
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-unwired",
      taskId,
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
    expect(out.record.taskJudgement).toBe("incomplete");
    expect(out.record.reasonDetail).not.toMatch(/image_generation.*success/i);

    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const persisted = store.loadTask(taskId);
    expect(persisted?.reasonDetail).toContain("forbidden_success_modalities=image_generation");
    expect(persisted?.capabilityModality?.executionStatus).toBe("executor_unwired");
    expect(persisted?.capabilityModality?.targetModalityCompleted).toBe(false);
    expect(persisted?.capabilityModality?.textReturnedAllowed).toBe(true);
    const assessed = assessTargetModalityAcceptance(persisted?.capabilityModality);
    expect(assessed.targetModalitySucceeded).toBe(false);
    expect(assessed.reason).toBe("executor_unwired");
  });

  it("P1: plan-ok + trusted run success marks modality completed in production path", async () => {
    const taskId = "chat:bot:sess:run-plan-ok";
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-plan-ok",
      taskId,
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
    expect(out.record.capabilityModality?.executionStatus).toBe("completed");
    expect(out.record.capabilityModality?.targetModalityCompleted).toBe(true);
    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const persisted = store.loadTask(taskId);
    expect(
      assessTargetModalityAcceptance(persisted?.capabilityModality).targetModalitySucceeded,
    ).toBe(true);
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
      taskId: "chat:bot:sess:run-refuse-unwired",
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
      { allowRetry: false, scope: out.record.scope },
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) {
      return;
    }
    expect(refused.code).toBe("illegal_transition");
    expect(refused.message).toContain("target_modality_not_accepted");
    expect(refused.message).toContain("executor_unwired");
    const persisted = store.loadTask(taskId);
    expect(persisted?.acceptance.status).toBe("pending");
    expect(persisted?.capabilityModality?.executionStatus).toBe("executor_unwired");
  });

  it("markTargetModalityCompleted refuses executor_unwired", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-mark-unwired",
      taskId: "chat:bot:sess:run-mark-unwired",
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
      { scope: out.record.scope },
    );
    expect(mark.ok).toBe(false);
    if (mark.ok) {
      return;
    }
    expect(mark.message).toContain("cannot_complete_executor_unwired");
  });

  it("integration: production runner success → formal acceptance passes without manual mark", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-prod-accept",
      taskId: "chat:bot:sess:run-prod-accept",
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
    expect(out.record.capabilityModality?.targetModalityCompleted).toBe(true);
    expect(out.record.capabilityModality?.executionStatus).toBe("completed");
    expect(out.record.reasonDetail).toContain(
      "target_modality_completed_via=run_completed:run:run-prod-accept",
    );

    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const service = new TaskOutcomeResultService({ store });
    const chat = new ChatTaskOutcomeAdapter(service);
    const passed = chat.setAcceptance(
      out.record.taskId,
      out.record.outcomeVersion,
      out.record.fencingToken!,
      { status: "passed" },
      { allowRetry: false, scope: out.record.scope },
    );
    expect(passed.ok).toBe(true);
    if (!passed.ok) {
      return;
    }
    expect(passed.record.acceptance.status).toBe("passed");
  });

  it("integration: executor_unwired stays incomplete; formal acceptance still refused after runner success", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-prod-unwired-refuse",
      taskId: "chat:bot:sess:run-prod-unwired-refuse",
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
    expect(out.record.capabilityModality?.targetModalityCompleted).toBe(false);
    expect(out.record.capabilityModality?.executionStatus).toBe("executor_unwired");

    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const service = new TaskOutcomeResultService({ store });
    const chat = new ChatTaskOutcomeAdapter(service);
    const refused = chat.setAcceptance(
      out.record.taskId,
      out.record.outcomeVersion,
      out.record.fencingToken!,
      { status: "passed" },
      { allowRetry: false, scope: out.record.scope },
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) {
      return;
    }
    expect(refused.message).toContain("target_modality_not_accepted");
  });
});

describe("recordRunnerTurnOutcome — artifact-backed modality completion", () => {
  let agentDir = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-artifact-"));
    cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  const wiredImageClaim = {
    planFailureKind: "none",
    allowedModality: "image_generation",
    forbiddenSuccessModalities: [] as string[],
    textReturnedAllowed: true,
    targetModalityCompleted: false,
    status: "ok",
    incompleteModalities: [] as string[],
    detail: "routing_executable_not_completed",
  };

  const wiredMusicClaim = {
    ...wiredImageClaim,
    allowedModality: "audio_music_generation",
  };

  it("failure response does not mark image modality completed", async () => {
    const out = await recordRunnerTurnOutcome(cfg, "bot", {
      success: false,
      runId: "run-img-fail",
      taskId: "chat:bot:sess:run-img-fail",
      failureReason: "run_failed",
      capabilityOutcome: wiredImageClaim,
      modalityArtifacts: [
        { toolName: "image_gen", relativePath: ".openbot/generated-images/a.png" },
      ],
    });
    expect(out.record.capabilityModality?.targetModalityCompleted).toBe(false);
    expect(out.record.capabilityModality?.executionStatus).toBe("routing_ok");
  });

  it("success without artifact leaves image/music incomplete; acceptance refused", async () => {
    const imageOut = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-img-no-art",
      taskId: "chat:bot:sess:run-img-no-art",
      capabilityOutcome: wiredImageClaim,
    });
    expect(imageOut.record.capabilityModality?.targetModalityCompleted).toBe(false);
    expect(imageOut.record.capabilityModality?.targetModality).toBe("image_generation");
    expect(imageOut.record.reasonDetail ?? "").not.toContain("target_modality_completed_via=");

    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const service = new TaskOutcomeResultService({ store });
    const chat = new ChatTaskOutcomeAdapter(service);
    const refused = chat.setAcceptance(
      imageOut.record.taskId,
      imageOut.record.outcomeVersion,
      imageOut.record.fencingToken!,
      { status: "passed" },
      { allowRetry: false, scope: imageOut.record.scope },
    );
    expect(refused.ok).toBe(false);

    const musicOut = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-music-no-art",
      taskId: "chat:bot:sess:run-music-no-art",
      capabilityOutcome: wiredMusicClaim,
    });
    expect(musicOut.record.capabilityModality?.targetModalityCompleted).toBe(false);
    expect(musicOut.record.capabilityModality?.targetModality).toBe("audio_music_generation");
  });

  it("success with real image/music artifact marks completed and acceptance can pass", async () => {
    const imageOut = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-img-art",
      taskId: "chat:bot:sess:run-img-art",
      capabilityOutcome: wiredImageClaim,
      modalityArtifacts: [
        { toolName: "image_gen", relativePath: ".openbot/generated-images/hero.png" },
      ],
    });
    expect(imageOut.record.capabilityModality?.targetModalityCompleted).toBe(true);
    expect(imageOut.record.capabilityModality?.executionStatus).toBe("completed");
    expect(imageOut.record.reasonDetail).toContain(
      "target_modality_completed_via=execution_artifact:.openbot/generated-images/hero.png",
    );

    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    const service = new TaskOutcomeResultService({ store });
    const chat = new ChatTaskOutcomeAdapter(service);
    const passed = chat.setAcceptance(
      imageOut.record.taskId,
      imageOut.record.outcomeVersion,
      imageOut.record.fencingToken!,
      { status: "passed" },
      { allowRetry: false, scope: imageOut.record.scope },
    );
    expect(passed.ok).toBe(true);

    const musicOut = await recordRunnerTurnOutcome(cfg, "bot", {
      success: true,
      runId: "run-music-art",
      taskId: "chat:bot:sess:run-music-art",
      capabilityOutcome: wiredMusicClaim,
      modalityArtifacts: [
        { toolName: "music_gen", relativePath: ".openbot/generated-audio/theme.mp3" },
      ],
    });
    expect(musicOut.record.capabilityModality?.targetModalityCompleted).toBe(true);
    expect(musicOut.record.reasonDetail).toContain(
      "target_modality_completed_via=execution_artifact:.openbot/generated-audio/theme.mp3",
    );
  });
});

describe("legacy executor identity", () => {
  it("skips absent agent identity", () => {
    expect(
      runnerExecutorEvidenceContext({}, undefined, { taskId: "task", runId: "run" }),
    ).toBeUndefined();
  });
});
