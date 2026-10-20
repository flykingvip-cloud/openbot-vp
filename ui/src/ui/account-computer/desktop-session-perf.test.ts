import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DESKTOP_SESSION_PERF_LANDING,
  canObserveFirstFrameFromPhase,
  shouldEmitStreamAttachedRum,
  shouldForcePreviewTokenRotate,
  shouldSkipHealthyInteractivePreviewOpen,
  summarizeDesktopSessionRum,
} from "./desktop-session-perf.ts";
import {
  createDesktopSessionPreviewBind,
  resetPreviewBindsForTests,
} from "./desktop-session-preview-bind.ts";
import {
  createDesktopRumBuffer,
  formatDesktopRumSummary,
  hashUserId,
  percentileSorted,
  rollupDesktopRumTimings,
  rumEventIsSafe,
} from "./desktop-session-rum.ts";
import { assertNoLocationReload, createDesktopSessionRuntime } from "./desktop-session-runtime.ts";
import {
  createDesktopSessionSnapshot,
  reduceDesktopSession,
  streamUrlMeansAttachedOnly,
} from "./desktop-session-state.ts";

afterEach(() => {
  resetPreviewBindsForTests();
  vi.useRealTimers();
});

describe("DESKTOP_SESSION_PERF_M3", () => {
  it("registers landing stream id", () => {
    expect(DESKTOP_SESSION_PERF_LANDING).toBe("DESKTOP_SESSION_PERF_M3");
  });

  it("computes P50/P95 TTFP/TTI/TTS rollup without tokens or URLs", () => {
    const buf = createDesktopRumBuffer();
    const base = {
      userIdHash: hashUserId("alice@example.com"),
      desktopId: "desk-1",
      agentId: "agent-1",
      connectionAttempt: 1,
    };
    // Three sessions with distinct timings
    const samples = [
      { sid: "s1", ttfp: 800, tti: 1100, tts: 1400 },
      { sid: "s2", ttfp: 1200, tti: 1600, tts: 2000 },
      { sid: "s3", ttfp: 4000, tti: 4500, tts: 5200 },
    ];
    for (const s of samples) {
      buf.emit("desktop_open", { ...base, sessionId: s.sid });
      buf.emit("first_frame", {
        ...base,
        sessionId: s.sid,
        ttfpMs: s.ttfp,
        ttiMs: s.tti,
        ttsMs: s.tts,
      });
      buf.emit("interactive", {
        ...base,
        sessionId: s.sid,
        ttfpMs: s.ttfp,
        ttiMs: s.tti,
        ttsMs: s.tts,
      });
    }
    buf.emit("reconnect_success", { ...base, sessionId: "s1", reconnectReason: "stream" });
    buf.emit("reconnect_failed", { ...base, sessionId: "s2", reconnectReason: "network" });

    const rollup = rollupDesktopRumTimings(buf.events);
    expect(rollup.sessionOpenCount).toBe(3);
    expect(rollup.ttfpMs.count).toBe(3);
    expect(rollup.ttfpMs.p50).toBe(1200);
    expect(rollup.ttfpMs.p95).toBeCloseTo(3720, 0); // interpolated P95 on n=3
    expect(rollup.ttiMs.p50).toBe(1600);
    expect(rollup.ttsMs.p50).toBe(2000);
    expect(rollup.firstFrameWithin5sRate).toBe(1);
    expect(rollup.reconnectSuccessRate).toBe(0.5);
    expect(rollup.stableStreamSuccessRate).toBe(1);

    const summary = formatDesktopRumSummary(rollup);
    expect(summary).toContain("TTFP");
    expect(summary).toContain("p50=");
    expect(summary).not.toMatch(/https?:\/\//i);
    expect(summary).not.toMatch(/token=/i);
    expect(summary).not.toContain("@");

    for (const event of buf.events) {
      expect(rumEventIsSafe(event)).toBe(true);
    }

    const viaHelper = summarizeDesktopSessionRum(buf);
    expect(viaHelper.summary).toBe(summary);
  });

  it("percentileSorted handles edges", () => {
    expect(percentileSorted([], 50)).toBeNull();
    expect(percentileSorted([10], 50)).toBe(10);
    expect(percentileSorted([10, 20, 30, 40], 50)).toBe(25);
  });

  it("skips preview open churn only while INTERACTIVE", () => {
    expect(shouldSkipHealthyInteractivePreviewOpen("INTERACTIVE")).toBe(true);
    expect(shouldSkipHealthyInteractivePreviewOpen("FIRST_FRAME")).toBe(false);
    expect(shouldSkipHealthyInteractivePreviewOpen("STREAM_ATTACHED")).toBe(false);
    expect(shouldSkipHealthyInteractivePreviewOpen("RECONNECTING")).toBe(false);
    expect(shouldSkipHealthyInteractivePreviewOpen(null)).toBe(false);

    expect(shouldForcePreviewTokenRotate("AUTH_EXPIRED")).toBe(true);
    expect(shouldForcePreviewTokenRotate("RECONNECTING")).toBe(true);
    expect(shouldForcePreviewTokenRotate("STREAM_STALLED")).toBe(true);
    expect(shouldForcePreviewTokenRotate("NETWORK_DEGRADED")).toBe(true);
    expect(shouldForcePreviewTokenRotate("CONNECT_FAILED")).toBe(true);
    expect(shouldForcePreviewTokenRotate("SESSION_LOST")).toBe(true);
    expect(shouldForcePreviewTokenRotate("INTERACTIVE")).toBe(false);
    expect(shouldForcePreviewTokenRotate("STREAM_ATTACHED")).toBe(false);
    expect(shouldForcePreviewTokenRotate(null)).toBe(false);
  });

  it("dedupes stream_attached rum when already live", () => {
    expect(shouldEmitStreamAttachedRum("CONNECTING")).toBe(true);
    expect(shouldEmitStreamAttachedRum("RECONNECTING")).toBe(true);
    expect(shouldEmitStreamAttachedRum("STREAM_ATTACHED")).toBe(false);
    expect(shouldEmitStreamAttachedRum("FIRST_FRAME")).toBe(false);
    expect(shouldEmitStreamAttachedRum("INTERACTIVE")).toBe(false);
  });

  it("runtime noteStreamEndpoint does not double-emit when already INTERACTIVE", () => {
    const runtime = createDesktopSessionRuntime({ sessionId: "dedupe-1" });
    runtime.noteOpen();
    runtime.notePreviewRequested();
    runtime.noteStreamEndpoint();
    runtime.noteFirstFrame();
    runtime.noteInteractiveReady();
    const before = runtime.rum.events.filter((e) => e.name === "stream_attached").length;
    expect(before).toBe(1);
    runtime.noteStreamEndpoint();
    runtime.noteStreamEndpoint();
    const after = runtime.rum.events.filter((e) => e.name === "stream_attached").length;
    expect(after).toBe(1);
    expect(runtime.snapshot.phase).toBe("INTERACTIVE");
    expect(runtime.rumSummary()).toContain("TTFP");
    runtime.dispose();
  });

  it("first_frame may race ahead of stream_connected from CONNECTING (cheap TTFP path)", () => {
    expect(canObserveFirstFrameFromPhase("CONNECTING")).toBe(true);
    let snap = createDesktopSessionSnapshot(1000);
    snap = reduceDesktopSession(snap, { type: "OPEN" }, 1000);
    snap = reduceDesktopSession(snap, { type: "PREVIEW_REQUESTED" }, 1100);
    expect(snap.phase).toBe("CONNECTING");
    snap = reduceDesktopSession(snap, { type: "FIRST_FRAME" }, 1300);
    expect(snap.phase).toBe("FIRST_FRAME");
    expect(snap.firstFrameAt).toBe(1300);
    expect(snap.streamAttachedAt).toBe(1300);
    // Iron rule: STREAM_ENDPOINT alone still never becomes FIRST_FRAME.
    let other = createDesktopSessionSnapshot(1000);
    other = reduceDesktopSession(other, { type: "OPEN" }, 1000);
    other = reduceDesktopSession(other, { type: "PREVIEW_REQUESTED" }, 1100);
    other = reduceDesktopSession(other, { type: "STREAM_ENDPOINT" }, 1200);
    expect(other.phase).toBe("STREAM_ATTACHED");
    expect(streamUrlMeansAttachedOnly()).toBe(true);
    other = reduceDesktopSession(other, { type: "INTERACTIVE_READY" }, 1250);
    expect(other.phase).toBe("STREAM_ATTACHED");
  });

  it("stall recovery stays session-level (no location.reload)", () => {
    vi.useFakeTimers();
    const onReconnect = vi.fn();
    const runtime = createDesktopSessionRuntime({
      sessionId: "m3-stall",
      stallSuspectMs: 50,
      stallConfirmMs: 50,
      onReconnect,
    });
    runtime.noteOpen();
    runtime.notePreviewRequested();
    runtime.noteStreamEndpoint();
    runtime.noteFirstFrame();
    runtime.noteInteractiveReady();
    const g = globalThis as { location?: { reload?: () => void } };
    const previous = g.location;
    const reload = vi.fn();
    g.location = { reload };
    assertNoLocationReload(() => {
      vi.advanceTimersByTime(120);
    });
    expect(onReconnect).toHaveBeenCalledWith("stream", 1);
    expect(reload).not.toHaveBeenCalled();
    expect(runtime.snapshot.phase).toBe("RECONNECTING");
    g.location = previous;
    runtime.dispose();
  });

  it("preview bind reconnect path still forbids location.reload", () => {
    const g = globalThis as { location?: { reload?: () => void } };
    const previous = g.location;
    const reload = vi.fn();
    g.location = { reload };
    const refreshCredential = vi.fn();
    const bind = createDesktopSessionPreviewBind({
      sessionId: "m3-noreload",
      refreshCredential,
    });
    bind.onPreviewOpen();
    bind.onStreamUrl("https://example.test/novnc?token=x");
    assertNoLocationReload(() => {
      bind.reconnect("stream");
    });
    expect(reload).not.toHaveBeenCalled();
    bind.dispose();
    g.location = previous;
  });
});
