import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { surfaceCronJobResult } from "../../cron/isolated-agent/result-surfacing.js";
import type { CronJob } from "../../cron/types.js";
import { runSubagentAnnounceDispatch } from "../subagent-announce-dispatch.js";
import { deliverSubagentAnnouncement } from "../subagent-announce.js";
import {
  armCompletionHold,
  buildExecutionPreflight,
  disarmCompletionHold,
  issueValidationReceipt,
  noteDeliveryArtifactPath,
  registerTrustedValidator,
  resetCompletionHoldsForTest,
  resetDeliveryArtifactsForTest,
  resetValidationStateForTest,
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

const sessionKey = "agent:bot-delay:main";

function preflightFor(workspace: string) {
  const preflight = buildExecutionPreflight({
    taskId: "task-delay",
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
  const relativePath = "out/output.bin";
  mkdirSync(path.join(workspace, "out"), { recursive: true });
  writeFileSync(path.join(workspace, relativePath), "v1");
  noteDeliveryArtifactPath(preflight.taskId, preflight.attemptNumber, relativePath);
  return { preflight, relativePath };
}

function cronJob(): CronJob {
  return {
    id: "job-delay",
    name: "delay",
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    state: {},
    schedule: { kind: "cron", expr: "15 16 * * *" },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "analyze" },
    agentId: "bot-delay",
    delivery: { mode: "none", surfaces: ["workbench-agent-main"] },
  };
}

describe("delayed completion sends", () => {
  beforeEach(() => {
    resetValidationStateForTest();
    resetDeliveryArtifactsForTest();
    resetCompletionHoldsForTest();
    vi.mocked(callGateway).mockClear();
    vi.mocked(runSubagentAnnounceDispatch).mockClear();
    registerTrustedValidator({ id: "sample-validator", version: "1" });
  });

  it("keeps the delivery context after the attempt hold is dropped", async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), "openbot-delay-"));
    const { preflight, relativePath } = preflightFor(workspace);
    armCompletionHold({
      keys: [sessionKey],
      preflight,
      workspaceDir: workspace,
    });
    disarmCompletionHold([sessionKey, preflight.sessionId]);

    const blockedCron = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob(),
      agentId: "bot-delay",
      result: { status: "ok", summary: "任务已完成" },
    });
    expect(blockedCron).toEqual([]);
    expect(callGateway).not.toHaveBeenCalled();

    const blockedRelay = await deliverSubagentAnnouncement({
      requesterSessionKey: sessionKey,
      triggerMessage: "子代理已完成",
      steerMessage: "子代理已完成",
      targetRequesterSessionKey: sessionKey,
      requesterIsSubagent: false,
      expectsCompletionMessage: true,
      directIdempotencyKey: "idem-delay",
    });
    expect(blockedRelay).toEqual({ delivered: false, path: "none" });
    expect(runSubagentAnnounceDispatch).not.toHaveBeenCalled();

    const progress = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob(),
      agentId: "bot-delay",
      result: { status: "ok", summary: "正在整理材料" },
    });
    expect(progress).toEqual([sessionKey]);
    expect(callGateway).toHaveBeenCalledTimes(1);
    vi.mocked(callGateway).mockClear();

    issueValidationReceipt({
      validatorId: "sample-validator",
      taskId: preflight.taskId,
      artifactPath: relativePath,
      artifactBytes: "v1",
    });
    const allowedCron = await surfaceCronJobResult({
      cfg: { session: { mainKey: "main" } },
      job: cronJob(),
      agentId: "bot-delay",
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
      directIdempotencyKey: "idem-delay-2",
      taskId: preflight.taskId,
    });
    expect(allowedRelay.delivered).toBe(true);
    expect(runSubagentAnnounceDispatch).toHaveBeenCalledTimes(1);
  });
});
