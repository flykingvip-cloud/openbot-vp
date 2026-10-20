import { describe, expect, it } from "vitest";
import {
  isAppleDesktopNavigator,
  resolveAuthorizationButtonLabel,
  resolveAuthorizationStatusLabel,
  resolveBrowserNotificationGranted,
  resolvePermissionGranted,
  resolveSystemAuthorizationAction,
  SYSTEM_AUTHORIZATION_COPY,
} from "./system-authorization.ts";

describe("system-authorization helpers", () => {
  it("detects apple desktop navigators", () => {
    expect(isAppleDesktopNavigator("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel")).toBe(
      true,
    );
    expect(isAppleDesktopNavigator("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32")).toBe(
      false,
    );
  });

  it("normalizes nested node permission payloads", () => {
    expect(resolvePermissionGranted(true)).toBe(true);
    expect(resolvePermissionGranted(false)).toBe(false);
    expect(resolvePermissionGranted({ status: "granted" })).toBe(true);
    expect(resolvePermissionGranted({ status: "denied" })).toBe(false);
    expect(resolvePermissionGranted({ granted: true })).toBe(true);
    expect(resolvePermissionGranted(null)).toBeNull();
  });

  it("maps browser notification permission", () => {
    expect(resolveBrowserNotificationGranted("granted")).toBe(true);
    expect(resolveBrowserNotificationGranted("denied")).toBe(false);
    expect(resolveBrowserNotificationGranted("default")).toBeNull();
    expect(resolveBrowserNotificationGranted("unsupported")).toBeNull();
  });

  it("routes fullDiskAccess to manual Mac settings or unavailable", () => {
    expect(
      resolveSystemAuthorizationAction("fullDiskAccess", {
        appleDesktop: true,
        nodeId: "mac-1",
        gatewayConnected: true,
      }),
    ).toEqual({
      kind: "open-mac-settings",
      reason: SYSTEM_AUTHORIZATION_COPY.fullDiskManual,
    });
    expect(
      resolveSystemAuthorizationAction("fullDiskAccess", {
        appleDesktop: false,
        nodeId: null,
        gatewayConnected: true,
      }).kind,
    ).toBe("unavailable");
  });

  it("invokes node permissions when a Mac node is connected", () => {
    expect(
      resolveSystemAuthorizationAction("automation", {
        appleDesktop: false,
        nodeId: "mac-1",
        gatewayConnected: true,
      }),
    ).toEqual({ kind: "invoke", capability: "appleScript" });
  });

  it("falls back to browser notifications without a Mac node", () => {
    const previous = (globalThis as { Notification?: typeof Notification }).Notification;
    (globalThis as { Notification?: typeof Notification }).Notification = class {
      static permission: NotificationPermission = "default";
      static requestPermission = async () => "granted" as NotificationPermission;
    } as unknown as typeof Notification;
    try {
      expect(
        resolveSystemAuthorizationAction("notifications", {
          appleDesktop: false,
          nodeId: null,
          gatewayConnected: true,
        }).kind,
      ).toBe("browser-notification");
    } finally {
      if (previous) {
        (globalThis as { Notification?: typeof Notification }).Notification = previous;
      } else {
        delete (globalThis as { Notification?: typeof Notification }).Notification;
      }
    }
  });

  it("labels statuses honestly when node is missing", () => {
    const host = { appleDesktop: false, nodeId: null, gatewayConnected: true };
    expect(resolveAuthorizationStatusLabel("accessibility", null, host)).toEqual({
      label: "需 Mac 客户端",
      tone: "default",
    });
    expect(resolveAuthorizationStatusLabel("fullDiskAccess", null, host)).toEqual({
      label: "需手动确认",
      tone: "default",
    });
    expect(resolveAuthorizationButtonLabel("accessibility", host)).toBe("查看说明");
    expect(resolveAuthorizationButtonLabel("fullDiskAccess", host)).toBe("查看说明");
  });
});
