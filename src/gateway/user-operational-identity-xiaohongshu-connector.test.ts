import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeSocialManualIdentityAction } from "./user-operational-identity-social.js";
import {
  normalizeXiaohongshuMcpCookiesJson,
  publishXiaohongshuMcpNote,
  resolveXiaohongshuConnectorKind,
  syncXiaohongshuMcpCookies,
} from "./user-operational-identity-xiaohongshu-connector.js";

describe("xiaohongshu connector", () => {
  const nowIso = "2026-07-26T12:00:00.000Z";

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENBOT_XIAOHONGSHU_API_BASE;
    delete process.env.OPENBOT_XIAOHONGSHU_CONNECTOR;
  });

  afterEach(() => {
    delete process.env.OPENBOT_XIAOHONGSHU_API_BASE;
    delete process.env.OPENBOT_XIAOHONGSHU_CONNECTOR;
  });

  it("normalizes cookie header into mcp cookies_json", () => {
    const json = normalizeXiaohongshuMcpCookiesJson("a1=aaa; web_session=bbb");
    expect(JSON.parse(json)).toEqual([
      { name: "a1", value: "aaa", domain: ".xiaohongshu.com", path: "/" },
      { name: "web_session", value: "bbb", domain: ".xiaohongshu.com", path: "/" },
    ]);
  });

  it("auto-detects xiaohongshu-mcp on :18060", () => {
    expect(resolveXiaohongshuConnectorKind("http://127.0.0.1:18060")).toBe("xiaohongshu-mcp");
    expect(resolveXiaohongshuConnectorKind("builtin:simulate")).toBe("builtin:simulate");
    expect(resolveXiaohongshuConnectorKind("https://connector.example.com")).toBe("openbot");
  });

  it("syncs cookies then publishes via xiaohongshu-mcp paths", async () => {
    process.env.OPENBOT_XIAOHONGSHU_API_BASE = "http://127.0.0.1:18060";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/v1/login/sync_cookies")) {
        expect(init?.method).toBe("POST");
        return Response.json({ ok: true });
      }
      if (url.endsWith("/api/v1/login/status")) {
        return Response.json({ logged_in: true });
      }
      if (url.endsWith("/api/v1/publish")) {
        const rawBody =
          typeof init?.body === "string"
            ? init.body
            : init?.body instanceof Uint8Array
              ? new TextDecoder().decode(init.body)
              : "{}";
        const body = JSON.parse(rawBody) as { title?: string; content?: string };
        expect(body.title).toBe("标题");
        expect(body.content).toBe("正文");
        return Response.json({ id: "note-mcp-1" });
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;

    const synced = await syncXiaohongshuMcpCookies({
      base: "http://127.0.0.1:18060",
      cookieOrToken: "a1=aaa; web_session=bbb",
      fetchImpl,
    });
    expect(synced.ok).toBe(true);

    const published = await publishXiaohongshuMcpNote({
      base: "http://127.0.0.1:18060",
      input: { title: "标题", content: "正文" },
      fetchImpl,
    });
    expect(published.id).toBe("note-mcp-1");

    const executed = await executeSocialManualIdentityAction({
      provider: "xiaohongshu",
      action: "publish_post",
      payload: { title: "标题", body: "正文" },
      secret: {
        handleId: "cred-xhs",
        ownerId: "user-1",
        provider: "xiaohongshu",
        kind: "social_account",
        accessToken: "a1=aaa; web_session=bbb",
        metadata: { accountHandle: "my_xhs" },
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      fetchImpl,
    });
    expect(executed.connector).toBe("xiaohongshu-mcp");
    expect(executed.noteId).toBe("note-mcp-1");
    expect(executed.simulated).toBe(false);
  });
});
