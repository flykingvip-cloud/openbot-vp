// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORKBENCH_SIGNALS_INVALIDATE_EVENT,
  broadcastWorkbenchSignalsInvalidate,
  setWorkbenchSignalsInvalidateBroadcast,
} from "./signals-invalidate.js";

describe("broadcastWorkbenchSignalsInvalidate", () => {
  afterEach(() => {
    setWorkbenchSignalsInvalidateBroadcast(null);
  });

  it("no-ops when broadcast is not registered", () => {
    expect(() =>
      broadcastWorkbenchSignalsInvalidate({ reason: "schedule", userIds: ["u1"] }),
    ).not.toThrow();
  });

  it("broadcasts a dropIfSlow invalidate event with deduped userIds", () => {
    const broadcast = vi.fn();
    setWorkbenchSignalsInvalidateBroadcast(broadcast);
    broadcastWorkbenchSignalsInvalidate({
      reason: "meeting",
      userIds: [" u1 ", "u2", "u1", ""],
      atMs: 1_700_000_000_000,
    });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(
      WORKBENCH_SIGNALS_INVALIDATE_EVENT,
      {
        reason: "meeting",
        userIds: ["u1", "u2"],
        atMs: 1_700_000_000_000,
      },
      { dropIfSlow: true },
    );
  });
});
