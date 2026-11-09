import { describe, expect, it } from "vitest";
import { resolveExecutionQueueAction } from "./execution-queue.js";

describe("resolveExecutionQueueAction", () => {
  it("runs immediately when there is no active run", () => {
    expect(
      resolveExecutionQueueAction({
        isActive: false,
        isHeartbeat: false,
        shouldFollowup: true,
        queueMode: "collect",
      }),
    ).toBe("run-now");
  });

  it("drops heartbeat runs while another run is active", () => {
    expect(
      resolveExecutionQueueAction({
        isActive: true,
        isHeartbeat: true,
        shouldFollowup: true,
        queueMode: "collect",
      }),
    ).toBe("drop");
  });

  it("enqueues followups for non-heartbeat active runs", () => {
    expect(
      resolveExecutionQueueAction({
        isActive: true,
        isHeartbeat: false,
        shouldFollowup: true,
        queueMode: "collect",
      }),
    ).toBe("enqueue-followup");
  });

  it("enqueues steer mode runs while active", () => {
    expect(
      resolveExecutionQueueAction({
        isActive: true,
        isHeartbeat: false,
        shouldFollowup: false,
        queueMode: "steer",
      }),
    ).toBe("enqueue-followup");
  });
});
