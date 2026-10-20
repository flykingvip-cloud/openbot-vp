import { describe, expect, it } from "vitest";
import {
  extractWeixinJsContent,
  isNearEmptyWeixinExtract,
  isWeixinArticleHost,
  preferWeixinBodyOverShell,
  shouldSkipWebFetchCache,
  WEIXIN_SHELL_RAW_LENGTH_MAX,
} from "./weixin-extract.js";

const SHELL_HTML = `<!doctype html><html><head><title>微信公众平台</title></head>
<body><div class="rich_media">请在微信客户端打开链接</div></body></html>`;

const ARTICLE_HTML = `<!doctype html><html><head>
<meta property="og:title" content="第一批机器人独角兽" />
<title>微信公众平台</title></head>
<body>
<div id="activity-name">第一批机器人独角兽</div>
<div id="js_content" class="rich_media_content">
  <p>具身智能正在进入量产阶段。</p>
  <p>出货量与场景渗透率是本轮融资的关键指标，下文给出数据分析与解读。</p>
  <p>${"场景描述。".repeat(40)}</p>
</div>
</body></html>`;

describe("weixin-extract", () => {
  it("detects WeChat article hosts", () => {
    expect(isWeixinArticleHost("https://mp.weixin.qq.com/s/YTybVczzgXPH2nEBUhRlBQ")).toBe(true);
    expect(isWeixinArticleHost("https://example.com/x")).toBe(false);
  });

  it("treats short shells as near-empty", () => {
    expect(isNearEmptyWeixinExtract("x".repeat(WEIXIN_SHELL_RAW_LENGTH_MAX))).toBe(true);
    expect(isNearEmptyWeixinExtract("x".repeat(WEIXIN_SHELL_RAW_LENGTH_MAX + 1))).toBe(false);
    expect(isNearEmptyWeixinExtract("请在微信客户端打开链接")).toBe(true);
  });

  it("extracts js_content body and title", () => {
    const got = extractWeixinJsContent(ARTICLE_HTML, "text");
    expect(got?.title).toContain("独角兽");
    expect(got?.text).toContain("具身智能");
    expect(got && got.text.length).toBeGreaterThan(200);
  });

  it("returns null for shell-only HTML", () => {
    expect(extractWeixinJsContent(SHELL_HTML, "markdown")).toBeNull();
  });

  it("prefers js_content over readability shell", () => {
    const preferred = preferWeixinBodyOverShell({
      url: "https://mp.weixin.qq.com/s/abc",
      html: ARTICLE_HTML,
      currentText: "x".repeat(55),
      extractMode: "markdown",
    });
    expect(preferred?.extractor).toBe("weixin-js-content");
    expect(preferred?.text).toContain("具身智能");
  });

  it("skips cache for near-empty WeChat extracts only", () => {
    expect(
      shouldSkipWebFetchCache({
        url: "https://mp.weixin.qq.com/s/abc",
        rawLength: 55,
        text: "x".repeat(55),
        extractor: "readability",
      }),
    ).toBe(true);
    expect(
      shouldSkipWebFetchCache({
        url: "https://mp.weixin.qq.com/s/abc",
        rawLength: 2500,
        text: "具身智能".repeat(200),
        extractor: "weixin-js-content",
      }),
    ).toBe(false);
    expect(
      shouldSkipWebFetchCache({
        url: "https://example.com/a",
        rawLength: 10,
        text: "short",
        extractor: "readability",
      }),
    ).toBe(false);
  });
});
