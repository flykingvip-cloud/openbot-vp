/**
 * WeChat (mp.weixin.qq.com) article extraction helpers.
 * Readability often returns a near-empty "shell"; body lives in js_content /
 * rich_media_content (frequently visibility:hidden).
 */

import { htmlToMarkdown, markdownToText, type ExtractMode } from "./web-fetch-utils.js";

/** Hosts that serve WeChat public-account article pages. */
export function isWeixinArticleHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    return (
      host === "mp.weixin.qq.com" ||
      host.endsWith(".mp.weixin.qq.com") ||
      host === "weixin.qq.com"
    );
  } catch {
    return /mp\.weixin\.qq\.com/i.test(url);
  }
}

/** LIVE 2026-10-20: readability shell was rawLength≈55. */
export const WEIXIN_SHELL_RAW_LENGTH_MAX = 200;

/**
 * Near-empty extract that must not be treated (or cached) as a successful
 * WeChat article body.
 */
export function isNearEmptyWeixinExtract(text: string | undefined | null): boolean {
  if (!text) {
    return true;
  }
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= WEIXIN_SHELL_RAW_LENGTH_MAX) {
    return true;
  }
  // Common shell / login / anti-bot crumbs without article body.
  if (
    /环境异常|去验证|当前环境异常|请在微信客户端打开链接|该内容已被发布者删除/.test(trimmed) &&
    trimmed.length < 800
  ) {
    return true;
  }
  return false;
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/gi, (_, dec: string) => String.fromCharCode(Number.parseInt(dec, 10)));
}

function extractTitleFromWeixinHtml(html: string): string | undefined {
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  ) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  if (og?.[1]) {
    return decodeBasicEntities(og[1]).trim() || undefined;
  }
  const msgTitle = html.match(/id=["']activity-name["'][^>]*>([\s\S]*?)<\//i);
  if (msgTitle?.[1]) {
    const t = decodeBasicEntities(msgTitle[1].replace(/<[^>]+>/g, "")).trim();
    if (t) {
      return t;
    }
  }
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTag?.[1]) {
    const t = decodeBasicEntities(titleTag[1].replace(/<[^>]+>/g, "")).trim();
    if (t && t !== "微信公众平台") {
      return t;
    }
  }
  return undefined;
}

/**
 * Pull article HTML from js_content / rich_media_content blocks in a WeChat page.
 * Returns null when no usable body is present.
 */
export function extractWeixinJsContent(
  html: string,
  extractMode: ExtractMode = "markdown",
): { text: string; title?: string } | null {
  if (!html || html.length < 80) {
    return null;
  }

  const patterns = [
    /id=["']js_content["'][^>]*>([\s\S]*?)<\/div>/i,
    /id=["']img-content["'][\s\S]*?id=["']js_content["'][^>]*>([\s\S]*?)<\/div>/i,
    /class=["'][^"']*rich_media_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];

  let bodyHtml: string | undefined;
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1] && m[1].replace(/\s+/g, "").length > 40) {
      bodyHtml = m[1];
      break;
    }
  }

  // Some pages put escaped HTML inside a script / data attribute.
  if (!bodyHtml) {
    const dataContent = html.match(
      /id=["']js_content["'][^>]*data-content=["']([^"']+)["']/i,
    );
    if (dataContent?.[1]) {
      bodyHtml = decodeBasicEntities(dataContent[1]);
    }
  }

  if (!bodyHtml) {
    return null;
  }

  const title = extractTitleFromWeixinHtml(html);
  const rendered = htmlToMarkdown(bodyHtml);
  const text =
    extractMode === "text"
      ? markdownToText(rendered.text)
      : rendered.text;
  const cleaned = text.replace(/\u200b/g, "").trim();
  if (isNearEmptyWeixinExtract(cleaned)) {
    return null;
  }
  return { text: cleaned, title: title ?? rendered.title };
}

/**
 * When readability (or similar) returned a WeChat shell, prefer js_content.
 * Returns the improved extract, or null if nothing better is available.
 */
export function preferWeixinBodyOverShell(params: {
  url: string;
  html: string;
  currentText: string;
  extractMode: ExtractMode;
}): { text: string; title?: string; extractor: "weixin-js-content" } | null {
  if (!isWeixinArticleHost(params.url)) {
    return null;
  }
  if (!isNearEmptyWeixinExtract(params.currentText)) {
    return null;
  }
  const extracted = extractWeixinJsContent(params.html, params.extractMode);
  if (!extracted) {
    return null;
  }
  return { ...extracted, extractor: "weixin-js-content" };
}

/** True when a completed web_fetch payload should not be written to cache. */
export function shouldSkipWebFetchCache(params: {
  url: string;
  rawLength: number;
  text?: string;
  extractor?: string;
}): boolean {
  if (!isWeixinArticleHost(params.url)) {
    return false;
  }
  if (params.extractor === "weixin-js-content") {
    return false;
  }
  if (params.rawLength <= WEIXIN_SHELL_RAW_LENGTH_MAX) {
    return true;
  }
  return isNearEmptyWeixinExtract(params.text);
}
