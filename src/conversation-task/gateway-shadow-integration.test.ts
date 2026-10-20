/**
 * ConversationTask Runtime — P2.5 gateway integration tests (admission §5; design §1.2).
 *
 * These exercise the REAL `dispatchReplyFromConfig` choke point with the shadow observer
 * wired in, proving the wiring's safety properties end-to-end (not just at the bridge unit):
 *   #14  flag OFF => the dispatched reply is byte-identical to shadow being absent.
 *   #15  a failing/slow shadow write is isolated in the async runner and never affects the reply.
 *   #17  a built-in channel turn and an extension channel turn share the exact same boundary.
 *   #1/#2 the dispatch path never enters the Activation layer (no runActivationGate/openTaskStore).
 *
 * The mock harness mirrors src/auto-reply/reply/dispatch-from-config.test.ts (re-rooted to
 * this partition) and short-circuits via a handled fast-abort so a reply is dispatched right
 * after the shadow call, keeping the surface minimal. The test file lives in the CTR partition
 * because auto-reply test files are outside the CTR lander grant.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplyDispatcher } from "../auto-reply/reply/reply-dispatcher.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import type { OpenBotConfig } from "../config/config.js";
import { createInternalHookEventPayload } from "../test-utils/internal-hook-event-payload.js";
import * as activationModule from "./activation.js";
import { ConversationTaskConfigStore, TenantAllowlistCache } from "./config-store.js";
import { ConversationTaskFlagCache } from "./flag-cache.js";
import { resetActivationHookForTests } from "./gateway-activation-hook.js";
import {
  initShadowHook,
  resetShadowHookForTests,
  shutdownShadowHook,
} from "./gateway-shadow-hook.js";
import type { ShadowMetricEvent } from "./shadow-observer.js";
import type { TenantHmacKey } from "./shadow.js";
import * as storeModule from "./store.js";

type AbortResult = { handled: boolean; aborted: boolean; stoppedSubagents?: number };

const abortMocks = vi.hoisted(() => ({
  tryFastAbortFromMessage: vi.fn<() => Promise<AbortResult>>(async () => ({
    handled: true,
    aborted: true,
    stoppedSubagents: 0,
  })),
}));
const ctxMocks = vi.hoisted(() => ({
  resolveKnowledgeSourceContext: vi.fn(async (_client?: unknown, _options?: unknown) => ({
    tenantId: "tenant-x",
    seatId: "seat-1",
    userId: "user-1",
    hasEnterpriseScope: true,
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
  resolveKnowledgeSourceContext: (client: unknown, options?: { agentType?: unknown }) =>
    ctxMocks.resolveKnowledgeSourceContext(client, options),
}));
vi.mock("../gateway/tenant-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../gateway/tenant-config.js")>();
  return {
    ...actual,
    loadTenantConfigStore: async (_storePath?: string) => ({ version: 1, tenants: {} }),
  };
});

const { dispatchReplyFromConfig } = await import("../auto-reply/reply/dispatch-from-config.js");
const { buildTestCtx } = await import("../auto-reply/reply/test-ctx.js");

const KEY: TenantHmacKey = { keyId: "k1", secret: "secret-one", issuedAtMs: 0 };
const NOW = () => 1_000;
const emptyCfg = {} as OpenBotConfig;

let root: string;
let metrics: ShadowMetricEvent[];
let configStore: ConversationTaskConfigStore | undefined;

function initShadow(
  opts: { detection?: boolean; allow?: string[]; keyProvider?: () => TenantHmacKey } = {},
): void {
  configStore?.close();
  const store = new ConversationTaskConfigStore({ storeRoot: root, now: NOW });
  configStore = store;
  if (opts.detection ?? true) {
    store.setFlag("detection", true, "ops", "canary");
  }
  for (const t of opts.allow ?? ["tenant-x"]) {
    store.setTenantAllow({ tenantId: t, enabled: true, actor: "ops", reason: "internal" });
  }
  const flagCache = new ConversationTaskFlagCache({ reader: store.flagReader(), now: NOW });
  const allowCache = new TenantAllowlistCache({ reader: store.allowReader(), now: NOW });
  initShadowHook({
    isDetectionEnabled: () => flagCache.isEnabled("detection"),
    isTenantAllowed: (t) => allowCache.isAllowed(t),
    keyProvider: opts.keyProvider ?? (() => KEY),
    storeRoot: root,
    now: NOW,
    onMetric: (e) => metrics.push(e),
  });
}

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

function finalPayload(dispatcher: ReplyDispatcher): ReplyPayload | undefined {
  return (dispatcher.sendFinalReply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
    | ReplyPayload
    | undefined;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-gw-int-"));
  metrics = [];
  resetShadowHookForTests();
  resetActivationHookForTests();
  abortMocks.tryFastAbortFromMessage.mockClear();
  ctxMocks.resolveKnowledgeSourceContext.mockClear();
  internalHookMocks.createInternalHookEvent
    .mockReset()
    .mockImplementation(createInternalHookEventPayload);
  internalHookMocks.triggerInternalHook.mockClear();
  hookMocks.runner.hasHooks.mockClear();
});
afterEach(async () => {
  await shutdownShadowHook(1_000);
  resetShadowHookForTests();
  resetActivationHookForTests();
  configStore?.close();
  configStore = undefined;
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});

describe("dispatchReplyFromConfig shadow wiring (gateway integration)", () => {
  it("#14: with detection flag OFF the dispatched reply is byte-identical to shadow absent", async () => {
    const ctx = buildTestCtx({
      Provider: "telegram",
      Surface: "telegram",
      SessionKey: "conv-1",
      MessageSid: "m-1",
      Body: "帮我把季度报告发给全部销售",
    });

    // Run A: shadow runtime not initialized at all (pure baseline).
    resetShadowHookForTests();
    const dispatcherA = createDispatcher();
    await dispatchReplyFromConfig({ ctx, cfg: emptyCfg, dispatcher: dispatcherA });
    const payloadA = finalPayload(dispatcherA);

    // Run B: shadow runtime present but detection flag OFF (default-dormant).
    initShadow({ detection: false });
    const dispatcherB = createDispatcher();
    await dispatchReplyFromConfig({ ctx, cfg: emptyCfg, dispatcher: dispatcherB });
    const payloadB = finalPayload(dispatcherB);

    expect(payloadA).toBeDefined();
    expect(payloadB).toEqual(payloadA); // byte-identical reply
    // Shadow ran in B but did nothing beyond recording it was flag-off; no write enqueued.
    expect(metrics.some((m) => m.type === "observe" && m.status === "skipped_flag_off")).toBe(true);
    expect(metrics.some((m) => m.type === "write")).toBe(false);
  });

  it("#15: a throwing shadow key provider is isolated in the runner and never affects the reply", async () => {
    initShadow({
      detection: true,
      allow: ["tenant-x"],
      keyProvider: () => {
        throw new Error("hmac_key_missing");
      },
    });
    ctxMocks.resolveKnowledgeSourceContext.mockResolvedValueOnce({
      tenantId: "tenant-x",
      seatId: "seat-1",
      userId: "user-1",
      hasEnterpriseScope: true,
    });
    const ctx = buildTestCtx({
      Provider: "telegram",
      Surface: "telegram",
      SessionKey: "conv-1",
      MessageSid: "m-1",
      Body: "帮我把季度报告发给全部销售",
    });
    const dispatcher = createDispatcher();

    // Dispatch resolves normally and the reply is delivered despite the shadow write failing.
    await expect(
      dispatchReplyFromConfig({ ctx, cfg: emptyCfg, dispatcher }),
    ).resolves.toBeDefined();
    expect(dispatcher.sendFinalReply).toHaveBeenCalledTimes(1);

    // The failure surfaced only in the async runner (off the reply path), never as a throw.
    await shutdownShadowHook(1_000);
    const sawWriteError = metrics.some(
      (m) => m.type === "write_error" || (m.type === "runner" && m.event.type === "failure"),
    );
    expect(sawWriteError).toBe(true);
    // The observer still classified the turn as observed (write handed off, not inline).
    expect(metrics.some((m) => m.type === "observe" && m.status === "observed")).toBe(true);
  });

  it("#17: a built-in channel turn and an extension channel turn hit the same passive boundary", async () => {
    initShadow({ detection: true, allow: ["tenant-x"] });

    const builtinCtx = buildTestCtx({
      Provider: "telegram",
      Surface: "telegram",
      SessionKey: "conv-builtin",
      MessageSid: "m-builtin",
      Body: "帮我把季度报告发给全部销售",
    });
    const extensionCtx = buildTestCtx({
      Provider: "msteams",
      Surface: "msteams",
      SessionKey: "conv-extension",
      MessageSid: "m-extension",
      Body: "帮我把季度报告发给全部销售",
    });

    await dispatchReplyFromConfig({
      ctx: builtinCtx,
      cfg: emptyCfg,
      dispatcher: createDispatcher(),
    });
    await dispatchReplyFromConfig({
      ctx: extensionCtx,
      cfg: emptyCfg,
      dispatcher: createDispatcher(),
    });
    await shutdownShadowHook(1_000);

    // Same boundary: both surfaces produced exactly one "observed" decision and one write.
    const observed = metrics.filter((m) => m.type === "observe" && m.status === "observed");
    expect(observed).toHaveLength(2);
    const inserted = metrics.filter((m) => m.type === "write" && m.outcome === "inserted");
    expect(inserted).toHaveLength(2);
  });

  it("#1/#2: with the activation hook uninitialized, dispatch never enters the Activation layer", async () => {
    const activationSpy = vi.spyOn(activationModule, "runActivationGate");
    const storeSpy = vi.spyOn(storeModule, "openTaskStore");
    try {
      initShadow({ detection: true, allow: ["tenant-x"] });
      const ctx = buildTestCtx({
        Provider: "telegram",
        Surface: "telegram",
        SessionKey: "conv-1",
        MessageSid: "m-1",
        Body: "帮我把季度报告发给全部销售",
      });
      await dispatchReplyFromConfig({ ctx, cfg: emptyCfg, dispatcher: createDispatcher() });
      await shutdownShadowHook(1_000);

      expect(activationSpy).not.toHaveBeenCalled();
      expect(storeSpy).not.toHaveBeenCalled();
      // Sanity: the turn really did flow through the observer (so the assertion is meaningful).
      expect(metrics.some((m) => m.type === "observe" && m.status === "observed")).toBe(true);
    } finally {
      activationSpy.mockRestore();
      storeSpy.mockRestore();
    }
  });
});
