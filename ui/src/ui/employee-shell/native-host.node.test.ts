import { describe, expect, it } from "vitest";
import {
  parseEmployeeShellBridgeJSON,
  openSpaceMessage,
  readyMessage,
  type EmployeeShellBridgeMessage,
} from "./native-bridge.ts";
import {
  createNativeHostTransport,
  detectNativeHostKind,
  EMPLOYEE_SHELL_HOST_HANDLER,
  isEmbeddedInNativeShell,
  sendToNativeHost,
} from "./native-host.ts";

function webkitWindow(received: unknown[], opts?: { throws?: boolean }): Window {
  return {
    webkit: {
      messageHandlers: {
        [EMPLOYEE_SHELL_HOST_HANDLER]: {
          postMessage: (message: unknown) => {
            if (opts?.throws) {
              throw new Error("boom");
            }
            received.push(message);
          },
        },
      },
    },
  } as unknown as Window;
}

function androidWindow(received: string[]): Window {
  return {
    [EMPLOYEE_SHELL_HOST_HANDLER]: {
      postMessage: (message: string) => {
        received.push(message);
      },
    },
  } as unknown as Window;
}

describe("native host detection", () => {
  it("reports no host in a plain (node/web) window with nothing injected", () => {
    const plain = {} as unknown as Window;
    expect(detectNativeHostKind(plain)).toBe("none");
    expect(isEmbeddedInNativeShell(plain)).toBe(false);
    expect(createNativeHostTransport(plain).available).toBe(false);
  });

  it("reports no host when called with no window available (node env)", () => {
    // In the node test environment `window` is undefined.
    expect(detectNativeHostKind()).toBe("none");
    expect(isEmbeddedInNativeShell()).toBe(false);
  });

  it("detects a WKWebView (iOS/macOS) message handler", () => {
    expect(detectNativeHostKind(webkitWindow([]))).toBe("webkit");
  });

  it("detects an Android JS interface", () => {
    expect(detectNativeHostKind(androidWindow([]))).toBe("android");
  });

  it("prefers webkit when both channels are present", () => {
    const received: unknown[] = [];
    const hybrid = {
      webkit: {
        messageHandlers: {
          [EMPLOYEE_SHELL_HOST_HANDLER]: { postMessage: (m: unknown) => received.push(m) },
        },
      },
      [EMPLOYEE_SHELL_HOST_HANDLER]: { postMessage: () => undefined },
    } as unknown as Window;
    expect(detectNativeHostKind(hybrid)).toBe("webkit");
  });
});

describe("native host delivery", () => {
  it("delivers a serialized message to a webkit host and round-trips it", () => {
    const received: unknown[] = [];
    const ok = sendToNativeHost(openSpaceMessage("space-7"), webkitWindow(received));
    expect(ok).toBe(true);
    expect(received).toHaveLength(1);
    expect(typeof received[0]).toBe("string");
    const parsed = parseEmployeeShellBridgeJSON(received[0] as string);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.message.type).toBe("openSpace");
    }
  });

  it("delivers to an android host as a JSON string", () => {
    const received: string[] = [];
    const ok = sendToNativeHost(readyMessage("overview"), androidWindow(received));
    expect(ok).toBe(true);
    expect(received).toHaveLength(1);
    const parsed = parseEmployeeShellBridgeJSON(received[0]);
    expect(parsed.ok && parsed.message.type === "ready").toBe(true);
  });

  it("is a no-op returning false when there is no host", () => {
    expect(sendToNativeHost(openSpaceMessage("s"), {} as unknown as Window)).toBe(false);
  });

  it("never delivers an invalid (hand-built) message even with a host", () => {
    const received: unknown[] = [];
    const bad = {
      version: 1,
      type: "openSpace",
      payload: {},
    } as unknown as EmployeeShellBridgeMessage;
    const ok = createNativeHostTransport(webkitWindow(received)).send(bad);
    expect(ok).toBe(false);
    expect(received).toHaveLength(0);
  });

  it("returns false (does not throw) when the host postMessage throws", () => {
    const ok = sendToNativeHost(openSpaceMessage("s"), webkitWindow([], { throws: true }));
    expect(ok).toBe(false);
  });
});
