// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { resolveWebClipContent } from "./resolve-web-clip-content.js";

describe("resolveWebClipContent", () => {
  it("prefers client text over server fetch", async () => {
    const fetcher = vi.fn(async () => ({ text: "server" }));
    const resolved = await resolveWebClipContent({
      url: "https://example.com/doc",
      title: "Doc",
      text: "Selected paragraph from the page.",
      fetcher,
    });
    expect(resolved).toEqual({
      title: "Doc",
      text: "Selected paragraph from the page.",
      source: "client-text",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("converts client html when text is absent", async () => {
    const resolved = await resolveWebClipContent({
      url: "https://example.com/doc",
      html: "<article><h1>Title</h1><p>Body copy</p></article>",
    });
    expect(resolved.source).toBe("client-html");
    expect(resolved.text).toContain("Body copy");
  });

  it("falls back to server fetch", async () => {
    const resolved = await resolveWebClipContent({
      url: "https://example.com/doc",
      fetcher: async () => ({ title: "Fetched", text: "Fetched body" }),
    });
    expect(resolved).toEqual({
      title: "Fetched",
      text: "Fetched body",
      source: "server-fetch",
    });
  });
});
