import JSZip from "jszip";
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { cleanKnowledgeDocumentText } from "./content-clean.js";
import { extractKnowledgeDocument, planKnowledgeDocumentVersionDelta } from "./document-extract.js";
import {
  classifyContentVersionDelta,
  computeRawContentHash,
  computeSemanticContentHash,
} from "./document-fingerprint.js";

vi.mock("../../media/pdf-extract.js", () => ({
  extractPdfContent: vi.fn(async () => ({
    text: "Chapter 1\nSales playbook content.",
    images: [{ type: "image", data: "abc", mimeType: "image/png" }],
  })),
}));

vi.mock("./parse/vision-extract.js", () => ({
  extractPdfTextViaVision: vi.fn(async () => "Vision OCR recovered scan text."),
}));

describe("content-clean", () => {
  it("removes timestamps and page numbers before hashing", () => {
    const raw = [
      "Exported 2026-06-14T09:15:00Z",
      "Page 1 of 12",
      "Sales playbook content.",
      "Page 2 of 12",
    ].join("\n");
    const cleaned = cleanKnowledgeDocumentText(raw);
    expect(cleaned).toContain("Sales playbook content.");
    expect(cleaned).not.toMatch(/2026-06-14/);
    expect(cleaned.toLowerCase()).not.toContain("page 1 of 12");
  });
});

describe("document fingerprint", () => {
  it("keeps semantic hash stable when only export timestamp changes", () => {
    const body = "Sales playbook content for enterprise onboarding.";
    const first = computeSemanticContentHash(`Exported 2026-06-01\n${body}`);
    const second = computeSemanticContentHash(`Exported 2026-06-14\n${body}`);
    expect(first).toBe(second);
  });

  it("classifies raw-only delta when semantic is unchanged but raw bytes differ", () => {
    const semantic = computeSemanticContentHash("Same body");
    const delta = classifyContentVersionDelta({
      existingRawHash: "raw-a",
      existingSemanticHash: semantic,
      nextRawHash: "raw-b",
      nextSemanticHash: semantic,
    });
    expect(delta).toBe("raw_only");
  });

  it("classifies unchanged when raw and semantic hashes both match", () => {
    const raw = computeRawContentHash(Buffer.from("same-bytes"));
    const semantic = computeSemanticContentHash("Same body");
    expect(
      classifyContentVersionDelta({
        existingRawHash: raw,
        existingSemanticHash: semantic,
        nextRawHash: raw,
        nextSemanticHash: semantic,
      }),
    ).toBe("unchanged");
  });

  it("detects new semantic version when body changes", () => {
    const delta = classifyContentVersionDelta({
      existingRawHash: computeRawContentHash(Buffer.from("v1")),
      existingSemanticHash: computeSemanticContentHash("Version one"),
      nextRawHash: computeRawContentHash(Buffer.from("v2")),
      nextSemanticHash: computeSemanticContentHash("Version two"),
    });
    expect(delta).toBe("new_semantic_version");
  });
});

describe("document-extract", () => {
  it("extracts markdown text and computes two-layer hashes", async () => {
    const buffer = Buffer.from("# Playbook\n\nEnterprise onboarding steps.", "utf8");
    const extracted = await extractKnowledgeDocument({
      fileName: "playbook.md",
      mimeType: "text/markdown",
      buffer,
    });
    expect(extracted.format).toBe("markdown");
    expect(extracted.text).toContain("Enterprise onboarding");
    expect(extracted.rawHash).toHaveLength(64);
    expect(extracted.semanticHash).toHaveLength(64);
  });

  it("extracts pdf text via pdfjs helper", async () => {
    const extracted = await extractKnowledgeDocument({
      fileName: "brief.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4"),
    });
    expect(extracted.format).toBe("pdf");
    expect(extracted.text).toContain("Sales playbook");
    expect(extracted.parserEngine).toBe("local");
  });

  it("uses vision OCR for scanned PDF when ocrEnabled", async () => {
    const { extractPdfContent } = await import("../../media/pdf-extract.js");
    vi.mocked(extractPdfContent).mockResolvedValueOnce({
      text: "",
      images: [{ type: "image", data: "abc", mimeType: "image/png" }],
    });
    const extracted = await extractKnowledgeDocument({
      fileName: "scan.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4"),
      ocrEnabled: true,
    });
    expect(extracted.parserEngine).toBe("platform_vlm");
    expect(extracted.text).toContain("Vision OCR recovered scan text.");
  });

  it("keeps local pdf path for digital PDF even when ocrEnabled", async () => {
    const extracted = await extractKnowledgeDocument({
      fileName: "brief.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4"),
      ocrEnabled: true,
    });
    expect(extracted.parserEngine).toBe("local");
    expect(extracted.text).toContain("Sales playbook");
  });

  it("extracts docx text from office xml", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
       <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
         <w:body>
           <w:p><w:r><w:t>Quarterly plan</w:t></w:r></w:p>
           <w:p><w:r><w:t>中医可以培育洞察力</w:t></w:r></w:p>
         </w:body>
       </w:document>`,
    );
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const extracted = await extractKnowledgeDocument({
      fileName: "plan.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer,
    });
    expect(extracted.format).toBe("docx");
    expect(extracted.text).toContain("Quarterly plan");
    expect(extracted.text).toContain("中医可以培育洞察力");
  });

  it("extracts xlsx text from office xml", async () => {
    const zip = new JSZip();
    zip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
       <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
         <si><t>Quarterly pipeline</t></si>
         <si><t>EMEA</t></si>
         <si><t>&#25351;&#26631;</t></si>
       </sst>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
       <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
         <sheetData>
           <row r="1"><c r="A1" t="s"><v>0</v></c></row>
           <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>120</v></c></row>
         </sheetData>
       </worksheet>`,
    );
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const extracted = await extractKnowledgeDocument({
      fileName: "pipeline.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer,
    });
    expect(extracted.format).toBe("xlsx");
    expect(extracted.text).toContain("Quarterly pipeline");
    expect(extracted.text).toContain("EMEA");
    expect(extracted.text).toContain("指标");
    expect(extracted.text).toContain("120");
  });

  it("extracts pptx text from office xml", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
       <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
         <p:cSld>
           <p:spTree>
             <p:sp>
               <p:txBody>
                 <a:p><a:r><a:t>Product launch deck</a:t></a:r></a:p>
                 <a:p><a:r><a:t>Insight recap</a:t></a:r></a:p>
               </p:txBody>
             </p:sp>
           </p:spTree>
         </p:cSld>
       </p:sld>`,
    );
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const extracted = await extractKnowledgeDocument({
      fileName: "launch.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer,
    });
    expect(extracted.format).toBe("pptx");
    expect(extracted.text).toContain("Product launch deck");
    expect(extracted.text).toContain("Insight recap");
  });

  it("does not append embedded-image markers when OCR is enabled on digital PDF", async () => {
    const extracted = await extractKnowledgeDocument({
      fileName: "brief.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4"),
      ocrEnabled: true,
    });
    expect(extracted.text).not.toContain("[PDF embedded image 1]");
  });

  it("plans version delta from extracted document", async () => {
    const extracted = await extractKnowledgeDocument({
      fileName: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Same body", "utf8"),
    });
    expect(
      planKnowledgeDocumentVersionDelta({
        existingRawHash: "old-raw",
        existingSemanticHash: extracted.semanticHash,
        extracted,
      }),
    ).toBe("raw_only");
  });

  it("plans unchanged when raw and semantic both match", async () => {
    const extracted = await extractKnowledgeDocument({
      fileName: "note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Same body", "utf8"),
    });
    expect(
      planKnowledgeDocumentVersionDelta({
        existingRawHash: extracted.rawHash,
        existingSemanticHash: extracted.semanticHash,
        extracted,
      }),
    ).toBe("unchanged");
  });
});
