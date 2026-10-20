import { describe, expect, it } from "vitest";
import { buildControlUiCspHeader } from "./control-ui-csp.js";

describe("buildControlUiCspHeader", () => {
  it("blocks inline scripts while allowing inline styles", () => {
    const csp = buildControlUiCspHeader();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
  });

  it("allows Google Fonts for style and font loading", () => {
    const csp = buildControlUiCspHeader();
    expect(csp).toContain("https://fonts.googleapis.com");
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
  });

  it("allows sandboxed blob/data frames for HTML and PDF deliverable previews", () => {
    const csp = buildControlUiCspHeader();
    expect(csp).toContain(
      "frame-src 'self' blob: data: https://www.openbot.love https://gw.openbot.love",
    );
    expect(csp).toContain("object-src 'self' blob:");
    expect(csp).not.toContain("object-src 'none'");
  });

  it("allows blob and data audio for Control UI playback without widening remote media", () => {
    const csp = buildControlUiCspHeader();
    expect(csp).toContain("media-src 'self' blob: data:");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain(
      "frame-src 'self' blob: data: https://www.openbot.love https://gw.openbot.love",
    );
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
    expect(csp).not.toContain("media-src *");
    expect(csp).not.toContain("media-src 'self' https:");
  });
});
