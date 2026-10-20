import { afterEach, describe, expect, it } from "vitest";
import {
  BRAND_FAVICON_ASSET_VERSION,
  BRAND_FAVICON_SVG,
  syncBrandHeadAssets,
} from "./brand-assets.ts";

describe("syncBrandHeadAssets", () => {
  afterEach(() => {
    document.head
      .querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')
      .forEach((link) => link.remove());
  });

  it("reuses current links and removes only superseded favicon generations", () => {
    const current = document.createElement("link");
    current.rel = "icon";
    current.type = "image/svg+xml";
    current.href = `/${BRAND_FAVICON_SVG}?v=${BRAND_FAVICON_ASSET_VERSION}`;
    document.head.append(current);

    const legacy = document.createElement("link");
    legacy.rel = "shortcut icon";
    legacy.href = "/favicon.ico";
    document.head.append(legacy);

    syncBrandHeadAssets({}, "");
    const managed = document.head.querySelector<HTMLLinkElement>(
      'link[rel="icon"][data-openbot-brand="icon"]',
    );
    expect(managed).toBe(current);
    expect(legacy.isConnected).toBe(false);

    syncBrandHeadAssets({}, "");
    expect(
      document.head.querySelector<HTMLLinkElement>('link[rel="icon"][data-openbot-brand="icon"]'),
    ).toBe(current);
  });
});
