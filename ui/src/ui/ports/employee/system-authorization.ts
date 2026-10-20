/**
 * Employee system-settings → 安全与隐私 authorization helpers.
 *
 * These entries are macOS TCC capabilities proxied through a connected Mac
 * node. The browser Control UI cannot grant them natively (except Notifications
 * via the Web Notification API when no Mac node is present).
 */

export type SystemAuthorizationKey =
  | "fullDiskAccess"
  | "accessibility"
  | "automation"
  | "notifications";

export type SystemAuthorizationHost = {
  /** True when navigator looks like macOS (Safari / Chrome on Mac). */
  appleDesktop: boolean;
  /** Connected Mac/OpenBot node that can run device.permissions.request. */
  nodeId: string | null;
  gatewayConnected: boolean;
};

export type SystemAuthorizationAction =
  | { kind: "invoke"; capability: "accessibility" | "appleScript" | "notifications" }
  | { kind: "browser-notification" }
  | { kind: "open-mac-settings"; reason: string }
  | { kind: "unavailable"; message: string };

export const SYSTEM_AUTHORIZATION_COPY = {
  panelSubtitleConnected:
    "通过已连接的本机 OpenBot（Mac）管理桌面执行、通知与自动化所需的系统权限。",
  panelSubtitleDisconnected:
    "这些是 macOS 系统权限。请先启动并连接本机 OpenBot 客户端；纯浏览器无法代替系统授权。",
  fullDiskManual:
    "完全磁盘访问需在运行 OpenBot 的 Mac「系统设置 → 隐私与安全性」中手动勾选；本面板无法远程探测或申请。",
  needMacNode:
    "未检测到已连接的 Mac 客户端。请启动本机 OpenBot 后再管理辅助功能 / 自动化 / 通知授权。",
  openedMacSettings: "已尝试打开 Mac 系统设置。授权完成后返回本页，状态会随节点刷新。",
  invokeRefreshed: "系统授权状态已刷新。",
  invokeStarted: "已发起系统授权请求。",
  invokeFailed: "无法向本机 OpenBot 发起授权请求。请确认 Mac 客户端在线后重试。",
  browserNotificationGranted: "浏览器通知已授权。",
  browserNotificationDenied: "浏览器通知被拒绝。可在浏览器站点设置中重新开启。",
  browserNotificationUnsupported: "当前浏览器不支持通知权限申请。",
} as const;

export function isAppleDesktopNavigator(
  userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "",
  platform = typeof navigator !== "undefined" ? navigator.platform : "",
): boolean {
  const ua = userAgent.toLowerCase();
  const p = platform.toLowerCase();
  return (
    p.includes("mac") ||
    ua.includes("macintosh") ||
    ua.includes("mac os x") ||
    // iPadOS desktop mode still reports MacIntel
    (p === "macintel" && ua.includes("safari"))
  );
}

/** Normalize node permission payloads (boolean or `{ status, granted }`). */
export function resolvePermissionGranted(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.granted === "boolean") {
    return record.granted;
  }
  if (record.status === "granted") {
    return true;
  }
  if (record.status === "denied") {
    return false;
  }
  return null;
}

export function resolveBrowserNotificationGranted(
  permission: NotificationPermission | "unsupported" | null | undefined = typeof Notification !==
  "undefined"
    ? Notification.permission
    : "unsupported",
): boolean | null {
  if (permission === "granted") {
    return true;
  }
  if (permission === "denied") {
    return false;
  }
  return null;
}

export function macPrivacySettingsUrl(key: SystemAuthorizationKey): string {
  switch (key) {
    case "fullDiskAccess":
      return "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";
    case "accessibility":
      return "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
    case "automation":
      return "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";
    case "notifications":
      return "x-apple.systempreferences:com.apple.Notifications-Settings.extension";
  }
}

export function resolveSystemAuthorizationAction(
  key: SystemAuthorizationKey,
  host: SystemAuthorizationHost,
): SystemAuthorizationAction {
  if (key === "fullDiskAccess") {
    if (host.appleDesktop) {
      return {
        kind: "open-mac-settings",
        reason: SYSTEM_AUTHORIZATION_COPY.fullDiskManual,
      };
    }
    return {
      kind: "unavailable",
      message: SYSTEM_AUTHORIZATION_COPY.fullDiskManual,
    };
  }

  if (host.nodeId && host.gatewayConnected) {
    const capability =
      key === "accessibility"
        ? "accessibility"
        : key === "automation"
          ? "appleScript"
          : "notifications";
    return { kind: "invoke", capability };
  }

  if (key === "notifications" && typeof Notification !== "undefined") {
    return { kind: "browser-notification" };
  }

  if (host.appleDesktop) {
    return {
      kind: "open-mac-settings",
      reason: SYSTEM_AUTHORIZATION_COPY.needMacNode,
    };
  }

  return {
    kind: "unavailable",
    message: SYSTEM_AUTHORIZATION_COPY.needMacNode,
  };
}

export function resolveAuthorizationStatusLabel(
  key: SystemAuthorizationKey,
  granted: boolean | null,
  host: SystemAuthorizationHost,
): { label: string; tone: "ok" | "warn" | "default" } {
  if (granted === true) {
    return { label: "已授权", tone: "ok" };
  }
  if (granted === false) {
    return { label: "未授权", tone: "warn" };
  }
  if (key === "fullDiskAccess") {
    return { label: "需手动确认", tone: "default" };
  }
  if (!host.nodeId) {
    return { label: "需 Mac 客户端", tone: "default" };
  }
  return { label: "待确认", tone: "default" };
}

export function resolveAuthorizationButtonLabel(
  key: SystemAuthorizationKey,
  host: SystemAuthorizationHost,
): string {
  const action = resolveSystemAuthorizationAction(key, host);
  switch (action.kind) {
    case "invoke":
      return "去授权";
    case "browser-notification":
      return "允许浏览器通知";
    case "open-mac-settings":
      return "打开系统设置";
    case "unavailable":
      return "查看说明";
  }
}
