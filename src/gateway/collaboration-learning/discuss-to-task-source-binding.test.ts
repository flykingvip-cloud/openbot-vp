/**
 * Persistent-intent source binding: first-write-wins, no cross-principal overwrite.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  assertDiscussToTaskSourceBinding,
  clearDiscussToTaskSourceBindingsForTests,
  peekDiscussToTaskSourceBinding,
  registerDiscussToTaskSourceBinding,
} from "./discuss-to-task-source-binding.js";

afterEach(() => {
  clearDiscussToTaskSourceBindingsForTests();
});

describe("discuss-to-task-source-binding (R3 non-overwrite)", () => {
  it("does not upgrade a current-turn source to long-task scope", () => {
    const source = {
      sourceMessageId: "small-turn",
      tenantId: "t1",
      groupId: "g1",
      principalActor: "human:a",
    };
    expect(registerDiscussToTaskSourceBinding({ ...source, lifecycle: "turn" }).ok).toBe(true);
    expect(registerDiscussToTaskSourceBinding({ ...source, lifecycle: "long_task" }).ok).toBe(
      false,
    );
    expect(peekDiscussToTaskSourceBinding(source)?.lifecycle).toBe("turn");
  });
  it("rejects unbound (forged) sourceMessageId", () => {
    const r = assertDiscussToTaskSourceBinding({
      sourceMessageId: "forged-msg",
      tenantId: "t1",
      groupId: "g1",
      principalActor: "human:a",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("source_message_not_bound");
    }
  });

  it("Alice then Bob same sourceMessageId → conflict, Alice remains owner", () => {
    const a = registerDiscussToTaskSourceBinding({
      sourceMessageId: "msg-1",
      tenantId: "t1",
      groupId: "g1",
      principalActor: "human:alice",
      kind: "trusted_inbound",
    });
    expect(a.ok).toBe(true);
    const b = registerDiscussToTaskSourceBinding({
      sourceMessageId: "msg-1",
      tenantId: "t1",
      groupId: "g1",
      principalActor: "human:bob",
      kind: "trusted_inbound",
    });
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.reason).toBe("source_owner_conflict");
    }
    const peek = peekDiscussToTaskSourceBinding({
      sourceMessageId: "msg-1",
      tenantId: "t1",
      groupId: "g1",
    });
    expect(peek?.principalActor).toBe("human:alice");
    const stolen = assertDiscussToTaskSourceBinding({
      sourceMessageId: "msg-1",
      tenantId: "t1",
      groupId: "g1",
      principalActor: "human:bob",
    });
    expect(stolen.ok).toBe(false);
  });

  it("same principal re-register is idempotent (no overwrite gap)", () => {
    const first = registerDiscussToTaskSourceBinding({
      sourceMessageId: "msg-2",
      tenantId: "t1",
      groupId: "g1",
      principalActor: "human:owner",
    });
    const second = registerDiscussToTaskSourceBinding({
      sourceMessageId: "msg-2",
      tenantId: "t1",
      groupId: "g1",
      principalActor: "human:owner",
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.created).toBe(false);
      expect(second.binding.principalActor).toBe("human:owner");
    }
  });

  it("refuses registering client_idempotency_key as trusted inbound", () => {
    expect(() =>
      registerDiscussToTaskSourceBinding({
        sourceMessageId: "rpc-key",
        tenantId: "t1",
        groupId: "g1",
        principalActor: "human:owner",
        kind: "client_idempotency_key",
      }),
    ).toThrow(/trusted_inbound/);
  });

  it("isolates tenant/group namespace", () => {
    registerDiscussToTaskSourceBinding({
      sourceMessageId: "msg-ns",
      tenantId: "t1",
      groupId: "g1",
      principalActor: "human:owner",
    });
    expect(
      assertDiscussToTaskSourceBinding({
        sourceMessageId: "msg-ns",
        tenantId: "t2",
        groupId: "g1",
        principalActor: "human:owner",
      }).ok,
    ).toBe(false);
  });
});
