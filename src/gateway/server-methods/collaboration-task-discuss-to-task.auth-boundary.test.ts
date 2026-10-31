/**
 * Auth-boundary checks for discussToTask RPC wiring.
 * These assert handler registration + required authenticated fields.
 * Direct handler invocation with mocks is NOT full gateway E2E.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  clearDiscussToTaskSourceBindingsForTests,
  registerDiscussToTaskSourceBinding,
} from "../collaboration-learning/discuss-to-task-source-binding.js";
import { collaborationTaskActivationHandlers } from "./collaboration-task-activation.js";
import { collaborationTaskActivationPack } from "./collaboration-task-activation.pack.js";

afterEach(() => {
  clearDiscussToTaskSourceBindingsForTests();
});

describe("collaboration.task.discussToTask auth boundary (handler surface)", () => {
  it("registers discussToTask on pack and handlers", () => {
    expect(collaborationTaskActivationPack.methods).toContain("collaboration.task.discussToTask");
    expect(typeof collaborationTaskActivationHandlers["collaboration.task.discussToTask"]).toBe(
      "function",
    );
    expect(collaborationTaskActivationPack.scopes["operator.write"]).toContain(
      "collaboration.task.discussToTask",
    );
  });

  it("rejects missing sourceMessageId without writing (invalid request)", async () => {
    let ok: boolean | undefined;
    let err: { message?: string } | undefined;
    await collaborationTaskActivationHandlers["collaboration.task.discussToTask"]({
      params: { groupId: "g", message: "x" },
      respond: (success: boolean, _payload: unknown, error?: { message?: string }) => {
        ok = success;
        err = error;
      },
      client: {},
    } as never);
    expect(ok).toBe(false);
    expect(String(err?.message ?? "")).toMatch(/sourceMessageId/);
  });

  it("rejects client humanConfirmed=true (model/self-confirm forbidden)", async () => {
    let ok: boolean | undefined;
    let err: { message?: string } | undefined;
    await collaborationTaskActivationHandlers["collaboration.task.discussToTask"]({
      params: {
        groupId: "g",
        message: "请正式开展市场调研，验收：报告与清单",
        sourceMessageId: "msg-confirm",
        humanConfirmed: true,
      },
      respond: (success: boolean, _payload: unknown, error?: { message?: string }) => {
        ok = success;
        err = error;
      },
      client: {},
    } as never);
    expect(ok).toBe(false);
    expect(String(err?.message ?? "")).toMatch(/humanConfirmed/);
  });

  it("rejects requireHumanConfirm=false bypass", async () => {
    let ok: boolean | undefined;
    let err: { message?: string } | undefined;
    await collaborationTaskActivationHandlers["collaboration.task.discussToTask"]({
      params: {
        groupId: "g",
        message: "请正式开展市场调研，验收：报告与清单",
        sourceMessageId: "msg-bypass",
        requireHumanConfirm: false,
      },
      respond: (success: boolean, _payload: unknown, error?: { message?: string }) => {
        ok = success;
        err = error;
      },
      client: {},
    } as never);
    expect(ok).toBe(false);
    expect(String(err?.message ?? "")).toMatch(/requireHumanConfirm/);
  });

  it("rejects cross-user reuse of a bound sourceMessageId", async () => {
    registerDiscussToTaskSourceBinding({
      sourceMessageId: "msg-bound-owner",
      tenantId: "tenant-x",
      groupId: "g",
      actor: "human:owner",
    });
    // Handler resolves actor from client; without auth it fails earlier.
    // Assert the binding helper itself rejects foreign actor (wired into handler).
    const { assertDiscussToTaskSourceBinding } =
      await import("../collaboration-learning/discuss-to-task-source-binding.js");
    const stolen = assertDiscussToTaskSourceBinding({
      sourceMessageId: "msg-bound-owner",
      tenantId: "tenant-x",
      groupId: "g",
      actor: "human:attacker",
    });
    expect(stolen.ok).toBe(false);
    if (!stolen.ok) {
      expect(stolen.reason).toBe("source_message_actor_mismatch");
    }
  });
});
