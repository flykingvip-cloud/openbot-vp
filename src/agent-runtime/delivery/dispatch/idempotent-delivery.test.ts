import { describe, expect, it, vi } from "vitest";
import { deliverWithIdempotentReceipt } from "../index.js";

describe("deliverWithIdempotentReceipt", () => {
  it("runs send directly when no receipt exists and rethrows on failure", () => {
    const noteOutcome = vi.fn();
    const okResult = deliverWithIdempotentReceipt({
      hasReceipt: false,
      send: () => {},
      noteOutcome,
    });
    expect(okResult).toEqual({ ok: true, idempotent: false });
    expect(noteOutcome).not.toHaveBeenCalled();

    expect(() =>
      deliverWithIdempotentReceipt({
        hasReceipt: false,
        send: () => {
          throw new Error("boom");
        },
        noteOutcome,
      }),
    ).toThrow("boom");
    expect(noteOutcome).not.toHaveBeenCalled();
  });

  it("records ok=true when receipt exists and send succeeds", () => {
    const noteOutcome = vi.fn();
    const result = deliverWithIdempotentReceipt({
      hasReceipt: true,
      send: () => {},
      noteOutcome,
    });
    expect(result).toEqual({ ok: true, idempotent: true });
    expect(noteOutcome).toHaveBeenCalledWith(true);
  });

  it("records ok=false and returns non-throwing result when receipt exists and send fails", () => {
    const noteOutcome = vi.fn();
    const result = deliverWithIdempotentReceipt({
      hasReceipt: true,
      send: () => {
        throw new Error("socket closed");
      },
      noteOutcome,
    });
    expect(result).toEqual({ ok: false, idempotent: true });
    expect(noteOutcome).toHaveBeenCalledWith(false);
  });
});
