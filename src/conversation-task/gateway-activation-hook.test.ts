import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InMemoryActivationControlPlane } from "./control-plane.js";
import { CONVERSATION_TASK_ENV, readConversationTaskFlags } from "./feature.js";
import {
  initActivationHook,
  isActivationHookInitialized,
  observeInboundTurnActivation,
  resetActivationHookForTests,
  type GatewayActivationInput,
} from "./gateway-activation-hook.js";
import { openTaskStore } from "./store.js";

const LONG_RUNNING_TEXT = "每天监控竞品价格,如果异常就预警";
const NOW = () => 1_000;

let root: string;
const savedActivation = process.env[CONVERSATION_TASK_ENV.activation];

function input(over: Partial<GatewayActivationInput> = {}): GatewayActivationInput {
  return {
    tenantId: "tenant-a",
    requesterId: "user-1",
    conversationId: "conv-1",
    employeeScopeAllowed: false,
    messageId: "m-1",
    text: LONG_RUNNING_TEXT,
    ...over,
  };
}

function enableActivationEnv(): void {
  process.env[CONVERSATION_TASK_ENV.activation] = "1";
}

function init(over: { allow?: (tenantId: string) => boolean } = {}): void {
  const controlPlane = new InMemoryActivationControlPlane({ minReopenIntervalMs: 0, now: () => 0 });
  controlPlane.attemptReopen({ confirmedByHuman: true, actorId: "test" });
  initActivationHook({
    storeRoot: root,
    flags: () => readConversationTaskFlags(),
    isTenantAllowed: over.allow ?? (() => true),
    controlPlane,
    now: NOW,
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-act-hook-"));
  resetActivationHookForTests();
  delete process.env[CONVERSATION_TASK_ENV.activation];
});

afterEach(() => {
  resetActivationHookForTests();
  if (savedActivation === undefined) {
    delete process.env[CONVERSATION_TASK_ENV.activation];
  } else {
    process.env[CONVERSATION_TASK_ENV.activation] = savedActivation;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

describe("gateway-activation-hook", () => {
  it("is a safe no-op when uninitialized", () => {
    expect(isActivationHookInitialized()).toBe(false);
    expect(observeInboundTurnActivation(input())).toBe("uninitialized");
  });

  it("skips when the activation env flag is off", () => {
    init();
    expect(observeInboundTurnActivation(input())).toBe("skipped_flag_off");
    const store = openTaskStore({ tenantId: "tenant-a", storeRoot: root, now: NOW });
    expect(store.countTasksByLifecycle("active")).toBe(0);
    store.close();
  });

  it("activates a long-running personal turn without enterprise scope", () => {
    enableActivationEnv();
    init();
    expect(observeInboundTurnActivation(input())).toBe("activated");
    const store = openTaskStore({ tenantId: "tenant-a", storeRoot: root, now: NOW });
    const tasks = store.findActiveTasksByConversation("conv-1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.goal).toBe(LONG_RUNNING_TEXT);
    store.close();
  });

  it("is idempotent for the same conversation goal", () => {
    enableActivationEnv();
    init();
    expect(observeInboundTurnActivation(input())).toBe("activated");
    expect(observeInboundTurnActivation(input({ messageId: "m-2" }))).toBe("already_active");
  });

  it("falls back to the local tenant when tenantId is missing but the requester is trusted", () => {
    enableActivationEnv();
    init();
    expect(observeInboundTurnActivation(input({ tenantId: null }))).toBe("activated");
    const store = openTaskStore({ tenantId: "local", storeRoot: root, now: NOW });
    expect(store.findActiveTasksByConversation("conv-1")).toHaveLength(1);
    store.close();
  });

  it("does not activate ordinary chat", () => {
    enableActivationEnv();
    init();
    expect(observeInboundTurnActivation(input({ text: "你好" }))).toBe("not_detected");
  });

  it("activates an explicitly named multi-step plan without monitor words", () => {
    enableActivationEnv();
    init();
    expect(
      observeInboundTurnActivation(
        input({
          text: "这是一个多步骤任务：先调研竞品，再出方案，最后评审通过后落地",
        }),
      ),
    ).toBe("activated");
  });
});
