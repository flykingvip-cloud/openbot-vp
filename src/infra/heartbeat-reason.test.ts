import { describe, expect, it } from "vitest";
import {
  isHeartbeatActionWakeReason,
  isHeartbeatEventDrivenReason,
  normalizeHeartbeatWakeReason,
  resolveHeartbeatReasonKind,
  shouldAdmitHeartbeatTurn,
} from "./heartbeat-reason.js";

describe("heartbeat-reason", () => {
  it("normalizes wake reasons with trim + requested fallback", () => {
    expect(normalizeHeartbeatWakeReason("  cron:job-1  ")).toBe("cron:job-1");
    expect(normalizeHeartbeatWakeReason("  ")).toBe("requested");
    expect(normalizeHeartbeatWakeReason(undefined)).toBe("requested");
  });

  it("classifies known reason kinds", () => {
    expect(resolveHeartbeatReasonKind("retry")).toBe("retry");
    expect(resolveHeartbeatReasonKind("interval")).toBe("interval");
    expect(resolveHeartbeatReasonKind("manual")).toBe("manual");
    expect(resolveHeartbeatReasonKind("exec-event")).toBe("exec-event");
    expect(resolveHeartbeatReasonKind("exec:abc123:exit")).toBe("exec-event");
    expect(resolveHeartbeatReasonKind("wake")).toBe("wake");
    expect(resolveHeartbeatReasonKind("notifications-event")).toBe("wake");
    expect(resolveHeartbeatReasonKind("cli:watchdog:stall")).toBe("wake");
    expect(resolveHeartbeatReasonKind("acp:spawn:stream")).toBe("wake");
    expect(resolveHeartbeatReasonKind("cron:job-1")).toBe("cron");
    expect(resolveHeartbeatReasonKind("hook:wake")).toBe("hook");
    expect(resolveHeartbeatReasonKind("  hook:wake  ")).toBe("hook");
  });

  it("classifies unknown reasons as other", () => {
    expect(resolveHeartbeatReasonKind("requested")).toBe("other");
    expect(resolveHeartbeatReasonKind("slow")).toBe("other");
    expect(resolveHeartbeatReasonKind("")).toBe("other");
    expect(resolveHeartbeatReasonKind(undefined)).toBe("other");
  });

  it("matches event-driven behavior used by heartbeat preflight", () => {
    expect(isHeartbeatEventDrivenReason("exec-event")).toBe(true);
    expect(isHeartbeatEventDrivenReason("exec:abc123:exit")).toBe(true);
    expect(isHeartbeatEventDrivenReason("notifications-event")).toBe(true);
    expect(isHeartbeatEventDrivenReason("cli:watchdog:stall")).toBe(true);
    expect(isHeartbeatEventDrivenReason("cron:job-1")).toBe(true);
    expect(isHeartbeatEventDrivenReason("wake")).toBe(true);
    expect(isHeartbeatEventDrivenReason("acp:spawn:stream")).toBe(true);
    expect(isHeartbeatEventDrivenReason("hook:gmail:sync")).toBe(true);
    expect(isHeartbeatEventDrivenReason("interval")).toBe(false);
    expect(isHeartbeatEventDrivenReason("manual")).toBe(false);
    expect(isHeartbeatEventDrivenReason("other")).toBe(false);
  });

  it("admits only real triggers or pending events", () => {
    expect(shouldAdmitHeartbeatTurn({ reason: "interval", hasPendingEvents: false })).toBe(false);
    expect(shouldAdmitHeartbeatTurn({ reason: undefined, hasPendingEvents: false })).toBe(false);
    expect(shouldAdmitHeartbeatTurn({ reason: "interval", hasPendingEvents: true })).toBe(true);
    expect(shouldAdmitHeartbeatTurn({ reason: "manual", hasPendingEvents: false })).toBe(true);
    expect(shouldAdmitHeartbeatTurn({ reason: "exec-event", hasPendingEvents: false })).toBe(true);
    expect(shouldAdmitHeartbeatTurn({ reason: "exec:sid:exit", hasPendingEvents: false })).toBe(
      true,
    );
    expect(
      shouldAdmitHeartbeatTurn({ reason: "notifications-event", hasPendingEvents: false }),
    ).toBe(true);
    expect(shouldAdmitHeartbeatTurn({ reason: "cron:job-1", hasPendingEvents: false })).toBe(true);
  });

  it("matches action-priority wake behavior", () => {
    expect(isHeartbeatActionWakeReason("manual")).toBe(true);
    expect(isHeartbeatActionWakeReason("exec-event")).toBe(true);
    expect(isHeartbeatActionWakeReason("hook:wake")).toBe(true);
    expect(isHeartbeatActionWakeReason("interval")).toBe(false);
    expect(isHeartbeatActionWakeReason("cron:job-1")).toBe(false);
    expect(isHeartbeatActionWakeReason("retry")).toBe(false);
  });
});
