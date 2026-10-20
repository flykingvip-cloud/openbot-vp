/**
 * Desktop Input Capability (ROADMAP v3 P1).
 *
 * Order: keyboard → mouse/pointer → fullscreen → clipboard → shortcut later.
 * Keyboard / pointer / fullscreen / clipboard are observable. Remote forwarding
 * and clipboard unlock gate on M1b INTERACTIVE. Clipboard also requires a granted
 * permission probe (see desktop-clipboard.ts) — never focus-loop polling.
 *
 * Iron rules:
 * - streamUrl / FIRST_FRAME alone never unlock input or clipboard.
 * - Anomaly / connecting overlays block forwarding (iframe inert).
 * - Fullscreen is layout-only (chat split); never location.reload().
 */

import {
  isClipboardPermissionGranted,
  type ClipboardPermissionState,
} from "./desktop-clipboard.ts";
import { assertNoLocationReload } from "./desktop-session-runtime.ts";
import type { DesktopSessionPhase } from "./desktop-session-state.ts";
import { canHumanDriveInput, type InteractionOwnershipSnapshot } from "./interaction-ownership.ts";

/** Loom landing stream id for the keyboard/pointer/fullscreen slice. */
export const DESKTOP_INPUT_CAPABILITY_LANDING = "DESKTOP_INPUT_CAPABILITY_M1" as const;

export type DesktopInputCapability = {
  /** Forward key events into the remote desktop. */
  keyboard: boolean;
  /** Forward click / move / scroll (pointer) into the remote desktop. */
  pointer: boolean;
  /** Fullscreen chrome enter/exit is available for the 电脑 preview. */
  fullscreen: boolean;
  /**
   * Clipboard sync capability — same INTERACTIVE + ownership gate as keyboard,
   * plus clipboard permission granted (see desktop-clipboard.ts).
   */
  clipboard: boolean;
};

export type DesktopInputGateContext = {
  /** Canonical M1b phase (prefer over connecting stage string). */
  phase: DesktopSessionPhase | null | undefined;
  /** Local takeover grant for this chat session. */
  controlsDesktop: boolean;
  /** Active sidebar surface. */
  surface: "computer" | "artifact" | null | undefined;
  /**
   * True when connecting / stall / auth / lost / degraded / reconnecting overlay
   * is covering the frame (or would block interaction).
   */
  anomalyOverlay?: boolean;
  /**
   * Interaction Ownership Coordinator snapshot (M4).
   * When present, human must own keyboard/mouse for this sessionKey.
   */
  ownership?: InteractionOwnershipSnapshot | null;
  /** Chat session key — paired with ownership for human drive checks. */
  sessionKey?: string | null;
  /**
   * Clipboard permission probe result (event-driven / one-shot).
   * Clipboard capability stays false until this is `"granted"`.
   */
  clipboardPermission?: ClipboardPermissionState | null;
};

export type ComputerLayoutSize = "docked" | "expanded" | "fullscreen";

const ANOMALY_OR_PRE_INTERACTIVE: ReadonlySet<string> = new Set([
  "IDLE",
  "OPENING",
  "CONNECTING",
  "STREAM_ATTACHED",
  "FIRST_FRAME",
  "CONNECT_FAILED",
  "STREAM_STALLED",
  "AUTH_EXPIRED",
  "SESSION_LOST",
  "NETWORK_DEGRADED",
  "RECONNECTING",
  "ENDED",
  "YIELDED",
]);

/** True only for the M1b INTERACTIVE phase. */
export function isDesktopSessionInteractive(
  phase: DesktopSessionPhase | null | undefined,
): boolean {
  return phase === "INTERACTIVE";
}

/**
 * Resolve observable capability flags.
 * Keyboard/pointer require: computer surface + takeover grant + INTERACTIVE + no anomaly overlay.
 * Fullscreen chrome is available whenever the computer surface is active (layout only).
 * Clipboard mirrors keyboard/pointer ownership gates and additionally requires permission granted.
 */
export function resolveDesktopInputCapability(
  ctx: DesktopInputGateContext,
): DesktopInputCapability {
  const onComputer = ctx.surface === "computer";
  const interactive = isDesktopSessionInteractive(ctx.phase);
  const blockedByOverlay = ctx.anomalyOverlay === true;
  const phaseBlocks = Boolean(ctx.phase && ANOMALY_OR_PRE_INTERACTIVE.has(ctx.phase));
  // Ownership coordinator: enforce only when exclusive owner is set.
  // HUMAN_TAKEOVER → human session must match; INTERACTIVE (agent) → block human UI.
  // BACKGROUND / GRACE / LEASE_REQUEST → defer to controlsDesktop (no exclusive owner).
  const ownershipAllows = (() => {
    const snap = ctx.ownership;
    if (snap == null) {
      return true;
    }
    if (snap.phase === "HUMAN_TAKEOVER") {
      return canHumanDriveInput(snap, ctx.sessionKey ?? null);
    }
    if (snap.phase === "INTERACTIVE") {
      // Agent holds exclusive interactive lease — noVNC human forward stays off.
      return false;
    }
    return true;
  })();

  const canForward =
    onComputer &&
    ctx.controlsDesktop &&
    interactive &&
    !blockedByOverlay &&
    !phaseBlocks &&
    ownershipAllows;

  return {
    keyboard: canForward,
    pointer: canForward,
    fullscreen: onComputer,
    clipboard: canForward && isClipboardPermissionGranted(ctx.clipboardPermission),
  };
}

export function shouldForwardKeyboard(ctx: DesktopInputGateContext): boolean {
  return resolveDesktopInputCapability(ctx).keyboard;
}

export function shouldForwardPointer(ctx: DesktopInputGateContext): boolean {
  return resolveDesktopInputCapability(ctx).pointer;
}

export function shouldForwardClipboard(ctx: DesktopInputGateContext): boolean {
  return resolveDesktopInputCapability(ctx).clipboard;
}

/** When true, the noVNC iframe must be `inert` (no key/pointer reach remote). */
export function shouldMarkDesktopFrameInert(ctx: DesktopInputGateContext): boolean {
  return !shouldForwardPointer(ctx);
}

export function isComputerFullscreenSize(size: ComputerLayoutSize | null | undefined): boolean {
  return size === "fullscreen";
}

export function enterComputerFullscreenSize(): "fullscreen" {
  return "fullscreen";
}

export function exitComputerFullscreenSize(): "docked" {
  return "docked";
}

export function toggleComputerFullscreenSize(
  current: ComputerLayoutSize | null | undefined,
): "fullscreen" | "docked" {
  return isComputerFullscreenSize(current) ? "docked" : "fullscreen";
}

/**
 * Apply a layout size change under the no-reload guard (tests / callers).
 * The mutator must only touch preview chrome — never location.reload().
 */
export function applyComputerFullscreenSizeChange(mutator: () => void): void {
  assertNoLocationReload(mutator);
}

/** Data-testid / attribute helpers for accept observability. */
export function inputCapabilityDataAttrs(cap: DesktopInputCapability): {
  "data-input-keyboard": "true" | "false";
  "data-input-pointer": "true" | "false";
  "data-input-fullscreen": "true" | "false";
  "data-input-clipboard": "true" | "false";
} {
  return {
    "data-input-keyboard": cap.keyboard ? "true" : "false",
    "data-input-pointer": cap.pointer ? "true" : "false",
    "data-input-fullscreen": cap.fullscreen ? "true" : "false",
    "data-input-clipboard": cap.clipboard ? "true" : "false",
  };
}
