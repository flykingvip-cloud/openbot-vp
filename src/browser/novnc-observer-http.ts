/**
 * Same-origin noVNC page for account-computer previews.
 *
 * The browser loads a chrome-less observer page from this process (the bridge,
 * or the gateway when the iframe is on the control-ui origin). That page
 * imports noVNC's RFB module and scales the framebuffer into the iframe.
 * The container port stays on loopback and is never written into the page.
 * The page's websocket goes to `/sandbox/novnc/ws`, which the relay filters.
 *
 * Direct password bootstraps are not served. Every token becomes a relay
 * grant, and the VNC password stays on that grant.
 */
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  describeNoVncObserverToken,
  openNoVncRelayGrant,
  readNoVncStaticPort,
} from "../agents/sandbox/novnc-auth.js";

/** Loom landing for pointer-after-takeover + preview chrome declutter. */
export const DESKTOP_POINTER_AFTER_TAKEOVER_LANDING = "DESKTOP_POINTER_AFTER_TAKEOVER_M1" as const;

export type ResolvedNoVncObserver = {
  noVncPort: number;
  password?: string;
  /** Read-only grant. The relay drops key, pointer, and clipboard for this token. */
  viewOnly?: boolean;
  relay?: boolean;
};

const STATIC_TYPES: Record<string, string> = {
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript; charset=utf-8",
  json: "application/json",
  map: "application/json",
  png: "image/png",
  svg: "image/svg+xml",
  woff: "font/woff",
  woff2: "font/woff2",
};

function ownsNoVncPath(pathname: string): boolean {
  return pathname === "/sandbox/novnc" || pathname.startsWith("/sandbox/novnc/");
}

function safeNovncAsset(asset: string): string | null {
  if (!asset || asset.includes("\\") || asset.includes("\0")) {
    return null;
  }
  const parts = asset.split("/");
  if (
    parts.some(
      (part) => part.length === 0 || part === "." || part === ".." || part === "websockify",
    )
  ) {
    return null;
  }
  for (const part of parts) {
    if (!/^[A-Za-z0-9._-]+$/.test(part)) {
      return null;
    }
  }
  const leaf = parts[parts.length - 1] ?? "";
  const dot = leaf.lastIndexOf(".");
  const ext = dot >= 0 ? leaf.slice(dot + 1).toLowerCase() : "";
  if (!STATIC_TYPES[ext]) {
    return null;
  }
  return parts.join("/");
}

function writeNoStore(res: ServerResponse) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function jsonForInlineScript(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * One scale for both axes, plus the letterbox offset inside the box.
 * A portrait stage must not stretch 1280×800; the spare band stays wallpaper.
 */
export function mapPreviewFramebufferPoint(
  cssX: number,
  cssY: number,
  cssWidth: number,
  cssHeight: number,
  fbWidth: number,
  fbHeight: number,
): { x: number; y: number } {
  if (!(cssWidth > 0) || !(cssHeight > 0) || !(fbWidth > 0) || !(fbHeight > 0)) {
    return { x: 0, y: 0 };
  }
  const scale = Math.min(cssWidth / fbWidth, cssHeight / fbHeight);
  if (!(scale > 0)) {
    return { x: 0, y: 0 };
  }
  const offsetX = (cssWidth - fbWidth * scale) / 2;
  const offsetY = (cssHeight - fbHeight * scale) / 2;
  const clamp = (value: number, span: number) => {
    const raw = Math.round(value);
    if (raw < 0) {
      return 0;
    }
    if (raw > span - 1) {
      return span - 1;
    }
    return raw;
  };
  return {
    x: clamp((cssX - offsetX) / scale, fbWidth),
    y: clamp((cssY - offsetY) / scale, fbHeight),
  };
}

export type SandboxDesktopHotspot = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx: number;
  cy: number;
};

/**
 * Dock hit targets drawn by scripts/sandbox-browser-desktop.py.
 * Keep the sizes in lockstep with that script. The wallpaper has no center launcher.
 */
export function sandboxDesktopHotspots(
  width: number,
  height: number,
): {
  chrome: SandboxDesktopHotspot;
  files: SandboxDesktopHotspot;
  terminal: SandboxDesktopHotspot;
} {
  // Lockstep with scripts/sandbox-browser-desktop.py (~75% of the previous dock).
  const dockH = 112;
  const dockY2 = height - 20;
  const dockY1 = dockY2 - dockH;
  const iconY = Math.floor((dockY1 + dockY2) / 2);
  const iconHit = 42;
  const center = Math.floor(width / 2);
  const box = (cx: number): SandboxDesktopHotspot => ({
    x1: cx - iconHit,
    y1: iconY - iconHit,
    x2: cx + iconHit,
    y2: iconY + iconHit,
    cx,
    cy: iconY,
  });
  return {
    chrome: box(center - 120),
    files: box(center),
    terminal: box(center + 120),
  };
}

/**
 * Pointer helpers copied into the observer page as source text.
 * Do not splice Function.toString() here — the TS loader wraps nested
 * functions with a `__name` helper that is absent in the iframe.
 *
 * Landing: DESKTOP_POINTER_AFTER_TAKEOVER_M1
 *
 * With scaleViewport, stock noVNC already maps canvas-relative CSS → framebuffer
 * via Display.absX/absY. The older capture+stopPropagation path stole mousedown
 * from RFB and re-sent via RFB.messages.pointerEvent; when that path no-oped or
 * mapped wrong, *all* clicks looked dead while the picture still painted (and
 * keyboard could still work once the iframe had focus).
 *
 * New contract:
 * - Do not override absX/absY.
 * - Do not stopPropagation on the screen.
 * - Wrap `_sendMouse` so x11vnc still gets a move (mask 0) before button-down.
 */
export const PREVIEW_POINTER_RUNTIME = `
function armPreviewPointer(screen, rfb) {
  if (!rfb || rfb._openbotPointerArmed) return;
  if (typeof rfb._sendMouse !== "function") return;
  rfb._openbotPointerArmed = true;
  var lastMask = 0;
  var orig = rfb._sendMouse.bind(rfb);
  rfb._sendMouse = function (x, y, mask) {
    // Move first. x11vnc can apply a bare button edge at the previous cursor,
    // which leaves a dock click at the origin instead of the icon.
    if ((mask & 1) && !(lastMask & 1)) {
      orig(x, y, 0);
    }
    lastMask = mask;
    return orig(x, y, mask);
  };
}
`;

/**
 * postMessage bridge for Desktop Session Runtime (M1b).
 * Parent Control UI listens for stream_connected / first_frame / frame_tick.
 * Never includes tokens or full websocket URLs in the payload.
 */
export const NOVNC_OBSERVER_SOURCE = "openbot-novnc-observer";

export const PREVIEW_SESSION_OBSERVER_RUNTIME = `
function postDesktopSession(type) {
  try {
    if (!window.parent || window.parent === window) return;
    window.parent.postMessage({ source: "openbot-novnc-observer", type: type, ts: Date.now() }, "*");
  } catch (_) {}
}
function armDesktopSessionObserver(rfb) {
  var firstFrameSent = false;
  var tickTimer = null;
  function onFrame() {
    if (!firstFrameSent) {
      firstFrameSent = true;
      postDesktopSession("first_frame");
    } else {
      postDesktopSession("frame_tick");
    }
  }
  rfb.addEventListener("connect", function () {
    postDesktopSession("stream_connected");
  });
  rfb.addEventListener("frame", onFrame);
  rfb.addEventListener("framebufferupdate", onFrame);
  // Poll framebuffer size as a fallback when RFB does not emit frame events.
  tickTimer = setInterval(function () {
    var w = rfb._fbWidth || 0;
    var h = rfb._fbHeight || 0;
    if (w > 0 && h > 0) {
      onFrame();
      if (firstFrameSent && tickTimer) {
        clearInterval(tickTimer);
        tickTimer = setInterval(function () {
          if ((rfb._fbWidth || 0) > 0) postDesktopSession("frame_tick");
        }, 1000);
      }
    }
  }, 250);
}
`;

/**
 * Parent Control UI asks the iframe to show the cloud desktop.
 * The chord is Control+Alt+D (X keysyms). Openbox binds C-A-d to
 * `openbot-sandbox-desktop --show-desktop`, which unmaps apps so the dock returns.
 * The relay still drops the chord when this session does not hold input.
 *
 * x11vnc 0.9.16 (the sandbox image) does not implement QEMU extended key
 * events. noVNC `sendKey(keysym, code, down)` emits those (RFB type 255)
 * once the server advertises the pseudo-encoding, and x11vnc then closes
 * the session instead of pressing the chord. Always write a classic KeyEvent.
 */
export const PREVIEW_DESKTOP_COMMAND_RUNTIME = `
function sendClassicKey(rfb, keysym, down) {
  var messages = null;
  if (typeof RFB !== "undefined" && RFB && RFB.messages) messages = RFB.messages;
  else if (rfb && rfb.constructor && rfb.constructor.messages) messages = rfb.constructor.messages;
  if (messages && typeof messages.keyEvent === "function" && rfb && rfb._sock) {
    try {
      messages.keyEvent(rfb._sock, keysym, down ? 1 : 0);
      return;
    } catch (err) {}
  }
  if (!rfb || typeof rfb.sendKey !== "function") return;
  var qemu = rfb._qemuExtKeyEventSupported;
  rfb._qemuExtKeyEventSupported = false;
  try {
    rfb.sendKey(keysym, "", !!down);
  } finally {
    rfb._qemuExtKeyEventSupported = qemu;
  }
}
function sendShowDesktopChord(rfb) {
  if (!rfb) return;
  if (rfb._rfbConnectionState && rfb._rfbConnectionState !== "connected") {
    if (!rfb.__openbotShowDesktopWait && typeof rfb.addEventListener === "function") {
      rfb.__openbotShowDesktopWait = true;
      rfb.addEventListener("connect", function () {
        rfb.__openbotShowDesktopWait = false;
        sendShowDesktopChord(rfb);
      });
    }
    return;
  }
  // Drop stuck modifiers, then Control+Alt+D. Openbox matches C-A-d on the D press.
  var shift = 0xffe1;
  var control = 0xffe3;
  var alt = 0xffe9;
  var keyD = 0x0064;
  sendClassicKey(rfb, shift, false);
  sendClassicKey(rfb, control, false);
  sendClassicKey(rfb, alt, false);
  sendClassicKey(rfb, keyD, false);
  sendClassicKey(rfb, control, true);
  sendClassicKey(rfb, alt, true);
  sendClassicKey(rfb, keyD, true);
  sendClassicKey(rfb, keyD, false);
  sendClassicKey(rfb, alt, false);
  sendClassicKey(rfb, control, false);
}
function desktopCommandFromParent(source) {
  if (!source) return true;
  var cursor = window;
  while (cursor) {
    if (source === cursor) return true;
    if (!cursor.parent || cursor.parent === cursor) break;
    cursor = cursor.parent;
  }
  return false;
}
function armDesktopCommandBridge(rfb) {
  if (window.__openbotDesktopCommandArmed) return;
  window.__openbotDesktopCommandArmed = true;
  window.__openbotShowDesktop = function () { sendShowDesktopChord(rfb); };
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== "openbot-control-ui" || data.type !== "show_desktop") return;
    if (!desktopCommandFromParent(event.source)) return;
    sendShowDesktopChord(rfb);
  });
}
`;

/**
 * Chrome-less noVNC page. x11vnc refuses client-driven framebuffer resize.
 * scaleViewport fits 1280×800 with one scale. The spare band is the wallpaper
 * tone, not a stretched canvas. Stock noVNC chrome is not loaded.
 */
export function buildNoVncObserverBootstrapHtml(grantId: string): string {
  const rfbModule = `/sandbox/novnc/static/${grantId}/core/rfb.js`;
  const encodedPath = new URLSearchParams({
    path: `sandbox/novnc/ws?grant=${grantId}`,
  }).toString();
  const rfbJson = jsonForInlineScript(rfbModule);
  const encodedJson = jsonForInlineScript(encodedPath);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="referrer" content="no-referrer" />
  <title>OpenBot Computer</title>
  <style>
    html, body, #screen {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #e7e7eb;
    }
    #screen {
      position: absolute;
      inset: 0;
    }
    /* noVNC paints the spare band rgb(40, 40, 40). Keep that band wallpaper-colored
       and let scaleViewport size the canvas. Do not stretch it to the stage. */
    #screen > div {
      width: 100% !important;
      height: 100% !important;
      overflow: hidden !important;
      background: #e7e7eb !important;
      align-items: center !important;
      justify-content: center !important;
    }
    #screen canvas {
      margin: auto !important;
      flex: 0 0 auto !important;
    }
  </style>
</head>
<body>
  <div id="screen"></div>
  <script type="module">
    import RFB from ${rfbJson};
    ${PREVIEW_POINTER_RUNTIME}
    ${PREVIEW_SESSION_OBSERVER_RUNTIME}
    ${PREVIEW_DESKTOP_COMMAND_RUNTIME}
    const path = new URLSearchParams(${encodedJson}).get("path") ?? "";
    const cut = path.indexOf("?");
    const pathname = cut === -1 ? path : path.slice(0, cut);
    const search = cut === -1 ? "" : path.slice(cut);
    const target = new URL(window.location.href);
    target.pathname = "/" + pathname.replace(/^\\/+/, "");
    target.search = search;
    target.hash = "";
    target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
    const screen = document.getElementById("screen");
    const rfb = new RFB(screen, target.href);
    rfb.viewOnly = false;
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.focusOnClick = true;
    armPreviewPointer(screen, rfb);
    armDesktopSessionObserver(rfb);
    armDesktopCommandBridge(rfb);
    rfb.addEventListener("connect", function () { armPreviewPointer(screen, rfb); });
  </script>
</body>
</html>`;
}

function proxyNovncAsset(port: number, asset: string, res: ServerResponse) {
  const ext = asset.slice(asset.lastIndexOf(".") + 1).toLowerCase();
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port,
      path: `/${asset}`,
      method: "GET",
      timeout: 5000,
    },
    (up) => {
      if (up.statusCode !== 200) {
        up.resume();
        if (!res.headersSent) {
          writeNoStore(res);
          res.statusCode = 502;
          res.end("noVNC asset unavailable");
        }
        return;
      }
      writeNoStore(res);
      res.statusCode = 200;
      res.setHeader("Content-Type", STATIC_TYPES[ext] ?? "application/octet-stream");
      up.pipe(res);
    },
  );
  upstream.on("timeout", () => upstream.destroy());
  upstream.on("error", () => {
    if (!res.headersSent) {
      writeNoStore(res);
      res.statusCode = 502;
      res.end("noVNC asset unavailable");
    }
  });
  upstream.end();
}

/**
 * Serve the observer bootstrap and same-origin noVNC files.
 * Returns true when the request is under `/sandbox/novnc`.
 */
export function handleNoVncObserverHttp(
  req: IncomingMessage,
  res: ServerResponse,
  resolveToken: (token: string) => ResolvedNoVncObserver | null,
): boolean {
  const rawUrl = req.url ?? "/";
  if (!rawUrl.startsWith("/sandbox/novnc")) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(rawUrl, "http://127.0.0.1");
  } catch {
    writeNoStore(res);
    res.statusCode = 400;
    res.end("invalid noVNC path");
    return true;
  }
  if (!ownsNoVncPath(url.pathname)) {
    return false;
  }
  if (rawUrl.includes("..") || rawUrl.includes("\\")) {
    writeNoStore(res);
    res.statusCode = 400;
    res.end("invalid noVNC path");
    return true;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    writeNoStore(res);
    res.statusCode = 405;
    res.end("method not allowed");
    return true;
  }

  if (url.pathname === "/sandbox/novnc") {
    writeNoStore(res);
    const rawToken = url.searchParams.get("token")?.trim() ?? "";
    if (!rawToken) {
      res.statusCode = 400;
      res.end("Missing token");
      return true;
    }
    // HEAD must not consume the one-shot token (prefetch / probes).
    if (req.method === "HEAD") {
      const described = describeNoVncObserverToken(rawToken);
      if (!described) {
        res.statusCode = 404;
        res.end();
        return true;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end();
      return true;
    }
    const resolved = resolveToken(rawToken);
    if (!resolved) {
      res.statusCode = 404;
      res.end("Invalid or expired token");
      return true;
    }
    openNoVncRelayGrant({
      token: rawToken,
      noVncPort: resolved.noVncPort,
      password: resolved.password,
      input: resolved.viewOnly !== true,
    });
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(buildNoVncObserverBootstrapHtml(rawToken));
    return true;
  }

  const staticPrefix = "/sandbox/novnc/static/";
  if (url.pathname.startsWith(staticPrefix)) {
    const rest = url.pathname.slice(staticPrefix.length);
    const slash = rest.indexOf("/");
    const grantId = slash === -1 ? "" : rest.slice(0, slash);
    const asset = slash === -1 ? "" : safeNovncAsset(rest.slice(slash + 1));
    const port = /^[a-f0-9]+$/i.test(grantId) ? readNoVncStaticPort(grantId) : null;
    if (!asset || port == null) {
      writeNoStore(res);
      res.statusCode = 404;
      res.end("noVNC asset unavailable");
      return true;
    }
    if (req.method === "HEAD") {
      writeNoStore(res);
      res.statusCode = 200;
      res.end();
      return true;
    }
    proxyNovncAsset(port, asset, res);
    return true;
  }

  writeNoStore(res);
  res.statusCode = 404;
  res.end("Not Found");
  return true;
}
