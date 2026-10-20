import { describe, expect, it } from "vitest";
import { LIVE_SESSION_FOCUS_ID } from "../cron/isolated-agent/main-session-focus.js";
import {
  HEARTBEAT_FOCUS_SKIP_REASON,
  HEARTBEAT_IDENTITY_SKIP_REASON,
  decideHeartbeatMainSessionRun,
  resolveHeartbeatWakeKey,
} from "./heartbeat-focus.js";

describe("heartbeat main-session focus gate (P8 / EA-B5)", () => {
  it("treats interval / retry / manual as patrol with no wake key", () => {
    expect(resolveHeartbeatWakeKey("interval")).toBeUndefined();
    expect(resolveHeartbeatWakeKey("retry")).toBeUndefined();
    expect(resolveHeartbeatWakeKey("manual")).toBeUndefined();
    expect(resolveHeartbeatWakeKey(undefined)).toBeUndefined();
  });

  it("keeps event-driven reasons as wake keys, not ConversationTask ids", () => {
    expect(resolveHeartbeatWakeKey("cron:2b9de6b0")).toBe("cron:2b9de6b0");
    expect(resolveHeartbeatWakeKey("exec-event")).toBe("exec-event");
    expect(resolveHeartbeatWakeKey("wake")).toBe("wake");
    expect(resolveHeartbeatWakeKey("acp:spawn:stream")).toBe("acp:spawn:stream");
    expect(resolveHeartbeatWakeKey("hook:gmail:sync")).toBe("hook:gmail:sync");
  });

  it("skips idle patrol when FOCUS is occupied", () => {
    expect(
      decideHeartbeatMainSessionRun({
        snapshot: { focusTaskId: LIVE_SESSION_FOCUS_ID, parkedTaskIds: [] },
        reason: "interval",
      }),
    ).toEqual({
      run: false,
      kind: "skip_occupied",
      skipReason: HEARTBEAT_FOCUS_SKIP_REASON,
    });
  });

  it("runs idle patrol when FOCUS is free", () => {
    expect(
      decideHeartbeatMainSessionRun({
        snapshot: { parkedTaskIds: [] },
        reason: "interval",
      }),
    ).toEqual({ run: true, kind: "idle_patrol" });
  });

  it("parks event-driven heartbeat instead of punching occupied FOCUS", () => {
    const decision = decideHeartbeatMainSessionRun({
      snapshot: { focusTaskId: LIVE_SESSION_FOCUS_ID, parkedTaskIds: [] },
      reason: "cron:2b9de6b0",
    });
    expect(decision.run).toBe(false);
    if (decision.run) {
      throw new Error("expected occupied FOCUS to skip the heartbeat turn");
    }
    expect(decision.kind).toBe("park");
    expect(decision.skipReason).toBe(HEARTBEAT_FOCUS_SKIP_REASON);
  });

  it("runs event-driven heartbeat when FOCUS is free", () => {
    expect(
      decideHeartbeatMainSessionRun({
        snapshot: { parkedTaskIds: [] },
        reason: "exec-event",
      }),
    ).toEqual({
      run: true,
      kind: "event_wake",
      incomingTaskId: "exec-event",
    });
  });

  it("rejects heartbeat identity minting", () => {
    const decision = decideHeartbeatMainSessionRun({
      snapshot: { parkedTaskIds: [] },
      reason: "interval",
      incomingCreatesIdentity: true,
    });
    expect(decision).toEqual({
      run: false,
      kind: "reject_identity_create",
      skipReason: HEARTBEAT_IDENTITY_SKIP_REASON,
      decision: { action: "reject_identity_create", trigger: "heartbeat" },
    });
  });
});
