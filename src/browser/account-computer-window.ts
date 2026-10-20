/**
 * Place an Account Computer Chromium window on the full desktop: left 0, top 0,
 * 1280×800. The Dock shelf stays hidden while an app window is open (#421).
 *
 * The sandbox image launches Chromium with --no-startup-window. A page opened
 * through CDP (browser action=open) does not go through the dock launcher in
 * scripts/sandbox-browser-desktop.py, so it can appear at a random size or
 * under the shelf. This module sets bounds on the existing browser via CDP.
 * It does not change the image or the Openbox rules.
 *
 * The desktop framebuffer is 1280×800. While an app window is open the Dock
 * shelf is unmapped, so the work area is the full desktop: left 0, top 0,
 * width 1280, height 800, windowState normal.
 */
import {
  appendCdpPath,
  fetchJson,
  fetchOk,
  isWebSocketUrl,
  normalizeCdpHttpBaseForJsonEndpoints,
  withCdpSocket,
  type CdpSendFn,
} from "./cdp.helpers.js";
import { normalizeCdpWsUrl } from "./cdp.js";

export const ACCOUNT_COMPUTER_DESKTOP_WIDTH = 1280;
export const ACCOUNT_COMPUTER_DESKTOP_HEIGHT = 800;

export type AccountComputerWindowBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
  windowState: "normal";
};

/** Single switch point for Account Computer window placement. */
export function accountComputerWorkArea(
  width = ACCOUNT_COMPUTER_DESKTOP_WIDTH,
  height = ACCOUNT_COMPUTER_DESKTOP_HEIGHT,
): AccountComputerWindowBounds {
  return {
    left: 0,
    top: 0,
    width,
    height,
    windowState: "normal",
  };
}

const PLACE_ATTEMPTS = 6;
const PLACE_RETRY_MS = 80;

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Browser.getWindowForTarget can miss the window for a moment after
 * Target.createTarget. Retry, then set bounds and activate. Returns false
 * when the window never appears. Does not throw.
 */
export async function placeAccountComputerWindowWithSend(params: {
  send: CdpSendFn;
  targetId: string;
  bounds?: AccountComputerWindowBounds;
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<boolean> {
  const targetId = params.targetId.trim();
  if (!targetId) {
    return false;
  }
  const bounds = params.bounds ?? accountComputerWorkArea();
  const attempts = params.attempts ?? PLACE_ATTEMPTS;
  const sleep = params.sleep ?? defaultSleep;
  let windowId: number | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = (await params.send("Browser.getWindowForTarget", { targetId })) as {
        windowId?: number;
      };
      if (typeof result?.windowId === "number" && result.windowId > 0) {
        windowId = result.windowId;
        break;
      }
    } catch {
      // Window is not ready yet.
    }
    if (attempt + 1 < attempts) {
      await sleep(PLACE_RETRY_MS);
    }
  }
  if (windowId === undefined) {
    return false;
  }
  await params.send("Browser.setWindowBounds", {
    windowId,
    bounds: {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      windowState: bounds.windowState,
    },
  });
  await params.send("Target.activateTarget", { targetId }).catch(() => undefined);
  // Headed Chromium can stay behind the dock/shelf after CDP-only opens.
  // Bring the page forward so the live desktop shows what the agent is clicking.
  await params.send("Page.bringToFront").catch(() => undefined);
  return true;
}

async function resolveBrowserWebSocketUrl(cdpUrl: string): Promise<string | null> {
  if (isWebSocketUrl(cdpUrl)) {
    return cdpUrl;
  }
  try {
    const version = await fetchJson<{ webSocketDebuggerUrl?: string }>(
      appendCdpPath(cdpUrl, "/json/version"),
      1000,
    );
    const raw = String(version?.webSocketDebuggerUrl ?? "").trim();
    return raw ? normalizeCdpWsUrl(raw, cdpUrl) : null;
  } catch {
    return null;
  }
}

/** Best-effort. A failed move must not fail the open that created the tab. */
export async function placeAccountComputerBrowserWindow(params: {
  cdpUrl: string;
  targetId: string;
}): Promise<boolean> {
  const cdpUrl = params.cdpUrl.trim();
  const targetId = params.targetId.trim();
  if (!cdpUrl || !targetId) {
    return false;
  }
  try {
    const wsUrl = await resolveBrowserWebSocketUrl(cdpUrl);
    if (!wsUrl) {
      return false;
    }
    const placed = await withCdpSocket(
      wsUrl,
      async (send: CdpSendFn) => placeAccountComputerWindowWithSend({ send, targetId }),
      { handshakeTimeoutMs: 2000 },
    );
    const httpBase = normalizeCdpHttpBaseForJsonEndpoints(cdpUrl);
    await fetchOk(
      appendCdpPath(httpBase, `/json/activate/${encodeURIComponent(targetId)}`),
      1000,
    ).catch(() => undefined);
    return placed;
  } catch {
    return false;
  }
}

export async function maybePlaceAccountComputerWindow(params: {
  enabled: boolean | undefined;
  cdpUrl: string;
  targetId: string | undefined;
  place?: (input: { cdpUrl: string; targetId: string }) => Promise<boolean>;
}): Promise<void> {
  const targetId = params.targetId?.trim();
  if (!params.enabled || !targetId) {
    return;
  }
  const place = params.place ?? placeAccountComputerBrowserWindow;
  try {
    await place({ cdpUrl: params.cdpUrl, targetId });
  } catch {
    // Placement is best-effort.
  }
}
