/**
 * Tri-Platform Employee Shell — native host transport (Phase 1 + Windows WebView2).
 *
 * The runtime counterpart to `native-bridge.ts`: it detects whether the embedded
 * employee shell is running inside a native host WebView and delivers validated
 * bridge messages over the right channel:
 *   - iOS / macOS (WKWebView): `window.webkit.messageHandlers.<handler>.postMessage`
 *   - Windows (WebView2): `window.chrome.webview.postMessage` (Stage 55)
 *   - Android (WebView): an injected JS interface `window.<handler>.postMessage`
 *   - plain web: no host -> send() is a no-op returning false
 *
 * Native shells MUST register the channel under `EMPLOYEE_SHELL_HOST_HANDLER`
 * (WebKit / Android) or expose `chrome.webview` (WebView2). Messages are
 * re-validated before delivery (defense-in-depth) and serialized to a JSON
 * string so every platform receives an identical wire format.
 */

import {
  parseEmployeeShellBridgeMessage,
  serializeEmployeeShellBridgeMessage,
  type EmployeeShellBridgeMessage,
} from "./native-bridge.ts";

/** The channel kind detected for the current runtime. */
export type NativeHostKind = "webkit" | "webview2" | "android" | "none";

/**
 * Canonical handler name. Native shells register:
 *   - WKWebView: `WKUserContentController.add(_, name: "openbotEmployeeShell")`
 *   - Android: `WebView.addJavascriptInterface(bridge, "openbotEmployeeShell")`
 *   - WebView2: host listens on `CoreWebView2.WebMessageReceived`; optional
 *     document-start script may also alias `window.openbotEmployeeShell`.
 */
export const EMPLOYEE_SHELL_HOST_HANDLER = "openbotEmployeeShell";

/** A transport bound to whichever native host (if any) was detected. */
export type NativeHostTransport = {
  kind: NativeHostKind;
  /** True when a real native host channel is present. */
  readonly available: boolean;
  /**
   * Validate + serialize + deliver a bridge message. Returns true when it was
   * handed to a native host, false when there is no host or the message is
   * invalid (invalid messages are never delivered).
   */
  send: (message: EmployeeShellBridgeMessage) => boolean;
};

// Local structural types for the untyped globals we probe. We never widen the
// global `Window` type; these are read through narrow, checked casts.
type WebKitMessageHandler = { postMessage: (message: unknown) => void };
type WebKitBridge = { messageHandlers?: Record<string, WebKitMessageHandler | undefined> };
type AndroidBridge = { postMessage: (message: string) => void };
type WebView2Bridge = { postMessage: (message: unknown) => void };

type MaybeWindow = (Window & typeof globalThis) | undefined;

function resolveWindow(explicit?: Window): MaybeWindow {
  if (explicit) {
    return explicit as Window & typeof globalThis;
  }
  return typeof window === "undefined" ? undefined : window;
}

function readWebkitHandler(win: Window): WebKitMessageHandler | null {
  const webkit = (win as unknown as { webkit?: WebKitBridge }).webkit;
  const handler = webkit?.messageHandlers?.[EMPLOYEE_SHELL_HOST_HANDLER];
  return handler && typeof handler.postMessage === "function" ? handler : null;
}

function readWebView2Bridge(win: Window): WebView2Bridge | null {
  const chrome = (win as unknown as { chrome?: { webview?: WebView2Bridge } }).chrome;
  const webview = chrome?.webview;
  return webview && typeof webview.postMessage === "function" ? webview : null;
}

function readAndroidBridge(win: Window): AndroidBridge | null {
  const candidate = (win as unknown as Record<string, unknown>)[EMPLOYEE_SHELL_HOST_HANDLER];
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as { postMessage?: unknown }).postMessage === "function"
  ) {
    return candidate as AndroidBridge;
  }
  return null;
}

const NOOP_TRANSPORT: NativeHostTransport = {
  kind: "none",
  available: false,
  send: () => false,
};

/**
 * Build a transport bound to the detected native host. On plain web (no host)
 * a no-op transport is returned so callers never need to branch.
 *
 * Preference order: webkit → webview2 → android. WebView2 is checked before the
 * injected handler so a Windows host that also aliases `openbotEmployeeShell`
 * still reports as `webview2`.
 */
export function createNativeHostTransport(explicitWindow?: Window): NativeHostTransport {
  const win = resolveWindow(explicitWindow);
  if (!win) {
    return NOOP_TRANSPORT;
  }

  const webkitHandler = readWebkitHandler(win);
  if (webkitHandler) {
    return {
      kind: "webkit",
      available: true,
      send: (message) => deliver(message, (serialized) => webkitHandler.postMessage(serialized)),
    };
  }

  const webView2 = readWebView2Bridge(win);
  if (webView2) {
    return {
      kind: "webview2",
      available: true,
      send: (message) => deliver(message, (serialized) => webView2.postMessage(serialized)),
    };
  }

  const androidBridge = readAndroidBridge(win);
  if (androidBridge) {
    return {
      kind: "android",
      available: true,
      send: (message) => deliver(message, (serialized) => androidBridge.postMessage(serialized)),
    };
  }

  return NOOP_TRANSPORT;
}

function deliver(message: EmployeeShellBridgeMessage, post: (serialized: string) => void): boolean {
  // Re-validate before crossing the boundary: never deliver a malformed message
  // even if a caller hand-built one that bypassed the typed constructors.
  const validated = parseEmployeeShellBridgeMessage(message);
  if (!validated.ok) {
    return false;
  }
  try {
    post(serializeEmployeeShellBridgeMessage(validated.message));
    return true;
  } catch {
    return false;
  }
}

/** Detect which native host channel (if any) is present. */
export function detectNativeHostKind(explicitWindow?: Window): NativeHostKind {
  return createNativeHostTransport(explicitWindow).kind;
}

/** True when the employee shell is embedded inside a native host WebView. */
export function isEmbeddedInNativeShell(explicitWindow?: Window): boolean {
  return createNativeHostTransport(explicitWindow).available;
}

/** Convenience: build a transport and send a single message. */
export function sendToNativeHost(
  message: EmployeeShellBridgeMessage,
  explicitWindow?: Window,
): boolean {
  return createNativeHostTransport(explicitWindow).send(message);
}
