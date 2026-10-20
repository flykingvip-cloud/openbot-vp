import { describe, expect, it } from "vitest";
import { normalizeCanvasHostBaseUrl, resolveCanvasHostUrl } from "./canvas-host-url.js";

describe("normalizeCanvasHostBaseUrl", () => {
  it("strips path and keeps origin", () => {
    expect(normalizeCanvasHostBaseUrl("https://gw.example.com/__openbot__/canvas/")).toBe(
      "https://gw.example.com",
    );
  });

  it("keeps non-default ports", () => {
    expect(normalizeCanvasHostBaseUrl("https://gw.example.com:8443/foo")).toBe(
      "https://gw.example.com:8443",
    );
  });

  it("rejects non-http schemes", () => {
    expect(normalizeCanvasHostBaseUrl("ftp://gw.example.com")).toBeUndefined();
  });
});

describe("resolveCanvasHostUrl", () => {
  it("prefers canvasHost.baseUrl for reverse-proxy deployments", () => {
    expect(
      resolveCanvasHostUrl({
        canvasPort: 18789,
        localAddress: "127.0.0.1",
        requestHost: "127.0.0.1:18789",
        baseUrl: "https://gw.openbot.love",
        rejectLoopback: true,
      }),
    ).toBe("https://gw.openbot.love");
  });

  it("does not advertise loopback to remote clients without baseUrl", () => {
    expect(
      resolveCanvasHostUrl({
        canvasPort: 18789,
        localAddress: "127.0.0.1",
        requestHost: "127.0.0.1:18789",
        rejectLoopback: true,
      }),
    ).toBeUndefined();
  });

  it("allows loopback URLs for local clients", () => {
    expect(
      resolveCanvasHostUrl({
        canvasPort: 18789,
        localAddress: "127.0.0.1",
        requestHost: "127.0.0.1:18789",
        rejectLoopback: false,
      }),
    ).toBe("http://127.0.0.1:18789");
  });

  it("uses public Host + https default port for proxied remote clients", () => {
    expect(
      resolveCanvasHostUrl({
        canvasPort: 18789,
        requestHost: "gw.openbot.love",
        forwardedProto: "https",
        localAddress: "127.0.0.1",
        rejectLoopback: true,
      }),
    ).toBe("https://gw.openbot.love");
  });

  it("keeps dedicated canvas port for lan-style hosts", () => {
    expect(
      resolveCanvasHostUrl({
        canvasPort: 19005,
        requestHost: "100.64.0.1:18789",
        localAddress: "127.0.0.1",
      }),
    ).toBe("http://100.64.0.1:19005");
  });
});
