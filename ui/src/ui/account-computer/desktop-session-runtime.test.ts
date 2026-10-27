import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDesktopSessionPreviewBind,
  resetPreviewBindsForTests,
} from "./desktop-session-preview-bind.ts";
import { assertNoLocationReload, createDesktopSessionRuntime } from "./desktop-session-runtime.ts";

afterEach(() => {
  resetPreviewBindsForTests();
  vi.useRealTimers();
});

describe("desktop-session-runtime recovery", () => {
  it("auto-starts session reconnect after stall confirmed (no reload)", () => {
    vi.useFakeTimers();
    const onReconnect = vi.fn();
    const runtime = createDesktopSessionRuntime({
      sessionId: "s1",
      stallSuspectMs: 100,
      stallConfirmMs: 100,
      onReconnect,
    });
    runtime.noteOpen();
    runtime.notePreviewRequested();
    runtime.noteStreamEndpoint();
    runtime.noteFirstFrame();
    runtime.noteInteractiveReady();
    expect(runtime.snapshot.phase).toBe("INTERACTIVE");

    vi.advanceTimersByTime(100); // SUSPECTED
    expect(runtime.snapshot.stall).toBe("SUSPECTED");
    vi.advanceTimersByTime(100); // CONFIRMED → auto reconnect
    expect(runtime.snapshot.phase).toBe("RECONNECTING");
    expect(runtime.snapshot.stall).toBe("RECONNECTING");
    expect(onReconnect).toHaveBeenCalledWith("stream", 1);
    const names = runtime.rum.events.map((e) => e.name);
    expect(names).toContain("stall_confirmed");
    expect(names).toContain("reconnect_start");
    runtime.dispose();
  });

  it("auth-expired reconnect uses credential and invokes refreshCredential", () => {
    const refreshCredential = vi.fn();
    const bind = createDesktopSessionPreviewBind({
      sessionId: "s-auth",
      refreshCredential,
    });
    bind.onPreviewOpen();
    bind.onStreamUrl("https://gateway.example/sandbox/novnc?token=secret");
    bind.runtime.noteFirstFrame();
    bind.runtime.noteInteractiveReady();
    bind.noteAuthExpired();
    expect(bind.runtime.snapshot.phase).toBe("AUTH_EXPIRED");
    expect(bind.connectingCopy().stage).toBe("auth");
    expect(bind.preferredReconnectReason()).toBe("credential");
    bind.reconnect("credential");
    expect(bind.runtime.snapshot.phase).toBe("RECONNECTING");
    expect(bind.runtime.snapshot.reconnectReason).toBe("credential");
    expect(refreshCredential).toHaveBeenCalledOnce();
    bind.dispose();
  });

  it("assertNoLocationReload fails when reconnect path calls reload", () => {
    const g = globalThis as { location?: { reload?: () => void } };
    const previous = g.location;
    g.location = { reload: () => undefined };
    expect(() =>
      assertNoLocationReload(() => {
        g.location?.reload?.();
      }),
    ).toThrow(/must not call location.reload/);
    expect(() =>
      assertNoLocationReload(() => {
        // production-like path: refresh credential only
      }),
    ).not.toThrow();
    g.location = previous;
  });

  it("production bind reconnect path does not call location.reload", () => {
    const g = globalThis as { location?: { reload?: () => void } };
    const previous = g.location;
    const reload = vi.fn();
    g.location = { reload };
    const refreshCredential = vi.fn();
    const bind = createDesktopSessionPreviewBind({
      sessionId: "s-noreload",
      refreshCredential,
    });
    bind.onPreviewOpen();
    bind.onStreamUrl("https://example.test/novnc?token=x");
    assertNoLocationReload(() => {
      bind.reconnect("credential");
    });
    expect(refreshCredential).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    bind.dispose();
    g.location = previous;
  });
});

describe("frame_tick promotion after missed first_frame", () => {
  it("promotes STREAM_ATTACHED → INTERACTIVE when frame_tick arrives first", () => {
    const bind = createDesktopSessionPreviewBind({
      sessionId: "sess-frame-tick",
    });
    bind.onPreviewOpen();
    bind.onStreamUrl("/sandbox/novnc?token=test");
    expect(bind.runtime.snapshot.phase).toBe("STREAM_ATTACHED");

    let captured: ((ev: MessageEvent) => void) | undefined;
    const dispose = bind.attachMessageListener({
      addEventListener(type: string, listener: unknown) {
        if (type === "message" && typeof listener === "function") {
          const fn = listener as unknown as (ev: MessageEvent) => void;
          captured = fn;
        }
      },
      removeEventListener() {},
    } as unknown as Window);

    expect(captured).toBeTypeOf("function");
    captured!({
      data: { source: "openbot-novnc-observer", type: "frame_tick", ts: Date.now() },
    } as MessageEvent);
    expect(bind.runtime.snapshot.phase).toBe("INTERACTIVE");
    dispose();
    bind.dispose();
  });
});
