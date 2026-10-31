/**
 * Source binding ownership for discuss→task (phase-1 review checkpoints).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  assertDiscussToTaskSourceBinding,
  clearDiscussToTaskSourceBindingsForTests,
  registerDiscussToTaskSourceBinding,
} from "./discuss-to-task-source-binding.js";

afterEach(() => {
  clearDiscussToTaskSourceBindingsForTests();
});

describe("discuss-to-task-source-binding", () => {
  it("rejects unbound (forged) sourceMessageId", () => {
    const r = assertDiscussToTaskSourceBinding({
      sourceMessageId: "forged-msg",
      tenantId: "t1",
      groupId: "g1",
      actor: "human:a",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("source_message_not_bound");
    }
  });

  it("rejects cross-user reuse of a bound sourceMessageId", () => {
    registerDiscussToTaskSourceBinding({
      sourceMessageId: "msg-1",
      tenantId: "t1",
      groupId: "g1",
      actor: "human:owner",
    });
    const r = assertDiscussToTaskSourceBinding({
      sourceMessageId: "msg-1",
      tenantId: "t1",
      groupId: "g1",
      actor: "human:other",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("source_message_actor_mismatch");
    }
  });

  it("accepts same actor retry", () => {
    registerDiscussToTaskSourceBinding({
      sourceMessageId: "msg-2",
      tenantId: "t1",
      groupId: "g1",
      actor: "human:owner",
    });
    const r = assertDiscussToTaskSourceBinding({
      sourceMessageId: "msg-2",
      tenantId: "t1",
      groupId: "g1",
      actor: "human:owner",
    });
    expect(r.ok).toBe(true);
  });

  it("isolates tenant/group namespace", () => {
    registerDiscussToTaskSourceBinding({
      sourceMessageId: "msg-ns",
      tenantId: "t1",
      groupId: "g1",
      actor: "human:owner",
    });
    const crossTenant = assertDiscussToTaskSourceBinding({
      sourceMessageId: "msg-ns",
      tenantId: "t2",
      groupId: "g1",
      actor: "human:owner",
    });
    expect(crossTenant.ok).toBe(false);
    const crossGroup = assertDiscussToTaskSourceBinding({
      sourceMessageId: "msg-ns",
      tenantId: "t1",
      groupId: "g2",
      actor: "human:owner",
    });
    expect(crossGroup.ok).toBe(false);
  });
});
