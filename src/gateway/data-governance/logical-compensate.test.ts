import { describe, expect, it } from "vitest";
import { compensateMemoryJournalWrite } from "./logical-compensate.js";

describe("compensateMemoryJournalWrite fail-closed", () => {
  it("returns ok:false when revoke hook is missing (post-write journal lookup gap)", async () => {
    const result = await compensateMemoryJournalWrite({
      operationId: "op-miss",
      resourceId: "memory:t1:source:s1",
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("missing_revoke_hook");
  });

  it("returns ok:true only after revoke succeeds", async () => {
    let called = false;
    const result = await compensateMemoryJournalWrite({
      operationId: "op-ok",
      resourceId: "memory:t1:source:s1",
      atomIds: ["a1"],
      revoke: async () => {
        called = true;
      },
    });
    expect(called).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("logical");
  });
});
