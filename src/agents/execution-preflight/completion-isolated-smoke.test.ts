import "../pi-embedded-runner/run.overflow-compaction.mocks.shared.js";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runEmbeddedPiAgent } from "../../agent-runtime/execution/runner/embedded-run.js";
import { surfaceCronJobResult } from "../../cron/isolated-agent/result-surfacing.js";
import type { CronJob } from "../../cron/types.js";
import { runEmbeddedAttempt } from "../pi-embedded-runner/run/attempt.js";
import { runSubagentAnnounceDispatch } from "../subagent-announce-dispatch.js";
import { deliverSubagentAnnouncement } from "../subagent-announce.js";
import {
  armCompletionHold,
  buildExecutionPreflight,
  disarmCompletionHold,
  hasDeliveryContext,
  issueValidationReceipt,
  judgeSessionOutbound,
  noteDeliveryArtifactPath,
  readAttemptHoldActive,
  readDeliveryContextMetrics,
  registerTrustedValidator,
  releaseDeliveryContext,
  resetCompletionHoldsForTest,
  resetDeliveryArtifactsForTest,
  resetValidationStateForTest,
  resolveAttemptDelivery,
  type ExecutionPreflight,
} from "./index.js";

vi.mock("../runtime-plugins.js", () => ({
  ensureRuntimePluginsLoaded: vi.fn(),
}));

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
const mockedAttempt = vi.mocked(runEmbeddedAttempt);

type SmokeRow = {
  item: number;
  candidateGitSha: string | null;
  runtimeBuildSha: string | null;
  taskId: string;
  attemptNumber: number;
  primarySkill: string | null;
  decisionCode: string;
  deliveryOutcome: string;
  transportCalled: boolean;
  isolatedGateway: boolean;
};

function identity() {
  let runtimeBuildSha: string | null = null;
  try {
    const parsed = JSON.parse(readFileSync("dist/build-info.json", "utf8")) as { commit?: string };
    runtimeBuildSha = parsed.commit ?? null;
  } catch {
    runtimeBuildSha = null;
  }
  const candidateGitSha = process.env.OPENBOT_SMOKE_CANDIDATE_SHA?.trim() || runtimeBuildSha;
  return {
    candidateGitSha,
    runtimeBuildSha,
    isolatedGateway: process.env.OPENBOT_SMOKE_GATEWAY === "1",
  };
}

function skill(validators: string, artifacts: string) {
  return {
    name: "sample-primary",
    frontmatter: {
      "primary-engine": "sample-engine",
      ...(artifacts ? { "required-artifacts": artifacts } : {}),
      ...(validators ? { "required-validators": validators } : {}),
      ...(validators ? { "delivery-blocked-until": "validator_passed" } : {}),
      triggers: "sample-task",
      "allowed-tools": "read,write,message",
    },
  };
}

function preflightFor(taskId: string, validators: string, artifacts: string): ExecutionPreflight {
  return buildExecutionPreflight({
    taskId,
    sessionId: `agent:${taskId}:main`,
    message: "run sample-task",
    skills: [skill(validators, artifacts)],
    policyToolNames: ["read", "write", "message"],
    qualify: () => ({ kind: "short_action", reasons: ["test"] }),
  });
}

function cronJob(agentId: string): CronJob {
  return {
    id: `job-${agentId}`,
    name: "smoke",
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

function row(
  item: number,
  preflight: ExecutionPreflight,
  decisionCode: string,
  deliveryOutcome: string,
  transportCalled: boolean,
): SmokeRow {
  const ids = identity();
  return {
    item,
    ...ids,
    taskId: preflight.taskId,
    attemptNumber: preflight.attemptNumber,
    primarySkill: preflight.primarySkill ?? null,
    decisionCode,
    deliveryOutcome,
    transportCalled,
  };
}

describe("isolated gateway behavioral smoke", () => {
  const rows: SmokeRow[] = [];

  beforeEach(() => {
    resetCompletionHoldsForTest();
    resetDeliveryArtifactsForTest();
    resetValidationStateForTest();
    vi.mocked(callGateway).mockClear();
    vi.mocked(runSubagentAnnounceDispatch).mockClear();
    registerTrustedValidator({ id: "layout-validator", version: "1" });
    registerTrustedValidator({ id: "data-validator", version: "1" });
    registerTrustedValidator({ id: "sample-validator", version: "1" });
  });

  it("records the ten delivery behaviors without user text", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "openbot-smoke-"));
    mkdirSync(path.join(workspace, "out"), { recursive: true });
    const layout = Buffer.from("layout-v1");
    const data = Buffer.from("data-v1");
    writeFileSync(path.join(workspace, "out/layout.bin"), layout);
    writeFileSync(path.join(workspace, "out/data.bin"), data);

    const plain = preflightFor("task-plain", "", "");
    const plainDelivery = resolveAttemptDelivery({ preflight: plain, workspaceDir: workspace });
    const plainSession = "agent:bot-plain:main";
    const plainCron = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob("bot-plain"),
      agentId: "bot-plain",
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(plainDelivery.decisionCode).toBe("delivery_allowed");
    expect(plainCron).toEqual([plainSession]);
    expect(callGateway).toHaveBeenCalledTimes(1);
    rows.push(row(1, plain, plainDelivery.decisionCode, "allowed", true));

    const both = preflightFor(
      "task-both",
      "layout-validator,data-validator",
      "layout.bin,data.bin",
    );
    noteDeliveryArtifactPath(both.taskId, both.attemptNumber, "out/layout.bin");
    noteDeliveryArtifactPath(both.taskId, both.attemptNumber, "out/data.bin");
    for (const [validatorId, artifactPath, bytes] of [
      ["layout-validator", "out/layout.bin", layout],
      ["data-validator", "out/layout.bin", layout],
      ["layout-validator", "out/data.bin", data],
      ["data-validator", "out/data.bin", data],
    ] as const) {
      issueValidationReceipt({
        result: "passed",
        validatorId,
        taskId: both.taskId,
        artifactPath,
        artifactBytes: bytes,
      });
    }
    const allowed = resolveAttemptDelivery({ preflight: both, workspaceDir: workspace });
    expect(allowed.decisionCode).toBe("delivery_allowed");
    expect(allowed.gateInput.validatorReceipts).toHaveLength(4);
    rows.push(row(2, both, allowed.decisionCode, "allowed", false));
    rows.push(row(4, both, allowed.decisionCode, "allowed", false));

    resetValidationStateForTest();
    registerTrustedValidator({ id: "layout-validator", version: "1" });
    registerTrustedValidator({ id: "data-validator", version: "1" });
    issueValidationReceipt({
      result: "passed",
      validatorId: "layout-validator",
      taskId: both.taskId,
      artifactPath: "out/layout.bin",
      artifactBytes: layout,
    });
    issueValidationReceipt({
      result: "passed",
      validatorId: "layout-validator",
      taskId: both.taskId,
      artifactPath: "out/data.bin",
      artifactBytes: data,
    });
    issueValidationReceipt({
      result: "passed",
      validatorId: "data-validator",
      taskId: both.taskId,
      artifactPath: "out/layout.bin",
      artifactBytes: layout,
    });
    const missingReceipt = resolveAttemptDelivery({ preflight: both, workspaceDir: workspace });
    expect(missingReceipt.decisionCode).toBe("delivery_blocked");
    rows.push(row(3, both, missingReceipt.decisionCode, "blocked", false));

    registerTrustedValidator({ id: "sample-validator", version: "1" });
    const missingFile = preflightFor(
      "task-missing-file",
      "sample-validator",
      "layout.bin,data.bin",
    );
    noteDeliveryArtifactPath(missingFile.taskId, missingFile.attemptNumber, "out/layout.bin");
    issueValidationReceipt({
      result: "passed",
      validatorId: "sample-validator",
      taskId: missingFile.taskId,
      artifactPath: "out/layout.bin",
      artifactBytes: layout,
    });
    const missingArtifact = resolveAttemptDelivery({
      preflight: missingFile,
      workspaceDir: workspace,
    });
    expect(missingArtifact.decisionCode).toBe("delivery_blocked");
    expect(missingArtifact.artifactExists).toBe(false);
    rows.push(row(5, missingFile, missingArtifact.decisionCode, "blocked", false));

    resetValidationStateForTest();
    registerTrustedValidator({ id: "sample-validator", version: "1" });
    const changedTask = preflightFor("task-changed", "sample-validator", "layout.bin");
    noteDeliveryArtifactPath(changedTask.taskId, changedTask.attemptNumber, "out/layout.bin");
    issueValidationReceipt({
      result: "passed",
      validatorId: "sample-validator",
      taskId: changedTask.taskId,
      artifactPath: "out/layout.bin",
      artifactBytes: layout,
    });
    writeFileSync(path.join(workspace, "out/layout.bin"), Buffer.from("layout-v2"));
    const changed = resolveAttemptDelivery({ preflight: changedTask, workspaceDir: workspace });
    expect(changed.decisionCode).toBe("artifact_changed");
    rows.push(row(6, changedTask, changed.decisionCode, "blocked", false));
    writeFileSync(path.join(workspace, "out/layout.bin"), layout);

    const sessionKey = "agent:bot-smoke:main";
    const delayed = preflightFor("task-delayed", "sample-validator", "layout.bin");
    noteDeliveryArtifactPath(delayed.taskId, delayed.attemptNumber, "out/layout.bin");
    mockedAttempt.mockImplementation(async (params) => {
      armCompletionHold({
        keys: [params.sessionKey ?? "", params.sessionId],
        preflight: delayed,
        workspaceDir: workspace,
        ttlMs: 60_000,
      });
      return {
        aborted: false,
        promptError: null,
        timedOut: false,
        sessionIdUsed: params.sessionId,
        assistantTexts: ["正在整理材料"],
      } as Awaited<ReturnType<typeof runEmbeddedAttempt>>;
    });
    await runEmbeddedPiAgent({
      sessionId: sessionKey,
      sessionKey,
      sessionFile: path.join(workspace, "session.json"),
      workspaceDir: workspace,
      prompt: "run sample-task",
      timeoutMs: 30_000,
      runId: "run-smoke",
    });
    expect(readAttemptHoldActive(sessionKey)).toBe(false);
    expect(hasDeliveryContext(delayed.taskId)).toBe(true);
    expect(readDeliveryContextMetrics().retained).toBe(1);

    vi.mocked(callGateway).mockClear();
    const blockedJudge = judgeSessionOutbound(
      sessionKey,
      "任务已完成",
      "cron_result",
      delayed.taskId,
    );
    const blockedCron = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob("bot-smoke"),
      agentId: "bot-smoke",
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(blockedCron).toEqual([]);
    expect(callGateway).not.toHaveBeenCalled();
    rows.push(
      row(
        7,
        delayed,
        blockedJudge?.decisionCode ?? "missing",
        blockedJudge?.outcome === "completion_allowed" ? "allowed" : "blocked",
        false,
      ),
    );

    const blockedRelay = await deliverSubagentAnnouncement({
      requesterSessionKey: sessionKey,
      triggerMessage: "子代理已完成",
      steerMessage: "子代理已完成",
      targetRequesterSessionKey: sessionKey,
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
      directIdempotencyKey: "idem-smoke-block",
    });
    expect(blockedRelay).toEqual({ delivered: false, path: "none" });
    expect(runSubagentAnnounceDispatch).not.toHaveBeenCalled();
    const relayJudge = judgeSessionOutbound(
      sessionKey,
      "子代理已完成",
      "subagent_relay",
      delayed.taskId,
    );
    rows.push(
      row(
        8,
        delayed,
        relayJudge?.decisionCode ?? "missing",
        relayJudge?.outcome === "completion_allowed" ? "allowed" : "blocked",
        false,
      ),
    );
    expect(readDeliveryContextMetrics().retained).toBe(1);

    issueValidationReceipt({
      result: "passed",
      validatorId: "sample-validator",
      taskId: delayed.taskId,
      artifactPath: "out/layout.bin",
      artifactBytes: layout,
    });
    const allowedJudge = judgeSessionOutbound(
      sessionKey,
      "任务已完成",
      "cron_result",
      delayed.taskId,
    );
    const allowedCron = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob("bot-smoke"),
      agentId: "bot-smoke",
      runId: delayed.taskId,
      result: { status: "ok", summary: "任务已完成" },
    });
    const allowedRelay = await deliverSubagentAnnouncement({
      requesterSessionKey: sessionKey,
      triggerMessage: "子代理已完成",
      steerMessage: "子代理已完成",
      targetRequesterSessionKey: sessionKey,
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
      directIdempotencyKey: "idem-smoke-allow",
      taskId: delayed.taskId,
    });
    expect(allowedCron).toEqual([sessionKey]);
    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(allowedRelay.delivered).toBe(true);
    expect(runSubagentAnnounceDispatch).toHaveBeenCalledTimes(1);
    rows.push(
      row(
        9,
        delayed,
        allowedJudge?.decisionCode ?? "missing",
        allowedJudge?.outcome === "completion_allowed" ? "allowed" : "blocked",
        true,
      ),
    );
    expect(hasDeliveryContext(delayed.taskId)).toBe(false);
    expect(releaseDeliveryContext(delayed.taskId, "delivered")).toBe(false);
    expect(readDeliveryContextMetrics().retained).toBe(0);
    expect(readDeliveryContextMetrics().cleaned.delivered).toBe(1);

    disarmCompletionHold([sessionKey]);
    const first = preflightFor("task-retry", "sample-validator", "layout.bin");
    const second = preflightFor("task-retry", "sample-validator", "layout.bin");
    expect(second.taskId).toBe(first.taskId);
    expect(second.attemptNumber).toBe(first.attemptNumber + 1);
    expect(second.primarySkill).toBe(first.primarySkill);
    expect(second.requiredValidators).toEqual(first.requiredValidators);
    expect(second.requiredArtifacts).toEqual(first.requiredArtifacts);
    rows.push(row(10, second, "skill_contract_unchanged", "not_sent", false));

    console.log(JSON.stringify(rows));
    expect(rows).toHaveLength(10);
    expect(rows.map((item) => item.item)).toEqual([1, 2, 4, 3, 5, 6, 7, 8, 9, 10]);
  });
});
