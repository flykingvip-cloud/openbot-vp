import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  events: [] as Array<{ status?: string; reason?: string; channel?: string }>,
}));

vi.mock("../../infra/heartbeat-events.js", () => ({
  emitHeartbeatEvent: (evt: { status?: string; reason?: string; channel?: string }) => {
    state.events.push(evt);
  },
}));

describe("runWebHeartbeatOnce", () => {
  it("retires leftover WhatsApp web heartbeat delivery", async () => {
    state.events = [];
    const { runWebHeartbeatOnce, resolveHeartbeatRecipients } =
      await import("./heartbeat-runner.js");
    await runWebHeartbeatOnce({
      cfg: { agents: { defaults: {} }, session: {} } as never,
      to: "+123",
    });
    expect(state.events).toEqual([
      expect.objectContaining({
        status: "skipped",
        reason: "legacy-outbound-retired",
        channel: "whatsapp",
      }),
    ]);
    expect(resolveHeartbeatRecipients({} as never)).toEqual([]);
  });
});
