import { describe, expect, it } from "vitest";
import {
  isRetiredControlUiAsset,
  sanitizeControlUiIndexHtml,
} from "./control-ui-index-sanitize.ts";

describe("sanitizeControlUiIndexHtml", () => {
  it("strips cache-bust queries from JS module script src", () => {
    const html = `<script type="module" crossorigin src="./assets/index-CR5cronNm9.js?v=preview-p0p1"></script>`;
    expect(sanitizeControlUiIndexHtml(html)).toBe(
      `<script type="module" crossorigin src="./assets/index-CR5cronNm9.js"></script>`,
    );
  });

  it("rewrites retired overlay entries to the pinned module", () => {
    const html = `<script type="module" crossorigin src="./assets/index-CR5cronNm8.js?v=preview-p0p1"></script>`;
    expect(sanitizeControlUiIndexHtml(html)).toBe(
      `<script type="module" crossorigin src="./assets/index-CR5cronNm9.js"></script>`,
    );
  });

  it("leaves favicon and CSS queries alone", () => {
    const html = `<link rel="icon" href="./favicon.ico?v=20260722a" />
    <link rel="stylesheet" href="./assets/index-DEHQUnp-nm6.css">`;
    expect(sanitizeControlUiIndexHtml(html)).toBe(html);
  });

  it("is a no-op for HTML without script queries", () => {
    const html = "<html><head></head><body>Hello</body></html>\n";
    expect(sanitizeControlUiIndexHtml(html)).toBe(html);
  });
});

describe("isRetiredControlUiAsset", () => {
  it("matches retired overlay entry basenames", () => {
    expect(isRetiredControlUiAsset("assets/index-CR5cronNm8.js")).toBe(true);
    expect(isRetiredControlUiAsset("index-CR5cronNm6.js")).toBe(true);
    expect(isRetiredControlUiAsset("assets/index-CR5cronNm9.js")).toBe(false);
    expect(isRetiredControlUiAsset("assets/render-actions-r5CscW9A-nm6.js")).toBe(true);
    expect(isRetiredControlUiAsset("assets/index-DEHQUnp-nm6.css")).toBe(false);
  });
});
