import { describe, expect, it } from "vitest";
import { openSpaceMessage, parseEmployeeShellBridgeJSON } from "./native-bridge.ts";
import {
  createNativeHostTransport,
  detectNativeHostKind,
  EMPLOYEE_SHELL_HOST_HANDLER,
  sendToNativeHost,
} from "./native-host.ts";
import {
  assertDesktopTarget,
  embedPathForChat,
  embedPathForKnowledge,
  embedPathForSpace,
  embedPathForSurface,
  MOBILE_SHELL_MARKER,
  targetHasMobileShellMarker,
  WINDOWS_DEFAULT_EMBED_TARGET,
  windowsAuthGate,
  windowsBootstrapUrl,
  windowsEmbedPathForDeeplink,
  windowsRouteActionForBridgeType,
} from "./windows-host-contract.ts";

function webView2Window(received: unknown[], opts?: { throws?: boolean }): Window {
  return {
    chrome: {
      webview: {
        postMessage: (message: unknown) => {
          if (opts?.throws) {
            throw new Error("boom");
          }
          received.push(message);
        },
      },
    },
  } as unknown as Window;
}

describe("windows desktop host contract (Stage 55)", () => {
  it("defaults to embed overview without mobile shell marker", () => {
    expect(WINDOWS_DEFAULT_EMBED_TARGET).toBe("/embed/employee/overview");
    expect(targetHasMobileShellMarker(WINDOWS_DEFAULT_EMBED_TARGET)).toBe(false);
    expect(assertDesktopTarget(WINDOWS_DEFAULT_EMBED_TARGET)).toBe(WINDOWS_DEFAULT_EMBED_TARGET);
  });

  it("rejects shell=mobile on desktop targets", () => {
    expect(() => assertDesktopTarget(`/embed/employee/overview?${MOBILE_SHELL_MARKER}`)).toThrow(
      /mobile shell/,
    );
  });

  it("builds bootstrap URLs without shell=mobile", () => {
    const url = windowsBootstrapUrl("https://gw.example.test", "tok", WINDOWS_DEFAULT_EMBED_TARGET);
    expect(url).toContain("/native/bootstrap?");
    expect(url).toContain("token=tok");
    expect(url).toContain("target=");
    expect(url.includes(MOBILE_SHELL_MARKER)).toBe(false);
  });

  it("maps surfaces / space / knowledge / chat like Mac embed routing", () => {
    expect(embedPathForSurface("me")).toBe("/embed/employee/me");
    expect(embedPathForSpace("sp_1")).toBe("/embed/employee/workspace?session=space%3Asp_1");
    expect(embedPathForKnowledge("o_9", "doc")).toBe(
      "/embed/employee/knowledge?objectId=o_9&kind=doc",
    );
    expect(embedPathForChat("agent:bot-2:main")).toBe(
      "/embed/employee/overview?session=agent%3Abot-2%3Amain",
    );
    expect(embedPathForChat("space:sp_1")).toBe("/embed/employee/workspace?session=space%3Asp_1");
  });

  it("auth-gates deferred deep links", () => {
    const path = "/embed/employee/knowledge";
    expect(windowsAuthGate(false, path)).toEqual({ kind: "presentLogin", pendingPath: path });
    expect(windowsAuthGate(true, path)).toEqual({ kind: "openShell", path });
  });

  it("maps employee deeplink hosts to embed paths and rejects companion hosts", () => {
    expect(windowsEmbedPathForDeeplink({ host: "employee", surface: "me" })).toBe(
      "/embed/employee/me",
    );
    expect(windowsEmbedPathForDeeplink({ host: "chat", sessionKey: "agent:main:main" })).toBe(
      "/embed/employee/overview?session=agent%3Amain%3Amain",
    );
    expect(windowsEmbedPathForDeeplink({ host: "space", spaceId: "sp_1" })).toBe(
      "/embed/employee/workspace?session=space%3Asp_1",
    );
    expect(windowsEmbedPathForDeeplink({ host: "knowledge", objectId: "obj_9", kind: "doc" })).toBe(
      "/embed/employee/knowledge?objectId=obj_9&kind=doc",
    );
    expect(windowsEmbedPathForDeeplink({ host: "agent" })).toBeNull();
    expect(windowsEmbedPathForDeeplink({ host: "gateway" })).toBeNull();
  });

  it("keeps device settings and signOut as native host actions", () => {
    expect(windowsRouteActionForBridgeType("openDeviceSettings")).toEqual({
      kind: "native",
      type: "openDeviceSettings",
    });
    expect(windowsRouteActionForBridgeType("signOut")).toEqual({ kind: "native", type: "signOut" });
    expect(windowsRouteActionForBridgeType("openSpace", { spaceId: "sp_1" })).toEqual({
      kind: "embedNavigation",
      path: "/embed/employee/workspace?session=space%3Asp_1",
    });
  });
});

describe("native host webview2 transport (Stage 55)", () => {
  it("detects chrome.webview as webview2", () => {
    expect(detectNativeHostKind(webView2Window([]))).toBe("webview2");
    expect(createNativeHostTransport(webView2Window([])).available).toBe(true);
  });

  it("delivers serialized bridge messages over webview2", () => {
    const received: unknown[] = [];
    const ok = sendToNativeHost(openSpaceMessage("space-7"), webView2Window(received));
    expect(ok).toBe(true);
    expect(received).toHaveLength(1);
    expect(typeof received[0]).toBe("string");
    const parsed = parseEmployeeShellBridgeJSON(received[0] as string);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.message.type).toBe("openSpace");
    }
  });

  it("prefers webkit over webview2 when both are present", () => {
    const hybrid = {
      webkit: {
        messageHandlers: {
          [EMPLOYEE_SHELL_HOST_HANDLER]: { postMessage: () => undefined },
        },
      },
      chrome: { webview: { postMessage: () => undefined } },
    } as unknown as Window;
    expect(detectNativeHostKind(hybrid)).toBe("webkit");
  });

  it("prefers webview2 over android-style injected handler", () => {
    const hybrid = {
      chrome: { webview: { postMessage: () => undefined } },
      [EMPLOYEE_SHELL_HOST_HANDLER]: { postMessage: () => undefined },
    } as unknown as Window;
    expect(detectNativeHostKind(hybrid)).toBe("webview2");
  });

  it("returns false when webview2 postMessage throws", () => {
    expect(sendToNativeHost(openSpaceMessage("s"), webView2Window([], { throws: true }))).toBe(
      false,
    );
  });
});
