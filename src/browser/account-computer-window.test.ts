import { describe, expect, it, vi } from "vitest";
import {
  accountComputerWorkArea,
  maybePlaceAccountComputerWindow,
  placeAccountComputerBrowserWindow,
  placeAccountComputerWindowWithSend,
  type AccountComputerWindowBounds,
} from "./account-computer-window.js";
import type { CdpSendFn } from "./cdp.helpers.js";

const fetchJson = vi.hoisted(() => vi.fn());
const fetchOk = vi.hoisted(() => vi.fn());
const withCdpSocket = vi.hoisted(() => vi.fn());

vi.mock("./cdp.helpers.js", async () => {
  const actual = await vi.importActual<typeof import("./cdp.helpers.js")>("./cdp.helpers.js");
  return {
    ...actual,
    fetchJson,
    fetchOk,
    withCdpSocket,
  };
});

const WORK_AREA: AccountComputerWindowBounds = {
  left: 0,
  top: 0,
  width: 1280,
  height: 800,
  windowState: "normal",
};

describe("account computer window placement", () => {
  it("uses the full 1280x800 desktop", () => {
    expect(accountComputerWorkArea()).toEqual(WORK_AREA);
  });

  it("retries getWindowForTarget, then sets normal bounds and activates", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    let lookups = 0;
    const send: CdpSendFn = async (method, params) => {
      calls.push({ method, params });
      if (method === "Browser.getWindowForTarget") {
        lookups += 1;
        if (lookups === 1) {
          throw new Error("window not ready");
        }
        return { windowId: 7 };
      }
      return {};
    };
    const placed = await placeAccountComputerWindowWithSend({
      send,
      targetId: "tab-1",
      sleep: async () => undefined,
    });
    expect(placed).toBe(true);
    expect(calls.map((call) => call.method)).toEqual([
      "Browser.getWindowForTarget",
      "Browser.getWindowForTarget",
      "Browser.setWindowBounds",
      "Target.activateTarget",
      "Page.bringToFront",
    ]);
    expect(calls[2]?.params).toEqual({
      windowId: 7,
      bounds: WORK_AREA,
    });
    expect(calls[3]?.params).toEqual({ targetId: "tab-1" });
  });

  it("returns false when the window never appears", async () => {
    const send: CdpSendFn = async (method) => {
      if (method === "Browser.getWindowForTarget") {
        throw new Error("no window");
      }
      return {};
    };
    await expect(
      placeAccountComputerWindowWithSend({
        send,
        targetId: "tab-1",
        attempts: 2,
        sleep: async () => undefined,
      }),
    ).resolves.toBe(false);
  });

  it("places a tab through the CDP socket helper", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    fetchJson.mockResolvedValue({
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/abc",
    });
    fetchOk.mockResolvedValue(undefined);
    withCdpSocket.mockImplementation(
      async (_wsUrl: string, fn: (send: CdpSendFn) => Promise<boolean>) => {
        const send: CdpSendFn = async (method, params) => {
          calls.push({ method, params });
          if (method === "Browser.getWindowForTarget") {
            return { windowId: 3 };
          }
          return {};
        };
        return await fn(send);
      },
    );

    await expect(
      placeAccountComputerBrowserWindow({
        cdpUrl: "http://127.0.0.1:9222",
        targetId: "tab-9",
      }),
    ).resolves.toBe(true);

    expect(withCdpSocket).toHaveBeenCalledWith(
      "ws://127.0.0.1:9222/devtools/browser/abc",
      expect.any(Function),
      { handshakeTimeoutMs: 2000 },
    );
    expect(calls.map((call) => call.method)).toEqual([
      "Browser.getWindowForTarget",
      "Browser.setWindowBounds",
      "Target.activateTarget",
      "Page.bringToFront",
    ]);
    expect(calls[1]?.params).toEqual({ windowId: 3, bounds: WORK_AREA });
    expect(fetchOk).toHaveBeenCalled();
  });

  it("places only when the Account Computer work-area flag is set", async () => {
    const place = vi.fn(async () => true);
    await maybePlaceAccountComputerWindow({
      enabled: false,
      cdpUrl: "http://127.0.0.1:9222",
      targetId: "tab-1",
      place,
    });
    expect(place).not.toHaveBeenCalled();
    await maybePlaceAccountComputerWindow({
      enabled: true,
      cdpUrl: "http://127.0.0.1:9222",
      targetId: "tab-1",
      place,
    });
    expect(place).toHaveBeenCalledWith({
      cdpUrl: "http://127.0.0.1:9222",
      targetId: "tab-1",
    });
    place.mockRejectedValueOnce(new Error("cdp down"));
    await expect(
      maybePlaceAccountComputerWindow({
        enabled: true,
        cdpUrl: "http://127.0.0.1:9222",
        targetId: "tab-2",
        place,
      }),
    ).resolves.toBeUndefined();
  });
});
