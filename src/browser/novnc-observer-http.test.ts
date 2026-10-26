import { execFileSync } from "node:child_process";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  buildNoVncObserverBootstrapHtml,
  mapPreviewFramebufferPoint,
  PREVIEW_DESKTOP_COMMAND_RUNTIME,
  PREVIEW_POINTER_RUNTIME,
  PREVIEW_SESSION_OBSERVER_RUNTIME,
  sandboxDesktopHotspots,
} from "./novnc-observer-http.js";

function previewPointerApi() {
  const context = vm.createContext({ Math });
  vm.runInContext(PREVIEW_POINTER_RUNTIME, context);
  return {
    armPreviewPointer: context.armPreviewPointer as (screen: object | null, rfb: object) => void,
  };
}

describe("noVNC observer bootstrap", () => {
  it("sends classic Control+Alt+D only for a parent show_desktop message", () => {
    const listeners: Array<(event: { data?: unknown; source?: object }) => void> = [];
    const parent = {};
    const classic: Array<[number, number]> = [];
    const fallback: Array<[number, string, boolean]> = [];
    const context = vm.createContext({
      window: {
        parent,
        __openbotDesktopCommandArmed: false,
        addEventListener: (
          _type: string,
          fn: (event: { data?: unknown; source?: object }) => void,
        ) => {
          listeners.push(fn);
        },
      },
      RFB: {
        messages: {
          keyEvent: (_sock: object, keysym: number, down: number) => {
            classic.push([keysym, down]);
          },
        },
      },
    });
    vm.runInContext(PREVIEW_DESKTOP_COMMAND_RUNTIME, context);
    const rfb = {
      _sock: {},
      _qemuExtKeyEventSupported: true,
      sendKey: (keysym: number, code: string, down: boolean) => {
        fallback.push([keysym, code, down]);
      },
    };
    const armed = context as {
      armDesktopCommandBridge: (value: object) => void;
      window: { __openbotShowDesktop?: () => void };
    };
    armed.armDesktopCommandBridge(rfb);
    const deliver = (data: unknown, source: object) => {
      for (const listener of listeners) {
        listener({ data, source });
      }
    };
    deliver({ source: "openbot-control-ui", type: "show_desktop" }, parent);
    deliver({ source: "other", type: "show_desktop" }, parent);
    deliver({ source: "openbot-control-ui", type: "show_desktop" }, {});
    const chord = [
      [0xffe1, 0],
      [0xffe3, 0],
      [0xffe9, 0],
      [0x0064, 0],
      [0xffe3, 1],
      [0xffe9, 1],
      [0x0064, 1],
      [0x0064, 0],
      [0xffe9, 0],
      [0xffe3, 0],
    ];
    expect(classic).toEqual(chord);
    expect(fallback).toEqual([]);
    expect(rfb._qemuExtKeyEventSupported).toBe(true);
    armed.window.__openbotShowDesktop?.();
    expect(classic).toEqual([...chord, ...chord]);
  });

  it("maps a uniform letterboxed click and clamps the spare band", () => {
    const scale = Math.min(499 / 1280, 591 / 800);
    const offsetY = (591 - 800 * scale) / 2;
    const chrome = sandboxDesktopHotspots(1280, 800).chrome;
    const mapped = mapPreviewFramebufferPoint(
      chrome.cx * scale,
      offsetY + chrome.cy * scale,
      499,
      591,
      1280,
      800,
    );
    expect(mapped).toEqual({ x: chrome.cx, y: chrome.cy });
    const letterbox = mapPreviewFramebufferPoint(20, 8, 499, 591, 1280, 800);
    expect(letterbox.y).toBe(0);
    expect(letterbox.y).toBeLessThan(chrome.y1);
    expect(mapPreviewFramebufferPoint(10, 10, 0, 0, 1280, 800)).toEqual({ x: 0, y: 0 });
  });

  it("fits the framebuffer with one scale and a wallpaper letterbox", () => {
    const html = buildNoVncObserverBootstrapHtml("abc123");
    expect(html).toContain("viewOnly = false");
    expect(html).not.toContain("viewOnly = true");
    expect(html).toContain("align-items: center");
    expect(html).toContain("justify-content: center");
    expect(html).toContain("#e7e7eb");
    const canvasRule = html.slice(
      html.indexOf("#screen canvas"),
      html.indexOf("#screen canvas") + 180,
    );
    expect(canvasRule).toContain("flex: 0 0 auto");
    expect(canvasRule).not.toContain("width:");
    expect(canvasRule).not.toContain("height:");
    expect(html).toContain(PREVIEW_POINTER_RUNTIME.trim());
    expect(html).not.toContain("__name");
    expect(html).not.toContain("mapPreviewAxis");
    expect(html).not.toContain("stopPropagation");
    expect(html).not.toContain("installPreviewPointerMap");
    expect(html).not.toContain("display.absX =");
    expect(html).toContain("_sendMouse");
    expect(html).toContain("armPreviewPointer(screen, rfb)");
    expect(html).toContain("armDesktopSessionObserver(rfb)");
    expect(html).toContain("armDesktopCommandBridge(rfb)");
    expect(html).toContain(PREVIEW_DESKTOP_COMMAND_RUNTIME.trim());
    expect(html).toContain("openbot-control-ui");
    expect(html).toContain("show_desktop");
    expect(html).toContain("__openbotShowDesktop");
    expect(html).toContain("keyEvent");
    expect(html).toContain("0xffe1");
    expect(html).toContain("0xffe3");
    expect(html).toContain("0xffe9");
    expect(html).toContain("0x0064");
    expect(html).not.toContain('sendKey(keyD, "KeyD"');
    expect(html).toContain("openbot-novnc-observer");
    expect(html).toContain("first_frame");
    expect(html).toContain("frame_tick");
    expect(html).toContain("stream_connected");
    expect(html).toContain(PREVIEW_SESSION_OBSERVER_RUNTIME.trim());
    expect(html).toContain("scaleViewport = true");
  });

  it("maps the three dock icons through a uniform stage into their hotspots", () => {
    const fb = sandboxDesktopHotspots(1280, 800);
    // 84px is 75% of the previous 112px hit target.
    expect(fb.chrome.x2 - fb.chrome.x1).toBe(84);
    expect(fb.files.x2 - fb.files.x1).toBe(84);
    expect(fb.terminal.x2 - fb.terminal.x1).toBe(84);
    expect(fb.chrome).toMatchObject({ x1: 478, y1: 682, x2: 562, y2: 766, cx: 520, cy: 724 });
    expect(fb.files).toMatchObject({ x1: 598, y1: 682, x2: 682, y2: 766, cx: 640, cy: 724 });
    expect(fb.terminal).toMatchObject({ x1: 718, y1: 682, x2: 802, y2: 766, cx: 760, cy: 724 });
    expect("open" in fb).toBe(false);
    const script = path.resolve("scripts/sandbox-browser-desktop.py");
    const printed = JSON.parse(
      execFileSync("python3", [script, "--print-hotspots", "1280", "800"], { encoding: "utf8" }),
    );
    expect(printed).toEqual(fb);
    expect(
      execFileSync("python3", [script, "--hit", "1280", "800", "640", "364"], {
        encoding: "utf8",
      }).trim(),
    ).toBe("none");
    expect(
      execFileSync("python3", [script, "--hit", "1280", "800", "520", "724"], {
        encoding: "utf8",
      }).trim(),
    ).toBe("chrome");
    expect(
      execFileSync("python3", [script, "--hit", "1280", "800", "640", "724"], {
        encoding: "utf8",
      }).trim(),
    ).toBe("files");
    expect(
      execFileSync("python3", [script, "--hit", "1280", "800", "760", "724"], {
        encoding: "utf8",
      }).trim(),
    ).toBe("terminal");
    for (const stage of [
      { width: 499, height: 591 },
      { width: 960, height: 600 },
      { width: 1400, height: 420 },
    ]) {
      const scale = Math.min(stage.width / 1280, stage.height / 800);
      const offsetX = (stage.width - 1280 * scale) / 2;
      const offsetY = (stage.height - 800 * scale) / 2;
      expect((1280 * scale) / (800 * scale)).toBeCloseTo(1.6, 5);
      for (const target of [fb.chrome, fb.files, fb.terminal]) {
        const mapped = mapPreviewFramebufferPoint(
          offsetX + target.cx * scale,
          offsetY + target.cy * scale,
          stage.width,
          stage.height,
          1280,
          800,
        );
        expect(mapped).toEqual({ x: target.cx, y: target.cy });
        expect(mapped.x).toBeGreaterThanOrEqual(target.x1);
        expect(mapped.x).toBeLessThanOrEqual(target.x2);
        expect(mapped.y).toBeGreaterThanOrEqual(target.y1);
        expect(mapped.y).toBeLessThanOrEqual(target.y2);
      }
    }
  });

  it("gives apps the full framebuffer and shows the shelf only when none are mapped", () => {
    const script = path.resolve("scripts/sandbox-browser-desktop.py");
    const layout = JSON.parse(
      execFileSync("python3", [script, "--print-layout", "1280", "800"], { encoding: "utf8" }),
    );
    expect(layout).toEqual({ shelf: [0, 668, 1280, 800], work: [0, 0, 1280, 800] });
    const action = (...args: string[]) =>
      execFileSync("python3", [script, "--dock-action", ...args], { encoding: "utf8" }).trim();
    const shelf = (...args: string[]) =>
      execFileSync("python3", [script, "--shelf-visible", ...args], { encoding: "utf8" }).trim();
    expect(action("chrome", "-", "tk.Tk", "OpenBot Desktop", "0x1")).toBe("launch -");
    expect(action("chrome", "-", "chromium.Chromium", "OpenBot", "0x2")).toBe("raise 0x2");
    expect(action("chrome", "0x0002", "chromium.Chromium", "OpenBot", "0x2")).toBe("raise 0x2");
    expect(action("files", "0x9", "thunar.Thunar", "openbot-home - Thunar", "0x3")).toBe(
      "raise 0x3",
    );
    expect(action("files", "0x3", "thunar.Thunar", "openbot-home - Thunar", "0x3")).toBe(
      "raise 0x3",
    );
    expect(action("files", "-", "Thunar", "Thunar", "0x6")).toBe("raise 0x6");
    expect(action("files", "-", "tk.Tk", "文件", "0x7")).toBe("launch -");
    expect(action("terminal", "-", "xterm.XTerm", "终端", "0x4")).toBe("raise 0x4");
    expect(action("terminal", "0x4", "xterm.XTerm", "终端", "0x4")).toBe("raise 0x4");
    expect(action("terminal", "hidden:0x4", "xterm.XTerm", "终端", "0x4")).toBe("raise 0x4");
    expect(shelf("tk.Tk", "OpenBot Desktop", "0x1")).toBe("show");
    expect(shelf("chromium.Chromium", "OpenBot", "0x2")).toBe("hide");
    expect(shelf("google-chrome.Google-chrome", "New Tab", "0x5")).toBe("hide");
    expect(shelf("hidden:0x2", "chromium.Chromium", "OpenBot", "0x2")).toBe("show");
    expect(shelf("thunar.Thunar", "openbot-home - Thunar", "0x3")).toBe("hide");
    expect(shelf("tk.Tk", "文件", "0x3")).toBe("show");
    expect(shelf("xterm.XTerm", "终端", "0x4")).toBe("hide");
    expect(shelf("hidden:0x4", "xterm.XTerm", "终端", "0x4")).toBe("show");
    expect(shelf("tk.Tk", "OpenBot Desktop", "0x1", "chromium.Chromium", "OpenBot", "0x2")).toBe(
      "hide",
    );
  });

  it("wraps _sendMouse so button-down is preceded by a move at the same point", () => {
    const api = previewPointerApi();
    const sent: Array<{ x: number; y: number; mask: number }> = [];
    const rfb = {
      _sendMouse(x: number, y: number, mask: number) {
        sent.push({ x, y, mask });
      },
    };
    api.armPreviewPointer(null, rfb);
    rfb._sendMouse(100, 200, 1);
    expect(sent).toEqual([
      { x: 100, y: 200, mask: 0 },
      { x: 100, y: 200, mask: 1 },
    ]);
    sent.length = 0;
    rfb._sendMouse(100, 200, 1);
    // Still held — no extra move.
    expect(sent).toEqual([{ x: 100, y: 200, mask: 1 }]);
    sent.length = 0;
    rfb._sendMouse(100, 200, 0);
    expect(sent).toEqual([{ x: 100, y: 200, mask: 0 }]);
    sent.length = 0;
    // Re-arm is a no-op; second armPreviewPointer must not double-wrap.
    api.armPreviewPointer(null, rfb);
    rfb._sendMouse(50, 60, 1);
    expect(sent).toEqual([
      { x: 50, y: 60, mask: 0 },
      { x: 50, y: 60, mask: 1 },
    ]);
  });

  it("scales the framebuffer and does not load stock noVNC chrome", () => {
    const html = buildNoVncObserverBootstrapHtml("abc123");
    expect(html).toContain("/sandbox/novnc/static/abc123/core/rfb.js");
    expect(html).toContain("sandbox%2Fnovnc%2Fws%3Fgrant%3Dabc123");
    expect(html).toContain("scaleViewport = true");
    expect(html).toContain("resizeSession = false");
    expect(html).not.toContain("vnc.html");
    expect(html).not.toContain("noVNC_control_bar");
    expect(html).not.toContain("resize=remote");
    expect(html).not.toContain("window.location.replace");
    expect(html).not.toContain("127.0.0.1");
    expect(html).not.toContain("password=");
  });

  it("keeps a non-hex grant inside the relay path without a script breakout", () => {
    const html = buildNoVncObserverBootstrapHtml("valid-token");
    expect(html).toContain("sandbox%2Fnovnc%2Fws%3Fgrant%3Dvalid-token");
    expect(html).toContain("/sandbox/novnc/static/valid-token/core/rfb.js");
    expect(html).not.toContain("</script><script>");
  });
});
