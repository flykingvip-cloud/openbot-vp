import { describe, expect, it } from "vitest";
import {
  connectingStageOf,
  createDesktopSessionSnapshot,
  reduceDesktopSession,
  streamUrlMeansAttachedOnly,
  type DesktopSessionSnapshot,
} from "./desktop-session-state.ts";

function apply(
  events: Parameters<typeof reduceDesktopSession>[1][],
  start?: DesktopSessionSnapshot,
  now = 1_000,
): DesktopSessionSnapshot {
  let snap = start ?? createDesktopSessionSnapshot(now);
  for (const event of events) {
    snap = reduceDesktopSession(snap, event, now);
    now += 10;
  }
  return snap;
}

describe("desktop-session-state", () => {
  it("walks IDLE → OPENING → CONNECTING → STREAM_ATTACHED → FIRST_FRAME → INTERACTIVE", () => {
    const snap = apply([
      { type: "OPEN" },
      { type: "PREVIEW_REQUESTED" },
      { type: "STREAM_ENDPOINT" },
      { type: "FIRST_FRAME" },
      { type: "INTERACTIVE_READY" },
    ]);
    expect(snap.phase).toBe("INTERACTIVE");
    expect(snap.openedAt).toBeTruthy();
    expect(snap.streamAttachedAt).toBeTruthy();
    expect(snap.firstFrameAt).toBeTruthy();
    expect(snap.interactiveAt).toBeTruthy();
    expect(snap.firstFrameAt!).toBeGreaterThan(snap.streamAttachedAt!);
  });

  it("iron rule: STREAM_ENDPOINT never becomes FIRST_FRAME or INTERACTIVE", () => {
    expect(streamUrlMeansAttachedOnly()).toBe(true);
    const snap = apply([
      { type: "OPEN" },
      { type: "PREVIEW_REQUESTED" },
      { type: "STREAM_ENDPOINT" },
      { type: "STREAM_ENDPOINT" },
      { type: "INTERACTIVE_READY" }, // blocked without first frame
    ]);
    expect(snap.phase).toBe("STREAM_ATTACHED");
    expect(snap.firstFrameAt).toBeNull();
    expect(snap.interactiveAt).toBeNull();
    expect(connectingStageOf(snap)).toBe("waiting_picture");
  });

  it("stall path: SUSPECTED → CONFIRMED → RECONNECTING → RECOVERED", () => {
    let snap = apply([
      { type: "OPEN" },
      { type: "PREVIEW_REQUESTED" },
      { type: "STREAM_ENDPOINT" },
      { type: "FIRST_FRAME" },
      { type: "INTERACTIVE_READY" },
    ]);
    expect(snap.phase).toBe("INTERACTIVE");

    snap = reduceDesktopSession(snap, { type: "STALL_SUSPECTED" }, 2_000);
    expect(snap.phase).toBe("STREAM_STALLED");
    expect(snap.stall).toBe("SUSPECTED");

    snap = reduceDesktopSession(snap, { type: "STALL_CONFIRMED" }, 2_100);
    expect(snap.stall).toBe("CONFIRMED");

    snap = reduceDesktopSession(snap, { type: "RECONNECT", reason: "stream" }, 2_200);
    expect(snap.phase).toBe("RECONNECTING");
    expect(snap.stall).toBe("RECONNECTING");
    expect(snap.reconnectReason).toBe("stream");

    snap = reduceDesktopSession(snap, { type: "RECOVERED" }, 2_300);
    expect(snap.phase).toBe("INTERACTIVE");
    expect(snap.stall).toBe("RECOVERED");
    expect(snap.reconnectReason).toBeNull();
  });

  it("supports reconnect reasons network | stream | credential", () => {
    for (const reason of ["network", "stream", "credential"] as const) {
      const snap = apply([
        { type: "OPEN" },
        { type: "PREVIEW_REQUESTED" },
        { type: "STREAM_ENDPOINT" },
        { type: "FIRST_FRAME" },
        { type: "STALL_SUSPECTED" },
        { type: "STALL_CONFIRMED" },
        { type: "RECONNECT", reason },
      ]);
      expect(snap.phase).toBe("RECONNECTING");
      expect(snap.reconnectReason).toBe(reason);
    }
  });

  it("maps anomaly phases to connecting stages", () => {
    expect(connectingStageOf({ ...createDesktopSessionSnapshot(), phase: "AUTH_EXPIRED" })).toBe(
      "auth",
    );
    expect(connectingStageOf({ ...createDesktopSessionSnapshot(), phase: "SESSION_LOST" })).toBe(
      "lost",
    );
    expect(
      connectingStageOf({ ...createDesktopSessionSnapshot(), phase: "NETWORK_DEGRADED" }),
    ).toBe("degraded");
    expect(connectingStageOf({ ...createDesktopSessionSnapshot(), phase: "ENDED" })).toBe("ended");
    expect(connectingStageOf({ ...createDesktopSessionSnapshot(), phase: "YIELDED" })).toBe(
      "yielded",
    );
  });

  it("END and YIELD are terminal until OPEN", () => {
    let snap = apply([
      { type: "OPEN" },
      { type: "PREVIEW_REQUESTED" },
      { type: "STREAM_ENDPOINT" },
      { type: "FIRST_FRAME" },
      { type: "YIELD" },
    ]);
    expect(snap.phase).toBe("YIELDED");
    snap = reduceDesktopSession(snap, { type: "FIRST_FRAME" }, 9_000);
    expect(snap.phase).toBe("YIELDED");
    snap = reduceDesktopSession(snap, { type: "OPEN" }, 9_100);
    expect(snap.phase).toBe("OPENING");
  });
});
