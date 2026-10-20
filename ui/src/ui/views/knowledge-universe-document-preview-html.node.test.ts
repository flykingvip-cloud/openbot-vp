import { describe, expect, it } from "vitest";
import { wrapKnowledgeDocumentPreviewHtml } from "./knowledge-universe-document-preview-html.ts";

describe("wrapKnowledgeDocumentPreviewHtml", () => {
  it("wraps a mammoth fragment so tables keep intrinsic layout", () => {
    const wrapped = wrapKnowledgeDocumentPreviewHtml(
      "<table><tr><td>姓名</td><td>马仲聪</td></tr></table>",
    );
    expect(wrapped).toContain("<!doctype html>");
    expect(wrapped).toContain("data-openbot-doc-preview");
    expect(wrapped).toContain("width:max-content");
    expect(wrapped).toContain("<td>姓名</td>");
  });

  it("injects table-preserving styles into an existing document", () => {
    const wrapped = wrapKnowledgeDocumentPreviewHtml(
      "<!doctype html><html><head><title>x</title></head><body><p>hi</p></body></html>",
    );
    expect(wrapped).toContain("</style></head>");
    expect(wrapped).toContain("table-layout:auto");
  });
});
