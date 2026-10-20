import { describe, expect, it, vi } from "vitest";
import { EMPLOYEE_EMBED_SURFACES } from "./embed-routes.ts";
import {
  applyEmployeeEmbedRootClass,
  EMPLOYEE_EMBED_MOBILE_CLASS,
  EMPLOYEE_EMBED_ROOT_CLASS,
  isMobileEmbedSearch,
  mapEmbedSurfaceToWorkbenchModule,
  resolveEmployeeEmbedRouting,
} from "./workbench-embed.ts";

describe("mapEmbedSurfaceToWorkbenchModule", () => {
  it("maps every surface to a workbench module", () => {
    expect(mapEmbedSurfaceToWorkbenchModule("overview")).toBe("assistant");
    expect(mapEmbedSurfaceToWorkbenchModule("workspace")).toBe("collaboration");
    expect(mapEmbedSurfaceToWorkbenchModule("knowledge")).toBe("knowledge");
    expect(mapEmbedSurfaceToWorkbenchModule("growth")).toBe("assistant");
    expect(mapEmbedSurfaceToWorkbenchModule("me")).toBe("settings");
  });

  it("has a mapping for every declared embed surface (exhaustive)", () => {
    for (const surface of EMPLOYEE_EMBED_SURFACES) {
      expect(typeof mapEmbedSurfaceToWorkbenchModule(surface)).toBe("string");
    }
  });
});

describe("isMobileEmbedSearch", () => {
  it("is true only for the ?shell=mobile marker", () => {
    expect(isMobileEmbedSearch("?shell=mobile")).toBe(true);
    expect(isMobileEmbedSearch("shell=mobile")).toBe(true);
    expect(isMobileEmbedSearch("?token=x&shell=mobile")).toBe(true);
  });

  it("is false without the marker", () => {
    expect(isMobileEmbedSearch("")).toBe(false);
    expect(isMobileEmbedSearch(undefined)).toBe(false);
    expect(isMobileEmbedSearch("?shell=desktop")).toBe(false);
    expect(isMobileEmbedSearch("?other=1")).toBe(false);
  });
});

describe("resolveEmployeeEmbedRouting", () => {
  it("resolves an embed route to tab me + mapped module + chromeless (desktop by default)", () => {
    expect(resolveEmployeeEmbedRouting("/embed/employee/workspace")).toEqual({
      surface: "workspace",
      tab: "me",
      primaryModule: "collaboration",
      mobile: false,
      chromeless: true,
    });
    expect(resolveEmployeeEmbedRouting("/embed/employee/overview")?.primaryModule).toBe(
      "assistant",
    );
  });

  it("stays chromeless when basePath is empty (macOS WKWebView /embed/employee/overview)", () => {
    const routing = resolveEmployeeEmbedRouting("/embed/employee/overview", "");
    expect(routing).not.toBeNull();
    expect(routing?.chromeless).toBe(true);
    expect(routing?.surface).toBe("overview");
    expect(routing?.tab).toBe("me");
  });

  it("honors a base path prefix", () => {
    expect(resolveEmployeeEmbedRouting("/app/embed/employee/knowledge", "/app")?.surface).toBe(
      "knowledge",
    );
    expect(
      resolveEmployeeEmbedRouting("/app/embed/employee/knowledge", "/app/")?.primaryModule,
    ).toBe("knowledge");
  });

  it("returns null for non-embed paths", () => {
    expect(resolveEmployeeEmbedRouting("/")).toBeNull();
    expect(resolveEmployeeEmbedRouting("/me")).toBeNull();
    expect(resolveEmployeeEmbedRouting("/embed/employee/unknown")).toBeNull();
  });

  it("flags mobile only when the ?shell=mobile marker is present", () => {
    expect(resolveEmployeeEmbedRouting("/embed/employee/overview")?.mobile).toBe(false);
    expect(
      resolveEmployeeEmbedRouting("/embed/employee/overview", "", "?shell=mobile")?.mobile,
    ).toBe(true);
  });

  it("pins the me surface to personal settings ONLY on the phone marker", () => {
    // Phone: system settings trimmed.
    const phoneMe = resolveEmployeeEmbedRouting("/embed/employee/me", "", "?shell=mobile");
    expect(phoneMe?.primaryModule).toBe("settings");
    expect(phoneMe?.settingsView).toBe("personal");

    // macOS / desktop parity: no marker -> settingsView left unset (system settings kept).
    const desktopMe = resolveEmployeeEmbedRouting("/embed/employee/me");
    expect(desktopMe?.primaryModule).toBe("settings");
    expect(desktopMe?.settingsView).toBeUndefined();
  });

  it("never sets settingsView for non-me surfaces (even on the phone marker)", () => {
    expect(
      resolveEmployeeEmbedRouting("/embed/employee/workspace", "", "?shell=mobile")?.settingsView,
    ).toBeUndefined();
    expect(
      resolveEmployeeEmbedRouting("/embed/employee/knowledge", "", "?shell=mobile")?.settingsView,
    ).toBeUndefined();
  });
});

describe("applyEmployeeEmbedRootClass", () => {
  it("toggles the embed + mobile classes on a provided root", () => {
    const toggle = vi.fn();
    const root = { classList: { toggle } };

    applyEmployeeEmbedRootClass(true, true, root);
    expect(toggle).toHaveBeenCalledWith(EMPLOYEE_EMBED_ROOT_CLASS, true);
    expect(toggle).toHaveBeenCalledWith(EMPLOYEE_EMBED_MOBILE_CLASS, true);

    toggle.mockClear();
    applyEmployeeEmbedRootClass(true, false, root);
    expect(toggle).toHaveBeenCalledWith(EMPLOYEE_EMBED_ROOT_CLASS, true);
    expect(toggle).toHaveBeenCalledWith(EMPLOYEE_EMBED_MOBILE_CLASS, false);

    toggle.mockClear();
    // Leaving embed clears both classes (mobile can't be true without chromeless).
    applyEmployeeEmbedRootClass(false, true, root);
    expect(toggle).toHaveBeenCalledWith(EMPLOYEE_EMBED_ROOT_CLASS, false);
    expect(toggle).toHaveBeenCalledWith(EMPLOYEE_EMBED_MOBILE_CLASS, false);
  });

  it("is a no-op (does not throw) when no DOM/root is available", () => {
    expect(() => applyEmployeeEmbedRootClass(true, false)).not.toThrow();
  });
});
