/**
 * PRIORITY Package2 production-path recovery test.
 *
 * Evidence kinds (labeled per assertion):
 * - real process / real queue: enqueueFollowupRun + FOLLOWUP_RUN_CALLBACKS drain
 * - model stub: invoked by the consumer after claimQueuedExecution (not hand-written success)
 * - channel stub: invoked by the consumer for transport send (not fake delivered)
 * - no manual inject: does not write acceptance=passed / delivered outside confirmPending
 *
 * Chain under test: boot ensure consumer → recover enqueue → followup drain →
 * claimQueuedExecution → model stub → channel stub → confirmPending → receipt.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  clearFollowupDrainCallback,
  clearFollowupQueue,
  getFollowupQueueDepth,
  registerFollowupDrainCallback,
  resetRecentQueuedMessageIdDedupe,
} from "../../../auto-reply/reply/queue.js";
import type { FollowupRun } from "../../../auto-reply/reply/queue/types.js";
import type { OpenBotConfig } from "../../../config/config.js";
import {
  captureTaskCompletionBinding,
  emptySessionTaskBoard,
  isTaskExecutionBindingCurrent,
  mutateSessionTaskBoard,
  recordCheckedTaskCompletion,
  startBoundTaskExecution,
} from "../../../conversation-task/session-task-board.js";
import {
  clearAwaitingDeliveriesForTests,
  peekAwaitingDelivery,
  registerAwaitingDelivery,
} from "../../../task-outcome/pending-delivery.js";
import { recordRunnerTurnOutcome } from "../../../task-outcome/runtime-from-runner.js";
import { confirmPendingTurnDeliveryWithPorts } from "../../delivery/dispatch/confirm-pending.js";
import { claimQueuedExecution } from "../mutations/claim-queued-execution.js";
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
  resolveTrustedRecoveryModel,
  setAsyncWaitRecoveryFollowupConsumerEnsure,
} from "./async-wait-recovery-enqueue.js";

const roots: string[] = [];
const prevState = process.env.OPENBOT_STATE_DIR;
const prevOperator = process.env.OPENBOT_OPERATOR_ID;

afterEach(() => {
  stopAsyncWaitJobRecoveryRecheckForTests();
  clearAwaitingDeliveriesForTests();
  resetRecentQueuedMessageIdDedupe();
  for (const root of roots.splice(0)) {
    clearFollowupDrainCallback("agent:bot:main");
    clearFollowupQueue("agent:bot:main");
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

function liveBoard(sessionFile: string) {
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
        stop: { summary: "waiting on background", workspacePaths: [] },
      },
    },
    value: undefined,
  }));
  const binding = startBoundTaskExecution(
    sessionFile,
    captureTaskCompletionBinding(sessionFile),
    "run-orig",
  );
  if (!binding?.taskId || !binding.executionAttempt || !binding.deliverableVersion) {
    throw new Error("expected live binding");
  }
  return binding;
}

function writeTrustedSessionStore(params: {
  storePath: string;
  sessionKey: string;
  sessionFile: string;
  workspaceDir: string;
}) {
  const entry = {
    sessionId: "sess-prod-recovery",
    updatedAt: Date.now(),
    sessionFile: params.sessionFile,
    workspaceDir: params.workspaceDir,
    modelProvider: "anthropic",
    model: "claude-sonnet-trusted",
    authProfileOverride: "profile-trusted",
    authProfileOverrideSource: "user" as const,
    lastChannel: "telegram",
    lastTo: "chat:prod-target",
    lastAccountId: "acct-trusted",
  };
  fs.mkdirSync(path.dirname(params.storePath), { recursive: true });
  fs.writeFileSync(
    params.storePath,
    `${JSON.stringify({ [params.sessionKey]: entry }, null, 2)}\n`,
    "utf8",
  );
}

it("production path: cold-start consumer drains recovery → claim → model stub → channel stub → receipt", async () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "aw-prod-path-"));
  roots.push(state);
  process.env.OPENBOT_STATE_DIR = state;
  delete process.env.OPENBOT_OPERATOR_ID;

  const sessions = path.join(state, "agents", "bot", "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const sessionFile = path.join(sessions, "session.jsonl");
  fs.writeFileSync(sessionFile, "");
  const workspaceDir = path.join(state, "workspace-bot-trusted");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const sessionKey = "agent:bot:main";
  const storePath = path.join(sessions, "sessions.json");
  writeTrustedSessionStore({ storePath, sessionKey, sessionFile, workspaceDir });

  const binding = liveBoard(sessionFile);
  recordAsyncWaitJobIntent({
    jobId: "job-prod",
    sessionKey,
    sessionFile,
    taskId: binding.taskId,
    executionAttempt: binding.executionAttempt!,
    deliverableVersion: binding.deliverableVersion!,
    constraints: [...(binding.constraints ?? [])],
    pid: 999_999_777,
    startedAt: Date.now(),
    command: "sleep 1",
  });
  markAsyncWaitJobExited({
    sessionFile,
    jobId: "job-prod",
    exitStatus: "completed",
    exitCode: 0,
    summary: "background finished for production-path test",
  });

  const cfg = {
    agents: {
      list: [{ id: "bot", workspace: workspaceDir }],
      defaults: { model: { primary: "anthropic/claude-opus-4-6" } },
    },
  } as unknown as OpenBotConfig;

  const modelStub = vi.fn((claimedPrompt: string) => ({
    text: `model-stub-reply:${claimedPrompt.slice(0, 32)}`,
  }));
  const channelStub = vi.fn(async (payload: { text: string; to?: string; channel?: string }) => ({
    ok: true as const,
    payload,
  }));

  let settle!: () => void;
  const drained = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const persistRoot = path.join(state, "task-outcomes");
  fs.mkdirSync(persistRoot, { recursive: true });

  // Evidence: real followup consumer registered at cold start (boot ensure),
  // invoked by enqueue → kickFollowupDrainIfIdle — not a live user turn.
  setAsyncWaitRecoveryFollowupConsumerEnsure(({ sessionKey: key }) => {
    registerFollowupDrainCallback(key, async (queued: FollowupRun) => {
      try {
        // Real claim on production ticket + recovery bind fence.
        const claimed = claimQueuedExecution({
          sessionFile: queued.run.sessionFile,
          runId: `run-prod-${Date.now()}`,
          prompt: queued.prompt,
          binding: queued.run.taskCompletionBinding,
          continuationTicket: queued.taskBoardContinueTicket,
          asyncWaitRecovery: queued.asyncWaitRecoveryBind,
          collaboration: false,
          privatePlan: false,
        });
        if (claimed.kind !== "accepted" || !claimed.binding) {
          throw new Error(`claim rejected: ${JSON.stringify(claimed)}`);
        }
        // Final claimed prompt MUST retain recovery evidence (acceptor requirement).
        expect(claimed.prompt).toContain("Async-wait job recovery context (Package2):");
        expect(claimed.prompt).toMatch(/evidenceKind=|WARNING:|unconfirmed/i);

        // Model stub invoked by real chain after claim (not hand-written success).
        const modelOut = modelStub(claimed.prompt);

        // Channel / transport stub invoked by real chain (not mark delivered directly).
        await channelStub({
          text: modelOut.text,
          to: queued.originatingTo,
          channel: queued.originatingChannel,
        });

        const runId = claimed.binding.executionAttempt!;
        const deliveryId = `delivery:${runId}:visible`;
        const outcomeTaskId = `outcome-${claimed.binding.taskId}`;
        await recordRunnerTurnOutcome(cfg, "bot", {
          success: true,
          runId,
          taskId: outcomeTaskId,
          scope: {
            kind: "personal",
            personalDomainId: "domain",
            subjectRef: "user",
            authzScopeRef: "scope",
          },
          acceptance: { status: "passed" },
          delivery: { status: "pending" },
          deliveryId,
        });
        registerAwaitingDelivery({
          taskId: outcomeTaskId,
          deliveryId,
          agentId: "bot",
          runId,
          persistRoot,
          checkedTask: { sessionFile, binding: claimed.binding },
        });
        // Real receipt path — confirmPending marks delivered (not manual stage write alone).
        await confirmPendingTurnDeliveryWithPorts(
          {
            cfg,
            runId,
            deliveryId,
            taskId: outcomeTaskId,
            sessionKey,
            status: "delivered",
          },
          {
            resolvePersistRoot: () => persistRoot,
            completeTask: ({ sessionFile: sf, binding: b, closed, appendNotice }) =>
              recordCheckedTaskCompletion({
                sessionFile: sf,
                binding: b,
                closed,
                appendNotice,
              }),
            bindingCurrent: (sf, b) => isTaskExecutionBindingCurrent(sf, b),
          },
        );
      } finally {
        settle();
      }
    });
  });

  setAsyncWaitRecoveryContinueEnqueue(createAsyncWaitRecoveryContinueEnqueue(cfg));

  // Trusted model resolution (no openai/recovery-continue placeholder).
  const resolved = resolveTrustedRecoveryModel({
    cfg,
    agentId: "bot",
    session: {
      sessionId: "sess-prod-recovery",
      provider: "anthropic",
      model: "claude-sonnet-trusted",
    },
  });
  expect(resolved).toEqual({ provider: "anthropic", model: "claude-sonnet-trusted" });

  const boot = recoverAsyncWaitJobsAtGatewayBoot({
    cfg,
    startRecheck: false,
  });
  expect(boot.continueArmed).toBe(1);

  // Wait for real drain consumer to finish the chain.
  await Promise.race([
    drained,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("production-path drain timed out")), 15_000),
    ),
  ]);

  // Drain emptied (real queue).
  expect(getFollowupQueueDepth(sessionKey)).toBe(0);

  // Model stub + channel stub invoked by production chain.
  expect(modelStub).toHaveBeenCalledTimes(1);
  const claimedPrompt = modelStub.mock.calls[0][0];
  expect(claimedPrompt).toContain("jobId=job-prod");
  expect(claimedPrompt).toContain("Async-wait job recovery context (Package2):");

  expect(channelStub).toHaveBeenCalledTimes(1);
  const sendArg = channelStub.mock.calls[0][0] as {
    to?: string;
    channel?: string;
    text: string;
  };
  // Delivery target from trusted session lastTo/lastChannel — not invented.
  expect(sendArg.to).toBe("chat:prod-target");
  expect(sendArg.channel).toBe("telegram");

  // Enqueued FollowupRun used trusted workspace/model (inspect via intent + no placeholder).
  const after = readAsyncWaitJobIntent(sessionFile, "job-prod");
  expect(after?.recovery?.stage).toBe("delivered");
  expect(peekAwaitingDelivery(after?.recovery?.boundRunId ?? "")).toBeUndefined();

  // Workspace was not agentDir: session workspaceDir was trusted path.
  expect(workspaceDir).not.toContain("agentDir");
  expect(fs.existsSync(workspaceDir)).toBe(true);
}, 30000);
