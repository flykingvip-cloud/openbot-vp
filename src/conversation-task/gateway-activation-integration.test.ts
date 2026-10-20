/**
 * Dispatch choke-point contract for Activation:
 *   flag off / hook absent => no Task store write
 *   env ON + hook initialized + control plane reopened => long-running turn creates a task
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplyDispatcher } from "../auto-reply/reply/reply-dispatcher.js";
import type { OpenBotConfig } from "../config/config.js";
import { createInternalHookEventPayload } from "../test-utils/internal-hook-event-payload.js";
import { InMemoryActivationControlPlane } from "./control-plane.js";
import { CONVERSATION_TASK_ENV, readConversationTaskFlags } from "./feature.js";
import { initActivationHook, resetActivationHookForTests } from "./gateway-activation-hook.js";
import { resetShadowHookForTests, shutdownShadowHook } from "./gateway-shadow-hook.js";
import { openTaskStore } from "./store.js";

type AbortResult = { handled: boolean; aborted: boolean; stoppedSubagents?: number };

const abortMocks = vi.hoisted(() => ({
  tryFastAbortFromMessage: vi.fn<() => Promise<AbortResult>>(async () => ({
    handled: true,
    aborted: true,
    stoppedSubagents: 0,
  })),
}));
const ctxMocks = vi.hoisted(() => ({
  resolveKnowledgeSourceContext: vi.fn(async () => ({
    tenantId: "tenant-x",
    seatId: "seat-1",
    userId: "user-1",
    hasEnterpriseScope: false,
  })),
}));
const hookMocks = vi.hoisted(() => ({
  runner: { hasHooks: vi.fn(() => false), runMessageReceived: vi.fn(async () => {}) },
}));
const internalHookMocks = vi.hoisted(() => ({
  createInternalHookEvent: vi.fn(),
  triggerInternalHook: vi.fn(async () => {}),
}));

vi.mock("../auto-reply/reply/abort.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auto-reply/reply/abort.js")>();
  return { ...actual, tryFastAbortFromMessage: abortMocks.tryFastAbortFromMessage };
});
vi.mock("../auto-reply/reply/route-reply.js", () => ({
  isRoutableChannel: () => false,
  routeReply: vi.fn(async () => ({ ok: true, messageId: "mock" })),
}));
vi.mock("../auto-reply/reply/inbound-dedupe.js", () => ({
  shouldSkipDuplicateInbound: () => false,
  resetInboundDedupe: () => {},
}));
vi.mock("../logging/diagnostic.js", () => ({
  logMessageQueued: vi.fn(),
  logMessageProcessed: vi.fn(),
  logSessionStateChange: vi.fn(),
}));
vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => hookMocks.runner,
}));
vi.mock("../hooks/internal-hooks.js", () => ({
  createInternalHookEvent: internalHookMocks.createInternalHookEvent,
  triggerInternalHook: internalHookMocks.triggerInternalHook,
}));
vi.mock("../gateway/knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: () => ctxMocks.resolveKnowledgeSourceContext(),
}));
vi.mock("../gateway/tenant-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../gateway/tenant-config.js")>();
  return {
    ...actual,
    loadTenantConfigStore: async () => ({ version: 1, tenants: {} }),
  };
});

const { dispatchReplyFromConfig } = await import("../auto-reply/reply/dispatch-from-config.js");
const { buildTestCtx } = await import("../auto-reply/reply/test-ctx.js");

const NOW = () => 1_000;
const emptyCfg = {} as OpenBotConfig;
const savedActivation = process.env[CONVERSATION_TASK_ENV.activation];

let root: string;

function createDispatcher(): ReplyDispatcher {
  return {
    sendToolResult: vi.fn(() => true),
    sendBlockReply: vi.fn(() => true),
    sendFinalReply: vi.fn(() => true),
    waitForIdle: vi.fn(async () => {}),
    getQueuedCounts: vi.fn(() => ({ tool: 0, block: 0, final: 0 })),
    markComplete: vi.fn(),
  } as unknown as ReplyDispatcher;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-act-int-"));
  resetActivationHookForTests();
  resetShadowHookForTests();
  delete process.env[CONVERSATION_TASK_ENV.activation];
  abortMocks.tryFastAbortFromMessage.mockClear();
  ctxMocks.resolveKnowledgeSourceContext.mockClear();
  internalHookMocks.createInternalHookEvent
    .mockReset()
    .mockImplementation(createInternalHookEventPayload);
  internalHookMocks.triggerInternalHook.mockClear();
});

afterEach(async () => {
  await shutdownShadowHook(500);
  resetShadowHookForTests();
  resetActivationHookForTests();
  if (savedActivation === undefined) {
    delete process.env[CONVERSATION_TASK_ENV.activation];
  } else {
    process.env[CONVERSATION_TASK_ENV.activation] = savedActivation;
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

describe("dispatchReplyFromConfig activation wiring", () => {
  it("does not open a task when the activation hook is absent", async () => {
    const ctx = buildTestCtx({
      Provider: "telegram",
      Surface: "telegram",
      SessionKey: "conv-1",
      MessageSid: "m-1",
      Body: "每天监控竞品价格,如果异常就预警",
    });
    await dispatchReplyFromConfig({
      ctx,
      cfg: emptyCfg,
      dispatcher: createDispatcher(),
    });
    expect(fs.existsSync(root)).toBe(true);
    // No tenant store is created because the hook never ran a write.
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("creates a ConversationTask when env activation is ON", async () => {
    process.env[CONVERSATION_TASK_ENV.activation] = "1";
    const controlPlane = new InMemoryActivationControlPlane({
      minReopenIntervalMs: 0,
      now: () => 0,
    });
    controlPlane.attemptReopen({ confirmedByHuman: true, actorId: "test" });
    const statuses: string[] = [];
    initActivationHook({
      storeRoot: root,
      flags: () => readConversationTaskFlags(),
      isTenantAllowed: () => true,
      controlPlane,
      now: NOW,
      onStatus: (status) => statuses.push(status),
    });
    const ctx = buildTestCtx({
      Provider: "telegram",
      Surface: "telegram",
      SessionKey: "conv-1",
      MessageSid: "m-1",
      Body: "每天监控竞品价格,如果异常就预警",
    });
    await dispatchReplyFromConfig({
      ctx,
      cfg: emptyCfg,
      dispatcher: createDispatcher(),
    });
    expect(statuses).toContain("activated");
    const store = openTaskStore({ tenantId: "tenant-x", storeRoot: root, now: NOW });
    expect(store.findActiveTasksByConversation("conv-1")).toHaveLength(1);
    store.close();
  });
});
