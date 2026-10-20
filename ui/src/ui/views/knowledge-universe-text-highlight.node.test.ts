// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it } from "vitest";
import {
  highlightSearchTerms,
  tokenizeSearchHighlightQuery,
} from "./knowledge-universe-text-highlight.ts";

describe("knowledge-universe-text-highlight", () => {
  it("tokenizes query terms", () => {
    expect(tokenizeSearchHighlightQuery("销售 手册,竞品")).toEqual(["销售", "手册", "竞品"]);
  });

  it("returns plain text when query is empty", () => {
    expect(highlightSearchTerms("Hello world", "")).toBe("Hello world");
  });

  it("wraps matched terms in mark elements", () => {
    const container = document.createElement("div");
    render(highlightSearchTerms("企业销售手册摘要", "销售"), container);
    expect(container.querySelector("mark.knowledge-universe__search-highlight")?.textContent).toBe(
      "销售",
    );
  });

  it("matches terms case-insensitively", () => {
    const container = document.createElement("div");
    render(highlightSearchTerms("OpenBot Gateway", "gateway"), container);
    expect(container.querySelector("mark")?.textContent).toBe("Gateway");
  });
});
