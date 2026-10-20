/**
 * Windows desktop employee Web shell host contract (Stage 55).
 *
 * Mirrors the Mac Stage 53/54 desktop host rules in a pure, Node-testable module
 * so the C# WebView2 host (`apps/windows`) and the web embed stay aligned without
 * requiring a Windows build machine for every change.
 *
 * Desktop rules (ADR option 1):
 *   - Load Web employee `/embed/employee/*` — full web parity, NO `shell=mobile`
 *   - Same bridge wire format as macOS / iOS / Android (`native-bridge.ts`)
 *   - Auth gate: signed-out menu/deeplink → present login + stash pending path
 *   - `openDeviceSettings` / `signOut` stay host-native (companion still planned;
 *     Windows host stubs device-settings — does NOT navigate to employee "me")
 *   - No native four-tab IA
 */

import {
  buildEmployeeEmbedPath,
  defaultEmployeeEmbedPath,
  EMPLOYEE_EMBED_ROUTE_PREFIX,
  NATIVE_BOOTSTRAP_PATH,
  type EmployeeEmbedSurface,
} from "./embed-routes.ts";
import type { EmployeeShellBridgeMessageType } from "./native-bridge.ts";

/** Phone-only trim marker — desktop hosts MUST NOT add this. */
export const MOBILE_SHELL_MARKER = "shell=mobile";

export const WINDOWS_DEFAULT_EMBED_TARGET = defaultEmployeeEmbedPath();

export const WINDOWS_MINT_PATH = "/native/bootstrap/mint";
export const WINDOWS_BOOTSTRAP_PATH = NATIVE_BOOTSTRAP_PATH;

/** Deep-link hostnames that open the employee Web shell window. */
export const WINDOWS_EMPLOYEE_DEEPLINK_HOSTS = ["employee", "chat", "space", "knowledge"] as const;

export type WindowsEmployeeDeeplinkHost = (typeof WINDOWS_EMPLOYEE_DEEPLINK_HOSTS)[number];

/** Hosts that stay with a future companion / non-shell handler. */
export const WINDOWS_NON_SHELL_DEEPLINK_HOSTS = ["agent", "gateway", "workspace"] as const;

export type WindowsAuthGateDecision =
  | { kind: "presentLogin"; pendingPath: string }
  | { kind: "openShell"; path: string };

export type WindowsRouteAction =
  | { kind: "embedNavigation"; path: string }
  | {
      kind: "native";
      type: Extract<EmployeeShellBridgeMessageType, "openDeviceSettings" | "signOut" | "ready">;
    };

export function isWindowsEmployeeDeeplinkHost(host: string): host is WindowsEmployeeDeeplinkHost {
  return (WINDOWS_EMPLOYEE_DEEPLINK_HOSTS as readonly string[]).includes(host);
}

export function isWindowsNonShellDeeplinkHost(host: string): boolean {
  return (WINDOWS_NON_SHELL_DEEPLINK_HOSTS as readonly string[]).includes(host);
}

/** Auth gate used by deferred deep links and shell open when signed out. */
export function windowsAuthGate(isLoggedIn: boolean, targetPath: string): WindowsAuthGateDecision {
  if (isLoggedIn) {
    return { kind: "openShell", path: targetPath };
  }
  return { kind: "presentLogin", pendingPath: targetPath };
}

export function collaborationSessionKey(spaceId: string): string {
  let identity = spaceId.trim();
  while (identity.toLowerCase().startsWith("space:")) {
    identity = identity.slice(6).trim();
  }
  return `space:${identity}`;
}

function pathWithQuery(surface: EmployeeEmbedSurface, items: Array<[string, string]>): string {
  const base = buildEmployeeEmbedPath(surface);
  if (items.length === 0) {
    return base;
  }
  const query = items
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join("&");
  return `${base}?${query}`;
}

export function embedPathForSurface(surface: EmployeeEmbedSurface): string {
  return buildEmployeeEmbedPath(surface);
}

export function embedPathForSpace(spaceId: string): string {
  return pathWithQuery("workspace", [["session", collaborationSessionKey(spaceId)]]);
}

export function embedPathForKnowledge(objectId: string, kind?: string): string {
  const items: Array<[string, string]> = [["objectId", objectId]];
  if (kind && kind.trim().length > 0) {
    items.push(["kind", kind.trim()]);
  }
  return pathWithQuery("knowledge", items);
}

export function embedPathForChat(sessionKey?: string, agentId?: string): string {
  const key = (sessionKey ?? "").trim();
  const trimmedAgent = (agentId ?? "").trim();
  const resolved =
    key.length > 0 ? key : trimmedAgent.length > 0 ? `agent:${trimmedAgent}:main` : "";
  const surface: EmployeeEmbedSurface = resolved.startsWith("space:") ? "workspace" : "overview";
  if (resolved.length === 0) {
    return embedPathForSurface(surface);
  }
  return pathWithQuery(surface, [["session", resolved]]);
}

/**
 * Map employee-grammar deep link → embed path, or null for non-shell hosts.
 * Mirrors Mac `EmployeeShellDeepLinkRouting.embedPath`.
 */
export function windowsEmbedPathForDeeplink(input: {
  host: string;
  surface?: EmployeeEmbedSurface;
  sessionKey?: string;
  agentId?: string;
  spaceId?: string;
  objectId?: string;
  kind?: string;
}): string | null {
  const host = input.host.trim().toLowerCase();
  if (!isWindowsEmployeeDeeplinkHost(host)) {
    return null;
  }
  switch (host) {
    case "employee":
      return embedPathForSurface(input.surface ?? "overview");
    case "chat":
      return embedPathForChat(input.sessionKey, input.agentId);
    case "space":
      return embedPathForSpace(input.spaceId ?? "");
    case "knowledge":
      return embedPathForKnowledge(input.objectId ?? "", input.kind);
    default:
      return null;
  }
}

/** Route a bridge intent the same way Mac desktop does. */
export function windowsRouteActionForBridgeType(
  type: EmployeeShellBridgeMessageType,
  payload: {
    spaceId?: string;
    objectId?: string;
    kind?: string;
    sessionKey?: string;
    agentId?: string;
  } = {},
): WindowsRouteAction {
  switch (type) {
    case "openSpace":
      return { kind: "embedNavigation", path: embedPathForSpace(payload.spaceId ?? "") };
    case "openKnowledgeObject":
      return {
        kind: "embedNavigation",
        path: embedPathForKnowledge(payload.objectId ?? "", payload.kind),
      };
    case "openChat":
      return {
        kind: "embedNavigation",
        path: embedPathForChat(payload.sessionKey, payload.agentId),
      };
    case "openAssistant":
      return { kind: "embedNavigation", path: embedPathForChat(undefined, payload.agentId) };
    case "openDeviceSettings":
      return { kind: "native", type: "openDeviceSettings" };
    case "signOut":
      return { kind: "native", type: "signOut" };
    case "ready":
      return { kind: "native", type: "ready" };
  }
}

/** Build `/native/bootstrap?token=…&target=…` without adding `shell=mobile`. */
export function windowsBootstrapUrl(baseUrl: string, token: string, target: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const params = new URLSearchParams({ token, target });
  const url = `${base}${WINDOWS_BOOTSTRAP_PATH}?${params.toString()}`;
  if (url.includes(MOBILE_SHELL_MARKER)) {
    throw new Error("desktop Windows host must not emit shell=mobile");
  }
  return url;
}

/** True when a bootstrap/embed target string already carries the phone marker. */
export function targetHasMobileShellMarker(target: string): boolean {
  return target.includes(MOBILE_SHELL_MARKER);
}

/** Desktop invariant: target stays free of the phone shell marker. */
export function assertDesktopTarget(target: string): string {
  if (targetHasMobileShellMarker(target)) {
    throw new Error(`desktop Windows host rejected mobile shell marker in target: ${target}`);
  }
  if (!target.startsWith(EMPLOYEE_EMBED_ROUTE_PREFIX) && target !== "/") {
    // Allow only embed paths (or cloud workbench `/` for future parity). Employee
    // shell default is always an embed path.
    throw new Error(`desktop Windows host rejected non-embed target: ${target}`);
  }
  return target;
}
