import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareVisibleDelivery } from "../agent-runtime/delivery/dispatch/prepare-visible.js";
import type { OpenBotConfig } from "../config/config.js";
import {
  emptySessionTaskBoard,
  mutateSessionTaskBoard,
  readSessionTaskBoard,
  cancelCurrentTask,
} from "../conversation-task/session-task-board.js";
import {
  recoverTaskOutcomeConsumersAtGatewayBoot,
  stopTaskOutcomeRuntimeDrainForTests,
} from "./consumer-boot.js";
import {
  clearAwaitingDeliveriesForTests,
  handoffAwaitingDelivery,
  peekAwaitingDelivery,
} from "./pending-delivery.js";
import { recordRunnerTurnOutcome, TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { TrustedScope } from "./types.js";

const channelProbe = vi.hoisted(() => ({
  calls: [] as Array<{ text?: string; to?: string; threadId?: unknown; replyToId?: unknown }>,
  mode: "receipt" as "receipt" | "throw-after" | "no-receipt" | "fail-before",
}));
const queueProbe = vi.hoisted(() => ({ queued: [] as unknown[], acks: 0, ackFail: false }));

vi.mock("../channels/plugins/outbound/load.js", () => ({
  loadChannelOutboundAdapter: async (channel: string) => {
    if (channelProbe.mode === "fail-before" || channel === "review-no-adapter") {
      return undefined;
    }
    return {
      sendText: async (ctx: {
        text?: string;
        to?: string;
        threadId?: unknown;
        replyToId?: unknown;
      }) => {
        channelProbe.calls.push({
          text: ctx.text,
          to: ctx.to,
          threadId: ctx.threadId,
          replyToId: ctx.replyToId,
        });
        if (channelProbe.mode === "throw-after") {
          throw new Error("channel threw after send was invoked");
        }
        if (channelProbe.mode === "no-receipt") {
          return { channel, messageId: "unknown" };
        }
        return { channel, messageId: "tg-review-1" };
      },
    };
  },
}));

vi.mock("../infra/outbound/delivery-queue.js", async (original) => ({
  ...(await original<typeof import("../infra/outbound/delivery-queue.js")>()),
  enqueueDelivery: async (args: unknown) => {
    queueProbe.queued.push(args);
    return "review-orphan-queue-id";
  },
  failDelivery: async () => {},
  ackDelivery: async () => {
    queueProbe.acks += 1;
    if (queueProbe.ackFail) {
      throw new Error("ack failed");
    }
  },
  moveToFailed: async () => {},
}));

const scope: TrustedScope = {
  kind: "personal",
  personalDomainId: "personal:s4",
  subjectRef: "u",
  authzScopeRef: "s",
};

describe("S4 recovered default send path and current authorization", () => {
  let agentDir = "";
  let storeRoot = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "s4-path-auth-"));
    storeRoot = path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME);
    cfg = {
      agents: { list: [{ id: "bot", agentDir }] },
      channels: { telegram: { enabled: true, defaultTo: "111" } },
    } as unknown as OpenBotConfig;
    channelProbe.calls = [];
    channelProbe.mode = "receipt";
    queueProbe.queued = [];
    queueProbe.acks = 0;
    queueProbe.ackFail = false;
    clearAwaitingDeliveriesForTests();
  });

  afterEach(() => {
    stopTaskOutcomeRuntimeDrainForTests();
    clearAwaitingDeliveriesForTests(storeRoot);
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  function seedBoundBoard(
    sessionFile: string,
    binding: { taskId: string; executionAttempt: string; deliverableVersion: string },
  ) {
    fs.writeFileSync(sessionFile, "");
    mutateSessionTaskBoard(sessionFile, () => ({
      board: {
        ...emptySessionTaskBoard(),
        current: {
          ...binding,
          title: "S4",
          goalText: "S4",
          unfinished: true,
          createdAtMs: 1,
          stop: { summary: "Waiting", workspacePaths: [] },
        },
      },
      value: undefined,
    }));
  }

  async function persistThenCrash(params: {
    runId: string;
    taskId: string;
    sessionFile: string;
    binding: { taskId: string; executionAttempt: string; deliverableVersion: string };
    payloads: { text: string }[];
    target: {
      channel: string;
      to: string;
      accountId?: string;
      threadId?: string | number | null;
      replyToId?: string | null;
    };
    authorization?: {
      subjectRef?: string;
      sessionKey?: string;
      tenantId?: string;
      accountId?: string;
      channel?: string;
      to?: string;
    };
  }) {
    await expect(
      prepareVisibleDelivery({
        resolvePersistRoot: () => storeRoot,
        agentId: "bot",
        runId: params.runId,
        outcomeTaskId: params.taskId,
        sessionKey: "agent:bot:main",
        sessionFile: params.sessionFile,
        completionBinding: params.binding,
        contract: {
          id: "report-v1",
          version: "1",
          kind: "document",
          requiredValidators: ["check"],
          acceptanceVerified: true,
        },
        payloads: params.payloads,
        target: params.target,
        authorization: params.authorization ?? {
          subjectRef: "u",
          sessionKey: "agent:bot:main",
          tenantId: "personal:s4",
          channel: params.target.channel,
          to: params.target.to,
          ...(params.target.accountId ? { accountId: params.target.accountId } : {}),
        },
        commitOutcome: async (_success, opts) => {
          await recordRunnerTurnOutcome(cfg, "bot", {
            success: true,
            runId: params.runId,
            taskId: params.taskId,
            scope,
            acceptance: opts.acceptance,
            delivery: opts.delivery,
            deliveryId: opts.deliveryId,
          });
          throw new Error("crash after persist before notify");
        },
        publishPending: () => {
          throw new Error("publish must not run when persist notify crashes");
        },
      }),
    ).rejects.toThrow("crash after persist before notify");
  }

  it("default path keeps one recovery identity after before-send failure, throw, no receipt, restart, and ack failure", async () => {
    const runId = "s4-run-default-path";
    const taskId = "s4-task-default-path";
    const sessionFile = path.join(agentDir, "session-default.jsonl");
    const binding = {
      taskId: "board-s4-default",
      executionAttempt: runId,
      deliverableVersion: "v1",
    };
    const target = { channel: "telegram", to: "111", threadId: "thread-9", replyToId: "msg-9" };
    seedBoundBoard(sessionFile, binding);

    channelProbe.mode = "fail-before";
    await persistThenCrash({
      runId,
      taskId,
      sessionFile,
      binding,
      payloads: [{ text: "result" }],
      target,
    });
    await recoverTaskOutcomeConsumersAtGatewayBoot({ cfg, startRuntimeDrain: false });
    expect(queueProbe.queued).toHaveLength(0);
    expect(channelProbe.calls).toHaveLength(0);
    expect(peekAwaitingDelivery({ runId, persistRoot: storeRoot })?.sendDisposition).toBe(
      "unknown",
    );
    expect(new DurableTaskOutcomeStore(storeRoot).loadTask(taskId)?.delivery.status).toBe(
      "delivery_unknown",
    );

    channelProbe.mode = "throw-after";
    await recoverTaskOutcomeConsumersAtGatewayBoot({ cfg, startRuntimeDrain: false });
    expect(channelProbe.calls).toHaveLength(0);
    expect(queueProbe.queued).toHaveLength(0);

    // Fresh leftover for throw-after and routing metadata.
    const runId2 = "s4-run-default-throw";
    const taskId2 = "s4-task-default-throw";
    const sessionFile2 = path.join(agentDir, "session-default-throw.jsonl");
    const binding2 = {
      taskId: "board-s4-default-throw",
      executionAttempt: runId2,
      deliverableVersion: "v1",
    };
    seedBoundBoard(sessionFile2, binding2);
    await persistThenCrash({
      runId: runId2,
      taskId: taskId2,
      sessionFile: sessionFile2,
      binding: binding2,
      payloads: [{ text: "result two" }],
      target,
    });
    queueProbe.ackFail = true;
    await recoverTaskOutcomeConsumersAtGatewayBoot({ cfg, startRuntimeDrain: false });
    expect(channelProbe.calls).toHaveLength(1);
    expect(channelProbe.calls[0]).toMatchObject({
      text: "result two",
      to: "111",
      threadId: "thread-9",
      replyToId: "msg-9",
    });
    expect(queueProbe.queued).toHaveLength(0);
    expect(queueProbe.acks).toBe(0);
    expect(peekAwaitingDelivery({ runId: runId2, persistRoot: storeRoot })?.sendDisposition).toBe(
      "unknown",
    );

    const beforeRestart = channelProbe.calls.length;
    await recoverTaskOutcomeConsumersAtGatewayBoot({ cfg, startRuntimeDrain: false });
    expect(channelProbe.calls).toHaveLength(beforeRestart);
    expect(queueProbe.queued).toHaveLength(0);
  });

  it("does not send when current authorization is revoked and does not revive a cancelled task after restore", async () => {
    const runId = "s4-run-auth";
    const taskId = "s4-task-auth";
    const sessionFile = path.join(agentDir, "session-auth.jsonl");
    const binding = { taskId: "board-s4-auth", executionAttempt: runId, deliverableVersion: "v1" };
    const target = { channel: "telegram", to: "111", accountId: "acc-1" };
    seedBoundBoard(sessionFile, binding);
    await persistThenCrash({
      runId,
      taskId,
      sessionFile,
      binding,
      payloads: [{ text: "auth result" }],
      target,
    });

    cfg = {
      agents: { list: [{ id: "bot", agentDir }] },
      channels: {
        telegram: {
          enabled: false,
          accounts: { "acc-1": { enabled: false, defaultTo: "111" } },
        },
      },
    } as unknown as OpenBotConfig;

    await recoverTaskOutcomeConsumersAtGatewayBoot({ cfg, startRuntimeDrain: false });
    expect(channelProbe.calls).toHaveLength(0);
    expect(new DurableTaskOutcomeStore(storeRoot).loadTask(taskId)?.delivery.status).toBe(
      "pending",
    );
    expect(peekAwaitingDelivery({ runId, persistRoot: storeRoot })?.sendDisposition).toBe(
      "not_attempted",
    );

    cfg = {
      agents: { list: [{ id: "bot", agentDir }] },
      channels: {
        telegram: {
          enabled: true,
          accounts: { "acc-1": { enabled: true, defaultTo: "111" } },
        },
      },
    } as unknown as OpenBotConfig;
    mutateSessionTaskBoard(sessionFile, (board) => ({
      board: cancelCurrentTask({ board }).board,
      value: undefined,
    }));

    await recoverTaskOutcomeConsumersAtGatewayBoot({ cfg, startRuntimeDrain: false });
    expect(channelProbe.calls).toHaveLength(0);
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).not.toBe(true);
    expect(new DurableTaskOutcomeStore(storeRoot).loadTask(taskId)?.delivery.status).toBe(
      "pending",
    );
  });

  it("refuses a late producer handoff after recovery has already claimed the send", async () => {
    const runId = "s4-run-late-producer";
    const taskId = "s4-task-late-producer";
    const sessionFile = path.join(agentDir, "session-late.jsonl");
    const binding = { taskId: "board-s4-late", executionAttempt: runId, deliverableVersion: "v1" };
    seedBoundBoard(sessionFile, binding);
    await persistThenCrash({
      runId,
      taskId,
      sessionFile,
      binding,
      payloads: [{ text: "late" }],
      target: { channel: "telegram", to: "111" },
    });
    await recoverTaskOutcomeConsumersAtGatewayBoot({ cfg, startRuntimeDrain: false });
    expect(channelProbe.calls).toHaveLength(1);
    expect(new DurableTaskOutcomeStore(storeRoot).loadTask(taskId)?.delivery.status).toBe(
      "delivered",
    );

    const late = await handoffAwaitingDelivery({
      persistRoot: storeRoot,
      agentId: "bot",
      runId,
      taskId,
      deliveryId: `delivery:${runId}:visible`,
      payloads: [{ text: "late overwrite" }],
      target: { channel: "telegram", to: "111" },
      sendDisposition: "handed_off",
    });
    expect(late.ok).toBe(false);
    await recoverTaskOutcomeConsumersAtGatewayBoot({ cfg, startRuntimeDrain: false });
    expect(channelProbe.calls).toHaveLength(1);
  });

  it("missing authorization locator blocks the default recovered send", async () => {
    const runId = "s4-run-no-locator";
    const taskId = "s4-task-no-locator";
    const sessionFile = path.join(agentDir, "session-no-locator.jsonl");
    const binding = {
      taskId: "board-s4-no-locator",
      executionAttempt: runId,
      deliverableVersion: "v1",
    };
    seedBoundBoard(sessionFile, binding);
    await persistThenCrash({
      runId,
      taskId,
      sessionFile,
      binding,
      payloads: [{ text: "no locator" }],
      target: { channel: "telegram", to: "111" },
      authorization: {},
    });
    await recoverTaskOutcomeConsumersAtGatewayBoot({ cfg, startRuntimeDrain: false });
    expect(channelProbe.calls).toHaveLength(0);
    expect(peekAwaitingDelivery({ runId, persistRoot: storeRoot })?.sendDisposition).toBe(
      "not_attempted",
    );
  });

  it("sends once when current locator and account outbound scope explicitly allow the actual target", async () => {
    const runId = "s4-run-scope-allow";
    const taskId = "s4-task-scope-allow";
    const sessionFile = path.join(agentDir, "session-scope-allow.jsonl");
    const binding = {
      taskId: "board-s4-scope-allow",
      executionAttempt: runId,
      deliverableVersion: "v1",
    };
    const target = { channel: "telegram", to: "111", accountId: "acc-1" };
    seedBoundBoard(sessionFile, binding);
    await persistThenCrash({
      runId,
      taskId,
      sessionFile,
      binding,
      payloads: [{ text: "allowed result" }],
      target,
    });
    cfg = {
      agents: { list: [{ id: "bot", agentDir }] },
      channels: {
        telegram: {
          enabled: true,
          accounts: { "acc-1": { enabled: true, defaultTo: "111" } },
        },
      },
    } as unknown as OpenBotConfig;
    await recoverTaskOutcomeConsumersAtGatewayBoot({ cfg, startRuntimeDrain: false });
    expect(channelProbe.calls).toHaveLength(1);
    expect(channelProbe.calls[0]).toMatchObject({ text: "allowed result", to: "111" });
    expect(new DurableTaskOutcomeStore(storeRoot).loadTask(taskId)?.delivery.status).toBe(
      "delivered",
    );
  });

  it("does not send when the current channel account is disabled", async () => {
    const runId = "s4-run-account-disabled";
    const taskId = "s4-task-account-disabled";
    const sessionFile = path.join(agentDir, "session-account-disabled.jsonl");
    const binding = {
      taskId: "board-s4-account-disabled",
      executionAttempt: runId,
      deliverableVersion: "v1",
    };
    const target = { channel: "telegram", to: "111", accountId: "acc-1" };
    seedBoundBoard(sessionFile, binding);
    await persistThenCrash({
      runId,
      taskId,
      sessionFile,
      binding,
      payloads: [{ text: "disabled" }],
      target,
    });
    cfg = {
      agents: { list: [{ id: "bot", agentDir }] },
      channels: {
        telegram: {
          enabled: true,
          accounts: { "acc-1": { enabled: false, defaultTo: "111" } },
        },
      },
    } as unknown as OpenBotConfig;
    await recoverTaskOutcomeConsumersAtGatewayBoot({ cfg, startRuntimeDrain: false });
    expect(channelProbe.calls).toHaveLength(0);
    expect(new DurableTaskOutcomeStore(storeRoot).loadTask(taskId)?.delivery.status).toBe(
      "pending",
    );
    expect(peekAwaitingDelivery({ runId, persistRoot: storeRoot })?.sendDisposition).toBe(
      "not_attempted",
    );
  });

  it("does not send when same-version outbound scope is revoked", async () => {
    const runId = "s4-run-scope-revoked";
    const taskId = "s4-task-scope-revoked";
    const sessionFile = path.join(agentDir, "session-scope-revoked.jsonl");
    const binding = {
      taskId: "board-s4-scope-revoked",
      executionAttempt: runId,
      deliverableVersion: "v1",
    };
    const target = { channel: "telegram", to: "111", accountId: "acc-1" };
    seedBoundBoard(sessionFile, binding);
    await persistThenCrash({
      runId,
      taskId,
      sessionFile,
      binding,
      payloads: [{ text: "revoked" }],
      target,
    });
    cfg = {
      agents: { list: [{ id: "bot", agentDir }] },
      channels: {
        telegram: {
          enabled: true,
          accounts: { "acc-1": { enabled: true, defaultTo: "other-target" } },
        },
      },
    } as unknown as OpenBotConfig;
    await recoverTaskOutcomeConsumersAtGatewayBoot({ cfg, startRuntimeDrain: false });
    expect(channelProbe.calls).toHaveLength(0);
    expect(readSessionTaskBoard(sessionFile).current).toMatchObject(binding);
    expect(new DurableTaskOutcomeStore(storeRoot).loadTask(taskId)?.delivery.status).toBe(
      "pending",
    );
  });

  it("independent review: missing current outbound-scope basis blocks the real default recovered sender", async () => {
    const runId = "review-no-current-scope",
      taskId = "review-no-current-scope-task";
    const sessionFile = path.join(agentDir, "no-current-scope.jsonl");
    const binding = {
      taskId: "review-no-current-scope-board",
      executionAttempt: runId,
      deliverableVersion: "v1",
    };
    seedBoundBoard(sessionFile, binding);
    const target = { channel: "telegram", to: "111", accountId: "acc-1" };
    await persistThenCrash({
      runId,
      taskId,
      sessionFile,
      binding,
      payloads: [{ text: "private result" }],
      target,
    });
    cfg = {
      agents: { list: [{ id: "bot", agentDir }] },
      channels: { telegram: { enabled: true, accounts: { "acc-1": { enabled: true } } } },
    } as unknown as OpenBotConfig;
    await recoverTaskOutcomeConsumersAtGatewayBoot({ cfg, startRuntimeDrain: false });
    console.log(
      "MISSING_SCOPE_DEFAULT_REVIEW",
      JSON.stringify({
        calls: channelProbe.calls.length,
        status: new DurableTaskOutcomeStore(storeRoot).loadTask(taskId)?.delivery.status,
      }),
    );
    expect(channelProbe.calls).toHaveLength(0);
  });
});

it("independent review: persisted locator must pin the exact target before account scope is consulted", async () => {
  const { recheckCurrentOutboundAuthorization } =
    await import("./recheck-outbound-authorization.js");
  const result = recheckCurrentOutboundAuthorization({
    cfg: {
      channels: {
        telegram: {
          enabled: true,
          accounts: { "acc-1": { enabled: true, defaultTo: "different-target" } },
        },
      },
    } as unknown as OpenBotConfig,
    pending: {
      taskId: "t",
      runId: "r",
      deliveryId: "d",
      agentId: "bot",
      registeredAtMs: 1,
      target: { channel: "telegram", to: "different-target", accountId: "acc-1" },
      authorization: {
        subjectRef: "u",
        sessionKey: "agent:bot:main",
        channel: "telegram",
        to: "original-target",
        accountId: "acc-1",
      },
    },
  });
  console.log("LOCATOR_TARGET_REVIEW", JSON.stringify(result));
  expect(result.allow).toBe(false);
});
