/**
 * P2 — dispatch-from-config observe standby regression lock.
 *
 * Hot-path observe* helpers are sync-called every turn. When hooks are
 * uninitialized and feature flags stay at defaults, they must not mutate
 * reply payloads, open Task stores, run Activation Gate, or invoke tools.
 * Per-entry dormant tests already exist; this file locks the choke-point
 * inventory + default-off behaviour in one place.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONVERSATION_TASK_ENV } from "../../conversation-task/feature.js";
import {
  observeInboundTurnActivation,
  resetActivationHookForTests,
} from "../../conversation-task/gateway-activation-hook.js";
import {
  observeInboundTurnShadow,
  resetShadowHookForTests,
} from "../../conversation-task/gateway-shadow-hook.js";
import { observeConversationTaskReplyCompleted } from "../../conversation-task/reply-completion.js";
import {
  getLastOrchShadowObservation,
  resetOrchShadowObservation,
} from "../../task-orchestration/dispatch.js";
import { ORCHESTRATION_ENV, WEB_READ_SHADOW_ENV } from "../../task-orchestration/feature.js";
import { ORCHESTRATION_LIVE_INVOKE } from "../../task-orchestration/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const DISPATCH_REL = "src/auto-reply/reply/dispatch-from-config.ts";

const OBSERVE_HELPERS = [
  "observeInboundTurnShadow",
  "observeInboundTurnActivation",
  "observeOrchestrationConsider",
  "observeWebReadShadowFromChat",
  "observeConversationTaskReplyCompleted",
] as const;

const FLAG_ENVS = [
  CONVERSATION_TASK_ENV.activation,
  ORCHESTRATION_ENV.shadowEnabled,
  ORCHESTRATION_ENV.dispatchEnabled,
  ORCHESTRATION_ENV.nodeEnabled,
  ORCHESTRATION_ENV.browserEnabled,
  WEB_READ_SHADOW_ENV,
] as const;

const savedEnv = new Map<string, string | undefined>();

function clearObserveFlags(): void {
  for (const key of FLAG_ENVS) {
    if (!savedEnv.has(key)) {
      savedEnv.set(key, process.env[key]);
    }
    delete process.env[key];
  }
}

function restoreObserveFlags(): void {
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  savedEnv.clear();
}

describe("dispatch-from-config observe standby (P2)", () => {
  beforeEach(() => {
    clearObserveFlags();
    resetShadowHookForTests();
    resetActivationHookForTests();
    resetOrchShadowObservation();
  });

  afterEach(() => {
    resetShadowHookForTests();
    resetActivationHookForTests();
    resetOrchShadowObservation();
    restoreObserveFlags();
    vi.restoreAllMocks();
  });

  it("keeps the five observe helpers wired at the reply choke point", () => {
    const src = readFileSync(resolve(REPO_ROOT, DISPATCH_REL), "utf8");
    for (const name of OBSERVE_HELPERS) {
      expect(src, `${name} must stay wired in ${DISPATCH_REL}`).toContain(`${name}(`);
    }
  });

  it("shadow + activation are uninitialized no-ops and do not open stores", async () => {
    const analyze = vi.spyOn(await import("../../conversation-task/signals.js"), "analyzeTurn");
    const detect = vi.spyOn(await import("../../conversation-task/detector.js"), "detectTurn");
    const openStore = vi.spyOn(await import("../../conversation-task/store.js"), "openTaskStore");

    expect(
      observeInboundTurnShadow({
        tenantId: "t-1",
        requesterId: "u-1",
        conversationId: "c-1",
        employeeScopeAllowed: true,
        messageId: "m-1",
        text: "你好",
      }),
    ).toBe("uninitialized");

    expect(
      observeInboundTurnActivation({
        tenantId: "t-1",
        requesterId: "u-1",
        conversationId: "c-1",
        employeeScopeAllowed: true,
        messageId: "m-1",
        text: "每天监控竞品价格,如果异常就预警",
      }),
    ).toBe("uninitialized");

    expect(analyze).not.toHaveBeenCalled();
    expect(detect).not.toHaveBeenCalled();
    expect(openStore).not.toHaveBeenCalled();
  });

  it("orchestration + web_read stay dormant with default-off flags", async () => {
    const { observeOrchestrationConsider, observeWebReadShadowFromChat } =
      await import("../../task-orchestration/gateway-hook.js");
    const evalMod = await import("../../task-orchestration/web-read-shadow-eval.js");
    const evaluate = vi.spyOn(evalMod, "evaluateWebReadShadow");
    const sink = vi.fn();

    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    expect(() =>
      observeOrchestrationConsider({
        tenantId: "t-1",
        requesterId: "u-1",
        conversationId: "c-1",
        messageId: "m-1",
        text: "帮我读一下这个网页",
      }),
    ).not.toThrow();
    expect(getLastOrchShadowObservation()).toBeNull();

    observeWebReadShadowFromChat(
      {
        cfg: { data: { mode: "local" } } as never,
        tenantId: "t-1",
        messageId: "m-1",
        utterance: "帮我读一下这个网页 https://example.com",
      },
      sink,
    );
    expect(evaluate).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
  });

  it("reply-completion observe does not close tasks when activation is default-off", async () => {
    const openStore = vi.spyOn(await import("../../conversation-task/store.js"), "openTaskStore");
    const closed = await observeConversationTaskReplyCompleted({
      tenantId: "local",
      requesterId: "u-1",
      conversationId: "agent:main:main",
      sourceMessageId: "m-1",
      text: "监控任务",
    });
    expect(closed).toBeUndefined();
    expect(openStore).not.toHaveBeenCalled();
  });
});
