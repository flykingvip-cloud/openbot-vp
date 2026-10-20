import { describe, expect, it } from "vitest";
import {
  buildCrawlArgv,
  buildDedupeKey,
  normalizeErrorCategory,
  parseAdapterStdout,
} from "./contract.js";

describe("media-monitor contract", () => {
  it("builds crawl argv without shell concatenation", () => {
    expect(
      buildCrawlArgv({
        platform: "xhs",
        accountId: "a1",
        accountUrl: "https://example.invalid/u",
        mode: "creator",
      }),
    ).toEqual([
      "crawl",
      "--platform",
      "xhs",
      "--account-id",
      "a1",
      "--mode",
      "creator",
      "--output",
      "jsonl",
      "--account-url",
      "https://example.invalid/u",
    ]);
  });

  it("parses JSONL success and error envelopes", () => {
    const ok = parseAdapterStdout(
      `${JSON.stringify({
        schema_version: 1,
        platform: "xhs",
        target: { account_id: "a" },
        run: {
          id: "r1",
          started_at: "t0",
          finished_at: "t1",
          mode: "creator",
        },
        items: [{ type: "content", platform_id: "n1", title: "hi" }],
        health: { state: "ok" },
      })}\n`,
    );
    expect("items" in ok).toBe(true);
    if ("items" in ok) {
      expect(ok.items).toHaveLength(1);
    }

    const err = parseAdapterStdout(
      JSON.stringify({
        schema_version: 1,
        error: { category: "rate_limit", retryable: true, message: "429" },
      }),
    );
    expect("error" in err).toBe(true);
    if ("error" in err) {
      expect(err.error.category).toBe("rate_limit");
    }
  });

  it("builds stable dedupe keys", () => {
    expect(
      buildDedupeKey({
        platform: "xhs",
        targetId: "tgt1",
        eventType: "content.created",
        platformObjectId: "note-1",
      }),
    ).toBe("xhs:tgt1:content.created:note-1");
  });

  it("normalizes error categories", () => {
    expect(normalizeErrorCategory("captcha")).toBe("captcha");
    expect(normalizeErrorCategory("weird")).toBe("unknown");
  });
});
