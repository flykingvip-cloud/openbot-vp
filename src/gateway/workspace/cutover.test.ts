import { describe, expect, it } from "vitest";
import {
  advanceCutover,
  assertSingleWritableCanonical,
  canTransition,
  createMemoryCutoverStore,
  resolveCutoverRollback,
  type WorkspaceCutoverOperation,
  type WorkspaceCutoverState,
} from "./cutover.js";

function op(partial: Partial<WorkspaceCutoverOperation> = {}): WorkspaceCutoverOperation {
  return {
    operationId: "op-1",
    resourceId: "res-1",
    sourceBindingId: "src",
    targetBindingId: "tgt",
    expectedContentVersion: "v1",
    state: "inventoried",
    retryCount: 0,
    lastError: null,
    compatibilityExpiresAt: null,
    cutoverCommitted: false,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    ...partial,
  };
}

describe("workspace cutover state machine", () => {
  it("advances through the durable one-writer path", async () => {
    const store = createMemoryCutoverStore();
    await store.save(op());
    const states = [
      "prepared",
      "write_frozen",
      "copied_or_adopted",
      "verified",
      "dual_read_verified",
      "resolver_write_cutover",
      "compatibility_read_only",
      "retired",
    ] as const;
    let current: WorkspaceCutoverState = "inventoried";
    for (const next of states) {
      expect(canTransition(current, next)).toBe(true);
      const advanced = await advanceCutover({
        store,
        operationId: "op-1",
        nextState: next,
        nowIso: "2026-08-10T01:00:00.000Z",
      });
      current = advanced.state;
    }
    const finalOp = await store.load("op-1");
    expect(finalOp?.state).toBe("retired");
    expect(finalOp?.cutoverCommitted).toBe(true);
  });

  it("resumes idempotently after crash by reloading persisted state", async () => {
    const store = createMemoryCutoverStore();
    await store.save(op({ state: "write_frozen" }));
    const again = await store.load("op-1");
    expect(again?.state).toBe("write_frozen");
    await advanceCutover({
      store,
      operationId: "op-1",
      nextState: "copied_or_adopted",
      nowIso: "2026-08-10T01:00:00.000Z",
    });
    expect((await store.load("op-1"))?.state).toBe("copied_or_adopted");
  });

  it("forbids restoring old writer after cutover", () => {
    expect(resolveCutoverRollback(op({ state: "dual_read_verified" })).allowOldWriter).toBe(true);
    expect(
      resolveCutoverRollback(op({ state: "resolver_write_cutover", cutoverCommitted: true }))
        .allowOldWriter,
    ).toBe(false);
    expect(
      resolveCutoverRollback(op({ state: "compatibility_read_only", cutoverCommitted: true })).mode,
    ).toBe("roll_forward_or_restore_target");
  });

  it("rejects two active writable canonical bindings", () => {
    expect(() =>
      assertSingleWritableCanonical([
        { role: "canonical", state: "active" },
        { role: "canonical", state: "active" },
      ]),
    ).toThrow(/expected_one_writable_canonical/);
    expect(() =>
      assertSingleWritableCanonical([
        { role: "canonical", state: "active" },
        { role: "compatibility", state: "read_only" },
      ]),
    ).not.toThrow();
  });

  it("rejects invalid transitions", async () => {
    const store = createMemoryCutoverStore();
    await store.save(op({ state: "inventoried" }));
    await expect(
      advanceCutover({
        store,
        operationId: "op-1",
        nextState: "retired",
        nowIso: "2026-08-10T01:00:00.000Z",
      }),
    ).rejects.toThrow(/invalid_cutover_transition/);
  });
});
