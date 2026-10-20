import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConversationTaskAccess } from "./acl.js";
import {
  frozenActiveTaskCount,
  runActivationGate,
  type ActivationGateInput,
} from "./activation.js";
import { normalizeGoal } from "./canonical.js";
import { InMemoryActivationControlPlane } from "./control-plane.js";
import { ConversationTaskAccessError } from "./errors.js";
import type { ConversationTaskFlags } from "./feature.js";
import { openTaskStore, type TaskStore } from "./store.js";
import type { QualificationResult } from "./types.js";

const LONG_RUNNING_TEXT = "每天监控竞品价格,如果异常就预警";
const LONG_RUNNING: QualificationResult = { kind: "long_running_candidate", reasons: [] };

function flags(activation: boolean): ConversationTaskFlags {
  return {
    detection: true,
    qualification: true,
    activation,
    projection: false,
    authorization: false,
  };
}

function access(over: Partial<ConversationTaskAccess> = {}): ConversationTaskAccess {
  return {
    tenantId: "tenant-a",
    conversationId: "conv-1",
    requesterId: "user-1",
    authorizedConversationIds: new Set(["conv-1"]),
    employeeScopeAllowed: true,
    ...over,
  };
}

function gateInput(over: Partial<ActivationGateInput> = {}): ActivationGateInput {
  return {
    turn: { messageId: "m1", text: LONG_RUNNING_TEXT },
    qualification: LONG_RUNNING,
    access: access(),
    messageConversationId: "conv-1",
    activationEpoch: 1,
    ...over,
  };
}

let root: string;
let store: TaskStore;
let controlPlane: InMemoryActivationControlPlane;

/** Enable activation via the controlled reopen (a fresh plane is forced-off). */
function enableControlPlane(): void {
  controlPlane.attemptReopen({ confirmedByHuman: true, actorId: "bootstrap" });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ct-activation-"));
  store = openTaskStore({ tenantId: "tenant-a", storeRoot: root, now: () => 1_000 });
  controlPlane = new InMemoryActivationControlPlane({ minReopenIntervalMs: 0, now: () => 0 });
});

afterEach(() => {
  store.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("Activation Gate — first start / uninitialized control plane (P0)", () => {
  it("stays shadow_frozen with the flag ON when the control plane is uninitialized", () => {
    // No enableControlPlane(): a fresh control plane is forced-off.
    const out = runActivationGate(store, gateInput(), flags(true), controlPlane);
    expect(out.mode).toBe("shadow_frozen");
    expect(out.reasons).toContain("activation_force_off");
    expect(store.countTasksByLifecycle("active")).toBe(0);
  });
});

describe("Activation Gate — flag ON (control plane enabled)", () => {
  beforeEach(() => enableControlPlane());

  it("activates a qualified long-running candidate once and is idempotent", () => {
    const first = runActivationGate(store, gateInput(), flags(true), controlPlane);
    expect(first.activated).toBe(true);
    expect(first.mode).toBe("activated");
    expect(store.countTasksByLifecycle("active")).toBe(1);

    const second = runActivationGate(store, gateInput(), flags(true), controlPlane);
    expect(second.activated).toBe(false);
    expect(second.mode).toBe("already_active");
    expect(store.countTasksByLifecycle("active")).toBe(1);
  });

  it("fails closed on an out-of-scope access and writes nothing", () => {
    expect(() =>
      runActivationGate(
        store,
        gateInput({ access: access({ authorizedConversationIds: new Set(["other"]) }) }),
        flags(true),
        controlPlane,
      ),
    ).toThrow(ConversationTaskAccessError);
    expect(store.countTasksByLifecycle("active")).toBe(0);
  });

  it("does not create a task for a non long-running qualification", () => {
    const out = runActivationGate(
      store,
      gateInput({ qualification: { kind: "chat", reasons: [] } }),
      flags(true),
      controlPlane,
    );
    expect(out.mode).toBe("not_eligible");
    expect(store.countTasksByLifecycle("active")).toBe(0);
  });

  it("P0: refuses a cross-tenant write (access tenant != store tenant)", () => {
    const crossTenant = access({ tenantId: "tenant-b" });
    expect(() =>
      runActivationGate(store, gateInput({ access: crossTenant }), flags(true), controlPlane),
    ).toThrow(/tenant_binding/);
    expect(store.countTasksByLifecycle("active")).toBe(0);
  });

  it("P0: refuses cross-conversation detection input before any write", () => {
    expect(() =>
      runActivationGate(
        store,
        gateInput({ messageConversationId: "conv-2" }),
        flags(true),
        controlPlane,
      ),
    ).toThrow(/detection_scope/);
    expect(store.countTasksByLifecycle("active")).toBe(0);
  });
});

describe("Activation Gate — freeze-read-only (O2)", () => {
  beforeEach(() => enableControlPlane());

  it("computes the decision in shadow and writes nothing when the flag is OFF", () => {
    const out = runActivationGate(store, gateInput(), flags(false), controlPlane);
    expect(out.activated).toBe(false);
    expect(out.mode).toBe("shadow_frozen");
    expect(out.decision.canActivate).toBe(true);
    expect(store.countTasksByLifecycle("active")).toBe(0);
  });

  it("freezes existing active tasks: readable, not advanced, counted", () => {
    runActivationGate(store, gateInput(), flags(true), controlPlane);
    expect(store.countTasksByLifecycle("active")).toBe(1);

    const frozen = runActivationGate(store, gateInput(), flags(false), controlPlane);
    expect(frozen.mode).toBe("shadow_frozen");
    expect(store.countTasksByLifecycle("active")).toBe(1);
    expect(frozenActiveTaskCount(store, flags(false), controlPlane)).toBe(1);
    expect(frozenActiveTaskCount(store, flags(true), controlPlane)).toBe(0);

    const task = store.getTask({
      conversationId: "conv-1",
      normalizedGoal: normalizeGoal(LONG_RUNNING_TEXT),
      activationEpoch: 1,
    });
    expect(task?.lifecycle).toBe("active");
  });

  it("freezes when the control plane has force-disabled activation, even with the flag on", () => {
    controlPlane.forceOff({ reason: "upgrade_precision_below_min" });
    const out = runActivationGate(store, gateInput(), flags(true), controlPlane);
    expect(out.mode).toBe("shadow_frozen");
    expect(out.reasons).toContain("activation_force_off");
    expect(store.countTasksByLifecycle("active")).toBe(0);
  });
});
