/**
 * R85g: top-level dispatchReplyFromConfig integration — prepare/send/confirm
 * all driven by production dispatch (no hand-rolled confirmLikeDispatch).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FollowupRun, QueueSettings } from "../auto-reply/reply/queue.js";
import { buildTestCtx } from "../auto-reply/reply/test-ctx.js";
import { createMockTypingController } from "../auto-reply/reply/test-helpers.js";
import type { TemplateContext } from "../auto-reply/templating.js";
import type { GetReplyOptions, ReplyPayload } from "../auto-reply/types.js";
import type { OpenBotConfig } from "../config/config.js";
import { chatTurnTaskId } from "./chat-entry.js";
import { readEffectiveEvolutionTaskOutcomes } from "./growth-bridge.js";
import { clearAwaitingDeliveriesForTests, peekAwaitingDelivery } from "./pending-delivery.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";

const mocks = vi.hoisted(() => ({
  runEmbeddedPiAgent: vi.fn(),
  runWithModelFallback: vi.fn(),
}));

vi.mock("../agents/model-fallback.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agents/model-fallback.js")>();
  return { ...actual, runWithModelFallback: mocks.runWithModelFallback };
});

vi.mock("../agents/pi-embedded.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agents/pi-embedded.js")>();
  return {
    ...actual,
    isEmbeddedPiMessage: vi.fn().mockReturnValue(false),
    runEmbeddedPiAgent: mocks.runEmbeddedPiAgent,
  };
});

vi.mock("../auto-reply/reply/queue.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auto-reply/reply/queue.js")>();
  return { ...actual, enqueueFollowupRun: vi.fn(), scheduleFollowupDrain: vi.fn() };
});

// Stub only the model execution boundary used by the production admitted executor.
vi.mock("../agent-runtime/execution/runner/embedded-run.js", () => ({
  runEmbeddedPiAgent: (params: unknown) => mocks.runEmbeddedPiAgent(params),
}));

import { runReplyAgent } from "../auto-reply/reply/agent-runner.js";
import { dispatchReplyFromConfig } from "../auto-reply/reply/dispatch-from-config.js";
import { resetInboundDedupe } from "../auto-reply/reply/inbound-dedupe.js";
import { createReplyDispatcher } from "../auto-reply/reply/reply-dispatcher.js";

// Resolve the official state port after the production entry and mock modules finish initialization.
const { sessionTaskState } = await import("../agent-runtime/state/index.js");

describe("R85g: top-level dispatchReplyFromConfig integration", () => {
  let agentDir = "";
  let storeRoot = "";
  let cfg: OpenBotConfig;

  /** Register embedded response keyed by prompt so concurrent runs do not cross-wire. */
  const embeddedByPrompt = new Map<
    string,
    { text: string; hookDelivery: Record<string, unknown> }
  >();

  function registerEmbedded(hookDelivery: Record<string, unknown>, text: string) {
    embeddedByPrompt.set(text, { text, hookDelivery });
  }

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "r85g-agent-"));
    storeRoot = path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME);
    cfg = {
      agents: {
        list: [{ id: "bot", default: true, agentDir }],
      },
    } as unknown as OpenBotConfig;
    clearAwaitingDeliveriesForTests(storeRoot);
    resetInboundDedupe();
    mocks.runEmbeddedPiAgent.mockReset();
    embeddedByPrompt.clear();
    mocks.runEmbeddedPiAgent.mockImplementation(async (params: { prompt?: string }) => {
      const key = typeof params.prompt === "string" ? params.prompt : "";
      const entry = embeddedByPrompt.get(key) ?? {
        text: key || "hello-r85g",
        hookDelivery: {
          validatorsRequired: false,
          decisionCode: "not_required",
          allowedToDeliver: true,
          intentClass: "chat",
        },
      };
      return {
        payloads: [{ text: entry.text }],
        meta: {
          durationMs: 1,
          agentMeta: { sessionId: "session", provider: "anthropic", model: "claude" },
          hookDelivery: entry.hookDelivery,
          hookValidatorsRequired: entry.hookDelivery.validatorsRequired === true,
        },
      };
    });
    mocks.runWithModelFallback.mockReset();
    mocks.runWithModelFallback.mockImplementation(
      async (params: {
        provider: string;
        model: string;
        run: (provider: string, model: string) => Promise<unknown>;
      }) => ({
        result: await params.run(params.provider, params.model),
        provider: params.provider,
        model: params.model,
      }),
    );
  });

  afterEach(() => {
    clearAwaitingDeliveriesForTests(storeRoot);
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  function buildRunParams(opts: {
    runId?: string;
    sessionKey: string;
    pendingTurnDeliveryRef?: GetReplyOptions["pendingTurnDeliveryRef"];
    text?: string;
  }) {
    const sessionKey = opts.sessionKey;
    const sessionFile = path.join(agentDir, "session.jsonl");
    const board = sessionTaskState.readForInteraction(sessionFile);
    const admitted = sessionTaskState.admitExecution({
      sessionFile,
      requestId: `test-admission:${sessionKey}:${opts.runId ?? "generated-run"}`,
      goal: "Exercise the admitted delivery lifecycle",
      lifecycle: "turn",
      acceptance: ["Return the fixture result and preserve delivery evidence"],
      expectedFocusRevision: board.focusRevision,
      expectedWriteEpoch: board.writeEpoch ?? 0,
      expectedTaskId: board.current?.taskId,
    });
    expect(admitted.kind).toBe("accepted_turn");
    if (admitted.kind !== "accepted_turn") {
      throw new Error("Test admission fixture was rejected");
    }

    return {
      commandBody: opts.text ?? "hello",
      followupRun: {
        prompt: opts.text ?? "hello",
        enqueuedAt: Date.now(),
        run: {
          agentId: "bot",
          agentDir,
          sessionId: "session",
          sessionKey,
          messageProvider: "telegram",
          sessionFile,
          executionAdmitted: true,
          turnExecutionAdmission: admitted.admission,
          workspaceDir: agentDir,
          config: cfg,
          provider: "anthropic",
          model: "claude",
          thinkLevel: "low",
          verboseLevel: "off",
          elevatedLevel: "off",
          bashElevated: { enabled: false, allowed: false, defaultLevel: "off" },
          timeoutMs: 1_000,
          blockReplyBreak: "message_end",
          gatewayClientPlatformUserId: "u-r85g",
        },
      } as unknown as FollowupRun,
      queueKey: sessionKey,
      resolvedQueue: { mode: "interrupt" } as QueueSettings,
      shouldSteer: false,
      shouldFollowup: false,
      isActive: false,
      isStreaming: false,
      sessionKey,
      opts: {
        ...(opts.runId ? { runId: opts.runId } : {}),
        ...(opts.pendingTurnDeliveryRef
          ? { pendingTurnDeliveryRef: opts.pendingTurnDeliveryRef }
          : {}),
      },
      typing: createMockTypingController(),
      sessionCtx: {
        Provider: "telegram",
        Surface: "telegram",
        To: "chat-1",
        OriginatingTo: "chat-1",
        AccountId: "default",
        MessageSid: "msg-inner",
        GatewayClientPlatformUserId: "u-r85g",
      } as unknown as TemplateContext,
      defaultModel: "anthropic/claude",
      resolvedVerboseLevel: "off",
      isNewSession: false,
      blockStreamingEnabled: false,
      resolvedBlockStreamingBreak: "message_end",
      shouldInjectGroupIntro: false,
      typingMode: "instant",
    } satisfies Parameters<typeof runReplyAgent>[0];
  }

  /**
   * Production prepare via runReplyAgent, wired as dispatch's replyResolver so
   * pendingTurnDeliveryRef / send / confirm stay on the dispatch path.
   */
  function makeReplyResolver(spec: {
    hookDelivery: Record<string, unknown>;
    text: string;
    sessionKey: string;
  }) {
    return async (
      _ctx: unknown,
      opts?: GetReplyOptions,
      _cfg?: OpenBotConfig,
    ): Promise<ReplyPayload | ReplyPayload[] | undefined> => {
      registerEmbedded(spec.hookDelivery, spec.text);
      return runReplyAgent(
        buildRunParams({
          sessionKey: spec.sessionKey,
          text: spec.text,
          // Prefer dispatch-provided runId; allow test to force one when needed.
          runId: opts?.runId,
          pendingTurnDeliveryRef: opts?.pendingTurnDeliveryRef,
        }),
      );
    };
  }

  function makeCtx(params: { sessionKey: string; messageSid: string; body?: string }) {
    return buildTestCtx({
      Body: params.body ?? "hello",
      CommandBody: params.body ?? "hello",
      SessionKey: params.sessionKey,
      Provider: "telegram",
      Surface: "telegram",
      OriginatingChannel: "telegram",
      OriginatingTo: "chat-1",
      To: "chat-1",
      From: "user-1",
      MessageSid: params.messageSid,
      ChatType: "direct",
      CommandAuthorized: true,
      GatewayClientPlatformUserId: "u-r85g",
    });
  }

  const chatHook = {
    taskId: "exec-task",
    attemptNumber: 1,
    validatorsRequired: false,
    decisionCode: "not_required",
    allowedToDeliver: true,
    intentClass: "chat",
  };

  const execNoValHook = {
    ...chatHook,
    primarySkill: "pptx",
  };

  it("1) top-level ordinary chat → closed/success, one effective positive", async () => {
    const sessionKey = "agent:bot:sess-chat";
    const runId = "run-r85g-chat-ok";
    const delivered: string[] = [];
    const dispatcher = createReplyDispatcher({
      deliver: async (payload) => {
        delivered.push(payload.text ?? "");
      },
    });

    const result = await dispatchReplyFromConfig({
      ctx: makeCtx({ sessionKey, messageSid: "msg-r85g-chat" }),
      cfg,
      dispatcher,
      replyOptions: { runId },
      replyResolver: makeReplyResolver({
        hookDelivery: chatHook,
        text: "hello-r85g-chat",
        sessionKey,
      }),
    });

    expect(result.queuedFinal).toBe(true);
    expect(delivered).toEqual(["hello-r85g-chat"]);

    const taskId = chatTurnTaskId({ agentId: "bot", runId, sessionKey });
    const store = new DurableTaskOutcomeStore(storeRoot);
    const record = store.loadTask(taskId);
    expect(record?.lifecycle).toBe("closed");
    expect(record?.taskJudgement).toBe("success");
    expect(record?.acceptance.status).toBe("not_required");
    expect(record?.delivery.status).toBe("delivered");
    expect(peekAwaitingDelivery({ deliveryId: `delivery:${runId}:visible` })).toBeUndefined();

    const positives = readEffectiveEvolutionTaskOutcomes(cfg, "bot").filter(
      (r) => r.taskId === taskId && r.succeeded,
    );
    expect(positives).toHaveLength(1);
  });

  it("2) top-level execution missing validators → incomplete after send, no positive", async () => {
    const sessionKey = "agent:bot:sess-exec";
    const runId = "run-r85g-exec-noval";
    const delivered: string[] = [];
    const dispatcher = createReplyDispatcher({
      deliver: async (payload) => {
        delivered.push(payload.text ?? "");
      },
    });

    await dispatchReplyFromConfig({
      ctx: makeCtx({ sessionKey, messageSid: "msg-r85g-exec" }),
      cfg,
      dispatcher,
      replyOptions: { runId },
      replyResolver: makeReplyResolver({
        hookDelivery: execNoValHook,
        text: "artifact-ready",
        sessionKey,
      }),
    });

    expect(delivered).toEqual(["artifact-ready"]);

    const taskId = chatTurnTaskId({ agentId: "bot", runId, sessionKey });
    const store = new DurableTaskOutcomeStore(storeRoot);
    const after = store.loadTask(taskId);
    expect(after?.delivery.status).toBe("delivered");
    expect(after?.acceptance.status).toBe("pending");
    expect(after?.lifecycle).not.toBe("closed");
    expect(after?.taskJudgement).not.toBe("success");
    expect(
      readEffectiveEvolutionTaskOutcomes(cfg, "bot").filter(
        (r) => r.taskId === taskId && r.succeeded,
      ),
    ).toHaveLength(0);
  });

  it("3) top-level async deliver throw → production auto-confirm failed, no positive", async () => {
    const sessionKey = "agent:bot:sess-fail";
    const runId = "run-r85g-send-fail";
    const dispatcher = createReplyDispatcher({
      deliver: async () => {
        await Promise.resolve();
        throw new Error("channel_send_boom");
      },
      onError: () => {
        /* swallow like production channels */
      },
    });

    // No manual confirm — dispatch must waitForIdle and confirm failed itself.
    await dispatchReplyFromConfig({
      ctx: makeCtx({ sessionKey, messageSid: "msg-r85g-fail" }),
      cfg,
      dispatcher,
      replyOptions: { runId },
      replyResolver: makeReplyResolver({
        hookDelivery: chatHook,
        text: "will-fail",
        sessionKey,
      }),
    });

    const outcomes = dispatcher.getDeliveryOutcomes?.() ?? [];
    expect(outcomes.some((o) => o.kind === "final" && !o.ok)).toBe(true);

    const taskId = chatTurnTaskId({ agentId: "bot", runId, sessionKey });
    const store = new DurableTaskOutcomeStore(storeRoot);
    const record = store.loadTask(taskId);
    expect(record?.taskJudgement).not.toBe("success");
    expect(record?.delivery.status).toBe("failed");
    expect(
      readEffectiveEvolutionTaskOutcomes(cfg, "bot").filter(
        (r) => r.taskId === taskId && r.succeeded,
      ),
    ).toHaveLength(0);
    expect(peekAwaitingDelivery({ deliveryId: `delivery:${runId}:visible` })).toBeUndefined();
  });

  it("4) omit runId + concurrent: barrier interleave, no cross-wire", async () => {
    const sessionKey = "agent:bot:sess-shared";
    let arriveA!: () => void;
    let releaseA!: () => void;
    let arriveB!: () => void;
    let releaseB!: () => void;
    const arrivedA = new Promise<void>((r) => {
      arriveA = r;
    });
    const holdA = new Promise<void>((r) => {
      releaseA = r;
    });
    const arrivedB = new Promise<void>((r) => {
      arriveB = r;
    });
    const holdB = new Promise<void>((r) => {
      releaseB = r;
    });

    const seenOrder: string[] = [];
    const makeDeliver = (label: string, arrive: () => void, hold: Promise<void>) => {
      return async (payload: { text?: string }) => {
        const text = payload.text ?? "";
        seenOrder.push(`${label}:${text}`);
        arrive();
        await hold;
      };
    };

    const dispatcherA = createReplyDispatcher({
      deliver: makeDeliver("A", arriveA, holdA),
      onError: () => undefined,
    });
    const dispatcherB = createReplyDispatcher({
      deliver: makeDeliver("B", arriveB, holdB),
      onError: () => undefined,
    });

    // Intentionally omit replyOptions.runId — production mints UUID + threads ids via ref.
    const pA = dispatchReplyFromConfig({
      ctx: makeCtx({ sessionKey, messageSid: "msg-r85g-a", body: "alpha" }),
      cfg,
      dispatcher: dispatcherA,
      replyOptions: {}, // no runId
      replyResolver: makeReplyResolver({
        hookDelivery: chatHook,
        text: "alpha",
        sessionKey,
      }),
    });
    const pB = dispatchReplyFromConfig({
      ctx: makeCtx({ sessionKey, messageSid: "msg-r85g-b", body: "beta" }),
      cfg,
      dispatcher: dispatcherB,
      replyOptions: {}, // no runId
      replyResolver: makeReplyResolver({
        hookDelivery: chatHook,
        text: "beta",
        sessionKey,
      }),
    });

    // Both delivers must arrive before either is released (true interleave).
    await Promise.all([arrivedA, arrivedB]);
    expect(seenOrder).toHaveLength(2);
    expect(seenOrder.map((s) => s.split(":")[1]).toSorted()).toEqual(["alpha", "beta"]);

    releaseA();
    releaseB();
    await Promise.all([pA, pB]);

    const store = new DurableTaskOutcomeStore(storeRoot);
    const positives = readEffectiveEvolutionTaskOutcomes(cfg, "bot").filter((r) => r.succeeded);
    expect(positives).toHaveLength(2);

    const taskIds = new Set(positives.map((r) => r.taskId));
    expect(taskIds.size).toBe(2);

    for (const row of positives) {
      const taskId = row.taskId;
      if (!taskId) {
        throw new Error("expected evolution row taskId");
      }
      const record = store.loadTask(taskId);
      expect(record?.lifecycle).toBe("closed");
      expect(record?.taskJudgement).toBe("success");
      expect(record?.delivery.status).toBe("delivered");
      const deliveryId = record?.deliveryId;
      expect(deliveryId).toBeTruthy();
      if (!deliveryId) {
        throw new Error("expected deliveryId");
      }
      expect(peekAwaitingDelivery({ deliveryId })).toBeUndefined();
    }

    // Identities must not cross-wire: each deliveryId binds to its own task only.
    const idList = [...taskIds];
    const t0 = idList[0];
    const t1 = idList[1];
    if (t0 === undefined || t1 === undefined) {
      throw new Error("expected two task ids");
    }
    const r0 = store.loadTask(t0);
    const r1 = store.loadTask(t1);
    if (!r0 || !r1) {
      throw new Error("expected both task records");
    }
    expect(r0.deliveryId).not.toBe(r1.deliveryId);
    expect(r0.taskId).not.toBe(r1.taskId);
  });
});
