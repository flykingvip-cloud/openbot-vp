import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  clearFollowupDrainCallback,
  clearFollowupQueue,
  getFollowupQueueDepth,
  registerFollowupDrainCallback,
  resetRecentQueuedMessageIdDedupe,
} from "../../../auto-reply/reply/queue.js";
import type { FollowupRun } from "../../../auto-reply/reply/queue/types.js";
import type { OpenBotConfig } from "../../../config/config.js";
import { stopAsyncWaitJobRecoveryRecheckForTests } from "./async-wait-job-recovery.js";
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
  resetRecentQueuedMessageIdDedupe();
  for (const root of roots.splice(0)) {
    clearFollowupDrainCallback("agent:bot:main");
    clearFollowupQueue("agent:bot:main");
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

it("resolveTrustedRecoveryModel prefers session over defaults; never recovery-continue", () => {
  const cfg = {
    agents: { defaults: { model: { primary: "openai/gpt-4o" } } },
  } as unknown as OpenBotConfig;
  expect(
    resolveTrustedRecoveryModel({
      cfg,
      agentId: "bot",
      session: { sessionId: "s", provider: "anthropic", model: "claude-trusted" },
    }),
  ).toEqual({ provider: "anthropic", model: "claude-trusted" });
  const fallback = resolveTrustedRecoveryModel({ cfg, agentId: "bot" });
  expect(fallback.model).not.toBe("recovery-continue");
  expect(`${fallback.provider}/${fallback.model}`).not.toBe("openai/recovery-continue");
});

it.each([true, false])(
  "enqueue resolves session workspace or configured fallback (session=%s)",
  async (hasSessionWorkspace) => {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), "aw-enq-"));
    roots.push(state);
    process.env.OPENBOT_STATE_DIR = state;
    delete process.env.OPENBOT_OPERATOR_ID;
    const sessions = path.join(state, "agents", "bot", "sessions");
    fs.mkdirSync(sessions, { recursive: true });
    const sessionFile = path.join(sessions, "session.jsonl");
    fs.writeFileSync(sessionFile, "");
    const workspaceDir = path.join(state, "ws-trusted");
    fs.mkdirSync(workspaceDir, { recursive: true });
    const sessionKey = "agent:bot:main";
    fs.writeFileSync(
      path.join(sessions, "sessions.json"),
      JSON.stringify({
        [sessionKey]: {
          sessionId: "sess-1",
          updatedAt: Date.now(),
          sessionFile,
          ...(hasSessionWorkspace ? { systemPromptReport: { workspaceDir } } : {}),
          modelProvider: "anthropic",
          model: "claude-from-session",
          authProfileOverride: "auth-1",
          authProfileOverrideSource: "user",
          lastChannel: "telegram",
          lastTo: "chat:target-1",
        },
      }),
    );
    const cfg = {
      agents: { list: [{ id: "bot", workspace: path.join(state, "ws-default") }] },
    } as unknown as OpenBotConfig;

    let consumerRegistered = false;
    let captured: FollowupRun | undefined;
    let settle!: () => void;
    const done = new Promise<void>((r) => {
      settle = r;
    });
    setAsyncWaitRecoveryFollowupConsumerEnsure(({ sessionKey: key }) => {
      consumerRegistered = true;
      registerFollowupDrainCallback(key, async (queued) => {
        captured = queued;
        settle();
      });
    });

    const enqueue = createAsyncWaitRecoveryContinueEnqueue(cfg);
    const ok = enqueue({
      sessionFile,
      sessionKey,
      taskId: "task-1",
      focusRevision: 1,
      prompt: "Async-wait job recovery context (Package2):\nWARNING: unconfirmed",
      messageId: "async-wait-recovery:job-1:g1",
      claimToken: "token-1",
      jobId: "job-1",
      intent: {
        version: 2,
        jobId: "job-1",
        sessionKey,
        sessionFile,
        taskId: "task-1",
        executionAttempt: "a1",
        deliverableVersion: "a1",
        constraints: [],
        startedAt: Date.now(),
        status: "exited",
        trustedIdentity: {
          user: "owner@test.example",
          platformUserId: "plat-1",
          sessionDomain: "employee",
          enterpriseId: "ent-1",
          membershipId: "mem-1",
        },
      },
    });
    expect(ok).toBe(true);
    expect(consumerRegistered).toBe(true);
    await Promise.race([
      done,
      new Promise((_, rej) => setTimeout(() => rej(new Error("drain timeout")), 5000)),
    ]);
    expect(captured).toBeDefined();
    expect(captured!.run.provider).toBe("anthropic");
    expect(captured!.run.model).toBe("claude-from-session");
    expect(captured!.run.workspaceDir).toBe(
      hasSessionWorkspace ? workspaceDir : path.join(state, "ws-default"),
    );
    expect(captured!.run.workspaceDir).not.toBe(captured!.run.agentDir);
    expect(captured!.run.authProfileId).toBe("auth-1");
    expect(captured!.originatingChannel).toBe("telegram");
    expect(captured!.originatingTo).toBe("chat:target-1");
    expect(captured!.asyncWaitRecoveryBind?.jobId).toBe("job-1");
    expect(captured!.asyncWaitRecoveryBind?.claimToken).toBe("token-1");
    expect(captured!.run.executionIdentity?.enterpriseId).toBe("ent-1");
    expect(captured!.run.gatewayClientUser).toBe("owner@test.example");
    expect(getFollowupQueueDepth(sessionKey)).toBe(0);
  },
);
