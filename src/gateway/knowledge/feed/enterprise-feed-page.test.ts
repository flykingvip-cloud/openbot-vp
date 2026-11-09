// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ENTERPRISE_FEED_PAGE_CHAR_BUDGET,
  ENTERPRISE_FEED_PREVIEW_MAX,
  feedPayloadExcerpt,
  pageEnterpriseFeedPayload,
} from "./enterprise-feed-adapter.js";

describe("enterprise feed page", () => {
  it("pages past the summary excerpt under the character budget", () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      Code: `SKU-${index}`,
      Name: `存货${index}`,
    }));
    const payload = { count: items.length, items };
    const excerpt = feedPayloadExcerpt(payload);
    expect(excerpt).toContain("SKU-0");
    expect(excerpt).not.toContain("SKU-30");

    const page = pageEnterpriseFeedPayload({
      payload,
      offset: ENTERPRISE_FEED_PREVIEW_MAX,
      limit: 10,
    });
    expect(page.total).toBe(40);
    expect(page.items).toHaveLength(10);
    expect((page.items[0] as { Code?: string }).Code).toBe("SKU-20");
    expect(page.truncated).toBe(true);

    const wide = {
      count: 8,
      items: Array.from({ length: 8 }, (_, index) => ({
        Code: `WIDE-${index}`,
        Name: "名".repeat(4_000),
      })),
    };
    const budgeted = pageEnterpriseFeedPayload({ payload: wide, offset: 0, limit: 8 });
    expect(JSON.stringify(budgeted.items).length).toBeLessThanOrEqual(
      ENTERPRISE_FEED_PAGE_CHAR_BUDGET,
    );
    expect(budgeted.items.length).toBeGreaterThan(0);
    expect(budgeted.items.length).toBeLessThan(8);
    expect(budgeted.truncated).toBe(true);
  });
});
