/**
 * R85f proof: task classification from preflight intent (not hookDelivery presence),
 * plus four production-entry scenarios via runReplyAgent + production confirm.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FollowupRun, QueueSettings } from "../auto-reply/reply/queue.js";
import { createMockTypingController } from "../auto-reply/reply/test-helpers.js";
import type { TemplateContext } from "../auto-reply/templating.js";
import type { OpenBotConfig } from "../config/config.js";
import {
  CHAT_TURN_CONTRACT_V1,
  chatTurnTaskId,
  resolveChatTurnCloseGates,
  resolveTurnContractFromRunMeta,
} from "./chat-entry.js";
import { resolveRequiredDeliveryConfirmStatus } from "./delivery-confirm.js";
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
    queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
    runEmbeddedPiAgent: mocks.runEmbeddedPiAgent,
  };
});

vi.mock("../auto-reply/reply/queue.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auto-reply/reply/queue.js")>();
  return { ...actual, enqueueFollowupRun: vi.fn(), scheduleFollowupDrain: vi.fn() };
});

import { runReplyAgent } from "../auto-reply/reply/agent-runner.js";
import { confirmPendingTurnDelivery } from "../auto-reply/reply/dispatch-from-config.js";
import { createReplyDispatcher } from "../auto-reply/reply/reply-dispatcher.js";

describe("R85f: classify from preflight intent (not hookDelivery presence)", () => {
  it("hookDelivery/not_required + chat intent → chat_turn waiver", () => {
    const contract = resolveTurnContractFromRunMeta({
      hookDelivery: {
        validatorsRequired: false,
        decisionCode: "not_required",
        intentClass: "chat",
      },
    });
    expect(contract.kind).toBe("chat_turn");
    expect(contract.id).toBe(CHAT_TURN_CONTRACT_V1);
    const gates = resolveChatTurnCloseGates({
      deliveryId: "delivery:chat-ok",
      contract,
      deliveryPhase: "delivered",
    });
    expect(gates.acceptance.status).toBe("not_required");
  });

  it("hookDelivery present alone is NOT execution — empty/unknown meta → unknown", () => {
    const contract = resolveTurnContractFromRunMeta({
      hookDelivery: {
        // presence alone must not waive or force execution
        decisionCode: "delivery_blocked",
        validatorsRequired: false,
      },
    });
    expect(contract.kind).toBe("unknown");
    const gates = resolveChatTurnCloseGates({
      deliveryId: "delivery:unknown",
      contract,
      deliveryPhase: "awaiting",
    });
    expect(gates.acceptance.status).toBe("pending");
  });

  it("execution + empty validators (primarySkill) → pending, not chat waive", () => {
    const contract = resolveTurnContractFromRunMeta({
      hookDelivery: {
        validatorsRequired: false,
        decisionCode: "not_required",
        intentClass: "chat",
        primarySkill: "pptx",
      },
    });
    expect(contract.kind).toBe("execution");
    const gates = resolveChatTurnCloseGates({
      deliveryId: "delivery:exec-noval",
      contract,
      deliveryPhase: "delivered",
    });
    expect(gates.acceptance.status).toBe("pending");
  });

  it("non-chat intentClass with empty validators → execution pending", () => {
    const contract = resolveTurnContractFromRunMeta({
      hookDelivery: {
        validatorsRequired: false,
        decisionCode: "not_required",
        intentClass: "short_action",
      },
    });
    expect(contract.kind).toBe("execution");
    expect(
      resolveChatTurnCloseGates({
        deliveryId: "delivery:short",
        contract,
        deliveryPhase: "delivered",
      }).acceptance.status,
    ).toBe("pending");
  });

  it("validators required + verified → passed", () => {
    const contract = resolveTurnContractFromRunMeta({
      hookDelivery: {
        validatorsRequired: true,
        decisionCode: "delivery_receipt_verified",
        intentClass: "multi_stage",
        primarySkill: "pptx",
        validatorReceipts: [{ validatorId: "json-canvas" }],
      },
      hookValidatorsRequired: true,
    });
    expect(contract.kind).toBe("execution");
    expect(contract.acceptanceVerified).toBe(true);
    expect(
      resolveChatTurnCloseGates({
        deliveryId: "delivery:verified",
        contract,
        deliveryPhase: "delivered",
        acceptanceVerified: true,
      }).acceptance.status,
    ).toBe("passed");
  });

  it("missing meta → unknown pending (do not invent chat)", () => {
    const contract = resolveTurnContractFromRunMeta(undefined);
    expect(contract.kind).toBe("unknown");
  });
});

describe("R85f: four production-entry scenarios (runReplyAgent + production confirm)", () => {
  let agentDir = "";
  let storeRoot = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "r85f-agent-"));
    storeRoot = path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME);
    cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
    clearAwaitingDeliveriesForTests(storeRoot);
    mocks.runEmbeddedPiAgent.mockReset();
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

  function buildParams(opts: {
    runId?: string;
    sessionKey?: string;
    pendingTurnDeliveryRef?: NonNullable<
      Parameters<typeof runReplyAgent>[0]["opts"]
    >["pendingTurnDeliveryRef"];
  }) {
    const sessionKey = opts.sessionKey ?? "sess";
    return {
      commandBody: "hello",
      followupRun: {
        prompt: "hello",
        enqueuedAt: Date.now(),
        run: {
          agentId: "bot",
          agentDir,
          sessionId: "session",
          sessionKey,
          messageProvider: "telegram",
          sessionFile: path.join(agentDir, "session.jsonl"),
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
          gatewayClientPlatformUserId: "u-r85f",
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
        MessageSid: "msg-1",
        GatewayClientPlatformUserId: "u-r85f",
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

  function mockEmbedded(hookDelivery: Record<string, unknown>) {
    mocks.runEmbeddedPiAgent.mockResolvedValue({
      payloads: [{ text: "hello-r85f" }],
      meta: {
        durationMs: 1,
        agentMeta: { sessionId: "session", provider: "anthropic", model: "claude" },
        hookDelivery,
        hookValidatorsRequired: hookDelivery.validatorsRequired === true,
      },
    });
  }

  it("1) ordinary chat: hookDelivery/not_required + real send success → closed/success, one positive", async () => {
    const runId = "run-r85f-chat-ok";
    const pendingRef: {
      current?: { runId: string; deliveryId: string; taskId: string; agentId: string };
    } = {};
    mockEmbedded({
      taskId: "exec-task",
      attemptNumber: 1,
      validatorsRequired: false,
      decisionCode: "not_required",
      allowedToDeliver: true,
      intentClass: "chat",
    });

    const result = await runReplyAgent(buildParams({ runId, pendingTurnDeliveryRef: pendingRef }));
    expect(result).toMatchObject({ text: "hello-r85f" });
    expect(pendingRef.current?.deliveryId).toBe(`delivery:${runId}:visible`);
    expect(pendingRef.current?.taskId).toBe(
      chatTurnTaskId({ agentId: "bot", runId, sessionKey: "sess" }),
    );

    const store = new DurableTaskOutcomeStore(storeRoot);
    const prepared = store.loadTask(pendingRef.current!.taskId);
    expect(prepared?.acceptance.status).toBe("not_required");
    expect(prepared?.delivery.status).toBe("pending");
    expect(prepared?.lifecycle).toBe("awaiting_delivery");

    const delivered: string[] = [];
    const dispatcher = createReplyDispatcher({
      deliver: async (payload) => {
        delivered.push(payload.text ?? "");
      },
    });
    expect(dispatcher.sendFinalReply({ text: "hello-r85f" })).toBe(true);
    await dispatcher.waitForIdle();
    const outcomes = dispatcher.getDeliveryOutcomes?.() ?? [];
    expect(outcomes).toEqual([{ kind: "final", ok: true }]);
    expect(delivered).toEqual(["hello-r85f"]);

    const status = resolveRequiredDeliveryConfirmStatus(
      outcomes.map((o) => ({
        source: "deliver" as const,
        ok: o.ok,
        ...(o.error ? { error: o.error } : {}),
      })),
    );
    expect(status).toBe("delivered");

    // Production confirm (exported) — no copied confirmLikeDispatch.
    await confirmPendingTurnDelivery({
      cfg,
      deliveryId: pendingRef.current!.deliveryId,
      taskId: pendingRef.current!.taskId,
      status: "delivered",
    });

    const closed = store.loadTask(pendingRef.current!.taskId);
    expect(closed?.lifecycle).toBe("closed");
    expect(closed?.taskJudgement).toBe("success");
    const positives = readEffectiveEvolutionTaskOutcomes(cfg, "bot").filter(
      (r) => r.taskId === pendingRef.current!.taskId && r.succeeded,
    );
    expect(positives).toHaveLength(1);
    expect(peekAwaitingDelivery({ deliveryId: pendingRef.current!.deliveryId })).toBeUndefined();
  });

  it("2) execution missing validators: send success still incomplete (no waive)", async () => {
    const runId = "run-r85f-exec-noval";
    const pendingRef: {
      current?: { runId: string; deliveryId: string; taskId: string; agentId: string };
    } = {};
    mockEmbedded({
      taskId: "exec-task",
      attemptNumber: 1,
      validatorsRequired: false,
      decisionCode: "not_required",
      allowedToDeliver: true,
      intentClass: "chat",
      primarySkill: "pptx",
    });

    await runReplyAgent(buildParams({ runId, pendingTurnDeliveryRef: pendingRef }));
    const taskId = pendingRef.current!.taskId;
    const store = new DurableTaskOutcomeStore(storeRoot);
    expect(store.loadTask(taskId)?.acceptance.status).toBe("pending");

    const dispatcher = createReplyDispatcher({
      deliver: async () => {},
    });
    expect(dispatcher.sendFinalReply({ text: "artifact ready" })).toBe(true);
    await dispatcher.waitForIdle();
    await confirmPendingTurnDelivery({
      cfg,
      deliveryId: pendingRef.current!.deliveryId,
      taskId,
      status: "delivered",
    });

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

  it("3) async deliver throw after enqueue → no positive sample", async () => {
    const runId = "run-r85f-send-fail";
    const pendingRef: {
      current?: { runId: string; deliveryId: string; taskId: string; agentId: string };
    } = {};
    mockEmbedded({
      taskId: "exec-task",
      attemptNumber: 1,
      validatorsRequired: false,
      decisionCode: "not_required",
      allowedToDeliver: true,
      intentClass: "chat",
    });

    await runReplyAgent(buildParams({ runId, pendingTurnDeliveryRef: pendingRef }));
    const taskId = pendingRef.current!.taskId;

    const dispatcher = createReplyDispatcher({
      deliver: async () => {
        await Promise.resolve();
        throw new Error("channel_send_boom");
      },
      onError: () => {
        /* swallow like production */
      },
    });
    expect(dispatcher.sendFinalReply({ text: "will-fail" })).toBe(true);
    await dispatcher.waitForIdle();
    const outcomes = dispatcher.getDeliveryOutcomes?.() ?? [];
    expect(outcomes[0]?.ok).toBe(false);

    const status = resolveRequiredDeliveryConfirmStatus(
      outcomes.map((o) => ({
        source: "deliver" as const,
        ok: o.ok,
        ...(o.error ? { error: o.error } : {}),
      })),
    );
    expect(status).toBe("failed");

    await confirmPendingTurnDelivery({
      cfg,
      deliveryId: pendingRef.current!.deliveryId,
      taskId,
      status: "failed",
      error: outcomes[0]?.error,
    });

    const store = new DurableTaskOutcomeStore(storeRoot);
    const record = store.loadTask(taskId);
    expect(record?.taskJudgement).not.toBe("success");
    expect(record?.delivery.status).toBe("failed");
    expect(
      readEffectiveEvolutionTaskOutcomes(cfg, "bot").filter(
        (r) => r.taskId === taskId && r.succeeded,
      ),
    ).toHaveLength(0);
  });

  it("4) caller omits runId: two parallel tasks update independently (no cross-wire)", async () => {
    const specs = [
      { runId: "run-r85f-a", text: "alpha" },
      { runId: "run-r85f-b", text: "beta" },
    ] as const;
    const refs = specs.map(() => ({
      current: undefined as
        | { runId: string; deliveryId: string; taskId: string; agentId: string }
        | undefined,
    }));

    for (let i = 0; i < specs.length; i++) {
      mockEmbedded({
        taskId: `exec-${specs[i].runId}`,
        attemptNumber: 1,
        validatorsRequired: false,
        decisionCode: "not_required",
        allowedToDeliver: true,
        intentClass: "chat",
      });
      await runReplyAgent(
        buildParams({
          runId: specs[i].runId,
          sessionKey: "sess-shared",
          pendingTurnDeliveryRef: refs[i],
        }),
      );
    }

    expect(refs[0].current?.taskId).not.toBe(refs[1].current?.taskId);
    expect(refs[0].current?.deliveryId).not.toBe(refs[1].current?.deliveryId);

    // Confirm WITHOUT runId — production lookup by deliveryId/taskId.
    for (let i = 0; i < specs.length; i++) {
      const dispatcher = createReplyDispatcher({
        deliver: async () => {},
      });
      expect(dispatcher.sendFinalReply({ text: specs[i].text })).toBe(true);
      await dispatcher.waitForIdle();
      await confirmPendingTurnDelivery({
        cfg,
        // intentionally omit runId
        deliveryId: refs[i].current!.deliveryId,
        taskId: refs[i].current!.taskId,
        status: "delivered",
      });
    }

    const store = new DurableTaskOutcomeStore(storeRoot);
    for (const ref of refs) {
      const record = store.loadTask(ref.current!.taskId);
      expect(record?.lifecycle).toBe("closed");
      expect(record?.taskJudgement).toBe("success");
      expect(record?.deliveryId).toBe(ref.current!.deliveryId);
      expect(record?.delivery.status).toBe("delivered");
    }
    expect(readEffectiveEvolutionTaskOutcomes(cfg, "bot").filter((r) => r.succeeded)).toHaveLength(
      2,
    );
  });
});
