import { describe, expect, it } from "vitest";
import {
  buildPersonalDocumentUploadDescription,
  derivePersonalDocumentTitle,
  isSupportedPersonalDocument,
  isUnparsedDocumentPlaceholder,
} from "./personal-document-upload.js";

describe("personal document upload helpers", () => {
  it("accepts blueprint document extensions", () => {
    expect(isSupportedPersonalDocument("brief.pdf", "application/pdf")).toBe(true);
    expect(
      isSupportedPersonalDocument(
        "notes.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
    expect(
      isSupportedPersonalDocument(
        "sheet.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(true);
    expect(
      isSupportedPersonalDocument(
        "deck.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe(true);
    expect(isSupportedPersonalDocument("readme.md", "text/markdown")).toBe(true);
    expect(isSupportedPersonalDocument("photo.png", "image/png")).toBe(true);
    expect(isSupportedPersonalDocument("unknown.xyz", "application/octet-stream")).toBe(false);
  });

  it("builds upload description with file metadata", () => {
    const description = buildPersonalDocumentUploadDescription({
      fileName: "brief.pdf",
      mimeType: "application/pdf",
      size: 2048,
      kind: "binary",
    });
    expect(description).toContain("brief.pdf");
    expect(description).toContain("全文解析");
    expect(isUnparsedDocumentPlaceholder(description)).toBe(true);
    expect(isUnparsedDocumentPlaceholder("# 智能体设计模式\n\nReAct")).toBe(false);
  });

  it("derives title from file name when missing", () => {
    const title = derivePersonalDocumentTitle({
      fileName: "市场研究.md",
      mimeType: "text/markdown",
      size: 120,
      kind: "text",
      textContent: "# 市场研究",
    });
    expect(title).toBe("市场研究");
  });
});
