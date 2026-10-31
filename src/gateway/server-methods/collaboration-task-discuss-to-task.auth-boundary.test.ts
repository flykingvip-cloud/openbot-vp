/**
 * Auth-boundary checks for discussToTask RPC wiring.
 * These assert handler registration + required authenticated fields.
 * Direct handler invocation with mocks is NOT full gateway E2E.
 */
import { describe, expect, it } from "vitest";
import { collaborationTaskActivationHandlers } from "./collaboration-task-activation.js";
import { collaborationTaskActivationPack } from "./collaboration-task-activation.pack.js";

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
});
