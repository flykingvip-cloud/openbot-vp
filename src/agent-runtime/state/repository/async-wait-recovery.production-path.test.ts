/**
 * PRIORITY: production ensureAsyncWaitRecoveryFollowupConsumer / createFollowupRunner.
 *
 * Evidence:
 * - real process/queue: register via ensureAsyncWaitRecoveryFollowupConsumer → enqueue → drain
 * - model stub: runEmbeddedPiAgent only (lowest boundary)
 * - channel stub: routeReply only (lowest boundary)
 * - acceptance/delivery status produced by production prepareVisible + confirmPending
 *   from stub returns — NOT hand-written success/acceptance=passed/delivered.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const runEmbeddedPiAgentMock = vi.fn();
const routeReplyMock = vi.fn();
const isRoutableChannelMock = vi.fn();

vi.mock(
  "../../../agents/model-fallback.js",
  async () => await import("../../../test-utils/model-fallback.mock.js"),
);

vi.mock("../../../agents/pi-embedded.js", () => ({
  queueEmbeddedPiMessage: vi.fn(),
  abortEmbeddedPiRun: vi.fn(),
  runEmbeddedPiAgent: (params: unknown) => runEmbeddedPiAgentMock(params),
}));

// Production followup path imports runEmbeddedPiAgent from embedded-run, not agents/pi-embedded.
vi.mock("../../../agent-runtime/execution/runner/embedded-run.js", async () => {
  const { runEmbeddedPiAgent } = await import("../../../agents/pi-embedded.js");
  return { runEmbeddedPiAgent };
});

vi.mock("../../../auto-reply/reply/route-reply.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../auto-reply/reply/route-reply.js")>();
  return {
    ...actual,
    isRoutableChannel: (...args: unknown[]) => isRoutableChannelMock(...args),
    routeReply: (...args: unknown[]) => routeReplyMock(...args),
  };
});

import {
  clearFollowupDrainCallback,
  clearFollowupQueue,
  getFollowupQueueDepth,
  resetRecentQueuedMessageIdDedupe,
} from "../../../auto-reply/reply/queue.js";
import type { OpenBotConfig } from "../../../config/config.js";
import {
  captureTaskCompletionBinding,
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
  startBoundTaskExecution,
} from "../../../conversation-task/session-task-board.js";
import { clearAwaitingDeliveriesForTests } from "../../../task-outcome/pending-delivery.js";
import {
  recoverAsyncWaitJobsAtGatewayBoot,
  setAsyncWaitRecoveryContinueEnqueue,
  stopAsyncWaitJobRecoveryRecheckForTests,
} from "./async-wait-job-recovery.js";
import {
  clearAsyncWaitJobsForTests,
  markAsyncWaitJobExited,
  readAsyncWaitJobIntent,
  recordAsyncWaitJobIntent,
} from "./async-wait-job.js";
import {
  createAsyncWaitRecoveryContinueEnqueue,
  setAsyncWaitRecoveryFollowupConsumerEnsure,
} from "./async-wait-recovery-enqueue.js";
import { ensureAsyncWaitRecoveryFollowupConsumer } from "./async-wait-recovery-followup-consumer.js";

const roots: string[] = [];
const prevState = process.env.OPENBOT_STATE_DIR;
const prevOperator = process.env.OPENBOT_OPERATOR_ID;
const SESSION_KEY = "agent:bot:main";

afterEach(() => {
  stopAsyncWaitJobRecoveryRecheckForTests();
  clearAwaitingDeliveriesForTests();
  resetRecentQueuedMessageIdDedupe();
  clearFollowupDrainCallback(SESSION_KEY);
  clearFollowupQueue(SESSION_KEY);
  for (const root of roots.splice(0)) {
    clearAsyncWaitJobsForTests(path.join(root, "agents", "bot", "sessions", "session.jsonl"));
    fs.rmSync(root, { recursive: true, force: true });
  }
  if (prevState === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = prevState;
  }
  if (prevOperator === undefined) {
    delete process.env.OPENBOT_OPERATOR_ID;
  } else {
    process.env.OPENBOT_OPERATOR_ID = prevOperator;
  }
});

beforeEach(() => {
  runEmbeddedPiAgentMock.mockReset();
  routeReplyMock.mockReset();
  routeReplyMock.mockResolvedValue({ ok: true });
  isRoutableChannelMock.mockReset();
  isRoutableChannelMock.mockReturnValue(true);
});

function seedEnv() {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "aw-prod-runner-"));
  roots.push(state);
  process.env.OPENBOT_STATE_DIR = state;
  delete process.env.OPENBOT_OPERATOR_ID;
  const sessions = path.join(state, "agents", "bot", "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const sessionFile = path.join(sessions, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  const workspaceDir = path.join(state, "workspace-bot");
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessions, "sessions.json"),
    JSON.stringify({
      [SESSION_KEY]: {
        sessionId: "sess-prod",
        updatedAt: Date.now(),
        sessionFile,
        workspaceDir,
        modelProvider: "anthropic",
        model: "claude-opus-4-6",
        lastChannel: "telegram",
        lastTo: "chat:prod-target",
      },
    }),
  );
  mutateSessionTaskBoard(sessionFile, () => ({
    board: {
      ...emptySessionTaskBoard(),
      focusRevision: 1,
      current: {
        taskId: "task-prod",
        title: "prod",
        goalText: "prod recovery",
        unfinished: true,
        createdAtMs: 1,
        stop: { summary: "waiting", workspacePaths: [] },
      },
    },
    value: undefined,
  }));
  const binding = startBoundTaskExecution(
    sessionFile,
    captureTaskCompletionBinding(sessionFile),
    "run-orig",
  )!;
  recordAsyncWaitJobIntent({
    jobId: "job-prod",
    sessionKey: SESSION_KEY,
    sessionFile,
    taskId: binding.taskId,
    executionAttempt: binding.executionAttempt!,
    deliverableVersion: binding.deliverableVersion!,
    constraints: [...(binding.constraints ?? [])],
    pid: 999_999_701,
    startedAt: Date.now(),
    trustedIdentity: {
      user: "owner@acme.example",
      platformUserId: "plat-owner-1",
      sessionDomain: "employee",
      enterpriseId: "ent-1",
      membershipId: "mem-1",
    },
  });
  markAsyncWaitJobExited({
    sessionFile,
    jobId: "job-prod",
    exitStatus: "completed",
    exitCode: 0,
    summary: "background finished",
  });
  const agentDir = path.join(state, "agent-dir");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "auth-profiles.json"),
    JSON.stringify({
      version: 1,
      profiles: {
        "anthropic:default": {
          type: "api_key",
          provider: "anthropic",
          key: "test-anthropic-key-not-real",
        },
      },
    }),
  );
  const cfg = {
    agents: {
      list: [{ id: "bot", workspace: workspaceDir, agentDir }],
      defaults: { model: { primary: "anthropic/claude-opus-4-6" } },
    },
  } as unknown as OpenBotConfig;
  return { state, sessionFile, workspaceDir, cfg, binding, agentDir };
}

async function waitForStage(sessionFile: string, stage: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (readAsyncWaitJobIntent(sessionFile, "job-prod")?.recovery?.stage === stage) {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  const intent = readAsyncWaitJobIntent(sessionFile, "job-prod");
  throw new Error(
    `timeout waiting for stage=${stage}; got=${intent?.recovery?.stage}; modelCalls=${runEmbeddedPiAgentMock.mock.calls.length}; routeCalls=${routeReplyMock.mock.calls.length}; queueDepth=${getFollowupQueueDepth(SESSION_KEY)}`,
  );
}

it("production ensureFollowupConsumer → createFollowupRunner: stub returns drive acceptance/delivery", async () => {
  const { sessionFile, cfg } = seedEnv();

  runEmbeddedPiAgentMock.mockResolvedValue({
    payloads: [{ text: "recovery report with verified sources" }],
    meta: {
      hookDelivery: {
        validatorsRequired: true,
        decisionCode: "delivery_receipt_verified",
        validatorReceipts: [{ validatorId: "sources" }],
        intentClass: "long_running",
      },
    },
  });
  routeReplyMock.mockResolvedValue({ ok: true });

  // REAL production consumer ensure (createFollowupRunner), not a hand-rolled callback.
  const onBlockReply = vi.fn(async () => {});
  setAsyncWaitRecoveryFollowupConsumerEnsure(({ cfg: c, sessionKey }) => {
    ensureAsyncWaitRecoveryFollowupConsumer({
      cfg: c,
      sessionKey,
      opts: { onBlockReply },
    });
  });
  setAsyncWaitRecoveryContinueEnqueue(createAsyncWaitRecoveryContinueEnqueue(cfg));

  const boot = recoverAsyncWaitJobsAtGatewayBoot({ cfg, startRecheck: false });
  expect(boot.continueArmed).toBe(1);

  await waitForStage(sessionFile, "delivered");

  // Model stub invoked by production createFollowupRunner (not hand claim).
  expect(runEmbeddedPiAgentMock).toHaveBeenCalled();
  // Claimed prompt retains recovery evidence into executor (call JSON covers prompt fields).
  const callBlob = JSON.stringify(runEmbeddedPiAgentMock.mock.calls[0]);
  expect(callBlob).toMatch(/Async-wait job recovery context|jobId=job-prod|WARNING|evidenceKind/);

  // Channel stub invoked by production transport (routeReply and/or onBlockReply).
  const channelTouched = routeReplyMock.mock.calls.length > 0 || onBlockReply.mock.calls.length > 0;
  expect(channelTouched).toBe(true);
  if (routeReplyMock.mock.calls.length > 0) {
    const routeArg = routeReplyMock.mock.calls[0][0] as { to?: string; channel?: string };
    expect(routeArg.to ?? (routeArg as { destination?: string }).destination).toBeTruthy();
  } else {
    expect(onBlockReply).toHaveBeenCalled();
  }

  // Production confirm marked delivered — board finished when acceptance+delivery succeed.
  expect(readAsyncWaitJobIntent(sessionFile, "job-prod")?.recovery?.stage).toBe("delivered");
  expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(false);
  expect(getFollowupQueueDepth(SESSION_KEY)).toBe(0);
}, 30000);

it("channel fail ≠ delivered; later delivery-only retry can complete without re-running model", async () => {
  const { sessionFile, cfg } = seedEnv();

  runEmbeddedPiAgentMock.mockResolvedValue({
    payloads: [{ text: "recovery report with verified sources" }],
    meta: {
      hookDelivery: {
        validatorsRequired: true,
        decisionCode: "delivery_receipt_verified",
        validatorReceipts: [{ validatorId: "sources" }],
        intentClass: "long_running",
      },
    },
  });
  // First transport fails.
  routeReplyMock.mockResolvedValueOnce({ ok: false, error: "offline" });

  // No onBlockReply fallback — routeReply failure must remain a real delivery fail.
  setAsyncWaitRecoveryFollowupConsumerEnsure(({ cfg: c, sessionKey }) => {
    ensureAsyncWaitRecoveryFollowupConsumer({ cfg: c, sessionKey });
  });
  setAsyncWaitRecoveryContinueEnqueue(createAsyncWaitRecoveryContinueEnqueue(cfg));

  recoverAsyncWaitJobsAtGatewayBoot({ cfg, startRecheck: false });

  // Wait until model ran AND delivery was prepared (delivery_pending) — do not
  // stop at turn_bound which precedes publishPending.
  const start = Date.now();
  while (Date.now() - start < 15000) {
    if (runEmbeddedPiAgentMock.mock.calls.length > 0) {
      const stage = readAsyncWaitJobIntent(sessionFile, "job-prod")?.recovery?.stage;
      if (stage === "delivery_pending" || stage === "delivered") {
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  expect(runEmbeddedPiAgentMock).toHaveBeenCalled();
  const afterFail = readAsyncWaitJobIntent(sessionFile, "job-prod");
  expect(afterFail?.recovery?.stage).not.toBe("delivered");
  // Channel fail must not close the task.
  expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);
  // Original payloads must be retained for retry (not a placeholder).
  expect(afterFail?.recovery?.stage).toBe("delivery_pending");
  expect(afterFail?.recovery?.boundPayloads?.some((p) => p.text?.includes("recovery report"))).toBe(
    true,
  );
  const blob = JSON.stringify(afterFail?.recovery?.boundPayloads ?? []);
  expect(blob).not.toMatch(/Delivery retry for a completed/);

  const modelCallsAfterExec = runEmbeddedPiAgentMock.mock.calls.length;
  const routeCallsAfterFail = routeReplyMock.mock.calls.length;

  // Delivery-only retry: channel recovers — must resend ORIGINAL payload text.
  routeReplyMock.mockResolvedValue({ ok: true });
  const intent = readAsyncWaitJobIntent(sessionFile, "job-prod")!;
  const { armAsyncWaitRecoveryContinuation } = await import("./async-wait-job-recovery.js");
  const again = armAsyncWaitRecoveryContinuation({ intent, isPidAlive: () => false });
  expect(again.outcome).toBe("delivery_only");
  await waitForStage(sessionFile, "delivered");
  // Model must NOT be called again for delivery-only.
  expect(runEmbeddedPiAgentMock.mock.calls.length).toBe(modelCallsAfterExec);
  // Retry transport must carry original report text (not placeholder).
  const retryArgs = routeReplyMock.mock.calls
    .slice(routeCallsAfterFail)
    .map((c) => JSON.stringify(c[0] ?? {}));
  expect(retryArgs.some((s) => s.includes("recovery report with verified sources"))).toBe(true);
  expect(retryArgs.join("\n")).not.toMatch(/Delivery retry for a completed/);
}, 30000);

it("missing trusted identity refuses enqueue — no unscoped exec", () => {
  const { sessionFile, cfg } = seedEnv();
  // Strip identity from intent file (job id is encoded in filename).
  const jobsDir = path.join(path.dirname(sessionFile), "async-wait-jobs");
  const name = fs.readdirSync(jobsDir).find((n) => n.includes("job-prod"))!;
  const row = JSON.parse(fs.readFileSync(path.join(jobsDir, name), "utf8"));
  delete row.trustedIdentity;
  fs.writeFileSync(path.join(jobsDir, name), JSON.stringify(row));

  setAsyncWaitRecoveryFollowupConsumerEnsure(({ cfg: c, sessionKey }) => {
    ensureAsyncWaitRecoveryFollowupConsumer({ cfg: c, sessionKey });
  });
  const enqueue = createAsyncWaitRecoveryContinueEnqueue(cfg);
  setAsyncWaitRecoveryContinueEnqueue(enqueue);
  const boot = recoverAsyncWaitJobsAtGatewayBoot({ cfg, startRecheck: false });
  // Enqueue refused → continueArmed 0, enqueue_failed counted as skipped/failed path.
  expect(boot.continueArmed).toBe(0);
  expect(runEmbeddedPiAgentMock).not.toHaveBeenCalled();
});
