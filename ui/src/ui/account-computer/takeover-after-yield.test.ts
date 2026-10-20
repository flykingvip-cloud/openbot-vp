// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyServerComputerPreview,
  advanceComputerDesktopInteractiveForTests,
  beginAgentComputerUse,
  expireComputerConnectingHoldForTests,
  handBackComputerPreview,
  readComputerPreviewModel,
  resetAccountComputerPreviewForTests,
  takeoverComputerPreview,
  type ComputerPreviewChrome,
} from "../views/account-computer-preview.ts";
import { resolveDesktopInputCapability } from "./desktop-input-capability.ts";
import {
  createDesktopSessionPreviewBind,
  NOVNC_OBSERVER_SOURCE,
  notifyDesktopPreviewPaint,
  resetPreviewBindsForTests,
} from "./desktop-session-preview-bind.ts";
import {
  createInteractionOwnershipSnapshot,
  reduceInteractionOwnership,
} from "./interaction-ownership.ts";

const STREAM = "https://gateway.example/sandbox/novnc?token=preview-token";
const STREAM_B = "https://gateway.example/sandbox/novnc?token=preview-token-b";

function createHost(sessionKey = "agent-a"): ComputerPreviewChrome {
  return {
    sidebarOpen: false,
    sidebarSurface: "artifact",
    computerPreviewSize: "docked",
    computerNarrowChat: false,
    computerPreviewRevision: 0,
    sessionKey,
    assistantName: "Ada",
  };
}

describe("接管 after 给AI (YIELDED resume)", () => {
  afterEach(() => {
    resetAccountComputerPreviewForTests();
  });

  it("leaves YIELDED on retake and restores INTERACTIVE input capability", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    takeoverComputerPreview(host, "You");
    advanceComputerDesktopInteractiveForTests(host.sessionKey);
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM_B,
      grantsInput: true,
      controlledBy: { kind: "user", label: "You" },
    });
    expireComputerConnectingHoldForTests();
    advanceComputerDesktopInteractiveForTests(host.sessionKey);

    handBackComputerPreview(host);
    const afterHandBack = readComputerPreviewModel(host, {
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(afterHandBack.sessionPhase).toBe("YIELDED");
    expect(afterHandBack.controlsDesktop).toBe(false);
    expect(afterHandBack.inputCapability?.pointer).toBe(false);

    takeoverComputerPreview(host, "You");
    expect(
      readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" }).sessionPhase,
    ).not.toBe("YIELDED");

    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: `${STREAM_B}-retake`,
      grantsInput: true,
      controlledBy: { kind: "user", label: "You" },
    });
    expireComputerConnectingHoldForTests();
    advanceComputerDesktopInteractiveForTests(host.sessionKey);

    const afterRetake = readComputerPreviewModel(host, {
      tenantId: "tenant-1",
      userId: "user-1",
    });
    expect(afterRetake.sessionPhase).toBe("INTERACTIVE");
    expect(afterRetake.controlsDesktop).toBe(true);
    expect(afterRetake.ownership?.phase).toBe("HUMAN_TAKEOVER");
    expect(afterRetake.inputCapability?.keyboard).toBe(true);
    expect(afterRetake.inputCapability?.pointer).toBe(true);
  });
});

describe("接管 first_frame / stall recover paints INTERACTIVE (clears inert)", () => {
  afterEach(() => {
    resetAccountComputerPreviewForTests();
    resetPreviewBindsForTests();
    vi.useRealTimers();
  });

  it("first_frame postMessage reaches INTERACTIVE and bumps preview paint", () => {
    const host = {
      sessionKey: "agent-a",
      computerPreviewRevision: 0,
      requestUpdate: vi.fn(),
    };
    const bind = createDesktopSessionPreviewBind({
      sessionId: host.sessionKey,
      host,
    });
    bind.onPreviewOpen();
    bind.onStreamUrl(STREAM);
    expect(bind.runtime.snapshot.phase).toBe("STREAM_ATTACHED");

    let ownership = createInteractionOwnershipSnapshot();
    ownership = reduceInteractionOwnership(ownership, {
      type: "HUMAN_TAKEOVER",
      sessionKey: host.sessionKey,
    });

    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    const dispose = bind.attachMessageListener(target);
    const handler = (target.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "message",
    )?.[1] as (event: MessageEvent) => void;

    const revBefore = host.computerPreviewRevision;
    handler({
      data: { source: NOVNC_OBSERVER_SOURCE, type: "first_frame", ts: Date.now() },
    } as MessageEvent);

    expect(bind.runtime.snapshot.phase).toBe("INTERACTIVE");
    expect(host.computerPreviewRevision).toBe(revBefore + 1);
    expect(host.requestUpdate).toHaveBeenCalled();

    const cap = resolveDesktopInputCapability({
      phase: bind.runtime.snapshot.phase,
      controlsDesktop: true,
      surface: "computer",
      anomalyOverlay: false,
      sessionKey: host.sessionKey,
      ownership,
      clipboardPermission: "granted",
    });
    expect(cap.pointer).toBe(true);
    expect(cap.keyboard).toBe(true);

    dispose();
    bind.dispose();
  });

  it("frame_tick after STREAM_STALLED promotes INTERACTIVE and paints without force-sync", () => {
    vi.useFakeTimers();
    const host = {
      sessionKey: "agent-a",
      computerPreviewRevision: 3,
      requestUpdate: vi.fn(),
    };
    const bind = createDesktopSessionPreviewBind({
      sessionId: host.sessionKey,
      host,
      stallSuspectMs: 100,
      stallConfirmMs: 100,
    });
    bind.onPreviewOpen();
    bind.onStreamUrl(STREAM_B);
    bind.runtime.noteFirstFrame();
    bind.runtime.noteInteractiveReady();
    expect(bind.runtime.snapshot.phase).toBe("INTERACTIVE");

    vi.advanceTimersByTime(100);
    expect(bind.runtime.snapshot.phase).toBe("STREAM_STALLED");

    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    const dispose = bind.attachMessageListener(target);
    const handler = (target.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "message",
    )?.[1] as (event: MessageEvent) => void;

    const revBefore = host.computerPreviewRevision;
    handler({
      data: { source: NOVNC_OBSERVER_SOURCE, type: "frame_tick", ts: Date.now() },
    } as MessageEvent);

    expect(bind.runtime.snapshot.phase).toBe("INTERACTIVE");
    expect(host.computerPreviewRevision).toBeGreaterThan(revBefore);
    expect(host.requestUpdate).toHaveBeenCalled();

    dispose();
    bind.dispose();
  });

  it("takeover + reminted input URL + first_frame clears inert without manual force-sync", () => {
    const host = createHost();
    beginAgentComputerUse(host, "Ada");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM,
      controlledBy: { kind: "agent", label: "Ada" },
    });
    expireComputerConnectingHoldForTests();
    takeoverComputerPreview(host, "You");
    applyServerComputerPreview({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: host.sessionKey,
      action: "open",
      status: "READY",
      streamUrl: STREAM_B,
      grantsInput: true,
      controlledBy: { kind: "user", label: "You" },
    });
    expireComputerConnectingHoldForTests();

    const bind = createDesktopSessionPreviewBind({
      sessionId: host.sessionKey,
      host,
    });
    // Mirror post-takeover stream attach (STREAM_ATTACHED) then live first_frame.
    bind.onPreviewOpen();
    bind.onStreamUrl(STREAM_B);
    expect(bind.runtime.snapshot.phase).toBe("STREAM_ATTACHED");

    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    const dispose = bind.attachMessageListener(target);
    const handler = (target.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "message",
    )?.[1] as (event: MessageEvent) => void;
    handler({
      data: { source: NOVNC_OBSERVER_SOURCE, type: "first_frame", ts: Date.now() },
    } as MessageEvent);

    expect(bind.runtime.snapshot.phase).toBe("INTERACTIVE");
    expect(host.computerPreviewRevision).toBeGreaterThan(0);
    const model = readComputerPreviewModel(host, { tenantId: "tenant-1", userId: "user-1" });
    expect(model.controlsDesktop).toBe(true);
    expect(model.streamUrl).toBe(STREAM_B);
    const cap = resolveDesktopInputCapability({
      phase: bind.runtime.snapshot.phase,
      controlsDesktop: model.controlsDesktop,
      surface: "computer",
      anomalyOverlay: false,
      sessionKey: host.sessionKey,
      ownership: model.ownership,
      clipboardPermission: "granted",
    });
    expect(cap.pointer).toBe(true);
    expect(cap.keyboard).toBe(true);

    dispose();
    bind.dispose();
  });

  it("notifyDesktopPreviewPaint is a no-op without host fields", () => {
    expect(() => notifyDesktopPreviewPaint(undefined)).not.toThrow();
    expect(() => notifyDesktopPreviewPaint({ sessionKey: "x" })).not.toThrow();
  });
});
