import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emitSupervisorTaskEvent,
  getSupervisorTaskEventRecipients,
  registerSupervisorTaskEventRecipient,
  setSupervisorTaskEventSink,
} from "./events.js";

describe("supervisor events", () => {
  afterEach(() => {
    setSupervisorTaskEventSink(null);
  });

  it("registers recipients per taskId and prunes on read", () => {
    registerSupervisorTaskEventRecipient("task-1", "conn-a");
    registerSupervisorTaskEventRecipient("task-1", "conn-b");
    const recipients = getSupervisorTaskEventRecipients("task-1");
    expect(recipients?.has("conn-a")).toBe(true);
    expect(recipients?.has("conn-b")).toBe(true);
    expect(getSupervisorTaskEventRecipients("task-2")).toBeUndefined();
  });

  it("forwards payloads to the configured sink", () => {
    const sink = vi.fn();
    setSupervisorTaskEventSink(sink);
    emitSupervisorTaskEvent({
      taskId: "t1",
      type: "progress",
      at: "2026-01-01T00:00:00.000Z",
      progress: { kind: "stdout", data: "hi" },
    });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]?.[0]?.type).toBe("progress");
  });
});
