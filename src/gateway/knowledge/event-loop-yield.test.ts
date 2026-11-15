import { describe, expect, it } from "vitest";
import { createBudgetedEventLoopYielder, yieldEventLoop } from "./event-loop-yield.js";

describe("event-loop yield", () => {
  it("parked yieldEventLoop lets other setImmediate callbacks complete", async () => {
    let interleaved = 0;
    setImmediate(() => {
      interleaved += 1;
    });
    expect(interleaved).toBe(0);
    await yieldEventLoop();
    expect(interleaved).toBe(1);
  });

  it("budgeted yielder parks when the budget is zero", async () => {
    let interleaved = 0;
    const yieldFn = createBudgetedEventLoopYielder(0);
    const ticking = (async () => {
      for (let i = 0; i < 8; i += 1) {
        setImmediate(() => {
          interleaved += 1;
        });
        await yieldFn();
      }
    })();
    await ticking;
    expect(interleaved).toBeGreaterThan(0);
  });
});
