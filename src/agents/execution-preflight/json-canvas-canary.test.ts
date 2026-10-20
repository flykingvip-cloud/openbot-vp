import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideCronMainSessionSurface,
  focusSnapshotFromLastUserActivity,
} from "../../cron/isolated-agent/main-session-focus.js";
import { surfaceCronJobResult } from "../../cron/isolated-agent/result-surfacing.js";
import type { CronJob } from "../../cron/types.js";
import { parseFrontmatter } from "../skills/frontmatter.js";
import { runSubagentAnnounceDispatch } from "../subagent-announce-dispatch.js";
import { deliverSubagentAnnouncement } from "../subagent-announce.js";
import {
  armCompletionHold,
  buildExecutionPreflight,
  disarmCompletionHold,
  hasDeliveryContext,
  judgeSessionOutbound,
  JSON_CANVAS_MAX_BYTES,
  JSON_CANVAS_VALIDATOR_ID,
  JSON_CANVAS_VALIDATOR_VERSION,
  noteDeliveryArtifactPath,
  readDeliveryContextMetrics,
  readSkillContract,
  registerTrustedValidator,
  releaseDeliveryContext,
  resetCompletionHoldsForTest,
  resetDeliveryArtifactsForTest,
  resetValidationStateForTest,
  sweepExpiredDeliveryContexts,
  resolveAttemptDelivery,
  runProductionValidatorsForAttempt,
  setProductionValidatorRegistrationForTest,
  validateJsonCanvasBytes,
} from "./index.js";

vi.mock("../subagent-announce-dispatch.js", () => ({
  runSubagentAnnounceDispatch: vi.fn(async () => ({
    delivered: true,
    path: "direct",
    phases: [],
  })),
}));

vi.mock("../../gateway/call.js", () => ({
  callGateway: vi.fn(async () => ({ ok: true })),
}));

const { callGateway } = await import("../../gateway/call.js");

const canvasFrontmatter = {
  "primary-engine": "json-canvas",
  "required-artifacts": "board.canvas",
  "required-validators": JSON_CANVAS_VALIDATOR_ID,
  "delivery-blocked-until": "validator_passed",
  "generation-stage-tools": "read,write,edit",
  "delivery-stage-tools": "message,sessions_send",
  triggers: "canvas",
  "allowed-tools": "read,write,edit,message",
};

const validCanvas = '{"nodes":[],"edges":[]}';
const brokenCanvas = '{"nodes":[],"edges":[{"id":"e1","fromNode":"missing","toNode":"missing"}]}';

type CanaryRow = {
  item: number;
  candidateGitSha: string | null;
  runtimeBuildSha: string | null;
  taskId: string;
  attemptNumber: number;
  primarySkill: string | null;
  validatorId: string | null;
  validatorVersion: string | null;
  decisionCode: string;
  deliveryOutcome: string;
  transportCalled: boolean;
};

function preflightFor(taskId: string, message: string) {
  return buildExecutionPreflight({
    taskId,
    sessionId: `agent:${taskId}:main`,
    message,
    skills: [{ name: "json-canvas", frontmatter: canvasFrontmatter }],
    policyToolNames: ["read", "write", "edit", "message", "exec"],
    qualify: () => ({ kind: "short_action", reasons: ["test"] }),
  });
}

function cronJob(agentId: string): CronJob {
  return {
    id: `job-${agentId}`,
    name: "canary",
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    state: {},
    schedule: { kind: "cron", expr: "15 16 * * *" },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "analyze" },
    agentId,
    delivery: { mode: "none", surfaces: ["workbench-agent-main"] },
  };
}

function identity(): Pick<CanaryRow, "candidateGitSha" | "runtimeBuildSha"> {
  let runtimeBuildSha: string | null = null;
  try {
    const parsed = JSON.parse(readFileSync("dist/build-info.json", "utf8")) as { commit?: string };
    runtimeBuildSha = parsed.commit ?? null;
  } catch {
    runtimeBuildSha = null;
  }
  return {
    candidateGitSha: process.env.OPENBOT_SMOKE_CANDIDATE_SHA?.trim() || runtimeBuildSha,
    runtimeBuildSha,
  };
}

describe("json-canvas production canary", () => {
  const previous = process.env.OPENBOT_CANARY_VALIDATORS;
  const rows: CanaryRow[] = [];

  beforeEach(() => {
    process.env.OPENBOT_CANARY_VALIDATORS = JSON_CANVAS_VALIDATOR_ID;
    setProductionValidatorRegistrationForTest(true);
    resetCompletionHoldsForTest();
    resetDeliveryArtifactsForTest();
    resetValidationStateForTest();
    vi.mocked(callGateway).mockClear();
    vi.mocked(runSubagentAnnounceDispatch).mockClear();
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.OPENBOT_CANARY_VALIDATORS;
    } else {
      process.env.OPENBOT_CANARY_VALIDATORS = previous;
    }
    setProductionValidatorRegistrationForTest(true);
  });

  it("reads the skill contract and rejects invalid, timed out, and unregistered checks", () => {
    const skillPath = fileURLToPath(
      new URL("../../../skills/json-canvas/SKILL.md", import.meta.url),
    );
    const declared = readSkillContract(
      "json-canvas",
      parseFrontmatter(readFileSync(skillPath, "utf8")),
    );
    expect(declared?.requiredArtifacts).toEqual(["board.canvas"]);
    expect(declared?.requiredValidators).toEqual([JSON_CANVAS_VALIDATOR_ID]);
    expect(declared?.deliveryBlockedUntil).toBe("validator_passed");
    expect(declared?.generationStageTools).toEqual(["read", "write", "edit"]);
    expect(declared?.deliveryStageTools).toEqual(["message", "sessions_send"]);

    expect(validateJsonCanvasBytes(validCanvas)).toEqual({ result: "passed" });
    expect(validateJsonCanvasBytes("{")).toEqual({ result: "failed", reason: "invalid_json" });
    expect(validateJsonCanvasBytes(brokenCanvas)).toEqual({ result: "failed", reason: "schema" });
    expect(validateJsonCanvasBytes(validCanvas, 10, 10)).toEqual({
      result: "failed",
      reason: "timeout",
    });
    const parse = JSON.parse;
    JSON.parse = () => {
      throw new Error("validator blew up");
    };
    try {
      expect(validateJsonCanvasBytes(validCanvas)).toEqual({
        result: "failed",
        reason: "exception",
      });
    } finally {
      JSON.parse = parse;
    }
    expect(JSON.stringify(validateJsonCanvasBytes(brokenCanvas))).not.toContain("missing");
  });

  it("rejects oversized canvas bytes before parse and fails closed after the deadline", () => {
    const parse = JSON.parse;
    let parsed = 0;
    JSON.parse = ((text: string, reviver?: (key: string, value: unknown) => unknown) => {
      parsed += 1;
      return parse(text, reviver);
    }) as typeof JSON.parse;
    try {
      expect(validateJsonCanvasBytes("x".repeat(JSON_CANVAS_MAX_BYTES + 1), 0, 1_000)).toEqual({
        result: "failed",
        reason: "too_large",
      });
      expect(parsed).toBe(0);
      expect(validateJsonCanvasBytes(validCanvas, 0, 1_000, () => 1_000)).toEqual({
        result: "failed",
        reason: "timeout",
      });
      expect(validateJsonCanvasBytes(brokenCanvas, 0, 1_000, () => 1_000)).toEqual({
        result: "failed",
        reason: "timeout",
      });
      expect(validateJsonCanvasBytes(validCanvas, 0, 1_000, () => 999)).toEqual({
        result: "passed",
      });
    } finally {
      JSON.parse = parse;
    }
  });

  it("runs the host chain for the ten canary outcomes", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "openbot-canvas-"));
    mkdirSync(path.join(workspace, "out"), { recursive: true });
    const relativePath = "out/board.canvas";
    const ids = identity();

    const ready = preflightFor("task-canvas-ok", "请做一个 canvas");
    expect(ready.primarySkill).toBe("json-canvas");
    expect(ready.requiredValidators).toEqual([JSON_CANVAS_VALIDATOR_ID]);
    expect(ready.allowedTools).toContain("write");
    expect(ready.allowedTools).not.toContain("exec");
    writeFileSync(path.join(workspace, relativePath), validCanvas);
    noteDeliveryArtifactPath(ready.taskId, ready.attemptNumber, relativePath);
    runProductionValidatorsForAttempt({ preflight: ready, workspaceDir: workspace });
    const allowed = resolveAttemptDelivery({ preflight: ready, workspaceDir: workspace });
    expect(allowed.decisionCode).toBe("delivery_allowed");
    expect(allowed.gateInput.validatorReceipts?.[0]?.validatorVersion).toBe(
      JSON_CANVAS_VALIDATOR_VERSION,
    );
    const sessionKey = "agent:bot-canvas:main";
    armCompletionHold({
      keys: [sessionKey],
      preflight: ready,
      workspaceDir: workspace,
      ttlMs: 60_000,
    });
    disarmCompletionHold([sessionKey, ready.sessionId]);
    expect(hasDeliveryContext(ready.taskId)).toBe(true);
    // Idle main session plus the bound task id acquires focus and delivers the
    // completion. A recent user turn occupies focus and only parks a notice.
    const nowMs = 1_700_000_000_000;
    const sent = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: { ...cronJob("bot-canvas"), conversationTaskId: ready.taskId },
      agentId: "bot-canvas",
      runId: ready.taskId,
      nowMs,
      lastUserAtMs: nowMs - 5 * 60 * 60 * 1000,
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(sent).toEqual([sessionKey]);
    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "chat.inject",
        params: expect.objectContaining({ sessionKey, cronResultKind: "result" }),
      }),
    );
    expect(hasDeliveryContext(ready.taskId)).toBe(false);
    rows.push({
      item: 1,
      ...ids,
      taskId: ready.taskId,
      attemptNumber: ready.attemptNumber,
      primarySkill: ready.primarySkill ?? null,
      validatorId: JSON_CANVAS_VALIDATOR_ID,
      validatorVersion: JSON_CANVAS_VALIDATOR_VERSION,
      decisionCode: allowed.decisionCode,
      deliveryOutcome: "allowed",
      transportCalled: true,
    });

    const missing = preflightFor("task-canvas-missing", "再做一个 canvas");
    const missingDelivery = resolveAttemptDelivery({
      preflight: missing,
      workspaceDir: workspace,
    });
    expect(missingDelivery.decisionCode).toBe("delivery_blocked");
    rows.push({
      item: 2,
      ...ids,
      taskId: missing.taskId,
      attemptNumber: missing.attemptNumber,
      primarySkill: missing.primarySkill ?? null,
      validatorId: JSON_CANVAS_VALIDATOR_ID,
      validatorVersion: JSON_CANVAS_VALIDATOR_VERSION,
      decisionCode: missingDelivery.decisionCode,
      deliveryOutcome: "blocked",
      transportCalled: false,
    });

    const corrupt = preflightFor("task-canvas-corrupt", "canvas 文件");
    writeFileSync(path.join(workspace, relativePath), brokenCanvas);
    noteDeliveryArtifactPath(corrupt.taskId, corrupt.attemptNumber, relativePath);
    runProductionValidatorsForAttempt({ preflight: corrupt, workspaceDir: workspace });
    const corruptDelivery = resolveAttemptDelivery({
      preflight: corrupt,
      workspaceDir: workspace,
    });
    expect(corruptDelivery.decisionCode).toBe("delivery_blocked");
    expect(corruptDelivery.gateInput.validationResult).toBe("failed");
    rows.push({
      item: 3,
      ...ids,
      taskId: corrupt.taskId,
      attemptNumber: corrupt.attemptNumber,
      primarySkill: corrupt.primarySkill ?? null,
      validatorId: JSON_CANVAS_VALIDATOR_ID,
      validatorVersion: JSON_CANVAS_VALIDATOR_VERSION,
      decisionCode: corruptDelivery.decisionCode,
      deliveryOutcome: "blocked",
      transportCalled: false,
    });

    setProductionValidatorRegistrationForTest(false);
    resetValidationStateForTest();
    const unregistered = preflightFor("task-canvas-unregistered", "canvas 预检");
    expect(unregistered.decisionCode).toBe("validator_unavailable");
    expect(unregistered.allowedTools).not.toContain("write");
    rows.push({
      item: 4,
      ...ids,
      taskId: unregistered.taskId,
      attemptNumber: unregistered.attemptNumber,
      primarySkill: unregistered.primarySkill ?? null,
      validatorId: JSON_CANVAS_VALIDATOR_ID,
      validatorVersion: null,
      decisionCode: unregistered.decisionCode,
      deliveryOutcome: "blocked",
      transportCalled: false,
    });
    setProductionValidatorRegistrationForTest(true);

    const timed = preflightFor("task-canvas-timeout", "canvas 超时");
    writeFileSync(path.join(workspace, relativePath), validCanvas);
    noteDeliveryArtifactPath(timed.taskId, timed.attemptNumber, relativePath);
    runProductionValidatorsForAttempt({
      preflight: timed,
      workspaceDir: workspace,
      now: 50,
      budgetMs: 0,
    });
    const timedDelivery = resolveAttemptDelivery({ preflight: timed, workspaceDir: workspace });
    expect(timedDelivery.decisionCode).toBe("delivery_blocked");
    rows.push({
      item: 5,
      ...ids,
      taskId: timed.taskId,
      attemptNumber: timed.attemptNumber,
      primarySkill: timed.primarySkill ?? null,
      validatorId: JSON_CANVAS_VALIDATOR_ID,
      validatorVersion: JSON_CANVAS_VALIDATOR_VERSION,
      decisionCode: timedDelivery.decisionCode,
      deliveryOutcome: "blocked",
      transportCalled: false,
    });

    const changed = preflightFor("task-canvas-changed", "canvas 改动");
    noteDeliveryArtifactPath(changed.taskId, changed.attemptNumber, relativePath);
    runProductionValidatorsForAttempt({ preflight: changed, workspaceDir: workspace });
    writeFileSync(
      path.join(workspace, relativePath),
      '{"nodes":[{"id":"n1","type":"text","x":0,"y":0,"width":1,"height":1,"text":"x"}],"edges":[]}',
    );
    const changedDelivery = resolveAttemptDelivery({
      preflight: changed,
      workspaceDir: workspace,
    });
    expect(changedDelivery.decisionCode).toBe("artifact_changed");
    rows.push({
      item: 6,
      ...ids,
      taskId: changed.taskId,
      attemptNumber: changed.attemptNumber,
      primarySkill: changed.primarySkill ?? null,
      validatorId: JSON_CANVAS_VALIDATOR_ID,
      validatorVersion: JSON_CANVAS_VALIDATOR_VERSION,
      decisionCode: changedDelivery.decisionCode,
      deliveryOutcome: "blocked",
      transportCalled: false,
    });

    const first = preflightFor("task-canvas-retry", "canvas 重试");
    const second = preflightFor("task-canvas-retry", "canvas 重试");
    expect(second.taskId).toBe(first.taskId);
    expect(second.attemptNumber).toBe(first.attemptNumber + 1);
    expect(second.primarySkill).toBe(first.primarySkill);
    expect(second.requiredValidators).toEqual(first.requiredValidators);
    expect(second.requiredArtifacts).toEqual(first.requiredArtifacts);
    rows.push({
      item: 7,
      ...ids,
      taskId: second.taskId,
      attemptNumber: second.attemptNumber,
      primarySkill: second.primarySkill ?? null,
      validatorId: JSON_CANVAS_VALIDATOR_ID,
      validatorVersion: JSON_CANVAS_VALIDATOR_VERSION,
      decisionCode: "skill_contract_unchanged",
      deliveryOutcome: "not_sent",
      transportCalled: false,
    });

    vi.mocked(callGateway).mockClear();
    const delayed = preflightFor("task-canvas-delay", "canvas 延迟");
    const delayKey = "agent:bot-canvas-delay:main";
    armCompletionHold({ keys: [delayKey], preflight: delayed, ttlMs: 60_000 });
    disarmCompletionHold([delayKey]);
    const blockedCron = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob("bot-canvas-delay"),
      agentId: "bot-canvas-delay",
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(blockedCron).toEqual([]);
    expect(callGateway).not.toHaveBeenCalled();
    rows.push({
      item: 8,
      ...ids,
      taskId: delayed.taskId,
      attemptNumber: delayed.attemptNumber,
      primarySkill: delayed.primarySkill ?? null,
      validatorId: JSON_CANVAS_VALIDATOR_ID,
      validatorVersion: JSON_CANVAS_VALIDATOR_VERSION,
      decisionCode: "completion_claim_blocked_pending_validation",
      deliveryOutcome: "blocked",
      transportCalled: false,
    });
    const blockedRelay = await deliverSubagentAnnouncement({
      requesterSessionKey: delayKey,
      triggerMessage: "子代理已完成",
      steerMessage: "子代理已完成",
      targetRequesterSessionKey: delayKey,
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
      directIdempotencyKey: "idem-canvas-block",
    });
    expect(blockedRelay).toEqual({ delivered: false, path: "none" });
    expect(runSubagentAnnounceDispatch).not.toHaveBeenCalled();
    rows.push({
      item: 9,
      ...ids,
      taskId: delayed.taskId,
      attemptNumber: delayed.attemptNumber,
      primarySkill: delayed.primarySkill ?? null,
      validatorId: JSON_CANVAS_VALIDATOR_ID,
      validatorVersion: JSON_CANVAS_VALIDATOR_VERSION,
      decisionCode: "completion_claim_blocked_pending_validation",
      deliveryOutcome: "blocked",
      transportCalled: false,
    });

    delete process.env.OPENBOT_CANARY_VALIDATORS;
    vi.mocked(callGateway).mockClear();
    const ordinary = buildExecutionPreflight({
      taskId: "task-ordinary",
      sessionId: "agent:ordinary:main",
      message: "hello",
      skills: [{ name: "json-canvas", frontmatter: canvasFrontmatter }],
      policyToolNames: ["read", "write", "edit", "message", "exec"],
      qualify: () => ({ kind: "chat", reasons: ["test"] }),
    });
    expect(ordinary.requiredValidators).toEqual([]);
    expect(ordinary.primarySkill).toBeUndefined();
    const ordinaryDelivery = resolveAttemptDelivery({ preflight: ordinary });
    expect(ordinaryDelivery.decisionCode).toBe("delivery_allowed");
    const ordinarySent = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob("ordinary"),
      agentId: "ordinary",
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(ordinarySent).toEqual(["agent:ordinary:main"]);
    expect(callGateway).toHaveBeenCalledTimes(1);
    rows.push({
      item: 10,
      ...ids,
      taskId: ordinary.taskId,
      attemptNumber: ordinary.attemptNumber,
      primarySkill: null,
      validatorId: null,
      validatorVersion: null,
      decisionCode: ordinaryDelivery.decisionCode,
      deliveryOutcome: "allowed",
      transportCalled: true,
    });

    expect(releaseDeliveryContext(ready.taskId, "delivered")).toBe(false);
    expect(releaseDeliveryContext(delayed.taskId, "failed")).toBe(true);
    process.env.OPENBOT_CANARY_VALIDATORS = JSON_CANVAS_VALIDATOR_ID;
    const cancelled = preflightFor("task-canvas-cancel", "canvas 取消");
    armCompletionHold({
      keys: ["agent:cancel:main"],
      preflight: cancelled,
      ttlMs: 1_000,
      now: 10,
    });
    expect(releaseDeliveryContext(cancelled.taskId, "cancelled")).toBe(true);
    const expiring = preflightFor("task-canvas-expire", "canvas 过期");
    armCompletionHold({
      keys: ["agent:expire:main"],
      preflight: expiring,
      ttlMs: 1_000,
      now: 10,
    });
    const other = preflightFor("task-canvas-other", "canvas 并发");
    armCompletionHold({
      keys: ["agent:expire:main"],
      preflight: other,
      ttlMs: 5_000,
      now: 10,
    });
    expect(hasDeliveryContext(expiring.taskId)).toBe(true);
    expect(hasDeliveryContext(other.taskId)).toBe(true);
    expect(sweepExpiredDeliveryContexts(1_010)).toBe(1);
    expect(hasDeliveryContext(expiring.taskId)).toBe(false);
    expect(hasDeliveryContext(other.taskId)).toBe(true);
    expect(readDeliveryContextMetrics()).toMatchObject({
      retained: 1,
      cleaned: { delivered: 1, failed: 1, cancelled: 1, timeout: 1 },
    });
    resetValidationStateForTest();
    resetCompletionHoldsForTest();
    expect(hasDeliveryContext(ready.taskId)).toBe(false);
    const afterRestart = resolveAttemptDelivery({ preflight: ready, workspaceDir: workspace });
    expect(afterRestart.allowedToDeliver).toBe(false);

    console.log(JSON.stringify(rows));
    expect(rows.map((row) => row.item)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("does not inject or clean when cron has no execution task id", async () => {
    const nowMs = 1_700_000_000_000;
    const task = preflightFor("task-canvas-unbound", "canvas");
    const sessionKey = "agent:bot-unbound:main";
    armCompletionHold({ keys: [sessionKey], preflight: task, ttlMs: 60_000, now: nowMs });
    const job = cronJob("bot-unbound");
    const focus = decideCronMainSessionSurface({
      jobId: job.id,
      snapshot: focusSnapshotFromLastUserActivity({ nowMs }),
    });
    const delivery = judgeSessionOutbound(sessionKey, "任务已完成", "cron_result");
    expect(focus.action).toBe("acquire_focus");
    expect(delivery?.decisionCode).toBe("completion_claim_blocked_pending_validation");
    expect(delivery?.decisionCode).not.toBe("delivery_receipt_verified");
    const sent = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job,
      agentId: "bot-unbound",
      nowMs,
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(sent).toEqual([]);
    expect(callGateway).not.toHaveBeenCalled();
    expect(hasDeliveryContext(task.taskId)).toBe(true);
  });

  it("blocks a focused cron completion that has no receipt", async () => {
    const nowMs = 1_700_000_000_000;
    const task = preflightFor("task-canvas-noreceipt", "canvas");
    const sessionKey = "agent:bot-noreceipt:main";
    armCompletionHold({ keys: [sessionKey], preflight: task, ttlMs: 60_000, now: nowMs });
    const job = { ...cronJob("bot-noreceipt"), conversationTaskId: task.taskId };
    const focus = decideCronMainSessionSurface({
      jobId: job.id,
      conversationTaskId: job.conversationTaskId,
      snapshot: focusSnapshotFromLastUserActivity({
        nowMs,
        lastUserAtMs: nowMs - 5 * 60 * 60 * 1000,
      }),
    });
    const delivery = judgeSessionOutbound(sessionKey, "任务已完成", "cron_result", task.taskId);
    expect(focus.action).toBe("acquire_focus");
    expect(delivery?.outcome).toBe("completion_blocked");
    expect(delivery?.decisionCode).toBe("completion_claim_blocked_pending_validation");
    const sent = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job,
      agentId: "bot-noreceipt",
      runId: task.taskId,
      nowMs,
      lastUserAtMs: nowMs - 5 * 60 * 60 * 1000,
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(sent).toEqual([]);
    expect(callGateway).not.toHaveBeenCalled();
    expect(hasDeliveryContext(task.taskId)).toBe(true);
  });

  it("does not treat an occupied focus slot as a validation failure", async () => {
    const nowMs = 1_700_000_000_000;
    const workspace = mkdtempSync(path.join(tmpdir(), "openbot-canvas-busy-"));
    const relativePath = "board.canvas";
    writeFileSync(path.join(workspace, relativePath), validCanvas);
    const task = preflightFor("task-canvas-busy", "canvas");
    noteDeliveryArtifactPath(task.taskId, task.attemptNumber, relativePath);
    runProductionValidatorsForAttempt({ preflight: task, workspaceDir: workspace });
    const sessionKey = "agent:bot-busy:main";
    armCompletionHold({
      keys: [sessionKey],
      preflight: task,
      workspaceDir: workspace,
      ttlMs: 60_000,
      now: nowMs,
    });
    const job = { ...cronJob("bot-busy"), conversationTaskId: task.taskId };
    const focus = decideCronMainSessionSurface({
      jobId: job.id,
      conversationTaskId: job.conversationTaskId,
      snapshot: focusSnapshotFromLastUserActivity({ nowMs, lastUserAtMs: nowMs - 60_000 }),
    });
    expect(focus.action).toBe("park");
    const sent = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job,
      agentId: "bot-busy",
      runId: task.taskId,
      nowMs,
      lastUserAtMs: nowMs - 60_000,
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(sent).toEqual([sessionKey]);
    expect(callGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "chat.inject",
        params: expect.objectContaining({
          cronResultKind: "parked_notice",
          message: expect.not.stringContaining("任务已完成"),
        }),
      }),
    );
    expect(hasDeliveryContext(task.taskId)).toBe(true);
  });

  it("judges and cleans only the named task when two tasks share a session", async () => {
    const nowMs = 1_700_000_000_000;
    const workspace = mkdtempSync(path.join(tmpdir(), "openbot-canvas-pair-"));
    mkdirSync(path.join(workspace, "out"), { recursive: true });
    const relativePath = "out/board.canvas";
    writeFileSync(path.join(workspace, relativePath), validCanvas);
    const sessionKey = "agent:bot-pair:main";
    const first = preflightFor("task-canvas-a", "canvas a");
    const second = preflightFor("task-canvas-b", "canvas b");
    noteDeliveryArtifactPath(first.taskId, first.attemptNumber, relativePath);
    runProductionValidatorsForAttempt({ preflight: first, workspaceDir: workspace });
    armCompletionHold({
      keys: [sessionKey],
      preflight: first,
      workspaceDir: workspace,
      ttlMs: 60_000,
      now: nowMs,
    });
    armCompletionHold({
      keys: [sessionKey],
      preflight: second,
      workspaceDir: workspace,
      ttlMs: 60_000,
      now: nowMs,
    });
    const idleAt = nowMs - 5 * 60 * 60 * 1000;
    const sentFirst = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: { ...cronJob("bot-pair"), conversationTaskId: first.taskId },
      agentId: "bot-pair",
      runId: first.taskId,
      nowMs,
      lastUserAtMs: idleAt,
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(sentFirst).toEqual([sessionKey]);
    expect(hasDeliveryContext(first.taskId)).toBe(false);
    expect(hasDeliveryContext(second.taskId)).toBe(true);
    vi.mocked(callGateway).mockClear();
    const sentSecond = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: { ...cronJob("bot-pair"), conversationTaskId: second.taskId },
      agentId: "bot-pair",
      runId: second.taskId,
      nowMs,
      lastUserAtMs: idleAt,
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(sentSecond).toEqual([]);
    expect(callGateway).not.toHaveBeenCalled();
    expect(hasDeliveryContext(second.taskId)).toBe(true);
    const guessed = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob("bot-pair"),
      agentId: "bot-pair",
      nowMs,
      lastUserAtMs: idleAt,
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(guessed).toEqual([]);
    expect(hasDeliveryContext(second.taskId)).toBe(true);
  });

  it("rejects a receipt whose validator version no longer matches", () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "openbot-canvas-version-"));
    const relativePath = "board.canvas";
    writeFileSync(path.join(workspace, relativePath), validCanvas);
    const task = preflightFor("task-canvas-version", "canvas 版本");
    noteDeliveryArtifactPath(task.taskId, task.attemptNumber, relativePath);
    runProductionValidatorsForAttempt({ preflight: task, workspaceDir: workspace });
    registerTrustedValidator({ id: JSON_CANVAS_VALIDATOR_ID, version: "2" });
    const mismatched = resolveAttemptDelivery({ preflight: task, workspaceDir: workspace });
    expect(mismatched.allowedToDeliver).toBe(false);
    expect(mismatched.decisionCode).toBe("delivery_blocked");
  });
});
