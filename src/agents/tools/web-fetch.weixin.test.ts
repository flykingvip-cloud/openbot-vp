import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ssrf from "../../infra/net/ssrf.js";
import { withFetchPreconnect } from "../../test-utils/fetch-mock.js";
import { createWebFetchTool } from "./web-tools.js";

vi.mock("./web-fetch-utils.js", async () => {
  const actual =
    await vi.importActual<typeof import("./web-fetch-utils.js")>("./web-fetch-utils.js");
  return {
    ...actual,
    extractReadableContent: vi.fn().mockResolvedValue({
      title: "微信公众平台",
      text: "x".repeat(55),
    }),
  };
});

const ARTICLE_HTML = `<!doctype html><html><head>
<meta property="og:title" content="第一批机器人独角兽" />
</head><body>
<div id="js_content" class="rich_media_content">
  <p>具身智能正在进入量产阶段。</p>
  <p>${"场景与出货量分析。".repeat(60)}</p>
</div>
</body></html>`;

function makeHeaders(map: Record<string, string>) {
  return { get: (key: string) => map[key.toLowerCase()] ?? null };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if ("url" in input && typeof input.url === "string") {
    return input.url;
  }
  return "";
}

describe("web_fetch WeChat shell + js_content", () => {
  const priorFetch = global.fetch;

  beforeEach(() => {
    vi.spyOn(ssrf, "resolvePinnedHostnameWithPolicy").mockImplementation(async (hostname) => {
      const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
      const addresses = ["93.184.216.34"];
      return {
        hostname: normalized,
        addresses,
        lookup: ssrf.createPinnedLookup({ hostname: normalized, addresses }),
      };
    });
  });

  afterEach(() => {
    global.fetch = priorFetch;
    vi.restoreAllMocks();
  });

  it("extracts js_content when weixinJsContent flag is on", async () => {
    global.fetch = withFetchPreconnect(
      vi.fn(async (input: RequestInfo | URL) => {
        return {
          ok: true,
          status: 200,
          url: requestUrl(input),
          headers: makeHeaders({ "content-type": "text/html; charset=utf-8" }),
          text: async () => ARTICLE_HTML,
        } as Response;
      }),
    );

    const tool = createWebFetchTool({
      config: {
        tools: {
          web: {
            fetch: {
              cacheTtlMinutes: 5,
              firecrawl: { enabled: false },
              weixinJsContent: true,
            },
          },
        },
      },
    });

    const result = await tool?.execute?.("call", {
      url: "https://mp.weixin.qq.com/s/YTybVczzgXPH2nEBUhRlBQ",
    });
    const details = result?.details as {
      extractor?: string;
      rawLength?: number;
      text?: string;
      cached?: boolean;
    };
    expect(details.extractor).toBe("weixin-js-content");
    expect(details.rawLength ?? 0).toBeGreaterThan(200);
    expect(details.text).toContain("具身智能");
  });

  it("does not cache near-empty WeChat shell when flag is off", async () => {
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      return {
        ok: true,
        status: 200,
        url: requestUrl(input),
        headers: makeHeaders({ "content-type": "text/html; charset=utf-8" }),
        text: async () => "<html><body>请在微信客户端打开链接</body></html>",
      } as Response;
    });
    global.fetch = withFetchPreconnect(mockFetch);

    const tool = createWebFetchTool({
      config: {
        tools: {
          web: {
            fetch: {
              cacheTtlMinutes: 5,
              firecrawl: { enabled: false },
              weixinJsContent: false,
            },
          },
        },
      },
    });

    const url = "https://mp.weixin.qq.com/s/cache-shell-test";
    const first = await tool?.execute?.("call", { url });
    const firstDetails = first?.details as {
      rawLength?: number;
      cached?: boolean;
      extractor?: string;
    };
    expect(firstDetails.cached).toBeFalsy();
    expect(firstDetails.rawLength ?? 0).toBeLessThanOrEqual(200);

    const second = await tool?.execute?.("call", { url });
    const secondDetails = second?.details as { cached?: boolean };
    // Must re-fetch (not served from cache) because shell was not cached.
    expect(secondDetails.cached).toBeFalsy();
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("does not cache near-empty Firecrawl early-path result for WeChat URL", async () => {
    const nearEmptyMarkdown = "请在微信客户端打开链接";
    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("api.firecrawl.dev")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              markdown: nearEmptyMarkdown,
              metadata: {
                title: "微信公众平台",
                sourceURL: "https://mp.weixin.qq.com/s/firecrawl-shell-cache",
                statusCode: 200,
              },
            },
          }),
        } as Response;
      }
      // Force early Firecrawl path via non-OK direct fetch (not in HTML Accept retry set).
      return {
        ok: false,
        status: 500,
        url,
        headers: makeHeaders({ "content-type": "text/html; charset=utf-8" }),
        text: async () => "upstream error",
      } as Response;
    });
    global.fetch = withFetchPreconnect(mockFetch);

    const tool = createWebFetchTool({
      config: {
        tools: {
          web: {
            fetch: {
              cacheTtlMinutes: 5,
              firecrawl: {
                enabled: true,
                // pragma: allowlist secret
                apiKey: "firecrawl-test",
              },
              weixinJsContent: false,
            },
          },
        },
      },
    });

    const url = "https://mp.weixin.qq.com/s/firecrawl-shell-cache";
    const first = await tool?.execute?.("call", { url });
    const firstDetails = first?.details as {
      extractor?: string;
      rawLength?: number;
      cached?: boolean;
      text?: string;
    };
    expect(firstDetails.extractor).toBe("firecrawl");
    expect(firstDetails.cached).toBeFalsy();
    expect(firstDetails.rawLength ?? 0).toBeLessThanOrEqual(200);
    expect(firstDetails.text).toContain("请在微信客户端打开链接");

    const second = await tool?.execute?.("call", { url });
    const secondDetails = second?.details as { cached?: boolean; extractor?: string };
    // Near-empty Firecrawl early path must not poison cache.
    expect(secondDetails.cached).toBeFalsy();
    expect(secondDetails.extractor).toBe("firecrawl");
    const firecrawlCalls = mockFetch.mock.calls.filter((call) =>
      requestUrl(call[0]).includes("api.firecrawl.dev"),
    );
    expect(firecrawlCalls.length).toBeGreaterThanOrEqual(2);
  });
});
