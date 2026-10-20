import { describe, expect, it } from "vitest";
import { describeBrowserDeviceName, isBrowserDeviceSenderLabel } from "./client-display-name.ts";

describe("describeBrowserDeviceName", () => {
  it("detects Chrome on macOS", () => {
    expect(
      describeBrowserDeviceName({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        platform: "MacIntel",
      }),
    ).toBe("Chrome · Mac");
  });

  it("detects Edge on Windows", () => {
    expect(
      describeBrowserDeviceName({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
        platform: "Win32",
      }),
    ).toBe("Edge · Windows");
  });

  it("detects Safari on iPhone", () => {
    expect(
      describeBrowserDeviceName({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
      }),
    ).toBe("Safari · iPhone");
  });

  it("detects Firefox on Linux", () => {
    expect(
      describeBrowserDeviceName({
        userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
        platform: "Linux x86_64",
      }),
    ).toBe("Firefox · Linux");
  });

  it("falls back to a generic browser label for unknown user agents", () => {
    expect(describeBrowserDeviceName({ userAgent: "SomeWebView/1.0", platform: "MacIntel" })).toBe(
      "Browser · Mac",
    );
  });

  it("returns undefined when nothing is known", () => {
    expect(describeBrowserDeviceName({ userAgent: "", platform: "" })).toBeUndefined();
  });

  it("detects browser device sender labels", () => {
    expect(isBrowserDeviceSenderLabel("Chrome · Mac")).toBe(true);
    expect(isBrowserDeviceSenderLabel("Safari · iPhone")).toBe(true);
    expect(isBrowserDeviceSenderLabel("elle")).toBe(false);
    expect(isBrowserDeviceSenderLabel("UPBEYOND")).toBe(false);
  });
});
