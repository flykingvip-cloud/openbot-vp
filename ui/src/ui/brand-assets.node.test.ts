import { describe, expect, it } from "vitest";
import {
  BRAND_FAVICON_ASSET_VERSION,
  resolveTrimBoundsForTest,
  withBrandFaviconVersion,
} from "./brand-assets.ts";

describe("withBrandFaviconVersion", () => {
  it("appends a stable cache-bust query to bundled favicon paths", () => {
    expect(withBrandFaviconVersion("/favicon.ico")).toBe(
      `/favicon.ico?v=${BRAND_FAVICON_ASSET_VERSION}`,
    );
    expect(withBrandFaviconVersion("/ui/favicon.svg")).toBe(
      `/ui/favicon.svg?v=${BRAND_FAVICON_ASSET_VERSION}`,
    );
  });

  it("replaces a previous v= query instead of stacking", () => {
    expect(withBrandFaviconVersion("/favicon.ico?v=old")).toBe(
      `/favicon.ico?v=${BRAND_FAVICON_ASSET_VERSION}`,
    );
    expect(withBrandFaviconVersion("/favicon.ico?x=1&v=old")).toBe(
      `/favicon.ico?x=1&v=${BRAND_FAVICON_ASSET_VERSION}`,
    );
  });

  it("leaves data URLs untouched", () => {
    const data = "data:image/png;base64,AAAA";
    expect(withBrandFaviconVersion(data)).toBe(data);
  });
});

function setPixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  red: number,
  green: number,
  blue: number,
  alpha = 255,
) {
  const offset = (y * width + x) * 4;
  data[offset] = red;
  data[offset + 1] = green;
  data[offset + 2] = blue;
  data[offset + 3] = alpha;
}

function fillRect(
  data: Uint8ClampedArray,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  red: number,
  green: number,
  blue: number,
) {
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      setPixel(data, width, x, y, red, green, blue);
    }
  }
}

describe("resolveTrimBoundsForTest", () => {
  it("ignores decorative borders and vertical padding around logo content", () => {
    const width = 120;
    const height = 140;
    const data = new Uint8ClampedArray(width * height * 4);
    fillRect(data, width, 0, 0, width - 1, height - 1, 255, 255, 255);
    for (let x = 8; x <= 111; x += 1) {
      setPixel(data, width, x, 8, 214, 40, 40);
      setPixel(data, width, x, 131, 214, 40, 40);
    }
    for (let y = 8; y <= 131; y += 1) {
      setPixel(data, width, 8, y, 214, 40, 40);
      setPixel(data, width, 111, y, 214, 40, 40);
    }
    fillRect(data, width, 42, 28, 77, 61, 201, 162, 39);
    fillRect(data, width, 28, 72, 91, 85, 139, 69, 19);

    const bounds = resolveTrimBoundsForTest(data, width, height);
    expect(bounds).not.toBeNull();
    expect(bounds?.left).toBeGreaterThan(20);
    expect(bounds?.top).toBeGreaterThan(20);
    expect(bounds?.right).toBeLessThan(100);
    expect(bounds?.bottom).toBeLessThan(95);
    expect((bounds?.bottom ?? 0) - (bounds?.top ?? 0)).toBeLessThan(70);
  });
});
