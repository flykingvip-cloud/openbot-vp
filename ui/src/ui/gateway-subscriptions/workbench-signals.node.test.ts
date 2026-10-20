/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKBENCH_SIGNALS_INVALIDATE_EVENT } from "../../../../src/gateway/workbench/signals-invalidate.ts";

const refreshWorkbenchSignalsMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../controllers/spaces.ts", () => ({
  refreshWorkbenchSignals: refreshWorkbenchSignalsMock,
}));

vi.mock("../capability/view-state.ts", () => ({
  adaptSpacesLoadCapabilityState: (host: unknown) => host,
}));

const { handleWorkbenchSignalsGatewayEvent, resetWorkbenchSignalsInvalidateDebounceForTests } =
  await import("./workbench-signals.ts");

describe("handleWorkbenchSignalsGatewayEvent", () => {
  afterEach(() => {
    resetWorkbenchSignalsInvalidateDebounceForTests();
    refreshWorkbenchSignalsMock.mockClear();
    vi.useRealTimers();
  });

  it("ignores unrelated events", () => {
    const host = { connected: true, client: {} } as never;
    expect(
      handleWorkbenchSignalsGatewayEvent(host, {
        type: "event",
        event: "presence",
        payload: {},
      }),
    ).toBe(false);
    expect(refreshWorkbenchSignalsMock).not.toHaveBeenCalled();
  });

  it("debounces refreshWorkbenchSignals on invalidate", async () => {
    vi.useFakeTimers();
    const host = { connected: true, client: {} } as never;
    expect(
      handleWorkbenchSignalsGatewayEvent(host, {
        type: "event",
        event: WORKBENCH_SIGNALS_INVALIDATE_EVENT,
        payload: { reason: "meeting", atMs: 1 },
      }),
    ).toBe(true);
    expect(
      handleWorkbenchSignalsGatewayEvent(host, {
        type: "event",
        event: WORKBENCH_SIGNALS_INVALIDATE_EVENT,
        payload: { reason: "schedule", atMs: 2 },
      }),
    ).toBe(true);
    expect(refreshWorkbenchSignalsMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(refreshWorkbenchSignalsMock).toHaveBeenCalledTimes(1);
  });
});
