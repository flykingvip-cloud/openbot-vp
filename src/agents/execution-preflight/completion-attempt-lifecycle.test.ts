import "../pi-embedded-runner/run.overflow-compaction.mocks.shared.js";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runEmbeddedAttempt } from "../../agent-runtime/execution/runner/embedded-attempt.js";
import { runEmbeddedPiAgent } from "../../agent-runtime/execution/runner/embedded-run.js";
import { surfaceCronJobResult } from "../../cron/isolated-agent/result-surfacing.js";
import type { CronJob } from "../../cron/types.js";
import { runSubagentAnnounceDispatch } from "../subagent-announce-dispatch.js";
import { deliverSubagentAnnouncement } from "../subagent-announce.js";
import {
  armCompletionHold,
  buildExecutionPreflight,
  hasDeliveryContext,
  issueValidationReceipt,
  noteDeliveryArtifactPath,
  readAttemptHoldActive,
  readDeliveryContextMetrics,
  registerTrustedValidator,
  releaseDeliveryContext,
  resetCompletionHoldsForTest,
  resetDeliveryArtifactsForTest,
  resetValidationStateForTest,
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
const sessionKey = "agent:bot-lifecycle:main";

function cronJob(): CronJob {
  return {
    id: "job-lifecycle",
    name: "lifecycle",
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    state: {},
    schedule: { kind: "cron", expr: "15 16 * * *" },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "analyze" },
    agentId: "bot-lifecycle",
    delivery: { mode: "none", surfaces: ["workbench-agent-main"] },
  };
}

describe("delayed send after runEmbeddedPiAgent returns", () => {
  beforeEach(() => {
    resetCompletionHoldsForTest();
    resetDeliveryArtifactsForTest();
    resetValidationStateForTest();
    vi.mocked(callGateway).mockClear();
    vi.mocked(runSubagentAnnounceDispatch).mockClear();
    registerTrustedValidator({ id: "sample-validator", version: "1" });
  });

  it("keeps delivery context after the attempt lock drops, then sends only with a receipt", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "openbot-lifecycle-"));
    mkdirSync(path.join(workspace, "out"), { recursive: true });
    const relativePath = "out/output.bin";
    writeFileSync(path.join(workspace, relativePath), "v1");
    const preflight = buildExecutionPreflight({
      taskId: "task-lifecycle",
      sessionId: sessionKey,
      message: "run sample-task",
      skills: [
        {
          name: "sample-primary",
          frontmatter: {
            "primary-engine": "sample-engine",
            "required-artifacts": "output.bin",
            "required-validators": "sample-validator",
            "delivery-blocked-until": "validator_passed",
            triggers: "sample-task",
            "allowed-tools": "read,write,message",
          },
        },
      ],
      policyToolNames: ["read", "write", "message"],
      qualify: () => ({ kind: "short_action", reasons: ["test"] }),
    });
    noteDeliveryArtifactPath(preflight.taskId, preflight.attemptNumber, relativePath);
    mockedAttempt.mockImplementation(async (params) => {
      armCompletionHold({
        keys: [params.sessionKey ?? "", params.sessionId],
        preflight,
        workspaceDir: workspace,
        ttlMs: 60_000,
      });
      expect(readAttemptHoldActive(sessionKey)).toBe(true);
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
      runId: "run-lifecycle",
    });

    expect(readAttemptHoldActive(sessionKey)).toBe(false);
    expect(hasDeliveryContext(preflight.taskId)).toBe(true);
    expect(readDeliveryContextMetrics().retained).toBe(1);

    const blockedCron = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob(),
      agentId: "bot-lifecycle",
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(blockedCron).toEqual([]);
    expect(callGateway).not.toHaveBeenCalled();
    expect(readDeliveryContextMetrics().retained).toBe(1);

    const blockedRelay = await deliverSubagentAnnouncement({
      requesterSessionKey: sessionKey,
      triggerMessage: "子代理已完成",
      steerMessage: "子代理已完成",
      targetRequesterSessionKey: sessionKey,
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
      directIdempotencyKey: "idem-lifecycle",
    });
    expect(blockedRelay).toEqual({ delivered: false, path: "none" });
    expect(runSubagentAnnounceDispatch).not.toHaveBeenCalled();
    expect(readDeliveryContextMetrics().retained).toBe(1);

    issueValidationReceipt({
      result: "passed",
      validatorId: "sample-validator",
      taskId: preflight.taskId,
      artifactPath: relativePath,
      artifactBytes: "v1",
    });
    const allowedCron = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob(),
      agentId: "bot-lifecycle",
      runId: preflight.taskId,
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(allowedCron).toEqual([sessionKey]);
    expect(callGateway).toHaveBeenCalledTimes(1);
    const allowedRelay = await deliverSubagentAnnouncement({
      requesterSessionKey: sessionKey,
      triggerMessage: "子代理已完成",
      steerMessage: "子代理已完成",
      targetRequesterSessionKey: sessionKey,
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
      directIdempotencyKey: "idem-lifecycle-2",
      taskId: preflight.taskId,
    });
    expect(allowedRelay.delivered).toBe(true);
    expect(runSubagentAnnounceDispatch).toHaveBeenCalledTimes(1);

    expect(hasDeliveryContext(preflight.taskId)).toBe(false);
    expect(releaseDeliveryContext(preflight.taskId, "delivered")).toBe(false);
    expect(readDeliveryContextMetrics().retained).toBe(0);
    expect(readDeliveryContextMetrics().cleaned.delivered).toBe(1);
  });
});
