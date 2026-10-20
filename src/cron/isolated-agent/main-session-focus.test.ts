import { describe, expect, it } from "vitest";
import {
  LIVE_SESSION_FOCUS_ID,
  decideCronMainSessionSurface,
  focusSnapshotFromLastUserActivity,
  readLastUserMessageAtMsFromTranscript,
  shouldInjectCronResultIntoMainSession,
  shouldNotifyCronWakeOnMainSession,
} from "./main-session-focus.js";

describe("cron main-session focus gate (P1 acceptance)", () => {
  const now = 1_780_000_000_000;

  it("treats a recent user turn as occupying FOCUS", () => {
    expect(
      focusSnapshotFromLastUserActivity({
        lastUserAtMs: now - 10 * 60 * 1000,
        nowMs: now,
      }),
    ).toEqual({ focusTaskId: LIVE_SESSION_FOCUS_ID, parkedTaskIds: [] });
  });

  it("treats a stale user turn as idle FOCUS", () => {
    expect(
      focusSnapshotFromLastUserActivity({
        lastUserAtMs: now - 5 * 60 * 60 * 1000,
        nowMs: now,
      }),
    ).toEqual({ parkedTaskIds: [] });
  });

  it("EA-B4: parks cron inject when the main session is occupied", () => {
    const decision = decideCronMainSessionSurface({
      jobId: "2b9de6b0",
      snapshot: { focusTaskId: LIVE_SESSION_FOCUS_ID, parkedTaskIds: [] },
    });
    expect(decision.action).toBe("park");
    expect(shouldInjectCronResultIntoMainSession(decision)).toBe(false);
    expect(shouldNotifyCronWakeOnMainSession(decision)).toBe(true);
  });

  it("reads the last user timestamp from a transcript tail", () => {
    const text = [
      JSON.stringify({
        type: "message",
        timestamp: "2026-09-17T03:00:00.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "cron" }] },
      }),
      JSON.stringify({
        type: "message",
        timestamp: "2026-09-17T03:13:31.977Z",
        message: { role: "user", content: [{ type: "text", text: "调研" }] },
      }),
    ].join("\n");
    expect(readLastUserMessageAtMsFromTranscript(text)).toBe(
      Date.parse("2026-09-17T03:13:31.977Z"),
    );
  });

  it("injects only when FOCUS is free", () => {
    const decision = decideCronMainSessionSurface({
      jobId: "2b9de6b0",
      snapshot: { parkedTaskIds: [] },
    });
    expect(decision).toEqual({ action: "acquire_focus", taskId: "cron:2b9de6b0" });
    expect(shouldInjectCronResultIntoMainSession(decision)).toBe(true);
  });

  it("uses conversationTaskId as the wake slot when bound (EA-B4)", () => {
    const decision = decideCronMainSessionSurface({
      jobId: "2b9de6b0",
      conversationTaskId: "ct-market-1",
      snapshot: { parkedTaskIds: [] },
    });
    expect(decision).toEqual({ action: "acquire_focus", taskId: "ct-market-1" });
  });
});
