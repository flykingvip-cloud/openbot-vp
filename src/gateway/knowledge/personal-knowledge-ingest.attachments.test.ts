// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  attachmentToIngestBuffer,
  validateAttachmentForKnowledgeIngest,
} from "./personal-knowledge-ingest.js";

describe("personal knowledge ingest attachment guards", () => {
  it("decodes a PDF data url into the original binary buffer", () => {
    const payload = attachmentToIngestBuffer({
      fileName: "report.pdf",
      mimeType: "application/pdf",
      size: 4,
      kind: "binary",
      dataUrl: `data:application/pdf;base64,${Buffer.from("pdf").toString("base64")}`,
    });

    expect(payload?.mimeType).toBe("application/pdf");
    expect(payload?.fileName).toBe("report.pdf");
    expect(payload?.buffer.toString("utf8")).toBe("pdf");
  });

  it("rejects unsupported office formats from knowledge ingest", () => {
    const error = validateAttachmentForKnowledgeIngest({
      fileName: "legacy.xls",
      mimeType: "application/vnd.ms-excel",
      size: 12,
      kind: "binary",
      dataUrl: `data:application/vnd.ms-excel;base64,${Buffer.from("xls").toString("base64")}`,
    });

    expect(error).toContain("旧版 Word/Excel/PPT");
  });

  it("accepts docx when raw bytes are present", () => {
    const error = validateAttachmentForKnowledgeIngest({
      fileName: "handbook.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 12,
      kind: "binary",
      dataUrl: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${Buffer.from("docx").toString("base64")}`,
    });

    expect(error).toBeNull();
  });

  it("accepts xlsx when raw bytes are present", () => {
    const error = validateAttachmentForKnowledgeIngest({
      fileName: "pipeline.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 12,
      kind: "binary",
      dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${Buffer.from("xlsx").toString("base64")}`,
    });

    expect(error).toBeNull();
  });

  it("accepts pptx when raw bytes are present", () => {
    const error = validateAttachmentForKnowledgeIngest({
      fileName: "launch.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 12,
      kind: "binary",
      dataUrl: `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${Buffer.from("pptx").toString("base64")}`,
    });

    expect(error).toBeNull();
  });

  it("accepts image attachments when raw bytes are present for OCR", () => {
    const error = validateAttachmentForKnowledgeIngest({
      fileName: "invoice.png",
      mimeType: "image/png",
      size: 12,
      kind: "image",
      dataUrl: `data:image/png;base64,${Buffer.from("png").toString("base64")}`,
    });

    expect(error).toBeNull();
  });
});
