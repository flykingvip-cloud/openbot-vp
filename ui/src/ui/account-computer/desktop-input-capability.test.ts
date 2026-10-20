import { describe, expect, it } from "vitest";
import {
  applyComputerFullscreenSizeChange,
  DESKTOP_INPUT_CAPABILITY_LANDING,
  enterComputerFullscreenSize,
  exitComputerFullscreenSize,
  inputCapabilityDataAttrs,
  isComputerFullscreenSize,
  isDesktopSessionInteractive,
  resolveDesktopInputCapability,
  shouldForwardClipboard,
  shouldForwardKeyboard,
  shouldForwardPointer,
  shouldMarkDesktopFrameInert,
  toggleComputerFullscreenSize,
  type DesktopInputGateContext,
} from "./desktop-input-capability.ts";
import { assertNoLocationReload } from "./desktop-session-runtime.ts";
import {
  createInteractionOwnershipSnapshot,
  reduceInteractionOwnership,
} from "./interaction-ownership.ts";

function gate(partial: Partial<DesktopInputGateContext> = {}): DesktopInputGateContext {
  return {
    phase: "INTERACTIVE",
    controlsDesktop: true,
    surface: "computer",
    anomalyOverlay: false,
    ...partial,
  };
}

describe("DESKTOP_INPUT_CAPABILITY_M1", () => {
  it("exports the loom landing id", () => {
    expect(DESKTOP_INPUT_CAPABILITY_LANDING).toBe("DESKTOP_INPUT_CAPABILITY_M1");
  });

  it("treats only INTERACTIVE as session-interactive", () => {
    expect(isDesktopSessionInteractive("INTERACTIVE")).toBe(true);
    expect(isDesktopSessionInteractive("FIRST_FRAME")).toBe(false);
    expect(isDesktopSessionInteractive("STREAM_ATTACHED")).toBe(false);
    expect(isDesktopSessionInteractive("CONNECTING")).toBe(false);
    expect(isDesktopSessionInteractive(null)).toBe(false);
  });

  it("unlocks keyboard+pointer when INTERACTIVE + takeover + computer + no overlay", () => {
    const ok = resolveDesktopInputCapability(gate());
    expect(ok).toEqual({
      keyboard: true,
      pointer: true,
      fullscreen: true,
      clipboard: false,
    });
    expect(shouldForwardKeyboard(gate())).toBe(true);
    expect(shouldForwardPointer(gate())).toBe(true);
    expect(shouldForwardClipboard(gate())).toBe(false);
    expect(shouldMarkDesktopFrameInert(gate())).toBe(false);
  });

  it("unlocks clipboard only when permission is granted on top of forward gates", () => {
    expect(shouldForwardClipboard(gate({ clipboardPermission: "unknown" }))).toBe(false);
    expect(shouldForwardClipboard(gate({ clipboardPermission: "prompt" }))).toBe(false);
    expect(shouldForwardClipboard(gate({ clipboardPermission: "denied" }))).toBe(false);
    expect(shouldForwardClipboard(gate({ clipboardPermission: "unsupported" }))).toBe(false);
    expect(shouldForwardClipboard(gate({ clipboardPermission: "granted" }))).toBe(true);
    const cap = resolveDesktopInputCapability(gate({ clipboardPermission: "granted" }));
    expect(cap.clipboard).toBe(true);
    expect(inputCapabilityDataAttrs(cap)["data-input-clipboard"]).toBe("true");
  });

  it("blocks keyboard/pointer/clipboard before INTERACTIVE (streamUrl / first frame)", () => {
    for (const phase of ["STREAM_ATTACHED", "FIRST_FRAME", "CONNECTING", "OPENING"] as const) {
      const cap = resolveDesktopInputCapability(
        gate({ phase, clipboardPermission: "granted" }),
      );
      expect(cap.keyboard, phase).toBe(false);
      expect(cap.pointer, phase).toBe(false);
      expect(cap.fullscreen, phase).toBe(true);
      expect(cap.clipboard, phase).toBe(false);
      expect(shouldMarkDesktopFrameInert(gate({ phase })), phase).toBe(true);
    }
  });

  it("blocks keyboard/pointer/clipboard under anomaly overlay even if phase is INTERACTIVE", () => {
    const cap = resolveDesktopInputCapability(
      gate({ anomalyOverlay: true, clipboardPermission: "granted" }),
    );
    expect(cap.keyboard).toBe(false);
    expect(cap.pointer).toBe(false);
    expect(cap.clipboard).toBe(false);
    expect(shouldMarkDesktopFrameInert(gate({ anomalyOverlay: true }))).toBe(true);
  });

  it("blocks when not controlling desktop or not on computer surface", () => {
    expect(shouldForwardKeyboard(gate({ controlsDesktop: false }))).toBe(false);
    expect(shouldForwardPointer(gate({ surface: "artifact" }))).toBe(false);
    expect(
      shouldForwardClipboard(gate({ controlsDesktop: false, clipboardPermission: "granted" })),
    ).toBe(false);
    const artifact = resolveDesktopInputCapability(
      gate({ surface: "artifact", clipboardPermission: "granted" }),
    );
    expect(artifact.fullscreen).toBe(false);
    expect(artifact.clipboard).toBe(false);
  });

  it("blocks on stall / auth / lost / degraded / reconnecting phases", () => {
    for (const phase of [
      "STREAM_STALLED",
      "AUTH_EXPIRED",
      "SESSION_LOST",
      "NETWORK_DEGRADED",
      "RECONNECTING",
      "CONNECT_FAILED",
    ] as const) {
      expect(shouldForwardPointer(gate({ phase })), phase).toBe(false);
      expect(shouldForwardKeyboard(gate({ phase })), phase).toBe(false);
      expect(
        shouldForwardClipboard(gate({ phase, clipboardPermission: "granted" })),
        phase,
      ).toBe(false);
    }
  });

  it("keeps clipboard false without permission even when keyboard is live", () => {
    expect(resolveDesktopInputCapability(gate()).clipboard).toBe(false);
    expect(inputCapabilityDataAttrs(resolveDesktopInputCapability(gate()))).toMatchObject({
      "data-input-clipboard": "false",
      "data-input-keyboard": "true",
      "data-input-pointer": "true",
      "data-input-fullscreen": "true",
    });
  });

  it("fullscreen helpers enter/exit/toggle without reload", () => {
    expect(enterComputerFullscreenSize()).toBe("fullscreen");
    expect(exitComputerFullscreenSize()).toBe("docked");
    expect(toggleComputerFullscreenSize("docked")).toBe("fullscreen");
    expect(toggleComputerFullscreenSize("fullscreen")).toBe("docked");
    expect(isComputerFullscreenSize("fullscreen")).toBe(true);
    expect(isComputerFullscreenSize("docked")).toBe(false);

    let size: "docked" | "fullscreen" = "docked";
    assertNoLocationReload(() => {
      applyComputerFullscreenSizeChange(() => {
        size = enterComputerFullscreenSize();
      });
    });
    expect(size).toBe("fullscreen");
    applyComputerFullscreenSizeChange(() => {
      size = exitComputerFullscreenSize();
    });
    expect(size).toBe("docked");
  });

  it("applyComputerFullscreenSizeChange fails if mutator reloads", () => {
    const g = globalThis as { location?: { reload?: () => void } };
    const prev = g.location;
    g.location = { reload: () => undefined };
    try {
      expect(() =>
        applyComputerFullscreenSizeChange(() => {
          g.location?.reload?.();
        }),
      ).toThrow(/must not call location.reload/);
    } finally {
      g.location = prev;
    }
  });

  it("blocks keyboard/pointer/clipboard when ownership says agent owns", () => {
    let ownership = createInteractionOwnershipSnapshot();
    ownership = reduceInteractionOwnership(ownership, {
      type: "AGENT_LEASE_REQUEST",
      agentId: "agent-a",
    });
    ownership = reduceInteractionOwnership(ownership, { type: "AGENT_LEASE_GRANT" });
    const cap = resolveDesktopInputCapability(
      gate({ ownership, sessionKey: "chat-1", clipboardPermission: "granted" }),
    );
    expect(cap.keyboard).toBe(false);
    expect(cap.pointer).toBe(false);
    expect(cap.clipboard).toBe(false);
  });

  it("allows keyboard/pointer/clipboard when ownership is HUMAN_TAKEOVER for this session", () => {
    let ownership = createInteractionOwnershipSnapshot();
    ownership = reduceInteractionOwnership(ownership, {
      type: "HUMAN_TAKEOVER",
      sessionKey: "chat-1",
    });
    const cap = resolveDesktopInputCapability(
      gate({ ownership, sessionKey: "chat-1", clipboardPermission: "granted" }),
    );
    expect(cap.keyboard).toBe(true);
    expect(cap.pointer).toBe(true);
    expect(cap.clipboard).toBe(true);
    const other = resolveDesktopInputCapability(
      gate({ ownership, sessionKey: "chat-other", clipboardPermission: "granted" }),
    );
    expect(other.keyboard).toBe(false);
    expect(other.clipboard).toBe(false);
  });
});
